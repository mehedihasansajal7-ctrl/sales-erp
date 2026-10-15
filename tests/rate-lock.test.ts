import { beforeAll, describe, expect, it } from "vitest";
import { publishRate } from "@/tests/helpers/db";
import {
  createApprovedOrder,
  createOrder,
  orderItemsOf,
  prisma,
  standardContext,
  type Ctx,
} from "@/tests/helpers/flows";

/**
 * Scenario 1 (must pass): the rate is locked into the order.
 * An order at ৳50,000/MT keeps ৳50,000 after Finance publishes ৳49,000,
 * while a new order gets ৳49,000.
 */
describe("Rule 1 — rate lock", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
  });

  it("copies the current rate into the order and never changes it afterwards", async () => {
    const first = await createOrder(ctx, "CUS-XYZ", [
      { productCode: "FERT-UREA", qtyMt: "100.000" },
    ]);
    const firstItems = await orderItemsOf(first.id);
    expect(firstItems[0]?.lockedRatePerMt.toFixed(2)).toBe("50000.00");
    expect(firstItems[0]?.lineValue.toFixed(2)).toBe("5000000.00");
    expect(first.totalValue).toBe("5000000.00");
    expect(first.orderNo).toMatch(/^ORD-\d{4}-\d{6}$/);

    // Finance publishes a lower rate.
    await publishRate("FERT-UREA", "49000.00", ctx.finance.id);

    // The existing order is untouched.
    const afterPublish = await orderItemsOf(first.id);
    expect(afterPublish[0]?.lockedRatePerMt.toFixed(2)).toBe("50000.00");
    expect(afterPublish[0]?.lineValue.toFixed(2)).toBe("5000000.00");

    // A new order picks up the new rate.
    const second = await createOrder(ctx, "CUS-XYZ", [
      { productCode: "FERT-UREA", qtyMt: "100.000" },
    ]);
    const secondItems = await orderItemsOf(second.id);
    expect(secondItems[0]?.lockedRatePerMt.toFixed(2)).toBe("49000.00");
    expect(second.orderNo).not.toBe(first.orderNo);
  });

  it("keeps the full rate history instead of editing rates in place", async () => {
    const history = await prisma.rate.findMany({
      where: { productCode: "FERT-UREA" },
      orderBy: { effectiveFrom: "asc" },
    });
    expect(history.length).toBeGreaterThanOrEqual(2);
    // Exactly one live rate per product; the rest is history.
    expect(history.filter((rate) => rate.status === "ACTIVE")).toHaveLength(1);
    expect(history.filter((rate) => rate.status === "SUPERSEDED").length).toBe(history.length - 1);
    // The newest row is the live one and every row keeps its own amount.
    expect(history[history.length - 1]?.ratePerMt.toFixed(2)).toBe("49000.00");
    expect(history[0]?.ratePerMt.toFixed(2)).toBe("50000.00");
  });

  it("blocks an order for a product with no published rate", async () => {
    await prisma.product.create({
      data: { code: "COAL-NEW", name: "New Coal", category: "Coal", unit: "MT" },
    });
    await expect(
      createOrder(ctx, "CUS-XYZ", [{ productCode: "COAL-NEW", qtyMt: "10.000" }]),
    ).rejects.toThrowError(/No published rate for product New Coal/);
  });

  it("assigns a per-customer order sequence for delivery priority", async () => {
    const orderA = await createApprovedOrder(ctx, "CUS-ABC", [
      { productCode: "FERT-UREA", qtyMt: "10.000" },
    ]);
    const orderB = await createApprovedOrder(ctx, "CUS-ABC", [
      { productCode: "FERT-UREA", qtyMt: "10.000" },
    ]);
    const other = await createApprovedOrder(ctx, "CUS-SMALL", [
      { productCode: "FERT-UREA", qtyMt: "10.000" },
    ]);

    expect(orderB.orderSeq).toBe(orderA.orderSeq + 1);
    // Sequence is per customer, so another customer starts at 1.
    expect(other.orderSeq).toBe(1);
  });

  it("records the rate publication in the audit log", async () => {
    const entries = await prisma.auditLog.findMany({ where: { entity: "rate", action: "PUBLISH" } });
    expect(entries.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(entries[0]?.newValue)).toContain("ratePerMt");
  });
});
