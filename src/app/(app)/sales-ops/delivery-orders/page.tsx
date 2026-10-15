import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { listDeliveryOrders } from "@/server/services/delivery-order.service";
import { listWarehouses } from "@/server/services/master-data.service";
import { formatMt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTable, FilterBar, PageHeader, Pagination, ProgressBar, StatusBadge, type Column } from "@/components/page-header";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listDeliveryOrders>>["rows"][number];

export default async function DeliveryOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const get = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const [orders, warehouses] = await Promise.all([
    listDeliveryOrders(
      {
        q: get("q"),
        status: (get("status") as never) ?? "OPEN",
        warehouseCode: get("warehouseCode"),
        page: Number(get("page") ?? 1),
        pageSize: 20,
      },
      { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId },
    ),
    listWarehouses(),
  ]);

  const columns: Column<Row>[] = [
    {
      key: "doNo",
      label: "DO no",
      render: (row) => (
        <Link
          href={`/sales-ops/delivery-orders/${row.id}`}
          className="font-medium text-emerald-700 hover:underline"
        >
          {row.doNo}
        </Link>
      ),
    },
    {
      key: "orderNo",
      label: "Order",
      render: (row) => (
        <Link href={`/sales/orders/${row.orderId}`} className="text-slate-700 hover:underline">
          {row.orderNo}
        </Link>
      ),
    },
    { key: "customerName", label: "Customer" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} label={row.statusLabel} /> },
    { key: "qtyMt", label: "DO qty", align: "right", render: (row) => formatMt(row.qtyMt) },
    { key: "dispatchedMt", label: "Dispatched", align: "right", render: (row) => formatMt(row.dispatchedMt) },
    {
      key: "progress",
      label: "Progress",
      render: (row) => (
        <ProgressBar
          percent={Number(row.qtyMt) === 0 ? 0 : (Number(row.dispatchedMt) / Number(row.qtyMt)) * 100}
        />
      ),
    },
    {
      key: "override",
      label: "Priority",
      render: (row) =>
        row.priorityOverride ? (
          <StatusBadge status="PENDING_APPROVAL" label="Override" />
        ) : (
          <span className="text-xs text-slate-400">Normal</span>
        ),
    },
    { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title="Delivery orders"
        description="Sales Ops creates DOs and chooses the warehouse manually. Creating a DO reserves stock in that warehouse."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={
          user.role === "ADMIN" || user.role === "SALES_OPS" ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/sales-ops/delivery-orders/new">New delivery order</Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        action="/sales-ops/delivery-orders"
        q={get("q")}
        placeholder="Search DO / order / customer / challan"
        selects={[
          {
            name: "status",
            label: "Status",
            value: get("status") ?? "OPEN",
            options: [
              { value: "OPEN", label: "Open (created / partial)" },
              { value: "CREATED", label: "Created" },
              { value: "PARTIALLY_DISPATCHED", label: "Partially dispatched" },
              { value: "DISPATCHED", label: "Dispatched" },
              { value: "CANCELLED", label: "Cancelled" },
            ],
          },
          {
            name: "warehouseCode",
            label: "Warehouse",
            value: get("warehouseCode"),
            options: warehouses.map((warehouse) => ({ value: warehouse.code, label: warehouse.name })),
          },
        ]}
      />

      <DataTable
        columns={columns}
        rows={orders.rows}
        rowKey={(row) => row.id}
        emptyMessage="No delivery orders match the filter."
      />

      <div className="mt-3">
        <Pagination
          page={orders.page}
          pageCount={orders.pageCount}
          total={orders.total}
          basePath="/sales-ops/delivery-orders"
          searchParams={{
            q: get("q"),
            status: get("status"),
            warehouseCode: get("warehouseCode"),
          }}
        />
      </div>
    </div>
  );
}
