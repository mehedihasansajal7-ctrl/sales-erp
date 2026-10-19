import { beforeAll, describe, expect, it } from "vitest";
import { nextChallanNo, nextDeliveryOrderNo, nextOrderNo } from "@/lib/numbering";
import { toZonedDateString } from "@/lib/dates";
import prisma from "@/lib/prisma";
import { standardContext, type Ctx } from "@/tests/helpers/flows";

/**
 * Document numbering (2026-10-19):
 *   sales order   SO-19-10-2026-001   (date based, per-day counter)
 *   delivery order <SO>-DO-01         (derived from its sales order)
 *   challan       CH-19-10-2026-001   (date based, per-day counter)
 */
describe("Document numbering", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await standardContext();
  });

  function dayStamp(date = new Date()): string {
    const [year, month, day] = toZonedDateString(date).split("-");
    return `${day}-${month}-${year}`;
  }

  it("generates date-based sales order numbers with a per-day counter", async () => {
    const first = await nextOrderNo(prisma);
    const second = await nextOrderNo(prisma);

    expect(first).toMatch(/^SO-\d{2}-\d{2}-\d{4}-\d{3}$/);
    expect(first).toContain(dayStamp());
    expect(second).toContain(dayStamp());

    const seqOf = (orderNo: string) => Number(orderNo.split("-").pop());
    expect(seqOf(second)).toBe(seqOf(first) + 1);
  });

  it("derives the delivery order number from the sales order number", async () => {
    const orderNo = await nextOrderNo(prisma);
    const do1 = await nextDeliveryOrderNo(prisma, orderNo);
    const do2 = await nextDeliveryOrderNo(prisma, orderNo);

    expect(do1).toBe(`${orderNo}-DO-01`);
    expect(do2).toBe(`${orderNo}-DO-02`);

    // Another order starts again at 01.
    const otherOrder = await nextOrderNo(prisma);
    expect(await nextDeliveryOrderNo(prisma, otherOrder)).toBe(`${otherOrder}-DO-01`);
  });

  it("generates date-based challan numbers with a per-day counter", async () => {
    const first = await nextChallanNo(prisma);
    const second = await nextChallanNo(prisma);

    expect(first).toMatch(/^CH-\d{2}-\d{2}-\d{4}-\d{3}$/);
    expect(first).toContain(dayStamp());
    expect(second).not.toBe(first);
  });

  it("uses the dispatch day for the challan number", async () => {
    const dispatchDay = new Date("2026-03-05T10:00:00+06:00");
    const challan = await nextChallanNo(prisma, dispatchDay);
    expect(challan).toContain("05-03-2026");
  });

  it("never returns the same number twice for parallel requests", async () => {
    const numbers = await Promise.all(Array.from({ length: 8 }, () => nextOrderNo(prisma)));
    expect(new Set(numbers).size).toBe(8);
  });

  it("does not clash with the counters used by orders already in the database", async () => {
    // Creating a real order consumes the same sequence key (order:<day>).
    const { createOrder } = await import("@/server/services/order.service");
    await prisma.customer.create({ data: { code: "CUS-NUM", name: "Numbering Trader" } });
    const order = await createOrder(
      { customerCode: "CUS-NUM", items: [{ productCode: "FERT-UREA", qtyMt: "1.000" }] },
      { id: ctx.sales.id, name: ctx.sales.name, role: "SALES" },
    );
    expect(order.orderNo).toMatch(/^SO-\d{2}-\d{2}-\d{4}-\d{3}$/);
    expect(order.orderNo).toContain(dayStamp());
  });
});
