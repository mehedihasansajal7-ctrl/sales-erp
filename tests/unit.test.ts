import { describe, expect, it } from "vitest";
import { dec, formatBdt, formatMt, lineValue, money, qty, sum } from "@/lib/decimal";
import {
  endOfZonedDay,
  startOfZonedDay,
  toZonedDateString,
  zonedToUtc,
  zonedYear,
} from "@/lib/dates";
import { PERMISSIONS, roleHasPermission } from "@/lib/rbac";
import {
  assertDoTransition,
  assertOrderTransition,
  assertTransferTransition,
  ORDER_TRANSITIONS,
} from "@/lib/state-machines";
import { formatDocNo, parseDocNo } from "@/lib/numbering";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import {
  changePasswordSchema,
  loginSchema,
  orderCreateSchema,
  ratePublishSchema,
} from "@/lib/validation";
import { AppError, errors } from "@/lib/errors";

describe("decimal arithmetic", () => {
  it("rounds quantities to 3 decimals and money to 2 without floating point drift", () => {
    expect(qty("100.0005").toFixed(3)).toBe("100.001");
    expect(qty("100.0004").toFixed(3)).toBe("100.000");
    expect(money("18499.995").toFixed(2)).toBe("18500.00");
  });

  it("multiplies MT by a rate exactly (0.1 + 0.2 style traps)", () => {
    expect(lineValue("3.3", "0.1").toFixed(2)).toBe("0.33");
    expect(lineValue("0.07", "1234.56").toFixed(2)).toBe("86.42");
    expect(sum(["0.1", "0.2"]).toFixed(3)).toBe("0.300");
  });

  it("formats MT and BDT with thousands separators", () => {
    expect(formatMt("1234567.5")).toBe("1,234,567.500 MT");
    expect(formatBdt("5000000")).toBe("৳ 5,000,000.00");
  });

  it("never uses floats for money (dec keeps full precision)", () => {
    expect(dec("0.1").plus(dec("0.2")).toString()).toBe("0.3");
  });
});

describe("timezone handling (Asia/Dhaka)", () => {
  it("converts a wall-clock time in Dhaka to the correct UTC instant", () => {
    // 2026-06-15 00:00 Dhaka (UTC+6) is 2026-06-14 18:00 UTC.
    expect(zonedToUtc("2026-06-15").toISOString()).toBe("2026-06-14T18:00:00.000Z");
  });

  it("reads the day boundary in Dhaka, not UTC", () => {
    const lateEveningUtc = new Date("2026-06-14T19:30:00.000Z"); // 01:30 next day in Dhaka
    expect(toZonedDateString(lateEveningUtc)).toBe("2026-06-15");
    expect(startOfZonedDay(lateEveningUtc).toISOString()).toBe("2026-06-14T18:00:00.000Z");
    expect(endOfZonedDay(lateEveningUtc).toISOString()).toBe("2026-06-15T18:00:00.000Z");
  });

  it("derives the document-number year from the Dhaka date", () => {
    expect(zonedYear(new Date("2025-12-31T19:00:00.000Z"))).toBe(2026);
  });
});

describe("document numbering", () => {
  it("formats and parses ORD-2026-000123", () => {
    const docNo = formatDocNo("order", 2026, 123);
    expect(docNo).toBe("ORD-2026-000123");
    expect(parseDocNo(docNo)).toEqual({ prefix: "ORD", year: 2026, seq: 123 });
  });

  it("pads to six digits but never truncates larger numbers", () => {
    expect(formatDocNo("do", 2026, 1)).toBe("DO-2026-000001");
    expect(formatDocNo("do", 2026, 1234567)).toBe("DO-2026-1234567");
  });
});

describe("state machines", () => {
  it("allows the documented order transitions", () => {
    expect(() => assertOrderTransition("PENDING_APPROVAL", "APPROVED")).not.toThrow();
    expect(() => assertOrderTransition("APPROVED", "PARTIALLY_DELIVERED")).not.toThrow();
    expect(() => assertOrderTransition("PARTIALLY_DELIVERED", "COMPLETED")).not.toThrow();
    expect(() => assertOrderTransition("PARTIALLY_DELIVERED", "SHORT_CLOSED")).not.toThrow();
    expect(() => assertOrderTransition("PENDING_APPROVAL", "CANCELLED")).not.toThrow();
  });

  it("rejects illegal order transitions with a clear message", () => {
    expect(() => assertOrderTransition("COMPLETED", "APPROVED")).toThrowError(AppError);
    expect(() => assertOrderTransition("REJECTED", "APPROVED")).toThrowError(/Cannot move order/);
    expect(() => assertOrderTransition("CANCELLED", "APPROVED")).toThrowError(/ILLEGAL|Cannot move/);
  });

  it("allows DO and transfer transitions, rejects the rest", () => {
    expect(() => assertDoTransition("CREATED", "PARTIALLY_DISPATCHED")).not.toThrow();
    expect(() => assertDoTransition("DISPATCHED", "CANCELLED")).toThrow();
    expect(() => assertTransferTransition("REQUESTED", "APPROVED")).not.toThrow();
    expect(() => assertTransferTransition("RECEIVED", "REJECTED")).toThrow();
  });

  it("keeps COMPLETED a terminal state", () => {
    expect(ORDER_TRANSITIONS.COMPLETED).toHaveLength(0);
  });
});

