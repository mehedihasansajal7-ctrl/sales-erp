import { beforeAll, describe, expect, it } from "vitest";
import { nextChallanNo, nextDeliveryOrderNo, nextOrderNo } from "@/lib/numbering";
import { toZonedDateString } from "@/lib/dates";
import prisma from "@/lib/prisma";
import { standardContext, type Ctx } from "@/tests/helpers/flows";

/**
 * Document numbering:
 *   sales order    SO19102026001   (date based, per-day counter, no separators)
 *   delivery order DO19102026001   (own daily counter, starts with "DO")
 *   challan        CH19102026001   (dated with the dispatch day)
 */
describe("Document numbering", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
  });

  /** 19 Oct 2026 -> "19102026". */
  function dayDigits(date = new Date()): string {
    const [year, month, day] = toZonedDateString(date).split("-");
    return `${day}${month}${year}`;
  }

  it("generates date-based sales order numbers with a per-day counter", async () => {
    const first = await nextOrderNo(prisma);
    const second = await nextOrderNo(prisma);

    expect(first).toMatch(/^SO\d{11}$/);
    expect(first).toContain(dayDigits());
    expect(second).toContain(dayDigits());

    // No hyphens anywhere: the number is one readable token.
    expect(first).not.toContain("-");

    const seqOf = (orderNo: string) => Number(orderNo.slice(-3));
    expect(seqOf(second)).toBe(seqOf(first) + 1);
  });

  it("numbers delivery orders with their own DO counter, not the sales order number", async () => {
    const first = await nextDeliveryOrderNo(prisma);
    const second = await nextDeliveryOrderNo(prisma);

    expect(first).toMatch(/^DO\d{11}$/);
    expect(first).toContain(dayDigits());
    expect(second).toContain(dayDigits());
    expect(Number(second.slice(-3))).toBe(Number(first.slice(-3)) + 1);
    expect(first.startsWith("SO")).toBe(false);
  });

  it("generates date-based challan numbers with a per-day counter", async () => {
    const first = await nextChallanNo(prisma);
    const second = await nextChallanNo(prisma);

    expect(first).toMatch(/^CH\d{11}$/);
    expect(first).toContain(dayDigits());
    expect(second).not.toBe(first);
  });

  it("uses the dispatch day for the challan number", async () => {
    const dispatchDay = new Date("2026-03-05T10:00:00+06:00");
    const challan = await nextChallanNo(prisma, dispatchDay);
    expect(challan).toContain("05032026");
  });

  it("never returns the same number twice for parallel requests", async () => {
    const numbers = await Promise.all(Array.from({ length: 8 }, () => nextOrderNo(prisma)));
    expect(new Set(numbers).size).toBe(8);
  });

  it("does not clash with the counters used by real orders", async () => {
    const { createOrder } = await import("@/server/services/order.service");
    await prisma.customer.create({ data: { code: "CUS-NUM", name: "Numbering Trader" } });
    const order = await createOrder(
      { customerCode: "CUS-NUM", items: [{ productCode: "FERT-UREA", qtyMt: "1.000" }] },
      { id: ctx.sales.id, name: ctx.sales.name, role: "SALES" },
    );
    expect(order.orderNo).toMatch(/^SO\d{11}$/);
    expect(order.orderNo).toContain(dayDigits());
  });
});
