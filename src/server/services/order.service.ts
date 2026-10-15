import { type OrderStatus, type Prisma } from "@prisma/client";
import prisma, { type Tx } from "@/lib/prisma";
import { dec, money, qty } from "@/lib/decimal";
import { errors } from "@/lib/errors";
import { actor, writeAudit } from "@/lib/audit";
import { zonedToUtc } from "@/lib/dates";
import { nextDocNo } from "@/lib/numbering";
import { assertOrderTransition, ORDER_STATUS_LABELS } from "@/lib/state-machines";
import { getSettings, SETTING_KEYS } from "@/lib/settings";
import { findCurrentRate } from "@/server/services/rate.service";
import { lockCustomer, remainingMtForOrder } from "@/server/services/priority.service";
import { reserveStock } from "@/server/services/stock.service";

export type ServiceActor = { id: string; name: string; role: string; warehouseCode?: string | null };
const TX_OPTIONS = { timeout: 30_000, maxWait: 30_000 };

type OrderWithItems = Prisma.OrderGetPayload<{
  include: {
    items: { include: { product: true } };
    customer: true;
  };
}>;

/** Remaining / delivered roll-up over all lines of an order (Rule 4). */
export function orderProgress(items: { qtyMt: unknown; deliveredMt: unknown; doAllocatedMt?: unknown }[]) {
  let ordered = dec(0);
  let delivered = dec(0);
  let allocated = dec(0);
  for (const item of items) {
    ordered = ordered.plus(dec(item.qtyMt as never));
    delivered = delivered.plus(dec(item.deliveredMt as never));
    allocated = allocated.plus(dec((item.doAllocatedMt ?? 0) as never));
  }
  const remaining = ordered.minus(delivered);
  return {
    orderedMt: ordered.toFixed(3),
    deliveredMt: delivered.toFixed(3),
    allocatedMt: allocated.toFixed(3),
    remainingMt: qty(remaining).toFixed(3),
    progressPct: ordered.isZero() ? 0 : Number(delivered.div(ordered).mul(100).toFixed(1)),
    isComplete: !remaining.gt(0),
  };
}

export function toOrderRow(order: OrderWithItems, extra: { totalDeliveredValue?: string } = {}) {
  const progress = orderProgress(order.items);
  return {
    id: order.id,
    orderNo: order.orderNo,
    customerCode: order.customerId,
    customerName: order.customer.name,
    orderSeq: order.orderSeq,
    orderDate: order.orderDate,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status as OrderStatus],
    totalValue: order.totalValue.toFixed(2),
    deliveredValue: extra.totalDeliveredValue ?? null,
    remarks: order.remarks,
    rejectionReason: order.rejectionReason,
    shortCloseReason: order.shortCloseReason,
    cancelReason: order.cancelReason,
    ...progress,
    items: order.items.map((item) => ({
      id: item.id,
      productCode: item.productCode,
      productName: item.product.name,
      qtyMt: item.qtyMt.toFixed(3),
      deliveredMt: item.deliveredMt.toFixed(3),
      doAllocatedMt: item.doAllocatedMt.toFixed(3),
      remainingMt: qty(dec(item.qtyMt).minus(dec(item.deliveredMt))).toFixed(3),
      lockedRatePerMt: item.lockedRatePerMt.toFixed(2),
      lineValue: item.lineValue.toFixed(2),
      rateOverridden: item.rateOverridden,
    })),
  };
}

export type OrderRow = ReturnType<typeof toOrderRow>;

// ---------------------------------------------------------------------------
// 6.1 Create order
// ---------------------------------------------------------------------------

export type CreateOrderInput = {
  customerCode: string;
  orderDate?: string;
  remarks?: string;
  items: { productCode: string; qtyMt: string }[];
};