describe("role permission map", () => {
  it("gives Finance rate publication but no order approval", () => {
    expect(roleHasPermission("FINANCE", "rate.publish")).toBe(true);
    expect(roleHasPermission("FINANCE", "order.approve")).toBe(false);
    expect(roleHasPermission("FINANCE", "order.create")).toBe(false);
  });

  it("gives Salesperson order creation but no approval or rate work", () => {
    expect(roleHasPermission("SALES", "order.create")).toBe(true);
    expect(roleHasPermission("SALES", "order.approve")).toBe(false);
    expect(roleHasPermission("SALES", "rate.publish")).toBe(false);
  });

  it("keeps Sales Ops out of stock entry and admin out of approvals-by-default roles", () => {
    expect(roleHasPermission("SALES_OPS", "do.create")).toBe(true);
    expect(roleHasPermission("SALES_OPS", "order.approve")).toBe(true);
    expect(roleHasPermission("SALES_OPS", "dispatch.create")).toBe(false);
    expect(roleHasPermission("WAREHOUSE", "do.create")).toBe(false);
    expect(roleHasPermission("WAREHOUSE", "dispatch.create")).toBe(true);
  });

  it("keeps Management read-only", () => {
    const writes = Object.entries(PERMISSIONS)
      .filter(([permission]) => /(create|approve|reject|cancel|publish|override|inward|opening|adjust)/.test(permission))
      .map(([permission]) => permission);
    for (const permission of writes) {
      expect(roleHasPermission("MANAGEMENT", permission as never)).toBe(false);
    }
    expect(roleHasPermission("MANAGEMENT", "report.view")).toBe(true);
  });
});

describe("zod validation", () => {
  it("normalises emails and rejects bad ones", () => {
    expect(loginSchema.parse({ email: "  Admin@Test.Local ", password: "x" }).email).toBe(
      "admin@test.local",
    );
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });

  it("rejects zero/negative order quantities", () => {
    expect(
      orderCreateSchema.safeParse({
        customerCode: "CUS-1",
        items: [{ productCode: "FERT-UREA", qtyMt: "0" }],
      }).success,
    ).toBe(false);
    expect(
      orderCreateSchema.safeParse({
        customerCode: "CUS-1",
        items: [{ productCode: "FERT-UREA", qtyMt: "-5" }],
      }).success,
    ).toBe(false);
  });

  it("requires an order to have at least one line", () => {
    expect(orderCreateSchema.safeParse({ customerCode: "CUS-1", items: [] }).success).toBe(false);
  });

  it("requires a positive rate and a valid effective date", () => {
    expect(
      ratePublishSchema.safeParse({
        productCode: "FERT-UREA",
        ratePerMt: "0",
        effectiveFrom: "2026-10-15",
      }).success,
    ).toBe(false);
    expect(
      ratePublishSchema.safeParse({
        productCode: "FERT-UREA",
        ratePerMt: "50000",
        effectiveFrom: "15/10/2026",
      }).success,
    ).toBe(false);
    expect(
      ratePublishSchema.parse({
        productCode: "FERT-UREA",
        ratePerMt: "50000",
        effectiveFrom: "2026-10-15T14:30",
      }).ratePerMt,
    ).toBe("50000.00");
  });

  it("checks the password confirmation", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "a",
        newPassword: "newpassword",
        confirmPassword: "different",
      }).success,
    ).toBe(false);
  });
});

describe("login rate limiting", () => {
  it("blocks after the limit inside the window and reports retryAfter", () => {
    resetRateLimit("unit:test");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(rateLimit("unit:test", 3, 60).ok).toBe(true);
    }
    const blocked = rateLimit("unit:test", 3, 60);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("domain errors", () => {
  it("produces the exact business messages", () => {
    expect(errors.priorityBlocked("ORD-2026-000123", "70.000").message).toBe(
      "Order ORD-2026-000123 of this customer must be completed first. Remaining: 70.000 MT",
    );
    expect(errors.rateMissing("Urea Fertilizer").message).toBe(
      "No published rate for product Urea Fertilizer.",
    );
    expect(errors.duplicateChallan("CH-1").message).toBe("Challan number CH-1 already exists.");
    expect(errors.priorityBlocked("ORD-1", "1.000").code).toBe("PRIORITY_BLOCKED");
  });
});
