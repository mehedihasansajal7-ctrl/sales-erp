/**
 * Domain errors. Every business rule violation is thrown as an AppError with a
 * stable machine code and a user-facing message (the exact business message is
 * shown in the UI toast — see spec Section 7).
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_MISSING"
  | "RATE_EXPIRED"
  | "PRIORITY_BLOCKED"
  | "OVER_ALLOCATION"
  | "INSUFFICIENT_STOCK"
  | "OVER_DISPATCH"
  | "DUPLICATE_CHALLAN"
  | "ILLEGAL_TRANSITION"
  | "CREDIT_LIMIT_EXCEEDED"
  | "OVERRIDE_NOT_ALLOWED"
  | "RATE_LOCKED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const errors = {
  unauthenticated: () => new AppError("UNAUTHENTICATED", "You are not signed in.", 401),
  forbidden: (what = "this action") =>
    new AppError("FORBIDDEN", `Your role is not allowed to perform ${what}.`, 403),
  notFound: (what: string) => new AppError("NOT_FOUND", `${what} was not found.`, 404),
  validation: (message: string) => new AppError("VALIDATION_ERROR", message, 422),
  conflict: (message: string) => new AppError("CONFLICT", message, 409),
  rateMissing: (product: string) =>
    new AppError("RATE_MISSING", `No published rate for product ${product}.`, 409),
  rateExpired: (product: string, until: string) =>
    new AppError(
      "RATE_EXPIRED",
      `The rate for ${product} expired on ${until}. Finance must publish a new rate.`,
      409,
    ),
  priorityBlocked: (orderNo: string, remainingMt: string, customerName?: string) =>
    new AppError(
      "PRIORITY_BLOCKED",
      `${customerName ? `${customerName}: ` : ""}Order ${orderNo} of this customer must be completed first. Remaining: ${remainingMt} MT`,
      409,
      { blockingOrderNo: orderNo },
    ),
  overAllocation: (message: string) => new AppError("OVER_ALLOCATION", message, 409),
  insufficientStock: (message: string) => new AppError("INSUFFICIENT_STOCK", message, 409),
  overDispatch: (message: string) => new AppError("OVER_DISPATCH", message, 409),
  duplicateChallan: (challanNo: string) =>
    new AppError("DUPLICATE_CHALLAN", `Challan number ${challanNo} already exists.`, 409),
  illegalTransition: (entity: string, from: string, to: string) =>
    new AppError("ILLEGAL_TRANSITION", `Cannot move ${entity} from ${from} to ${to}.`, 409),
  creditLimit: (message: string) => new AppError("CREDIT_LIMIT_EXCEEDED", message, 409),
  overrideNotAllowed: (message: string) => new AppError("OVERRIDE_NOT_ALLOWED", message, 403),
  rateLocked: () =>
    new AppError(
      "RATE_LOCKED",
      "The rate on an order is locked and can only be changed by Sales Operations with a reason.",
      403,
    ),
};

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Converts anything thrown into an AppError, logging unexpected failures. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof Error) {
    console.error("[unhandled]", error);
    return new AppError("INTERNAL_ERROR", error.message || "Unexpected server error.", 500);
  }
  console.error("[unhandled]", error);
  return new AppError("INTERNAL_ERROR", "Unexpected server error.", 500);
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };

export function actionError(error: unknown): ActionResult<never> {
  const appError = toAppError(error);
  return {
    ok: false,
    code: appError.code,
    message: appError.message,
    details: appError.details,
  };
}
