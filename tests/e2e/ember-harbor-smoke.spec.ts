import { expect, test } from "@playwright/test";

test("login, select ember harbor explicitly, and clear the breakwater smoke flow", async ({ page }) => {
  test.setTimeout(240_000);
  const worldId = `e2e-ember-${Date.now()}`;
  const slowTimeout = 30_000;

  await page.goto("/");
  await page.getByTestId("sign-in").click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByTestId("auth-status")).toContainText("authenticated");
  await expect(page.getByTestId("sp-balance")).toContainText(/SP balance:\s*-?\d+/, { timeout: slowTimeout });

  await page.getByTestId("pack-select").selectOption("ember_harbor");
  await page.getByTestId("template-select").selectOption("ember_harbor");
  await page.getByTestId("world-id-input").fill(worldId);
  await page.getByTestId("start-session").click();

  await expect(page.getByTestId("socket-status")).toContainText("open", { timeout: 20_000 });
  await expect(page.getByTestId("session-pack")).toContainText("Ember Harbor", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).toContainText("session.connected", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).toContainText("Ember Harbor", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).not.toContainText("missing world context");
  await expect(page.getByTestId("ops-stream")).not.toContainText("global");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Ember Quay/i, { timeout: 20_000 });
  await expect(page.getByTestId("active-quest")).toContainText("First Harbor Request", { timeout: 20_000 });
  await expect(page.getByTestId("quest-progress")).toContainText("0/2", { timeout: 20_000 });
  await expect(page.getByTestId("local-figures-stream")).toContainText(/Runner Eska/i, { timeout: 20_000 });

  await page.getByTestId("nav-admin").click();
  await expect(page.getByTestId("ops-world-select")).toHaveValue(worldId, { timeout: slowTimeout });
  await expect(page.getByTestId("active-world-context")).toContainText(/Ember Harbor/i, { timeout: slowTimeout });
  await expect(page.getByTestId("release-pack-regressions-stream")).toContainText(/Ember Harbor/i, { timeout: slowTimeout });
  await page.getByTestId("trigger-idle-pass").click();
  await expect(page.getByTestId("world-tick-stream")).toContainText(/idle_world_pass/i, { timeout: slowTimeout });
  await expect(page.getByTestId("world-tick-stream")).toContainText(/Ember Harbor/i, { timeout: slowTimeout });
  await page.getByTestId("nav-game").click();

  for (let step = 0; step < 2; step += 1) {
    await page.getByTestId("choice-progress").click();
    await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: 120_000 });
  }

  await expect(page.getByTestId("quest-progress")).toContainText("2/2", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText(/Harbor Seal/i, { timeout: slowTimeout });
  await expect(page.getByTestId("choice-list")).toContainText(/use|seal|breakwater/i, { timeout: slowTimeout });

  await page.getByTestId("choice-progress").click();
  await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByTestId("active-quest")).toContainText("Breakwater Unsealed", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-stage")).toContainText("breakwater_unsealed", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("used", { timeout: slowTimeout });
  await expect(page.getByTestId("nearby-routes-stream")).toContainText(/Cinder Breakwater/i, { timeout: slowTimeout });

  await page.getByTestId("choice-progress").click();
  await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByTestId("current-place-summary")).toContainText(/Cinder Breakwater/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-travel-history")).toContainText(/Breakwater|breakwater/i, { timeout: slowTimeout });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/breakwater|harbor/i, { timeout: slowTimeout });
});
