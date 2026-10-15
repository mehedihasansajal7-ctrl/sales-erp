import { ZodError, type z } from "zod";
import { toAppError, type ErrorCode } from "@/lib/errors";
import { fieldErrors } from "@/lib/validation";

/**
 * Shared shape for every server action result so client forms can render
 * validation errors, business-rule messages and toasts consistently.
 */
export type ActionState = {
  ok: boolean;
  message?: string;
  code?: ErrorCode;
  fieldErrors?: Record<string, string>;
};

export const initialActionState: ActionState = { ok: false };

export function actionOk(message?: string): ActionState {
  return { ok: true, message };
}

export function actionFailure(error: unknown): ActionState {
  if (error instanceof ZodError) {
    const fields = fieldErrors(error);
    const first = Object.values(fields)[0];
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: first ?? "Please check the highlighted fields.",
      fieldErrors: fields,
    };
  }
  const appError = toAppError(error);
  return { ok: false, code: appError.code, message: appError.message };
}

/** Reads a JSON payload from a hidden form field. */
export function readJsonField<T>(formData: FormData, name = "payload", fallback: T): T {
  const raw = formData.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function str(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function optStr(formData: FormData, name: string): string | undefined {
  const value = str(formData, name);
  return value === "" ? undefined : value;
}

export function bool(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

export function num(formData: FormData, name: string, fallback = 0): number {
  const value = Number(str(formData, name));
  return Number.isFinite(value) ? value : fallback;
}

/** Parses and returns the typed data, throwing a ZodError on failure. */
export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input);
}