export async function createOrder(input: CreateOrderInput, user: ServiceActor, ip?: string) {
  const at = input.orderDate ? zonedToUtc(input.orderDate) : new Date();

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { code: input.customerCode } });
    if (!customer) throw errors.notFound("Customer");
    if (!customer.isActive) {
      throw errors.validation(`Customer ${customer.name} is inactive and cannot place new orders.`);
    }

    // Lock the customer row: serialises order_seq allocation and every later
    // delivery action for this customer (Rule 3).
    await lockCustomer(tx, customer.code);

    // Duplicate product lines are rejected so quantities can never be split
    // across two rows of the same order in a confusing way.
    const seen = new Set<string>();
    for (const line of input.items) {
      if (seen.has(line.productCode)) {
        throw errors.validation(
          `Product ${line.productCode} appears twice in the order. Combine the quantities into one line.`,
        );
      }
      seen.add(line.productCode);
    }

    const prepared: {
      productCode: string;
      qtyMt: string;
      rateId: string;
      lockedRatePerMt: string;
      lineValue: string;
    }[] = [];

    for (const line of input.items) {
      const product = await tx.product.findUnique({ where: { code: line.productCode } });
      if (!product) throw errors.notFound(`Product ${line.productCode}`);
      if (!product.isActive) {
        throw errors.validation(`Product ${product.name} is inactive and cannot be ordered.`);
      }

      // Rule 1: the rate must exist *at order time* and is copied + locked here.
      const rate = await findCurrentRate(tx, line.productCode, at);
      if (!rate) throw errors.rateMissing(product.name);

      const quantity = qty(line.qtyMt);
      prepared.push({
        productCode: line.productCode,
        qtyMt: quantity.toFixed(3),
        rateId: rate.id,
        lockedRatePerMt: rate.ratePerMt.toFixed(2),
        lineValue: money(quantity.mul(dec(rate.ratePerMt))).toFixed(2),
      });
    }

    const totalValue = prepared
      .reduce((acc, line) => acc.plus(dec(line.lineValue)), dec(0))
      .toFixed(2);

    const maxSeq = await tx.order.aggregate({
      where: { customerId: customer.code },
      _max: { orderSeq: true },
    });
    const orderSeq = (maxSeq._max.orderSeq ?? 0) + 1;

    const orderNo = await nextDocNo("order", tx, at);

    const order = await tx.order.create({
      data: {
        orderNo,
        customerId: customer.code,
        orderSeq,
        orderDate: at,
        status: "PENDING_APPROVAL",
        totalValue,
        remarks: input.remarks ?? null,
        createdBy: user.id,
        items: {
          create: prepared.map((line) => ({
            productCode: line.productCode,
            qtyMt: line.qtyMt,
            lockedRatePerMt: line.lockedRatePerMt,
            rateId: line.rateId,
            lineValue: line.lineValue,
            createdBy: user.id,
          })),
        },
      },
      include: { items: { include: { product: true } }, customer: true },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "CREATE",
        entity: "order",
        entityId: order.id,
        newValue: {
          orderNo,
          customer: customer.code,
          orderSeq,
          totalValue,
          items: prepared,
        },
      },
      tx,
    );

    return toOrderRow(order);
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type OrderListFilter = {
  q?: string;
  status?: OrderStatus | "OPEN" | "ALL";
  customerCode?: string;
  salespersonId?: string;
  warehouseCode?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  sort?: "orderDate" | "orderNo" | "totalValue" | "customer";
  dir?: "asc" | "desc";
};

