import { type Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { dec, qty } from "@/lib/decimal";
import { errors } from "@/lib/errors";
import { actor, writeAudit } from "@/lib/audit";
import { nextDocNo } from "@/lib/numbering";
import { COUNT_STATUS_LABELS } from "@/lib/state-machines";
import { adjustToQuantity, getBalance } from "@/server/services/stock.service";
import type { ServiceActor } from "@/server/services/order.service";

const TX_OPTIONS = { timeout: 30_000, maxWait: 30_000 };

/**
 * Rule 7 — physical stock count vs system stock.
 * The difference is computed at entry time; applying an adjustment requires
 * Sales Ops approval and a reason, and writes an ADJUSTMENT ledger entry.
 */

export type CreateCountInput = {
  warehouseCode: string;
  productCode: string;
  physicalQty: string;
  reason?: string;
  remarks?: string;
};

export async function createStockCount(input: CreateCountInput, user: ServiceActor, ip?: string) {
  return prisma.$transaction(async (tx) => {
    if (user.role === "WAREHOUSE" && user.warehouseCode !== input.warehouseCode) {
      throw errors.forbidden("counting another warehouse's stock");
    }
    const [warehouse, product] = await Promise.all([
      tx.warehouse.findUnique({ where: { code: input.warehouseCode } }),
      tx.product.findUnique({ where: { code: input.productCode } }),
    ]);
    if (!warehouse) throw errors.notFound("Warehouse");
    if (!product) throw errors.notFound("Product");

    const balance = await getBalance(warehouse.code, product.code, tx);
    const systemQty = dec(balance.onHandMt);
    const physicalQty = qty(input.physicalQty);
    const difference = qty(physicalQty.minus(systemQty));

    const countNo = await nextDocNo("count", tx);
    const created = await tx.stockCount.create({
      data: {
        countNo,
        warehouseId: warehouse.code,
        productCode: product.code,
        systemQty: systemQty.toFixed(3),
        physicalQty: physicalQty.toFixed(3),
        difference: difference.toFixed(3),
        status: "PENDING_APPROVAL",
        reason: input.reason ?? null,
        remarks: input.remarks ?? null,
        createdBy: user.id,
      },
      include: { warehouse: true, product: true, creator: { select: { name: true } } },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "COUNT_SUBMIT",
        entity: "stock_count",
        entityId: created.id,
        newValue: {
          countNo,
          warehouse: warehouse.code,
          product: product.code,
          systemQty: systemQty.toFixed(3),
          physicalQty: physicalQty.toFixed(3),
          difference: difference.toFixed(3),
          reason: input.reason ?? null,
        },
      },
      tx,
    );

    return toCountRow(created);
  }, TX_OPTIONS);
}

export async function decideStockCount(
  input: { countId: string; approve: boolean; reason?: string },
  user: ServiceActor,
  ip?: string,
) {
  return prisma.$transaction(async (tx) => {
    const count = await tx.stockCount.findUnique({
      where: { id: input.countId },
      include: { warehouse: true, product: true, creator: { select: { name: true } } },
    });
    if (!count) throw errors.notFound("Stock count");
    if (count.status !== "PENDING_APPROVAL" && count.status !== "DRAFT") {
      throw errors.illegalTransition("stock count", count.status, input.approve ? "APPROVED" : "REJECTED");
    }

    if (!input.approve) {
      if (!input.reason || input.reason.trim().length < 3) {
        throw errors.validation("A reason is required when rejecting a stock count.");
      }
      const updated = await tx.stockCount.update({
        where: { id: count.id },
        data: {
          status: "REJECTED",
          rejectedReason: input.reason,
          approvedBy: user.id,
          approvedAt: new Date(),
        },
        include: { warehouse: true, product: true, creator: { select: { name: true } } },
      });
      await writeAudit(
        {
          ...actor(user, ip),
          action: "COUNT_REJECT",
          entity: "stock_count",
          entityId: count.id,
          oldValue: { status: count.status },
          newValue: { status: "REJECTED", reason: input.reason },
        },
        tx,
      );
      return toCountRow(updated);
    }

    const difference = dec(count.difference);
    if (!difference.isZero() && (!input.reason || input.reason.trim().length < 3)) {
      throw errors.validation(
        "A reason is required to approve a stock difference adjustment.",
      );
    }

    const applied = await adjustToQuantity(tx, {
      warehouseCode: count.warehouseId,
      productCode: count.productCode,
      targetOnHandMt: count.physicalQty,
      reason: input.reason ?? count.reason ?? "Physical stock adjustment",
      note: `Count ${count.countNo}`,
      refType: "stock_count",
      refId: count.id,
      userId: user.id,
      userName: user.name,
      ip,
      auditAction: "COUNT_APPROVE",
    });

    // Move any remaining reserved quantity with the adjusted stock when the
    // physical count is lower than the system quantity minus reservations.
    const balanceAfter = await getBalance(count.warehouseId, count.productCode, tx);
    if (dec(balanceAfter.reservedMt).gt(dec(balanceAfter.onHandMt))) {
      throw errors.conflict(
        `Adjusting to ${dec(count.physicalQty).toFixed(3)} MT would leave reservations (${balanceAfter.reservedMt} MT) above the physical stock. Release or dispatch the open delivery orders first.`,
      );
    }

    const updated = await tx.stockCount.update({
      where: { id: count.id },
      data: {
        status: "APPROVED",
        approvedBy: user.id,
        approvedAt: new Date(),
        reason: input.reason ?? count.reason,
      },
      include: { warehouse: true, product: true, creator: { select: { name: true } } },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "COUNT_APPROVE",
        entity: "stock_count",
        entityId: count.id,
        oldValue: { status: count.status, systemQty: count.systemQty.toFixed(3) },
        newValue: {
          status: "APPROVED",
          physicalQty: dec(count.physicalQty).toFixed(3),
          adjustment: difference.toFixed(3),
          ledgerId: applied.ledgerId,
          reason: input.reason ?? count.reason ?? null,
        },
      },
      tx,
    );

    return toCountRow(updated);
  }, TX_OPTIONS);
}

type CountWithRelations = Prisma.StockCountGetPayload<{
  include: { warehouse: true; product: true; creator: { select: { name: true } } };
}>;

export function toCountRow(count: CountWithRelations) {
  return {
    id: count.id,
    countNo: count.countNo,
    status: count.status,
    statusLabel: COUNT_STATUS_LABELS[count.status],
    warehouseCode: count.warehouseId,
    warehouseName: count.warehouse.name,
    productCode: count.productCode,
    productName: count.product.name,
    systemQty: count.systemQty.toFixed(3),
    physicalQty: count.physicalQty.toFixed(3),
    difference: count.difference.toFixed(3),
    countDate: count.countDate,
    reason: count.reason,
    remarks: count.remarks,
    rejectedReason: count.rejectedReason,
    createdByName: count.creator?.name ?? "—",
    approvedAt: count.approvedAt,
  };
}

export type CountRow = ReturnType<typeof toCountRow>;

const COUNT_INCLUDE = {
  warehouse: true,
  product: true,
  creator: { select: { name: true } },
} satisfies Prisma.StockCountInclude;

export async function listStockCounts(
  filter: { q?: string; status?: string; warehouseCode?: string; page?: number; pageSize?: number },
  user: ServiceActor,
) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, filter.pageSize ?? 20));
  const warehouseScope =
    user.role === "WAREHOUSE" ? (user.warehouseCode ?? "__none__") : filter.warehouseCode;

  const where: Prisma.StockCountWhereInput = {
    ...(warehouseScope ? { warehouseId: warehouseScope } : {}),
    ...(filter.status && filter.status !== "ALL"
      ? { status: filter.status as Prisma.EnumStockCountStatusFilter["equals"] }
      : {}),
    ...(filter.q
      ? {
          OR: [
            { countNo: { contains: filter.q, mode: "insensitive" } },
            { product: { name: { contains: filter.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.stockCount.findMany({
      where,
      orderBy: { countDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: COUNT_INCLUDE,
    }),
    prisma.stockCount.count({ where }),
  ]);

  return {
    rows: rows.map(toCountRow),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Physical vs system difference report (spec Section 7.7). */
export async function stockDifferenceReport(from: Date, to: Date, warehouseCode?: string) {
  const rows = await prisma.stockCount.findMany({
    where: {
      countDate: { gte: from, lte: to },
      ...(warehouseCode ? { warehouseId: warehouseCode } : {}),
    },
    orderBy: { countDate: "desc" },
    include: { warehouse: true, product: true },
  });
  return rows.map((row) => ({
    countNo: row.countNo,
    countDate: row.countDate,
    warehouseName: row.warehouse.name,
    productName: row.product.name,
    systemQty: row.systemQty.toFixed(3),
    physicalQty: row.physicalQty.toFixed(3),
    difference: row.difference.toFixed(3),
    status: row.status,
    reason: row.reason ?? "",
  }));
}
