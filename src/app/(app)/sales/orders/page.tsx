import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { roleHasPermission } from "@/lib/rbac";
import { formatDate } from "@/lib/dates";
import { listOrders } from "@/server/services/order.service";
import { listCustomers } from "@/server/services/master-data.service";
import { formatBdt, formatMt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTable, FilterBar, PageHeader, Pagination, ProgressBar, StatusBadge, type Column } from "@/components/page-header";
import { ORDER_STATUS_LABELS } from "@/lib/state-machines";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listOrders>>["rows"][number];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!roleHasPermission(user.role, "order.view.all") && !roleHasPermission(user.role, "order.view.own")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const get = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const [orders, customers] = await Promise.all([
    listOrders(
      {
        q: get("q"),
        status: (get("status") as never) ?? undefined,
        customerCode: get("customerCode"),
        sort: (get("sort") as never) ?? "orderDate",
        dir: (get("dir") as "asc" | "desc") ?? "desc",
        page: Number(get("page") ?? 1),
        pageSize: 20,
      },
      { id: user.id, name: user.name, role: user.role },
    ),
    listCustomers(),
  ]);

  const columns: Column<Row>[] = [
    {
      key: "orderNo",
      label: "Order no",
      render: (row) => (
        <Link href={`/sales/orders/${row.id}`} className="font-medium text-emerald-700 hover:underline">
          {row.orderNo}
        </Link>
      ),
    },
    { key: "customerName", label: "Customer", render: (row) => `${row.customerName} (${row.customerCode})` },
    { key: "orderSeq", label: "Priority #", align: "right" },
    { key: "orderDate", label: "Date", render: (row) => formatDate(row.orderDate) },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} label={row.statusLabel} />,
    },
    { key: "orderedMt", label: "Ordered", align: "right", render: (row) => formatMt(row.orderedMt) },
    { key: "deliveredMt", label: "Delivered", align: "right", render: (row) => formatMt(row.deliveredMt) },
    { key: "remainingMt", label: "Remaining", align: "right", render: (row) => formatMt(row.remainingMt) },
    {
      key: "progress",
      label: "Progress",
      render: (row) => <ProgressBar percent={row.progressPct} />,
    },
    { key: "totalValue", label: "Value", align: "right", render: (row) => formatBdt(row.totalValue) },
  ];

  return (
    <div>
      <PageHeader
        title={user.role === "SALES" ? "My orders" : "All orders"}
        description={
          user.role === "SALES"
            ? "Every order you created, with its delivery progress. The rate on each order is locked."
            : "Every order with its locked rate, delivery progress and status."
        }
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={
          roleHasPermission(user.role, "order.create") ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/sales/orders/new">New order</Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        action="/sales/orders"
        q={get("q")}
        placeholder="Search by order number or customer"
        selects={[
          {
            name: "status",
            label: "Status",
            value: get("status"),
            options: [
              { value: "OPEN", label: "Open (approved / partial)" },
              ...Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
          {
            name: "customerCode",
            label: "Customer",
            value: get("customerCode"),
            options: customers.map((customer) => ({ value: customer.code, label: customer.name })),
          },
        ]}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="sort" className="text-xs font-medium text-slate-500">
            Sort
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={get("sort") ?? "orderDate"}
            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
          >
            <option value="orderDate">Order date</option>
            <option value="orderNo">Order number</option>
            <option value="customer">Customer</option>
            <option value="totalValue">Value</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="dir" className="text-xs font-medium text-slate-500">
            Direction
          </label>
          <select
            id="dir"
            name="dir"
            defaultValue={get("dir") ?? "desc"}
            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={orders.rows}
        rowKey={(row) => row.id}
        emptyMessage="No orders match the filter. Create the first order from “New order”."
      />

      <div className="mt-3">
        <Pagination
          page={orders.page}
          pageCount={orders.pageCount}
          total={orders.total}
          basePath="/sales/orders"
          searchParams={{
            q: get("q"),
            status: get("status"),
            customerCode: get("customerCode"),
            sort: get("sort"),
            dir: get("dir"),
          }}
        />
      </div>
    </div>
  );
}
