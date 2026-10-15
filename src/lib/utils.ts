import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 1,234.500 — used in tables and forms (client-safe, no Prisma import). */
export function formatNumber(value: string | number | null | undefined, decimals = 3): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatMt(value: string | number | null | undefined): string {
  return `${formatNumber(value, 3)} MT`;
}

export function formatBdt(value: string | number | null | undefined): string {
  return `৳ ${formatNumber(value, 2)}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Status → badge tone. */
export function statusTone(status: string): "default" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "COMPLETED":
    case "DISPATCHED":
    case "APPROVED":
    case "RECEIVED":
    case "ACTIVE":
      return "success";
    case "PENDING_APPROVAL":
    case "PARTIALLY_DELIVERED":
    case "PARTIALLY_DISPATCHED":
    case "CREATED":
    case "REQUESTED":
    case "IN_TRANSIT":
      return "warning";
    case "REJECTED":
    case "CANCELLED":
      return "danger";
    case "SHORT_CLOSED":
      return "info";
    default:
      return "default";
  }
}
