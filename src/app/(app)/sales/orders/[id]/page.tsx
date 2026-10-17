import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { roleHasPermission } from "@/lib/rbac";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getOrderDetail, runApprovalChecks } from "@/server/services/order.service";
import { cancelOrderAction as cancelAction, shortCloseOrderAction as shortCloseAction } from "@/actions/order";
import { formatBdt, formatMt, formatNumber, humanize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, DetailList, PageHeader, ProgressBar, StatusBadge, type Column } from "@/components/page-header";
import { ApprovePanel, OverrideRateDialog } from "@/components/forms/order-actions";
import { ConfirmActionDialog } from "@/components/forms/confirm-dialog";
import { isAppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type LineRow = {
  id: string;
  productCode: string;
  productName: string;
  qtyMt: string;
  deliveredMt: string;
  doAllocatedMt: string;
  remainingMt: string;
  lockedRatePerMt: string;
  lineValue: string;
  rateOverridden: boolean;
};

type DoRow = {
  id: string;
  doNo: string;
  status: string;
  warehouseName: string;
  qtyMt: string;
  dispatchedMt: string;
  remainingMt: string;
  priorityOverride: boolean;
};

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { created } = await searchParams;

  let order: Awaited<ReturnType<typeof getOrderDetail>>;
  try {
    order = await getOrderDetail(id, { id: user.id, name: user.name, role: user.role });
  } catch (error) {
    if (isAppError(error) && error.status === 404) notFound();
    throw error;
  }

  const canApprove = roleHasPermission(user.role, "order.approve");
  const canCreateDo = roleHasPermission(user.role, "do.create");
  const canCancel = roleHasPermission(user.role, "order.cancel");
  const canShortClose = roleHasPermission(user.role, "order.shortClose");
  const canOverrideRate = roleHasPermission(user.role, "order.overrideRate");

  const approval = order.status === "PENDING_APPROVAL" && canApprove
    ? await runApprovalChecks(order.id)
    : null;

  const lineColumns: Column<LineRow>[] = [
    {
      key: "product",
      label: "Product",
      render: (row) => (
        <span>
          <span className="font-medium">{row.productName}</span>
          <span className="ml-1 text-xs text-slate-500">{row.productCode}</span>
          {row.rateOverridden ? (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900">
              rate overridden
            </span>
          ) : null}
        </span>
      ),
    },
     { key: "qtyMt", label: "Ordered (MT)", align: "right", render: (row) => formatNumber(row.qtyMt) },
    { key: "deliveredMt", label: "Delivered (MT)", align: "right", render: (row) => formatNumber(row.deliveredMt) },
    { key: "doAllocatedMt", label: "In DOs (MT)", align: "right", render: (row) => formatNumber(row.doAllocatedMt) },
    { key: "remainingMt", label: "Remaining (MT)", align: "right", render: (row) => formatNumber(row.remainingMt) },
    {
      key: "lockedRatePerMt",
      label: "Locked rate (৳/MT)",
      align: "right",
      render: (row) => (
        <span className="font-medium">{formatBdt(row.lockedRatePerMt)}</span>
      ),
    },
    { key: "lineValue", label: "Line value", align: "right", render: (row) => formatBdt(row.lineValue) },
    ...(canOverrideRate && order.status === "PENDING_APPROVAL"
      ? [
          {
            key: "actions",
            label: "",
            align: "right" as const,
            render: (row: LineRow) => (
              <OverrideRateDialog
                orderItemId={row.id}
                productName={row.productName}
                currentRate={row.lockedRatePerMt}
              />
            ),
          },
        ]
      : []),
  ];

  const doColumns: Column<DoRow>[] = [
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
    { key: "warehouseName", label: "Warehouse" },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "qtyMt", label: "Qty (MT)", align: "right", render: (row) => formatNumber(row.qtyMt) },
    { key: "dispatchedMt", label: "Dispatched (MT)", align: "right", render: (row) => formatNumber(row.dispatchedMt) },
    { key: "remainingMt", label: "Pending (MT)", align: "right", render: (row) => formatNumber(row.remainingMt) },
    {
      key: "priorityOverride",
      label: "Override",
      render: (row) =>
        row.priorityOverride ? (
          <StatusBadge status="PENDING_APPROVAL" label="Priority override" />
        ) : (
          <span className="text-xs text-slate-400">No</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Order ${order.orderNo}`}
        description={`${order.customerName} · created ${formatDateTime(order.orderDate)} by ${order.createdByName}`}
        breadcrumb={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/sales/orders", label: "Orders" },
        ]}
        actions={
          <>
            <StatusBadge status={order.status} label={order.statusLabel} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/print/order/${order.id}`} target="_blank">
                Print / PDF
              </Link>
            </Button>
            {canCreateDo && (order.status === "APPROVED" || order.status === "PARTIALLY_DELIVERED") ? (
              <Button asChild variant="primary" size="sm">
                <Link href={`/sales-ops/delivery-orders/new?orderId=${order.id}`}>
                  Create delivery order
                </Link>
              </Button>
            ) : null}
            {canCancel && (order.status === "PENDING_APPROVAL" || order.status === "APPROVED") ? (
              <ConfirmActionDialog
                action={cancelAction}
                triggerLabel="Cancel order"
                triggerVariant="destructive"
                title={`Cancel ${order.orderNo}`}
                description="Only possible while nothing has been delivered. Reservations on open delivery orders are released."
                confirmLabel="Cancel order"
                fields={{ orderId: order.id }}
                requireReason
              />
            ) : null}
            {canShortClose &&
            (order.status === "APPROVED" || order.status === "PARTIALLY_DELIVERED") ? (
              <ConfirmActionDialog
                action={shortCloseAction}
                triggerLabel="Short close"
                triggerVariant="outline"
                title={`Short close ${order.orderNo}`}
                description="Closes the order with quantity still outstanding and unblocks the customer's next order. Delivered quantity is not affected."
                confirmLabel="Short close order"
                fields={{ orderId: order.id }}
                requireReason
              />
            ) : null}
          </>
        }
      />

      {created ? (
        <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Order created and submitted for approval. The rate is locked at{" "}
          {formatBdt(order.items[0]?.lockedRatePerMt ?? "0")}/MT.
        </p>
      ) : null}

      {order.status === "REJECTED" && order.rejectionReason ? (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Rejected: {order.rejectionReason}
        </p>
      ) : null}
      {order.status === "SHORT_CLOSED" && order.shortCloseReason ? (
        <p className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Short closed: {order.shortCloseReason}
        </p>
      ) : null}
      {order.status === "CANCELLED" && order.cancelReason ? (
        <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Cancelled: {order.cancelReason}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DetailList
              items={[
                { label: "Customer", value: `${order.customer.name} (${order.customer.code})` },
                { label: "Phone", value: order.customer.phone ?? "—" },
                { label: "Priority sequence", value: `#${order.orderSeq} for this customer` },
                { label: "Order date", value: formatDateTime(order.orderDate) },
                { label: "Approved by", value: order.approvedByName ?? "Pending" },
                { label: "Approved at", value: formatDateTime(order.approvedAt) },
                { label: "Order value", value: formatBdt(order.totalValue) },
                { label: "Delivered value", value: formatBdt(order.deliveredValue) },
                {
                  label: "Credit limit",
                  value: order.customer.creditLimit ? formatBdt(order.customer.creditLimit) : "Not configured",
                },
                { label: "Remarks", value: order.remarks ?? "—" },
              ]}
            />
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Delivery progress
              </p>
              <ProgressBar
                percent={order.progressPct}
                label={`${formatMt(order.deliveredMt)} of ${formatMt(order.orderedMt)}`}
              />
              <p className="mt-1 text-xs text-slate-500">
                Remaining {formatMt(order.remainingMt)} — the customer&apos;s newer orders stay blocked
                until this reaches zero.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-slate-600">
              {order.deliveryOrders.length} delivery order(s) ·{" "}
              {order.deliveryOrders.filter((row) => row.status === "DISPATCHED").length} fully dispatched
            </p>
            {order.deliveryOrders.length === 0 ? (
              <p className="text-xs text-slate-500">
                No delivery order yet. Sales Ops creates DOs and chooses the warehouse manually.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {order.deliveryOrders.map((row) => (
                  <li key={row.id} className="rounded-md border border-slate-200 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/sales-ops/delivery-orders/${row.id}`}
                        className="font-medium text-emerald-700 hover:underline"
                      >
                        {row.doNo}
                      </Link>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="text-xs text-slate-500">
                      {row.warehouseName} ·{" "}
                      {formatMt(
                        row.items.reduce((acc, item) => acc + Number(item.qtyMt), 0),
                      )}{" "}
                      · {row.dispatches.length} dispatch(es)
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {approval ? (
        <div className="mt-4">
          <ApprovePanel
            orderId={order.id}
            orderNo={order.orderNo}
            totalValue={order.totalValue}
            checks={approval.checks}
            requiresOverride={approval.requiresOverride}
          />
        </div>
      ) : null}

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Order lines — locked rates</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={lineColumns}
              rows={order.items}
              rowKey={(row) => row.id}
              emptyMessage="This order has no lines."
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Delivery orders</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={doColumns}
              rows={order.deliveryOrders.map((row) => ({
                id: row.id,
                doNo: row.doNo,
                status: row.status,
                warehouseName: row.warehouseName,
                qtyMt: row.items.reduce((acc, item) => acc + Number(item.qtyMt), 0).toFixed(3),
                dispatchedMt: row.items.reduce((acc, item) => acc + Number(item.dispatchedMt), 0).toFixed(3),
                remainingMt: row.items
                  .reduce((acc, item) => acc + (Number(item.qtyMt) - Number(item.dispatchedMt)), 0)
                  .toFixed(3),
                priorityOverride: row.priorityOverride,
              }))}
              rowKey={(row) => row.id}
              emptyMessage="No delivery orders yet."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {order.timeline.length === 0 ? (
              <p className="text-sm text-slate-500">No activity recorded.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {order.timeline.map((entry) => (
                  <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-sm font-medium text-slate-800">
                      {humanize(entry.action)} · {entry.entity.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-slate-500">
                      {entry.userName} · {formatDateTime(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Dispatch register for this order</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={[
                { key: "challanNo", label: "Challan" },
                { key: "doNo", label: "DO" },
                { key: "truckNo", label: "Truck" },
                { key: "driverName", label: "Driver" },
                { key: "driverPhone", label: "Phone" },
                { key: "qtyMt", label: "Qty (MT)", align: "right", render: (row) => formatNumber(row.qtyMt) },
                { key: "dispatchDate", label: "Dispatched", render: (row) => formatDate(row.dispatchDate) },
                { key: "recordedBy", label: "Recorded by" },
              ]}
              rows={order.deliveryOrders.flatMap((row) =>
                row.dispatches.map((dispatch) => ({
                  id: dispatch.id,
                  challanNo: dispatch.challanNo,
                  doNo: row.doNo,
                  truckNo: dispatch.truckNo,
                  driverName: dispatch.driverName,
                  driverPhone: dispatch.driverPhone,
                  qtyMt: dispatch.qtyMt,
                  dispatchDate: dispatch.dispatchDate,
                  recordedBy: dispatch.recordedBy,
                })),
              )}
              rowKey={(row) => row.id}
              emptyMessage="Nothing dispatched yet."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
