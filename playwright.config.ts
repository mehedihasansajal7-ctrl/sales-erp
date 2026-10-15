import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the three critical journeys (spec Section 3):
 *   1. sign-in / role redirect / sign-out
 *   2. salesperson creates an order -> Sales Ops approves it -> a DO is created
 *   3. warehouse dispatch (including the priority guard)
 *
 * They run against a real server + real database. Start the stack first with
 * `docker compose up` (or `npm run dev`) or let Playwright start `npm run dev`.
 *
 *   npx playwright install chromium   # once, to download the browser
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        /*
         * Use an already-installed browser when one is available so that
         * `npm run test:e2e` works without downloading Chromium:
         *   PW_CHANNEL=chrome|msedge  (default: msedge on Windows, chromium elsewhere)
         * To use Playwright's own browser instead: `npx playwright install chromium`.
         */
        channel:
          (process.env.PW_CHANNEL as "chrome" | "msedge" | undefined) ??
          (process.platform === "win32" ? "msedge" : undefined),
      },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3001/login",
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
