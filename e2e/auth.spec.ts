import { expect, test } from "@playwright/test";

/**
 * Journey 1 — sign-in, role-based redirect and sign-out.
 * Uses the demo accounts created by `npm run db:seed`.
 */
const DEMO_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "demo1234";

test.describe("authentication", () => {
  test("rejects a wrong password with a visible error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("sales@sales-erp.local");
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert").first()).toContainText(/not signed in|incorrect|Invalid/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs in a salesperson and redirects to their order list", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("sales@sales-erp.local");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/sales\/orders/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("sends an unauthenticated visitor to the sign-in page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("signs out and blocks the dashboard again", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("management@sales-erp.local");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=/);
  });
});
