import { beforeAll, describe, expect, it } from "vitest";
import { REPORTS, REPORT_LIST, getReport } from "@/server/services/report.service";
import { reportsToExcel, reportsToPdf, rowsToCsv } from "@/server/services/export.service";
import { buildChallanPrintable, buildDoPrintable, buildOrderPrintable } from "@/server/services/print.service";
import {
  createApprovedOrder,
  createDo,
  dispatch,
  doItemsOf,
  orderItemsOf,
  prisma,
  standardContext,
  type Ctx,
} from "@/tests/helpers/flows";

/**
 * Reports and exports: every report runs against real data, and Excel, PDF and
 * CSV exports produce non-empty files. (Spec Section 7.7 / Definition of Done.)
 */
describe("Reports and exports", () => {
  let ctx: Ctx;
  let orderId: string;
  let doId: string;
  let dispatchId: string;

  const period = {
    from: new Date(Date.now() - 7 * 86_400_000),
    to: new Date(Date.now() + 86_400_000),
  };

  beforeAll(async () => {
    ctx = await standardContext();
    await prisma.customer.create({ data: { code: "CUS-RPT", name: "Report Trader" } });

    const order = await createApprovedOrder(ctx, "CUS-RPT", [
      { productCode: "FERT-UREA", qtyMt: "60.000" },
      { productCode: "COAL-IMPORT", qtyMt: "40.000" },
    ]);
    orderId = order.id;
    const items = await orderItemsOf(order.id);
    const fertItem = items.find((item) => item.productCode === "FERT-UREA")!;
    const coalItem = items.find((item) => item.productCode === "COAL-IMPORT")!;

    const doResult = await createDo(ctx, order.id, "WH-DHK", [
      { orderItemId: fertItem.id, qtyMt: "60.000" },
      { orderItemId: coalItem.id, qtyMt: "40.000" },
    ]);
    doId = doResult.deliveryOrder.id;
    const doItems = await doItemsOf(doId);
    const doFert = doItems.find((item) => item.productCode === "FERT-UREA")!;
    const doCoal = doItems.find((item) => item.productCode === "COAL-IMPORT")!;
    const result = await dispatch(
      ctx,
      doId,
      [
        { doItemId: doFert.id, qtyMt: "60.000" },
        { doItemId: doCoal.id, qtyMt: "40.000" },
      ],
      "CH-RPT-1",
    );
    dispatchId = result.dispatch.id;
  });

  it("declares every report with columns and a run function", () => {
    expect(REPORT_LIST.length).toBeGreaterThanOrEqual(10);
    for (const report of Object.values(REPORTS)) {
      expect(report.columns.length).toBeGreaterThan(0);
      expect(typeof report.run).toBe("function");
      expect(report.title.length).toBeGreaterThan(0);
    }
    expect(() => getReport("nope")).toThrowError(/Unknown report/);
  });

  it("runs every report without error and returns rows with the declared keys", async () => {
    for (const report of Object.values(REPORTS)) {
      const rows = await report.run(period, {
        id: ctx.management.id,
        name: ctx.management.name,
        role: "MANAGEMENT",
      });
      expect(Array.isArray(rows)).toBe(true);
      for (const row of rows.slice(0, 5)) {
        for (const column of report.columns) {
          expect(row).toHaveProperty(column.key);
        }
      }
    }
  });

  it("order balance and customer/product reports reflect the delivered data", async () => {
    const balances = await REPORTS["order-balance"].run(period, {
      id: ctx.admin.id,
      name: ctx.admin.name,
      role: "ADMIN",
    });
    const row = balances.find((entry) => entry.orderNo != null && entry.customerName === "Report Trader");
    expect(row?.orderedMt).toBe("100.000");
    expect(row?.deliveredMt).toBe("100.000");
    expect(row?.remainingMt).toBe("0.000");

    const byProduct = await REPORTS["product-sales"].run(period, {
      id: ctx.admin.id,
      name: ctx.admin.name,
      role: "ADMIN",
    });
    expect(byProduct.some((entry) => entry.productCode === "FERT-UREA")).toBe(true);

    const register = await REPORTS["dispatch-register"].run(period, {
      id: ctx.admin.id,
      name: ctx.admin.name,
      role: "ADMIN",
    });
    expect(register.some((entry) => entry.challanNo === "CH-RPT-1")).toBe(true);
  });

  it("excludes another salesperson's orders from the sales report", async () => {
    const otherSales = await prisma.user.create({
      data: { name: "Report Sales", email: "reportsales@test.local", passwordHash: "x", role: "SALES" },
    });
    const rows = await REPORTS["order-balance"].run(period, {
      id: otherSales.id,
      name: otherSales.name,
      role: "SALES",
    });
    expect(rows).toHaveLength(0);
  });

  it("customer-wise report can break down by product (and totals stay complete)", async () => {
    const totals = await REPORTS["customer-sales"].run(period, {
      id: ctx.admin.id,
      name: ctx.admin.name,
      role: "ADMIN",
    });
    const totalRow = totals.find((row) => row.customerName === "Report Trader");
    expect(totalRow?.orderedMt).toBe("100.000");
    expect(totalRow?.productName).toBe("All products");

    const byProduct = await REPORTS["customer-sales"].run(
      { ...period, options: { groupBy: "product" } },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );
    const fert = byProduct.find(
      (row) => row.customerName === "Report Trader" && row.productName === "Urea Fertilizer",
    );
    const coal = byProduct.find(
      (row) => row.customerName === "Report Trader" && row.productName === "Imported Coal",
    );
    expect(fert?.orderedMt).toBe("60.000");
    expect(coal?.orderedMt).toBe("40.000");

    // The breakdown must still add up to the same total.
    const breakdownTotal = byProduct
      .filter((row) => row.customerName === "Report Trader")
      .reduce((acc, row) => acc + Number(row.orderedMt), 0);
    expect(breakdownTotal).toBe(100);
  });

  it("product-wise report can break down by customer", async () => {
    const byCustomer = await REPORTS["product-sales"].run(
      { ...period, options: { groupBy: "customer" } },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );
    const fert = byCustomer.find(
      (row) => row.productCode === "FERT-UREA" && row.customerName === "Report Trader",
    );
    expect(fert?.orderedMt).toBe("60.000");
    expect(fert?.orderValue).toBe("3000000.00");

    // Totals view still reports "All customers" and the full quantity.
    const totals = await REPORTS["product-sales"].run(period, {
      id: ctx.admin.id,
      name: ctx.admin.name,
      role: "ADMIN",
    });
    const fertTotal = totals.find((row) => row.productCode === "FERT-UREA");
    expect(fertTotal?.customerName).toBe("All customers");
    expect(fertTotal?.orderedMt).toBe("60.000");
  });

  it("exports a report to Excel with a real xlsx payload", async () => {
    const report = REPORTS["order-balance"];
    const rows = await report.run(period, { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" });
    const buffer = await reportsToExcel([{ report, rows }], {
      title: report.title,
      generatedBy: "Test",
      filterNote: "test window",
    });
    expect(buffer.length).toBeGreaterThan(2000);
    // xlsx is a ZIP archive: "PK" magic bytes.
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("exports a report to PDF", async () => {
    const report = REPORTS["dispatch-register"];
    const rows = await report.run(period, { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" });
    const buffer = await reportsToPdf([{ report, rows }], {
      title: report.title,
      generatedBy: "Test",
    });
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("exports CSV with quoted fields", () => {
    const csv = rowsToCsv(["A", "B"], [["plain", 'has, comma'], ['has "quote"', "line\nbreak"]]);
    expect(csv.split("\n")[0]).toBe("A,B");
    expect(csv).toContain('"has, comma"');
    expect(csv).toContain('"has ""quote"""');
  });

  it("builds the order, DO and challan printables with the same numbers as the data", async () => {
    const orderPrint = await buildOrderPrintable(orderId, {
      id: ctx.admin.id,
      name: ctx.admin.name,
      role: "ADMIN",
    });
    expect(orderPrint.meta.docNo).toMatch(/^ORD-/);
    expect(JSON.stringify(orderPrint.tables)).toContain("100.000");

    const doPrint = await buildDoPrintable(doId, {
      id: ctx.admin.id,
      name: ctx.admin.name,
      role: "ADMIN",
    });
    expect(doPrint.meta.docNo).toMatch(/^DO-/);

    const challanPrint = await buildChallanPrintable(dispatchId);
    expect(challanPrint.meta.docNo).toBe("CH-RPT-1");
    const challanFields = JSON.stringify(challanPrint.keyValues);
    expect(challanFields).toContain("Dhaka Metro-Ta 11-2233");
    expect(challanFields).toContain("Md. Karim");
    expect(JSON.stringify(challanPrint.tables)).toContain("100.000");
  });

  it("keeps page-sized queries fast with a larger data set (pagination sanity)", async () => {
    const { listOrders } = await import("@/server/services/order.service");
    const startedAt = Date.now();
    const page = await listOrders(
      { page: 1, pageSize: 20, sort: "orderDate", dir: "desc" },
      { id: ctx.admin.id, name: ctx.admin.name, role: "ADMIN" },
    );
    const elapsed = Date.now() - startedAt;
    expect(page.rows.length).toBeLessThanOrEqual(20);
    expect(page.pageCount).toBeGreaterThanOrEqual(1);
    expect(elapsed).toBeLessThan(3000);
  });

  it("dashboard aggregation returns consistent totals", async () => {
    const { dashboardData } = await import("@/server/services/dashboard.service");
    const data = await dashboardData({
      id: ctx.admin.id,
      name: ctx.admin.name,
      role: "ADMIN",
      warehouseCode: null,
    });
    expect(data.totals.totalOrders).toBeGreaterThanOrEqual(1);
    expect(Number(data.totals.deliveredMonthMt)).toBeGreaterThanOrEqual(100);
    expect(data.stock.length).toBeGreaterThan(0);
    expect(data.todayRates.length).toBe(3);
  });
});
