import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma";
import prisma from "@/lib/prisma";

/**
 * Rule 8 — audit trail.
 * Every create / update / approve / reject / cancel / dispatch / override action
 * on Rate, Order, DO, Dispatch, Stock and User records writes one row here.
 * Rows are append-only: no update or delete statement exists anywhere in the
 * codebase, and the DB carries a trigger that rejects UPDATE/DELETE.
 */
export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "APPROVE"
  | "REJECT"
  | "CANCEL"
  | "SHORT_CLOSE"
  | "DISPATCH"
  | "OVERRIDE"
  | "PUBLISH"
  | "LOGIN"
  | "LOGOUT"
  | "LOGIN_FAILED"
  | "DEACTIVATE"
  | "ACTIVATE"
  | "PASSWORD_CHANGE"
  | "TRANSFER_REQUEST"
  | "TRANSFER_APPROVE"
  | "TRANSFER_REJECT"
  | "TRANSFER_IN_TRANSIT"
  | "TRANSFER_RECEIVE"
  | "COUNT_SUBMIT"
  | "COUNT_APPROVE"
  | "COUNT_REJECT"
  | "CHAT_POST";

export type AuditEntity =
  | "rate"
  | "order"
  | "order_item"
  | "delivery_order"
  | "dispatch"
  | "stock"
  | "stock_transfer"
  | "stock_count"
  | "user"
  | "product"
  | "customer"
  | "warehouse"
  | "system_setting"
  | "auth"
  | "chat_message";

export type AuditInput = {
  userId?: string | null;
  userName?: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
};

/** JSON-safe serialisation (Decimals, Dates, BigInts) for the audit columns. */
export function toAuditJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      if (val && typeof val === "object" && typeof val.toFixed === "function") {
        return String(val);
      }
      if (typeof val === "bigint") return String(val);
      return val;
    }),
  ) as Prisma.InputJsonValue;
}

/**
 * Writes an audit row. Pass the transaction client when inside a transaction so
 * the audit entry commits or rolls back with the business change.
 */
export async function writeAudit(input: AuditInput, tx: Tx | typeof prisma = prisma) {
  return tx.auditLog.create({
    data: {
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      oldValue: toAuditJson(input.oldValue),
      newValue: toAuditJson(input.newValue),
      ip: input.ip ?? null,
    },
  });
}

/** Convenience wrapper bound to the acting user. */
export function actor(user: { id: string; name: string } | null, ip?: string | null) {
  return {
    userId: user?.id ?? null,
    userName: user?.name ?? null,
    ip: ip ?? null,
  };
}
