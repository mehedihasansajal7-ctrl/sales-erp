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

/**
 * A report result. `truncated` is set when the report hit `REPORT_ROW_LIMIT` - the
 * screen and the exports show a warning instead of silently dropping rows.
 */
export type ReportRows = ReportRow[] & { truncated?: boolean };

/** Hard safety cap per report; the UI and the exports warn when it is reached. */
export const REPORT_ROW_LIMIT = 5000;

export function capReportRows(rows: ReportRow[], limit = REPORT_ROW_LIMIT): ReportRows {
  const capped: ReportRows = rows.slice(0, limit);
  if (rows.length > limit) {
    Object.defineProperty(capped, "truncated", { value: true, enumerable: false });
  }
  return capped;
}

export type ReportDefinition = {
  key: ReportKey;
  title: string;
  description: string;
  columns: ReportColumn[];
  /**
   * For reports whose columns depend on the data (e.g. one column per product),
   * this resolves the real columns for a given filter. The screen and every
   * export use it instead of `columns` when present.
   */
  columnsFor?: (filter: ReportFilter, user: ServiceActor) => Promise<ReportColumn[]>;
  /** Extra selects rendered in the filter bar (e.g. a breakdown / grouping). */
  options?: { key: string; label: string; choices: { value: string; label: string }[] }[];
  run: (filter: ReportFilter, user: ServiceActor) => Promise<ReportRows>;
};

export type ReportKey =
  | "order-balance"
  | "customer-sales"
  | "product-sales"
  | "customer-product-matrix"
  | "warehouse-sales"
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

const CUSTOMER_SALES_BASE: ReportColumn[] = [
  { key: "customerCode", label: "Code" },
  { key: "customerName", label: "Customer" },
  { key: "orderCount", label: "Orders", kind: "number", align: "right" },
  { key: "orderedMt", label: "Ordered (MT)", kind: "mt", align: "right" },
  { key: "deliveredMt", label: "Delivered (MT)", kind: "mt", align: "right" },
  { key: "remainingMt", label: "Remaining (MT)", kind: "mt", align: "right" },
  { key: "orderValue", label: "Order value (৳)", kind: "money", align: "right" },
];

