import { type DeliveryOrderStatus, type Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { dec, qty } from "@/lib/decimal";
import { errors } from "@/lib/errors";
import { actor, writeAudit } from "@/lib/audit";
import { nextDeliveryOrderNo } from "@/lib/numbering";
import { assertDoTransition, DO_STATUS_LABELS } from "@/lib/state-machines";
import { assertCustomerPriority } from "@/server/services/priority.service";
import { reserveStock } from "@/server/services/stock.service";
import type { ServiceActor } from "@/server/services/order.service";

const TX_OPTIONS = { timeout: 30_000, maxWait: 30_000 };

/**
 * Rule 5 — warehouse allocation.
 * Sales Ops chooses the warehouse manually; the system validates
 * `available = on_hand - reserved` and reserves the quantity on DO creation.
 */

export type CreateDoInput = {
  orderId: string;
  warehouseCode: string;
  note?: string;
  priorityOverride?: boolean;
  overrideReason?: string;
  items: { orderItemId: string; qtyMt: string }[];
};

type DoWithRelations = Prisma.DeliveryOrderGetPayload<{
  include: {
    items: { include: { product: true } };
    warehouse: true;
    order: { include: { customer: true; items: { include: { product: true } } } };
    creator: { select: { name: true } };
  };
}>;

export function toDoRow(deliveryOrder: DoWithRelations) {
  let doQty = dec(0);
  let dispatched = dec(0);
  for (const item of deliveryOrder.items) {
    doQty = doQty.plus(dec(item.qtyMt));
    dispatched = dispatched.plus(dec(item.dispatchedMt));
  }
  return {
    id: deliveryOrder.id,
    doNo: deliveryOrder.doNo,
    status: deliveryOrder.status,
    statusLabel: DO_STATUS_LABELS[deliveryOrder.status as DeliveryOrderStatus],
    orderId: deliveryOrder.orderId,
    orderNo: deliveryOrder.order.orderNo,
    customerCode: deliveryOrder.order.customerId,
    customerName: deliveryOrder.order.customer.name,
    warehouseCode: deliveryOrder.warehouseId,
    warehouseName: deliveryOrder.warehouse.name,
    priorityOverride: deliveryOrder.priorityOverride,
    overrideReason: deliveryOrder.overrideReason,
    note: deliveryOrder.note,
    cancelReason: deliveryOrder.cancelReason,
    createdByName: deliveryOrder.creator?.name ?? "—",
    createdAt: deliveryOrder.createdAt,
    qtyMt: qty(doQty).toFixed(3),
    dispatchedMt: qty(dispatched).toFixed(3),
    remainingMt: qty(doQty.minus(dispatched)).toFixed(3),
    items: deliveryOrder.items.map((item) => {
      // What the order can still allocate to this line, including this DO's own
      // quantity (used by the "edit quantities" dialog).
      const orderItem = deliveryOrder.order.items.find((row) => row.id === item.orderItemId);
      const allocatable = orderItem
        ? qty(dec(orderItem.qtyMt).minus(dec(orderItem.doAllocatedMt)).plus(dec(item.qtyMt))).toFixed(3)
        : item.qtyMt.toFixed(3);
      return {
        id: item.id,
        orderItemId: item.orderItemId,
        productCode: item.productCode,
        productName: item.product.name,
        qtyMt: item.qtyMt.toFixed(3),
        dispatchedMt: item.dispatchedMt.toFixed(3),
        remainingMt: qty(dec(item.qtyMt).minus(dec(item.dispatchedMt))).toFixed(3),
        allocatableMt: allocatable,
      };
    }),
  };
}

export type DoRow = ReturnType<typeof toDoRow>;

const DO_INCLUDE = {
  items: { include: { product: true } },
  warehouse: true,
  order: { include: { customer: true, items: { include: { product: true } } } },
  creator: { select: { name: true } },
} satisfies Prisma.DeliveryOrderInclude;

const DO_DETAIL_INCLUDE = {
  ...DO_INCLUDE,
  dispatches: {
    orderBy: { dispatchDate: "asc" },
    include: { recorder: { select: { name: true } }, items: true },
  },
} satisfies Prisma.DeliveryOrderInclude;

// ---------------------------------------------------------------------------
// 6.3 Create DO
// ---------------------------------------------------------------------------

export async function createDeliveryOrder(input: CreateDoInput, user: ServiceActor, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, customer: true },
    });
    if (!order) throw errors.notFound("Order");

    if (order.status !== "APPROVED" && order.status !== "PARTIALLY_DELIVERED") {
      throw errors.validation(
        `A delivery order can only be created for an approved order. ${order.orderNo} is ${ORDER_LABEL(order.status)}.`,
      );
    }

    const warehouse = await tx.warehouse.findUnique({ where: { code: input.warehouseCode } });
    if (!warehouse) throw errors.notFound("Warehouse");
    if (!warehouse.isActive) throw errors.validation(`Warehouse ${warehouse.name} is inactive.`);

    // 1. Rule 3 — takes the customer lock and validates the queue.
    const priority = await assertCustomerPriority(tx, {
      customerId: order.customerId,
      orderId: order.id,
      priorityOverride: input.priorityOverride,
      overrideReason: input.overrideReason,
    });

    // 2. Serialise on the order row so two concurrent DO creations cannot
    //    allocate the same remaining quantity twice.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
    const freshItems = await tx.orderItem.findMany({ where: { orderId: order.id } });
    const itemsById = new Map(freshItems.map((item) => [item.id, item]));

    const seen = new Set<string>();
    for (const line of input.items) {
      if (seen.has(line.orderItemId)) {
        throw errors.validation("The same order line was selected twice in one delivery order.");
      }
      seen.add(line.orderItemId);
    }

    // 3. Validate allocation against the *remaining allocatable* quantity.
    const prepared = input.items
      .map((line) => {
        const item = itemsById.get(line.orderItemId);
        if (!item) throw errors.notFound("Order line");
        return { item, requested: qty(line.qtyMt) };
      })
      .sort((a, b) => a.item.productCode.localeCompare(b.item.productCode)); // lock order

    for (const { item, requested } of prepared) {
      const allocatable = dec(item.qtyMt).minus(dec(item.doAllocatedMt));
      if (requested.gt(allocatable)) {
        throw errors.overAllocation(
          `Order ${order.orderNo} line ${item.productCode}: only ${allocatable.toFixed(3)} MT is left to allocate (requested ${requested.toFixed(3)} MT).`,
        );
      }
    }

    // 4. Create the DO header and lines, then reserve the stock against the DO
    //    itself so every ledger row is traceable to a delivery order.
    const doNo = await nextDeliveryOrderNo(tx, order.orderNo);

    const created = await tx.deliveryOrder.create({
      data: {
        doNo,
        orderId: order.id,
        warehouseId: warehouse.code,
        status: "CREATED",
        priorityOverride: Boolean(input.priorityOverride),
        overrideReason: input.priorityOverride ? (input.overrideReason ?? null) : null,
        note: input.note ?? null,
        createdBy: user.id,
        items: {
          create: prepared.map(({ item, requested }) => ({
            orderItemId: item.id,
            productCode: item.productCode,
            qtyMt: requested.toFixed(3),
            createdBy: user.id,
          })),
        },
      },
      include: DO_INCLUDE,
    });

    // 5. Stock check + reservation (locks stock_balances FOR UPDATE).
    for (const { item, requested } of prepared) {
      await reserveStock(tx, {
        warehouseCode: warehouse.code,
        productCode: item.productCode,
        qtyMt: requested,
        refType: "delivery_order",
        refId: created.id,
        note: `Reserved for ${doNo} (${order.orderNo})`,
        userId: user.id,
        userName: user.name,
        ip,
        auditAction: "CREATE",
      });
    }

    for (const { item, requested } of prepared) {
      await tx.orderItem.update({
        where: { id: item.id },
        data: { doAllocatedMt: dec(item.doAllocatedMt).plus(requested).toFixed(3) },
      });
    }

    await writeAudit(
      {
        ...actor(user, ip),
        action: input.priorityOverride ? "OVERRIDE" : "CREATE",
        entity: "delivery_order",
        entityId: created.id,
        newValue: {
          doNo,
          orderNo: order.orderNo,
          customer: order.customerId,
          warehouse: warehouse.code,
          items: prepared.map(({ item, requested }) => ({
            product: item.productCode,
            qtyMt: requested.toFixed(3),
          })),
          ...(input.priorityOverride
            ? {
                priorityOverride: true,
                overrideReason: input.overrideReason ?? null,
                blockedBy: priority.blockingOrderNo,
                blockedByRemainingMt: priority.blockingRemainingMt,
              }
            : {}),
        },
      },
      tx,
    );

    return { deliveryOrder: toDoRow(created), priority };
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type DoListFilter = {
  q?: string;
  status?: DeliveryOrderStatus | "OPEN" | "ALL";
  warehouseCode?: string;
  orderId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export async function listDeliveryOrders(filter: DoListFilter, user: ServiceActor) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, filter.pageSize ?? 20));
  const status = filter.status && filter.status !== "ALL" ? filter.status : undefined;

  // Rule 6 — a warehouse user only ever sees its own warehouse.
  const scopedWarehouse =
    user.role === "WAREHOUSE" ? (user.warehouseCode ?? "__none__") : filter.warehouseCode;

  const where: Prisma.DeliveryOrderWhereInput = {
    ...(scopedWarehouse ? { warehouseId: scopedWarehouse } : {}),
    ...(filter.orderId ? { orderId: filter.orderId } : {}),
    ...(status === "OPEN"
      ? { status: { in: ["CREATED", "PARTIALLY_DISPATCHED"] } }
      : status
        ? { status }
        : {}),
    ...(filter.from || filter.to
      ? {
          createdAt: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
    ...(filter.q
      ? {
          OR: [
            { doNo: { contains: filter.q, mode: "insensitive" } },
            { order: { orderNo: { contains: filter.q, mode: "insensitive" } } },
            { order: { customer: { name: { contains: filter.q, mode: "insensitive" } } } },
            { dispatches: { some: { challanNo: { contains: filter.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.deliveryOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: DO_INCLUDE,
    }),
    prisma.deliveryOrder.count({ where }),
  ]);

  return {
    rows: rows.map(toDoRow),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getDeliveryOrder(id: string, user: ServiceActor) {
  const deliveryOrder = await prisma.deliveryOrder.findUnique({
    where: { id },
    include: DO_DETAIL_INCLUDE,
  });
  if (!deliveryOrder) throw errors.notFound("Delivery order");

  if (user.role === "WAREHOUSE" && deliveryOrder.warehouseId !== user.warehouseCode) {
    throw errors.forbidden("viewing another warehouse's delivery order");
  }

  const dispatches = await prisma.dispatch.findMany({
    where: { doId: id },
    orderBy: { dispatchDate: "asc" },
    include: {
      recorder: { select: { name: true } },
      items: { include: { deliveryOrderItem: { include: { product: true } } } },
    },
  });

  return {
    ...toDoRow(deliveryOrder),
    warehouseLocation: deliveryOrder.warehouse.location,
    dispatches: dispatches.map((dispatch) => ({
      id: dispatch.id,
      challanNo: dispatch.challanNo,
      truckNo: dispatch.truckNo,
      driverName: dispatch.driverName,
      driverPhone: dispatch.driverPhone,
      loadingDate: dispatch.loadingDate,
      dispatchDate: dispatch.dispatchDate,
      remarks: dispatch.remarks,
      recordedByName: dispatch.recorder.name,
      qtyMt: dispatch.items.reduce((acc, item) => acc.plus(dec(item.qtyMt)), dec(0)).toFixed(3),
      items: dispatch.items.map((item) => ({
        productCode: item.deliveryOrderItem.productCode,
        productName: item.deliveryOrderItem.product.name,
        qtyMt: item.qtyMt.toFixed(3),
      })),
    })),
  };
}

export type DoDetail = Awaited<ReturnType<typeof getDeliveryOrder>>;

/** Open DOs for the warehouse dashboard, oldest first. */
export async function openDeliveryOrders(warehouseCode?: string) {
  const rows = await prisma.deliveryOrder.findMany({
    where: {
      status: { in: ["CREATED", "PARTIALLY_DISPATCHED"] },
      ...(warehouseCode ? { warehouseId: warehouseCode } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: DO_INCLUDE,
  });
  return rows.map(toDoRow);
}

// ---------------------------------------------------------------------------
// Rule 5 — cancellation releases the reservation
// ---------------------------------------------------------------------------

export async function cancelDeliveryOrder(
  input: { doId: string; reason: string },
  user: ServiceActor,
  ip?: string,
) {
  return prisma.$transaction(async (tx) => {
    const deliveryOrder = await tx.deliveryOrder.findUnique({
      where: { id: input.doId },
      include: { items: true, order: true },
    });
    if (!deliveryOrder) throw errors.notFound("Delivery order");
    assertDoTransition(deliveryOrder.status, "CANCELLED");

    if (deliveryOrder.status !== "CREATED") {
      throw errors.conflict(
        `Delivery order ${deliveryOrder.doNo} already has dispatched quantity and cannot be cancelled.`,
      );
    }

    // Lock the customer so the queue cannot change under us while releasing.
    await tx.$queryRaw`SELECT code FROM customers WHERE code = ${deliveryOrder.order.customerId} FOR UPDATE`;

    for (const item of deliveryOrder.items) {
      await reserveStock(tx, {
        warehouseCode: deliveryOrder.warehouseId,
        productCode: item.productCode,
        qtyMt: dec(item.qtyMt).negated(),
        refType: "delivery_order",
        refId: deliveryOrder.id,
        note: `Released — ${deliveryOrder.doNo} cancelled`,
        userId: user.id,
        userName: user.name,
        ip,
        auditAction: "CANCEL",
      });

      const orderItem = await tx.orderItem.findUnique({ where: { id: item.orderItemId } });
      if (orderItem) {
        await tx.orderItem.update({
          where: { id: orderItem.id },
          data: {
            doAllocatedMt: qty(
              dec(orderItem.doAllocatedMt).minus(dec(item.qtyMt)),
            ).toFixed(3),
          },
        });
      }
    }

    const updated = await tx.deliveryOrder.update({
      where: { id: deliveryOrder.id },
      data: {
        status: "CANCELLED",
        cancelledBy: user.id,
        cancelledAt: new Date(),
        cancelReason: input.reason,
      },
      include: DO_INCLUDE,
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "CANCEL",
        entity: "delivery_order",
        entityId: deliveryOrder.id,
        oldValue: { status: deliveryOrder.status },
        newValue: {
          status: "CANCELLED",
          reason: input.reason,
          releasedItems: deliveryOrder.items.map((item) => ({
            product: item.productCode,
            qtyMt: item.qtyMt.toFixed(3),
          })),
        },
      },
      tx,
    );

    return toDoRow(updated);
  }, TX_OPTIONS);
}

/**
 * Sales Operations corrects the quantities of a delivery order **before anything
 * has been dispatched**. The warehouse can never do this - it only records the
 * vehicle / challan and dispatches the quantity Sales Ops decided.
 *
 * The reservation in the warehouse is adjusted atomically: the old reservation
 * is released and the new one is taken (which re-checks availability), the
 * order's allocation counter is updated and the change is audited.
 */
export type EditDoInput = {
  doId: string;
  reason: string;
  items: { doItemId: string; qtyMt: string }[];
};

export async function editDeliveryOrderQuantity(
  input: EditDoInput,
  user: ServiceActor,
  ip?: string,
) {
  return prisma.$transaction(async (tx) => {
    const deliveryOrder = await tx.deliveryOrder.findUnique({
      where: { id: input.doId },
      include: { items: true, order: { include: { items: true, customer: true } } },
    });
    if (!deliveryOrder) throw errors.notFound("Delivery order");
    if (deliveryOrder.status !== "CREATED") {
      throw errors.conflict(
        `The quantities of ${deliveryOrder.doNo} can only be changed while nothing has been dispatched (status is ${DO_STATUS_LABELS[deliveryOrder.status]}).`,
      );
    }

    // Serialise with dispatch / cancellation for this customer and order.
    await tx.$queryRaw`SELECT code FROM customers WHERE code = ${deliveryOrder.order.customerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${deliveryOrder.orderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM delivery_orders WHERE id = ${deliveryOrder.id} FOR UPDATE`;

    const doItemsAfterLock = await tx.deliveryOrderItem.findMany({
      where: { doId: deliveryOrder.id },
    });
    const doById = new Map(doItemsAfterLock.map((item) => [item.id, item]));
    const orderItems = await tx.orderItem.findMany({ where: { orderId: deliveryOrder.orderId } });
    const orderItemById = new Map(orderItems.map((item) => [item.id, item]));

    const seen = new Set<string>();
    const changes: { doItem: (typeof doItemsAfterLock)[number]; newQty: string }[] = [];

    for (const line of input.items) {
      if (seen.has(line.doItemId)) {
        throw errors.validation("The same delivery order line was sent twice.");
      }
      seen.add(line.doItemId);
      const doItem = doById.get(line.doItemId);
      if (!doItem) throw errors.notFound("Delivery order line");

      const newQty = qty(line.qtyMt);
      if (!newQty.gt(0)) throw errors.validation("Quantity must be greater than zero.");
      if (newQty.equals(dec(doItem.qtyMt))) continue;

      const orderItem = orderItemById.get(doItem.orderItemId);
      if (!orderItem) throw errors.notFound("Order line");

      // What the order can still allocate once this DO's own allocation is freed.
      const allocatable = dec(orderItem.qtyMt)
        .minus(dec(orderItem.doAllocatedMt))
        .plus(dec(doItem.qtyMt));
      if (newQty.gt(allocatable)) {
        throw errors.overAllocation(
          `Order ${deliveryOrder.order.orderNo} line ${doItem.productCode}: only ${allocatable.toFixed(3)} MT can be allocated to this delivery order (requested ${newQty.toFixed(3)} MT).`,
        );
      }

      changes.push({ doItem, newQty: newQty.toFixed(3) });
    }

    if (changes.length === 0) {
      throw errors.validation("Nothing was changed, so the delivery order was left untouched.");
    }

    for (const { doItem, newQty } of changes) {
      // Release the current reservation, then take the new one (re-checks stock).
      await reserveStock(tx, {
        warehouseCode: deliveryOrder.warehouseId,
        productCode: doItem.productCode,
        qtyMt: dec(doItem.qtyMt).negated(),
        refType: "delivery_order",
        refId: deliveryOrder.id,
        note: `Quantity corrected on ${deliveryOrder.doNo}`,
        userId: user.id,
        userName: user.name,
        ip,
        auditAction: "UPDATE",
      });
      await reserveStock(tx, {
        warehouseCode: deliveryOrder.warehouseId,
        productCode: doItem.productCode,
        qtyMt: newQty,
        refType: "delivery_order",
        refId: deliveryOrder.id,
        note: `Quantity corrected on ${deliveryOrder.doNo}`,
        userId: user.id,
        userName: user.name,
        ip,
        auditAction: "UPDATE",
      });

      await tx.deliveryOrderItem.update({
        where: { id: doItem.id },
        data: { qtyMt: newQty },
      });

      const orderItem = await tx.orderItem.findUniqueOrThrow({ where: { id: doItem.orderItemId } });
      await tx.orderItem.update({
        where: { id: orderItem.id },
        data: {
          doAllocatedMt: qty(dec(orderItem.doAllocatedMt).minus(dec(doItem.qtyMt)).plus(newQty)).toFixed(3),
        },
      });
    }

    const updated = await tx.deliveryOrder.findUniqueOrThrow({
      where: { id: deliveryOrder.id },
      include: DO_INCLUDE,
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "UPDATE",
        entity: "delivery_order",
        entityId: deliveryOrder.id,
        oldValue: {
          items: doItemsAfterLock.map((item) => ({
            product: item.productCode,
            qtyMt: item.qtyMt.toFixed(3),
          })),
        },
        newValue: {
          doNo: deliveryOrder.doNo,
          orderNo: deliveryOrder.order.orderNo,
          reason: input.reason,
          items: doItemsAfterLock.map((item) => ({
            product: item.productCode,
            qtyMt: changes.find((change) => change.doItem.id === item.id)?.newQty ?? item.qtyMt.toFixed(3),
          })),
        },
      },
      tx,
    );

    return toDoRow(updated);
  }, TX_OPTIONS);
}

function ORDER_LABEL(status: string): string {
  return status.replace(/_/g, " ").toLowerCase();
}

/** Priority override report rows (spec Section 7.7). */
export async function priorityOverrideReport(from: Date, to: Date) {
  const rows = await prisma.deliveryOrder.findMany({
    where: { priorityOverride: true, createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: "desc" },
    include: { order: { include: { customer: true } }, warehouse: true, creator: { select: { name: true } } },
  });
  return rows.map((row) => ({
    doNo: row.doNo,
    createdAt: row.createdAt,
    orderNo: row.order.orderNo,
    customerName: row.order.customer.name,
    warehouseName: row.warehouse.name,
    reason: row.overrideReason ?? "",
    grantedBy: row.creator?.name ?? "—",
    status: row.status,
  }));
}
