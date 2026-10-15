import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { priorityQueueOverview } from "@/server/services/dashboard.service";
import { formatMt } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/form";
import { PageHeader, StatusBadge } from "@/components/page-header";

export const dynamic = "force-dynamic";

/**
 * Rule 3 — the customer priority queue. For each customer this shows which
 * order is delivering now and which orders are blocked behind it.
 */
export default async function PriorityQueuePage() {
  await requirePermission("report.view");
  const customers = await priorityQueueOverview();

  return (
    <div>
      <PageHeader
        title="Customer priority queue"
        description="For the same customer, an older active order across any product must be fully delivered before a newer order can be delivered. Different customers never block each other."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
      />

      {customers.length === 0 ? (
        <EmptyState
          title="No customer has an open delivery queue"
          description="Once orders are approved they appear here in the order they must be delivered."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {customers.map((customer) => (
            <Card key={customer.customerCode}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{customer.customerName}</CardTitle>
                <span className="text-xs text-slate-500">{customer.customerCode}</span>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-3">
                  {customer.queue.map((entry) => (
                    <li
                      key={entry.id}
                      className={`rounded-md border p-3 ${
                        entry.delivering ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={`/sales/orders/${entry.id}`}
                          className="font-medium text-emerald-700 hover:underline"
                        >
                          #{entry.position} · {entry.orderNo}
                        </Link>
                        <StatusBadge status={entry.status} />
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        Remaining {formatMt(entry.remainingMt)}
                        {entry.blocked && entry.blockedByOrderNo ? (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                            Blocked by {entry.blockedByOrderNo}
                          </span>
                        ) : (
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                            Delivering now
                          </span>
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
