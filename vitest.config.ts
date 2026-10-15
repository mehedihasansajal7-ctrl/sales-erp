import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Test setup.
 *
 * Integration tests run against a REAL PostgreSQL database (`sales_erp_test`),
 * because the correctness of this product depends on row locks, CHECK
 * constraints and transactions — a mock would test nothing.
 *
 * The database is created and migrated by `tests/global-setup.ts`; the URL can
 * be overridden with DATABASE_URL_TEST.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@/tests": path.resolve(import.meta.dirname, "tests"),
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` must not be evaluated outside the React Server runtime.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      // A generous connection pool: the concurrency tests fire 20 parallel
      // transactions at one customer lock, so the pool must not be the
      // bottleneck (otherwise we would be testing Prisma's pool, not our rules).
      DATABASE_URL:
        process.env.DATABASE_URL_TEST ??
        "postgresql://postgres:postgres@localhost:5433/sales_erp_test?connection_limit=25&pool_timeout=60",
      APP_TIMEZONE: "Asia/Dhaka",
      AUTH_SECRET: "test-secret-0123456789abcdefghijklmnop",
      CREDIT_CHECK_ENABLED: "true",
      PRIORITY_OVERRIDE_ENABLED: "true",
    },
    // All files share one database, so they must not run in parallel.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
