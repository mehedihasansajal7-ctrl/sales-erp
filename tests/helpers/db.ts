import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * Test fixtures. Every helper talks to the real database through the real
 * service layer where it matters (so the tests exercise production code paths).
 */

const TABLES = [
  "dispatch_items",
  "dispatches",
  "delivery_order_items",
  "delivery_orders",
  "order_items",
  "orders",
  "stock_ledger",
  "stock_balances",
  "stock_transfers",
  "stock_counts",
  "rates",
  "audit_logs",
  "sessions",
  "customers",
  "products",
  "warehouses",
  "users",
  "system_settings",
  "sequences",
];

/**
 * Empties every table. The audit log is append-only by trigger, so the trigger
 * is disabled for the teardown only — the append-only test re-enables nothing,
 * it relies on the trigger being active (reset always re-enables it).
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "audit_logs" DISABLE TRIGGER audit_logs_append_only`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "audit_logs" DISABLE TRIGGER audit_logs_no_truncate`,
  );
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "audit_logs" ENABLE TRIGGER audit_logs_append_only`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "audit_logs" ENABLE TRIGGER audit_logs_no_truncate`,
  );
}

export type Fixtures = Awaited<ReturnType<typeof seedBase>>;

/** Master data + one user per role + opening stock + today's rates. */
export async function seedBase() {
  const passwordHash = await bcrypt.hash("demo1234", 4);

  const warehouses = await Promise.all(
    [
      { code: "WH-DHK", name: "Dhaka Warehouse", location: "Dhaka" },
      { code: "WH-CTG", name: "Chattogram Ship Point", location: "Chattogram" },
      { code: "WH-MGL", name: "Mongla Warehouse", location: "Mongla" },
    ].map((warehouse) => prisma.warehouse.create({ data: warehouse })),
  );

  const products = await Promise.all(
    [
      { code: "FERT-UREA", name: "Urea Fertilizer", category: "Fertilizer" },
      { code: "COAL-IMPORT", name: "Imported Coal", category: "Coal" },
      { code: "GRAIN-WHEAT", name: "Wheat", category: "Grain" },
    ].map((product) => prisma.product.create({ data: { ...product, unit: "MT" } })),
  );

  const customers = await Promise.all(
    [
      { code: "CUS-ABC", name: "ABC Agro Ltd.", creditLimit: "100000000.00" },
      { code: "CUS-XYZ", name: "XYZ Traders", creditLimit: null },
      { code: "CUS-SMALL", name: "Small Trader", creditLimit: "1000000.00" },
    ].map((customer) => prisma.customer.create({ data: customer })),
  );

  const roleEmails: Record<Role, string> = {
    ADMIN: "admin@test.local",
    FINANCE: "finance@test.local",
    SALES: "sales@test.local",
    SALES_OPS: "salesops@test.local",
    WAREHOUSE: "warehouse.dhk@test.local",
    MANAGEMENT: "management@test.local",
  };

  const users: Record<string, { id: string; name: string; role: Role; warehouseCode?: string }> = {};
  for (const [role, email] of Object.entries(roleEmails) as [Role, string][]) {
    const user = await prisma.user.create({
      data: {
        name: `${role} User`,
        email,
        passwordHash,
        role,
        warehouseId: role === "WAREHOUSE" ? "WH-DHK" : null,
      },
    });
    users[role] = {
      id: user.id,
      name: user.name,
      role: user.role,
      warehouseCode: user.warehouseId ?? undefined,
    };
  }

  // A second warehouse user to prove cross-warehouse isolation.
  const ctgUser = await prisma.user.create({
    data: {
      name: "WAREHOUSE CTG User",
      email: "warehouse.ctg@test.local",
      passwordHash,
      role: "WAREHOUSE",
      warehouseId: "WH-CTG",
    },
  });
  users["WAREHOUSE_CTG"] = {
    id: ctgUser.id,
    name: ctgUser.name,
    role: ctgUser.role,
    warehouseCode: "WH-CTG",
  };

  await prisma.systemSetting.createMany({
    data: [
      { key: "credit_check_enabled", value: "true" },
      { key: "priority_override_enabled", value: "true" },
      { key: "company_name", value: "Test Commodity Trading Ltd." },
      { key: "company_address", value: "Dhaka" },
    ],
  });

  return { warehouses, products, customers, users };
}

/** Opening stock for a warehouse/product, written through the ledger path. */
export async function giveOpeningStock(
  warehouseCode: string,
  productCode: string,
  qtyMt: string,
): Promise<void> {
  const { openingStock } = await import("@/server/services/stock.service");
  await prisma.$transaction(async (tx) =>
    openingStock(tx, {
      warehouseCode,
      productCode,
      qtyMt,
      note: "test opening",
      refType: "opening",
    }),
  );
}

/** Publishes a rate through the real service. */
export async function publishRate(
  productCode: string,
  ratePerMt: string,
  financeUserId: string,
  effectiveFrom: Date = new Date(),
): Promise<string> {
  const { publishRate: publish } = await import("@/server/services/rate.service");
  const result = await publish(
    {
      productCode,
      ratePerMt,
      effectiveFrom: effectiveFrom.toISOString(),
    },
    { id: financeUserId, name: "FINANCE User", role: "FINANCE" },
  );
  return result.rate.id;
}

export function actor(
  user: { id: string; name: string; role: Role; warehouseCode?: string },
  warehouseCode?: string,
) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    warehouseCode: warehouseCode ?? user.warehouseCode ?? null,
  };
}

export { prisma };
