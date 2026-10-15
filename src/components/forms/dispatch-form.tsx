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

/** Rule 6 — the warehouse records a (possibly partial) dispatch against a DO. */
export function DispatchForm({
  doId,
  doNo,
  lines,
  defaultLoadingDate,
  defaultDispatchDate,
}: {
  doId: string;
  doNo: string;
  lines: DispatchLine[];
  defaultLoadingDate: string;
  defaultDispatchDate: string;
}) {
  const { state, formAction, pending } = useActionForm(recordDispatchAction);
  const [quantities, setQuantities] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, line.remainingMt])),
  );

  const payload = JSON.stringify(
    Object.entries(quantities)
      .filter(([, value]) => value !== "" && Number(value) > 0)
      .map(([doItemId, qtyMt]) => ({ doItemId, qtyMt })),
  );

  const overLine = lines.some((line) => Number(quantities[line.id] ?? 0) > Number(line.remainingMt));
  const hasQuantity = Object.values(quantities).some((value) => Number(value) > 0);
  const isPartial = lines.some((line) => Number(quantities[line.id] ?? 0) < Number(line.remainingMt));

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
            label="Challan number"
            htmlFor="challanNo"
            hint="Must be unique — a duplicate challan is rejected."
            required
          >
            <Input id="challanNo" name="challanNo" placeholder="CH-2026-000123" required />
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
              defaultValue={defaultLoadingDate}
              required
            />
          </Field>
          <Field label="Dispatch date" htmlFor="dispatchDate" required>
            <Input
              id="dispatchDate"
              name="dispatchDate"
              type="datetime-local"
              defaultValue={defaultDispatchDate}
              required
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dispatched quantity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">DO qty</TableHead>
                <TableHead className="text-right">Already dispatched</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="w-40">Dispatch now (MT)</TableHead>
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
                  <TableCell className="text-right tabular-nums">{line.remainingMt}</TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Dispatch quantity for ${line.productName}`}
                      inputMode="decimal"
                      className="h-8"
                      value={quantities[line.id] ?? ""}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Field label="Remarks (optional)" htmlFor="remarks">
            <Textarea id="remarks" name="remarks" rows={2} />
          </Field>

          <p className="text-xs text-slate-500">
            {isPartial
              ? "A partial dispatch keeps the DO in PARTIALLY_DISPATCHED until the remaining quantity ships."
              : "Full dispatch will complete the DO and update the order status automatically."}
          </p>

          <ActionFeedback state={state} />

          <div className="flex justify-end">
            <SubmitButton pending={pending} variant="primary" disabled={!hasQuantity || overLine}>
              Record dispatch
            </SubmitButton>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
