import { beforeAll, describe, expect, it } from "vitest";
import { roleHasPermission } from "@/lib/rbac";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { editDeliveryOrderQuantity } from "@/server/services/delivery-order.service";
import { recordDispatch } from "@/server/services/dispatch.service";
import { prisma, standardContext, type Ctx } from "@/tests/helpers/flows";
import { createApprovedOrder, createDo, doItemsOf, orderItemsOf } from "@/tests/helpers/flows";

/**
 * "Dispatch now (MT) can only be changed by Sales Operations."
 *
 * Default policy: the warehouse records the vehicle / challan / dates and ships
 * the full DO quantity. It cannot type a different quantity; a smaller shipment
 * is a smaller DO created by Sales Ops. The setting can relax this.
 */
describe("Who may change the dispatched quantity", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
    await prisma.customer.createMany({
      data: [
        { code: "CUS-POL", name: "Policy Trader" },
        { code: "CUS-POL2", name: "Policy Trader 2" },
        { code: "CUS-POL3", name: "Policy Trader 3" },
        { code: "CUS-POL4", name: "Policy Trader 4" },
      ],
    });
  });

  it("permissions: only Sales Ops / Admin may edit a DO, the warehouse never", () => {
    expect(roleHasPermission("SALES_OPS", "do.edit")).toBe(true);
    expect(roleHasPermission("ADMIN", "do.edit")).toBe(true);
    expect(roleHasPermission("WAREHOUSE", "do.edit")).toBe(false);
    expect(roleHasPermission("SALES", "do.edit")).toBe(false);
    expect(roleHasPermission("FINANCE", "do.edit")).toBe(false);
    expect(roleHasPermission("MANAGEMENT", "do.edit")).toBe(false);
  });

  it("default policy: the warehouse must dispatch the full DO quantity", async () => {
    const order = await createApprovedOrder(ctx, "CUS-POL", [
      { productCode: "FERT-UREA", qtyMt: "20.000" },
    ]);
    const items = await orderItemsOf(order.id);
    const created = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "20.000" },
    ]);
    const doItems = await doItemsOf(created.deliveryOrder.id);
    const actor = {
      id: ctx.warehouse.id,
      name: ctx.warehouse.name,
      role: "WAREHOUSE" as const,
      warehouseCode: "WH-DHK",
    };

    const attempt = (qtyMt: string, challanNo: string) =>
      recordDispatch(
        {
          doId: created.deliveryOrder.id,
          truckNo: "T-1",
          driverName: "Driver",
          driverPhone: "01711-000000",
          challanNo,
          loadingDate: new Date().toISOString(),
          dispatchDate: new Date().toISOString(),
          items: [{ doItemId: doItems[0]!.id, qtyMt }],
        },
        actor,
      );

    // 5 MT of a 20 MT DO is refused, and nothing is written.
    await expect(attempt("5.000", "CH-POL-1")).rejects.toThrowError(
      /warehouse cannot change quantities/i,
    );
    expect(await prisma.dispatch.count({ where: { doId: created.deliveryOrder.id } })).toBe(0);

    // The full 20 MT goes through.
    const ok = await attempt("20.000", "CH-POL-2");
    expect(ok.deliveryOrder.status).toBe("DISPATCHED");
  });

  it("the setting can allow partial dispatch again", async () => {
    await setSetting(SETTING_KEYS.warehousePartialDispatch, "true");
    try {
      const order = await createApprovedOrder(ctx, "CUS-POL2", [
        { productCode: "COAL-IMPORT", qtyMt: "10.000" },
      ]);
      const items = await orderItemsOf(order.id);
      const created = await createDo(ctx, order.id, "WH-DHK", [
        { orderItemId: items[0]!.id, qtyMt: "10.000" },
      ]);
      const doItems = await doItemsOf(created.deliveryOrder.id);

      const first = await recordDispatch(
        {
          doId: created.deliveryOrder.id,
          truckNo: "T-2",
          driverName: "Driver",
          driverPhone: "01711-000000",
          challanNo: "CH-POL-3",
          loadingDate: new Date().toISOString(),
          dispatchDate: new Date().toISOString(),
          items: [{ doItemId: doItems[0]!.id, qtyMt: "4.000" }],
        },
        {
          id: ctx.warehouse.id,
          name: ctx.warehouse.name,
          role: "WAREHOUSE",
          warehouseCode: "WH-DHK",
        },
      );
      expect(first.deliveryOrder.status).toBe("PARTIALLY_DISPATCHED");
      expect(first.order.status).toBe("PARTIALLY_DELIVERED");

      // ...and a second partial shipment is possible too (regression).
      const second = await recordDispatch(
        {
          doId: created.deliveryOrder.id,
          truckNo: "T-3",
          driverName: "Driver",
          driverPhone: "01711-000000",
          challanNo: "CH-POL-4",
          loadingDate: new Date().toISOString(),
          dispatchDate: new Date().toISOString(),
          items: [{ doItemId: doItems[0]!.id, qtyMt: "3.000" }],
        },
        {
          id: ctx.warehouse.id,
          name: ctx.warehouse.name,
          role: "WAREHOUSE",
          warehouseCode: "WH-DHK",
        },
      );
      expect(second.deliveryOrder.status).toBe("PARTIALLY_DISPATCHED");
    } finally {
      await setSetting(SETTING_KEYS.warehousePartialDispatch, "false");
    }
  });

  it("Sales Ops can correct a DO quantity before dispatch (stock reservation follows)", async () => {
    const order = await createApprovedOrder(ctx, "CUS-POL", [
      { productCode: "FERT-UREA", qtyMt: "50.000" },
    ]);
    const items = await orderItemsOf(order.id);
    const created = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "50.000" },
    ]);
    const doItems = await doItemsOf(created.deliveryOrder.id);

    const before = await prisma.stockBalance.findUniqueOrThrow({
      where: { warehouseId_productCode: { warehouseId: "WH-DHK", productCode: "FERT-UREA" } },
    });

    const updated = await editDeliveryOrderQuantity(
      {
        doId: created.deliveryOrder.id,
        reason: "Truck capacity is 20 MT, the balance goes on a second DO",
        items: [{ doItemId: doItems[0]!.id, qtyMt: "20.000" }],
      },
      { id: ctx.ops.id, name: ctx.ops.name, role: "SALES_OPS" },
    );

    expect(updated.qtyMt).toBe("20.000");
    expect(updated.remainingMt).toBe("20.000");

    const after = await prisma.stockBalance.findUniqueOrThrow({
      where: { warehouseId_productCode: { warehouseId: "WH-DHK", productCode: "FERT-UREA" } },
    });
    expect(Number(after.reservedMt)).toBe(Number(before.reservedMt) - 30);

    const orderItem = await prisma.orderItem.findUniqueOrThrow({ where: { id: items[0]!.id } });
    expect(orderItem.doAllocatedMt.toFixed(3)).toBe("20.000");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entity: "delivery_order", entityId: created.deliveryOrder.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit.newValue)).toContain("Truck capacity");
  });

  it("refuses a DO quantity larger than the order can allocate", async () => {
    const order = await createApprovedOrder(ctx, "CUS-POL3", [
      { productCode: "FERT-UREA", qtyMt: "15.000" },
    ]);
    const items = await orderItemsOf(order.id);
    const created = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "10.000" },
    ]);
    const doItems = await doItemsOf(created.deliveryOrder.id);

    await expect(
      editDeliveryOrderQuantity(
        {
          doId: created.deliveryOrder.id,
          reason: "too much",
          items: [{ doItemId: doItems[0]!.id, qtyMt: "16.000" }],
        },
        { id: ctx.ops.id, name: ctx.ops.name, role: "SALES_OPS" },
      ),
    ).rejects.toThrowError(/only 15\.000 MT can be allocated/);
  });

  it("refuses to edit a DO once anything has been dispatched", async () => {
    const order = await createApprovedOrder(ctx, "CUS-POL4", [
      { productCode: "GRAIN-WHEAT", qtyMt: "8.000" },
    ]);
    const items = await orderItemsOf(order.id);
    const created = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: items[0]!.id, qtyMt: "8.000" },
    ]);
    const doItems = await doItemsOf(created.deliveryOrder.id);

    await recordDispatch(
      {
        doId: created.deliveryOrder.id,
        truckNo: "T-4",
        driverName: "Driver",
        driverPhone: "01711-000000",
        challanNo: "CH-POL-5",
        loadingDate: new Date().toISOString(),
        dispatchDate: new Date().toISOString(),
        items: [{ doItemId: doItems[0]!.id, qtyMt: "8.000" }],
      },
      { id: ctx.warehouse.id, name: ctx.warehouse.name, role: "WAREHOUSE", warehouseCode: "WH-DHK" },
    );

    await expect(
      editDeliveryOrderQuantity(
        {
          doId: created.deliveryOrder.id,
          reason: "too late",
          items: [{ doItemId: doItems[0]!.id, qtyMt: "5.000" }],
        },
        { id: ctx.ops.id, name: ctx.ops.name, role: "SALES_OPS" },
      ),
    ).rejects.toThrowError(/only be changed while nothing has been dispatched/i);
  });
});