export async function listOrders(filter: OrderListFilter, user: ServiceActor) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, filter.pageSize ?? 20));
  const status = filter.status && filter.status !== "ALL" ? filter.status : undefined;

  const where: Prisma.OrderWhereInput = {
    ...(user.role === "SALES" ? { createdBy: user.id } : {}),
    ...(filter.salespersonId && user.role !== "SALES" ? { createdBy: filter.salespersonId } : {}),
    ...(filter.customerCode ? { customerId: filter.customerCode } : {}),
    ...(status === "OPEN"
      ? { status: { in: ["APPROVED", "PARTIALLY_DELIVERED"] } }
      : status
        ? { status }
        : {}),
    ...(filter.from || filter.to
      ? {
          orderDate: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
    ...(filter.warehouseCode
      ? { deliveryOrders: { some: { warehouseId: filter.warehouseCode } } }
      : {}),
    ...(filter.q
      ? {
          OR: [
            { orderNo: { contains: filter.q, mode: "insensitive" } },
            { customer: { name: { contains: filter.q, mode: "insensitive" } } },
            { customer: { code: { contains: filter.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const sortField: Prisma.OrderOrderByWithRelationInput =
    filter.sort === "orderNo"
      ? { orderNo: filter.dir ?? "desc" }
      : filter.sort === "totalValue"
        ? { totalValue: filter.dir ?? "desc" }
        : filter.sort === "customer"
          ? { customer: { name: filter.dir ?? "asc" } }
          : { orderDate: filter.dir ?? "desc" };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [sortField],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        items: { include: { product: true } },
        customer: true,
      },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    rows: rows.map((row) => toOrderRow(row)),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getOrderDetail(orderId: string, user: ServiceActor) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: true, rate: true } },
      customer: true,
      creator: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true } },
      deliveryOrders: {
        include: {
          warehouse: true,
          items: { include: { product: true } },
          dispatches: {
            include: { recorder: { select: { name: true } }, items: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!order) throw errors.notFound("Order");

  if (user.role === "SALES" && order.createdBy !== user.id) {
    throw errors.forbidden("viewing another salesperson's order");
  }

  const doIds = order.deliveryOrders.map((d) => d.id);
  const dispatchIds = order.deliveryOrders.flatMap((d) => d.dispatches.map((s) => s.id));

  const timeline = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entity: "order", entityId: orderId },
        ...(doIds.length ? [{ entity: "delivery_order" as const, entityId: { in: doIds } }] : []),
        ...(dispatchIds.length ? [{ entity: "dispatch" as const, entityId: { in: dispatchIds } }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const row = toOrderRow(order);
  const deliveredValue = order.items
    .reduce((acc, item) => acc.plus(dec(item.deliveredMt).mul(dec(item.lockedRatePerMt))), dec(0))
    .toFixed(2);

  return {
    ...row,
    deliveredValue,
    customer: {
      code: order.customer.code,
      name: order.customer.name,
      phone: order.customer.phone,
      address: order.customer.address,
      creditLimit: order.customer.creditLimit?.toFixed(2) ?? null,
      isActive: order.customer.isActive,
    },
    createdByName: order.creator?.name ?? "—",
    approvedByName: order.approver?.name ?? null,
    approvedAt: order.approvedAt,
    approvedAtLabel: order.approvedAt ? order.approvedAt.toISOString() : null,
    deliveryOrders: order.deliveryOrders.map((deliveryOrder) => ({
      id: deliveryOrder.id,
      doNo: deliveryOrder.doNo,
      status: deliveryOrder.status,
      warehouseCode: deliveryOrder.warehouseId,
      warehouseName: deliveryOrder.warehouse.name,
      priorityOverride: deliveryOrder.priorityOverride,
      overrideReason: deliveryOrder.overrideReason,
      note: deliveryOrder.note,
      createdAt: deliveryOrder.createdAt,
      items: deliveryOrder.items.map((item) => ({
        id: item.id,
        productCode: item.productCode,
        productName: item.product.name,
        qtyMt: item.qtyMt.toFixed(3),
        dispatchedMt: item.dispatchedMt.toFixed(3),
      })),
      dispatches: deliveryOrder.dispatches.map((dispatch) => ({
        id: dispatch.id,
        challanNo: dispatch.challanNo,
        truckNo: dispatch.truckNo,
        driverName: dispatch.driverName,
        driverPhone: dispatch.driverPhone,
        dispatchDate: dispatch.dispatchDate,
        recordedBy: dispatch.recorder.name,
        qtyMt: dispatch.items.reduce((acc, i) => acc.plus(dec(i.qtyMt)), dec(0)).toFixed(3),
      })),
    })),
    timeline: timeline.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entity: entry.entity,
      userName: entry.userName ?? "system",
      createdAt: entry.createdAt,
      newValue: entry.newValue,
      oldValue: entry.oldValue,
    })),
  };
}

export type OrderDetail = Awaited<ReturnType<typeof getOrderDetail>>;

// ---------------------------------------------------------------------------
// Rule 2 — approve / reject
// ---------------------------------------------------------------------------

export type ApprovalCheck = {
  key: "rateValidity" | "customerActive" | "creditLimit" | "quantity";
  label: string;
  ok: boolean;
  blocking: boolean;
  detail: string;
};

/**
 * Runs the approval checks shown on the Sales Ops screen (Rule 2):
 * rate validity at order time, quantity sanity, customer active status and the
 * credit limit (a warning that Sales Ops can override with a reason).
 */
export async function runApprovalChecks(
  orderId: string,
  tx: Tx | typeof prisma = prisma,
): Promise<{ checks: ApprovalCheck[]; requiresOverride: boolean }> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { rate: true, product: true } }, customer: true },
  });
  if (!order) throw errors.notFound("Order");

  const checks: ApprovalCheck[] = [];

  // 1. Rate validity at order time.
  let rateOk = true;
  let rateDetail = "Every line has a rate that was effective when the order was created.";
  for (const item of order.items) {
    const rate = await findCurrentRate(tx, item.productCode, order.orderDate);
    if (!rate || rate.id !== item.rateId) {
      rateOk = false;
      rateDetail = item.rateOverridden
        ? `Line ${item.product.name} was manually overridden by Sales Operations (reason recorded).`
        : `No published rate for ${item.product.name} at the order date.`;
      break;
    }
  }
  checks.push({
    key: "rateValidity",
    label: "Rate valid at order time",
    ok: rateOk,
    blocking: true,
    detail: rateDetail,
  });

  // 2. Quantity sanity.
  const qtyOk = order.items.every((item) => dec(item.qtyMt).gt(0));
  checks.push({
    key: "quantity",
    label: "Quantities",
    ok: qtyOk,
    blocking: true,
    detail: qtyOk
      ? `${order.items.length} line(s), ${orderProgress(order.items).orderedMt} MT total.`
      : "One or more lines has a zero or negative quantity.",
  });

  // 3. Customer active.
  checks.push({
    key: "customerActive",
    label: "Customer active",
    ok: order.customer.isActive,
    blocking: true,
    detail: order.customer.isActive
      ? `Customer ${order.customer.name} is active.`
      : `Customer ${order.customer.name} is inactive — the order cannot be approved.`,
  });

  // 4. Credit limit (warning with override).
  const settings = await getSettings(tx);
  const creditCheckOn = settings[SETTING_KEYS.creditCheckEnabled] === "true";
  const limit = order.customer.creditLimit;
  let creditOk = true;
  let creditDetail = "No credit limit configured for this customer.";
  let exposure: string | null = null;

  if (creditCheckOn && limit) {
    const openOrders = await tx.order.findMany({
      where: {
        customerId: order.customerId,
        status: { in: ["APPROVED", "PARTIALLY_DELIVERED"] },
      },
      include: { items: { select: { qtyMt: true, deliveredMt: true, lockedRatePerMt: true } } },
    });
    let outstanding = dec(0);
    for (const open of openOrders) {
      for (const item of open.items) {
        const remaining = dec(item.qtyMt).minus(dec(item.deliveredMt));
        outstanding = outstanding.plus(remaining.mul(dec(item.lockedRatePerMt)));
      }
    }
    outstanding = outstanding.plus(dec(order.totalValue));
    exposure = money(outstanding).toFixed(2);
    creditOk = outstanding.lte(dec(limit));
    creditDetail = creditOk
      ? `Exposure ৳${exposure} is within the ৳${limit.toFixed(2)} credit limit.`
      : `Credit limit exceeded: exposure ৳${exposure} vs limit ৳${limit.toFixed(2)}. Sales Operations may override with a written reason.`;
  }

  checks.push({
    key: "creditLimit",
    label: "Credit limit",
    ok: creditOk,
    blocking: false,
    detail: creditDetail,
  });

  const requiresOverride = checks.some((c) => !c.ok && !c.blocking);
  return { checks, requiresOverride };
}

