import { type Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { dec } from "@/lib/decimal";
import { toZonedDateTimeString } from "@/lib/dates";

/**
 * Rule 8 — audit log viewer. Read-only by construction: this module exposes
 * query helpers only, and the `audit_logs` table carries a DB trigger that
 * rejects UPDATE and DELETE.
 */

export type AuditFilter = {
  q?: string;
  entity?: string;
  action?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export async function listAuditLogs(filter: AuditFilter) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filter.pageSize ?? 30));

  const where: Prisma.AuditLogWhereInput = {
    ...(filter.entity && filter.entity !== "ALL" ? { entity: filter.entity } : {}),
    ...(filter.action && filter.action !== "ALL" ? { action: filter.action } : {}),
    ...(filter.userId ? { userId: filter.userId } : {}),
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
            { entityId: { contains: filter.q, mode: "insensitive" } },
            { userName: { contains: filter.q, mode: "insensitive" } },
            { action: { contains: filter.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      createdAtLabel: toZonedDateTimeString(row.createdAt),
      userName: row.userName ?? "system",
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      ip: row.ip,
      oldValue: row.oldValue ? JSON.stringify(row.oldValue, null, 2) : null,
      newValue: row.newValue ? JSON.stringify(row.newValue, null, 2) : null,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type AuditRow = Awaited<ReturnType<typeof listAuditLogs>>["rows"][number];

/** Timeline for a single entity (used on order / DO detail screens). */
export async function entityTimeline(entity: string, entityId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    userName: row.userName ?? "system",
    createdAt: row.createdAt,
    createdAtLabel: toZonedDateTimeString(row.createdAt),
    oldValue: row.oldValue,
    newValue: row.newValue,
  }));
}

/** Actions performed by one user inside a window (used in the case log). */
export async function recentActivity(userId: string, take = 10) {
  const rows = await prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    createdAt: row.createdAt,
    createdAtLabel: toZonedDateTimeString(row.createdAt),
  }));
}

/** Aggregated counters used on the admin dashboard. */
export async function auditCounters() {
  const rows = await prisma.auditLog.groupBy({
    by: ["action"],
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.action, row._count._all]));
}

export function auditJsonSummary(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export { dec };
