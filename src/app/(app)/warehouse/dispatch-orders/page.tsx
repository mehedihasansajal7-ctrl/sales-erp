import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { listDeliveryOrders } from "@/server/services/delivery-order.service";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/form";
import { DataTable, FilterBar, PageHeader, Pagination, ProgressBar, StatusBadge, type Column } from "@/components/page-header";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listDeliveryOrders>>["rows"][number];

/** Rule 6 — a warehouse only ever sees the DOs assigned to its own warehouse. */
export default async function WarehouseDeliveryOrdersPage({
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

  const orders = await listDeliveryOrders(
    {
      q: get("q"),
      status: (get("status") as never) ?? "OPEN",
      page: Number(get("page") ?? 1),
      pageSize: 20,
    },
    { id: user.id, name: user.name, role: user.role, warehouseCode: user.warehouseId },
  );

  const columns: Column<Row>[] = [
    {
      key: "doNo",
      label: "DO no",
      render: (row) => (
        <Link
          href={`/warehouse/dispatch-orders/${row.id}`}
          className="font-medium text-emerald-700 hover:underline"
        >
          {row.doNo}
        </Link>
      ),
    },
    { key: "orderNo", label: "Order" },
    { key: "customerName", label: "Customer" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} label={row.statusLabel} /> },
    { key: "qtyMt", label: "DO qty (MT)", align: "right", render: (row) => formatNumber(row.qtyMt) },
    { key: "dispatchedMt", label: "Dispatched (MT)", align: "right", render: (row) => formatNumber(row.dispatchedMt) },
    {
      key: "progress",
      label: "Progress",
      render: (row) => (
        <ProgressBar percent={Number(row.qtyMt) === 0 ? 0 : (Number(row.dispatchedMt) / Number(row.qtyMt)) * 100} />
      ),
    },
    { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
    {
      key: "action",
      label: "",
      align: "right",
      render: (row) =>
        row.status === "DISPATCHED" || row.status === "CANCELLED" ? (
          <span className="text-xs text-slate-400">Closed</span>
        ) : (
          <Button asChild size="sm" variant="primary">
            <Link href={`/warehouse/dispatch-orders/${row.id}`}>Dispatch</Link>
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="My delivery orders"
        description={
          user.warehouseName
            ? `Delivery orders assigned to ${user.warehouseName}. You can dispatch these — never create or change them.`
            : "Delivery orders assigned to your warehouse."
        }
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/warehouse/dispatch">Dispatch register</Link>
          </Button>
        }
      />

      <FilterBar
        action="/warehouse/dispatch-orders"
        q={get("q")}
        placeholder="Search DO, order or customer"
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
            ],
          },
        ]}
      />

      {orders.rows.length === 0 ? (
        <EmptyState
          title="No delivery orders for your warehouse"
          description="Sales Ops creates delivery orders and assigns them to a warehouse. They appear here for loading and dispatch."
        />
      ) : (
        <DataTable columns={columns} rows={orders.rows} rowKey={(row) => row.id} />
      )}

      <div className="mt-3">
        <Pagination
          page={orders.page}
          pageCount={orders.pageCount}
          total={orders.total}
          basePath="/warehouse/dispatch-orders"
          searchParams={{ q: get("q"), status: get("status") }}
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>What the warehouse can and cannot do</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <p>✔ Record loading and dispatch with truck, driver, challan and quantity.</p>
          <p>✔ Dispatch partially — the DO stays partially dispatched.</p>
          <p>✔ Enter inward stock, opening stock, transfers and physical counts.</p>
          <p>✘ Cannot create or cancel a delivery order, or change its quantity.</p>
        </CardContent>
      </Card>
    </div>
  );
}
