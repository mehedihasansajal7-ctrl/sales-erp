"use client";

import * as React from "react";
import { PencilLine } from "lucide-react";
import { editDeliveryOrderAction } from "@/actions/delivery";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { ActionFeedback, SubmitButton, useActionForm } from "@/components/forms/shared";
import { formatMt } from "@/lib/utils";

export type EditableDoLine = {
  id: string;
  productName: string;
  productCode: string;
  qtyMt: string;
  /** How much the order can still allocate to this DO line (incl. its own qty). */
  allocatableMt: string;
  dispatchedMt: string;
};

/**
 * Sales Operations corrects a DO's quantities **before anything is dispatched**.
 * The warehouse never sees this control; it only records the vehicle/challan and
 * dispatches the quantity decided here.
 */
export function DoEditDialog({
  doId,
  doNo,
  warehouseName,
  lines,
}: {
  doId: string;
  doNo: string;
  warehouseName: string;
  lines: EditableDoLine[];
}) {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState(() =>
    lines.map((line) => ({ id: line.id, qtyMt: line.qtyMt })),
  );
  const [reason, setReason] = React.useState("");
  const { state, formAction, pending } = useActionForm(editDeliveryOrderAction, () => setOpen(false));

  const payload = JSON.stringify(
    rows.map((row) => ({ doItemId: row.id, qtyMt: row.qtyMt })),
  );

  const invalid = rows.some((row, index) => {
    const qty = Number(row.qtyMt);
    return !(qty > 0) || qty > Number(lines[index]!.allocatableMt);
  });

  const total = rows.reduce((acc, row) => {
    const qty = Number(row.qtyMt);
    return Number.isFinite(qty) ? acc + qty : acc;
  }, 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" type="button">
          <PencilLine className="size-4" /> Edit quantities
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {doNo}</DialogTitle>
          <DialogDescription>
            Reserved stock in {warehouseName} is adjusted automatically. Only possible while nothing
            has been dispatched. The warehouse cannot change these quantities — it only records the
            vehicle, challan and dates.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="doId" value={doId} />
          <input type="hidden" name="payload" value={payload} />

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1 text-left">Product</th>
                  <th className="px-2 py-1 text-left">DO qty (MT)</th>
                  <th className="px-2 py-1 text-right">Max for this DO</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const line = lines[index]!;
                  const over = Number(row.qtyMt) > Number(line.allocatableMt);
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-2 py-2">
                        {line.productName}
                        <span className="ml-1 text-xs text-slate-500">{line.productCode}</span>
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          aria-label={`DO quantity for ${line.productName}`}
                          inputMode="decimal"
                          className="h-8 w-32"
                          value={row.qtyMt}
                          aria-invalid={over}
                          onChange={(event) =>
                            setRows((current) =>
                              current.map((entry, i) =>
                                i === index ? { ...entry, qtyMt: event.target.value } : entry,
                              ),
                            )
                          }
                        />
                        {over ? (
                          <p className="mt-1 text-xs text-red-600">
                            Max {formatMt(line.allocatableMt)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatMt(line.allocatableMt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-right text-sm font-semibold tabular-nums">New DO total {formatMt(total)}</p>

          <Field label="Reason for the change" htmlFor="do-edit-reason" required>
            <Textarea
              id="do-edit-reason"
              name="reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. truck capacity is 20 MT, the rest will go on a second DO"
              required
            />
          </Field>

          <ActionFeedback state={state} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pending={pending} variant="primary" disabled={invalid || reason.trim().length < 3}>
              Save quantities
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
