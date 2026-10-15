import { type Prisma } from "@prisma/client";
import prisma, { type Tx } from "@/lib/prisma";
import { dec, qty } from "@/lib/decimal";
import { errors } from "@/lib/errors";
import { actor, writeAudit } from "@/lib/audit";
import { zonedToUtc } from "@/lib/dates";
import { assertDoTransition, assertOrderTransition, ORDER_STATUS_LABELS } from "@/lib/state-machines";
import { assertCustomerPriority } from "@/server/services/priority.service";
import { dispatchOutStock } from "@/server/services/stock.service";
import { toDoRow } from "@/server/services/delivery-order.service";
import type { ServiceActor } from "@/server/services/order.service";

const TX_OPTIONS = { timeout: 30_000, maxWait: 30_000 };

/**
 * Rule 6 — dispatch control.
 *
 * A warehouse user only sees and acts on its own DOs, cannot create a DO and
 * cannot change quantities on its own. Over-dispatch and duplicate challan
 * numbers are blocked. Dispatch re-checks the customer priority queue because
 * the queue may have changed since the DO was created (Section 6.4).
 */

export type RecordDispatchInput = {
  doId: string;
  truckNo: string;
  driverName: string;
  driverPhone: string;
  challanNo: string;
  loadingDate: string;
  dispatchDate: string;
  remarks?: string;
  items: { doItemId: string; qtyMt: string }[];
};

