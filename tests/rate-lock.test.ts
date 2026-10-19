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
    expect(first.orderNo).toMatch(/^SO-\d{2}-\d{2}-\d{4}-\d{3}$/);

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

  it("keeps a rate valid until the next one is published, then supersedes it", async () => {
    // A brand-new product with a single rate: no end date is required.
    await prisma.product.create({
      data: { code: "GRAIN-RICE", name: "Rice", category: "Grain", unit: "MT" },
    });
    await publishRate("GRAIN-RICE", "38000.00", ctx.finance.id);

    const { findCurrentRate } = await import("@/server/services/rate.service");
    const before = await findCurrentRate(prisma, "GRAIN-RICE");
    expect(before?.ratePerMt.toFixed(2)).toBe("38000.00");
    expect(before?.effectiveTo).toBeNull();

    // An order written now locks 38,000.
    const first = await createOrder(ctx, "CUS-XYZ", [
      { productCode: "GRAIN-RICE", qtyMt: "5.000" },
    ]);
    expect((await orderItemsOf(first.id))[0]?.lockedRatePerMt.toFixed(2)).toBe("38000.00");

    // Finance publishes the next rate -> the previous one is superseded.
    await publishRate("GRAIN-RICE", "39500.00", ctx.finance.id);
    const after = await findCurrentRate(prisma, "GRAIN-RICE");
    expect(after?.ratePerMt.toFixed(2)).toBe("39500.00");

    const history = await prisma.rate.findMany({
      where: { productCode: "GRAIN-RICE" },
      orderBy: { effectiveFrom: "asc" },
    });
    expect(history).toHaveLength(2);
    expect(history[0]?.status).toBe("SUPERSEDED");
    expect(history[1]?.status).toBe("ACTIVE");

    // The earlier order keeps its locked rate; a new order gets the new one.
    expect((await orderItemsOf(first.id))[0]?.lockedRatePerMt.toFixed(2)).toBe("38000.00");
    const second = await createOrder(ctx, "CUS-XYZ", [
      { productCode: "GRAIN-RICE", qtyMt: "5.000" },
    ]);
    expect((await orderItemsOf(second.id))[0]?.lockedRatePerMt.toFixed(2)).toBe("39500.00");
  });

  it("supports an explicit validity window and blocks orders once it has expired", async () => {
    const { publishRate: publish } = await import("@/server/services/rate.service");
    await prisma.product.create({
      data: { code: "FERT-DAP", name: "DAP Fertilizer", category: "Fertilizer", unit: "MT" },
    });

    // A window that ended one hour ago.
    const from = new Date(Date.now() - 6 * 3600_000).toISOString();
    const to = new Date(Date.now() - 3600_000).toISOString();
    await publish(
      {
        productCode: "FERT-DAP",
        ratePerMt: "52000.00",
        effectiveFrom: from,
        effectiveTo: to,
      },
      { id: ctx.finance.id, name: "FINANCE User", role: "FINANCE" },
    );

    const { findCurrentRate } = await import("@/server/services/rate.service");
    expect(await findCurrentRate(prisma, "FERT-DAP")).toBeNull();

    await expect(
      createOrder(ctx, "CUS-XYZ", [{ productCode: "FERT-DAP", qtyMt: "1.000" }]),
    ).rejects.toThrowError(/expired on .*Finance must publish a new rate/);

    // Publishing a fresh window makes it usable again.
    await publish(
      {
        productCode: "FERT-DAP",
        ratePerMt: "53000.00",
        effectiveFrom: new Date().toISOString(),
      },
      { id: ctx.finance.id, name: "FINANCE User", role: "FINANCE" },
    );
    const order = await createOrder(ctx, "CUS-XYZ", [
      { productCode: "FERT-DAP", qtyMt: "1.000" },
    ]);
    expect((await orderItemsOf(order.id))[0]?.lockedRatePerMt.toFixed(2)).toBe("53000.00");
  });

  it("rejects a validity window that ends before it starts", async () => {
    const { publishRate: publish } = await import("@/server/services/rate.service");
    await expect(
      publish(
        {
          productCode: "FERT-UREA",
          ratePerMt: "47000.00",
          effectiveFrom: new Date().toISOString(),
          effectiveTo: new Date(Date.now() - 3600_000).toISOString(),
        },
        { id: ctx.finance.id, name: "FINANCE User", role: "FINANCE" },
      ),
    ).rejects.toThrowError(/Valid until must be after/);
  });
});
