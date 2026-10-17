import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/rbac";
import { dashboardData } from "@/server/services/dashboard.service";
import { formatBdt, formatMt } from "@/lib/utils";
import { formatDateTime } from "@/lib/dates";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, PageHeader, StatusBadge, type Column } from "@/components/page-header";
import { RateTrendChart, StockByWarehouseChart } from "@/components/charts";
import { EmptyState } from "@/components/ui/form";

export const dynamic = "force-dynamic";

type PendingRow = {
  id: string;
  orderNo: string;
  customerName: string;
  orderDate: Date;
  totalValue: string;
};

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await dashboardData({
    id: user.id,
    name: user.name,
    role: user.role,
    warehouseCode: user.warehouseId,
  });

  const pendingColumns: Column<PendingRow>[] = [
    { key: "orderNo", label: "Order" },
    { key: "customerName", label: "Customer" },
    {
      key: "orderDate",
      label: "Date",
      render: (row) => formatDateTime(row.orderDate),
    },
    {
      key: "totalValue",
      label: "Value",
      align: "right",
      render: (row) => formatBdt(row.totalValue),
    },
    {
      key: "action",
      label: "",
      align: "right",
      render: (row) => (
        <Button asChild size="sm" variant="outline">
          <Link href={`/sales/orders/${row.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        description={`${ROLE_LABELS[user.role]}${
          user.warehouseName ? ` · ${user.warehouseName}` : ""
        } dashboard`}
        actions={
          user.role === "SALES" ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/sales/orders/new">New order</Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total orders" value={String(data.totals.totalOrders)} />
        <StatCard
          label="Pending approval"
          value={String(data.totals.pendingApproval)}
          tone={data.totals.pendingApproval > 0 ? "warning" : "default"}
          hint="Orders waiting for Sales Ops"
        />
        <StatCard label="Approved (open)" value={String(data.totals.approvedOrders)} />
        <StatCard
          label="Pending delivery"
          value={formatMt(data.totals.pendingDeliveryMt)}
          tone={Number(data.totals.pendingDeliveryMt) > 0 ? "info" : "default"}
        />
        <StatCard label="Delivered today" value={formatMt(data.totals.deliveredTodayMt)} tone="success" />
        <StatCard label="Delivered this month" value={formatMt(data.totals.deliveredMonthMt)} />
        <StatCard label="Sales value (month)" value={formatBdt(data.totals.monthSalesValue)} tone="success" />
        <StatCard
          label="Open delivery orders"
          value={String(data.totals.pendingDoCount)}
          hint={`${data.totals.dispatchedDoCount} dispatched to date`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s rates</CardTitle>
          </CardHeader>
          <CardContent>
            {data.todayRates.length === 0 ? (
              <EmptyState title="No products configured yet." />
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100">
                {data.todayRates.map((rate) => (
                  <li key={rate.productCode} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="font-medium">{rate.productName}</span>
                      <span className="ml-1 text-xs text-slate-500">{rate.productCode}</span>
                    </span>
                    <span className="text-right">
                      {rate.hasRate ? (
                        <>
                          <span className="font-semibold tabular-nums">{formatBdt(rate.ratePerMt)}</span>
                          <span className="block text-xs text-slate-500">
                            since {formatDateTime(rate.effectiveFrom)}
                            {rate.effectiveTo
                              ? ` · valid until ${formatDateTime(rate.effectiveTo)}`
                              : " · until the next rate"}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-amber-700">No published rate</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rate history (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <RateTrendChart
              data={data.rateTrend}
              products={[...new Set(data.rateTrend.map((point) => point.productName))]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stock by warehouse &amp; product</CardTitle>
          </CardHeader>
          <CardContent>
            <StockByWarehouseChart
              data={data.stock.slice(0, 8).map((row) => ({
                label: `${row.warehouseCode}/${row.productCode}`,
                onHand: Number(row.onHandMt),
                reserved: Number(row.reservedMt),
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending delivery quantity by product</CardTitle>
          </CardHeader>
          <CardContent>
            {data.pendingByProduct.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Nothing pending — every approved order is delivered.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100">
                {data.pendingByProduct.map((row) => (
                  <li key={row.productCode} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="font-medium">{row.productName}</span>
                      <span className="ml-1 text-xs text-slate-500">{row.productCode}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatMt(row.pendingMt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Orders awaiting approval</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link href="/sales-ops/approvals">Open queue</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={pendingColumns}
              rows={data.pendingApprovalOrders}
              rowKey={(row) => row.id}
              emptyMessage="No orders are waiting for approval."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top customers (by order value)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topCustomers.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No orders yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100">
                {data.topCustomers.map((row) => (
                  <li key={row.customerCode} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium">{row.customerName}</span>
                    <span className="text-right">
                      <span className="font-semibold tabular-nums">{formatBdt(row.totalValue)}</span>
                      <span className="block text-xs text-slate-500">{row.orderCount} order(s)</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {user.role === "SALES" && data.salespersonPerformance.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>My performance this month</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={[
                { key: "salespersonName", label: "Salesperson" },
                { key: "orderCount", label: "Orders", align: "right" },
                { key: "orderedMt", label: "Ordered (MT)", align: "right" },
                { key: "deliveredMt", label: "Delivered (MT)", align: "right" },
                {
                  key: "orderValue",
                  label: "Order value",
                  align: "right",
                  render: (row) => formatBdt((row as { orderValue: string }).orderValue),
                },
              ]}
              rows={data.salespersonPerformance}
              rowKey={(row) => row.salespersonId}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {user.role === "MANAGEMENT" ? (
          <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            You have read-only access — every write action is blocked on the server.
          </p>
        ) : null}
        <StatusBadge status="ACTIVE" label={`Timezone: ${process.env.APP_TIMEZONE ?? "Asia/Dhaka"}`} />
      </div>
    </div>
  );
}
