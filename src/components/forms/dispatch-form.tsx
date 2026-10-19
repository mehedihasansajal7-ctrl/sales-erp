"use client";

import * as React from "react";
import { recordDispatchAction } from "@/actions/delivery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionFeedback, FieldError, SubmitButton, useActionForm } from "@/components/forms/shared";

export type DispatchLine = {
  id: string;
  productCode: string;
  productName: string;
  qtyMt: string;
  dispatchedMt: string;
  remainingMt: string;
};

/**
 * Rule 6 — the warehouse records a dispatch against a DO.
 *
 * Who sets the quantity is a policy decision (Settings → "Warehouse may dispatch
 * less than the DO quantity"):
 *   * default (false): Sales Operations owns the quantity. The warehouse only
 *     enters truck / driver / challan / dates and ships the full DO quantity.
 *   * true: the warehouse may split a DO over several shipments (partial).
 */
export function DispatchForm({
  doId,
  doNo,
  lines,
  defaultLoadingDate,
  defaultDispatchDate,
  allowPartial,
}: {
  doId: string;
  doNo: string;
  lines: DispatchLine[];
  defaultLoadingDate: string;
  defaultDispatchDate: string;
  allowPartial: boolean;
}) {
  const { state, formAction, pending } = useActionForm(recordDispatchAction);
  const [quantities, setQuantities] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, line.remainingMt])),
  );
  const [loadingDate, setLoadingDate] = React.useState(defaultLoadingDate);
  const [dispatchDate, setDispatchDate] = React.useState(defaultDispatchDate);

  // Rule 6 — never dispatch before loading. Compared at day level: same day is
  // fine (loading 08:00 → dispatch 06:00), the previous day never is.
  const loadingDay = loadingDate.slice(0, 10);
  const dispatchDay = dispatchDate.slice(0, 10);
  const dateInvalid = Boolean(loadingDay && dispatchDay) && dispatchDay < loadingDay;

  const onLoadingChange = (value: string) => {
    setLoadingDate(value);
    // Keep the pair valid: if the loading day moves past the dispatch day, move it too.
    if (dispatchDate.slice(0, 10) < value.slice(0, 10)) setDispatchDate(value);
  };

  // The quantity is only user-editable when the setting allows partial dispatch.
  const effectiveQty = (line: DispatchLine) =>
    allowPartial ? (quantities[line.id] ?? "") : line.remainingMt;

  const payload = JSON.stringify(
    lines
      .map((line) => ({ doItemId: line.id, qtyMt: effectiveQty(line) }))
      .filter((line) => line.qtyMt !== "" && Number(line.qtyMt) > 0),
  );

  const overLine =
    allowPartial &&
    lines.some((line) => Number(quantities[line.id] ?? 0) > Number(line.remainingMt));
  const hasQuantity =
    payload.length > 2 &&
    (allowPartial
      ? Object.values(quantities).some((value) => Number(value) > 0)
      : lines.every((line) => Number(line.remainingMt) > 0));
  const isPartial =
    allowPartial &&
    lines.some((line) => Number(quantities[line.id] ?? 0) < Number(line.remainingMt));

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="doId" value={doId} />
      <input type="hidden" name="payload" value={payload} />

      <Card>
        <CardHeader>
          <CardTitle>Vehicle &amp; challan — {doNo}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Truck / vehicle number" htmlFor="truckNo" required>
            <Input id="truckNo" name="truckNo" placeholder="Dhaka Metro-Ta 11-2233" required />
            <FieldError state={state} name="truckNo" />
          </Field>
          <Field
            label="Challan number (optional)"
            htmlFor="challanNo"
            hint="Leave it empty and the system generates a dated challan number (CH-19-10-2026-001). Type one only when a physical challan already carries its own number."
          >
            <Input id="challanNo" name="challanNo" placeholder="Auto — CH-19-10-2026-001" />
            <FieldError state={state} name="challanNo" />
          </Field>
          <Field label="Driver name" htmlFor="driverName" required>
            <Input id="driverName" name="driverName" placeholder="Md. Karim" required />
          </Field>
          <Field label="Driver phone" htmlFor="driverPhone" required>
            <Input
              id="driverPhone"
              name="driverPhone"
              inputMode="tel"
              placeholder="01711-000000"
              required
            />
            <FieldError state={state} name="driverPhone" />
          </Field>
          <Field label="Loading date" htmlFor="loadingDate" required>
            <Input
              id="loadingDate"
              name="loadingDate"
              type="datetime-local"
              value={loadingDate}
              onChange={(event) => onLoadingChange(event.target.value)}
              required
            />
          </Field>
          <Field
            label="Dispatch date"
            htmlFor="dispatchDate"
            hint="Same day as loading or later. An earlier day is not allowed."
            required
          >
            <Input
              id="dispatchDate"
              name="dispatchDate"
              type="datetime-local"
              value={dispatchDate}
              min={loadingDay ? `${loadingDay}T00:00` : undefined}
              aria-invalid={dateInvalid}
              onChange={(event) => setDispatchDate(event.target.value)}
              required
            />
            {dateInvalid ? (
              <p role="alert" className="text-xs font-medium text-red-600">
                Dispatch date cannot be earlier than the loading date ({loadingDay}).
              </p>
            ) : null}
            <FieldError state={state} name="dispatchDate" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quantity to dispatch</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">DO qty (MT)</TableHead>
                <TableHead className="text-right">Already dispatched (MT)</TableHead>
                <TableHead className="text-right">Dispatch now (MT)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <span className="font-medium">{line.productName}</span>
                    <span className="ml-1 text-xs text-slate-500">{line.productCode}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{line.qtyMt}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.dispatchedMt}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {allowPartial ? (
                      <Input
                        aria-label={`Dispatch quantity for ${line.productName}`}
                        inputMode="decimal"
                        className="ml-auto h-8 w-32"
                        value={quantities[line.id] ?? ""}
                        onChange={(event) =>
                          setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                        }
                      />
                    ) : (
                      <span className="font-semibold">{line.remainingMt}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Field label="Remarks (optional)" htmlFor="remarks">
            <Textarea id="remarks" name="remarks" rows={2} />
          </Field>

          <p className="text-xs text-slate-500">
            {allowPartial
              ? isPartial
                ? "A partial dispatch keeps the DO in PARTIALLY_DISPATCHED until the remaining quantity ships."
                : "Full dispatch will complete the DO and update the order status automatically."
              : "Quantities are set by Sales Operations. You record the vehicle, driver, challan and dates, then dispatch the full DO. For a smaller shipment, ask Sales Operations to create a separate delivery order."}
          </p>

          <ActionFeedback state={state} />

          <div className="flex justify-end">
            <SubmitButton
              pending={pending}
              variant="primary"
              disabled={!hasQuantity || overLine || dateInvalid}
            >
              Record dispatch
            </SubmitButton>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
