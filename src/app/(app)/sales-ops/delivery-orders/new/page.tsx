import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getSettings, SETTING_KEYS } from "@/lib/settings";
import { customerQueue } from "@/server/services/priority.service";
import { getBalance, availableMt } from "@/server/services/stock.service";
import { listWarehouses } from "@/server/services/master-data.service";
import { dec } from "@/lib/decimal";
import { formatMt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/form";
import { DataTable, PageHeader, StatusBadge } from "@/components/page-header";
import { DoCreateForm } from "@/components/forms/do-form";

export const dynamic = "force-dynamic";

export default async function NewDeliveryOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  await requirePermission("do.create");
  const { orderId } = await searchParams;

  const warehouses = await listWarehouses(false);

  if (!orderId) {
    const candidates = await prisma.order.findMany({
      where: { status: { in: ["APPROVED", "PARTIALLY_DELIVERED"] } },
      orderBy: { orderDate: "asc" },
      include: { customer: true, items: true },
      take: 50,
    });

    return (
      <div>
        <PageHeader
          title="New delivery order"
          description="Pick the approved order you want to deliver. A DO can only be created for an approved order."
          breadcrumb={[
            { href: "/dashboard", label: "Dashboard" },
            { href: "/sales-ops/delivery-orders", label: "Delivery orders" },
          ]}
        />
        {candidates.length === 0 ? (
          <EmptyState
            title="No approved order is waiting for delivery"
            description="Approve an order first — a delivery order cannot be created for an unapproved order."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/sales-ops/approvals">Open approval queue</Link>
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={[
              { key: "orderNo", label: "Order no" },
              { key: "customer", label: "Customer", render: (row) => `${row.customer.name} (${row.customerId})` },
              {
                key: "status",
                label: "Status",
                render: (row) => <StatusBadge status={row.status} />,
              },
              { key: "orderSeq", label: "Priority #", align: "right" },
              { key: "remaining", label: "Remaining (MT)", align: "right" },
              {
                key: "action",
                label: "",
                align: "right",
                render: (row) => (
                  <Button asChild size="sm" variant="primary">
                    <Link href={`/sales-ops/delivery-orders/new?orderId=${row.id}`}>Create DO</Link>
                  </Button>
                ),
              },
            ]}
            rows={candidates.map((order) => ({
              id: order.id,
              orderNo: order.orderNo,
              customerId: order.customerId,
              customer: order.customer,
              status: order.status,
              orderSeq: order.orderSeq,
              remaining: formatMt(
                order.items.reduce(
                  (acc, item) => acc + (Number(item.qtyMt) - Number(item.deliveredMt)),
                  0,
                ),
              ),
            }))}
            rowKey={(row) => row.id}
          />
        )}
      </div>
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true, items: { include: { product: true } } },
  });

  if (!order || (order.status !== "APPROVED" && order.status !== "PARTIALLY_DELIVERED")) {
    return (
      <div>
        <PageHeader title="New delivery order" />
        <EmptyState
          title="This order cannot receive a delivery order"
          description="Only approved or partially delivered orders can be delivered."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/sales-ops/delivery-orders/new">Choose another order</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const queue = await prisma.$transaction(async (tx) => customerQueue(tx, order.customerId));
  const head = queue[0] ?? null;
  const blocked = Boolean(head && head.id !== order.id);
  const settings = await getSettings();
  const overrideEnabled = settings[SETTING_KEYS.priorityOverrideEnabled] === "true";

  const lines = order.items.map((item) => ({
    id: item.id,
    productCode: item.productCode,
    productName: item.product.name,
    qtyMt: item.qtyMt.toFixed(3),
    deliveredMt: item.deliveredMt.toFixed(3),
    allocatableMt: dec(item.qtyMt).minus(dec(item.doAllocatedMt)).toFixed(3),
  }));

  const availability: Record<string, string> = {};
  for (const warehouse of warehouses) {
    for (const line of lines) {
      const balance = await getBalance(warehouse.code, line.productCode);
      availability[`${warehouse.code}:${line.productCode}`] = availableMt(balance);
    }
  }

  return (
    <div>
      <PageHeader
        title={`New delivery order — ${order.orderNo}`}
        description={`${order.customer.name} (${order.customerId}) · delivery priority #${order.orderSeq}`}
        breadcrumb={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/sales-ops/delivery-orders", label: "Delivery orders" },
          { href: `/sales/orders/${order.id}`, label: order.orderNo },
        ]}
        actions={<StatusBadge status={order.status} />}
      />

      {blocked ? null : (
        <Card className="mb-4 border-emerald-200 bg-emerald-50/40">
          <CardHeader>
            <CardTitle className="text-emerald-900">
              This order is at the head of the customer&apos;s queue — delivery is allowed without any
              override.
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      <DoCreateForm
        orderId={order.id}
        orderNo={order.orderNo}
        customerName={order.customer.name}
        lines={lines}
        warehouses={warehouses.map((warehouse) => ({ code: warehouse.code, name: warehouse.name }))}
        availability={availability}
        queue={queue.map((entry, index) => ({
          orderNo: entry.orderNo,
          status: entry.status.replace(/_/g, " "),
          remainingMt: entry.remainingMt,
          delivering: index === 0,
        }))}
        blocked={blocked}
        blockingOrderNo={head?.orderNo ?? null}
        blockingOrderId={head?.id ?? null}
        blockingRemainingMt={head?.remainingMt ?? null}
        queuePosition={queue.findIndex((entry) => entry.id === order.id) + 1}
        overrideEnabled={overrideEnabled}
      />
    </div>
  );
}