export async function approveOrder(
  input: { orderId: string; creditOverride?: boolean; overrideReason?: string },
  user: ServiceActor,
  ip?: string,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, customer: true },
    });
    if (!order) throw errors.notFound("Order");
    assertOrderTransition(order.status, "APPROVED");

    const { checks, requiresOverride } = await runApprovalChecks(order.id, tx);
    const blocking = checks.filter((c) => !c.ok && c.blocking);
    if (blocking.length > 0) {
      throw errors.validation(blocking.map((c) => c.detail).join(" "));
    }

    if (requiresOverride) {
      if (!input.creditOverride) {
        const detail = checks.find((c) => !c.ok)?.detail ?? "";
        throw errors.creditLimit(`${detail} Confirm the override with a reason to continue.`);
      }
      if (!input.overrideReason || input.overrideReason.trim().length < 3) {
        throw errors.validation("A written reason is mandatory when overriding the credit limit.");
      }
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "APPROVED",
        approvedBy: user.id,
        approvedAt: new Date(),
      },
      include: { items: { include: { product: true } }, customer: true },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "APPROVE",
        entity: "order",
        entityId: order.id,
        oldValue: { status: order.status },
        newValue: {
          status: "APPROVED",
          checks: checks.map((c) => ({ key: c.key, ok: c.ok, detail: c.detail })),
          ...(requiresOverride
            ? { creditOverride: true, overrideReason: input.overrideReason ?? null }
            : {}),
        },
      },
      tx,
    );

    return { order: toOrderRow(updated), checks };
  }, TX_OPTIONS);
}

