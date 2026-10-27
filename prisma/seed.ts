import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Seed script — demo data for the bulk-commodity sales ERP.
 *
 * Creates (idempotently):
 *   * one user per role with documented demo passwords
 *   * 3 products (Fertilizer, Coal, Grain) and 3 warehouses
 *   * 5 customers (one with a credit limit)
 *   * opening stock per warehouse/product
 *   * today's published rates
 *   * system settings
 *
 * Run with: npm run db:seed
 */

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "demo1234";

const USERS: { name: string; email: string; role: Role; warehouseCode?: string; password?: string }[] = [
  { name: "System Administrator", email: process.env.SEED_ADMIN_EMAIL ?? "admin@sales-erp.local", role: "ADMIN" },
  { name: "Finance Manager", email: "finance@sales-erp.local", role: "FINANCE" },
  { name: "Salesperson (Dhaka)", email: "sales@sales-erp.local", role: "SALES" },
  { name: "Sales Operations", email: "salesops@sales-erp.local", role: "SALES_OPS" },
  { name: "Warehouse Dhaka", email: "warehouse.dhk@sales-erp.local", role: "WAREHOUSE", warehouseCode: "WH-DHK" },
  { name: "Warehouse Chattogram", email: "warehouse.ctg@sales-erp.local", role: "WAREHOUSE", warehouseCode: "WH-CTG" },
  { name: "Management", email: "management@sales-erp.local", role: "MANAGEMENT" },
];

const PRODUCTS = [
  { code: "FERT-UREA", name: "Urea Fertilizer", category: "Fertilizer" },
  { code: "COAL-IMPORT", name: "Imported Coal", category: "Coal" },
  { code: "GRAIN-WHEAT", name: "Wheat", category: "Grain" },
];

const WAREHOUSES = [
  { code: "WH-DHK", name: "Dhaka Warehouse", location: "Narayanganj, Dhaka" },
  { code: "WH-CTG", name: "Chattogram Ship Point", location: "Patenga, Chattogram" },
  { code: "WH-MGL", name: "Mongla Warehouse", location: "Mongla Port" },
];

const CUSTOMERS = [
  { code: "CUS-001", name: "Rahman Agro Ltd.", phone: "01711-000101", address: "Jashore", creditLimit: "5000000.00" },
  { code: "CUS-002", name: "Sonali Traders", phone: "01711-000102", address: "Bogura", creditLimit: "3000000.00" },
  { code: "CUS-003", name: "Meghna Cement Works", phone: "01711-000103", address: "Munshiganj", creditLimit: "10000000.00" },
  { code: "CUS-004", name: "Karnaphuli Feed Mills", phone: "01711-000104", address: "Chattogram", creditLimit: null },
  { code: "CUS-005", name: "Bangla Commodities", phone: "01711-000105", address: "Dhaka", creditLimit: "2000000.00" },
];

/** Opening stock in MT: [warehouseCode, productCode, qtyMt] */
const OPENING_STOCK: [string, string, string][] = [
  ["WH-DHK", "FERT-UREA", "5000.000"],
  ["WH-DHK", "COAL-IMPORT", "3000.000"],
  ["WH-DHK", "GRAIN-WHEAT", "2500.000"],
  ["WH-CTG", "FERT-UREA", "4000.000"],
  ["WH-CTG", "COAL-IMPORT", "12000.000"],
  ["WH-MGL", "COAL-IMPORT", "8000.000"],
  ["WH-MGL", "GRAIN-WHEAT", "1500.000"],
];

/** Today's selling rates in BDT per MT. */
const RATES: [string, string][] = [
  ["FERT-UREA", "45000.00"],
  ["COAL-IMPORT", "18500.00"],
  ["GRAIN-WHEAT", "39000.00"],
];

async function seedSettings() {
  const settings: [string, string, string][] = [
    ["credit_check_enabled", process.env.CREDIT_CHECK_ENABLED ?? "true", "Warn (with override) when the credit limit is exceeded"],
    ["priority_override_enabled", process.env.PRIORITY_OVERRIDE_ENABLED ?? "true", "Allow Sales Ops priority overrides with a reason"],
    ["company_name", "Bulk Commodity Trading Ltd.", "Printed on order / DO / challan documents"],
    ["company_address", "Level 5, Motijheel C/A, Dhaka 1000, Bangladesh", "Printed company address"],
    ["default_warehouse", "WH-DHK", "Pre-selected warehouse on the DO form"],
  ];
  for (const [key, value, description] of settings) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, description },
      update: { value, description },
    });
  }
  console.log(`  settings        ${settings.length}`);
}

