"use server";

import { revalidatePath } from "next/cache";
import { getClientIp, requirePermission } from "@/lib/auth";
import {
  countCreateSchema,
  countDecisionSchema,
  stockAdjustmentSchema,
  stockInwardSchema,
  stockOpeningSchema,
  positiveQtySchema,
  transferCreateSchema,
  transferDecisionSchema,
} from "@/lib/validation";
import { adjustToQuantity, inwardStock, openingStock } from "@/server/services/stock.service";
import {
  decideTransfer,
  markInTransit,
  receiveTransfer,
  requestTransfer,
} from "@/server/services/transfer.service";
import { createStockCount, decideStockCount } from "@/server/services/stock-count.service";
import { actionFailure, actionOk, bool, str, type ActionState } from "@/actions/helpers";
import { errors } from "@/lib/errors";
import { movementDateFromInput } from "@/lib/movement-date";
import {
  STOCK_BULK_MAX_ROWS,
  parseStockBulkInput,
  type StockBulkMode,
  type StockBulkReport,
  type StockBulkRowReport,
} from "@/lib/stock-bulk";

function revalidateStock() {
  revalidatePath("/warehouse/stock");
  revalidatePath("/warehouse/stock/ledger");
  revalidatePath("/reports/stock-summary");
  revalidatePath("/reports/stock-ledger");
  revalidatePath("/dashboard");
}

/**
 * The day the stock actually moved. Back-dating is allowed (stock is often typed
 * in the next morning), a future date is not.
 */
function movementDateFrom(formData: FormData): Date {
  return movementDateFromInput(str(formData, "movementDate"));
}

/** Rule 7 - opening stock (once per warehouse + product). */
export async function openingStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("stock.opening");
    const input = stockOpeningSchema.parse({
      warehouseCode: str(formData, "warehouseCode"),
      productCode: str(formData, "productCode"),
      qtyMt: str(formData, "qtyMt"),
      note: str(formData, "note"),
      movementDate: str(formData, "movementDate") || undefined,
    });

    const prisma = (await import("@/lib/prisma")).default;
    const balanceId = await prisma.$transaction(async (tx) =>
      openingStock(tx, {
        warehouseCode: input.warehouseCode,
        productCode: input.productCode,
        qtyMt: input.qtyMt,
        note: input.note ?? "Opening stock",
        movementDate: movementDateFrom(formData),
        refType: "opening",
        userId: user.id,
        userName: user.name,
        ip: await getClientIp(),
        auditAction: "CREATE",
      }),
    );

    revalidateStock();
    return actionOk(`Opening stock recorded (${input.qtyMt} MT). Ledger ${balanceId.ledgerId}.`);
  } catch (error) {
    return actionFailure(error);
  }
}

/** Rule 7 — inward receipt. */
export async function inwardStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("stock.inward");
    const input = stockInwardSchema.parse({
      warehouseCode: str(formData, "warehouseCode"),
      productCode: str(formData, "productCode"),
      qtyMt: str(formData, "qtyMt"),
      reference: str(formData, "reference"),
      note: str(formData, "note"),
      movementDate: str(formData, "movementDate") || undefined,
    });

    const prisma = (await import("@/lib/prisma")).default;
    const result = await prisma.$transaction(async (tx) =>
      inwardStock(tx, {
        warehouseCode: input.warehouseCode,
        productCode: input.productCode,
        qtyMt: input.qtyMt,
        note: [input.reference, input.note].filter(Boolean).join(" - ") || "Inward receipt",
        movementDate: movementDateFrom(formData),
        refType: "inward",
        refId: input.reference ?? null,
        userId: user.id,
        userName: user.name,
        ip: await getClientIp(),
        auditAction: "CREATE",
      }),
    );

    revalidateStock();
    return actionOk(
      `Inward recorded — ${input.qtyMt} MT of ${input.productCode}. New on-hand: ${result.onHandMt} MT.`,
    );
  } catch (error) {
    return actionFailure(error);
  }
}

/** Rule 7 — manual adjustment (administrator only, always audited). */
export async function stockAdjustmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("stock.adjust");
    const input = stockAdjustmentSchema.parse({
      warehouseCode: str(formData, "warehouseCode"),
      productCode: str(formData, "productCode"),
      newOnHandMt: str(formData, "newOnHandMt"),
      reason: str(formData, "reason"),
    });

    const prisma = (await import("@/lib/prisma")).default;
    const result = await prisma.$transaction(async (tx) =>
      adjustToQuantity(tx, {
        warehouseCode: input.warehouseCode,
        productCode: input.productCode,
        targetOnHandMt: input.newOnHandMt,
        reason: input.reason,
        refType: "adjustment",
        userId: user.id,
        userName: user.name,
        ip: await getClientIp(),
        auditAction: "UPDATE",
      }),
    );

    revalidateStock();
    return actionOk(
      result.unchanged
        ? "Stock already matched the entered quantity; nothing changed."
        : `Adjustment applied. On-hand is now ${result.onHandMt} MT.`,
    );
  } catch (error) {
    return actionFailure(error);
  }
}

