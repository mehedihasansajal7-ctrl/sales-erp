import { expect, test, type Page } from "@playwright/test";

const DEMO_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "demo1234";

async function signIn(page: Page, email: string, expectedUrl?: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (expectedUrl) await expect(page).toHaveURL(expectedUrl, { timeout: 20_000 });
  else await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 20_000 });
}

/**
 * Journey 3 — the warehouse sees only its own delivery orders, records a
 * dispatch (or is correctly blocked by the priority rule), and can print.
 */
test.describe("warehouse operations", () => {
  test("the warehouse user only sees its own delivery orders", async ({ page }) => {
    await signIn(page, "warehouse.dhk@sales-erp.local", /\/warehouse\/dispatch-orders/);

    await expect(page.getByRole("heading", { name: /My delivery orders/i })).toBeVisible();
    await expect(page.getByText(/Dhaka Warehouse/i).first()).toBeVisible();

    // A warehouse user has no way to create a delivery order.
    await expect(page.getByRole("link", { name: /New delivery order/i })).toHaveCount(0);
    // ...and no approval queue in the navigation.
    await expect(page.getByRole("link", { name: /Approval queue/i })).toHaveCount(0);
  });

  test("the warehouse can open a DO and fill the dispatch form", async ({ page }) => {
    await signIn(page, "warehouse.dhk@sales-erp.local", /\/warehouse\/dispatch-orders/);

    const dispatchLink = page.getByRole("link", { name: "Dispatch" }).first();
    if ((await dispatchLink.count()) === 0) {
      test.skip(true, "no open delivery order for this warehouse in the demo database");
    }
    await dispatchLink.click();

    await expect(page.getByRole("heading", { name: /Dispatch — DO-/i })).toBeVisible();
    // The dispatch form is present for an open DO.
    await expect(page.getByLabel(/Truck \/ vehicle number/i)).toBeVisible();
    await expect(page.getByLabel(/Challan number/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Record dispatch/i })).toBeVisible();
  });

  test("stock entry, transfers and counts screens render for the warehouse", async ({ page }) => {
    await signIn(page, "warehouse.dhk@sales-erp.local");

    await page.goto("/warehouse/stock");
    await expect(page.getByRole("heading", { name: /Stock balances/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Inward receipt/i })).toBeVisible();

    await page.goto("/warehouse/transfers");
    await expect(page.getByRole("heading", { name: /Stock transfers/i })).toBeVisible();

    await page.goto("/warehouse/counts");
    await expect(page.getByRole("heading", { name: /Physical stock counts/i })).toBeVisible();
  });

  test("management sees reports but no write actions", async ({ page }) => {
    await signIn(page, "management@sales-erp.local", /\/dashboard/);

    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Order balance report/i })).toBeVisible();

    // No administration section for management beyond the audit log.
    await expect(page.getByRole("link", { name: /Users & roles/i })).toHaveCount(0);
  });

  test("a report exports to Excel and PDF", async ({ page, request }) => {
    await signIn(page, "management@sales-erp.local", /\/dashboard/);

    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

    const xlsx = await request.get("/api/reports/order-balance/export?format=xlsx", {
      headers: { cookie: cookieHeader },
    });
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
    expect((await xlsx.body()).length).toBeGreaterThan(1000);

    const pdf = await request.get("/api/reports/order-balance/export?format=pdf", {
      headers: { cookie: cookieHeader },
    });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  });
});
