import { z } from "zod";
import { MT_SCALE, MONEY_SCALE, dec } from "@/lib/decimal";

/**
 * Every input that reaches a service or route handler is parsed with Zod
 * (spec Section 3). Numeric payloads are accepted as strings *or* numbers and
 * normalised to fixed-scale strings so that Prisma.Decimal stays the single
 * source of numeric truth (no floats anywhere).
 */
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

function decimalField(scale: number, label: string, opts: { positive?: boolean } = {}) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const raw = typeof value === "number" ? String(value) : value.trim();
      if (!DECIMAL_RE.test(raw)) {
        ctx.addIssue({ code: "custom", message: `${label} must be a number.` });
        return z.NEVER;
      }
      const d = dec(raw);
      if (opts.positive && !d.gt(0)) {
        ctx.addIssue({ code: "custom", message: `${label} must be greater than zero.` });
        return z.NEVER;
      }
      return d.toFixed(scale);
    });
}

/** Quantities in MT — Decimal(18,3), always positive where a quantity is meant. */
export const qtySchema = decimalField(MT_SCALE, "Quantity");
export const positiveQtySchema = decimalField(MT_SCALE, "Quantity", { positive: true });
export const moneySchema = decimalField(MONEY_SCALE, "Amount");

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(emailRe, "Enter a valid email address.")
  .transform((v) => v.toLowerCase());

export const trimmedString = (min = 1, max = 200) => z.string().trim().min(min).max(max);

const nonEmptyId = z.string().trim().min(1).max(64);

/** Accepts `2026-10-15` or `2026-10-15T14:30` (APP_TIMEZONE wall clock). */
export const zonedDateTimeSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/,
    "Enter a valid date (YYYY-MM-DD) or date-time.",
  );

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters.")
      .max(200, "New password is too long."),
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  });

// ---------------------------------------------------------------------------
// Admin — master data
// ---------------------------------------------------------------------------

export const productSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may contain letters, digits, - and _ only.")
    .transform((v) => v.toUpperCase()),
  name: trimmedString(2, 120),
  category: trimmedString(2, 60),
  unit: trimmedString(1, 10).default("MT"),
  isActive: z.boolean().default(true),
});

export const customerSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may contain letters, digits, - and _ only.")
    .transform((v) => v.toUpperCase()),
  name: trimmedString(2, 150),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  address: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  creditLimit: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value, ctx) => {
      if (value === null || value === undefined || value === "") return null;
      const raw = typeof value === "number" ? String(value) : value.trim();
      if (!DECIMAL_RE.test(raw)) {
        ctx.addIssue({ code: "custom", message: "Credit limit must be a number." });
        return z.NEVER;
      }
      const d = dec(raw);
      if (d.isNegative()) {
        ctx.addIssue({ code: "custom", message: "Credit limit cannot be negative." });
        return z.NEVER;
      }
      return d.toFixed(MONEY_SCALE);
    }),
  isActive: z.boolean().default(true),
});

export const warehouseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may contain letters, digits, - and _ only.")
    .transform((v) => v.toUpperCase()),
  name: trimmedString(2, 120),
  location: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  isActive: z.boolean().default(true),
});

/** Empty form fields must become `undefined`, never `""` (an empty FK would fail). */
const optionalCode = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).max(30).optional(),
);

export const userCreateSchema = z.object({
  name: trimmedString(2, 120),
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  role: z.enum(["ADMIN", "FINANCE", "SALES", "SALES_OPS", "WAREHOUSE", "MANAGEMENT"]),
  warehouseCode: optionalCode,
  isActive: z.boolean().default(true),
});

export const userUpdateSchema = z.object({
  name: trimmedString(2, 120),
  role: z.enum(["ADMIN", "FINANCE", "SALES", "SALES_OPS", "WAREHOUSE", "MANAGEMENT"]),
  warehouseCode: optionalCode,
  isActive: z.boolean().default(true),
});

export const userResetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
});

export const settingsSchema = z.object({
  credit_check_enabled: z.enum(["true", "false"]).default("true"),
  priority_override_enabled: z.enum(["true", "false"]).default("true"),
  company_name: trimmedString(2, 150),
  company_address: z.string().trim().max(300).default(""),
  default_warehouse: z
    .string()
    .trim()
    .max(30)
    .optional()
    .or(z.literal("").transform(() => "")),
});

// ---------------------------------------------------------------------------
// Finance — rates
// ---------------------------------------------------------------------------

