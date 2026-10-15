import prisma from "@/lib/prisma";
import { dec, money, qty } from "@/lib/decimal";
import { endOfZonedDay, startOfZonedDay, startOfZonedMonth } from "@/lib/dates";
import { customerQueue } from "@/server/services/priority.service";
import { currentRates, rateTrend } from "@/server/services/rate.service";
import { openDeliveryOrders } from "@/server/services/delivery-order.service";
import { salespersonPerformance } from "@/server/services/order.service";
import { stockSummary } from "@/server/services/stock.service";
import type { ServiceActor } from "@/server/services/order.service";

/**
 * Role-aware dashboard (spec Section 7.2).
 * MANAGEMENT sees everything read-only; a warehouse user sees only its own
 * warehouse; a salesperson sees only its own orders.
 */
export async function dashboardData(user: ServiceActor) {
  const now = new Date();
  const todayStart = startOfZonedDay(now);
  const todayEnd = endOfZonedDay(now);
  const monthStart = startOfZonedMonth(now);

  const orderScope = user.role === "SALES" ? { createdBy: user.id } : {};
  const warehouseScope = user.role === "WAREHOUSE" ? user.warehouseCode ?? "__none__" : undefined;

  const [
    totalOrders,
    pendingApprovalOrders,
    approvedOrders,
    deliveredToday,
    deliveredMonth,
    monthOrders,
    openOrderItems,
    doCounts,
    stock,
    topCustomersRaw,
    rates,
    trend,
    performance,
  ] = await Promise.all([
    prisma.order.count({ where: orderScope }),
    prisma.order.findMany({
      where: { ...orderScope, status: "PENDING_APPROVAL" },
      select: { id: true, orderNo: true, customer: { select: { name: true } }, orderDate: true, totalValue: true },
      orderBy: { orderDate: "asc" },
      take: 10,
    }),
    prisma.order.count({ where: { ...orderScope, status: "APPROVED" } }),
    prisma.dispatchItem.aggregate({
      _sum: { qtyMt: true },
      where: {
        dispatch: {
          dispatchDate: { gte: todayStart, lte: todayEnd },
          ...(warehouseScope ? { deliveryOrder: { warehouseId: warehouseScope } } : {}),
        },
      },
    }),
    prisma.dispatchItem.aggregate({
      _sum: { qtyMt: true },
      where: {
        dispatch: {
          dispatchDate: { gte: monthStart, lte: todayEnd },
          ...(warehouseScope ? { deliveryOrder: { warehouseId: warehouseScope } } : {}),
        },
      },
    }),
    prisma.order.findMany({
      where: { ...orderScope, orderDate: { gte: monthStart, lte: todayEnd } },
      select: { totalValue: true },
    }),
    prisma.orderItem.findMany({
      where: {
        order: { status: { in: ["APPROVED", "PARTIALLY_DELIVERED"] }, ...orderScope },
      },
      select: { qtyMt: true, deliveredMt: true, productCode: true },
    }),
    prisma.deliveryOrder.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: warehouseScope ? { warehouseId: warehouseScope } : {},
    }),
    stockSummary(warehouseScope ? { warehouseCode: warehouseScope } : {}),
    prisma.order.groupBy({
      by: ["customerId"],
      _sum: { totalValue: true },
      _count: { _all: true },
      orderBy: { _sum: { totalValue: "desc" } },
      take: 5,
    }),
    currentRates(now),
    rateTrend(30),
    user.role === "SALES" ? salespersonPerformance(monthStart, todayEnd) : Promise.resolve([]),
  ]);

  const customerNames = await prisma.customer.findMany({
    where: { code: { in: topCustomersRaw.map((row) => row.customerId) } },
    select: { code: true, name: true },
  });
  const nameByCode = new Map(customerNames.map((c) => [c.code, c.name]));

  const pendingDeliveryMt = openOrderItems.reduce(
    (acc, item) => acc.plus(dec(item.qtyMt).minus(dec(item.deliveredMt))),
    dec(0),
  );
  const pendingByProduct = new Map<string, string>();
  for (const item of openOrderItems) {
    const remaining = dec(item.qtyMt).minus(dec(item.deliveredMt));
    pendingByProduct.set(
      item.productCode,
      qty(dec(pendingByProduct.get(item.productCode) ?? 0).plus(remaining)).toFixed(3),
    );
  }

  const monthValue = monthOrders.reduce((acc, order) => acc.plus(dec(order.totalValue)), dec(0));

  const doByStatus = Object.fromEntries(doCounts.map((row) => [row.status, row._count._all]));

  const productNames = await prisma.product.findMany({ select: { code: true, name: true } });
  const productNameByCode = new Map(productNames.map((p) => [p.code, p.name]));

  return {
    role: user.role,
    warehouseCode: warehouseScope ?? null,
    totals: {
      totalOrders,
      pendingApproval: pendingApprovalOrders.length,
      approvedOrders,
      pendingDeliveryMt: qty(pendingDeliveryMt).toFixed(3),
      deliveredTodayMt: qty(deliveredToday._sum.qtyMt ?? 0).toFixed(3),
      deliveredMonthMt: qty(deliveredMonth._sum.qtyMt ?? 0).toFixed(3),
      monthSalesValue: money(monthValue).toFixed(2),
      pendingDoCount: (doByStatus.CREATED ?? 0) + (doByStatus.PARTIALLY_DISPATCHED ?? 0),
      dispatchedDoCount: doByStatus.DISPATCHED ?? 0,
    },
    pendingApprovalOrders: pendingApprovalOrders.map((order) => ({
      id: order.id,
      orderNo: order.orderNo,
      customerName: order.customer.name,
      orderDate: order.orderDate,
      totalValue: order.totalValue.toFixed(2),
    })),
    pendingByProduct: [...pendingByProduct.entries()].map(([code, mt]) => ({
      productCode: code,
      productName: productNameByCode.get(code) ?? code,
      pendingMt: mt,
    })),
    stock,
    topCustomers: topCustomersRaw.map((row) => ({
      customerCode: row.customerId,
      customerName: nameByCode.get(row.customerId) ?? row.customerId,
      orderCount: row._count._all,
      totalValue: money(row._sum.totalValue ?? 0).toFixed(2),
    })),
    todayRates: rates.map((entry) => ({
      productCode: entry.product.code,
      productName: entry.product.name,
      ratePerMt: entry.ratePerMt,
      effectiveFrom: entry.effectiveFrom,
      hasRate: entry.hasRate,
    })),
    rateTrend: trend,
    salespersonPerformance: performance,
  };
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;

/** Customer priority queue view for Sales Ops (Rule 3). */
export async function priorityQueueOverview() {
  const customers = await prisma.customer.findMany({
    where: { orders: { some: { status: { in: ["APPROVED", "PARTIALLY_DELIVERED"] } } } },
    orderBy: { name: "asc" },
  });

  const results = [];
  for (const customer of customers) {
    const queue = await prisma.$transaction(async (tx) => customerQueue(tx, customer.code));
    results.push({
      customerCode: customer.code,
      customerName: customer.name,
      queue: queue.map((entry, index) => ({
        ...entry,
        position: index + 1,
        delivering: index === 0,
        blocked: index > 0,
        blockedByOrderNo: index > 0 ? (queue[0]?.orderNo ?? null) : null,
      })),
    });
  }
  return results;
}

export async function openDoOverview(warehouseCode?: string) {
  return openDeliveryOrders(warehouseCode);
}
