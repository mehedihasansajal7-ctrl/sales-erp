import { type Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { dec, qty } from "@/lib/decimal";
import { errors } from "@/lib/errors";
import { actor, writeAudit } from "@/lib/audit";
import { nextDocNo } from "@/lib/numbering";
import { assertTransferTransition, TRANSFER_STATUS_LABELS } from "@/lib/state-machines";
import { applyMovement, availableMt, getBalance, reserveStock, lockStockBalance } from "@/server/services/stock.service";
import type { ServiceActor } from "@/server/services/order.service";

const TX_OPTIONS = { timeout: 30_000, maxWait: 30_000 };

/**
 * Rule 7 — stock transfer between warehouses.
 * REQUESTED → APPROVED (reserves at source) → IN_TRANSIT (leaves source) →
 * RECEIVED (arrives at destination), or REJECTED at either of the first stages.
 */

export type RequestTransferInput = {
  fromWarehouseCode: string;
  toWarehouseCode: string;
  productCode: string;
  qtyMt: string;
  reason?: string;
};

export async function requestTransfer(input: RequestTransferInput, user: ServiceActor, ip?: string) {
  return prisma.$transaction(async (tx) => {
    if (input.fromWarehouseCode === input.toWarehouseCode) {
      throw errors.validation("Source and destination warehouse must be different.");
    }
    if (user.role === "WAREHOUSE" && user.warehouseCode !== input.fromWarehouseCode) {
      throw errors.forbidden("requesting a transfer out of another warehouse");
    }

    const [from, to, product] = await Promise.all([
      tx.warehouse.findUnique({ where: { code: input.fromWarehouseCode } }),
      tx.warehouse.findUnique({ where: { code: input.toWarehouseCode } }),
      tx.product.findUnique({ where: { code: input.productCode } }),
    ]);
    if (!from) throw errors.notFound("Source warehouse");
    if (!to) throw errors.notFound("Destination warehouse");
    if (!product) throw errors.notFound("Product");
    if (!from.isActive || !to.isActive) {
      throw errors.validation("Both warehouses must be active.");
    }

    const requested = qty(input.qtyMt);
    const balance = await getBalance(from.code, product.code, tx);
    const available = dec(availableMt(balance));
    if (requested.gt(available)) {
      throw errors.insufficientStock(
        `Only ${available.toFixed(3)} MT of ${product.name} is available at ${from.name} (requested ${requested.toFixed(3)} MT).`,
      );
    }

    const transferNo = await nextDocNo("transfer", tx);
    const created = await tx.stockTransfer.create({
      data: {
        transferNo,
        fromWarehouseId: from.code,
        toWarehouseId: to.code,
        productCode: product.code,
        qtyMt: requested.toFixed(3),
        status: "REQUESTED",
        reason: input.reason ?? null,
        requestedBy: user.id,
        createdBy: user.id,
      },
      include: { fromWarehouse: true, toWarehouse: true, product: true, requester: { select: { name: true } } },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "TRANSFER_REQUEST",
        entity: "stock_transfer",
        entityId: created.id,
        newValue: {
          transferNo,
          from: from.code,
          to: to.code,
          product: product.code,
          qtyMt: requested.toFixed(3),
          reason: input.reason ?? null,
        },
      },
      tx,
    );

    return toTransferRow(created);
  }, TX_OPTIONS);
}

export async function decideTransfer(
  input: { transferId: string; approve: boolean; reason?: string },
  user: ServiceActor,
  ip?: string,
) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findUnique({
      where: { id: input.transferId },
      include: { fromWarehouse: true, toWarehouse: true, product: true },
    });
    if (!transfer) throw errors.notFound("Stock transfer");
    assertTransferTransition(transfer.status, input.approve ? "APPROVED" : "REJECTED");

    if (!input.approve) {
      if (!input.reason || input.reason.trim().length < 3) {
        throw errors.validation("A reason is required when rejecting a transfer.");
      }
      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: "REJECTED", rejectReason: input.reason, rejectedAt: new Date() },
        include: { fromWarehouse: true, toWarehouse: true, product: true, requester: { select: { name: true } } },
      });
      await writeAudit(
        {
          ...actor(user, ip),
          action: "TRANSFER_REJECT",
          entity: "stock_transfer",
          entityId: transfer.id,
          oldValue: { status: transfer.status },
          newValue: { status: "REJECTED", reason: input.reason },
        },
        tx,
      );
      return toTransferRow(updated);
    }

    // Reserving at the source guarantees the quantity is still there in transit.
    await reserveStock(tx, {
      warehouseCode: transfer.fromWarehouseId,
      productCode: transfer.productCode,
      qtyMt: transfer.qtyMt,
      refType: "stock_transfer",
      refId: transfer.id,
      note: `Reserved for transfer ${transfer.transferNo}`,
      userId: user.id,
      userName: user.name,
      ip,
      auditAction: "TRANSFER_APPROVE",
    });

    const updated = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: "APPROVED", approvedBy: user.id, approvedAt: new Date() },
      include: { fromWarehouse: true, toWarehouse: true, product: true, requester: { select: { name: true } } },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "TRANSFER_APPROVE",
        entity: "stock_transfer",
        entityId: transfer.id,
        oldValue: { status: transfer.status },
        newValue: { status: "APPROVED", reservedMt: dec(transfer.qtyMt).toFixed(3) },
      },
      tx,
    );

    return toTransferRow(updated);
  }, TX_OPTIONS);
}

