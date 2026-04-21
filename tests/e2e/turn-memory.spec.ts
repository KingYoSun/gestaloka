import { expect, test } from "@playwright/test";

test("login, start a world, submit two turns, and see same-world memory output", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/");
  await page.getByTestId("sign-in").click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByTestId("auth-status")).toContainText("authenticated");
  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("socket-status")).toContainText("open");

  await page.getByTestId("turn-input").fill("広場で灯をともす");
  await page.getByTestId("submit-turn").click();

  await expect(page.getByTestId("latest-narrative")).toContainText(/世界の事実として記録/i);
  await expect(page.getByTestId("ops-stream")).toContainText("turn.narrative.delta");
  await expect(page.getByTestId("memories-stream")).toContainText("広場で灯をともす");

  await page.getByTestId("turn-input").fill("広場を見回し、気配を探る");
  await page.getByTestId("submit-turn").click();

  await expect(page.getByTestId("latest-reaction")).toContainText("灯をともす");
  await expect(page.getByTestId("events-stream")).toContainText("player.turn.resolved");
  await expect(page.getByTestId("ops-stream")).toContainText("turn.resolved");
});
