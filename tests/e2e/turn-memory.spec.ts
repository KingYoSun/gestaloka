import { expect, test } from "@playwright/test";

test("login, spend SP on turns, adjust balance in admin, and block turns at zero balance", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/");
  await page.getByTestId("sign-in").click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByTestId("auth-status")).toContainText("authenticated");
  await expect(page.getByTestId("sp-balance")).toContainText("10");

  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("socket-status")).toContainText("open");

  await page.getByTestId("turn-input").fill("広場で灯をともす");
  await page.getByTestId("submit-turn").click();

  await expect(page.getByTestId("latest-narrative")).toContainText(/世界の事実として記録/i);
  await expect(page.getByTestId("memories-stream")).toContainText("広場で灯をともす");
  await expect(page.getByTestId("sp-balance")).toContainText("9");

  await page.getByTestId("nav-admin").click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId("ops-status")).toContainText("ready");
  await expect(page.getByTestId("admin-ledger")).toContainText("turn_cost");

  await page.getByTestId("adjust-delta").fill("2");
  await page.getByTestId("submit-adjustment").click();
  await expect(page.getByTestId("last-adjustment")).toContainText("balance 11");

  await page.getByTestId("nav-game").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("sp-balance")).toContainText("11");

  await page.getByTestId("turn-input").fill("広場を見回し、気配を探る");
  await page.getByTestId("submit-turn").click();
  await expect(page.getByTestId("latest-reaction")).toContainText("灯をともす");
  await expect(page.getByTestId("sp-balance")).toContainText("10");

  await page.getByTestId("nav-admin").click();
  await page.getByTestId("rebuild-graph").click();
  await expect(page.getByTestId("rebuild-result")).toContainText("Rebuilt");
  await page.getByTestId("adjust-delta").fill("-10");
  await page.getByTestId("submit-adjustment").click();
  await expect(page.getByTestId("last-adjustment")).toContainText("balance 0");

  await page.getByTestId("nav-game").click();
  await expect(page.getByTestId("sp-balance")).toContainText("0");
  await page.getByTestId("turn-input").fill("広場で第三の行動を試す");
  await page.getByTestId("submit-turn").click();
  await expect(page.getByTestId("error-banner")).toContainText("Insufficient SP balance");
});