export async function recordDispatch(input: RecordDispatchInput, user: ServiceActor, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const deliveryOrder = await tx.deliveryOrder.findUnique({
      where: { id: input.doId },
      include: {
        items: true,
        warehouse: true,
        order: { include: { customer: true } },
      },
    });
    if (!deliveryOrder) throw errors.notFound("Delivery order");

    // Rule 6 — warehouse scoping.
    if (user.role === "WAREHOUSE" && deliveryOrder.warehouseId !== user.warehouseCode) {
      throw errors.forbidden("dispatching another warehouse's delivery order");
    }

    if (deliveryOrder.status !== "CREATED" && deliveryOrder.status !== "PARTIALLY_DISPATCHED") {
      throw errors.illegalTransition(
        "delivery order",
        deliveryOrder.status,
        "PARTIALLY_DISPATCHED",
      );
    }

    // Duplicate challan number (unique index is the second safety net).
    const duplicate = await tx.dispatch.findUnique({ where: { challanNo: input.challanNo } });
    if (duplicate) throw errors.duplicateChallan(input.challanNo);

    // Rule 3 — re-check the queue. A DO that was created with a Sales Ops
    // override keeps that override for its later dispatches.
    await assertCustomerPriority(tx, {
      customerId: deliveryOrder.order.customerId,
      orderId: deliveryOrder.orderId,
      priorityOverride: deliveryOrder.priorityOverride,
      overrideReason: deliveryOrder.overrideReason ?? undefined,
    });

    // Serialise on the DO row, then the order row, then the stock rows.
    await tx.$queryRaw`SELECT id FROM delivery_orders WHERE id = ${deliveryOrder.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${deliveryOrder.orderId} FOR UPDATE`;

    const doItems = await tx.deliveryOrderItem.findMany({ where: { doId: deliveryOrder.id } });
    const byItemId = new Map(doItems.map((item) => [item.id, item]));

    const seen = new Set<string>();
    const prepared = input.items.map((line) => {
      if (seen.has(line.doItemId)) {
        throw errors.validation("The same delivery order line was entered twice in one dispatch.");
      }
      seen.add(line.doItemId);
      const item = byItemId.get(line.doItemId);
      if (!item) throw errors.notFound("Delivery order line");
      return { item, requested: qty(line.qtyMt) };
    });

    if (!prepared.some((line) => line.requested.gt(0))) {
      throw errors.validation("Enter a dispatched quantity greater than zero.");
    }

    for (const { item, requested } of prepared) {
      const remaining = dec(item.qtyMt).minus(dec(item.dispatchedMt));
      if (requested.gt(remaining)) {
        throw errors.overDispatch(
          `${deliveryOrder.doNo} line ${item.productCode}: only ${remaining.toFixed(3)} MT is left to dispatch (requested ${requested.toFixed(3)} MT).`,
        );
      }
    }

    const loadingDate = zonedToUtc(input.loadingDate);
    const dispatchDate = zonedToUtc(input.dispatchDate);

    const dispatch = await tx.dispatch.create({
      data: {
        doId: deliveryOrder.id,
        truckNo: input.truckNo,
        driverName: input.driverName,
        driverPhone: input.driverPhone,
        challanNo: input.challanNo,
        loadingDate,
        dispatchDate,
        remarks: input.remarks ?? null,
        recordedBy: user.id,
        createdBy: user.id,
      },
    });

    // Reduce reserved + on-hand stock and increase the dispatched/delivered counters.
    const ordered = [...prepared].sort((a, b) =>
      a.item.productCode.localeCompare(b.item.productCode),
    );
    for (const { item, requested } of ordered) {
      if (requested.isZero()) continue;

      await dispatchOutStock(tx, {
        warehouseCode: deliveryOrder.warehouseId,
        productCode: item.productCode,
        qtyMt: requested,
        refType: "dispatch",
        refId: dispatch.id,
        note: `${deliveryOrder.doNo} / challan ${input.challanNo}`,
        userId: user.id,
        userName: user.name,
        ip,
        auditAction: "DISPATCH",
      });

      await tx.dispatchItem.create({
        data: {
          dispatchId: dispatch.id,
          doItemId: item.id,
          qtyMt: requested.toFixed(3),
          createdBy: user.id,
        },
      });

      await tx.deliveryOrderItem.update({
        where: { id: item.id },
        data: { dispatchedMt: dec(item.dispatchedMt).plus(requested).toFixed(3) },
      });

      const orderItem = await tx.orderItem.findUnique({ where: { id: item.orderItemId } });
      if (orderItem) {
        await tx.orderItem.update({
          where: { id: orderItem.id },
          data: { deliveredMt: dec(orderItem.deliveredMt).plus(requested).toFixed(3) },
        });
      }
    }

    // --- DO status ---------------------------------------------------------
    const doItemsAfter = await tx.deliveryOrderItem.findMany({ where: { doId: deliveryOrder.id } });
    const fullyDispatched = doItemsAfter.every((item) =>
      dec(item.dispatchedMt).gte(dec(item.qtyMt)),
    );
    const newDoStatus = fullyDispatched ? "DISPATCHED" : "PARTIALLY_DISPATCHED";
    assertDoTransition(deliveryOrder.status, newDoStatus);

    const updatedDo = await tx.deliveryOrder.update({
      where: { id: deliveryOrder.id },
      data: { status: newDoStatus },
      include: {
        items: { include: { product: true } },
        warehouse: true,
        order: { include: { customer: true, items: { include: { product: true } } } },
        creator: { select: { name: true } },
      },
    });

    // --- Order status (Rule 4 — partial delivery across many DOs/warehouses)
    const orderItems = await tx.orderItem.findMany({ where: { orderId: deliveryOrder.orderId } });
    const remaining = orderItems.reduce(
      (acc, item) => acc.plus(dec(item.qtyMt).minus(dec(item.deliveredMt))),
      dec(0),
    );
    const newOrderStatus = remaining.gt(0) ? "PARTIALLY_DELIVERED" : "COMPLETED";
    assertOrderTransition(deliveryOrder.order.status, newOrderStatus);

    await tx.order.update({
      where: { id: deliveryOrder.orderId },
      data: { status: newOrderStatus },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "DISPATCH",
        entity: "dispatch",
        entityId: dispatch.id,
        oldValue: { doStatus: deliveryOrder.status, orderStatus: deliveryOrder.order.status },
        newValue: {
          doNo: deliveryOrder.doNo,
          orderNo: deliveryOrder.order.orderNo,
          customer: deliveryOrder.order.customerId,
          warehouse: deliveryOrder.warehouseId,
          challanNo: input.challanNo,
          truckNo: input.truckNo,
          driverName: input.driverName,
          driverPhone: input.driverPhone,
          loadingDate: loadingDate.toISOString(),
          dispatchDate: dispatchDate.toISOString(),
          items: prepared
            .filter((line) => line.requested.gt(0))
            .map((line) => ({
              product: line.item.productCode,
              qtyMt: line.requested.toFixed(3),
            })),
          doStatus: newDoStatus,
          orderStatus: newOrderStatus,
        },
      },
      tx,
    );

    return {
      dispatch: {
        id: dispatch.id,
        challanNo: dispatch.challanNo,
        truckNo: dispatch.truckNo,
        driverName: dispatch.driverName,
        driverPhone: dispatch.driverPhone,
        loadingDate: dispatch.loadingDate,
        dispatchDate: dispatch.dispatchDate,
        remarks: dispatch.remarks,
        qtyMt: prepared
          .reduce((acc, line) => acc.plus(line.requested), dec(0))
          .toFixed(3),
      },
      deliveryOrder: toDoRow(updatedDo),
      order: {
        id: deliveryOrder.orderId,
        orderNo: deliveryOrder.order.orderNo,
        status: newOrderStatus,
        statusLabel: ORDER_STATUS_LABELS[newOrderStatus],
        remainingMt: qty(remaining).toFixed(3),
      },
    };
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------------------
// Queries / reports
// ---------------------------------------------------------------------------

export type DispatchFilter = {
  q?: string;
  doId?: string;
  warehouseCode?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

const DISPATCH_INCLUDE = {
  deliveryOrder: {
    include: {
      warehouse: true,
      order: { include: { customer: true } },
      items: { include: { product: true } },
    },
  },
  recorder: { select: { name: true } },
  items: { include: { deliveryOrderItem: { include: { product: true } } } },
} satisfies Prisma.DispatchInclude;

export async function listDispatches(filter: DispatchFilter, user: ServiceActor) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, filter.pageSize ?? 20));
  const scopedWarehouse =
    user.role === "WAREHOUSE" ? (user.warehouseCode ?? "__none__") : filter.warehouseCode;

  const where: Prisma.DispatchWhereInput = {
    ...(filter.doId ? { doId: filter.doId } : {}),
    ...(scopedWarehouse ? { deliveryOrder: { warehouseId: scopedWarehouse } } : {}),
    ...(filter.from || filter.to
      ? {
          dispatchDate: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
    ...(filter.q
      ? {
          OR: [
            { challanNo: { contains: filter.q, mode: "insensitive" } },
            { truckNo: { contains: filter.q, mode: "insensitive" } },
            { driverName: { contains: filter.q, mode: "insensitive" } },
            { deliveryOrder: { doNo: { contains: filter.q, mode: "insensitive" } } },
            { deliveryOrder: { order: { orderNo: { contains: filter.q, mode: "insensitive" } } } },
            { deliveryOrder: { order: { customer: { name: { contains: filter.q, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.dispatch.findMany({
      where,
      orderBy: { dispatchDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: DISPATCH_INCLUDE,
    }),
    prisma.dispatch.count({ where }),
  ]);

  return {
    rows: rows.map((dispatch) => ({
      id: dispatch.id,
      challanNo: dispatch.challanNo,
      doNo: dispatch.deliveryOrder.doNo,
      orderNo: dispatch.deliveryOrder.order.orderNo,
      customerName: dispatch.deliveryOrder.order.customer.name,
      warehouseName: dispatch.deliveryOrder.warehouse.name,
      truckNo: dispatch.truckNo,
      driverName: dispatch.driverName,
      driverPhone: dispatch.driverPhone,
      loadingDate: dispatch.loadingDate,
      dispatchDate: dispatch.dispatchDate,
      recordedByName: dispatch.recorder.name,
      qtyMt: dispatch.items
        .reduce((acc, item) => acc.plus(dec(item.qtyMt)), dec(0))
        .toFixed(3),
      items: dispatch.items.map((item) => ({
        productCode: item.deliveryOrderItem.productCode,
        productName: item.deliveryOrderItem.product.name,
        qtyMt: item.qtyMt.toFixed(3),
      })),
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getDispatchForPrint(id: string) {
  const dispatch = await prisma.dispatch.findUnique({
    where: { id },
    include: DISPATCH_INCLUDE,
  });
  if (!dispatch) throw errors.notFound("Dispatch");
  return {
    id: dispatch.id,
    challanNo: dispatch.challanNo,
    doNo: dispatch.deliveryOrder.doNo,
    orderNo: dispatch.deliveryOrder.order.orderNo,
    customerName: dispatch.deliveryOrder.order.customer.name,
    customerAddress: dispatch.deliveryOrder.order.customer.address,
    warehouseName: dispatch.deliveryOrder.warehouse.name,
    warehouseLocation: dispatch.deliveryOrder.warehouse.location,
    truckNo: dispatch.truckNo,
    driverName: dispatch.driverName,
    driverPhone: dispatch.driverPhone,
    loadingDate: dispatch.loadingDate,
    dispatchDate: dispatch.dispatchDate,
    remarks: dispatch.remarks,
    recordedByName: dispatch.recorder.name,
    items: dispatch.items.map((item) => ({
      productCode: item.deliveryOrderItem.productCode,
      productName: item.deliveryOrderItem.product.name,
      qtyMt: item.qtyMt.toFixed(3),
    })),
    totalQtyMt: dispatch.items
      .reduce((acc, item) => acc.plus(dec(item.qtyMt)), dec(0))
      .toFixed(3),
  };
}

/** Total dispatch activity for a period (dashboard + register report). */
export async function dispatchTotals(from: Date, to: Date, warehouseCode?: string) {
  const rows = await prisma.dispatchItem.findMany({
    where: {
      dispatch: {
        dispatchDate: { gte: from, lte: to },
        ...(warehouseCode ? { deliveryOrder: { warehouseId: warehouseCode } } : {}),
      },
    },
    include: {
      deliveryOrderItem: { include: { product: true } },
      dispatch: { include: { deliveryOrder: { include: { warehouse: true, order: true } } } },
    },
  });

  let total = dec(0);
  const byProduct = new Map<string, { productCode: string; productName: string; qtyMt: string }>();
  for (const row of rows) {
    total = total.plus(dec(row.qtyMt));
    const code = row.deliveryOrderItem.productCode;
    const entry =
      byProduct.get(code) ?? { productCode: code, productName: row.deliveryOrderItem.product.name, qtyMt: "0.000" };
    entry.qtyMt = qty(dec(entry.qtyMt).plus(dec(row.qtyMt))).toFixed(3);
    byProduct.set(code, entry);
  }
  return { totalMt: qty(total).toFixed(3), byProduct: [...byProduct.values()] };
}

/** Helper used by tests: total dispatched quantity of one DO. */
export async function dispatchedQtyOfDo(tx: Tx, doId: string): Promise<string> {
  const items = await tx.deliveryOrderItem.findMany({ where: { doId } });
  return qty(items.reduce((acc, item) => acc.plus(dec(item.dispatchedMt)), dec(0))).toFixed(3);
}
