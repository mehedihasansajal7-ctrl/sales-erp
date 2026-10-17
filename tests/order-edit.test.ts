import { beforeAll, describe, expect, it } from "vitest";
import { roleHasPermission } from "@/lib/rbac";
import { approveOrder, editPendingOrder, orderProgress } from "@/server/services/order.service";
import { actor, createOrder, standardContext, type Ctx } from "@/tests/helpers/flows";
import prisma from "@/lib/prisma";

/**
 * "Edit order before approval" — the flow the product owner asked for: a
 * salesperson's typo (a missing zero in the rate, a wrong MT quantity) is
 * corrected by Sales Ops instead of rejecting the order and re-entering it.
 */
describe("Sales Ops can correct a pending order", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
    await prisma.customer.create({ data: { code: "CUS-EDIT", name: "Edit Trader" } });
  });

  it("is a Sales Ops / Admin permission only", () => {
    expect(roleHasPermission("SALES_OPS", "order.editPending")).toBe(true);
    expect(roleHasPermission("ADMIN", "order.editPending")).toBe(true);
    expect(roleHasPermission("SALES", "order.editPending")).toBe(false);
    expect(roleHasPermission("FINANCE", "order.editPending")).toBe(false);
    expect(roleHasPermission("WAREHOUSE", "order.editPending")).toBe(false);
    expect(roleHasPermission("MANAGEMENT", "order.editPending")).toBe(false);
  });

  it("corrects a quantity typo and recalculates the line and the order total", async () => {
    const order = await createOrder(ctx, "CUS-EDIT", [{ productCode: "FERT-UREA", qtyMt: "100.000" }]);
    const line = (await prisma.orderItem.findMany({ where: { orderId: order.id } }))[0]!;
    expect(order.totalValue).toBe("5000000.00"); // 100 MT x 50,000 (the rate published by the fixture)

    const result = await editPendingOrder(
      {
        orderId: order.id,
        reason: "Quantity entered as 100 MT, confirmed 50 MT on the phone",
        items: [{ orderItemId: line.id, qtyMt: "50.000", lockedRatePerMt: line.lockedRatePerMt.toFixed(2) }],
      },
      actor(ctx.ops),
    );

    expect(result.changedLines).toBe(1);
    expect(result.order.totalValue).toBe("2500000.00");
    expect(result.order.orderedMt).toBe("50.000");

    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(after.qtyMt.toFixed(3)).toBe("50.000");
    expect(after.lineValue.toFixed(2)).toBe("2500000.00");
    expect(after.rateOverridden).toBe(false); // only the quantity moved

    // The change is audited with the reason and both values.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entity: "order", entityId: order.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    const payload = JSON.stringify(audit.newValue);
    expect(payload).toContain("Quantity entered as 100 MT");
    expect(payload).toContain("50.000");
    expect(JSON.stringify(audit.oldValue)).toContain("100.000");
  });

  it("corrects a rate typo and keeps the override marker + reason", async () => {
    const order = await createOrder(ctx, "CUS-EDIT", [{ productCode: "COAL-IMPORT", qtyMt: "10.000" }]);
    const line = (await prisma.orderItem.findMany({ where: { orderId: order.id } }))[0]!;
    expect(line.lockedRatePerMt.toFixed(2)).toBe("20000.00");

    const result = await editPendingOrder(
      {
        orderId: order.id,
        reason: "Rate entered with one zero missing; corrected to the published rate",
        items: [{ orderItemId: line.id, qtyMt: "10.000", lockedRatePerMt: "18000.00" }],
      },
      actor(ctx.ops),
    );

    expect(result.order.totalValue).toBe("180000.00");
    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(after.lockedRatePerMt.toFixed(2)).toBe("18000.00");
    expect(after.rateOverridden).toBe(true);
    expect(after.overrideReason).toContain("missing");
  });

  it("updates the remarks too, and refuses a no-op edit", async () => {
    const order = await createOrder(ctx, "CUS-EDIT", [{ productCode: "GRAIN-WHEAT", qtyMt: "5.000" }]);
    const line = (await prisma.orderItem.findMany({ where: { orderId: order.id } }))[0]!;

    await expect(
      editPendingOrder(
        {
          orderId: order.id,
          reason: "nothing to do",
          items: [{ orderItemId: line.id, qtyMt: "5.000", lockedRatePerMt: line.lockedRatePerMt.toFixed(2) }],
        },
        actor(ctx.ops),
      ),
    ).rejects.toThrowError(/Nothing was changed/);

    const result = await editPendingOrder(
      {
        orderId: order.id,
        reason: "Delivery instruction added after the customer called",
        remarks: "Deliver to the mill gate before 4 pm",
        items: [{ orderItemId: line.id, qtyMt: "5.000", lockedRatePerMt: line.lockedRatePerMt.toFixed(2) }],
      },
      actor(ctx.ops),
    );
    expect(result.remarksChanged).toBe(true);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.remarks).toContain("before 4 pm");
  });

  it("refuses to edit an order that is no longer pending", async () => {
    const order = await createOrder(ctx, "CUS-EDIT", [{ productCode: "FERT-UREA", qtyMt: "2.000" }]);
    const line = (await prisma.orderItem.findMany({ where: { orderId: order.id } }))[0]!;
    await approveOrder({ orderId: order.id }, actor(ctx.ops));

    await expect(
      editPendingOrder(
        {
          orderId: order.id,
          reason: "trying after approval",
          items: [{ orderItemId: line.id, qtyMt: "3.000", lockedRatePerMt: "45000.00" }],
        },
        actor(ctx.ops),
      ),
    ).rejects.toThrowError(/Only a pending order can be edited/);
  });

  it("rejects zero/negative quantities and unknown lines", async () => {
    const order = await createOrder(ctx, "CUS-EDIT", [{ productCode: "FERT-UREA", qtyMt: "1.000" }]);
    const line = (await prisma.orderItem.findMany({ where: { orderId: order.id } }))[0]!;

    await expect(
      editPendingOrder(
        {
          orderId: order.id,
          reason: "cannot be zero",
          items: [{ orderItemId: line.id, qtyMt: "0.000", lockedRatePerMt: "45000.00" }],
        },
        actor(ctx.ops),
      ),
    ).rejects.toThrowError(/greater than zero/);

    await expect(
      editPendingOrder(
        {
          orderId: order.id,
          reason: "line from another order",
          items: [{ orderItemId: "does-not-exist", qtyMt: "1.000", lockedRatePerMt: "45000.00" }],
        },
        actor(ctx.ops),
      ),
    ).rejects.toThrowError(/was not found/);
  });

  it("approves the corrected order with the corrected numbers", async () => {
    const order = await createOrder(ctx, "CUS-EDIT", [{ productCode: "FERT-UREA", qtyMt: "100.000" }]);
    const line = (await prisma.orderItem.findMany({ where: { orderId: order.id } }))[0]!;

    await editPendingOrder(
      {
        orderId: order.id,
        reason: "Customer confirmed 40 MT",
        items: [{ orderItemId: line.id, qtyMt: "40.000", lockedRatePerMt: "45000.00" }],
      },
      actor(ctx.ops),
    );

    const approved = await approveOrder({ orderId: order.id }, actor(ctx.ops));
    expect(approved.order.status).toBe("APPROVED");
    expect(approved.order.totalValue).toBe("1800000.00");
    expect(orderProgress(approved.order.items).orderedMt).toBe("40.000");
  });
});
