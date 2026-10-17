import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { defaultFromZonedDateString, toZonedDateString, zonedToUtc } from "@/lib/dates";
import { REPORTS, getReport, type ReportKey } from "@/server/services/report.service";
import { listCustomers, listProducts, listWarehouses } from "@/server/services/master-data.service";
import { formatBdt, formatMt, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, PageHeader, type Column } from "@/components/page-header";

export const dynamic = "force-dynamic";

const KEY_ICON: Record<ReportKey, "money" | "mt"> = {
  "order-balance": "money",
  "customer-sales": "money",
  "product-sales": "money",
  "pending-do": "mt",
  "stock-ledger": "mt",
  "stock-summary": "mt",
  "stock-difference": "mt",
  "rate-history": "money",
  "dispatch-register": "mt",
  "priority-override": "mt",
  "priority-queue": "mt",
  "salesperson-performance": "money",
};

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("report.view");
  const { key } = await params;
  const query = await searchParams;

  if (!Object.prototype.hasOwnProperty.call(REPORTS, key)) notFound();

  const get = (name: string) => {
    const value = query[name];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const from = zonedToUtc(get("from") ?? defaultFromZonedDateString(30));
  const to = zonedToUtc(`${get("to") ?? toZonedDateString()}`);
  const endOfTo = new Date(to.getTime() + 86_400_000 - 1);

  const report = getReport(key);
  const filterNote = `${toZonedDateString(from)} → ${toZonedDateString(endOfTo)}`;

  // Optional report options (e.g. the customer/product breakdown) come from the
  // same query string, so the screen, the exports and the filtered links agree.
  const reportOptions: Record<string, string> = {};
  for (const option of report.options ?? []) {
    const value = get(option.key);
    if (value) reportOptions[option.key] = value;
  }

  const [rows, warehouses, customers, products] = await Promise.all([
    report.run(
      {
        from,
        to: endOfTo,
        warehouseCode: get("warehouseCode"),
        customerCode: get("customerCode"),
        productCode: get("productCode"),
        options: reportOptions,
      },
      { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId },
    ),
    listWarehouses(),
    listCustomers(),
    listProducts(),
  ]);

  const exportQuery = new URLSearchParams({
    from: toZonedDateString(from),
    to: toZonedDateString(endOfTo),
    ...(get("warehouseCode") ? { warehouseCode: get("warehouseCode") as string } : {}),
    ...(get("customerCode") ? { customerCode: get("customerCode") as string } : {}),
    ...(get("productCode") ? { productCode: get("productCode") as string } : {}),
    ...reportOptions,
  });

  const columns: Column<Record<string, string>>[] = report.columns.map((column) => ({
    key: column.key,
    label: column.label,
    align: column.align,
    render: (row) => {
      const value = row[column.key] ?? "";
      if (column.kind === "money") return formatBdt(value);
      // The unit lives in the column header ("Ordered (MT)"): the cell is a bare number.
      if (column.kind === "mt") {
        return /MT/i.test(column.label) ? formatNumber(value, 3) : formatMt(value);
      }
      return value === "" ? "—" : value;
    },
  }));

  const numericTotal = (kind: "money" | "mt") => {
    const keys = report.columns.filter((column) => column.kind === kind).map((column) => column.key);
    if (keys.length === 0) return null;
    const totals = keys.map((columnKey) => ({
      column: report.columns.find((column) => column.key === columnKey)?.label ?? columnKey,
      value: rows.reduce((acc, row) => acc + (Number(row[columnKey]) || 0), 0),
    }));
    return totals;
  };

  const totals = numericTotal(KEY_ICON[report.key] === "money" ? "money" : "mt");

  return (
    <div>
      <PageHeader
        title={report.title}
        description={`${report.description} · ${filterNote}`}
        breadcrumb={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/reports", label: "Reports" },
        ]}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/api/reports/${report.key}/export?format=xlsx&${exportQuery.toString()}`}>
                Export Excel
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/api/reports/${report.key}/export?format=pdf&${exportQuery.toString()}`}>
                Export PDF
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/api/reports/${report.key}/export?format=csv&${exportQuery.toString()}`}
                prefetch={false}
              >
                CSV
              </Link>
            </Button>
          </>
        }
      />

      <Card className="mb-3">
        <CardContent className="pt-4">
          <form method="get" action={`/reports/${report.key}`} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="from" className="text-xs font-medium text-slate-500">
                From
              </label>
              <input
                id="from"
                type="date"
                name="from"
                defaultValue={toZonedDateString(from)}
                className="h-9 rounded-md border border-slate-300 px-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="to" className="text-xs font-medium text-slate-500">
                To
              </label>
              <input
                id="to"
                type="date"
                name="to"
                defaultValue={toZonedDateString(endOfTo)}
                className="h-9 rounded-md border border-slate-300 px-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="warehouseCode" className="text-xs font-medium text-slate-500">
                Warehouse
              </label>
              <select
                id="warehouseCode"
                name="warehouseCode"
                defaultValue={get("warehouseCode") ?? ""}
                className="h-9 rounded-md border border-slate-300 px-3 text-sm"
              >
                <option value="">All</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.code} value={warehouse.code}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="customerCode" className="text-xs font-medium text-slate-500">
                Customer
              </label>
              <select
                id="customerCode"
                name="customerCode"
                defaultValue={get("customerCode") ?? ""}
                className="h-9 rounded-md border border-slate-300 px-3 text-sm"
              >
                <option value="">All</option>
                {customers.map((customer) => (
                  <option key={customer.code} value={customer.code}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="productCode" className="text-xs font-medium text-slate-500">
                Product
              </label>
              <select
                id="productCode"
                name="productCode"
                defaultValue={get("productCode") ?? ""}
                className="h-9 rounded-md border border-slate-300 px-3 text-sm"
              >
                <option value="">All</option>
                {products.map((product) => (
                  <option key={product.code} value={product.code}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
            {(report.options ?? []).map((option) => (
              <div key={option.key} className="flex flex-col gap-1">
                <label htmlFor={option.key} className="text-xs font-medium text-slate-500">
                  {option.label}
                </label>
                <select
                  id={option.key}
                  name={option.key}
                  defaultValue={get(option.key) ?? option.choices[0]?.value ?? ""}
                  className="h-9 rounded-md border border-slate-300 px-3 text-sm"
                >
                  {option.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <Button type="submit" variant="secondary">
              Run report
            </Button>
          </form>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row, index) => `${report.key}-${index}`}
        emptyMessage="No data for the selected filters."
        footer={
          totals ? (
            <div className="flex flex-wrap gap-4">
              {totals.map((total) => (
                <span key={total.column} className="text-sm">
                  <span className="text-slate-500">{total.column} total: </span>
                  <span className="font-semibold tabular-nums">
                    {report.columns.find((column) => column.label === total.column)?.kind === "money"
                      ? formatBdt(total.value)
                      : /MT/i.test(total.column)
                        ? formatNumber(total.value, 3)
                        : formatMt(total.value)}
                  </span>
                </span>
              ))}
            </div>
          ) : null
        }
      />
    </div>
  );
}
