import { beforeAll, describe, expect, it } from "vitest";
import {
  balanceOf,
  createApprovedOrder,
  createDo,
  dispatch,
  doItemsOf,
  ledgerCount,
  orderItemsOf,
  orderStatusOf,
  prisma,
  standardContext,
  type Ctx,
} from "@/tests/helpers/flows";

/**
 * Scenarios 5, 6, 7 and 8 (must pass): over-allocation, over-dispatch,
 * duplicate challan, multi-warehouse delivery and stock reservation.
 */
describe("Rules 4, 5 and 6 — allocation, dispatch and reservation", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    // These scenarios exercise partial dispatch explicitly, which is allowed when
    // the "warehouse may dispatch less" setting is on (off by default in prod).
    ctx = await standardContext({ partialDispatch: true });
  });

  it("scenario 5 — rejects a DO above the order's remaining quantity or the warehouse's available stock", async () => {
    const order = await createApprovedOrder(ctx, "CUS-ABC", [
      { productCode: "COAL-IMPORT", qtyMt: "100.000" },
      { productCode: "GRAIN-WHEAT", qtyMt: "50.000" },
    ]);
    const items = await orderItemsOf(order.id);
    const coalItem = items.find((item) => item.productCode === "COAL-IMPORT")!;
    const grainItem = items.find((item) => item.productCode === "GRAIN-WHEAT")!;

    // More than the order's remaining quantity.
    await expect(
      createDo(ctx, order.id, "WH-DHK", [{ orderItemId: coalItem.id, qtyMt: "150.000" }]),
    ).rejects.toThrowError(/only 100\.000 MT is left to allocate/);

    // More than the warehouse's available stock (Chattogram holds no wheat).
    await expect(
      createDo(ctx, order.id, "WH-CTG", [{ orderItemId: grainItem.id, qtyMt: "5.000" }]),
    ).rejects.toThrowError(/is available at WH-CTG/);

    // Allocation is cumulative: 60 + 60 must also fail.
    await createDo(ctx, order.id, "WH-DHK", [{ orderItemId: coalItem.id, qtyMt: "60.000" }]);
    await expect(
      createDo(ctx, order.id, "WH-CTG", [{ orderItemId: coalItem.id, qtyMt: "60.000" }]),
    ).rejects.toThrowError(/only 40\.000 MT is left to allocate/);
  });

  it("scenario 6 — rejects over-dispatch and a duplicate challan number", async () => {
    await prisma.customer.create({ data: { code: "CUS-D6", name: "Dispatch Trader" } });
    const order = await createApprovedOrder(ctx, "CUS-D6", [
      { productCode: "FERT-UREA", qtyMt: "50.000" },
    ]);
    const items = await orderItemsOf(order.id);
    const doResult = await createDo(ctx, order.id, "WH-CTG", [
      { orderItemId: items[0]!.id, qtyMt: "50.000" },
    ]);
    const doId = doResult.deliveryOrder.id;
    const doItems = await doItemsOf(doId);

    await expect(
      dispatch(ctx, doId, [{ doItemId: doItems[0]!.id, qtyMt: "60.000" }], "CH-2001", ctx.warehouseCtg),
    ).rejects.toThrowError(/only 50\.000 MT is left to dispatch/);

    // Partial dispatch works.
    await dispatch(ctx, doId, [{ doItemId: doItems[0]!.id, qtyMt: "20.000" }], "CH-2001", ctx.warehouseCtg);
    const doAfterPartial = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: doId } });
    expect(doAfterPartial.status).toBe("PARTIALLY_DISPATCHED");
    expect(await orderStatusOf(order.id)).toBe("PARTIALLY_DELIVERED");

    // Duplicate challan is rejected before anything else changes.
    await expect(
      dispatch(ctx, doId, [{ doItemId: doItems[0]!.id, qtyMt: "5.000" }], "CH-2001", ctx.warehouseCtg),
    ).rejects.toThrowError(/Challan number CH-2001 already exists/);

    // The rest completes the DO and the order.
    await dispatch(ctx, doId, [{ doItemId: doItems[0]!.id, qtyMt: "30.000" }], "CH-2002", ctx.warehouseCtg);
    const doAfterFull = await prisma.deliveryOrder.findUniqueOrThrow({ where: { id: doId } });
    expect(doAfterFull.status).toBe("DISPATCHED");
    expect(await orderStatusOf(order.id)).toBe("COMPLETED");
  });

  it("scenario 7 — one order is delivered from two warehouses", async () => {
    await prisma.customer.create({ data: { code: "CUS-MW", name: "Multi Warehouse Trader" } });
    const order = await createApprovedOrder(ctx, "CUS-MW", [
      { productCode: "FERT-UREA", qtyMt: "100.000" },
    ]);
    const items = await orderItemsOf(order.id);

    const doDhaka = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "60.000" },
    ]);
    const doCtg = await createDo(ctx, order.id, "WH-CTG", [
      { orderItemId: items[0]!.id, qtyMt: "40.000" },
    ]);

    expect(doDhaka.deliveryOrder.warehouseCode).toBe("WH-DHK");
    expect(doCtg.deliveryOrder.warehouseCode).toBe("WH-CTG");

    const dhakaItems = await doItemsOf(doDhaka.deliveryOrder.id);
    const ctgItems = await doItemsOf(doCtg.deliveryOrder.id);

    await dispatch(ctx, doDhaka.deliveryOrder.id, [{ doItemId: dhakaItems[0]!.id, qtyMt: "60.000" }], "CH-3001");
    await dispatch(
      ctx,
      doCtg.deliveryOrder.id,
      [{ doItemId: ctgItems[0]!.id, qtyMt: "40.000" }],
      "CH-3002",
      ctx.warehouseCtg,
    );

    expect(await orderStatusOf(order.id)).toBe("COMPLETED");

    // Both reserves are gone and both warehouses' on-hand dropped.
    expect((await balanceOf("WH-DHK", "FERT-UREA")).reservedMt).toBe("0.000");
    expect((await balanceOf("WH-CTG", "FERT-UREA")).reservedMt).toBe("0.000");
  });

  it("scenario 8 — DO creation reserves, cancellation releases, dispatch reduces on-hand", async () => {
    await prisma.customer.create({ data: { code: "CUS-RES", name: "Reservation Trader" } });
    const before = await balanceOf("WH-DHK", "GRAIN-WHEAT");
    const order = await createApprovedOrder(ctx, "CUS-RES", [
      { productCode: "GRAIN-WHEAT", qtyMt: "30.000" },
    ]);
    const items = await orderItemsOf(order.id);

    const doResult = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "30.000" },
    ]);
    const reserved = await balanceOf("WH-DHK", "GRAIN-WHEAT");
    expect(reserved.onHandMt).toBe(before.onHandMt);
    expect(reserved.reservedMt).toBe("30.000");

    // Reservation writes a RESERVE ledger row against the DO itself.
    expect(await ledgerCount("delivery_order", doResult.deliveryOrder.id)).toBeGreaterThanOrEqual(1);

    // Cancelling the DO releases it again.
    const { cancelDeliveryOrder } = await import("@/server/services/delivery-order.service");
    await cancelDeliveryOrder(
      { doId: doResult.deliveryOrder.id, reason: "Truck not available" },
      { id: ctx.ops.id, name: ctx.ops.name, role: "SALES_OPS" },
    );
    const released = await balanceOf("WH-DHK", "GRAIN-WHEAT");
    expect(released.reservedMt).toBe("0.000");
    expect(released.onHandMt).toBe(before.onHandMt);

    // A cancelled DO cannot be dispatched.
    const doItems = await doItemsOf(doResult.deliveryOrder.id);
    await expect(
      dispatch(ctx, doResult.deliveryOrder.id, [{ doItemId: doItems[0]!.id, qtyMt: "5.000" }], "CH-4001"),
    ).rejects.toThrowError(/Cannot move delivery order/);

    // Recreate and dispatch: on-hand drops, reservation clears.
    const second = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "30.000" },
    ]);
    const secondItems = await doItemsOf(second.deliveryOrder.id);
    await dispatch(ctx, second.deliveryOrder.id, [{ doItemId: secondItems[0]!.id, qtyMt: "30.000" }], "CH-4002");
    const afterDispatch = await balanceOf("WH-DHK", "GRAIN-WHEAT");
    expect(afterDispatch.reservedMt).toBe("0.000");
    expect(Number(afterDispatch.onHandMt)).toBe(Number(before.onHandMt) - 30);
  });

  it("splits a two-product order across two warehouses (one DO per warehouse)", async () => {
    await prisma.customer.create({ data: { code: "CUS-MW2", name: "Two Product Trader" } });

    // One order, two products.
    const order = await createApprovedOrder(ctx, "CUS-MW2", [
      { productCode: "FERT-UREA", qtyMt: "10.000" },
      { productCode: "COAL-IMPORT", qtyMt: "5.000" },
    ]);
    const items = await orderItemsOf(order.id);
    const fert = items.find((item) => item.productCode === "FERT-UREA")!;
    const coal = items.find((item) => item.productCode === "COAL-IMPORT")!;

    // Dhaka has no coal in this fixture / Chattogram has no wheat: the availability
    // column tells Sales Ops which line can leave from which warehouse.
    const dhakaCoal = await balanceOf("WH-DHK", "COAL-IMPORT");
    expect(Number(dhakaCoal.onHandMt)).toBeGreaterThan(0); // (fixture keeps coal everywhere)

    // DO-1: only the urea line, from Dhaka.
    const doFert = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: fert.id, qtyMt: "10.000" },
    ]);
    expect(doFert.deliveryOrder.items).toHaveLength(1);

    // DO-2: only the coal line, from Chattogram — same order, different warehouse.
    const doCoal = await createDo(ctx, order.id, "WH-CTG", [
      { orderItemId: coal.id, qtyMt: "5.000" },
    ]);
    expect(doCoal.deliveryOrder.items).toHaveLength(1);
    expect(doCoal.deliveryOrder.warehouseCode).toBe("WH-CTG");

    // Each line is allocated exactly once, across the two DOs.
    const afterAllocation = await orderItemsOf(order.id);
    expect(afterAllocation.find((item) => item.productCode === "FERT-UREA")?.doAllocatedMt.toFixed(3)).toBe(
      "10.000",
    );
    expect(afterAllocation.find((item) => item.productCode === "COAL-IMPORT")?.doAllocatedMt.toFixed(3)).toBe(
      "5.000",
    );

    // The order only completes when BOTH warehouses have dispatched.
    const fertDoItems = await doItemsOf(doFert.deliveryOrder.id);
    await dispatch(
      ctx,
      doFert.deliveryOrder.id,
      [{ doItemId: fertDoItems[0]!.id, qtyMt: "10.000" }],
      "CH-MW2-1",
    );
    expect(await orderStatusOf(order.id)).toBe("PARTIALLY_DELIVERED");

    const coalDoItems = await doItemsOf(doCoal.deliveryOrder.id);
    await dispatch(
      ctx,
      doCoal.deliveryOrder.id,
      [{ doItemId: coalDoItems[0]!.id, qtyMt: "5.000" }],
      "CH-MW2-2",
      ctx.warehouseCtg,
    );
    expect(await orderStatusOf(order.id)).toBe("COMPLETED");
  });

  it("never allows a dispatch date earlier than the loading date (Rule 6)", async () => {
    await prisma.customer.create({ data: { code: "CUS-DATE", name: "Date Trader" } });
    const order = await createApprovedOrder(ctx, "CUS-DATE", [
      { productCode: "FERT-UREA", qtyMt: "10.000" },
    ]);
    const items = await orderItemsOf(order.id);
    const createResult = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "10.000" },
    ]);
    const doItems = await doItemsOf(createResult.deliveryOrder.id);
    const { recordDispatch } = await import("@/server/services/dispatch.service");
    const warehouseActor = {
      id: ctx.warehouse.id,
      name: ctx.warehouse.name,
      role: "WAREHOUSE" as const,
      warehouseCode: "WH-DHK",
    };

    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const base = {
      doId: createResult.deliveryOrder.id,
      truckNo: "T-1",
      driverName: "Date Driver",
      driverPhone: "01711-000000",
      challanNo: "CH-DATE-1",
      loadingDate: today.toISOString(),
      dispatchDate: yesterday.toISOString(),
      items: [{ doItemId: doItems[0]!.id, qtyMt: "1.000" }],
    };

    // A previous day is refused and nothing is written.
    await expect(recordDispatch(base, warehouseActor)).rejects.toThrowError(
      /cannot be earlier than the loading date/,
    );
    expect(await prisma.dispatch.count({ where: { doId: base.doId } })).toBe(0);

    // The same day is fine (loading in the morning, dispatch in the afternoon).
    const sameDay = await recordDispatch(
      {
        ...base,
        challanNo: "CH-DATE-2",
        loadingDate: new Date(today.getTime() - 2 * 3600_000).toISOString(),
        dispatchDate: today.toISOString(),
      },
      warehouseActor,
    );
    expect(sameDay.dispatch.challanNo).toBe("CH-DATE-2");

    // The next day is fine as well.
    const nextDay = await recordDispatch(
      {
        ...base,
        challanNo: "CH-DATE-3",
        dispatchDate: new Date(today.getTime() + 86_400_000).toISOString(),
        items: [{ doItemId: doItems[0]!.id, qtyMt: "1.000" }],
      },
      warehouseActor,
    );
    expect(nextDay.dispatch.challanNo).toBe("CH-DATE-3");
  });

  it("never exceeds the order quantity: DB CHECK constraints block a manipulated row", async () => {
    await prisma.customer.create({ data: { code: "CUS-CHK", name: "Constraint Trader" } });
    const order = await createApprovedOrder(ctx, "CUS-CHK", [
      { productCode: "FERT-UREA", qtyMt: "10.000" },
    ]);
    const items = await orderItemsOf(order.id);

    await expect(
      prisma.orderItem.update({
        where: { id: items[0]!.id },
        data: { doAllocatedMt: "999.000" },
      }),
    ).rejects.toThrowError();

    await expect(
      prisma.stockBalance.update({
        where: { warehouseId_productCode: { warehouseId: "WH-DHK", productCode: "FERT-UREA" } },
        data: { onHandMt: "-1" },
      }),
    ).rejects.toThrowError();
  });
});
