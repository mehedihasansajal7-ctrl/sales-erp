"use client";

import * as React from "react";
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
import { Checkbox, Field, Label, Textarea } from "@/components/ui/form";
import { ActionFeedback, SubmitButton, useActionForm, type ServerAction } from "@/components/forms/shared";

export type ConfirmActionDialogProps = {
  action: ServerAction;
  triggerLabel: string;
  triggerVariant?: "default" | "primary" | "destructive" | "outline" | "secondary" | "ghost";
  triggerSize?: "default" | "sm" | "lg" | "icon";
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Hidden fields posted with the action (ids, flags…). */
  fields?: Record<string, string>;
  /** Requires a written reason before the confirm button enables. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** Extra interactive controls rendered inside the dialog. */
  children?: React.ReactNode;
  disabled?: boolean;
};

/**
 * Generic confirm dialog for destructive / state-changing actions. Every such
 * action requires an explicit confirmation, and business rules that need a
 * reason enforce it in the UI *and* on the server.
 */
export function ConfirmActionDialog({
  action,
  triggerLabel,
  triggerVariant = "outline",
  triggerSize = "sm",
  title,
  description,
  confirmLabel = "Confirm",
  fields = {},
  requireReason = false,
  reasonLabel = "Reason",
  reasonPlaceholder = "Explain why…",
  children,
  disabled,
}: ConfirmActionDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const { state, formAction, pending } = useActionForm(action, () => {
    setOpen(false);
    setReason("");
  });

  const reasonMissing = requireReason && reason.trim().length < 3;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} disabled={disabled}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {Object.entries(fields).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}

          {children}

          {requireReason ? (
            <Field label={reasonLabel} htmlFor={`reason-${title}`} required>
              <Textarea
                id={`reason-${title}`}
                name="reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={reasonPlaceholder}
                required
              />
            </Field>
          ) : null}

          <ActionFeedback state={state} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton
              pending={pending}
              variant={triggerVariant === "destructive" ? "destructive" : "primary"}
              disabled={reasonMissing}
            >
              {confirmLabel}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Checkbox + reason pair used by "approve with override" flows (credit limit
 * override, priority override).
 */
export function OverrideFields({
  label,
  hint,
  checkboxName,
  reasonName,
  required,
}: {
  label: string;
  hint?: string;
  checkboxName: string;
  reasonName: string;
  required?: boolean;
}) {
  const [enabled, setEnabled] = React.useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={checkboxName}
          name={checkboxName}
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <Label htmlFor={checkboxName} className="text-amber-900">
          {label}
        </Label>
      </div>
      {hint ? <p className="text-xs text-amber-800">{hint}</p> : null}
      {enabled ? (
        <Field label="Written reason" htmlFor={reasonName} required={required}>
          <Textarea id={reasonName} name={reasonName} rows={2} required={required} />
        </Field>
      ) : null}
    </div>
  );
}
