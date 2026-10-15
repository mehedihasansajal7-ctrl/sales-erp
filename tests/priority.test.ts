import { beforeAll, describe, expect, it } from "vitest";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
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

/**
 * Scenarios 2, 3 and 4 (must pass): strict per-customer delivery priority,
 * including the cross-product case and the audited Sales Ops override.
 */
describe("Rule 3 — per-customer delivery priority", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
    await prisma.customer.createMany({
      data: [
        { code: "CUS-OVR", name: "Override Trader" },
        { code: "CUS-SHORT", name: "Short Close Trader" },
        // No credit limit, so these orders approve without an override.
        { code: "CUS-XPROD", name: "Cross Product Trader", creditLimit: null },
      ],
    });
  });

  it("delivers the ABC example in order and unblocks the queue step by step", async () => {
    // ABC places three approved orders: 100 MT, 50 MT, 30 MT.
    const order1 = await createApprovedOrder(ctx, "CUS-ABC", [
      { productCode: "FERT-UREA", qtyMt: "100.000" },
    ]);
    const order2 = await createApprovedOrder(ctx, "CUS-ABC", [
      { productCode: "FERT-UREA", qtyMt: "50.000" },
    ]);
    const order3 = await createApprovedOrder(ctx, "CUS-ABC", [
      { productCode: "FERT-UREA", qtyMt: "30.000" },
    ]);

    const items1 = await orderItemsOf(order1.id);
    const items2 = await orderItemsOf(order2.id);

    // Order-2 cannot get a delivery order while Order-1 is unfinished.
    await expect(
      createDo(ctx, order2.id, "WH-DHK", [{ orderItemId: items2[0]!.id, qtyMt: "10.000" }]),
    ).rejects.toThrowError(/must be completed first/);

    // Deliver 30 MT of Order-1 (partial).
    const do1a = await createDo(ctx, order1.id, "WH-DHK", [
      { orderItemId: items1[0]!.id, qtyMt: "30.000" },
    ]);
    const doItems1a = await doItemsOf(do1a.deliveryOrder.id);
    await dispatch(ctx, do1a.deliveryOrder.id, [{ doItemId: doItems1a[0]!.id, qtyMt: "30.000" }], "CH-1001");

    expect(await orderStatusOf(order1.id)).toBe("PARTIALLY_DELIVERED");

    // Still blocked — 70 MT outstanding.
    await expect(
      createDo(ctx, order2.id, "WH-DHK", [{ orderItemId: items2[0]!.id, qtyMt: "10.000" }]),
    ).rejects.toThrowError(/Remaining: 70\.000 MT/);

    // Deliver the remaining 70 MT of Order-1.
    const do1b = await createDo(ctx, order1.id, "WH-DHK", [
      { orderItemId: items1[0]!.id, qtyMt: "70.000" },
    ]);
    const doItems1b = await doItemsOf(do1b.deliveryOrder.id);
    await dispatch(ctx, do1b.deliveryOrder.id, [{ doItemId: doItems1b[0]!.id, qtyMt: "70.000" }], "CH-1002");

    expect(await orderStatusOf(order1.id)).toBe("COMPLETED");

    // Now Order-2 works, and Order-3 is blocked behind it.
    const items3 = await orderItemsOf(order3.id);
    const do2 = await createDo(ctx, order2.id, "WH-DHK", [
      { orderItemId: items2[0]!.id, qtyMt: "50.000" },
    ]);
    const doItems2 = await doItemsOf(do2.deliveryOrder.id);
    await expect(
      createDo(ctx, order3.id, "WH-DHK", [{ orderItemId: items3[0]!.id, qtyMt: "30.000" }]),
    ).rejects.toThrowError(/must be completed first/);

    await dispatch(ctx, do2.deliveryOrder.id, [{ doItemId: doItems2[0]!.id, qtyMt: "50.000" }], "CH-1003");
    expect(await orderStatusOf(order2.id)).toBe("COMPLETED");

    // Order-3 is now at the head of the queue.
    const do3 = await createDo(ctx, order3.id, "WH-DHK", [
      { orderItemId: items3[0]!.id, qtyMt: "30.000" },
    ]);
    expect(do3.deliveryOrder.doNo).toMatch(/^DO-\d{4}-\d{6}$/);
  });

  it("blocks a newer Coal order behind an older unfinished Fertilizer order of the same customer", async () => {
    const fert = await createApprovedOrder(ctx, "CUS-XPROD", [
      { productCode: "FERT-UREA", qtyMt: "20.000" },
    ]);
    const coal = await createApprovedOrder(ctx, "CUS-XPROD", [
      { productCode: "COAL-IMPORT", qtyMt: "5.000" },
    ]);

    const coalItems = await orderItemsOf(coal.id);
    await expect(
      createDo(ctx, coal.id, "WH-DHK", [{ orderItemId: coalItems[0]!.id, qtyMt: "5.000" }]),
    ).rejects.toThrowError(/must be completed first/);

    // Another customer is not blocked by CUS-XPROD's Fertilizer order.
    const independent = await createApprovedOrder(ctx, "CUS-XYZ", [
      { productCode: "COAL-IMPORT", qtyMt: "5.000" },
    ]);
    const independentItems = await orderItemsOf(independent.id);
    const independentDo = await createDo(ctx, independent.id, "WH-DHK", [
      { orderItemId: independentItems[0]!.id, qtyMt: "5.000" },
    ]);
    expect(independentDo.deliveryOrder.status).toBe("CREATED");

    // Finish the blocking Fertilizer order to prove the block was the cause.
    const fertItems = await orderItemsOf(fert.id);
    const fertDo = await createDo(ctx, fert.id, "WH-DHK", [
      { orderItemId: fertItems[0]!.id, qtyMt: "20.000" },
    ]);
    const fertDoItems = await doItemsOf(fertDo.deliveryOrder.id);
    await dispatch(ctx, fertDo.deliveryOrder.id, [{ doItemId: fertDoItems[0]!.id, qtyMt: "20.000" }], "CH-1004");

    const coalDo = await createDo(ctx, coal.id, "WH-DHK", [
      { orderItemId: coalItems[0]!.id, qtyMt: "5.000" },
    ]);
    expect(coalDo.deliveryOrder.status).toBe("CREATED");
  });

  it("allows a Sales Ops priority override with a mandatory reason and audits it", async () => {
    const blocker = await createApprovedOrder(ctx, "CUS-OVR", [
      { productCode: "FERT-UREA", qtyMt: "10.000" },
    ]);
    const later = await createApprovedOrder(ctx, "CUS-OVR", [
      { productCode: "FERT-UREA", qtyMt: "5.000" },
    ]);

    const laterItems = await orderItemsOf(later.id);

    // No reason -> rejected.
    await expect(
      createDo(ctx, later.id, "WH-DHK", [{ orderItemId: laterItems[0]!.id, qtyMt: "1.000" }], {
        priorityOverride: true,
      }),
    ).rejects.toThrowError(/written reason is mandatory/);

    // With a reason the override works.
    const overridden = await createDo(
      ctx,
      later.id,
      "WH-DHK",
      [{ orderItemId: laterItems[0]!.id, qtyMt: "1.000" }],
      { priorityOverride: true, overrideReason: "Customer vessel is waiting at the port" },
    );
    expect(overridden.deliveryOrder.priorityOverride).toBe(true);
    expect(overridden.priority.blockingOrderNo).toBe(blocker.orderNo);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: "delivery_order", entityId: overridden.deliveryOrder.id, action: "OVERRIDE" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.newValue)).toContain("Customer vessel is waiting at the port");
    expect(JSON.stringify(audit?.newValue)).toContain(blocker.orderNo);

    // The override is also visible in the override report.
    const { priorityOverrideReport } = await import("@/server/services/delivery-order.service");
    const report = await priorityOverrideReport(
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
    );
    expect(report.some((row) => row.doNo === overridden.deliveryOrder.doNo)).toBe(true);
  });

  it("refuses an override when the setting disables it", async () => {
    await setSetting(SETTING_KEYS.priorityOverrideEnabled, "false");
    try {
      const blocker = await createApprovedOrder(ctx, "CUS-ABC", [
        { productCode: "FERT-UREA", qtyMt: "1.000" },
      ]);
      const later = await createApprovedOrder(ctx, "CUS-ABC", [
        { productCode: "FERT-UREA", qtyMt: "1.000" },
      ]);
      const laterItems = await orderItemsOf(later.id);

      await expect(
        createDo(ctx, later.id, "WH-DHK", [{ orderItemId: laterItems[0]!.id, qtyMt: "1.000" }], {
          priorityOverride: true,
          overrideReason: "Trying anyway",
        }),
      ).rejects.toThrowError(/Priority override is disabled/);

      expect(blocker.id).toBeTruthy();
    } finally {
      await setSetting(SETTING_KEYS.priorityOverrideEnabled, "true");
    }
  });

  it("short close unblocks the customer's queue and releases open reservations", async () => {
    const first = await createApprovedOrder(ctx, "CUS-SHORT", [
      { productCode: "FERT-UREA", qtyMt: "100.000" },
    ]);
    const second = await createApprovedOrder(ctx, "CUS-SHORT", [
      { productCode: "FERT-UREA", qtyMt: "10.000" },
    ]);

    const firstItems = await orderItemsOf(first.id);
    const secondItems = await orderItemsOf(second.id);

    // Partial delivery: DO-A ships 10 MT of the 100 MT order.
    const doA = await createDo(ctx, first.id, "WH-DHK", [
      { orderItemId: firstItems[0]!.id, qtyMt: "10.000" },
    ]);
    const doAItems = await doItemsOf(doA.deliveryOrder.id);
    await dispatch(ctx, doA.deliveryOrder.id, [{ doItemId: doAItems[0]!.id, qtyMt: "10.000" }], "CH-1005");
    expect(await orderStatusOf(first.id)).toBe("PARTIALLY_DELIVERED");

    // DO-B is created but not dispatched, so its quantity stays reserved.
    const reservedBeforeDoB = (await balanceOf("WH-DHK", "FERT-UREA")).reservedMt;
    const doB = await createDo(ctx, first.id, "WH-DHK", [
      { orderItemId: firstItems[0]!.id, qtyMt: "20.000" },
    ]);
    const reservedWithDoB = (await balanceOf("WH-DHK", "FERT-UREA")).reservedMt;
    expect(Number(reservedWithDoB)).toBe(Number(reservedBeforeDoB) + 20);

    const { shortCloseOrder } = await import("@/server/services/order.service");
    await shortCloseOrder(
      { orderId: first.id, reason: "Customer cancelled the balance" },
      { id: ctx.ops.id, name: ctx.ops.name, role: "SALES_OPS" },
    );

    expect(await orderStatusOf(first.id)).toBe("SHORT_CLOSED");

    // The open DO was cancelled and its reservation released.
    const cancelledDo = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: doB.deliveryOrder.id } });
    expect(cancelledDo.status).toBe("CANCELLED");
    expect(cancelledDo.cancelReason).toContain("short closed");
    expect((await balanceOf("WH-DHK", "FERT-UREA")).reservedMt).toBe(reservedBeforeDoB);

    // The next order is now deliverable.
    const do2 = await createDo(ctx, second.id, "WH-DHK", [
      { orderItemId: secondItems[0]!.id, qtyMt: "10.000" },
    ]);
    expect(do2.deliveryOrder.status).toBe("CREATED");
  });
});
