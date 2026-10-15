import { requirePermission } from "@/lib/auth";
import { formatDateTime, zonedToUtc } from "@/lib/dates";
import { rateHistory } from "@/server/services/rate.service";
import { listProducts } from "@/server/services/master-data.service";
import { formatBdt } from "@/lib/utils";
import { DataTable, FilterBar, PageHeader, Pagination, StatusBadge, type Column } from "@/components/page-header";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof rateHistory>>["rows"][number];

export default async function RateHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("rate.view");
  const params = await searchParams;
  const get = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const [history, products] = await Promise.all([
    rateHistory({
      productCode: get("productCode"),
      from: get("from") ? zonedToUtc(get("from") as string) : undefined,
      to: get("to") ? zonedToUtc(get("to") as string) : undefined,
      page: Number(get("page") ?? 1),
      pageSize: 25,
    }),
    listProducts(),
  ]);

  const columns: Column<Row>[] = [
    {
      key: "effectiveFrom",
      label: "Effective from",
      render: (row) => formatDateTime(row.effectiveFrom),
    },
    {
      key: "product",
      label: "Product",
      render: (row) => (
        <span>
          <span className="font-medium">{row.productName}</span>
          <span className="ml-1 text-xs text-slate-500">{row.productCode}</span>
        </span>
      ),
    },
    {
      key: "ratePerMt",
      label: "Rate (৳/MT)",
      align: "right",
      render: (row) => formatBdt(row.ratePerMt),
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} label={row.status === "ACTIVE" ? "Live" : "Superseded"} /> },
    { key: "publishedBy", label: "Published by" },
    { key: "publishedAt", label: "Published at", render: (row) => formatDateTime(row.publishedAt) },
    { key: "note", label: "Note", render: (row) => row.note ?? "—" },
  ];

  return (
    <div>
      <PageHeader
        title="Rate history"
        description="Rates are append-only: every publication is kept, so any past order can be explained."
        breadcrumb={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/finance/rates", label: "Rates" },
        ]}
      />

      <FilterBar
        action="/finance/rates/history"
        placeholder="Search is not needed here — filter by product and dates"
        selects={[
          {
            name: "productCode",
            label: "Product",
            value: get("productCode"),
            options: products.map((product) => ({ value: product.code, label: product.name })),
          },
        ]}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs font-medium text-slate-500">
            From
          </label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={get("from") ?? ""}
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
            defaultValue={get("to") ?? ""}
            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
          />
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={history.rows}
        rowKey={(row) => row.id}
        emptyMessage="No rate publications match the filter."
      />

      <div className="mt-3">
        <Pagination
          page={history.page}
          pageCount={history.pageCount}
          total={history.total}
          basePath="/finance/rates/history"
          searchParams={{
            productCode: get("productCode"),
            from: get("from"),
            to: get("to"),
          }}
        />
      </div>
    </div>
  );
}