export async function rejectOrder(
  input: { orderId: string; reason: string },
  user: ServiceActor,
  ip?: string,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw errors.notFound("Order");
    assertOrderTransition(order.status, "REJECTED");

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: "REJECTED", rejectionReason: input.reason },
      include: { items: { include: { product: true } }, customer: true },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "REJECT",
        entity: "order",
        entityId: order.id,
        oldValue: { status: order.status },
        newValue: { status: "REJECTED", reason: input.reason },
      },
      tx,
    );
    return toOrderRow(updated);
  }, TX_OPTIONS);
}

/**
 * Cancels an order. Only possible while nothing has been delivered; any open
 * (CREATED) delivery orders are cancelled and their reservations released.
 */
export async function cancelOrder(
  input: { orderId: string; reason: string },
  user: ServiceActor,
  ip?: string,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, deliveryOrders: { include: { items: true } } },
    });
    if (!order) throw errors.notFound("Order");
    assertOrderTransition(order.status, "CANCELLED");

    const deliveredTotal = order.items.reduce((acc, i) => acc.plus(dec(i.deliveredMt)), dec(0));
    if (deliveredTotal.gt(0)) {
      throw errors.conflict(
        `Order ${order.orderNo} already has delivered quantity and cannot be cancelled. Use short close instead.`,
      );
    }
    const dispatched = order.deliveryOrders.some((d) =>
      d.items.some((i) => dec(i.dispatchedMt).gt(0)),
    );
    if (dispatched) {
      throw errors.conflict(
        `Order ${order.orderNo} has dispatched deliveries and cannot be cancelled. Use short close instead.`,
      );
    }

    // Release reservations of open DOs and cancel them.
    const openDos = order.deliveryOrders.filter((d) => d.status === "CREATED");
    for (const deliveryOrder of openDos) {
      for (const item of deliveryOrder.items) {
        await reserveStock(tx, {
          warehouseCode: deliveryOrder.warehouseId,
          productCode: item.productCode,
          qtyMt: dec(item.qtyMt).negated(),
          refType: "delivery_order",
          refId: deliveryOrder.id,
          note: `Released — order ${order.orderNo} cancelled`,
          userId: user.id,
          userName: user.name,
          auditAction: "CANCEL",
        });
      }
      await tx.deliveryOrderItem.updateMany({
        where: { doId: deliveryOrder.id },
        data: { dispatchedMt: "0" },
      });
      await tx.deliveryOrder.update({
        where: { id: deliveryOrder.id },
        data: {
          status: "CANCELLED",
          cancelledBy: user.id,
          cancelledAt: new Date(),
          cancelReason: `Order cancelled: ${input.reason}`,
        },
      });
    }
    await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { doAllocatedMt: "0" } });

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        cancelledBy: user.id,
        cancelledAt: new Date(),
        cancelReason: input.reason,
      },
      include: { items: { include: { product: true } }, customer: true },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "CANCEL",
        entity: "order",
        entityId: order.id,
        oldValue: { status: order.status },
        newValue: {
          status: "CANCELLED",
          reason: input.reason,
          cancelledDeliveryOrders: openDos.map((d) => d.doNo),
        },
      },
      tx,
    );
    return toOrderRow(updated);
  }, TX_OPTIONS);
}

/**
 * Short close: Sales Ops closes the order with a reason while quantity is still
 * outstanding. This also unblocks the customer's queue (Rule 4 / Section 5).
 */
export async function shortCloseOrder(
  input: { orderId: string; reason: string },
  user: ServiceActor,
  ip?: string,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, deliveryOrders: { include: { items: true } } },
    });
    if (!order) throw errors.notFound("Order");
    assertOrderTransition(order.status, "SHORT_CLOSED");

    const openDos = order.deliveryOrders.filter((d) => d.status === "CREATED");
    for (const deliveryOrder of openDos) {
      for (const item of deliveryOrder.items) {
        await reserveStock(tx, {
          warehouseCode: deliveryOrder.warehouseId,
          productCode: item.productCode,
          qtyMt: dec(item.qtyMt).negated(),
          refType: "delivery_order",
          refId: deliveryOrder.id,
          note: `Released — order ${order.orderNo} short closed`,
          userId: user.id,
          userName: user.name,
          auditAction: "SHORT_CLOSE",
        });
      }
      await tx.deliveryOrder.update({
        where: { id: deliveryOrder.id },
        data: {
          status: "CANCELLED",
          cancelledBy: user.id,
          cancelledAt: new Date(),
          cancelReason: `Order short closed: ${input.reason}`,
        },
      });
    }
    await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { doAllocatedMt: "0" } });

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "SHORT_CLOSED",
        shortClosedBy: user.id,
        shortClosedAt: new Date(),
        shortCloseReason: input.reason,
      },
      include: { items: { include: { product: true } }, customer: true },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "SHORT_CLOSE",
        entity: "order",
        entityId: order.id,
        oldValue: { status: order.status },
        newValue: {
          status: "SHORT_CLOSED",
          reason: input.reason,
          shortCloseMt: (await remainingMtForOrder(tx, order.id)).remaining,
          cancelledDeliveryOrders: openDos.map((d) => d.doNo),
        },
      },
      tx,
    );
    return toOrderRow(updated);
  }, TX_OPTIONS);
}

