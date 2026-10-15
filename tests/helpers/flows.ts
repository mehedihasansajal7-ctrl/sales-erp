import prisma from "@/lib/prisma";
import { actor, giveOpeningStock, publishRate, seedBase, type Fixtures } from "./db";

/**
 * Scenario helpers built on the real services, so a test reads like the
 * business story it proves.
 */

export type Ctx = {
  fixtures: Fixtures;
  finance: { id: string; name: string; role: "FINANCE" };
  sales: { id: string; name: string; role: "SALES" };
  ops: { id: string; name: string; role: "SALES_OPS" };
  warehouse: { id: string; name: string; role: "WAREHOUSE"; warehouseCode: string };
  warehouseCtg: { id: string; name: string; role: "WAREHOUSE"; warehouseCode: string };
  management: { id: string; name: string; role: "MANAGEMENT" };
  admin: { id: string; name: string; role: "ADMIN" };
};

/** Standard fixture: master data, users, opening stock and default rates. */
export async function standardContext(options: { withStock?: boolean } = {}): Promise<Ctx> {
  const fixtures = await seedBase();
  const { users } = fixtures;

  await publishRate("FERT-UREA", "50000.00", users.FINANCE!.id);
  await publishRate("COAL-IMPORT", "20000.00", users.FINANCE!.id);
  await publishRate("GRAIN-WHEAT", "40000.00", users.FINANCE!.id);

  if (options.withStock !== false) {
    await giveOpeningStock("WH-DHK", "FERT-UREA", "1000.000");
    await giveOpeningStock("WH-DHK", "COAL-IMPORT", "1000.000");
    await giveOpeningStock("WH-DHK", "GRAIN-WHEAT", "1000.000");
    await giveOpeningStock("WH-CTG", "FERT-UREA", "1000.000");
    await giveOpeningStock("WH-CTG", "COAL-IMPORT", "1000.000");
    // Mongla mirrors the demo seed (coal-heavy ship point).
    await giveOpeningStock("WH-MGL", "COAL-IMPORT", "8000.000");
    await giveOpeningStock("WH-MGL", "GRAIN-WHEAT", "1500.000");
  }

  return {
    fixtures,
    finance: { id: users.FINANCE!.id, name: users.FINANCE!.name, role: "FINANCE" },
    sales: { id: users.SALES!.id, name: users.SALES!.name, role: "SALES" },
    ops: { id: users.SALES_OPS!.id, name: users.SALES_OPS!.name, role: "SALES_OPS" },
    warehouse: {
      id: users.WAREHOUSE!.id,
      name: users.WAREHOUSE!.name,
      role: "WAREHOUSE",
      warehouseCode: "WH-DHK",
    },
    warehouseCtg: {
      id: users.WAREHOUSE_CTG!.id,
      name: users.WAREHOUSE_CTG!.name,
      role: "WAREHOUSE",
      warehouseCode: "WH-CTG",
    },
    management: { id: users.MANAGEMENT!.id, name: users.MANAGEMENT!.name, role: "MANAGEMENT" },
    admin: { id: users.ADMIN!.id, name: users.ADMIN!.name, role: "ADMIN" },
  };
}

export async function createOrder(
  ctx: Ctx,
  customerCode: string,
  items: { productCode: string; qtyMt: string }[],
) {
  const { createOrder: create } = await import("@/server/services/order.service");
  return create({ customerCode, items }, actor(ctx.sales));
}

export async function createApprovedOrder(
  ctx: Ctx,
  customerCode: string,
  items: { productCode: string; qtyMt: string }[],
) {
  const order = await createOrder(ctx, customerCode, items);
  const { approveOrder } = await import("@/server/services/order.service");
  const result = await approveOrder({ orderId: order.id }, actor(ctx.ops));
  return result.order;
}

export async function createDo(
  ctx: Ctx,
  orderId: string,
  warehouseCode: string,
  items: { orderItemId: string; qtyMt: string }[],
  options: { priorityOverride?: boolean; overrideReason?: string } = {},
) {
  const { createDeliveryOrder } = await import("@/server/services/delivery-order.service");
  return createDeliveryOrder(
    {
      orderId,
      warehouseCode,
      items,
      priorityOverride: options.priorityOverride,
      overrideReason: options.overrideReason,
    },
    actor(ctx.ops),
  );
}

export async function dispatch(
  ctx: Ctx,
  doId: string,
  items: { doItemId: string; qtyMt: string }[],
  challanNo: string,
  warehouseUser: Ctx["warehouse"] = ctx.warehouse,
) {
  const { recordDispatch } = await import("@/server/services/dispatch.service");
  return recordDispatch(
    {
      doId,
      truckNo: "Dhaka Metro-Ta 11-2233",
      driverName: "Md. Karim",
      driverPhone: "01711-000000",
      challanNo,
      loadingDate: new Date().toISOString(),
      dispatchDate: new Date().toISOString(),
      items,
    },
    actor(warehouseUser, warehouseUser.warehouseCode),
  );
}

export async function orderItemsOf(orderId: string) {
  return prisma.orderItem.findMany({ where: { orderId }, orderBy: { productCode: "asc" } });
}

export async function orderStatusOf(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return order.status;
}

export async function doItemsOf(doId: string) {
  return prisma.deliveryOrderItem.findMany({ where: { doId }, orderBy: { productCode: "asc" } });
}

export async function balanceOf(warehouseCode: string, productCode: string) {
  const row = await prisma.stockBalance.findUnique({
    where: { warehouseId_productCode: { warehouseId: warehouseCode, productCode } },
  });
  return {
    onHandMt: row?.onHandMt.toFixed(3) ?? "0.000",
    reservedMt: row?.reservedMt.toFixed(3) ?? "0.000",
  };
}

export async function ledgerCount(refType: string, refId: string) {
  return prisma.stockLedger.count({ where: { refType, refId } });
}

export async function auditCount(entity: string, entityId: string, action?: string) {
  return prisma.auditLog.count({
    where: { entity, entityId, ...(action ? { action } : {}) },
  });
}

export { prisma, actor };
