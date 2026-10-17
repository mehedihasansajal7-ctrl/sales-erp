"use client";

import * as React from "react";
import { CheckCircle2, Info, PencilLine, XCircle } from "lucide-react";
import {
  approveOrderAction,
  editPendingOrderAction,
  overrideOrderItemRateAction,
  rejectOrderAction,
} from "@/actions/order";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Label, Textarea } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ActionFeedback, SubmitButton, useActionForm } from "@/components/forms/shared";
import { ConfirmActionDialog } from "@/components/forms/confirm-dialog";
import { cn, formatBdt } from "@/lib/utils";

export type ApprovalCheckView = {
  key: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail: string;
};

/** Rule 2 — approve / reject with the checks visible on screen. */
export function ApprovePanel({
  orderId,
  orderNo,
  totalValue,
  checks,
  requiresOverride,
}: {
  orderId: string;
  orderNo: string;
  totalValue: string;
  checks: ApprovalCheckView[];
  requiresOverride: boolean;
}) {
  const { state, formAction, pending } = useActionForm(approveOrderAction);
  const [creditOverride, setCreditOverride] = React.useState(false);

  const blocked = checks.some((check) => !check.ok && check.blocking);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval checks — {orderNo}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {checks.map((check) => (
            <li key={check.key} className="flex items-start gap-2 text-sm">
              {check.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              ) : check.blocking ? (
                <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
              )}
              <span>
                <span className="font-medium text-slate-800">{check.label}: </span>
                <span className={cn("text-slate-600", !check.ok && !check.blocking && "text-amber-800")}>
                  {check.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="text-sm text-slate-500">Order value {formatBdt(totalValue)}</p>

        <form action={formAction} className="flex flex-col gap-3 border-t border-slate-100 pt-3">
          <input type="hidden" name="orderId" value={orderId} />
          {requiresOverride ? (
            <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="creditOverride"
                  name="creditOverride"
                  checked={creditOverride}
                  onChange={(event) => setCreditOverride(event.target.checked)}
                />
                <Label htmlFor="creditOverride" className="text-amber-900">
                  Override the credit limit
                </Label>
              </div>
              {creditOverride ? (
                <Field label="Written reason" htmlFor="overrideReason" required>
                  <Textarea id="overrideReason" name="overrideReason" rows={2} required />
                </Field>
              ) : null}
            </div>
          ) : null}

          <ActionFeedback state={state} />

          <div className="flex flex-wrap gap-2">
            <SubmitButton
              pending={pending}
              variant="primary"
              disabled={blocked || (requiresOverride && !creditOverride)}
            >
              Approve order
            </SubmitButton>
            <ConfirmActionDialog
              action={rejectOrderAction}
              triggerLabel="Reject"
              triggerVariant="destructive"
              title={`Reject ${orderNo}`}
              description="The salesperson sees this reason. A rejected order never blocks the customer queue."
              confirmLabel="Reject order"
              fields={{ orderId }}
              requireReason
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** One line the approver may correct before approving. */
export type EditableOrderLine = {
  id: string;
  productName: string;
  productCode: string;
  qtyMt: string;
  lockedRatePerMt: string;
};

/**
 * "Edit order" — Sales Ops fixes a typo (a missing zero in the rate, a wrong MT
 * quantity, wrong remarks) while the order is still pending, instead of rejecting
 * it and making the salesperson re-enter everything. A written reason is
 * mandatory and the change is audited line by line.
 */
export function EditOrderDialog({
  orderId,
  orderNo,
  lines,
  remarks,
}: {
  orderId: string;
  orderNo: string;
  lines: EditableOrderLine[];
  remarks?: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState(() =>
    lines.map((line) => ({ id: line.id, qtyMt: line.qtyMt, rate: line.lockedRatePerMt })),
  );
  const [reason, setReason] = React.useState("");
  const { state, formAction, pending } = useActionForm(editPendingOrderAction, () => setOpen(false));

  const payload = JSON.stringify(
    rows.map((row) => ({
      orderItemId: row.id,
      qtyMt: row.qtyMt,
      lockedRatePerMt: row.rate,
    })),
  );

  const total = rows.reduce((acc, row) => {
    const qty = Number(row.qtyMt);
    const rate = Number(row.rate);
    return Number.isFinite(qty) && Number.isFinite(rate) ? acc + qty * rate : acc;
  }, 0);

  const invalid = rows.some((row) => !(Number(row.qtyMt) > 0) || !(Number(row.rate) > 0));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" type="button">
          <PencilLine className="size-4" /> Edit order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Correct {orderNo} before approving</DialogTitle>
          <DialogDescription>
            Fix a quantity or a rate here instead of rejecting the order. The customer and the product
            lines stay as they are (reject and recreate for a structural mistake). Every change is
            recorded in the audit trail with your reason.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="payload" value={payload} />

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1 text-left">Product</th>
                  <th className="px-2 py-1 text-left">Qty (MT)</th>
                  <th className="px-2 py-1 text-left">Rate (৳/MT)</th>
                  <th className="px-2 py-1 text-right">Line value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const line = lines[index]!;
                  const value = Number(row.qtyMt) * Number(row.rate);
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-2 py-2">
                        {line.productName}
                        <span className="ml-1 text-xs text-slate-500">{line.productCode}</span>
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          aria-label={`Quantity for ${line.productName}`}
                          inputMode="decimal"
                          className="h-8 w-28"
                          value={row.qtyMt}
                          onChange={(event) =>
                            setRows((current) =>
                              current.map((entry, i) =>
                                i === index ? { ...entry, qtyMt: event.target.value } : entry,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          aria-label={`Rate for ${line.productName}`}
                          inputMode="decimal"
                          className="h-8 w-32"
                          value={row.rate}
                          onChange={(event) =>
                            setRows((current) =>
                              current.map((entry, i) =>
                                i === index ? { ...entry, rate: event.target.value } : entry,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {Number.isFinite(value) ? formatBdt(value) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Quantity and rate must be greater than zero.</span>
            <span className="font-semibold tabular-nums">New total {formatBdt(total)}</span>
          </div>

          <Field label="Remarks (optional)" htmlFor="edit-remarks">
            <Textarea id="edit-remarks" name="remarks" rows={2} defaultValue={remarks ?? ""} />
          </Field>

          <Field label="Reason for the correction" htmlFor="edit-reason" required>
            <Textarea
              id="edit-reason"
              name="reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. rate entered with one zero missing, customer confirmed by phone"
              required
            />
          </Field>

          <ActionFeedback state={state} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton
              pending={pending}
              variant="primary"
              disabled={invalid || reason.trim().length < 3}
            >
              Save changes
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** SALES_OPS-only rate override on a pending order line (Rule 1, audited). */export function OverrideRateDialog({
  orderItemId,
  productName,
  currentRate,
}: {
  orderItemId: string;
  productName: string;
  currentRate: string;
}) {
  return (
    <ConfirmActionDialog
      action={overrideOrderItemRateAction}
      triggerLabel="Override rate"
      triggerVariant="ghost"
      title={`Override rate — ${productName}`}
      description={`Current locked rate: ৳${currentRate}/MT. Sales Operations may change it before approval; a written reason is mandatory and the change is audited.`}
      confirmLabel="Apply override"
      fields={{ orderItemId }}
      requireReason
      reasonLabel="Reason for the rate override"
    >
      <Field label="New locked rate (৳ per MT)" htmlFor="lockedRatePerMt" required>
        <Input
          id="lockedRatePerMt"
          name="lockedRatePerMt"
          inputMode="decimal"
          defaultValue={currentRate}
          required
        />
      </Field>
    </ConfirmActionDialog>
  );
}