/** Rule 7 — stock transfer request. */
export async function requestTransferAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("transfer.request");
    const input = transferCreateSchema.parse({
      fromWarehouseCode: str(formData, "fromWarehouseCode"),
      toWarehouseCode: str(formData, "toWarehouseCode"),
      productCode: str(formData, "productCode"),
      qtyMt: str(formData, "qtyMt"),
      reason: str(formData, "reason"),
    });

    const transfer = await requestTransfer(
      input,
      {
        id: user.id,
        name: user.name,
        role: user.role,
        warehouseCode: user.warehouseId,
      },
      await getClientIp(),
    );

    revalidatePath("/warehouse/transfers");
    return actionOk(`Transfer ${transfer.transferNo} requested — awaiting approval.`);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function decideTransferAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("transfer.approve");
    const input = transferDecisionSchema.parse({
      transferId: str(formData, "transferId"),
      approve: bool(formData, "approve"),
      reason: str(formData, "reason"),
    });
    const transfer = await decideTransfer(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );
    revalidatePath("/warehouse/transfers");
    revalidateStock();
    return actionOk(
      input.approve
        ? `Transfer ${transfer.transferNo} approved — quantity reserved at ${transfer.fromWarehouseName}.`
        : `Transfer ${transfer.transferNo} rejected.`,
    );
  } catch (error) {
    return actionFailure(error);
  }
}

export async function markTransferInTransitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("transfer.request");
    const transfer = await markInTransit(
      str(formData, "transferId"),
      { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId },
      await getClientIp(),
    );
    revalidatePath("/warehouse/transfers");
    revalidateStock();
    return actionOk(`Transfer ${transfer.transferNo} is in transit.`);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function receiveTransferAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("transfer.receive");
    const transfer = await receiveTransfer(
      str(formData, "transferId"),
      { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId },
      await getClientIp(),
    );
    revalidatePath("/warehouse/transfers");
    revalidateStock();
    return actionOk(`Transfer ${transfer.transferNo} received at ${transfer.toWarehouseName}.`);
  } catch (error) {
    return actionFailure(error);
  }
}

/** Rule 7 — physical stock count entry. */
export async function createStockCountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("count.create");
    const input = countCreateSchema.parse({
      warehouseCode: str(formData, "warehouseCode"),
      productCode: str(formData, "productCode"),
      physicalQty: str(formData, "physicalQty"),
      reason: str(formData, "reason"),
      remarks: str(formData, "remarks"),
    });
    const count = await createStockCount(
      input,
      { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId },
      await getClientIp(),
    );
    revalidatePath("/warehouse/counts");
    return actionOk(
      `Count ${count.countNo} submitted — difference ${count.difference} MT, awaiting Sales Ops approval.`,
    );
  } catch (error) {
    return actionFailure(error);
  }
}

export async function decideStockCountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requirePermission("count.approve");
    const input = countDecisionSchema.parse({
      countId: str(formData, "countId"),
      approve: bool(formData, "approve"),
      reason: str(formData, "reason"),
    });
    const count = await decideStockCount(
      input,
      { id: user.id, name: user.name, role: user.role },
      await getClientIp(),
    );
    revalidatePath("/warehouse/counts");
    revalidateStock();
    return actionOk(
      input.approve
        ? `Count ${count.countNo} approved — stock adjusted to ${count.physicalQty} MT.`
        : `Count ${count.countNo} rejected.`,
    );
  } catch (error) {
    return actionFailure(error);
  }
}



// ---------------------------------------------------------------------------
// Bulk stock entry (opening balances or a multi-product inward receipt)
// ---------------------------------------------------------------------------

export type StockBulkState = ActionState & { report?: StockBulkReport };

/**
 * Bulk stock entry, two-step like every bulk screen: `commit=false` validates and
 * reports, `commit=true` writes the rows that passed.
 *
 * Opening balances are refused when the warehouse/product already has movements
 * (the one-time rule), and a product repeated in the same list is reported instead
 * of being added twice.
 */
