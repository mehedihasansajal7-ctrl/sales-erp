"use client";

import * as React from "react";
import Link from "next/link";
import { changePasswordAction, signInAction } from "@/actions/auth";
import { Field, Input } from "@/components/ui/form";
import { ActionFeedback, SubmitButton, useActionForm } from "@/components/forms/shared";

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const { state, formAction, pending } = useActionForm(signInAction);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
      <Field label="Email" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="you@company.com"
        />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
      </Field>
      <ActionFeedback state={state} />
      <SubmitButton pending={pending} variant="primary" className="w-full">
        Sign in
      </SubmitButton>
      <p className="text-center text-xs text-slate-500">
        Ask an administrator if you have forgotten your password.
      </p>
      <Link href="/" className="text-center text-xs text-slate-500 underline-offset-4 hover:underline">
        Back to start
      </Link>
    </form>
  );
}

export function ChangePasswordForm() {
  const { state, formAction, pending } = useActionForm(changePasswordAction);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <Field label="Current password" htmlFor="currentPassword" required>
        <Input id="currentPassword" name="currentPassword" type="password" required />
      </Field>
      <Field
        label="New password"
        htmlFor="newPassword"
        hint="At least 8 characters."
        required
      >
        <Input id="newPassword" name="newPassword" type="password" minLength={8} required />
      </Field>
      <Field label="Confirm new password" htmlFor="confirmPassword" required>
        <Input id="confirmPassword" name="confirmPassword" type="password" minLength={8} required />
      </Field>
      <ActionFeedback state={state} />
      <SubmitButton pending={pending}>Change password</SubmitButton>
    </form>
  );
}
