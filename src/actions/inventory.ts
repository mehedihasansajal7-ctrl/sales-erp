"use server";

import { revalidatePath } from "next/cache";
import { getClientIp, requirePermission } from "@/lib/auth";
import {
  countCreateSchema,
  countDecisionSchema,
  stockAdjustmentSchema,
  stockInwardSchema,
  stockOpeningSchema,
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

function revalidateStock() {
  revalidatePath("/warehouse/stock");
  revalidatePath("/warehouse/stock/ledger");
  revalidatePath("/reports/stock-summary");
  revalidatePath("/reports/stock-ledger");
  revalidatePath("/dashboard");
}

/** Rule 7 — opening stock (once per warehouse + product). */
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
    });

    const prisma = (await import("@/lib/prisma")).default;
    const balanceId = await prisma.$transaction(async (tx) =>
      openingStock(tx, {
        warehouseCode: input.warehouseCode,
        productCode: input.productCode,
        qtyMt: input.qtyMt,
        note: input.note ?? "Opening stock",
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
    });

    const prisma = (await import("@/lib/prisma")).default;
    const result = await prisma.$transaction(async (tx) =>
      inwardStock(tx, {
        warehouseCode: input.warehouseCode,
        productCode: input.productCode,
        qtyMt: input.qtyMt,
        note: [input.reference, input.note].filter(Boolean).join(" — ") || "Inward receipt",
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


