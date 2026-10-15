import prisma from "@/lib/prisma";
import { dec, money, qty } from "@/lib/decimal";
import { toZonedDateString } from "@/lib/dates";
import { ORDER_STATUS_LABELS, DO_STATUS_LABELS } from "@/lib/state-machines";
import { customerQueue } from "@/server/services/priority.service";
import { priorityOverrideReport } from "@/server/services/delivery-order.service";
import { dailyRateChanges } from "@/server/services/rate.service";
import { stockDifferenceReport } from "@/server/services/stock-count.service";
import { stockSummary } from "@/server/services/stock.service";
import { salespersonPerformance } from "@/server/services/order.service";
import type { ServiceActor } from "@/server/services/order.service";

/**
 * Report registry (spec Section 7.7). Each report declares its columns and a
 * `run` function returning row objects keyed by column key. The same definition
 * drives the on-screen table, the Excel export and the PDF export, so the three
 * can never drift apart.
 */

export type ReportColumn = {
  key: string;
  label: string;
  kind?: "text" | "number" | "mt" | "money" | "date" | "datetime";
  align?: "left" | "right" | "center";
  width?: number;
};

export type ReportFilter = {
  from: Date;
  to: Date;
  warehouseCode?: string;
  customerCode?: string;
  productCode?: string;
  options?: Record<string, string>;
};

export type ReportRow = Record<string, string>;

export type ReportDefinition = {
  key: ReportKey;
  title: string;
  description: string;
  columns: ReportColumn[];
  run: (filter: ReportFilter, user: ServiceActor) => Promise<ReportRow[]>;
};

export type ReportKey =
  | "order-balance"
  | "customer-sales"
  | "product-sales"
  | "pending-do"
  | "stock-ledger"
  | "stock-summary"
  | "stock-difference"
  | "rate-history"
  | "dispatch-register"
  | "priority-override"
  | "priority-queue"
  | "salesperson-performance";

const dateCell = (value: Date | null | undefined) => (value ? toZonedDateString(value) : "");

const orderBalance: ReportDefinition = {
  key: "order-balance",
  title: "Order balance report",
  description: "Every order with ordered, delivered and outstanding quantity and value.",
  columns: [
    { key: "orderNo", label: "Order no" },
    { key: "orderDate", label: "Order date", kind: "date" },
    { key: "customerName", label: "Customer" },
    { key: "status", label: "Status" },
    { key: "orderedMt", label: "Ordered (MT)", kind: "mt", align: "right" },
    { key: "deliveredMt", label: "Delivered (MT)", kind: "mt", align: "right" },
    { key: "remainingMt", label: "Remaining (MT)", kind: "mt", align: "right" },
    { key: "orderValue", label: "Order value (৳)", kind: "money", align: "right" },
    { key: "deliveredValue", label: "Delivered value (৳)", kind: "money", align: "right" },
    { key: "outstandingValue", label: "Outstanding (৳)", kind: "money", align: "right" },
  ],
  async run(filter, user) {
    const orders = await prisma.order.findMany({
      where: {
        orderDate: { gte: filter.from, lte: filter.to },
        ...(user.role === "SALES" ? { createdBy: user.id } : {}),
        ...(filter.customerCode ? { customerId: filter.customerCode } : {}),
        ...(filter.warehouseCode ? { deliveryOrders: { some: { warehouseId: filter.warehouseCode } } } : {}),
      },
      include: { items: true, customer: true },
      orderBy: { orderDate: "asc" },
    });

    return orders.map((order) => {
      let ordered = dec(0);
      let delivered = dec(0);
      let orderValue = dec(0);
      let deliveredValue = dec(0);
      for (const item of order.items) {
        ordered = ordered.plus(dec(item.qtyMt));
        delivered = delivered.plus(dec(item.deliveredMt));
        orderValue = orderValue.plus(dec(item.lineValue));
        deliveredValue = deliveredValue.plus(dec(item.deliveredMt).mul(dec(item.lockedRatePerMt)));
      }
      return {
        orderNo: order.orderNo,
        orderDate: dateCell(order.orderDate),
        customerName: order.customer.name,
        status: ORDER_STATUS_LABELS[order.status],
        orderedMt: qty(ordered).toFixed(3),
        deliveredMt: qty(delivered).toFixed(3),
        remainingMt: qty(ordered.minus(delivered)).toFixed(3),
        orderValue: money(orderValue).toFixed(2),
        deliveredValue: money(deliveredValue).toFixed(2),
        outstandingValue: money(orderValue.minus(deliveredValue)).toFixed(2),
      };
    });
  },
};