export const ratePublishSchema = z
  .object({
    productCode: nonEmptyId,
    ratePerMt: decimalField(MONEY_SCALE, "Rate", { positive: true }),
    effectiveFrom: zonedDateTimeSchema,
    /**
     * Optional end of the validity window. Leave empty to keep the rate active
     * until a newer rate is published.
     */
    effectiveTo: zonedDateTimeSchema.optional().or(z.literal("").transform(() => undefined)),
    note: z
      .string()
      .trim()
      .max(300)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .refine(
    (value) => !value.effectiveTo || new Date(value.effectiveTo) > new Date(value.effectiveFrom),
    {
      message: "Valid until must be after the effective-from date and time.",
      path: ["effectiveTo"],
    },
  );

// ---------------------------------------------------------------------------
// Sales — orders
// ---------------------------------------------------------------------------

export const orderCreateSchema = z.object({
  customerCode: nonEmptyId,
  orderDate: zonedDateTimeSchema.optional(),
  remarks: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  items: z
    .array(
      z.object({
        productCode: nonEmptyId,
        qtyMt: positiveQtySchema,
      }),
    )
    .min(1, "Add at least one product line.")
    .max(20, "An order cannot have more than 20 lines."),
});

export const orderRejectSchema = z.object({
  orderId: nonEmptyId,
  reason: trimmedString(3, 500),
});

export const orderApproveSchema = z.object({
  orderId: nonEmptyId,
  creditOverride: z.boolean().default(false),
  overrideReason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const orderCancelSchema = z.object({
  orderId: nonEmptyId,
  reason: trimmedString(3, 500),
});

export const orderShortCloseSchema = z.object({
  orderId: nonEmptyId,
  reason: trimmedString(3, 500),
});

export const rateOverrideSchema = z.object({
  orderItemId: nonEmptyId,
  lockedRatePerMt: decimalField(MONEY_SCALE, "Rate", { positive: true }),
  reason: trimmedString(3, 500),
});

/**
 * Sales Ops may correct a pending order (a quantity or a rate typo) instead of
 * rejecting it and asking the salesperson to re-enter everything. A written
 * reason is mandatory and the change is audited line by line.
 */
export const orderEditSchema = z.object({
  orderId: nonEmptyId,
  reason: trimmedString(3, 500),
  remarks: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  items: z
    .array(
      z.object({
        orderItemId: nonEmptyId,
        qtyMt: positiveQtySchema,
        lockedRatePerMt: decimalField(MONEY_SCALE, "Rate", { positive: true }),
      }),
    )
    .min(1, "The order must keep at least one line."),
});

// ---------------------------------------------------------------------------
// Sales Ops — delivery orders
// ---------------------------------------------------------------------------

export const doCreateSchema = z
  .object({
    orderId: nonEmptyId,
    warehouseCode: nonEmptyId,
    note: z
      .string()
      .trim()
      .max(300)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    priorityOverride: z.boolean().default(false),
    overrideReason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    items: z
      .array(
        z.object({
          orderItemId: nonEmptyId,
          qtyMt: positiveQtySchema,
        }),
      )
      .min(1, "Select at least one line to deliver."),
  })
  .refine((v) => !v.priorityOverride || (v.overrideReason && v.overrideReason.length >= 3), {
    message: "A written reason is mandatory for a priority override.",
    path: ["overrideReason"],
  });

export const doCancelSchema = z.object({
  doId: nonEmptyId,
  reason: trimmedString(3, 500),
});

// ---------------------------------------------------------------------------
// Warehouse — dispatch, stock
// ---------------------------------------------------------------------------

export const dispatchCreateSchema = z
  .object({
    doId: nonEmptyId,
    truckNo: trimmedString(2, 60),
    driverName: trimmedString(2, 120),
    driverPhone: z
      .string()
      .trim()
      .min(6, "Enter a valid driver phone number.")
      .max(30, "Enter a valid driver phone number."),
    challanNo: trimmedString(1, 60),
    loadingDate: zonedDateTimeSchema,
    dispatchDate: zonedDateTimeSchema,
    remarks: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    items: z
      .array(
        z.object({
          doItemId: nonEmptyId,
          qtyMt: positiveQtySchema,
        }),
      )
      .min(1, "Enter a dispatched quantity."),
  })
  /**
   * A vehicle cannot be dispatched before it was loaded. The rule is applied at
   * day level (loading 08:00 → dispatch 06:00 on the same day is fine), and the
   * form never offers an earlier day.
   */
  .refine((value) => value.dispatchDate.slice(0, 10) >= value.loadingDate.slice(0, 10), {
    message: "Dispatch date cannot be earlier than the loading date.",
    path: ["dispatchDate"],
  });

export const stockOpeningSchema = z.object({
  warehouseCode: nonEmptyId,
  productCode: nonEmptyId,
  qtyMt: qtySchema,
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const stockInwardSchema = z.object({
  warehouseCode: nonEmptyId,
  productCode: nonEmptyId,
  qtyMt: positiveQtySchema,
  reference: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  movementDate: zonedDateTimeSchema.optional(),
});

export const stockAdjustmentSchema = z.object({
  warehouseCode: nonEmptyId,
  productCode: nonEmptyId,
  newOnHandMt: qtySchema,
  reason: trimmedString(3, 500),
});

export const transferCreateSchema = z
  .object({
    fromWarehouseCode: nonEmptyId,
    toWarehouseCode: nonEmptyId,
    productCode: nonEmptyId,
    qtyMt: positiveQtySchema,
    reason: z
      .string()
      .trim()
      .max(300)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .refine((v) => v.fromWarehouseCode !== v.toWarehouseCode, {
    message: "Source and destination warehouse must be different.",
    path: ["toWarehouseCode"],
  });

export const transferDecisionSchema = z.object({
  transferId: nonEmptyId,
  approve: z.boolean(),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const countCreateSchema = z.object({
  warehouseCode: nonEmptyId,
  productCode: nonEmptyId,
  physicalQty: qtySchema,
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  remarks: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const countDecisionSchema = z.object({
  countId: nonEmptyId,
  approve: z.boolean(),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

// ---------------------------------------------------------------------------
// List / report query parameters
// ---------------------------------------------------------------------------

export const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(20),
  status: z.string().trim().max(60).optional(),
  sort: z.string().trim().max(40).optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const message = first ? `${first.message}` : "Invalid input.";
    throw Object.assign(new Error(message), { __validation: true });
  }
  return result.data;
}

/** Flattens Zod issues into `{ field: message }` for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
