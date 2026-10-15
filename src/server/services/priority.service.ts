import type { Tx } from "@/lib/prisma";
import { dec, qty } from "@/lib/decimal";
import { errors } from "@/lib/errors";
import { QUEUE_ORDER_STATUSES } from "@/lib/state-machines";
import { getSettings, SETTING_KEYS } from "@/lib/settings";

/**
 * Rule 3 — strict per-customer delivery priority.
 *
 * For the same customer, an older active order across ANY product must be fully
 * delivered before a newer order of that customer can be delivered. Different
 * customers never block each other.
 *
 * The queue is: orders of the customer in status APPROVED or
 * PARTIALLY_DELIVERED, ordered by `order_seq` ASC. Orders in PENDING_APPROVAL do
 * not block (avoids deadlock), REJECTED / CANCELLED / COMPLETED / SHORT_CLOSED
 * are not in the queue at all ("skip").
 *
 * This function is used by BOTH DO creation and dispatch recording, and always
 * runs inside a transaction that first takes a row lock on the customer, so two
 * warehouses acting at the same instant can never bypass the rule.
 */

export type PriorityCheckInput = {
  customerId: string;
  orderId: string;
  /** SALES_OPS may pass true together with a reason (audited). */
  priorityOverride?: boolean;
  overrideReason?: string;
};

export type PriorityCheckResult = {
  blockingOrderId: string | null;
  blockingOrderNo: string | null;
  blockingRemainingMt: string | null;
  overrideUsed: boolean;
  queueOrderIds: string[];
};

/** Takes the customer row lock that serialises every delivery action of a customer. */
export async function lockCustomer(tx: Tx, customerId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ code: string }[]>`
    SELECT code FROM customers WHERE code = ${customerId} FOR UPDATE
  `;
  if (!rows[0]) throw errors.notFound("Customer");
}

export async function remainingMtForOrder(
  tx: Tx,
  orderId: string,
): Promise<{ remaining: string; ordered: string; delivered: string }> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { qtyMt: true, deliveredMt: true },
  });
  let ordered = dec(0);
  let delivered = dec(0);
  for (const item of items) {
    ordered = ordered.plus(dec(item.qtyMt));
    delivered = delivered.plus(dec(item.deliveredMt));
  }
  return {
    remaining: qty(ordered.minus(delivered)).toFixed(3),
    ordered: qty(ordered).toFixed(3),
    delivered: qty(delivered).toFixed(3),
  };
}

/** The customer's delivery queue, oldest order first. */
export async function customerQueue(
  tx: Tx,
  customerId: string,
): Promise<{ id: string; orderNo: string; orderSeq: number; status: string; remainingMt: string }[]> {
  const orders = await tx.order.findMany({
    where: { customerId, status: { in: QUEUE_ORDER_STATUSES } },
    orderBy: { orderSeq: "asc" },
    include: { items: { select: { qtyMt: true, deliveredMt: true } } },
  });

  return orders.map((order) => {
    let ordered = dec(0);
    let delivered = dec(0);
    for (const item of order.items) {
      ordered = ordered.plus(dec(item.qtyMt));
      delivered = delivered.plus(dec(item.deliveredMt));
    }
    return {
      id: order.id,
      orderNo: order.orderNo,
      orderSeq: order.orderSeq,
      status: order.status,
      remainingMt: qty(ordered.minus(delivered)).toFixed(3),
    };
  });
}

/**
 * Throws `PRIORITY_BLOCKED` unless `orderId` is the head of its customer's queue,
 * or a valid, enabled, reason-carrying priority override was granted.
 */
export async function assertCustomerPriority(
  tx: Tx,
  input: PriorityCheckInput,
): Promise<PriorityCheckResult> {
  // 1. Serialise all delivery actions of this customer.
  await lockCustomer(tx, input.customerId);

  const queue = await customerQueue(tx, input.customerId);
  const head = queue[0] ?? null;
  const queueOrderIds = queue.map((q) => q.id);

  const wantsOverride = Boolean(input.priorityOverride);
  const overrideEnabled =
    (await getSettings(tx))[SETTING_KEYS.priorityOverrideEnabled] === "true";

  if (wantsOverride) {
    if (!overrideEnabled) {
      throw errors.overrideNotAllowed(
        "Priority override is disabled in settings, so this delivery cannot bypass the customer's queue.",
      );
    }
    if (!input.overrideReason || input.overrideReason.trim().length < 3) {
      throw errors.overrideNotAllowed(
        "A written reason is mandatory for a priority override.",
      );
    }
  }

  if (!head) {
    // Nothing in the queue: this order must itself be deliverable.
    return {
      blockingOrderId: null,
      blockingOrderNo: null,
      blockingRemainingMt: null,
      overrideUsed: wantsOverride,
      queueOrderIds,
    };
  }

  if (head.id === input.orderId) {
    return {
      blockingOrderId: null,
      blockingOrderNo: null,
      blockingRemainingMt: null,
      overrideUsed: wantsOverride,
      queueOrderIds,
    };
  }

  if (wantsOverride) {
    return {
      blockingOrderId: head.id,
      blockingOrderNo: head.orderNo,
      blockingRemainingMt: head.remainingMt,
      overrideUsed: true,
      queueOrderIds,
    };
  }

  throw errors.priorityBlocked(head.orderNo, head.remainingMt);
}

/**
 * Queue position of every active order of a customer, joined to the blocking
 * order — powers the Sales Ops "customer priority queue" screen.
 */
export async function customerQueueWithBlockers(tx: Tx, customerId: string) {
  const queue = await customerQueue(tx, customerId);
  const head = queue[0] ?? null;
  return queue.map((entry, index) => ({
    ...entry,
    position: index + 1,
    blocked: index > 0,
    blockedBy: index > 0 && head ? { id: head.id, orderNo: head.orderNo, remainingMt: head.remainingMt } : null,
  }));
}