const customerSales: ReportDefinition = {
  key: "customer-sales",
  title: "Customer-wise sales & delivery",
  description: "Order count, value and delivered quantity per customer.",
  columns: [
    { key: "customerCode", label: "Code" },
    { key: "customerName", label: "Customer" },
    { key: "orderCount", label: "Orders", kind: "number", align: "right" },
    { key: "orderedMt", label: "Ordered (MT)", kind: "mt", align: "right" },
    { key: "deliveredMt", label: "Delivered (MT)", kind: "mt", align: "right" },
    { key: "remainingMt", label: "Remaining (MT)", kind: "mt", align: "right" },
    { key: "orderValue", label: "Order value (৳)", kind: "money", align: "right" },
  ],
  async run(filter, user) {
    const orders = await prisma.order.findMany({
      where: {
        orderDate: { gte: filter.from, lte: filter.to },
        ...(user.role === "SALES" ? { createdBy: user.id } : {}),
        ...(filter.customerCode ? { customerId: filter.customerCode } : {}),
      },
      include: { items: true, customer: true },
    });

    const map = new Map<
      string,
      {
        row: ReportRow;
        sort: number;
      }
    >();
    for (const order of orders) {
      const entry =
        map.get(order.customerId) ??
        {
          row: {
            customerCode: order.customerId,
            customerName: order.customer.name,
            orderCount: "0",
            orderedMt: "0.000",
            deliveredMt: "0.000",
            remainingMt: "0.000",
            orderValue: "0.00",
          },
          sort: 0,
        };
      entry.row.orderCount = String(Number(entry.row.orderCount) + 1);
      entry.row.orderValue = money(dec(entry.row.orderValue).plus(dec(order.totalValue))).toFixed(2);
      entry.sort = Number(entry.row.orderValue);
      for (const item of order.items) {
        entry.row.orderedMt = qty(dec(entry.row.orderedMt).plus(dec(item.qtyMt))).toFixed(3);
        entry.row.deliveredMt = qty(dec(entry.row.deliveredMt).plus(dec(item.deliveredMt))).toFixed(3);
      }
      entry.row.remainingMt = qty(dec(entry.row.orderedMt).minus(dec(entry.row.deliveredMt))).toFixed(3);
      map.set(order.customerId, entry);
    }
    return [...map.values()].sort((a, b) => b.sort - a.sort).map((entry) => entry.row);
  },
};

