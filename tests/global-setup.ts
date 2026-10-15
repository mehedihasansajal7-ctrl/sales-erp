import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * Creates (if needed) and migrates the dedicated test database, then leaves it
 * empty. Runs once per `vitest` invocation.
 */
const TEST_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://postgres:postgres@localhost:5433/sales_erp_test";

const TEST_DB_NAME = new URL(TEST_URL).pathname.replace("/", "");

function maintenanceUrl(): string {
  const url = new URL(TEST_URL);
  url.pathname = "/postgres";
  return url.toString();
}

export default async function globalSetup() {
  const admin = new PrismaClient({ datasourceUrl: maintenanceUrl() });
  try {
    const existing = await admin.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname = $1`,
      TEST_DB_NAME,
    );
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
      console.log(`[tests] created database ${TEST_DB_NAME}`);
    }
  } finally {
    await admin.$disconnect();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  console.log(`[tests] migrations applied to ${TEST_DB_NAME}`);
}
