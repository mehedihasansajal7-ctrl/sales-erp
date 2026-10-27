import { type MovementType } from "@prisma/client";
import prisma, { type Tx } from "@/lib/prisma";
import { dec, money, nonNegative, qty, type Numeric } from "@/lib/decimal";
import { errors } from "@/lib/errors";
import { writeAudit, type AuditAction } from "@/lib/audit";
import { getSettings, SETTING_KEYS } from "@/lib/settings";

/**
 * Rule 7 — stock.
 *
 * Every movement writes one immutable `stock_ledger` row and updates the
 * matching `stock_balances` row **inside the same transaction**, so the balance
 * table can never drift from the ledger. All arithmetic uses Decimal.
 *
 * Balance invariants (also enforced by DB CHECK constraints):
 *   on_hand_mt >= 0, reserved_mt >= 0, reserved_mt <= on_hand_mt
 */

export type BalanceRow = {
  id: string;
  warehouseId: string;
  productCode: string;
  onHandMt: string;
  reservedMt: string;
};

/** Locks (and if needed creates) the balance row for warehouse+product. */
export async function lockStockBalance(
  tx: Tx,
  warehouseCode: string,
  productCode: string,
): Promise<BalanceRow> {
  await tx.$executeRaw`
    INSERT INTO stock_balances (id, warehouse_id, product_id, on_hand_mt, reserved_mt, created_at, updated_at)
    VALUES (${crypto.randomUUID()}, ${warehouseCode}, ${productCode}, 0, 0, now(), now())
    ON CONFLICT (warehouse_id, product_id) DO NOTHING
  `;
  const rows = await tx.$queryRaw<
    { id: string; warehouse_id: string; product_id: string; on_hand: string; reserved: string }[]
  >`
    SELECT id, warehouse_id, product_id, on_hand_mt::text AS on_hand, reserved_mt::text AS reserved
    FROM stock_balances
    WHERE warehouse_id = ${warehouseCode} AND product_id = ${productCode}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw errors.notFound(`Stock balance for ${productCode} @ ${warehouseCode}`);
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    productCode: row.product_id,
    onHandMt: row.on_hand,
    reservedMt: row.reserved,
  };
}

/** Read-only balance lookup (creates no row, takes no lock). */
export async function getBalance(
  warehouseCode: string,
  productCode: string,
  tx: Tx | typeof prisma = prisma,
): Promise<BalanceRow> {
  const row = await tx.stockBalance.findUnique({
    where: { warehouseId_productCode: { warehouseId: warehouseCode, productCode } },
  });
  return {
    id: row?.id ?? "",
    warehouseId: warehouseCode,
    productCode,
    onHandMt: row?.onHandMt.toFixed(3) ?? "0.000",
    reservedMt: row?.reservedMt.toFixed(3) ?? "0.000",
  };
}

export function availableMt(balance: { onHandMt: string; reservedMt: string }): string {
  return nonNegative(dec(balance.onHandMt).minus(dec(balance.reservedMt))).toFixed(3);
}

export type MovementInput = {
  warehouseCode: string;
  productCode: string;
  movementType: MovementType;
  /** Signed change applied to on_hand_mt (0 for pure reserve movements). */
  onHandDelta?: Numeric;
  /** Signed change applied to reserved_mt. */
  reservedDelta?: Numeric;
  refType?: string | null;
  refId?: string | null;
  note?: string;
  userId?: string | null;
  userName?: string | null;
  ip?: string | null;
  /** The day the stock moved (back-dating allowed). Defaults to now. */
  movementDate?: Date;
  /** Skip the audit row (used when the caller writes a richer audit entry). */
  skipAudit?: boolean;
  auditAction?: AuditAction;
};

/**
 * Applies one stock movement: updates `stock_balances` and appends the ledger
 * row. MUST be called inside a transaction, after `lockStockBalance`.
 */
export async function applyMovement(tx: Tx, input: MovementInput) {
  const balance = await lockStockBalance(tx, input.warehouseCode, input.productCode);
  const onHandDelta = qty(input.onHandDelta ?? 0);
  const reservedDelta = qty(input.reservedDelta ?? 0);

  const newOnHand = dec(balance.onHandMt).plus(onHandDelta);
  const newReserved = dec(balance.reservedMt).plus(reservedDelta);

  if (newOnHand.isNegative()) {
    throw errors.insufficientStock(
      `Insufficient stock for ${input.productCode} at ${input.warehouseCode}: available ${availableMt(balance)} MT.`,
    );
  }
  if (newReserved.isNegative()) {
    throw errors.conflict(
      `Reserved stock for ${input.productCode} at ${input.warehouseCode} would become negative.`,
    );
  }
  if (newReserved.gt(newOnHand)) {
    throw errors.conflict(
      `Reservation for ${input.productCode} at ${input.warehouseCode} exceeds on-hand stock (${newOnHand} MT).`,
    );
  }

  await tx.stockBalance.update({
    where: { id: balance.id },
    data: {
      onHandMt: newOnHand.toDecimalPlaces(3, 4).toFixed(3),
      reservedMt: newReserved.toDecimalPlaces(3, 4).toFixed(3),
    },
  });

  const ledger = await tx.stockLedger.create({
    data: {
      warehouseId: input.warehouseCode,
      productCode: input.productCode,
      movementType: input.movementType,
      qtyMt: onHandDelta.isZero() ? reservedDelta : onHandDelta,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      balanceAfter: newOnHand.toFixed(3),
      reservedAfter: newReserved.toFixed(3),
      note: input.note ?? null,
      movementDate: input.movementDate ?? new Date(),
      createdBy: input.userId ?? null,
    },
  });

  if (!input.skipAudit) {
    await writeAudit(
      {
        userId: input.userId,
        userName: input.userName,
        ip: input.ip,
        action: input.auditAction ?? "UPDATE",
        entity: "stock",
        entityId: ledger.id,
        oldValue: { onHandMt: balance.onHandMt, reservedMt: balance.reservedMt },
        newValue: {
          onHandMt: newOnHand.toFixed(3),
          reservedMt: newReserved.toFixed(3),
          warehouse: input.warehouseCode,
          product: input.productCode,
          movement: input.movementType,
        },
      },
      tx,
    );
  }

  return {
    ledgerId: ledger.id,
    onHandMt: newOnHand.toFixed(3),
    reservedMt: newReserved.toFixed(3),
  };
}

/** Reserves `qtyMt` in a warehouse (DO creation — Rule 5). */
export async function reserveStock(
  tx: Tx,
  input: Omit<MovementInput, "movementType" | "onHandDelta" | "reservedDelta"> & { qtyMt: Numeric },
) {
  const qtyMt = qty(input.qtyMt);
  const available = dec(
    availableMt(await lockStockBalance(tx, input.warehouseCode, input.productCode)),
  );
  if (qtyMt.gt(available)) {
    throw errors.insufficientStock(
      `Only ${available.toFixed(3)} MT of ${input.productCode} is available at ${input.warehouseCode} (requested ${qtyMt.toFixed(3)} MT).`,
    );
  }
  return applyMovement(tx, {
    ...input,
    movementType: "RESERVE",
    onHandDelta: 0,
    reservedDelta: qtyMt,
  });
}

export async function unreserveStock(
  tx: Tx,
  input: Omit<MovementInput, "movementType" | "onHandDelta" | "reservedDelta"> & { qtyMt: Numeric },
) {
  return applyMovement(tx, {
    ...input,
    movementType: "UNRESERVE",
    onHandDelta: 0,
    reservedDelta: qty(qty(input.qtyMt)).negated(),
  });
}

/**
 * Releases the reservation and reduces physical stock — the dispatch movement
 * (Rule 6). Both changes happen in one balance update so the
 * `reserved_mt <= on_hand_mt` CHECK can never be violated mid-flight.
 */
export async function dispatchOutStock(
  tx: Tx,
  input: Omit<MovementInput, "movementType" | "onHandDelta" | "reservedDelta"> & { qtyMt: Numeric },
) {
  const qtyMt = qty(input.qtyMt);
  return applyMovement(tx, {
    ...input,
    movementType: "OUTWARD",
    onHandDelta: qtyMt.negated(),
    reservedDelta: qtyMt.negated(),
  });
}

/** Inward receipt (Rule 7): increases on-hand stock, no reservation change. */
export async function inwardStock(
  tx: Tx,
  input: Omit<MovementInput, "movementType" | "onHandDelta" | "reservedDelta"> & {
    qtyMt: Numeric;
    movementType?: MovementInput["movementType"];
  },
) {
  return applyMovement(tx, {
    ...input,
    movementType: input.movementType ?? "INWARD",
    onHandDelta: qty(input.qtyMt),
    reservedDelta: 0,
  });
}

/** Opening stock entry — only allowed while the balance has never moved. */
export async function openingStock(
  tx: Tx,
  input: Omit<MovementInput, "movementType" | "onHandDelta" | "reservedDelta"> & { qtyMt: Numeric },
) {
  const existing = await tx.stockLedger.count({
    where: { warehouseId: input.warehouseCode, productCode: input.productCode },
  });
  if (existing > 0) {
    throw errors.conflict(
      "Opening stock can only be entered once per warehouse and product. Use an inward entry instead.",
    );
  }
  return applyMovement(tx, {
    ...input,
    movementType: "OPENING",
    onHandDelta: qty(input.qtyMt),
    reservedDelta: 0,
  });
}

/** Adjustment to a target on-hand quantity (physical vs system difference). */
export async function adjustToQuantity(
  tx: Tx,
  input: Omit<MovementInput, "movementType" | "onHandDelta" | "reservedDelta"> & {
    targetOnHandMt: Numeric;
    reason: string;
  },
) {
  const balance = await lockStockBalance(tx, input.warehouseCode, input.productCode);
  const target = qty(input.targetOnHandMt);
  const delta = target.minus(dec(balance.onHandMt));
  if (delta.isZero()) return { ledgerId: null, onHandMt: target.toFixed(3), unchanged: true };
  if (target.lt(dec(balance.reservedMt))) {
    throw errors.conflict(
      `Physical stock ${target.toFixed(3)} MT is below the ${dec(balance.reservedMt).toFixed(3)} MT reserved for open delivery orders at ${input.warehouseCode}.`,
    );
  }
  const result = await applyMovement(tx, {
    ...input,
    movementType: "ADJUSTMENT",
    onHandDelta: delta,
    reservedDelta: 0,
    note: `${input.reason}${input.note ? ` — ${input.note}` : ""}`,
  });
  return { ...result, unchanged: false };
}

/** Move value helper kept next to stock math for consistency in reports. */
export function stockValue(onHandMt: Numeric, ratePerMt: Numeric) {
  return money(dec(onHandMt).mul(dec(ratePerMt)));
}

export type StockRow = {
  warehouseCode: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  openingMt: string;
  inwardMt: string;
  outwardMt: string;
  transferInMt: string;
  transferOutMt: string;
  adjustmentMt: string;
  onHandMt: string;
  reservedMt: string;
  availableMt: string;
};

/**
 * Stock summary per warehouse/product. `openingMt` is the balance carried by
 * OPENING/ADJUSTMENT movements, everything else is summed from the ledger.
 */
export async function stockSummary(filter: { warehouseCode?: string; productCode?: string } = {}) {
  const balances = await prisma.stockBalance.findMany({
    where: {
      ...(filter.warehouseCode ? { warehouseId: filter.warehouseCode } : {}),
      ...(filter.productCode ? { productCode: filter.productCode } : {}),
    },
    include: { warehouse: true, product: true },
    orderBy: [{ warehouseId: "asc" }, { productCode: "asc" }],
  });

  const movements = await prisma.stockLedger.groupBy({
    by: ["warehouseId", "productCode", "movementType"],
    _sum: { qtyMt: true },
    where: {
      ...(filter.warehouseCode ? { warehouseId: filter.warehouseCode } : {}),
      ...(filter.productCode ? { productCode: filter.productCode } : {}),
    },
  });

  const lookup = new Map<string, string>();
  for (const row of movements) {
    lookup.set(`${row.warehouseId}|${row.productCode}|${row.movementType}`, row._sum.qtyMt?.toFixed(3) ?? "0.000");
  }
  const get = (wh: string, pc: string, type: MovementType) =>
    lookup.get(`${wh}|${pc}|${type}`) ?? "0.000";

  return balances.map<StockRow>((b) => ({
    warehouseCode: b.warehouseId,
    warehouseName: b.warehouse.name,
    productCode: b.productCode,
    productName: b.product.name,
    openingMt: get(b.warehouseId, b.productCode, "OPENING"),
    inwardMt: get(b.warehouseId, b.productCode, "INWARD"),
    outwardMt: get(b.warehouseId, b.productCode, "OUTWARD"),
    transferInMt: get(b.warehouseId, b.productCode, "TRANSFER_IN"),
    transferOutMt: get(b.warehouseId, b.productCode, "TRANSFER_OUT"),
    adjustmentMt: get(b.warehouseId, b.productCode, "ADJUSTMENT"),
    onHandMt: b.onHandMt.toFixed(3),
    reservedMt: b.reservedMt.toFixed(3),
    availableMt: availableMt({
      onHandMt: b.onHandMt.toFixed(3),
      reservedMt: b.reservedMt.toFixed(3),
    }),
  }));
}

/** True when the credit check setting is on (Rule 2). */
export async function creditCheckEnabled(tx: Tx | typeof prisma = prisma): Promise<boolean> {
  const settings = await getSettings(tx);
  return settings[SETTING_KEYS.creditCheckEnabled] === "true";
}
