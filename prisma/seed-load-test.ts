/**
 * Load-test seed: creates a large order book (default 10 000 orders) so the
 * dashboard, list screens and reports can be checked for performance
 * (spec Phase 6: "performance check on large data").
 *
 *   npm run seed:load                # 10 000 orders
 *   ORDER_COUNT=50000 npm run seed:load
 *
 * It writes directly to PostgreSQL in bulk (no per-row service calls), which is
 * exactly what a load test wants. Run it only on a development database.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORDER_COUNT = Number(process.env.ORDER_COUNT ?? 10_000);
const ORDER_DATE_SPAN_DAYS = Number(process.env.ORDER_DATE_SPAN_DAYS ?? 180);

function pick<T>(items: T[], index: number): T {
  return items[index % items.length] as T;
}

async function main() {
  const products = await prisma.product.findMany({ where: { isActive: true } });
  const customers = await prisma.customer.findMany({ where: { isActive: true } });
  const users = await prisma.user.findMany();

  if (products.length === 0 || customers.length === 0) {
    throw new Error("Run `npm run db:seed` first: products and customers are required.");
  }
  const admin = users.find((user) => user.role === "ADMIN") ?? users[0];
  const sales = users.filter((user) => user.role === "SALES");

  const rates = await prisma.rate.findMany({ orderBy: { effectiveFrom: "asc" } });
  if (rates.length === 0) throw new Error("Publish at least one rate first.");

  const lastSeq = new Map<string, number>();
  const now = Date.now();
  const statuses = [
    "APPROVED",
    "PARTIALLY_DELIVERED",
    "COMPLETED",
    "PENDING_APPROVAL",
    "COMPLETED",
    "COMPLETED",
    "REJECTED",
  ] as const;

  console.log(`[load] creating ${ORDER_COUNT} orders…`);
  const startedAt = Date.now();
  const batchSize = 250;

  for (let offset = 0; offset < ORDER_COUNT; offset += batchSize) {
    const count = Math.min(batchSize, ORDER_COUNT - offset);
    const orderRows: {
      orderNo: string;
      customerId: string;
      orderSeq: number;
      orderDate: Date;
      status: (typeof statuses)[number];
      totalValue: string;
      createdBy: string | null;
      approvedBy: string | null;
      approvedAt: Date | null;
    }[] = [];

    for (let index = 0; index < count; index += 1) {
      const globalIndex = offset + index;
      const customer = pick(customers, globalIndex % customers.length);
      const seq = (lastSeq.get(customer.code) ?? 0) + 1;
      lastSeq.set(customer.code, seq);
      const orderDate = new Date(now - Math.floor(Math.random() * ORDER_DATE_SPAN_DAYS) * 86_400_000);
      const status = statuses[globalIndex % statuses.length] as (typeof statuses)[number];

      orderRows.push({
        // The real sequence generator is used by the API; for a load test a
        // deterministic unique number is enough.
        orderNo: `LOAD-${new Date(orderDate).toISOString().slice(0, 10)}-${globalIndex + 1}`,
        customerId: customer.code,
        orderSeq: seq,
        orderDate,
        status,
        totalValue: "0",
        createdBy: sales.length > 0 ? pick(sales, globalIndex).id : (admin?.id ?? null),
        approvedBy: status === "PENDING_APPROVAL" ? null : (admin?.id ?? null),
        approvedAt: status === "PENDING_APPROVAL" ? null : orderDate,
      });
    }

    await prisma.order.createMany({ data: orderRows, skipDuplicates: true });

    const created = await prisma.order.findMany({
      where: { orderNo: { in: orderRows.map((row) => row.orderNo) } },
      select: { id: true, orderNo: true, status: true },
    });

    const itemRows = created.flatMap((order, index) => {
      const lineCount = 1 + (index % 2);
      const rows = [];
      for (let line = 0; line < lineCount; line += 1) {
        const product = pick(products, offset + index + line);
        const rate = rates.filter((entry) => entry.productCode === product.code).at(-1);
        if (!rate) continue;
        const qtyMt = (Math.floor(Math.random() * 200) + 5) * 0.5 + 0.25;
        const qty = qtyMt.toFixed(3);
        const lineValue = Number(qty) * Number(rate.ratePerMt.toFixed(2));
        const deliveredFraction =
          order.status === "COMPLETED" ? 1 : order.status === "PARTIALLY_DELIVERED" ? 0.5 : 0;
        rows.push({
          orderId: order.id,
          productCode: product.code,
          qtyMt: qty,
          lockedRatePerMt: rate.ratePerMt.toFixed(2),
          rateId: rate.id,
          lineValue: lineValue.toFixed(2),
          deliveredMt: (Number(qty) * deliveredFraction).toFixed(3),
          doAllocatedMt: (Number(qty) * deliveredFraction).toFixed(3),
          createdBy: admin?.id ?? null,
        });
      }
      return rows;
    });

    if (itemRows.length > 0) {
      await prisma.orderItem.createMany({ data: itemRows });
      // Update the header totals in one pass per batch.
      const totals = new Map<string, number>();
      for (const row of itemRows) {
        totals.set(row.orderId, (totals.get(row.orderId) ?? 0) + Number(row.lineValue));
      }
      for (const [orderId, total] of totals) {
        await prisma.order.update({ where: { id: orderId }, data: { totalValue: total.toFixed(2) } });
      }
    }

    process.stdout.write(`\r[load] ${Math.min(offset + batchSize, ORDER_COUNT)}/${ORDER_COUNT}`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const orderCount = await prisma.order.count();
  const itemCount = await prisma.orderItem.count();
  console.log(`\n[load] done in ${elapsed}s — ${orderCount} orders, ${itemCount} order lines.`);
  console.log("[load] now open /dashboard, /sales/orders and /reports and check they stay fast.");
}

main()
  .catch((error) => {
    console.error("[load] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
