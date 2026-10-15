import {
  type DeliveryOrderStatus,
  type OrderStatus,
  type StockCountStatus,
  type TransferStatus,
} from "@prisma/client";
import { errors } from "@/lib/errors";

/**
 * Explicit state machines (spec Section 5). Every transition is validated here
 * in the service layer; illegal transitions raise a clear business error.
 */

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PARTIALLY_DELIVERED", "COMPLETED", "CANCELLED", "SHORT_CLOSED"],
  PARTIALLY_DELIVERED: ["COMPLETED", "SHORT_CLOSED"],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
  SHORT_CLOSED: [],
};

export const DO_TRANSITIONS: Record<DeliveryOrderStatus, DeliveryOrderStatus[]> = {
  CREATED: ["PARTIALLY_DISPATCHED", "DISPATCHED", "CANCELLED"],
  PARTIALLY_DISPATCHED: ["DISPATCHED"],
  DISPATCHED: [],
  CANCELLED: [],
};

export const TRANSFER_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED"],
  APPROVED: ["IN_TRANSIT", "REJECTED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: [],
  REJECTED: [],
};

export const COUNT_TRANSITIONS: Record<StockCountStatus, StockCountStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "REJECTED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

function assertAllowed<T extends string>(
  map: Record<T, T[]>,
  entity: string,
  from: T,
  to: T,
): void {
  if (!map[from]?.includes(to)) {
    throw errors.illegalTransition(entity, from, to);
  }
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  assertAllowed(ORDER_TRANSITIONS, "order", from, to);
}

export function assertDoTransition(from: DeliveryOrderStatus, to: DeliveryOrderStatus): void {
  assertAllowed(DO_TRANSITIONS, "delivery order", from, to);
}

export function assertTransferTransition(from: TransferStatus, to: TransferStatus): void {
  assertAllowed(TRANSFER_TRANSITIONS, "stock transfer", from, to);
}

export function assertCountTransition(from: StockCountStatus, to: StockCountStatus): void {
  assertAllowed(COUNT_TRANSITIONS, "stock count", from, to);
}

/** Orders that occupy the customer's delivery queue (Rule 3). */
export const QUEUE_ORDER_STATUSES: OrderStatus[] = ["APPROVED", "PARTIALLY_DELIVERED"];

/** Orders that block nothing and can be ignored by the queue logic. */
export const CLOSED_ORDER_STATUSES: OrderStatus[] = [
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
  "SHORT_CLOSED",
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  PARTIALLY_DELIVERED: "Partially delivered",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  SHORT_CLOSED: "Short closed",
};

export const DO_STATUS_LABELS: Record<DeliveryOrderStatus, string> = {
  CREATED: "Created",
  PARTIALLY_DISPATCHED: "Partially dispatched",
  DISPATCHED: "Dispatched",
  CANCELLED: "Cancelled",
};

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  IN_TRANSIT: "In transit",
  RECEIVED: "Received",
  REJECTED: "Rejected",
};

export const COUNT_STATUS_LABELS: Record<StockCountStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};
