"use client";

import * as React from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { approveOrderAction, overrideOrderItemRateAction, rejectOrderAction } from "@/actions/order";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Label, Textarea } from "@/components/ui/form";
import {
  ActionFeedback,
  SubmitButton,
  useActionForm,
} from "@/components/forms/shared";
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

/** SALES_OPS-only rate override on a pending order line (Rule 1, audited). */
export function OverrideRateDialog({
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