const productSales: ReportDefinition = {
  key: "product-sales",
  title: "Product-wise sales",
  description: "Ordered and delivered quantity and value per product.",
  columns: [
    { key: "productCode", label: "Code" },
    { key: "productName", label: "Product" },
    { key: "category", label: "Category" },
    { key: "orderedMt", label: "Ordered (MT)", kind: "mt", align: "right" },
    { key: "deliveredMt", label: "Delivered (MT)", kind: "mt", align: "right" },
    { key: "remainingMt", label: "Remaining (MT)", kind: "mt", align: "right" },
    { key: "orderValue", label: "Order value (৳)", kind: "money", align: "right" },
    { key: "avgRate", label: "Weighted avg rate (৳/MT)", kind: "money", align: "right" },
  ],
  async run(filter, user) {
    const items = await prisma.orderItem.findMany({
      where: {
        order: {
          orderDate: { gte: filter.from, lte: filter.to },
          ...(user.role === "SALES" ? { createdBy: user.id } : {}),
        },
        ...(filter.productCode ? { productCode: filter.productCode } : {}),
      },
      include: { product: true },
    });

    const map = new Map<
      string,
      {
        productCode: string;
        productName: string;
        category: string;
        ordered: ReturnType<typeof dec>;
        delivered: ReturnType<typeof dec>;
        value: ReturnType<typeof dec>;
      }
    >();
    for (const item of items) {
      const entry =
        map.get(item.productCode) ??
        {
          productCode: item.productCode,
          productName: item.product.name,
          category: item.product.category,
          ordered: dec(0),
          delivered: dec(0),
          value: dec(0),
        };
      entry.ordered = entry.ordered.plus(dec(item.qtyMt));
      entry.delivered = entry.delivered.plus(dec(item.deliveredMt));
      entry.value = entry.value.plus(dec(item.lineValue));
      map.set(item.productCode, entry);
    }

    return [...map.values()]
      .sort((a, b) => b.value.comparedTo(a.value))
      .map((entry) => ({
        productCode: entry.productCode,
        productName: entry.productName,
        category: entry.category,
        orderedMt: qty(entry.ordered).toFixed(3),
        deliveredMt: qty(entry.delivered).toFixed(3),
        remainingMt: qty(entry.ordered.minus(entry.delivered)).toFixed(3),
        orderValue: money(entry.value).toFixed(2),
        avgRate: entry.ordered.isZero()
          ? "0.00"
          : money(entry.value.div(entry.ordered)).toFixed(2),
      }));
  },
};

