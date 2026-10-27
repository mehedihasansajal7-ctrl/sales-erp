import { beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { capReportRows, REPORT_ROW_LIMIT } from "@/server/services/report.service";
import { createOrder } from "@/server/services/order.service";
import { standardContext, type Ctx } from "@/tests/helpers/flows";

/**
 * Production hardening rules:
 *   * only a super admin (ADMIN) may back-date an order - the order date decides
 *     which published rate gets locked, so it is a control, not a convenience;
 *   * a report that hits the row cap is flagged as truncated instead of silently
 *     returning a partial list.
 */
describe("Production rules", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
  });

  it("refuses a back-dated order from a salesperson", async () => {
    await expect(
      createOrder(
        {
          customerCode: "CUS-ABC",
          orderDate: "2026-01-05T10:00",
          items: [{ productCode: "FERT-UREA", qtyMt: "1.000" }],
        },
        { id: ctx.sales.id, name: ctx.sales.name, role: "SALES" },
      ),
    ).rejects.toThrowError(/back-dating|super admin/i);
  });

  it("allows a super admin to back-date, and issues that day's number", async () => {
    await prisma.product.create({
      data: { code: "PRD-BACKDATE", name: "Back-dated product", category: "Test", unit: "MT" },
    });
    await prisma.rate.create({
      data: {
        productCode: "PRD-BACKDATE",
        ratePerMt: "1000.00",
        effectiveFrom: new Date("2026-01-01T00:00:00+06:00"),
        status: "ACTIVE",
        publishedBy: ctx.admin.id,
        createdBy: ctx.admin.id,
      },
    });

    const order = await createOrder(
      {
        customerCode: "CUS-ABC",
        orderDate: "2026-01-05T10:00",
        items: [{ productCode: "PRD-BACKDATE", qtyMt: "2.000" }],
      },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );

    expect(order.orderNo).toContain("05012026");
    expect(order.items[0]?.lockedRatePerMt).toBe("1000.00");
  });

  it("refuses an order dated in the future, even for a super admin", async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16);

    await expect(
      createOrder(
        {
          customerCode: "CUS-ABC",
          orderDate: future,
          items: [{ productCode: "FERT-UREA", qtyMt: "1.000" }],
        },
        { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
      ),
    ).rejects.toThrowError(/future/i);
  });

  it("flags a report result that hit the row cap", () => {
    expect(REPORT_ROW_LIMIT).toBe(5000);

    const exact = capReportRows(Array.from({ length: 5 }, () => ({ a: "1" })), 5);
    expect(exact).toHaveLength(5);
    expect(exact.truncated).toBeUndefined();

    const capped = capReportRows(Array.from({ length: 12 }, (_, i) => ({ a: String(i) })), 10);
    expect(capped).toHaveLength(10);
    expect(capped.truncated).toBe(true);
    // The flag is metadata, not a row: exports/iteration stay clean.
    expect(Object.keys(capped)).toHaveLength(10);
  });

  it("never allows a rate below the published rate", async () => {
    const { createOrder: create, overrideOrderItemRate, editPendingOrder } = await import(
      "@/server/services/order.service"
    );

    const order = await create(
      { customerCode: "CUS-XYZ", items: [{ productCode: "FERT-UREA", qtyMt: "3.000" }] },
      { id: ctx.sales.id, name: ctx.sales.name, role: "SALES" },
    );
    const item = order.items[0]!;
    const published = "50000.00";
    const ops = { id: ctx.ops.id, name: ctx.ops.name, role: "SALES_OPS" };

    // 0.01 below the published rate is refused.
    await expect(
      overrideOrderItemRate(
        { orderItemId: item.id, lockedRatePerMt: "49999.99", reason: "Small discount" },
        ops,
      ),
    ).rejects.toThrowError(/cannot be below the published rate/i);

    // Exactly the published rate is fine, and so is anything above it.
    const kept = await overrideOrderItemRate(
      { orderItemId: item.id, lockedRatePerMt: published, reason: "Keep the published rate" },
      ops,
    );
    expect(kept.lockedRatePerMt).toBe(published);

    const raised = await overrideOrderItemRate(
      { orderItemId: item.id, lockedRatePerMt: "51000.00", reason: "Small-lot premium" },
      ops,
    );
    expect(raised.lockedRatePerMt).toBe("51000.00");

    // The "correct the order" path obeys the same floor.
    await expect(
      editPendingOrder(
        {
          orderId: order.id,
          reason: "Typo correction",
          items: [{ orderItemId: item.id, qtyMt: "3.000", lockedRatePerMt: "49000.00" }],
        },
        ops,
      ),
    ).rejects.toThrowError(/cannot be below the published rate/i);
  });
});