async function seedUsers() {
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  let created = 0;
  for (const user of USERS) {
    const existing = await prisma.user.findUnique({ where: { email: user.email } });
    if (existing) continue;
    await prisma.user.create({
      data: {
        name: user.name,
        email: user.email,
        passwordHash: user.password ? await bcrypt.hash(user.password, 10) : hash,
        role: user.role,
        warehouseId: user.warehouseCode ?? null,
        isActive: true,
        createdBy: null,
      },
    });
    created += 1;
  }
  console.log(`  users           ${created} created (${USERS.length} total)`);
}

async function seedMasterData() {
  let count = 0;
  for (const warehouse of WAREHOUSES) {
    await prisma.warehouse.upsert({
      where: { code: warehouse.code },
      create: { ...warehouse, isActive: true },
      update: { name: warehouse.name, location: warehouse.location },
    });
    count += 1;
  }
  for (const product of PRODUCTS) {
    await prisma.product.upsert({
      where: { code: product.code },
      create: { ...product, unit: "MT", isActive: true },
      update: { name: product.name, category: product.category },
    });
    count += 1;
  }
  for (const customer of CUSTOMERS) {
    await prisma.customer.upsert({
      where: { code: customer.code },
      create: { ...customer, isActive: true },
      update: { name: customer.name, phone: customer.phone, address: customer.address, creditLimit: customer.creditLimit },
    });
    count += 1;
  }
  console.log(`  master data     ${count} records (${WAREHOUSES.length} warehouses, ${PRODUCTS.length} products, ${CUSTOMERS.length} customers)`);
}

async function seedOpeningStock() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  let created = 0;

  for (const [warehouseCode, productCode, qtyMt] of OPENING_STOCK) {
    const existing = await prisma.stockLedger.count({
      where: { warehouseId: warehouseCode, productCode },
    });
    if (existing > 0) continue;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO stock_balances (id, warehouse_id, product_id, on_hand_mt, reserved_mt, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, ${warehouseCode}, ${productCode}, ${qtyMt}::numeric, 0, now(), now())
        ON CONFLICT (warehouse_id, product_id) DO UPDATE SET on_hand_mt = ${qtyMt}::numeric, updated_at = now()
      `;
      await tx.stockLedger.create({
        data: {
          warehouseId: warehouseCode,
          productCode,
          movementType: "OPENING",
          qtyMt,
          refType: "opening",
          balanceAfter: qtyMt,
          reservedAfter: "0",
          note: "Opening stock (seed)",
          createdBy: admin?.id ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: admin?.id ?? null,
          userName: admin?.name ?? "seed",
          action: "CREATE",
          entity: "stock",
          entityId: `${warehouseCode}:${productCode}`,
          newValue: { warehouse: warehouseCode, product: productCode, openingMt: qtyMt },
        },
      });
    });
    created += 1;
  }
  console.log(`  opening stock   ${created} created (${OPENING_STOCK.length} total)`);
}

async function seedRates() {
  const finance = await prisma.user.findFirst({ where: { role: "FINANCE" } });
  if (!finance) throw new Error("Finance user missing — run the user seed first.");
  let created = 0;

  for (const [productCode, ratePerMt] of RATES) {
    const existing = await prisma.rate.count({ where: { productCode } });
    if (existing > 0) continue;
    await prisma.rate.create({
      data: {
        productCode,
        ratePerMt,
        effectiveFrom: new Date(),
        status: "ACTIVE",
        publishedBy: finance.id,
        note: "Opening published rate (seed)",
        createdBy: finance.id,
      },
    });
    created += 1;
  }
  console.log(`  rates           ${created} published (${RATES.length} total)`);
}

async function main() {
  // Safety net for production: demo rows must never overwrite a live database.
  // The entrypoint defaults SEED_ON_START to false, and even when it is enabled the
  // seed refuses to touch a database that already contains real orders.
  const existingOrders = await prisma.order.count();
  if (existingOrders > 0 && process.env.SEED_FORCE !== "1") {
    console.log(
      `Seed skipped: the database already contains ${existingOrders} order(s). ` +
        "Set SEED_FORCE=1 only if you really want to re-run the demo seed.",
    );
    return;
  }
  console.log("Seeding the sales ERP demo database…");
  await seedSettings();
  // Warehouses must exist before users (a warehouse user is bound to one).
  await seedMasterData();
  await seedUsers();
  await seedOpeningStock();
  await seedRates();

  console.log("\nDemo logins (password for every account below):", DEFAULT_PASSWORD);
  for (const user of USERS) {
    console.log(`  ${user.role.padEnd(11)} ${user.email}`);
  }
  console.log("\nDone. Start the app with `npm run dev` (or `docker compose up`).");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
