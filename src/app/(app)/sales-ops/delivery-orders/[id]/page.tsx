import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { roleHasPermission } from "@/lib/rbac";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getDeliveryOrder } from "@/server/services/delivery-order.service";
import { isAppError } from "@/lib/errors";
import { formatMt, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, DetailList, PageHeader, ProgressBar, StatusBadge } from "@/components/page-header";
import { ConfirmActionDialog } from "@/components/forms/confirm-dialog";
import { DoEditDialog } from "@/components/forms/do-edit-dialog";
import { cancelDeliveryOrderAction } from "@/actions/delivery";

export const dynamic = "force-dynamic";

export default async function DeliveryOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { created } = await searchParams;

  let deliveryOrder: Awaited<ReturnType<typeof getDeliveryOrder>>;
  try {
    deliveryOrder = await getDeliveryOrder(id, {
      id: user.id,
      name: user.name,
      role: user.role,
      warehouseCode: user.warehouseId,
    });
  } catch (error) {
    if (isAppError(error) && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const canCancel = roleHasPermission(user.role, "do.cancel");

  return (
    <div>
      <PageHeader
        title={`Delivery order ${deliveryOrder.doNo}`}
        description={`${deliveryOrder.orderNo} · ${deliveryOrder.customerName} (${deliveryOrder.customerCode}) · ${deliveryOrder.warehouseName}`}
        breadcrumb={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/sales-ops/delivery-orders", label: "Delivery orders" },
        ]}
        actions={
          <>
            <StatusBadge status={deliveryOrder.status} label={deliveryOrder.statusLabel} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/print/do/${deliveryOrder.id}`} target="_blank">
                Print DO / PDF
              </Link>
            </Button>
            {canCancel && deliveryOrder.status === "CREATED" ? (
              <>
                <DoEditDialog
                  doId={deliveryOrder.id}
                  doNo={deliveryOrder.doNo}
                  warehouseName={deliveryOrder.warehouseName}
                  lines={deliveryOrder.items.map((item) => ({
                    id: item.id,
                    productName: item.productName,
                    productCode: item.productCode,
                    qtyMt: item.qtyMt,
                    allocatableMt: item.allocatableMt,
                    dispatchedMt: item.dispatchedMt,
                  }))}
                />
                <ConfirmActionDialog
                  action={cancelDeliveryOrderAction}
                  triggerLabel="Cancel DO"
                  triggerVariant="destructive"
                  title={`Cancel ${deliveryOrder.doNo}`}
                  description="Releases the reserved stock back to the warehouse. Only possible while nothing has been dispatched."
                  confirmLabel="Cancel delivery order"
                  fields={{ doId: deliveryOrder.id }}
                  requireReason
                />
              </>
            ) : null}
          </>
        }
      />

      {created ? (
        <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Delivery order created — {formatMt(deliveryOrder.qtyMt)} reserved at{" "}
          {deliveryOrder.warehouseName}.
        </p>
      ) : null}

      {deliveryOrder.priorityOverride ? (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Priority override.</strong> Reason: {deliveryOrder.overrideReason} — granted by{" "}
          {deliveryOrder.createdByName}. This appears in the priority override report.
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
                { label: "Order", value: <Link className="text-emerald-700 hover:underline" href={`/sales/orders/${deliveryOrder.orderId}`}>{deliveryOrder.orderNo}</Link> },
                { label: "Customer", value: deliveryOrder.customerName },
                {
                  label: "Warehouse",
                  value: `${deliveryOrder.warehouseName}${deliveryOrder.warehouseLocation ? ` (${deliveryOrder.warehouseLocation})` : ""}`,
                },
                { label: "Created", value: `${formatDateTime(deliveryOrder.createdAt)} by ${deliveryOrder.createdByName}` },
                { label: "DO quantity", value: formatMt(deliveryOrder.qtyMt) },
                { label: "Dispatched", value: formatMt(deliveryOrder.dispatchedMt) },
                { label: "Pending", value: formatMt(deliveryOrder.remainingMt) },
                { label: "Note", value: deliveryOrder.note ?? "—" },
              ]}
            />
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Dispatch progress
              </p>
              <ProgressBar
                percent={Number(deliveryOrder.qtyMt) === 0 ? 0 : (Number(deliveryOrder.dispatchedMt) / Number(deliveryOrder.qtyMt)) * 100}
                label={`${deliveryOrder.dispatchedMt} of ${deliveryOrder.qtyMt} MT`}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dispatcher</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-slate-600">
            <p>
              The warehouse assigned to this DO records truck, driver, challan and quantity. It
              cannot change quantities or create DOs.
            </p>
            <p className="text-xs text-slate-500">
              Every dispatch re-checks the customer priority queue, so the rule holds even if the
              queue changed after this DO was created.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link href={`/warehouse/dispatch-orders/${deliveryOrder.id}`}>
                Open dispatch entry
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>DO lines</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={[
                { key: "productName", label: "Product" },
                { key: "qtyMt", label: "Qty (MT)", align: "right", render: (row) => formatNumber(row.qtyMt) },
                {
                  key: "dispatchedMt",
                  label: "Dispatched (MT)",
                  align: "right",
                  render: (row) => formatNumber(row.dispatchedMt),
                },
                {
                  key: "remainingMt",
                  label: "Pending (MT)",
                  align: "right",
                  render: (row) => formatNumber(row.remainingMt),
                },
              ]}
              rows={deliveryOrder.items}
              rowKey={(row) => row.id}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dispatches</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={[
                { key: "challanNo", label: "Challan" },
                { key: "truckNo", label: "Truck" },
                { key: "driverName", label: "Driver" },
                { key: "qtyMt", label: "Qty (MT)", align: "right", render: (row) => formatNumber(row.qtyMt) },
                { key: "dispatchDate", label: "Dispatched", render: (row) => formatDate(row.dispatchDate) },
                {
                  key: "action",
                  label: "",
                  align: "right",
                  render: (row) => (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/print/challan/${row.id}`} target="_blank">
                        Challan
                      </Link>
                    </Button>
                  ),
                },
              ]}
              rows={deliveryOrder.dispatches}
              rowKey={(row) => row.id}
              emptyMessage="Nothing dispatched yet."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
