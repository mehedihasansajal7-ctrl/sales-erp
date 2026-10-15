import type { Prisma, RateStatus } from "@prisma/client";
import prisma, { type Tx } from "@/lib/prisma";
import { dec, money } from "@/lib/decimal";
import { errors } from "@/lib/errors";
import { writeAudit, actor } from "@/lib/audit";
import { zonedToUtc } from "@/lib/dates";

/**
 * Rule 1 — rate workflow.
 * Rates are published by FINANCE and never edited in place: a rate change is a
 * new row, so full history is preserved. The "current" rate for a product is the
 * latest row whose `effective_from <= now`.
 */

export type PublishRateInput = {
  productCode: string;
  ratePerMt: string;
  effectiveFrom: string;
  note?: string;
};

export type Actor = { id: string; name: string; role: string } | null;

/**
 * The rate that applies to `at` (default: now) for one product.
 * Returns null when the product has no published rate effective yet.
 */
export async function findCurrentRate(
  tx: Tx | typeof prisma,
  productCode: string,
  at: Date = new Date(),
) {
  return tx.rate.findFirst({
    where: { productCode, effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: "desc" },
    include: { product: true, publisher: { select: { id: true, name: true } } },
  });
}

/** Current rate per product for every product that has one. */
export async function currentRates(at: Date = new Date()) {
  const rates = await prisma.rate.findMany({
    where: { effectiveFrom: { lte: at } },
    orderBy: [{ productCode: "asc" }, { effectiveFrom: "desc" }],
    include: { product: true, publisher: { select: { id: true, name: true } } },
  });

  const byProduct = new Map<string, (typeof rates)[number]>();
  for (const rate of rates) {
    if (!byProduct.has(rate.productCode)) byProduct.set(rate.productCode, rate);
  }

  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return products.map((product) => {
    const rate = byProduct.get(product.code) ?? null;
    return {
      product,
      rate,
      ratePerMt: rate ? rate.ratePerMt.toFixed(2) : null,
      effectiveFrom: rate?.effectiveFrom ?? null,
      hasRate: Boolean(rate),
    };
  });
}

/** Publishes a new rate and supersedes the previous effective one (history kept). */
export async function publishRate(input: PublishRateInput, user: Actor, ip?: string) {
  const effectiveFrom = zonedToUtc(input.effectiveFrom);
  const ratePerMt = money(input.ratePerMt);

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { code: input.productCode } });
    if (!product) throw errors.notFound("Product");
    if (!product.isActive) {
      throw errors.validation(`Product ${product.name} is inactive and cannot receive a new rate.`);
    }
    if (!user) throw errors.unauthenticated();

    const created = await tx.rate.create({
      data: {
        productCode: input.productCode,
        ratePerMt: ratePerMt.toFixed(2),
        effectiveFrom,
        status: "ACTIVE",
        publishedBy: user.id,
        note: input.note ?? null,
        createdBy: user.id,
      },
      include: { product: true },
    });

    // Everything already effective at (or before) the new rate is history now.
    const superseded = await tx.rate.updateMany({
      where: {
        productCode: input.productCode,
        id: { not: created.id },
        effectiveFrom: { lte: effectiveFrom },
        status: "ACTIVE",
      },
      data: { status: "SUPERSEDED" },
    });

    await writeAudit(
      {
        ...actor(user, ip),
        action: "PUBLISH",
        entity: "rate",
        entityId: created.id,
        newValue: {
          product: product.code,
          ratePerMt: ratePerMt.toFixed(2),
          effectiveFrom: effectiveFrom.toISOString(),
          supersededCount: superseded.count,
        },
      },
      tx,
    );

    return { rate: created, supersededCount: superseded.count };
  });
}

export type RateHistoryFilter = {
  productCode?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export async function rateHistory(filter: RateHistoryFilter = {}) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, filter.pageSize ?? 20));

  const where: Prisma.RateWhereInput = {
    ...(filter.productCode ? { productCode: filter.productCode } : {}),
    ...(filter.from || filter.to
      ? {
          effectiveFrom: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.rate.findMany({
      where,
      orderBy: { effectiveFrom: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { product: true, publisher: { select: { name: true } } },
    }),
    prisma.rate.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      productCode: r.productCode,
      productName: r.product.name,
      ratePerMt: r.ratePerMt.toFixed(2),
      effectiveFrom: r.effectiveFrom,
      status: r.status as RateStatus,
      publishedBy: r.publisher.name,
      publishedAt: r.publishedAt,
      note: r.note,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Daily rate-change history used by the "rate change history" report. */
export async function dailyRateChanges(from: Date, to: Date) {
  const rates = await prisma.rate.findMany({
    where: { effectiveFrom: { gte: from, lte: to } },
    orderBy: { effectiveFrom: "asc" },
    include: { product: true, publisher: { select: { name: true } } },
  });
  return rates.map((rate) => ({
    effectiveFrom: rate.effectiveFrom,
    productCode: rate.productCode,
    productName: rate.product.name,
    ratePerMt: rate.ratePerMt.toFixed(2),
    publishedBy: rate.publisher.name,
    note: rate.note ?? "",
  }));
}

/** Rate trend for the dashboard chart: last N changes per product. */
export async function rateTrend(limitDays = 30) {
  const since = new Date(Date.now() - limitDays * 86400000);
  const rates = await prisma.rate.findMany({
    where: { effectiveFrom: { gte: since } },
    orderBy: { effectiveFrom: "asc" },
    include: { product: { select: { name: true, code: true } } },
  });
  return rates.map((rate) => ({
    date: rate.effectiveFrom.toISOString().slice(0, 10),
    productCode: rate.productCode,
    productName: rate.product.name,
    ratePerMt: Number(rate.ratePerMt.toFixed(2)),
  }));
}

export function rateValue(qtyMt: string, ratePerMt: string): string {
  return money(dec(qtyMt).mul(dec(ratePerMt))).toFixed(2);
}
