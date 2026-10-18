"use client";

import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { createDeliveryOrderAction } from "@/actions/delivery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Label, Select, Textarea } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionFeedback, FieldError, SubmitButton, useActionForm } from "@/components/forms/shared";
import { cn, formatMt } from "@/lib/utils";

export type DoLineOption = {
  id: string;
  productCode: string;
  productName: string;
  qtyMt: string;
  deliveredMt: string;
  allocatableMt: string;
};

export type QueueEntry = {
  orderNo: string;
  status: string;
  remainingMt: string;
  delivering: boolean;
};

export function DoCreateForm({
  orderId,
  orderNo,
  customerName,
  lines,
  warehouses,
  availability,
  queue,
  blocked,
  blockingOrderNo,
  blockingOrderId,
  blockingRemainingMt,
  queuePosition,
  overrideEnabled,
}: {
  orderId: string;
  orderNo: string;
  customerName: string;
  lines: DoLineOption[];
  warehouses: { code: string; name: string }[];
  availability: Record<string, string>;
  queue: QueueEntry[];
  blocked: boolean;
  blockingOrderNo: string | null;
  blockingOrderId: string | null;
  blockingRemainingMt: string | null;
  queuePosition: number;
  overrideEnabled: boolean;
}) {
  const { state, formAction, pending } = useActionForm(createDeliveryOrderAction);
  const [warehouseCode, setWarehouseCode] = React.useState(warehouses[0]?.code ?? "");
  const [quantities, setQuantities] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, ""])),
  );
  const [override, setOverride] = React.useState(false);

  const availabilityFor = (productCode: string) => {
    const key = `${warehouseCode}:${productCode}`;
    return availability[key] ?? "0.000";
  };

  const payload = JSON.stringify(
    Object.entries(quantities)
      .filter(([, value]) => value !== "" && Number(value) > 0)
      .map(([orderItemId, qtyMt]) => ({ orderItemId, qtyMt })),
  );

  const hasQuantity = Object.values(quantities).some((value) => Number(value) > 0);
  const overLine = lines.some((line) => Number(quantities[line.id] ?? 0) > Number(line.allocatableMt));
  const overStock = lines.some(
    (line) => Number(quantities[line.id] ?? 0) > Number(availabilityFor(line.productCode)),
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="payload" value={payload} />

      {blocked ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            PRIORITY_BLOCKED — order {blockingOrderNo} of {customerName} must be completed first
            {blockingRemainingMt ? ` (remaining ${blockingRemainingMt} MT)` : ""}.
          </p>
          <p className="mt-1 text-xs">
            {orderNo} is #{queuePosition} in this customer&apos;s queue. Deliver{" "}
            {blockingOrderNo} first, or use the Sales Ops priority override below with a written
            reason (audited and reported).
          </p>
          {blockingOrderId ? (
            <p className="mt-2">
              <Link
                href={`/sales-ops/delivery-orders/new?orderId=${blockingOrderId}`}
                className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
              >
                Deliver {blockingOrderNo} first →
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          {orderNo} is #{queuePosition} in {customerName}&apos;s queue — delivery is allowed without
          any override.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Customer delivery queue</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {queue.length === 0 ? (
            <p className="text-sm text-slate-500">This order is the only active order for the customer.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {queue.map((entry, index) => (
                <li key={entry.orderNo} className="flex items-center gap-2">
                  <span className="w-6 text-xs text-slate-400">#{index + 1}</span>
                  <span className={cn("font-medium", entry.delivering ? "text-emerald-700" : "text-slate-700")}>
                    {entry.orderNo}
                  </span>
                  <span className="text-slate-500">
                    {entry.status} · remaining {formatMt(entry.remainingMt)}
                  </span>
                  {entry.delivering ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                      delivering now
                    </span>
                  ) : (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      blocked
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Warehouse &amp; quantities</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="Warehouse (chosen manually by Sales Ops)" htmlFor="warehouseCode" required>
            <Select
              id="warehouseCode"
              name="warehouseCode"
              value={warehouseCode}
              onChange={(event) => setWarehouseCode(event.target.value)}
              required
            >
              <option value="" disabled>
                Select a warehouse
              </option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.code} value={warehouse.code}>
                  {warehouse.name} ({warehouse.code})
                </option>
              ))}
            </Select>
            <FieldError state={state} name="warehouseCode" />
          </Field>

          <div className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Can allocate</TableHead>
                  <TableHead className="text-right">Available here</TableHead>
                  <TableHead className="w-40">DO quantity (MT)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const available = availabilityFor(line.productCode);
                  const value = quantities[line.id] ?? "";
                  const lineOver = Number(value || 0) > Number(line.allocatableMt);
                  const stockOver = Number(value || 0) > Number(available);
                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <span className="font-medium">{line.productName}</span>
                        <span className="ml-1 text-xs text-slate-500">{line.productCode}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{line.qtyMt}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.deliveredMt}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.allocatableMt}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          Number(available) <= 0 && "text-red-600",
                        )}
                      >
                        {available}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Quantity for ${line.productName}`}
                          inputMode="decimal"
                          value={value}
                          className={cn(
                            (lineOver || stockOver) && "border-red-400",
                            "h-8",
                          )}
                          onChange={(event) =>
                            setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                          }
                          placeholder="0.000"
                        />
                        {lineOver ? (
                          <p className="mt-1 text-xs text-red-600">Exceeds allocatable quantity.</p>
                        ) : null}
                        {!lineOver && stockOver ? (
                          <p className="mt-1 text-xs text-red-600">Exceeds available stock.</p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Field label="Note (optional)" htmlFor="note">
            <Textarea id="note" name="note" rows={2} placeholder="Truck arrangement, port, batch…" />
          </Field>

          {blocked && overrideEnabled ? (
            <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50/70 p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="priorityOverride"
                  name="priorityOverride"
                  checked={override}
                  onChange={(event) => setOverride(event.target.checked)}
                />
                <Label htmlFor="priorityOverride">Priority override (Sales Ops only)</Label>
              </div>
              <p className="text-xs text-slate-600">
                Only needed because {blockingOrderNo} is still open. Ticking this bypasses the
                customer&apos;s queue for this delivery order; the reason, the blocked order and your
                name appear in the audit trail and the priority override report.
              </p>
              {override ? (
                <Field label="Written reason" htmlFor="overrideReason" required>
                  <Textarea id="overrideReason" name="overrideReason" rows={2} required />
                </Field>
              ) : null}
            </div>
          ) : null}

          <ActionFeedback state={state} />

          <div className="flex justify-end">
            <SubmitButton
              pending={pending}
              variant="primary"
              disabled={!hasQuantity || overLine || overStock || (blocked && !override)}
            >
              Create delivery order &amp; reserve stock
            </SubmitButton>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
