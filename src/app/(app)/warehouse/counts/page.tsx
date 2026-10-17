import { requireUser } from "@/lib/auth";
import { roleHasPermission } from "@/lib/rbac";
import { formatDateTime } from "@/lib/dates";
import { listStockCounts } from "@/server/services/stock-count.service";
import { listProducts, listWarehouses } from "@/server/services/master-data.service";
import { formatNumber } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, PageHeader, Pagination, StatusBadge } from "@/components/page-header";
import { CountActions, CountEntryForm } from "@/components/forms/warehouse-forms";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listStockCounts>>["rows"][number];

/** Rule 7 — physical stock count vs system stock, with approved adjustments. */
export default async function StockCountsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const user = await requireUser();
  const { status, page } = await searchParams;

  const [counts, warehouses, products] = await Promise.all([
    listStockCounts(
      { status: status ?? "ALL", page: Number(page ?? 1), pageSize: 20 },
      { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId },
    ),
    listWarehouses(false),
    listProducts(false),
  ]);

  const canCreate = roleHasPermission(user.role, "count.create");
  const canApprove = roleHasPermission(user.role, "count.approve");

  const columns = [
    { key: "countNo", label: "Count no" },
    { key: "countDate", label: "Date", render: (row: Row) => formatDateTime(row.countDate) },
    { key: "warehouseName", label: "Warehouse" },
    { key: "productName", label: "Product" },
    { key: "systemQty", label: "System (MT)", align: "right" as const, render: (row: Row) => formatNumber(row.systemQty) },
    {
      key: "physicalQty",
      label: "Physical (MT)",
      align: "right" as const,
      render: (row: Row) => formatNumber(row.physicalQty),
    },
    {
      key: "difference",
      label: "Difference (MT)",
      align: "right" as const,
      render: (row: Row) => (
        <span className={Number(row.difference) < 0 ? "font-medium text-red-600" : "font-medium"}>
          {formatNumber(row.difference)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row: Row) => <StatusBadge status={row.status} label={row.statusLabel} />,
    },
    { key: "reason", label: "Reason", render: (row: Row) => row.reason ?? row.rejectedReason ?? "—" },
    { key: "createdByName", label: "By" },
    {
      key: "action",
      label: "",
      align: "right" as const,
      render: (row: Row) =>
        row.status === "PENDING_APPROVAL" && canApprove ? (
          <CountActions countId={row.id} countNo={row.countNo} difference={row.difference} />
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Physical stock counts"
        description="Warehouse submits the physical count; Sales Ops approves the difference, which writes an ADJUSTMENT ledger entry."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={
          <form method="get" action="/warehouse/counts" className="flex items-center gap-2">
            <select
              name="status"
              defaultValue={status ?? "ALL"}
              aria-label="Filter by status"
              className="h-9 rounded-md border border-slate-300 px-3 text-sm"
            >
              <option value="ALL">All statuses</option>
              <option value="PENDING_APPROVAL">Pending approval</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <button type="submit" className="h-9 rounded-md bg-slate-900 px-3 text-sm font-medium text-white">
              Apply
            </button>
          </form>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div>
          <DataTable
            columns={columns}
            rows={counts.rows}
            rowKey={(row) => row.id}
            emptyMessage="No stock counts recorded yet."
          />
          <div className="mt-3">
            <Pagination
              page={counts.page}
              pageCount={counts.pageCount}
              total={counts.total}
              basePath="/warehouse/counts"
              searchParams={{ status }}
            />
          </div>
        </div>

        {canCreate ? (
          <Card>
            <CardHeader>
              <CardTitle>New physical count</CardTitle>
            </CardHeader>
            <CardContent>
              <CountEntryForm
                warehouses={warehouses.map((warehouse) => ({ code: warehouse.code, name: warehouse.name }))}
                products={products.map((product) => ({ code: product.code, name: product.name }))}
                lockedWarehouseCode={user.role === "WAREHOUSE" ? user.warehouseId : null}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Read-only</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">
              Warehouse users enter physical counts, Sales Operations approves or rejects the
              resulting adjustment.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