/** APPROVED → IN_TRANSIT: the goods physically leave the source warehouse. */
export async function markInTransit(transferId: string, user: ServiceActor, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findUnique({
      where: { id: transferId },
      include: { fromWarehouse: true, toWarehouse: true, product: true },
    });
    if (!transfer) throw errors.notFound("Stock transfer");
    if (user.role === "WAREHOUSE" && user.warehouseCode !== transfer.fromWarehouseId) {
      throw errors.forbidden("releasing another warehouse's transfer");
    }
    assertTransferTransition(transfer.status, "IN_TRANSIT");

    await applyMovement(tx, {
      warehouseCode: transfer.fromWarehouseId,
      productCode: transfer.productCode,
      movementType: "TRANSFER_OUT",
      onHandDelta: dec(transfer.qtyMt).negated(),
      reservedDelta: dec(transfer.qtyMt).negated(),
      refType: "stock_transfer",
      refId: transfer.id,
      note: `Transfer ${transfer.transferNo} to ${transfer.toWarehouse.name}`,
      userId: user.id,
      userName: user.name,
      ip,
      auditAction: "TRANSFER_IN_TRANSIT",
    });

    const updated = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: "IN_TRANSIT", inTransitAt: new Date() },
      include: { fromWarehouse: true, toWarehouse: true, product: true, requester: { select: { name: true } } },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "TRANSFER_IN_TRANSIT",
        entity: "stock_transfer",
        entityId: transfer.id,
        oldValue: { status: transfer.status },
        newValue: { status: "IN_TRANSIT", from: transfer.fromWarehouseId },
      },
      tx,
    );

    return toTransferRow(updated);
  }, TX_OPTIONS);
}

/** IN_TRANSIT → RECEIVED: the destination warehouse confirms receipt. */
export async function receiveTransfer(transferId: string, user: ServiceActor, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findUnique({
      where: { id: transferId },
      include: { fromWarehouse: true, toWarehouse: true, product: true },
    });
    if (!transfer) throw errors.notFound("Stock transfer");
    if (user.role === "WAREHOUSE" && user.warehouseCode !== transfer.toWarehouseId) {
      throw errors.forbidden("receiving another warehouse's transfer");
    }
    assertTransferTransition(transfer.status, "RECEIVED");

    await lockStockBalance(tx, transfer.toWarehouseId, transfer.productCode);
    await applyMovement(tx, {
      warehouseCode: transfer.toWarehouseId,
      productCode: transfer.productCode,
      movementType: "TRANSFER_IN",
      onHandDelta: dec(transfer.qtyMt),
      reservedDelta: 0,
      refType: "stock_transfer",
      refId: transfer.id,
      note: `Transfer ${transfer.transferNo} from ${transfer.fromWarehouse.name}`,
      userId: user.id,
      userName: user.name,
      ip,
      auditAction: "TRANSFER_RECEIVE",
    });

    const updated = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: "RECEIVED", receivedAt: new Date(), receivedBy: user.id },
      include: { fromWarehouse: true, toWarehouse: true, product: true, requester: { select: { name: true } } },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "TRANSFER_RECEIVE",
        entity: "stock_transfer",
        entityId: transfer.id,
        oldValue: { status: transfer.status },
        newValue: { status: "RECEIVED", to: transfer.toWarehouseId },
      },
      tx,
    );

    return toTransferRow(updated);
  }, TX_OPTIONS);
}

type TransferWithRelations = Prisma.StockTransferGetPayload<{
  include: { fromWarehouse: true; toWarehouse: true; product: true; requester: { select: { name: true } } };
}>;

export function toTransferRow(transfer: TransferWithRelations) {
  return {
    id: transfer.id,
    transferNo: transfer.transferNo,
    status: transfer.status,
    statusLabel: TRANSFER_STATUS_LABELS[transfer.status],
    fromWarehouseCode: transfer.fromWarehouseId,
    fromWarehouseName: transfer.fromWarehouse.name,
    toWarehouseCode: transfer.toWarehouseId,
    toWarehouseName: transfer.toWarehouse.name,
    productCode: transfer.productCode,
    productName: transfer.product.name,
    qtyMt: transfer.qtyMt.toFixed(3),
    reason: transfer.reason,
    rejectReason: transfer.rejectReason,
    requestedByName: transfer.requester.name,
    requestedAt: transfer.requestedAt,
    approvedAt: transfer.approvedAt,
    inTransitAt: transfer.inTransitAt,
    receivedAt: transfer.receivedAt,
  };
}

export type TransferRow = ReturnType<typeof toTransferRow>;

const TRANSFER_INCLUDE = {
  fromWarehouse: true,
  toWarehouse: true,
  product: true,
  requester: { select: { name: true } },
} satisfies Prisma.StockTransferInclude;

export async function listTransfers(
  filter: { q?: string; status?: string; warehouseCode?: string; page?: number; pageSize?: number },
  user: ServiceActor,
) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, filter.pageSize ?? 20));

  const warehouseScope =
    user.role === "WAREHOUSE" ? (user.warehouseCode ?? "__none__") : filter.warehouseCode;

  const where: Prisma.StockTransferWhereInput = {
    ...(filter.status && filter.status !== "ALL"
      ? { status: filter.status as Prisma.EnumTransferStatusFilter["equals"] }
      : {}),
    ...(warehouseScope
      ? { OR: [{ fromWarehouseId: warehouseScope }, { toWarehouseId: warehouseScope }] }
      : {}),
    ...(filter.q
      ? {
          OR: [
            { transferNo: { contains: filter.q, mode: "insensitive" } },
            { product: { name: { contains: filter.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.stockTransfer.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: TRANSFER_INCLUDE,
    }),
    prisma.stockTransfer.count({ where }),
  ]);

  return {
    rows: rows.map(toTransferRow),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getTransfer(id: string) {
  const transfer = await prisma.stockTransfer.findUnique({ where: { id }, include: TRANSFER_INCLUDE });
  if (!transfer) throw errors.notFound("Stock transfer");
  return toTransferRow(transfer);
}
