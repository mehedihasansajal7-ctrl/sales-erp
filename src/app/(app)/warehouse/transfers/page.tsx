import { requireUser } from "@/lib/auth";
import { roleHasPermission } from "@/lib/rbac";
import { formatDateTime } from "@/lib/dates";
import { listTransfers } from "@/server/services/transfer.service";
import { listProducts, listWarehouses } from "@/server/services/master-data.service";
import { formatMt } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, PageHeader, Pagination, StatusBadge } from "@/components/page-header";
import { TransferActions, TransferRequestForm } from "@/components/forms/warehouse-forms";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listTransfers>>["rows"][number];

/** Rule 7 — stock transfer between warehouses. */
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const user = await requireUser();
  const { status, page } = await searchParams;

  const [transfers, warehouses, products] = await Promise.all([
    listTransfers(
      { status: status ?? "ALL", page: Number(page ?? 1), pageSize: 20 },
      { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId },
    ),
    listWarehouses(false),
    listProducts(false),
  ]);

  const canRequest = roleHasPermission(user.role, "transfer.request");
  const canApprove = roleHasPermission(user.role, "transfer.approve");
  const canReceive = roleHasPermission(user.role, "transfer.receive");

  const columns = [
    { key: "transferNo", label: "Transfer no" },
    {
      key: "route",
      label: "Route",
      render: (row: Row) => (
        <span>
          {row.fromWarehouseName}
          <span className="mx-1 text-slate-400">→</span>
          {row.toWarehouseName}
        </span>
      ),
    },
    { key: "productName", label: "Product" },
    { key: "qtyMt", label: "Qty (MT)", align: "right" as const, render: (row: Row) => formatMt(row.qtyMt) },
    {
      key: "status",
      label: "Status",
      render: (row: Row) => <StatusBadge status={row.status} label={row.statusLabel} />,
    },
    { key: "requestedByName", label: "Requested by" },
    { key: "requestedAt", label: "Requested", render: (row: Row) => formatDateTime(row.requestedAt) },
    { key: "reason", label: "Reason", render: (row: Row) => row.reason ?? row.rejectReason ?? "—" },
    {
      key: "action",
      label: "",
      align: "right" as const,
      render: (row: Row) => (
        <TransferActions
          transferId={row.id}
          transferNo={row.transferNo}
          status={row.status}
          canApprove={canApprove}
          canRelease={canApprove || canRequest}
          canReceive={canReceive}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Stock transfers"
        description="REQUESTED → APPROVED (quantity reserved at the source) → IN_TRANSIT (leaves source) → RECEIVED (arrives at destination)."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={
          <form method="get" action="/warehouse/transfers" className="flex items-center gap-2">
            <select
              name="status"
              defaultValue={status ?? "ALL"}
              aria-label="Filter by status"
              className="h-9 rounded-md border border-slate-300 px-3 text-sm"
            >
              <option value="ALL">All statuses</option>
              <option value="REQUESTED">Requested</option>
              <option value="APPROVED">Approved</option>
              <option value="IN_TRANSIT">In transit</option>
              <option value="RECEIVED">Received</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <button
              type="submit"
              className="h-9 rounded-md bg-slate-900 px-3 text-sm font-medium text-white"
            >
              Apply
            </button>
          </form>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div>
          <DataTable
            columns={columns}
            rows={transfers.rows}
            rowKey={(row) => row.id}
            emptyMessage="No transfers match the filter."
          />
          <div className="mt-3">
            <Pagination
              page={transfers.page}
              pageCount={transfers.pageCount}
              total={transfers.total}
              basePath="/warehouse/transfers"
              searchParams={{ status }}
            />
          </div>
        </div>

        {canRequest ? (
          <Card>
            <CardHeader>
              <CardTitle>Request a transfer</CardTitle>
            </CardHeader>
            <CardContent>
              <TransferRequestForm
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
              Warehouse users request transfers from their own warehouse; Sales Operations approves,
              releases and confirms receipt.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
