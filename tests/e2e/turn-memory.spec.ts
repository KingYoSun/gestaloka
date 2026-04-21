import { expect, test } from "@playwright/test";

test("login, start a world, submit a turn, and see same-world memory output", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByText("Status: authenticated")).toBeVisible();
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Submit turn" }).click();

  await expect(page.getByText("Latest narrative")).toBeVisible();
  await expect(page.getByText(/世界の事実として記録/i)).toBeVisible();
  await expect(page.getByText("player.turn.resolved")).toBeVisible();
  await expect(page.getByText(/広場で旅人を助け/i)).toBeVisible();
});