const customerSales: ReportDefinition = {
  key: "customer-sales",
  title: "Customer-wise sales & delivery",
  description:
    "Order count, value and delivered quantity per customer — with the order numbers behind every row.",
  options: [
    {
      key: "groupBy",
      label: "Breakdown",
      choices: [
        { value: "customer", label: "Customer only (totals)" },
        { value: "product", label: "Customer → Product (summary)" },
        { value: "order", label: "Customer → Order lines (order no + product)" },
      ],
    },
  ],
  columns: CUSTOMER_SALES_BASE,
  /**
   * `orderNo` is part of every view: the exact order in the "order lines" view,
   * and the list of contributing orders in the two aggregated views — so any
   * figure can be traced back without leaving the report.
   */
  async columnsFor(filter) {
    const mode = filter.options?.groupBy;
    if (mode === "order") {
      return [
        { key: "orderNo", label: "Order no" },
        { key: "orderDate", label: "Order date" },
        { key: "customerCode", label: "Code" },
        { key: "customerName", label: "Customer" },
        { key: "productName", label: "Product" },
        { key: "orderedMt", label: "Ordered (MT)", kind: "mt", align: "right" },
        { key: "deliveredMt", label: "Delivered (MT)", kind: "mt", align: "right" },
        { key: "remainingMt", label: "Remaining (MT)", kind: "mt", align: "right" },
        { key: "orderValue", label: "Line value (৳)", kind: "money", align: "right" },
      ];
    }
    if (mode === "product") {
      // Summary: the order-number list replaces the bare "Orders" count - a
      // reader can see which orders make up the row (the count is just the list
      // length, so nothing is lost).
      return [
        CUSTOMER_SALES_BASE[0]!,
        CUSTOMER_SALES_BASE[1]!,
        { key: "orderNo", label: "Order no" },
        { key: "productName", label: "Product" },
        ...CUSTOMER_SALES_BASE.slice(3),
      ];
    }
    return [
      CUSTOMER_SALES_BASE[0]!,
      CUSTOMER_SALES_BASE[1]!,
      { key: "orderNo", label: "Order no" },
      ...CUSTOMER_SALES_BASE.slice(2),
    ];
  },
  async run(filter, user) {
    const mode =
      filter.options?.groupBy === "product"
        ? "product"
        : filter.options?.groupBy === "order"
          ? "order"
          : "customer";

    const orders = await prisma.order.findMany({
      where: {
        orderDate: { gte: filter.from, lte: filter.to },
        ...(user.role === "SALES" ? { createdBy: user.id } : {}),
        ...(filter.customerCode ? { customerId: filter.customerCode } : {}),
        ...(filter.productCode ? { items: { some: { productCode: filter.productCode } } } : {}),
      },
      include: { items: { include: { product: true } }, customer: true },
      orderBy: { orderNo: "asc" },
    });

    /**
     * Detail view: one row per order line, in order-number order, with the exact
     * product name — so a reader can trace every figure back to its order.
     */
    if (mode === "order") {
      const rows: ReportRow[] = [];
      for (const order of orders) {
        for (const item of order.items) {
          if (filter.productCode && item.productCode !== filter.productCode) continue;
          rows.push({
            orderNo: order.orderNo,
            orderDate: toZonedDateString(order.orderDate),
            customerCode: order.customerId,
            customerName: order.customer.name,
            productName: item.product.name,
            orderedMt: qty(item.qtyMt).toFixed(3),
            deliveredMt: qty(item.deliveredMt).toFixed(3),
            remainingMt: qty(dec(item.qtyMt).minus(dec(item.deliveredMt))).toFixed(3),
            orderValue: money(item.lineValue).toFixed(2),
          });
        }
      }
      return rows;
    }

    const map = new Map<string, { row: ReportRow; sort: number; orders: Set<string> }>();
    const blank = (customerCode: string, customerName: string, productName: string): ReportRow => ({
      customerCode,
      customerName,
      productName,
      orderNo: "",
      orderCount: "0",
      orderedMt: "0.000",
      deliveredMt: "0.000",
      remainingMt: "0.000",
      orderValue: "0.00",
    });

    /** Every order behind an aggregated row, so the figure can be traced. */
    const formatOrderList = (orders: Set<string>): string => {
      const list = [...orders].sort();
      if (list.length <= 6) return list.join(", ");
      return `${list.slice(0, 6).join(", ")} +${list.length - 6} more`;
    };

    for (const order of orders) {
      if (mode === "product") {
        // One row per (customer, product) — answers "what did this customer buy?".
        for (const item of order.items) {
          if (filter.productCode && item.productCode !== filter.productCode) continue;
          const key = `${order.customerId}|${item.productCode}`;
          const entry =
            map.get(key) ?? {
              row: blank(order.customerId, order.customer.name, item.product.name),
              sort: 0,
              orders: new Set<string>(),
            };
          entry.orders.add(order.orderNo);
          entry.row.orderCount = String(Number(entry.row.orderCount) + 1);
          entry.row.orderedMt = qty(dec(entry.row.orderedMt).plus(dec(item.qtyMt))).toFixed(3);
          entry.row.deliveredMt = qty(dec(entry.row.deliveredMt).plus(dec(item.deliveredMt))).toFixed(3);
          entry.row.remainingMt = qty(
            dec(entry.row.orderedMt).minus(dec(entry.row.deliveredMt)),
          ).toFixed(3);
          entry.row.orderValue = money(dec(entry.row.orderValue).plus(dec(item.lineValue))).toFixed(2);
          entry.sort = Number(entry.row.orderValue);
          map.set(key, entry);
        }
      } else {
        // Totals per customer (all products).
        const entry =
          map.get(order.customerId) ?? {
            row: blank(order.customerId, order.customer.name, ""),
            sort: 0,
            orders: new Set<string>(),
          };
        entry.orders.add(order.orderNo);
        entry.row.orderCount = String(Number(entry.row.orderCount) + 1);
        for (const item of order.items) {
          if (filter.productCode && item.productCode !== filter.productCode) continue;
          entry.row.orderedMt = qty(dec(entry.row.orderedMt).plus(dec(item.qtyMt))).toFixed(3);
          entry.row.deliveredMt = qty(dec(entry.row.deliveredMt).plus(dec(item.deliveredMt))).toFixed(3);
          entry.row.orderValue = money(dec(entry.row.orderValue).plus(dec(item.lineValue))).toFixed(2);
        }
        entry.row.remainingMt = qty(
          dec(entry.row.orderedMt).minus(dec(entry.row.deliveredMt)),
        ).toFixed(3);
        entry.sort = Number(entry.row.orderValue);
        map.set(order.customerId, entry);
      }
    }

    return [...map.values()]
      .sort((a, b) => b.sort - a.sort || String(a.row.customerName).localeCompare(String(b.row.customerName)))
      .map((entry) => ({ ...entry.row, orderNo: formatOrderList(entry.orders) }));
  },
};

