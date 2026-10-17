import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDateTime, toDateTimeLocalValue } from "@/lib/dates";
import { getDeliveryOrder } from "@/server/services/delivery-order.service";
import { isAppError } from "@/lib/errors";
import { formatMt, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, DetailList, PageHeader, ProgressBar, StatusBadge } from "@/components/page-header";
import { DispatchForm } from "@/components/forms/dispatch-form";

export const dynamic = "force-dynamic";

export default async function WarehouseDispatchOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("dispatch.create");
  const { id } = await params;

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

  const open = deliveryOrder.status === "CREATED" || deliveryOrder.status === "PARTIALLY_DISPATCHED";

  return (
    <div>
      <PageHeader
        title={`Dispatch — ${deliveryOrder.doNo}`}
        description={`${deliveryOrder.orderNo} · ${deliveryOrder.customerName} · ${deliveryOrder.warehouseName}`}
        breadcrumb={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/warehouse/dispatch-orders", label: "My delivery orders" },
        ]}
        actions={<StatusBadge status={deliveryOrder.status} label={deliveryOrder.statusLabel} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Delivery order summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DetailList
              items={[
                { label: "Customer", value: deliveryOrder.customerName },
                { label: "Order", value: deliveryOrder.orderNo },
                { label: "Warehouse", value: deliveryOrder.warehouseName },
                { label: "Created", value: `${formatDateTime(deliveryOrder.createdAt)} by ${deliveryOrder.createdByName}` },
                { label: "DO quantity", value: formatMt(deliveryOrder.qtyMt) },
                { label: "Dispatched so far", value: formatMt(deliveryOrder.dispatchedMt) },
              ]}
            />
            <ProgressBar
              percent={Number(deliveryOrder.qtyMt) === 0 ? 0 : (Number(deliveryOrder.dispatchedMt) / Number(deliveryOrder.qtyMt)) * 100}
              label={`${deliveryOrder.dispatchedMt} of ${deliveryOrder.qtyMt} MT`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Priority</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600">
            {deliveryOrder.priorityOverride ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
                Priority override granted by Sales Ops: {deliveryOrder.overrideReason}
              </p>
            ) : (
              <p>
                Normal priority. On every dispatch the system re-checks this customer&apos;s queue: if an
                older order of the same customer is not fully delivered, the dispatch is rejected with{" "}
                <code className="rounded bg-slate-100 px-1">PRIORITY_BLOCKED</code>.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {open ? (
        <div className="mt-4">
          <DispatchForm
            doId={deliveryOrder.id}
            doNo={deliveryOrder.doNo}
            lines={deliveryOrder.items.map((item) => ({
              id: item.id,
              productCode: item.productCode,
              productName: item.productName,
              qtyMt: item.qtyMt,
              dispatchedMt: item.dispatchedMt,
              remainingMt: item.remainingMt,
            }))}
            defaultLoadingDate={toDateTimeLocalValue()}
            defaultDispatchDate={toDateTimeLocalValue()}
          />
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          This delivery order is closed ({deliveryOrder.statusLabel}) — nothing more can be dispatched.
        </p>
      )}

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Dispatch history</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={[
                { key: "challanNo", label: "Challan" },
                { key: "truckNo", label: "Truck" },
                { key: "driverName", label: "Driver" },
                { key: "driverPhone", label: "Phone" },
                { key: "qtyMt", label: "Qty (MT)", align: "right", render: (row) => formatNumber(row.qtyMt) },
                { key: "loadingDate", label: "Loading", render: (row) => formatDate(row.loadingDate) },
                { key: "dispatchDate", label: "Dispatched", render: (row) => formatDate(row.dispatchDate) },
                { key: "recordedByName", label: "Recorded by" },
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
