import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { defaultFromZonedDateString, toZonedDateString, zonedToUtc } from "@/lib/dates";
import { REPORTS, getReport } from "@/server/services/report.service";
import { listCustomers, listProducts, listWarehouses } from "@/server/services/master-data.service";
import { formatBdt, formatMt, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, PageHeader, type Column } from "@/components/page-header";

export const dynamic = "force-dynamic";

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

  const viewer = { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId };
  const filter = {
    from,
    to: endOfTo,
    warehouseCode: get("warehouseCode"),
    customerCode: get("customerCode"),
    productCode: get("productCode"),
    options: reportOptions,
  };

  // Some reports (e.g. Customer × Product) build their columns from the data.
  const reportColumns = report.columnsFor ? await report.columnsFor(filter, viewer) : report.columns;

  const [rows, warehouses, customers, products] = await Promise.all([
    report.run(filter, viewer),
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

  const columns: Column<Record<string, string>>[] = reportColumns.map((column) => ({
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

  // Footer totals: every quantity and money column is summed (balances and
  // averages are not - adding "balance after" rows would be nonsense), and each
  // total is formatted with the unit of its own column. Previously only one kind
  // was summed and a dynamic money column (e.g. "Line value (৳)") fell back to the
  // MT formatter.
  const totals = reportColumns
    .filter((column) => column.kind === "mt" || column.kind === "money")
    .filter((column) => !/balance|after|avg/i.test(column.key))
    .map((column) => ({
      key: column.key,
      label: column.label,
      kind: column.kind as "mt" | "money",
      value: rows.reduce((acc, row) => acc + (Number(row[column.key]) || 0), 0),
    }));

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
          totals.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {totals.map((total) => (
                <span key={total.key} className="text-sm">
                  <span className="text-slate-500">{total.label} total: </span>
                  <span className="font-semibold tabular-nums">
                    {total.kind === "money" ? formatBdt(total.value) : formatMt(total.value)}
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
