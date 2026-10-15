import { Prisma } from "@prisma/client";

/**
 * All quantity and money arithmetic goes through Prisma.Decimal (decimal.js).
 * Floating point is never used for MT or BDT values — see spec Section 4.
 */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export const MT_SCALE = 3;
export const MONEY_SCALE = 2;

/** Tolerant input parser: accepts number | string | Decimal | null | undefined. */
export type Numeric = number | string | Decimal | null | undefined;

export function dec(value: Numeric): Decimal {
  if (value === null || value === undefined || value === "") return new Prisma.Decimal(0);
  return new Prisma.Decimal(value as Prisma.Decimal.Value);
}

/** Quantity rounded to the MT scale (3 decimals, half-up). */
export function qty(value: Numeric): Decimal {
  return dec(value).toDecimalPlaces(MT_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Money rounded to 2 decimals, half-up. */
export function money(value: Numeric): Decimal {
  return dec(value).toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** qty1 * qty2 with MT-scale rounding — used for line values. */
export function lineValue(qtyMt: Numeric, ratePerMt: Numeric): Decimal {
  return money(dec(qtyMt).mul(dec(ratePerMt)));
}

export function sum(values: Numeric[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

export function isZero(value: Numeric): boolean {
  return dec(value).isZero();
}

export function isPositive(value: Numeric): boolean {
  return dec(value).gt(0);
}

/** Clamp negatives to zero (used when a counter could drift by rounding). */
export function nonNegative(value: Numeric): Decimal {
  const d = dec(value);
  return d.isNegative() ? new Decimal(0) : d;
}

/** Human readable MT, e.g. "1,234.500 MT". */
export function formatMt(value: Numeric, withUnit = true): string {
  const d = qty(value);
  const s = d.toNumber().toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return withUnit ? `${s} MT` : s;
}

/** Human readable BDT, e.g. "৳ 5,000,000.00". */
export function formatBdt(value: Numeric): string {
  const d = money(value);
  return `৳ ${d.toNumber().toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Plain number string for inputs / exports (no symbol, no grouping). */
export function toPlainString(value: Numeric, scale: number = MT_SCALE): string {
  return dec(value).toFixed(scale);
}

export { Prisma };
