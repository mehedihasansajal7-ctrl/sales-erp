import { beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { movementDateFromInput } from "@/lib/movement-date";
import { toZonedDateString } from "@/lib/dates";
import { parseStockBulkInput } from "@/lib/stock-bulk";
import { openingStock, inwardStock, stockSummary } from "@/server/services/stock.service";
import { standardContext, type Ctx } from "@/tests/helpers/flows";

/**
 * Stock entry improvements (owner request):
 *   (a) the warehouse can record the day the goods actually arrived (back-dating),
 *   (b) several products can be entered in one go (bulk parser).
 */
describe("Stock entry date and bulk parsing", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
  });

  it("keeps the movement date separate from the time the row was typed", async () => {
    const product = "FERT-UREA";
    const backDated = movementDateFromInput("2026-10-05");

    const created = await prisma.$transaction(async (tx) =>
      inwardStock(tx, {
        warehouseCode: "WH-CTG",
        productCode: product,
        qtyMt: "12.000",
        note: "Back-dated receipt",
        movementDate: backDated,
        refType: "inward",
        refId: "TEST-BACKDATE",
        userId: ctx.warehouse.id,
        userName: ctx.warehouse.name,
        auditAction: "CREATE",
      }),
    );

    const ledger = await prisma.stockLedger.findFirstOrThrow({
      where: { warehouseId: "WH-CTG", productCode: product, refId: "TEST-BACKDATE" },
    });

    expect(toZonedDateString(ledger.movementDate)).toBe("2026-10-05");
    // createdAt is "now" - the row was typed today, the goods arrived earlier.
    expect(toZonedDateString(ledger.createdAt)).not.toBe("2026-10-05");
    expect(created.onHandMt).toBe("1012.000");

    // The date is informational only: balances are unaffected.
    const summary = await stockSummary({ warehouseCode: "WH-CTG", productCode: product });
    expect(summary[0]?.onHandMt).toBe("1012.000");
  });

  it("refuses a future entry date but accepts today", () => {
    const now = new Date("2026-10-27T10:00:00+06:00");
    const today = movementDateFromInput("2026-10-27", now);
    expect(today.toISOString()).toBe("2026-10-26T18:00:00.000Z"); // 27 Oct 00:00 Dhaka

    expect(() => movementDateFromInput("2026-10-28", now)).toThrowError(/future/i);
    expect(() => movementDateFromInput("2027-01-01", now)).toThrowError(/future/i);
    // Past dates are fine.
    expect(movementDateFromInput("2025-12-31", now).getUTCFullYear()).toBe(2025);
    // No value means "now".
    expect(movementDateFromInput("", now).getTime()).toBe(now.getTime());
  });

  it("still refuses a second opening balance for the same warehouse and product", async () => {
    await prisma.$transaction(async (tx) =>
      openingStock(tx, {
        warehouseCode: "WH-MGL",
        productCode: "FERT-UREA",
        qtyMt: "5.000",
        note: "First opening",
        movementDate: movementDateFromInput("2026-10-01"),
        userId: ctx.warehouse.id,
        userName: ctx.warehouse.name,
      }),
    );

    await expect(
      prisma.$transaction(async (tx) =>
        openingStock(tx, {
          warehouseCode: "WH-MGL",
          productCode: "FERT-UREA",
          qtyMt: "9.000",
          note: "Second opening",
          userId: ctx.warehouse.id,
          userName: ctx.warehouse.name,
        }),
      ),
    ).rejects.toThrowError(/once per warehouse and product/i);
  });

  it("parses a pasted list with a header row", () => {
    const parsed = parseStockBulkInput(
      "inward",
      "Product code\tQuantity (MT)\tReference\tNote\nFERT-UREA\t250\tLC-1\ncoal-import\t1,200.5\tLC-2\tVessel A",
    );

    expect(parsed.usedHeader).toBe(true);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      productCode: "FERT-UREA",
      qtyMt: "250",
      reference: "LC-1",
    });
    // Codes are upper-cased and thousands separators are removed.
    expect(parsed.rows[1]).toMatchObject({
      productCode: "COAL-IMPORT",
      qtyMt: "1200.5",
      note: "Vessel A",
    });
  });

  it("parses a header-less list in the documented column order", () => {
    const parsed = parseStockBulkInput("opening", "FERT-UREA,500.000,Opening as at go-live");

    expect(parsed.usedHeader).toBe(false);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      line: 1,
      productCode: "FERT-UREA",
      qtyMt: "500.000",
      note: "Opening as at go-live",
    });
  });

  it("maps CSV columns by name regardless of order", () => {
    const parsed = parseStockBulkInput("opening", "Quantity (MT),Code\n80,GRAIN-WHEAT");

    expect(parsed.rows[0]).toMatchObject({ productCode: "GRAIN-WHEAT", qtyMt: "80" });
  });
});
