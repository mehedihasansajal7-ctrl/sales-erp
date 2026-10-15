"use client";

import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import type { ActionState } from "@/actions/helpers";
import { initialActionState } from "@/actions/helpers";
import { Button } from "@/components/ui/button";
import { FormError, FormSuccess } from "@/components/ui/form";
import { cn } from "@/lib/utils";

export type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Wires a server action to a form with `useActionState`, surfaces the exact
 * business message as an error toast + inline alert, and reports success.
 */
export function useActionForm(action: ServerAction, onSuccess?: () => void) {
  const successRef = React.useRef(onSuccess);
  React.useEffect(() => {
    successRef.current = onSuccess;
  }, [onSuccess]);

  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData): Promise<ActionState> => {
      const result = await action(previous, formData);
      // Closing a dialog from the action callback (not from an effect) keeps
      // React's "no cascading renders" rule happy.
      if (result.ok) successRef.current?.();
      return result;
    },
    initialActionState,
  );

  const lastMessage = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!state.message || state.message === lastMessage.current) return;
    lastMessage.current = state.message;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  return { state, formAction, pending };
}

export function SubmitButton({
  pending,
  children,
  className,
  variant,
  size,
  disabled,
}: {
  pending: boolean;
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "primary" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
    >
      {pending ? "Working…" : children}
    </Button>
  );
}

/** Inline alert block used under forms (error + success together). */
export function ActionFeedback({ state }: { state: ActionState }) {
  if (state.ok) return state.message ? <FormSuccess message={state.message} /> : null;
  return <FormError message={state.message} />;
}

export function FieldError({ state, name }: { state: ActionState; name: string }) {
  const message = state.fieldErrors?.[name];
  if (!message) return null;
  return <p className="text-xs font-medium text-red-600">{message}</p>;
}

export function InlineForm({
  action,
  children,
  className,
  hidden,
}: {
  action: ServerAction;
  children: (state: ActionState) => React.ReactNode;
  className?: string;
  hidden?: Record<string, string>;
}) {
  const { state, formAction, pending } = useActionForm(action);
  return (
    <form action={formAction} className={cn("flex flex-col gap-3", className)}>
      {Object.entries(hidden ?? {}).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {children(state)}
      <div className="flex flex-col gap-2">
        <ActionFeedback state={state} />
        {pending ? <span className="text-xs text-slate-500">Saving…</span> : null}
      </div>
    </form>
  );
}