const PRODUCT_SALES_BASE: ReportColumn[] = [
  { key: "productCode", label: "Code" },
  { key: "productName", label: "Product" },
  { key: "category", label: "Category" },
  { key: "orderedMt", label: "Ordered (MT)", kind: "mt", align: "right" },
  { key: "deliveredMt", label: "Delivered (MT)", kind: "mt", align: "right" },
  { key: "remainingMt", label: "Remaining (MT)", kind: "mt", align: "right" },
  { key: "orderValue", label: "Order value (৳)", kind: "money", align: "right" },
  { key: "avgRate", label: "Weighted avg rate (৳/MT)", kind: "money", align: "right" },
];

const productSales: ReportDefinition = {
  key: "product-sales",
  title: "Product-wise sales",
  description:
    "Ordered and delivered quantity and value per product — optionally broken down by customer.",
  options: [
    {
      key: "groupBy",
      label: "Breakdown",
      choices: [
        { value: "product", label: "Product only (totals)" },
        { value: "customer", label: "Product → Customer" },
      ],
    },
  ],
  columns: PRODUCT_SALES_BASE,
  /** The Customer column only exists in the customer breakdown. */
  async columnsFor(filter) {
    const byCustomer = filter.options?.groupBy === "customer";
    if (!byCustomer) return PRODUCT_SALES_BASE;
    return [
      ...PRODUCT_SALES_BASE.slice(0, 3),
      { key: "customerName", label: "Customer" },
      ...PRODUCT_SALES_BASE.slice(3),
    ];
  },
  async run(filter, user) {
    const byCustomer = filter.options?.groupBy === "customer";
    const items = await prisma.orderItem.findMany({
      where: {
        order: {
          orderDate: { gte: filter.from, lte: filter.to },
          ...(user.role === "SALES" ? { createdBy: user.id } : {}),
          ...(filter.customerCode ? { customerId: filter.customerCode } : {}),
        },
        ...(filter.productCode ? { productCode: filter.productCode } : {}),
      },
      include: { product: true, order: { include: { customer: true } } },
    });

    const map = new Map<
      string,
      {
        productCode: string;
        productName: string;
        category: string;
        customerName: string;
        ordered: ReturnType<typeof dec>;
        delivered: ReturnType<typeof dec>;
        value: ReturnType<typeof dec>;
      }
    >();

    for (const item of items) {
      // One row per (product, customer) when the breakdown is on.
      const key = byCustomer ? `${item.productCode}|${item.order.customerId}` : item.productCode;
      const entry =
        map.get(key) ??
        {
          productCode: item.productCode,
          productName: item.product.name,
          category: item.product.category,
          customerName: byCustomer ? item.order.customer.name : "All customers",
          ordered: dec(0),
          delivered: dec(0),
          value: dec(0),
        };
      entry.ordered = entry.ordered.plus(dec(item.qtyMt));
      entry.delivered = entry.delivered.plus(dec(item.deliveredMt));
      entry.value = entry.value.plus(dec(item.lineValue));
      map.set(key, entry);
    }

    return [...map.values()]
      .sort(
        (a, b) =>
          a.productName.localeCompare(b.productName) || b.value.comparedTo(a.value),
      )
      .map((entry) => ({
        productCode: entry.productCode,
        productName: entry.productName,
        category: entry.category,
        customerName: entry.customerName,
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

const customerProductMatrix: ReportDefinition = {
  key: "customer-product-matrix",
  title: "Customer × Product matrix",
  description:
    "Every customer against every product in one table — quantity (MT) or value (৳) in each cell.",
  options: [
    {
      key: "metric",
      label: "Cell value",
      choices: [
        { value: "mt", label: "Quantity (MT)" },
        { value: "value", label: "Value (৳)" },
      ],
    },
  ],
  columns: [],
  async columnsFor(filter) {
    const metric = filter.options?.metric === "value" ? "value" : "mt";
    const kind: ReportColumn["kind"] = metric === "value" ? "money" : "mt";
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    return [
      { key: "customerCode", label: "Code" },
      { key: "customerName", label: "Customer" },
      ...products.map<ReportColumn>((product) => ({
        key: `p_${product.code}`,
        label: `${product.name} (${metric === "value" ? "৳" : "MT"})`,
        kind,
        align: "right",
      })),
      {
        key: "total",
        label: metric === "value" ? "Total value (৳)" : "Total (MT)",
        kind,
        align: "right",
      },
    ];
  },
  async run(filter, user) {
    const metric = filter.options?.metric === "value" ? "value" : "mt";
    const fmt = (value: ReturnType<typeof dec>) =>
      metric === "value" ? money(value).toFixed(2) : qty(value).toFixed(3);

    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });

    const items = await prisma.orderItem.findMany({
      where: {
        order: {
          orderDate: { gte: filter.from, lte: filter.to },
          ...(user.role === "SALES" ? { createdBy: user.id } : {}),
          ...(filter.customerCode ? { customerId: filter.customerCode } : {}),
        },
        ...(filter.productCode ? { productCode: filter.productCode } : {}),
      },
      include: { order: { include: { customer: true } } },
    });

    const map = new Map<
      string,
      { customerCode: string; customerName: string; cells: Map<string, ReturnType<typeof dec>>; total: ReturnType<typeof dec> }
    >();

    for (const item of items) {
      const value = metric === "value" ? dec(item.lineValue) : dec(item.qtyMt);
      const entry =
        map.get(item.order.customerId) ??
        {
          customerCode: item.order.customerId,
          customerName: item.order.customer.name,
          cells: new Map<string, ReturnType<typeof dec>>(),
          total: dec(0),
        };
      entry.cells.set(item.productCode, dec(entry.cells.get(item.productCode) ?? 0).plus(value));
      entry.total = entry.total.plus(value);
      map.set(item.order.customerId, entry);
    }

    return [...map.values()]
      .sort((a, b) => b.total.comparedTo(a.total))
      .map((entry) => {
        const row: ReportRow = {
          customerCode: entry.customerCode,
          customerName: entry.customerName,
          total: fmt(entry.total),
        };
        for (const product of products) {
          row[`p_${product.code}`] = fmt(entry.cells.get(product.code) ?? dec(0));
        }
        return row;
      });
  },
};

const warehouseSales: ReportDefinition = {
  key: "warehouse-sales",
  title: "Warehouse-wise sales & delivery",
  description: "Delivery orders, dispatched quantity and dispatched value per warehouse.",
  columns: [
    { key: "warehouseCode", label: "Code" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "doCount", label: "DOs", kind: "number", align: "right" },
    { key: "doQtyMt", label: "DO qty (MT)", kind: "mt", align: "right" },
    { key: "dispatchedMt", label: "Dispatched (MT)", kind: "mt", align: "right" },
    { key: "pendingMt", label: "Pending (MT)", kind: "mt", align: "right" },
    { key: "dispatchedValue", label: "Dispatched value (৳)", kind: "money", align: "right" },
    { key: "customers", label: "Customers", kind: "number", align: "right" },
    { key: "products", label: "Products", kind: "number", align: "right" },
  ],
  async run(filter, user) {
    const warehouseScope =
      user.role === "WAREHOUSE" ? (user.warehouseCode ?? "__none__") : filter.warehouseCode;

    const orders = await prisma.deliveryOrder.findMany({
      where: {
        status: { not: "CANCELLED" },
        createdAt: { gte: filter.from, lte: filter.to },
        ...(warehouseScope ? { warehouseId: warehouseScope } : {}),
      },
      include: {
        items: true,
        warehouse: true,
        order: { include: { customer: true, items: true } },
      },
    });

    const map = new Map<
      string,
      {
        warehouseCode: string;
        warehouseName: string;
        doCount: number;
        doQty: ReturnType<typeof dec>;
        dispatched: ReturnType<typeof dec>;
        value: ReturnType<typeof dec>;
        customers: Set<string>;
        products: Set<string>;
      }
    >();

    for (const order of orders) {
      const entry =
        map.get(order.warehouseId) ??
        {
          warehouseCode: order.warehouseId,
          warehouseName: order.warehouse.name,
          doCount: 0,
          doQty: dec(0),
          dispatched: dec(0),
          value: dec(0),
          customers: new Set<string>(),
          products: new Set<string>(),
        };
      entry.doCount += 1;
      entry.customers.add(order.order.customerId);

      for (const item of order.items) {
        entry.doQty = entry.doQty.plus(dec(item.qtyMt));
        entry.dispatched = entry.dispatched.plus(dec(item.dispatchedMt));
        entry.products.add(item.productCode);

        const orderItem = order.order.items.find((row) => row.id === item.orderItemId);
        if (orderItem) {
          entry.value = entry.value.plus(dec(item.dispatchedMt).mul(dec(orderItem.lockedRatePerMt)));
        }
      }
      map.set(order.warehouseId, entry);
    }

    const rows = [...map.values()]
      .sort((a, b) => b.dispatched.comparedTo(a.dispatched) || b.value.comparedTo(a.value))
      .map<ReportRow>((entry) => ({
        warehouseCode: entry.warehouseCode,
        warehouseName: entry.warehouseName,
        doCount: String(entry.doCount),
        doQtyMt: qty(entry.doQty).toFixed(3),
        dispatchedMt: qty(entry.dispatched).toFixed(3),
        pendingMt: qty(entry.doQty.minus(entry.dispatched)).toFixed(3),
        dispatchedValue: money(entry.value).toFixed(2),
        customers: String(entry.customers.size),
        products: String(entry.products.size),
      }));

    // Warehouses with no DOs in the period still deserve a zero row when the
    // report is not restricted to one warehouse.
    if (!warehouseScope) {
      const all = await prisma.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
      for (const warehouse of all) {
        if (map.has(warehouse.code)) continue;
        rows.push({
          warehouseCode: warehouse.code,
          warehouseName: warehouse.name,
          doCount: "0",
          doQtyMt: "0.000",
          dispatchedMt: "0.000",
          pendingMt: "0.000",
          dispatchedValue: "0.00",
          customers: "0",
          products: "0",
        });
      }
    }

    return rows;
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
    { key: "createdAt", label: "Movement date", kind: "date" },
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
        movementDate: { gte: filter.from, lte: filter.to },
        ...(warehouseCode ? { warehouseId: warehouseCode } : {}),
        ...(filter.productCode ? { productCode: filter.productCode } : {}),
      },
      include: { warehouse: true, product: true, creator: { select: { name: true } } },
      orderBy: [{ movementDate: "asc" }, { createdAt: "asc" }],
      take: REPORT_ROW_LIMIT + 1,
    });
    return capReportRows(rows.map((row) => ({
      createdAt: toZonedDateString(row.movementDate),
      warehouseName: row.warehouse.name,
      productName: row.product.name,
      movementType: row.movementType.replace(/_/g, " "),
      qtyMt: dec(row.qtyMt).toFixed(3),
      balanceAfter: dec(row.balanceAfter).toFixed(3),
      reservedAfter: dec(row.reservedAfter).toFixed(3),
      reference: row.refType ? `${row.refType}` : "",
      createdByName: row.creator?.name ?? "system",
    })));
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
    { key: "effectiveTo", label: "Valid until", kind: "datetime" },
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
      effectiveTo: row.effectiveTo ? toZonedDateString(row.effectiveTo) : "Until next rate",
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
      take: REPORT_ROW_LIMIT + 1,
    });

    return capReportRows(rows.map((row) => {
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
    }));
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
  "customer-product-matrix": customerProductMatrix,
  "warehouse-sales": warehouseSales,
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
