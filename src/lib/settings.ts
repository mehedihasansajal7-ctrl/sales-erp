import "server-only";
import prisma from "@/lib/prisma";
import type { Tx } from "@/lib/prisma";

/**
 * System settings (key/value), overridable at runtime from Admin → Settings.
 * Falls back to the environment defaults when a key has no row.
 */
export const SETTING_KEYS = {
  creditCheckEnabled: "credit_check_enabled",
  priorityOverrideEnabled: "priority_override_enabled",
  /**
   * When false (default) the warehouse must dispatch the full DO quantity set by
   * Sales Operations - it only records vehicle / challan details. Partial
   * shipments then happen by Sales Ops creating a smaller DO.
   */
  warehousePartialDispatch: "warehouse_partial_dispatch",
  companyName: "company_name",
  companyAddress: "company_address",
  defaultWarehouse: "default_warehouse",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

const ENV_DEFAULTS: Record<string, string> = {
  [SETTING_KEYS.creditCheckEnabled]: process.env.CREDIT_CHECK_ENABLED ?? "true",
  [SETTING_KEYS.priorityOverrideEnabled]: process.env.PRIORITY_OVERRIDE_ENABLED ?? "true",
  [SETTING_KEYS.warehousePartialDispatch]: process.env.WAREHOUSE_PARTIAL_DISPATCH ?? "false",
  [SETTING_KEYS.companyName]: "Bulk Commodity Trading Ltd.",
  [SETTING_KEYS.companyAddress]: "Dhaka, Bangladesh",
  [SETTING_KEYS.defaultWarehouse]: "",
};

const DEFAULTS: Record<string, string> = {
  ...ENV_DEFAULTS,
};

export async function getSettings(
  tx: Tx | typeof prisma = prisma,
): Promise<Record<string, string>> {
  const rows = await tx.systemSetting.findMany();
  const result: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export async function getSetting(
  key: string,
  tx: Tx | typeof prisma = prisma,
): Promise<string | undefined> {
  const row = await tx.systemSetting.findUnique({ where: { key } });
  return row?.value ?? DEFAULTS[key];
}

export async function getBooleanSetting(
  key: string,
  tx: Tx | typeof prisma = prisma,
  fallback = false,
): Promise<boolean> {
  const raw = await getSetting(key, tx);
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

export async function setSetting(
  key: string,
  value: string,
  userId?: string,
  tx: Tx | typeof prisma = prisma,
): Promise<void> {
  await tx.systemSetting.upsert({
    where: { key },
    create: { key, value, createdBy: userId ?? null },
    update: { value },
  });
}

export async function setSettings(
  values: Record<string, string>,
  userId?: string,
  tx: Tx | typeof prisma = prisma,
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await setSetting(key, value, userId, tx);
  }
}

export { DEFAULTS as SETTING_DEFAULTS };