export async function bulkStockEntryAction(
  _prev: StockBulkState,
  formData: FormData,
): Promise<StockBulkState> {
  try {
    const mode: StockBulkMode = str(formData, "mode") === "opening" ? "opening" : "inward";
    const user = await requirePermission(mode === "opening" ? "stock.opening" : "stock.inward");

    // A warehouse user can only ever post into its own warehouse.
    const requested = str(formData, "warehouseCode");
    const warehouseCode = user.role === "WAREHOUSE" ? (user.warehouseId ?? "") : requested;
    if (!warehouseCode) throw errors.validation("Choose a warehouse.");
    if (user.role === "WAREHOUSE" && requested && requested !== user.warehouseId) {
      throw errors.forbidden("stock entry for another warehouse");
    }

    const movementDate = movementDateFrom(formData);
    const commit = bool(formData, "commit");
    const raw = typeof formData.get("text") === "string" ? String(formData.get("text")) : "";
    const parsed = parseStockBulkInput(mode, raw);

    if (parsed.rows.length === 0) {
      return { ok: false, message: "Nothing to import - paste some rows first." };
    }
    if (parsed.rows.length > STOCK_BULK_MAX_ROWS) {
      return {
        ok: false,
        message: `Too many rows (${parsed.rows.length}). Import at most ${STOCK_BULK_MAX_ROWS} rows at a time.`,
      };
    }

    const prisma = (await import("@/lib/prisma")).default;
    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: { code: true },
    });
    const productCodes = new Set(products.map((product) => product.code));

    const withMovements =
      mode === "opening"
        ? new Set(
            (
              await prisma.stockLedger.findMany({
                where: { warehouseId: warehouseCode },
                select: { productCode: true },
                distinct: ["productCode"],
              })
            ).map((row) => row.productCode),
          )
        : new Set<string>();

    const rows: StockBulkRowReport[] = [];
    const seen = new Set<string>();
    let imported = 0;
    let okCount = 0;
    let invalid = 0;
    let duplicates = 0;

    for (const row of parsed.rows) {
      const label = row.productCode || `(line ${row.line})`;

      if (!row.productCode) {
        invalid += 1;
        rows.push({ line: row.line, label, status: "invalid", message: "Product code is required." });
        continue;
      }
      if (!productCodes.has(row.productCode)) {
        invalid += 1;
        rows.push({
          line: row.line,
          label,
          status: "invalid",
          message: `Unknown or inactive product code ${row.productCode}.`,
        });
        continue;
      }

      const qty = positiveQtySchema.safeParse(row.qtyMt);
      if (!qty.success) {
        invalid += 1;
        rows.push({
          line: row.line,
          label,
          status: "invalid",
          message: qty.error.issues[0]?.message ?? "Invalid quantity.",
        });
        continue;
      }

      if (seen.has(row.productCode)) {
        duplicates += 1;
        rows.push({
          line: row.line,
          label,
          status: "duplicate",
          message: `${row.productCode} is repeated in this list.`,
        });
        continue;
      }
      seen.add(row.productCode);

      if (withMovements.has(row.productCode)) {
        duplicates += 1;
        rows.push({
          line: row.line,
          label,
          status: "duplicate",
          message: `${row.productCode} already has stock movements at this warehouse - use an inward entry instead.`,
        });
        continue;
      }

      if (commit) {
        const ip = await getClientIp();
        await prisma.$transaction(async (tx) => {
          if (mode === "opening") {
            await openingStock(tx, {
              warehouseCode,
              productCode: row.productCode,
              qtyMt: qty.data,
              note: row.note || "Opening stock (bulk)",
              movementDate,
              refType: "opening",
              userId: user.id,
              userName: user.name,
              ip,
              auditAction: "CREATE",
            });
          } else {
            await inwardStock(tx, {
              warehouseCode,
              productCode: row.productCode,
              qtyMt: qty.data,
              note: [row.reference, row.note].filter(Boolean).join(" - ") || "Inward receipt (bulk)",
              movementDate,
              refType: "inward",
              refId: row.reference || null,
              userId: user.id,
              userName: user.name,
              ip,
              auditAction: "CREATE",
            });
          }
        });
        imported += 1;
      }

      okCount += 1;
      rows.push({ line: row.line, label, status: "ok" });
    }

    if (commit) revalidateStock();

    const report: StockBulkReport = {
      mode,
      committed: commit,
      imported,
      ok: okCount,
      invalid,
      duplicates,
      rows,
      ignoredColumns: parsed.ignoredColumns,
      usedHeader: parsed.usedHeader,
    };

    const parts = [`${okCount} product${okCount === 1 ? "" : "s"} ready`];
    if (invalid > 0) parts.push(`${invalid} with errors`);
    if (duplicates > 0) parts.push(`${duplicates} skipped`);

    return {
      ok: invalid === 0 && duplicates === 0,
      message: commit
        ? `${imported} product stock line${imported === 1 ? "" : "s"} recorded (${parts.join(", ")}).`
        : `Check complete - ${parts.join(", ")}. Nothing was saved yet.`,
      report,
    };
  } catch (error) {
    return actionFailure(error);
  }
}
