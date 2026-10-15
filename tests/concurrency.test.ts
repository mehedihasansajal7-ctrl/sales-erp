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

/**
 * Scenario 9 (must pass): concurrency.
 * Firing many parallel dispatch (and DO) requests must never over-allocate,
 * over-dispatch or bypass the priority rule.
 */
describe("Concurrency — parallel writes stay within the limits", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
    await prisma.customer.createMany({
      data: [
        { code: "CUS-CON1", name: "Concurrent Trader 1" },
        { code: "CUS-CON2", name: "Concurrent Trader 2" },
      ],
    });
  });

  it("20 parallel partial dispatches on one DO never exceed its quantity", async () => {
    const order = await createApprovedOrder(ctx, "CUS-CON1", [
      { productCode: "FERT-UREA", qtyMt: "100.000" },
    ]);
    const items = await orderItemsOf(order.id);
    const doResult = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "100.000" },
    ]);
    const doId = doResult.deliveryOrder.id;
    const doItems = await doItemsOf(doId);

    // 20 requests of 10 MT each = 200 MT requested against a 100 MT DO.
    const attempts = Array.from({ length: 20 }, (_, index) =>
      dispatch(ctx, doId, [{ doItemId: doItems[0]!.id, qtyMt: "10.000" }], `CH-CON-${index}`).then(
        () => ({ ok: true as const }),
        (error: Error) => ({ ok: false as const, message: error.message }),
      ),
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.filter((result) => !result.ok);

    expect(succeeded).toBe(10);
    expect(failed).toHaveLength(10);
    // Every rejection is a correct guard: either the quantity was exhausted or
    // the DO had already moved to DISPATCHED by the time the request arrived.
    expect(
      failed.every(
        (result) =>
          !result.ok &&
          (/MT is left to dispatch/.test(result.message) ||
            /Cannot move delivery order/.test(result.message)),
      ),
    ).toBe(true);

    const finalDo = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: doId } });
    const finalItems = await doItemsOf(doId);
    expect(finalItems[0]!.dispatchedMt.toFixed(3)).toBe("100.000");
    expect(finalDo.status).toBe("DISPATCHED");
    expect(await orderStatusOf(order.id)).toBe("COMPLETED");

    // Ledger and balance agree with the counters.
    const balance = await balanceOf("WH-DHK", "FERT-UREA");
    expect(balance.reservedMt).toBe("0.000");
    const ledger = await prisma.stockLedger.aggregate({
      where: { warehouseId: "WH-DHK", productCode: "FERT-UREA", movementType: "OUTWARD" },
      _sum: { qtyMt: true },
    });
    expect(Number(ledger._sum.qtyMt?.abs().toFixed(3) ?? 0)).toBeGreaterThanOrEqual(100);
  });

  it("parallel DO creation cannot allocate more than the order quantity", async () => {
    const order = await createApprovedOrder(ctx, "CUS-CON2", [
      { productCode: "COAL-IMPORT", qtyMt: "100.000" },
    ]);
    const items = await orderItemsOf(order.id);

    // 12 parallel DO creations of 20 MT each against a 100 MT order.
    const attempts = Array.from({ length: 12 }, (_, index) =>
      createDo(ctx, order.id, index % 2 === 0 ? "WH-DHK" : "WH-CTG", [
        { orderItemId: items[0]!.id, qtyMt: "20.000" },
      ]).then(
        () => ({ ok: true as const }),
        (error: Error) => ({ ok: false as const, message: error.message }),
      ),
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((result) => result.ok).length;

    expect(succeeded).toBe(5); // exactly 100 MT

    const allocated = await prisma.deliveryOrderItem.aggregate({
      where: { productCode: "COAL-IMPORT", deliveryOrder: { orderId: order.id, status: { not: "CANCELLED" } } },
      _sum: { qtyMt: true },
    });
    expect(allocated._sum.qtyMt?.toFixed(3)).toBe("100.000");

    const orderItem = await prisma.orderItem.findUniqueOrThrow({ where: { id: items[0]!.id } });
    expect(orderItem.doAllocatedMt.toFixed(3)).toBe("100.000");

    const failures = results.filter((result) => !result.ok);
    expect(
      failures.every((result) => !result.ok && /MT is left to allocate/.test(result.message)),
    ).toBe(true);
  });

  it("parallel dispatches for a blocked order never bypass the priority rule", async () => {
    await prisma.customer.create({ data: { code: "CUS-CON3", name: "Concurrent Trader 3" } });
    const blocking = await createApprovedOrder(ctx, "CUS-CON3", [
      { productCode: "COAL-IMPORT", qtyMt: "50.000" },
    ]);
    const blocked = await createApprovedOrder(ctx, "CUS-CON3", [
      { productCode: "COAL-IMPORT", qtyMt: "50.000" },
    ]);

    const blockingItems = await orderItemsOf(blocking.id);
    const blockedItems = await orderItemsOf(blocked.id);

    // The blocked order gets a DO through an explicit override...
    const blockedDo = await createDo(
      ctx,
      blocked.id,
      "WH-DHK",
      [{ orderItemId: blockedItems[0]!.id, qtyMt: "10.000" }],
      { priorityOverride: true, overrideReason: "Urgent vessel" },
    );

    // ...but once the override is switched off, the queued dispatch is refused.
    const { setSetting, SETTING_KEYS } = await import("@/lib/settings");
    await setSetting(SETTING_KEYS.priorityOverrideEnabled, "false");
    try {
      const doItems = await doItemsOf(blockedDo.deliveryOrder.id);
      const attempts = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          dispatch(
            ctx,
            blockedDo.deliveryOrder.id,
            [{ doItemId: doItems[0]!.id, qtyMt: "1.000" }],
            `CH-BLOCK-${index}`,
          ).then(
            () => ({ ok: true as const }),
            (error: Error) => ({ ok: false as const, message: error.message }),
          ),
        ),
      );
      expect(attempts.every((attempt) => !attempt.ok)).toBe(true);
      expect(
        attempts.every((attempt) => !attempt.ok && /disabled/.test(attempt.message)),
      ).toBe(true);
    } finally {
      await setSetting(SETTING_KEYS.priorityOverrideEnabled, "true");
    }

    // Nothing was dispatched for the blocked order.
    const doItemsAfter = await doItemsOf(blockedDo.deliveryOrder.id);
    expect(doItemsAfter[0]!.dispatchedMt.toFixed(3)).toBe("0.000");

    // The head of the queue still works.
    const blockingDo = await createDo(ctx, blocking.id, "WH-DHK", [
      { orderItemId: blockingItems[0]!.id, qtyMt: "50.000" },
    ]);
    const blockingDoItems = await doItemsOf(blockingDo.deliveryOrder.id);
    await dispatch(
      ctx,
      blockingDo.deliveryOrder.id,
      [{ doItemId: blockingDoItems[0]!.id, qtyMt: "50.000" }],
      "CH-HEAD-1",
    );
    expect(await orderStatusOf(blocking.id)).toBe("COMPLETED");
  });
});
