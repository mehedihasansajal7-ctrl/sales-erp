"use client";

import * as React from "react";
import { publishRateAction } from "@/actions/finance";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionFeedback, FieldError, SubmitButton, useActionForm } from "@/components/forms/shared";

export type ProductOption = { code: string; name: string; category: string };

export function RatePublishForm({
  products,
  defaultEffectiveFrom,
}: {
  products: ProductOption[];
  defaultEffectiveFrom: string;
}) {
  const { state, formAction, pending } = useActionForm(publishRateAction);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Product" htmlFor="productCode" required>
        <Select id="productCode" name="productCode" required defaultValue="">
          <option value="" disabled>
            Select a product
          </option>
          {products.map((product) => (
            <option key={product.code} value={product.code}>
              {product.name} ({product.code}) · {product.category}
            </option>
          ))}
        </Select>
        <FieldError state={state} name="productCode" />
      </Field>

      <Field
        label="Selling rate (৳ per MT)"
        htmlFor="ratePerMt"
        hint="As soon as this is published, sales can create orders at this rate."
        required
      >
        <Input
          id="ratePerMt"
          name="ratePerMt"
          inputMode="decimal"
          placeholder="50000.00"
          required
        />
        <FieldError state={state} name="ratePerMt" />
      </Field>

      <Field
        label="Effective from (Asia/Dhaka)"
        htmlFor="effectiveFrom"
        hint="A later time means the rate starts applying then. Existing orders keep their locked rate."
        required
      >
        <Input
          id="effectiveFrom"
          name="effectiveFrom"
          type="datetime-local"
          defaultValue={defaultEffectiveFrom}
          required
        />
        <FieldError state={state} name="effectiveFrom" />
      </Field>

      <Field
        label="Valid until (optional)"
        htmlFor="effectiveTo"
        hint="Leave empty and this rate stays active until Finance publishes the next one. Fill it in only when the rate must stop on a fixed date."
      >
        <Input id="effectiveTo" name="effectiveTo" type="datetime-local" />
        <FieldError state={state} name="effectiveTo" />
      </Field>

      <Field label="Note (optional)" htmlFor="note">
        <Textarea id="note" name="note" rows={2} placeholder="Reason for the change, market note…" />
      </Field>

      <ActionFeedback state={state} />
      <SubmitButton pending={pending} variant="primary">
        Publish rate
      </SubmitButton>
    </form>
  );
}
