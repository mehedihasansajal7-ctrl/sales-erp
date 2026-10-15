import { beforeAll, describe, expect, it } from "vitest";
import {
  balanceOf,
  createApprovedOrder,
  createDo,
  dispatch,
  doItemsOf,
  orderItemsOf,
  orderStatusOf,
  prisma,
  standardContext,
  type Ctx,
} from "@/tests/helpers/flows";
import { actor } from "@/tests/helpers/db";

/**
 * Scenario 12 (must pass): stock movements produce correct balances and ledger
 * entries — inward, opening, transfers and physical-count adjustments.
 */
describe("Rule 7 — stock, transfers and physical counts", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
    await prisma.customer.create({ data: { code: "CUS-STK", name: "Stock Trader" } });
  });

  it("rejects a second opening-stock entry for the same warehouse and product", async () => {
    const { openingStock } = await import("@/server/services/stock.service");
    await expect(
      prisma.$transaction(async (tx) =>
        openingStock(tx, {
          warehouseCode: "WH-DHK",
          productCode: "FERT-UREA",
          qtyMt: "10.000",
        }),
      ),
    ).rejects.toThrowError(/Opening stock can only be entered once/);
  });

  it("records inward stock and keeps the ledger balance consistent", async () => {
    const { inwardStock } = await import("@/server/services/stock.service");
    const before = await balanceOf("WH-MGL", "GRAIN-WHEAT");

    const result = await prisma.$transaction(async (tx) =>
      inwardStock(tx, {
        warehouseCode: "WH-MGL",
        productCode: "GRAIN-WHEAT",
        qtyMt: "250.000",
        refType: "inward",
        refId: "LC-2026-1",
        note: "Inward receipt LC-2026-1",
        userId: ctx.warehouse.id,
        userName: ctx.warehouse.name,
      }),
    );

    expect(result.onHandMt).toBe("1750.000");
    expect(Number(result.onHandMt)).toBe(Number(before.onHandMt) + 250);

    const ledger = await prisma.stockLedger.findFirstOrThrow({
      where: { warehouseId: "WH-MGL", productCode: "GRAIN-WHEAT", movementType: "INWARD" },
      orderBy: { createdAt: "desc" },
    });
    expect(ledger.balanceAfter.toFixed(3)).toBe("1750.000");
    expect(ledger.qtyMt.toFixed(3)).toBe("250.000");
  });

  it("moves a transfer REQUESTED → APPROVED → IN_TRANSIT → RECEIVED with correct balances", async () => {
    const { decideTransfer, markInTransit, receiveTransfer, requestTransfer } = await import(
      "@/server/services/transfer.service"
    );

    const fromBefore = await balanceOf("WH-DHK", "COAL-IMPORT");
    const toBefore = await balanceOf("WH-CTG", "COAL-IMPORT");

    const requested = await requestTransfer(
      {
        fromWarehouseCode: "WH-DHK",
        toWarehouseCode: "WH-CTG",
        productCode: "COAL-IMPORT",
        qtyMt: "100.000",
        reason: "Rebalancing between ship points",
      },
      actor(ctx.warehouse, "WH-DHK"),
    );
    expect(requested.status).toBe("REQUESTED");
    expect(requested.transferNo).toMatch(/^TRF-\d{4}-\d{6}$/);

    // Approving reserves the quantity at the source.
    const approved = await decideTransfer(
      { transferId: requested.id, approve: true },
      actor(ctx.ops),
    );
    expect(approved.status).toBe("APPROVED");
    const reservedAtSource = await balanceOf("WH-DHK", "COAL-IMPORT");
    expect(Number(reservedAtSource.reservedMt)).toBe(Number(fromBefore.reservedMt) + 100);

    // Releasing keeps it reserved but marks in transit.
    const inTransit = await markInTransit(requested.id, actor(ctx.warehouse, "WH-DHK"));
    expect(inTransit.status).toBe("IN_TRANSIT");
    const afterRelease = await balanceOf("WH-DHK", "COAL-IMPORT");
    expect(Number(afterRelease.onHandMt)).toBe(Number(fromBefore.onHandMt) - 100);
    expect(Number(afterRelease.reservedMt)).toBe(Number(fromBefore.reservedMt));

    // Receipt adds the stock at the destination.
    const received = await receiveTransfer(requested.id, actor(ctx.warehouseCtg, "WH-CTG"));
    expect(received.status).toBe("RECEIVED");
    const toAfter = await balanceOf("WH-CTG", "COAL-IMPORT");
    expect(Number(toAfter.onHandMt)).toBe(Number(toBefore.onHandMt) + 100);
    expect(toAfter.reservedMt).toBe(toBefore.reservedMt);

    // Ledger rows exist for both sides.
    const outRow = await prisma.stockLedger.findFirst({
      where: { refType: "stock_transfer", refId: requested.id, movementType: "TRANSFER_OUT" },
    });
    const inRow = await prisma.stockLedger.findFirst({
      where: { refType: "stock_transfer", refId: requested.id, movementType: "TRANSFER_IN" },
    });
    expect(outRow).not.toBeNull();
    expect(inRow).not.toBeNull();

    // Illegal transitions are refused.
    await expect(markInTransit(requested.id, actor(ctx.warehouse, "WH-DHK"))).rejects.toThrowError(
      /Cannot move stock transfer/,
    );
  });

  it("refuses a transfer larger than the available quantity", async () => {
    const { requestTransfer } = await import("@/server/services/transfer.service");
    await expect(
      requestTransfer(
        {
          fromWarehouseCode: "WH-MGL",
          toWarehouseCode: "WH-DHK",
          productCode: "FERT-UREA",
          qtyMt: "100000.000",
        },
        actor(ctx.warehouse, "WH-MGL"),
      ),
    ).rejects.toThrowError(/is available at/);
  });

  it("refuses a transfer out of another warehouse", async () => {
    const { requestTransfer } = await import("@/server/services/transfer.service");
    await expect(
      requestTransfer(
        {
          fromWarehouseCode: "WH-CTG",
          toWarehouseCode: "WH-DHK",
          productCode: "COAL-IMPORT",
          qtyMt: "1.000",
        },
        actor(ctx.warehouse, "WH-DHK"),
      ),
    ).rejects.toThrowError(/not allowed to perform/);
  });

  it("applies an approved physical-count difference as an ADJUSTMENT ledger row", async () => {
    const { createStockCount, decideStockCount } = await import(
      "@/server/services/stock-count.service"
    );
    const before = await balanceOf("WH-MGL", "COAL-IMPORT");

    const count = await createStockCount(
      {
        warehouseCode: "WH-MGL",
        productCode: "COAL-IMPORT",
        physicalQty: "7990.000",
        reason: "Physical count found a small shortage",
      },
      actor(ctx.warehouse, "WH-MGL"),
    );
    expect(count.systemQty).toBe(before.onHandMt);
    expect(count.difference).toBe("-10.000");
    expect(count.status).toBe("PENDING_APPROVAL");

    // Approving with a difference requires a reason.
    await expect(
      decideStockCount({ countId: count.id, approve: true }, actor(ctx.ops)),
    ).rejects.toThrowError(/reason is required/);

    const approved = await decideStockCount(
      { countId: count.id, approve: true, reason: "Shortage confirmed by the surveyor" },
      actor(ctx.ops),
    );
    expect(approved.status).toBe("APPROVED");

    const after = await balanceOf("WH-MGL", "COAL-IMPORT");
    expect(after.onHandMt).toBe("7990.000");

    const adjustment = await prisma.stockLedger.findFirstOrThrow({
      where: { refType: "stock_count", refId: count.id, movementType: "ADJUSTMENT" },
    });
    expect(adjustment.qtyMt.toFixed(3)).toBe("-10.000");
    expect(adjustment.balanceAfter.toFixed(3)).toBe("7990.000");
  });

  it("refuses an adjustment that would push stock below the reserved quantity", async () => {
    const { createStockCount, decideStockCount } = await import(
      "@/server/services/stock-count.service"
    );

    const bigOrder = await createApprovedOrder(ctx, "CUS-STK", [
      { productCode: "COAL-IMPORT", qtyMt: "5000.000" },
    ]);
    expect(bigOrder.status).toBe("APPROVED");

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: bigOrder.id },
      include: { items: true },
    });
    await createDo(ctx, order.id, "WH-MGL", [
      { orderItemId: order.items[0]!.id, qtyMt: "5000.000" },
    ]);
    expect((await balanceOf("WH-MGL", "COAL-IMPORT")).reservedMt).toBe("5000.000");

    const count = await createStockCount(
      {
        warehouseCode: "WH-MGL",
        productCode: "COAL-IMPORT",
        physicalQty: "1000.000",
        reason: "Suspected large shortage",
      },
      actor(ctx.warehouse, "WH-MGL"),
    );

    await expect(
      decideStockCount(
        { countId: count.id, approve: true, reason: "Confirmed shortage" },
        actor(ctx.ops),
      ),
    ).rejects.toThrowError(/below the .* reserved/);

    // The count stays pending; nothing was adjusted.
    const stillPending = await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id } });
    expect(stillPending.status).toBe("PENDING_APPROVAL");
    expect((await balanceOf("WH-MGL", "COAL-IMPORT")).onHandMt).toBe("7990.000");
  });

  it("produces the stock summary and difference report from real movements", async () => {
    const { stockSummary } = await import("@/server/services/stock.service");
    const { stockDifferenceReport } = await import("@/server/services/stock-count.service");

    const summary = await stockSummary();
    const dhkCoal = summary.find(
      (row) => row.warehouseCode === "WH-DHK" && row.productCode === "COAL-IMPORT",
    );
    expect(dhkCoal).toBeTruthy();
    expect(Number(dhkCoal?.onHandMt)).toBeGreaterThan(0);

    const differences = await stockDifferenceReport(
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
    );
    expect(differences.length).toBeGreaterThanOrEqual(1);
    expect(differences.some((row) => row.difference === "-10.000")).toBe(true);
  });

  it("keeps a partially delivered order blocked while its DO is only reserved", async () => {
    await prisma.customer.create({ data: { code: "CUS-PART", name: "Partial Trader" } });
    const order = await createApprovedOrder(ctx, "CUS-PART", [
      { productCode: "FERT-UREA", qtyMt: "10.000" },
    ]);
    const items = await orderItemsOf(order.id);
    const doResult = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "4.000" },
    ]);
    const doItems = await doItemsOf(doResult.deliveryOrder.id);
    await dispatch(ctx, doResult.deliveryOrder.id, [{ doItemId: doItems[0]!.id, qtyMt: "4.000" }], "CH-STK-1");

    expect(await orderStatusOf(order.id)).toBe("PARTIALLY_DELIVERED");
    const remaining = await prisma.orderItem.findUniqueOrThrow({ where: { id: items[0]!.id } });
    expect(remaining.deliveredMt.toFixed(3)).toBe("4.000");
    expect(remaining.doAllocatedMt.toFixed(3)).toBe("4.000");
  });
});
