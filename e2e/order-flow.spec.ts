import { expect, test, type Page } from "@playwright/test";

const DEMO_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? "demo1234";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 20_000 });
}

/**
 * Journey 2 — Finance publishes a rate, the salesperson orders at that rate,
 * Sales Ops sees the approval checks and approves.
 *
 * The test is written defensively: if Finance has no rate for a product it
 * publishes one first, which also exercises the "as soon as a rate is published
 * sales can order" rule.
 */
test.describe("order lifecycle", () => {
  const financeEmail = "finance@sales-erp.local";

  test("publishes a rate in the finance screen", async ({ page }) => {
    await signIn(page, financeEmail);
    await page.goto("/finance/rates");

    await expect(page.getByRole("heading", { name: /Product selling rates/i })).toBeVisible();
    await page.getByLabel("Product").selectOption({ index: 1 });
    await page.getByLabel(/Selling rate/).fill("47500.00");
    await page.getByRole("button", { name: "Publish rate" }).click();

    // Either the success toast or the inline alert must confirm the publication.
    await expect(page.getByText(/published/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("a salesperson creates an order and sees the locked rate", async ({ page }) => {
    await signIn(page, "sales@sales-erp.local");
    await page.goto("/sales/orders/new");

    await page.getByLabel("Customer").selectOption({ index: 1 });
    await page.getByLabel(/Product 1/).selectOption({ index: 1 });
    await page.getByLabel("Quantity (MT)").first().fill("12.500");

    // The rate field is read-only and auto-filled from the published rate.
    await expect(page.getByText(/৳.*\/ MT/).first()).toBeVisible();

    await page.getByRole("button", { name: /Submit order for approval/i }).click();

    await expect(page).toHaveURL(/\/sales\/orders\/[^/]+\?created=1/, { timeout: 20_000 });
    await expect(page.getByText(/Order created and submitted for approval/i)).toBeVisible();
    await expect(page.getByText(/locked at ৳/i)).toBeVisible();
  });

  test("Sales Ops approves the oldest pending order from the queue", async ({ page }) => {
    await signIn(page, "salesops@sales-erp.local");
    await page.goto("/sales-ops/approvals");

    const heading = page.getByRole("heading", { name: /Approval queue/i });
    await expect(heading).toBeVisible();

    const approveButton = page.getByRole("button", { name: "Approve order" }).first();
    if ((await approveButton.count()) === 0) {
      test.skip(true, "no pending orders in the demo database");
    }

    // The checks are visible on screen before approving (Rule 2).
    await expect(page.getByText(/Rate valid at order time/i).first()).toBeVisible();
    await expect(page.getByText(/Customer active/i).first()).toBeVisible();

    // Remember which order is being approved: once it is approved the card leaves
    // the queue, so the disappearing card *is* the confirmation (a toast is fired
    // too, but the component unmounts as the list refreshes).
    const orderNo = (await page.getByRole("link", { name: /^SO-\d{2}-\d{2}-\d{4}-\d{3}$/ }).first().innerText()).trim();

    // If the customer is over its credit limit the button stays disabled until the
    // Sales Ops override is ticked and a reason is written (Rule 2). The demo data
    // grows on every run, so handle both cases.
    if (await approveButton.isDisabled()) {
      await page.getByLabel(/Override the credit limit/i).check();
      await page.getByLabel(/Written reason/i).fill("E2E: credit limit override for the demo run");
    }

    await approveButton.click();

    await expect(page.getByRole("link", { name: orderNo })).toHaveCount(0, { timeout: 20_000 });
  });

  test("shows the customer priority queue with blockers", async ({ page }) => {
    await signIn(page, "salesops@sales-erp.local");
    await page.goto("/sales-ops/priority");

    await expect(page.getByRole("heading", { name: /Customer priority queue/i })).toBeVisible();
    // Either a queue is shown, or the empty state explains what will appear.
    await expect(
      page.getByText(/Delivering now|Delivering now|No customer has an open delivery queue/i).first(),
    ).toBeVisible();
  });
});
