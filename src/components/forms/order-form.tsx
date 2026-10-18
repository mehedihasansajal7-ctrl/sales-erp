"use client";

import * as React from "react";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { createOrderAction } from "@/actions/order";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionFeedback, FieldError, SubmitButton, useActionForm } from "@/components/forms/shared";
import { formatBdt, formatMt } from "@/lib/utils";

export type CustomerOption = { code: string; name: string; creditLimit: string | null };
export type PricedProduct = {
  code: string;
  name: string;
  category: string;
  ratePerMt: string | null;
  effectiveFrom: string | null;
  hasRate: boolean;
};

type Line = { key: string; productCode: string; qtyMt: string };

export function OrderCreateForm({
  customers,
  products,
  defaultOrderDate,
}: {
  customers: CustomerOption[];
  products: PricedProduct[];
  defaultOrderDate: string;
}) {
  const { state, formAction, pending } = useActionForm(createOrderAction);
  const [lines, setLines] = React.useState<Line[]>([{ key: "l1", productCode: "", qtyMt: "" }]);

  const rateByProduct = React.useMemo(
    () => new Map(products.map((product) => [product.code, product])),
    [products],
  );

  const addLine = () =>
    setLines((current) => [
      ...current,
      { key: `l${Date.now()}`, productCode: "", qtyMt: "" },
    ]);

  const removeLine = (key: string) =>
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.key !== key)));

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const total = lines.reduce((acc, line) => {
    const rate = rateByProduct.get(line.productCode)?.ratePerMt;
    const qty = Number(line.qtyMt);
    if (!rate || !Number.isFinite(qty)) return acc;
    return acc + qty * Number(rate);
  }, 0);

  const payload = JSON.stringify(
    lines
      .filter((line) => line.productCode && line.qtyMt)
      .map((line) => ({ productCode: line.productCode, qtyMt: line.qtyMt })),
  );

  const missingRate = lines.some(
    (line) => line.productCode && rateByProduct.get(line.productCode)?.hasRate === false,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="payload" value={payload} />

      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer" htmlFor="customerCode" required>
            <Select id="customerCode" name="customerCode" required defaultValue="">
              <option value="" disabled>
                Select a customer
              </option>
              {customers.map((customer) => (
                <option key={customer.code} value={customer.code}>
                  {customer.name} ({customer.code})
                  {customer.creditLimit ? ` · limit ৳${customer.creditLimit}` : ""}
                </option>
              ))}
            </Select>
            <FieldError state={state} name="customerCode" />
          </Field>

          <Field
            label="Order date &amp; time"
            htmlFor="orderDate"
            hint="Used for the locked rate, delivery priority and reporting."
          >
            <Input id="orderDate" name="orderDate" type="datetime-local" defaultValue={defaultOrderDate} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Product lines</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              One order can carry several products — add a line per product. Each line gets its own
              locked rate and the whole order is delivered together (across warehouses if needed).
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="size-4" /> Add product
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const product = rateByProduct.get(line.productCode);
            const lineValue =
              product?.ratePerMt && line.qtyMt
                ? Number(product.ratePerMt) * Number(line.qtyMt)
                : null;
            return (
              <div
                key={line.key}
                className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_140px_160px_auto] sm:items-end"
              >
                <Field label={`Product ${index + 1}`} htmlFor={`product-${line.key}`}>
                  <Select
                    id={`product-${line.key}`}
                    value={line.productCode}
                    onChange={(event) => updateLine(line.key, { productCode: event.target.value })}
                  >
                    <option value="">Select a product</option>
                    {products.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.name} ({option.code}){option.hasRate ? "" : " — no rate"}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Quantity (MT)" htmlFor={`qty-${line.key}`}>
                  <Input
                    id={`qty-${line.key}`}
                    inputMode="decimal"
                    value={line.qtyMt}
                    onChange={(event) => updateLine(line.key, { qtyMt: event.target.value })}
                    placeholder="100.000"
                  />
                </Field>

                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-slate-700">Locked rate</span>
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums">
                    {product?.ratePerMt ? `${formatBdt(product.ratePerMt)} / MT` : "—"}
                  </span>
                  <span className="text-xs text-slate-500">
                    {lineValue !== null ? `Line value ${formatBdt(lineValue)}` : "\u00a0"}
                  </span>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove line"
                  onClick={() => removeLine(line.key)}
                  disabled={lines.length === 1}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}

          {missingRate ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              One of the selected products has no published rate yet. Finance must publish a rate
              before it can be ordered — the server will block the order.
            </p>
          ) : null}

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-500">
              The rate is copied into the order and locked permanently.
            </span>
            <span className="text-lg font-semibold tabular-nums">
              Total {formatBdt(total)}
              <span className="ml-2 text-xs font-normal text-slate-500">
                {formatMt(
                  lines.reduce((acc, line) => acc + (Number(line.qtyMt) || 0), 0),
                )}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <Field label="Remarks (optional)" htmlFor="remarks">
            <Textarea id="remarks" name="remarks" rows={2} placeholder="Delivery instructions…" />
          </Field>
          <ActionFeedback state={state} />
          <div className="flex justify-end">
            <SubmitButton pending={pending} variant="primary" disabled={missingRate}>
              Submit order for approval
            </SubmitButton>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