/**
 * Optional SALES_OPS-only rate override on a single line, with mandatory reason.
 * (Rule 1 — salespeople can never change a locked rate.)
 */
export async function overrideOrderItemRate(
  input: { orderItemId: string; lockedRatePerMt: string; reason: string },
  user: ServiceActor,
  ip?: string,
) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: { order: true, product: true },
    });
    if (!item) throw errors.notFound("Order line");
    if (item.order.status !== "PENDING_APPROVAL") {
      throw errors.rateLocked();
    }
    const newRate = money(input.lockedRatePerMt);
    const newLineValue = money(dec(item.qtyMt).mul(newRate)).toFixed(2);

    const updated = await tx.orderItem.update({
      where: { id: item.id },
      data: {
        lockedRatePerMt: newRate.toFixed(2),
        lineValue: newLineValue,
        rateOverridden: true,
        overrideReason: input.reason,
      },
    });

    const items = await tx.orderItem.findMany({ where: { orderId: item.orderId } });
    const totalValue = items
      .reduce((acc, line) => acc.plus(dec(line.lineValue)), dec(0))
      .toFixed(2);
    await tx.order.update({ where: { id: item.orderId }, data: { totalValue } });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "OVERRIDE",
        entity: "order_item",
        entityId: item.id,
        oldValue: { lockedRatePerMt: item.lockedRatePerMt.toFixed(2), lineValue: item.lineValue.toFixed(2) },
        newValue: {
          lockedRatePerMt: newRate.toFixed(2),
          lineValue: newLineValue,
          reason: input.reason,
          orderNo: item.order.orderNo,
          product: item.productCode,
        },
      },
      tx,
    );

    return { orderItemId: updated.id, lockedRatePerMt: updated.lockedRatePerMt.toFixed(2), totalValue };
  }, TX_OPTIONS);
}

/** Orders waiting for approval, oldest first (Sales Ops approval queue). */
export async function approvalQueue(filters: { q?: string; customerCode?: string } = {}) {
  const orders = await prisma.order.findMany({
    where: {
      status: "PENDING_APPROVAL",
      ...(filters.customerCode ? { customerId: filters.customerCode } : {}),
      ...(filters.q
        ? {
            OR: [
              { orderNo: { contains: filters.q, mode: "insensitive" } },
              { customer: { name: { contains: filters.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { orderDate: "asc" },
    include: { items: { include: { product: true } }, customer: true },
  });
  return orders.map((order) => toOrderRow(order));
}

/** Salesperson performance for a period (spec Section 7.2 / reports). */
export async function salespersonPerformance(from: Date, to: Date) {
  const orders = await prisma.order.findMany({
    where: { orderDate: { gte: from, lte: to } },
    include: {
      items: true,
      creator: { select: { id: true, name: true } },
    },
  });

  const bySalesperson = new Map<
    string,
    {
      salespersonId: string;
      salespersonName: string;
      orderCount: number;
      orderValue: string;
      deliveredMt: string;
      orderedMt: string;
    }
  >();

  for (const order of orders) {
    const key = order.creator?.id ?? "unknown";
    const name = order.creator?.name ?? "Unknown";
    const entry =
      bySalesperson.get(key) ??
      {
        salespersonId: key,
        salespersonName: name,
        orderCount: 0,
        orderValue: "0",
        deliveredMt: "0.000",
        orderedMt: "0.000",
      };
    entry.orderCount += 1;
    entry.orderValue = money(dec(entry.orderValue).plus(dec(order.totalValue))).toFixed(2);
    for (const item of order.items) {
      entry.deliveredMt = qty(dec(entry.deliveredMt).plus(dec(item.deliveredMt))).toFixed(3);
      entry.orderedMt = qty(dec(entry.orderedMt).plus(dec(item.qtyMt))).toFixed(3);
    }
    bySalesperson.set(key, entry);
  }

  return [...bySalesperson.values()].sort((a, b) => Number(b.orderValue) - Number(a.orderValue));
}
