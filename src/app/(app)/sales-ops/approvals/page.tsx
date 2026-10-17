import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { approvalQueue, runApprovalChecks } from "@/server/services/order.service";
import { formatBdt, formatMt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/form";
import { PageHeader, StatusBadge } from "@/components/page-header";
import { ApprovePanel } from "@/components/forms/order-actions";
import { EditOrderDialog } from "@/components/forms/order-actions";
import { FilterBar } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; customerCode?: string }>;
}) {
  await requirePermission("order.approve");
  const { q, customerCode } = await searchParams;

  const orders = await approvalQueue({ q, customerCode });
  const withChecks = await Promise.all(
    orders.map(async (order) => ({ order, checks: await runApprovalChecks(order.id) })),
  );

  return (
    <div>
      <PageHeader
        title="Approval queue"
        description="Every pending order with the approval checks: rate validity at order time, quantities, customer status and credit limit."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
      />

      <FilterBar
        action="/sales-ops/approvals"
        q={q}
        placeholder="Search order number or customer"
      />

      {withChecks.length === 0 ? (
        <EmptyState
          title="No orders are waiting for approval"
          description="New orders from salespeople appear here immediately. Rate publishing by Finance is what makes ordering possible."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/sales/orders">Browse all orders</Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {withChecks.map(({ order, checks }) => (
            <Card key={order.id}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Link
                      href={`/sales/orders/${order.id}`}
                      className="text-emerald-700 hover:underline"
                    >
                      {order.orderNo}
                    </Link>
                    <StatusBadge status={order.status} label={order.statusLabel} />
                  </CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    {order.customerName} ({order.customerCode}) · created {formatDateTime(order.orderDate)} ·
                    priority #{order.orderSeq}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">{formatBdt(order.totalValue)}</p>
                  <p className="text-xs text-slate-500">
                    {formatMt(order.orderedMt)} · {order.items.length} line(s)
                  </p>
                  <div className="mt-2 flex justify-end">
                    <EditOrderDialog
                      orderId={order.id}
                      orderNo={order.orderNo}
                      remarks={order.remarks}
                      lines={order.items.map((item) => ({
                        id: item.id,
                        productName: item.productName,
                        productCode: item.productCode,
                        qtyMt: item.qtyMt,
                        lockedRatePerMt: item.lockedRatePerMt,
                      }))}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-1 pr-2">Product</th>
                        <th className="py-1 pr-2 text-right">Qty (MT)</th>
                        <th className="py-1 pr-2 text-right">Locked rate</th>
                        <th className="py-1 text-right">Line value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item) => (
                        <tr key={item.id} className="border-b border-slate-50">
                          <td className="py-1 pr-2">
                            {item.productName}
                            <span className="ml-1 text-xs text-slate-500">{item.productCode}</span>
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">{item.qtyMt}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{formatBdt(item.lockedRatePerMt)}</td>
                          <td className="py-1 text-right tabular-nums">{formatBdt(item.lineValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ApprovePanel
                  orderId={order.id}
                  orderNo={order.orderNo}
                  totalValue={order.totalValue}
                  checks={checks.checks}
                  requiresOverride={checks.requiresOverride}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