const pendingDo: ReportDefinition = {
  key: "pending-do",
  title: "Pending delivery order report",
  description: "Delivery orders that are not fully dispatched yet.",
  columns: [
    { key: "doNo", label: "DO no" },
    { key: "orderNo", label: "Order no" },
    { key: "customerName", label: "Customer" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "status", label: "Status" },
    { key: "qtyMt", label: "DO qty (MT)", kind: "mt", align: "right" },
    { key: "dispatchedMt", label: "Dispatched (MT)", kind: "mt", align: "right" },
    { key: "pendingMt", label: "Pending (MT)", kind: "mt", align: "right" },
    { key: "createdAt", label: "Created", kind: "datetime" },
  ],
  async run(filter, user) {
    const warehouseCode =
      user.role === "WAREHOUSE" ? user.warehouseCode ?? "__none__" : filter.warehouseCode;
    const rows = await prisma.deliveryOrder.findMany({
      where: {
        status: { in: ["CREATED", "PARTIALLY_DISPATCHED"] },
        createdAt: { gte: filter.from, lte: filter.to },
        ...(warehouseCode ? { warehouseId: warehouseCode } : {}),
        ...(filter.customerCode ? { order: { customerId: filter.customerCode } } : {}),
      },
      include: {
        items: true,
        warehouse: true,
        order: { include: { customer: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => {
      let doQty = dec(0);
      let dispatched = dec(0);
      for (const item of row.items) {
        doQty = doQty.plus(dec(item.qtyMt));
        dispatched = dispatched.plus(dec(item.dispatchedMt));
      }
      return {
        doNo: row.doNo,
        orderNo: row.order.orderNo,
        customerName: row.order.customer.name,
        warehouseName: row.warehouse.name,
        status: DO_STATUS_LABELS[row.status],
        qtyMt: qty(doQty).toFixed(3),
        dispatchedMt: qty(dispatched).toFixed(3),
        pendingMt: qty(doQty.minus(dispatched)).toFixed(3),
        createdAt: toZonedDateString(row.createdAt),
      };
    });
  },
};

const stockLedgerReport: ReportDefinition = {
  key: "stock-ledger",
  title: "Warehouse stock ledger",
  description: "Every stock movement with the balance after the movement.",
  columns: [
    { key: "createdAt", label: "When", kind: "datetime" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "productName", label: "Product" },
    { key: "movementType", label: "Movement" },
    { key: "qtyMt", label: "Quantity (MT)", kind: "mt", align: "right" },
    { key: "balanceAfter", label: "On hand after (MT)", kind: "mt", align: "right" },
    { key: "reservedAfter", label: "Reserved after (MT)", kind: "mt", align: "right" },
    { key: "reference", label: "Reference" },
    { key: "createdByName", label: "By" },
  ],
  async run(filter, user) {
    const warehouseCode =
      user.role === "WAREHOUSE" ? user.warehouseCode ?? "__none__" : filter.warehouseCode;
    const rows = await prisma.stockLedger.findMany({
      where: {
        createdAt: { gte: filter.from, lte: filter.to },
        ...(warehouseCode ? { warehouseId: warehouseCode } : {}),
        ...(filter.productCode ? { productCode: filter.productCode } : {}),
      },
      include: { warehouse: true, product: true, creator: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });
    return rows.map((row) => ({
      createdAt: toZonedDateString(row.createdAt),
      warehouseName: row.warehouse.name,
      productName: row.product.name,
      movementType: row.movementType.replace(/_/g, " "),
      qtyMt: dec(row.qtyMt).toFixed(3),
      balanceAfter: dec(row.balanceAfter).toFixed(3),
      reservedAfter: dec(row.reservedAfter).toFixed(3),
      reference: row.refType ? `${row.refType}` : "",
      createdByName: row.creator?.name ?? "system",
    }));
  },
};

const stockSummaryReport: ReportDefinition = {
  key: "stock-summary",
  title: "Stock summary report",
  description: "Opening, inward, outward, transfers, closing, reserved and available per warehouse/product.",
  columns: [
    { key: "warehouseName", label: "Warehouse" },
    { key: "productName", label: "Product" },
    { key: "openingMt", label: "Opening (MT)", kind: "mt", align: "right" },
    { key: "inwardMt", label: "Inward (MT)", kind: "mt", align: "right" },
    { key: "transferInMt", label: "Transfer in (MT)", kind: "mt", align: "right" },
    { key: "transferOutMt", label: "Transfer out (MT)", kind: "mt", align: "right" },
    { key: "outwardMt", label: "Outward (MT)", kind: "mt", align: "right" },
    { key: "adjustmentMt", label: "Adjustment (MT)", kind: "mt", align: "right" },
    { key: "onHandMt", label: "Closing (MT)", kind: "mt", align: "right" },
    { key: "reservedMt", label: "Reserved (MT)", kind: "mt", align: "right" },
    { key: "availableMt", label: "Available (MT)", kind: "mt", align: "right" },
  ],
  async run(filter, user) {
    const warehouseCode =
      user.role === "WAREHOUSE" ? user.warehouseCode ?? "__none__" : filter.warehouseCode;
    const rows = await stockSummary({
      ...(warehouseCode ? { warehouseCode } : {}),
      ...(filter.productCode ? { productCode: filter.productCode } : {}),
    });
    return rows.map((row) => ({
      warehouseName: row.warehouseName,
      productName: row.productName,
      openingMt: row.openingMt,
      inwardMt: row.inwardMt,
      transferInMt: row.transferInMt,
      transferOutMt: row.transferOutMt,
      outwardMt: row.outwardMt,
      adjustmentMt: row.adjustmentMt,
      onHandMt: row.onHandMt,
      reservedMt: row.reservedMt,
      availableMt: row.availableMt,
    }));
  },
};

const stockDifference: ReportDefinition = {
  key: "stock-difference",
  title: "Stock difference report",
  description: "Physical count vs system stock, with the adjustment reason.",
  columns: [
    { key: "countNo", label: "Count no" },
    { key: "countDate", label: "Date", kind: "date" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "productName", label: "Product" },
    { key: "systemQty", label: "System (MT)", kind: "mt", align: "right" },
    { key: "physicalQty", label: "Physical (MT)", kind: "mt", align: "right" },
    { key: "difference", label: "Difference (MT)", kind: "mt", align: "right" },
    { key: "status", label: "Status" },
    { key: "reason", label: "Reason" },
  ],
  async run(filter, user) {
    const warehouseCode =
      user.role === "WAREHOUSE" ? user.warehouseCode ?? "__none__" : filter.warehouseCode;
    const rows = await stockDifferenceReport(filter.from, filter.to, warehouseCode);
    return rows.map((row) => ({ ...row, countNo: row.countNo, countDate: dateCell(row.countDate) }));
  },
};

const rateHistory: ReportDefinition = {
  key: "rate-history",
  title: "Daily rate change history",
  description: "Every rate publication with product, time and publisher.",
  columns: [
    { key: "effectiveFrom", label: "Effective from", kind: "datetime" },
    { key: "productCode", label: "Code" },
    { key: "productName", label: "Product" },
    { key: "ratePerMt", label: "Rate (৳/MT)", kind: "money", align: "right" },
    { key: "publishedBy", label: "Published by" },
    { key: "note", label: "Note" },
  ],
  async run(filter) {
    const rows = await dailyRateChanges(filter.from, filter.to);
    return rows.map((row) => ({
      effectiveFrom: toZonedDateString(row.effectiveFrom),
      productCode: row.productCode,
      productName: row.productName,
      ratePerMt: row.ratePerMt,
      publishedBy: row.publishedBy,
      note: row.note,
    }));
  },
};

const dispatchRegister: ReportDefinition = {
  key: "dispatch-register",
  title: "Delivery / dispatch register",
  description: "Every dispatch with truck, driver, challan and quantity.",
  columns: [
    { key: "challanNo", label: "Challan no" },
    { key: "doNo", label: "DO no" },
    { key: "orderNo", label: "Order no" },
    { key: "customerName", label: "Customer" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "productName", label: "Product" },
    { key: "qtyMt", label: "Qty (MT)", kind: "mt", align: "right" },
    { key: "truckNo", label: "Truck" },
    { key: "driverName", label: "Driver" },
    { key: "driverPhone", label: "Driver phone" },
    { key: "loadingDate", label: "Loading", kind: "date" },
    { key: "dispatchDate", label: "Dispatch", kind: "date" },
  ],
  async run(filter, user) {
    const warehouseCode =
      user.role === "WAREHOUSE" ? user.warehouseCode ?? "__none__" : filter.warehouseCode;
    const rows = await prisma.dispatch.findMany({
      where: {
        dispatchDate: { gte: filter.from, lte: filter.to },
        ...(warehouseCode ? { deliveryOrder: { warehouseId: warehouseCode } } : {}),
        ...(filter.customerCode ? { deliveryOrder: { order: { customerId: filter.customerCode } } } : {}),
        ...(filter.productCode
          ? { items: { some: { deliveryOrderItem: { productCode: filter.productCode } } } }
          : {}),
      },
      include: {
        deliveryOrder: { include: { warehouse: true, order: { include: { customer: true } } } },
        items: { include: { deliveryOrderItem: { include: { product: true } } } },
      },
      orderBy: { dispatchDate: "asc" },
      take: 5000,
    });

    return rows.map((row) => {
      const total = row.items.reduce((acc, item) => acc.plus(dec(item.qtyMt)), dec(0));
      return {
        challanNo: row.challanNo,
        doNo: row.deliveryOrder.doNo,
        orderNo: row.deliveryOrder.order.orderNo,
        customerName: row.deliveryOrder.order.customer.name,
        warehouseName: row.deliveryOrder.warehouse.name,
        productName: row.items
          .map((item) => item.deliveryOrderItem.product.name)
          .join(", "),
        qtyMt: qty(total).toFixed(3),
        truckNo: row.truckNo,
        driverName: row.driverName,
        driverPhone: row.driverPhone,
        loadingDate: dateCell(row.loadingDate),
        dispatchDate: dateCell(row.dispatchDate),
      };
    });
  },
};

const priorityOverride: ReportDefinition = {
  key: "priority-override",
  title: "Priority override report",
  description: "Every delivery order that bypassed the customer queue, with the reason and who granted it.",
  columns: [
    { key: "doNo", label: "DO no" },
    { key: "createdAt", label: "When", kind: "datetime" },
    { key: "orderNo", label: "Order no" },
    { key: "customerName", label: "Customer" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "reason", label: "Reason" },
    { key: "grantedBy", label: "Granted by" },
    { key: "status", label: "Status" },
  ],
  async run(filter) {
    const rows = await priorityOverrideReport(filter.from, filter.to);
    return rows.map((row) => ({
      doNo: row.doNo,
      createdAt: toZonedDateString(row.createdAt),
      orderNo: row.orderNo,
      customerName: row.customerName,
      warehouseName: row.warehouseName,
      reason: row.reason,
      grantedBy: row.grantedBy,
      status: row.status,
    }));
  },
};

const priorityQueue: ReportDefinition = {
  key: "priority-queue",
  title: "Customer priority queue",
  description: "Which order of each customer is delivering now and which orders are blocked behind it.",
  columns: [
    { key: "customerName", label: "Customer" },
    { key: "position", label: "Position", kind: "number", align: "right" },
    { key: "orderNo", label: "Order no" },
    { key: "status", label: "Status" },
    { key: "remainingMt", label: "Remaining (MT)", kind: "mt", align: "right" },
    { key: "delivering", label: "Delivering now" },
    { key: "blockedBy", label: "Blocked by" },
  ],
  async run() {
    const customers = await prisma.customer.findMany({
      where: { orders: { some: { status: { in: ["APPROVED", "PARTIALLY_DELIVERED"] } } } },
      orderBy: { name: "asc" },
    });
    const out: ReportRow[] = [];
    for (const customer of customers) {
      const queue = await prisma.$transaction(async (tx) => customerQueue(tx, customer.code));
      queue.forEach((entry, index) => {
        out.push({
          customerName: customer.name,
          position: String(index + 1),
          orderNo: entry.orderNo,
          status: ORDER_STATUS_LABELS[entry.status as keyof typeof ORDER_STATUS_LABELS],
          remainingMt: entry.remainingMt,
          delivering: index === 0 ? "Yes" : "No",
          blockedBy: index === 0 ? "" : (queue[0]?.orderNo ?? ""),
        });
      });
    }
    return out;
  },
};

const salesperson: ReportDefinition = {
  key: "salesperson-performance",
  title: "Salesperson performance",
  description: "Order count, value and delivered quantity per salesperson.",
  columns: [
    { key: "salespersonName", label: "Salesperson" },
    { key: "orderCount", label: "Orders", kind: "number", align: "right" },
    { key: "orderedMt", label: "Ordered (MT)", kind: "mt", align: "right" },
    { key: "deliveredMt", label: "Delivered (MT)", kind: "mt", align: "right" },
    { key: "orderValue", label: "Order value (৳)", kind: "money", align: "right" },
  ],
  async run(filter) {
    const rows = await salespersonPerformance(filter.from, filter.to);
    return rows.map((row) => ({
      salespersonName: row.salespersonName,
      orderCount: String(row.orderCount),
      orderedMt: row.orderedMt,
      deliveredMt: row.deliveredMt,
      orderValue: row.orderValue,
    }));
  },
};

export const REPORTS: Record<ReportKey, ReportDefinition> = {
  "order-balance": orderBalance,
  "customer-sales": customerSales,
  "product-sales": productSales,
  "pending-do": pendingDo,
  "stock-ledger": stockLedgerReport,
  "stock-summary": stockSummaryReport,
  "stock-difference": stockDifference,
  "rate-history": rateHistory,
  "dispatch-register": dispatchRegister,
  "priority-override": priorityOverride,
  "priority-queue": priorityQueue,
  "salesperson-performance": salesperson,
};

export const REPORT_LIST: { key: ReportKey; title: string; description: string }[] = Object.values(
  REPORTS,
).map((report) => ({ key: report.key, title: report.title, description: report.description }));

export function getReport(key: string): ReportDefinition {
  const report = REPORTS[key as ReportKey];
  if (!report) throw new Error(`Unknown report: ${key}`);
  return report;
}
