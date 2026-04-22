import { expect, test } from "@playwright/test";

test("login, unlock follow-up progression with a reward item, and keep admin/SP flows separate", async ({ page }) => {
  test.setTimeout(240_000);
  const worldId = `e2e-memory-${Date.now()}`;
  const slowTimeout = 60_000;

  const readBalance = async () => {
    const text = await page.getByTestId("sp-balance").textContent();
    const match = text?.match(/SP balance:\s*(-?\d+)/);
    expect(match).not.toBeNull();
    return Number(match?.[1]);
  };

  await page.goto("/");
  await page.getByTestId("sign-in").click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByTestId("auth-status")).toContainText("authenticated");
  await expect(page.getByTestId("sp-balance")).toContainText(/SP balance:\s*-?\d+/, { timeout: slowTimeout });
  await expect(page.getByTestId("sp-budget-note")).toContainText("execution budget");
  const currentBalance = await readBalance();
  if (currentBalance !== 10) {
    await page.getByTestId("nav-admin").click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByTestId("adjust-delta").fill(String(10 - currentBalance));
    await page.getByTestId("submit-adjustment").click();
    await expect(page.getByTestId("last-adjustment")).toContainText("balance 10");
    await page.getByTestId("nav-game").click();
    await expect(page).toHaveURL(/\/$/);
  }
  await expect(page.getByTestId("sp-balance")).toContainText("10");

  await page.getByTestId("world-id-input").fill(worldId);
  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("active-quest")).toContainText("First Watch Request", { timeout: 20_000 });
  await expect(page.getByTestId("quest-progress")).toContainText("0/2", { timeout: 20_000 });
  await expect(page.getByTestId("choice-list")).toContainText("困っている相手", { timeout: 20_000 });

  await page.getByTestId("choice-progress").click();

  await expect(page.getByTestId("latest-narrative")).not.toContainText("No turn resolved yet.", { timeout: slowTimeout });
  await expect(page.getByTestId("memories-stream").locator("li").first()).toBeVisible({ timeout: slowTimeout });
  await expect(page.getByTestId("ops-stream")).toContainText("intent_interpretation", { timeout: slowTimeout });
  await expect(page.getByTestId("ops-stream")).toContainText("choice_generation", { timeout: slowTimeout });
  await expect(page.getByTestId("sp-balance")).toContainText("9", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-progress")).toContainText("1/2", { timeout: slowTimeout });
  await expect(page.getByTestId("faction-standing")).toContainText("Founders Watch");

  await page.getByTestId("choice-progress").click();
  await expect(page.getByTestId("latest-reaction")).not.toContainText("No NPC reaction yet.", { timeout: slowTimeout });
  await expect(page.getByTestId("sp-balance")).toContainText("8", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-progress")).toContainText("2/2", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("Lantern Sigil", { timeout: slowTimeout });
  await page.getByTestId("choice-progress").click();
  await expect(page.getByTestId("sp-balance")).toContainText("7", { timeout: slowTimeout });
  await expect(page.getByTestId("active-quest")).toContainText("Watch Path Unsealed", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-stage")).toContainText("watch_path_followup", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("used", { timeout: slowTimeout });

  await page.getByTestId("toggle-free-text").click();
  await page.getByTestId("turn-input").fill("Lantern Sigilで開いた watch path の様子を観察する");
  await page.getByTestId("submit-turn").click();
  await expect(page.getByTestId("latest-reaction")).not.toContainText("No NPC reaction yet.", { timeout: slowTimeout });
  await expect(page.getByTestId("latest-reaction")).toContainText(/Lantern|Sigil|watch|巡回|見回|灯/, { timeout: slowTimeout });
  await expect(page.getByTestId("sp-balance")).toContainText("4", { timeout: slowTimeout });
  await expect(page.getByTestId("last-consequence-summary")).not.toContainText("The scene is waiting", { timeout: slowTimeout });

  await page.getByTestId("nav-admin").click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId("ops-status")).toContainText("ready");
  await expect(page.getByTestId("sp-admin-separation-note")).toContainText("separate");
  await expect(page.getByTestId("admin-ledger")).toContainText("turn_cost");
  await expect(page.getByTestId("progression-stream")).toContainText("Watch Path Unsealed");
  await expect(page.getByTestId("progression-stream")).toContainText("used");
  await expect(page.getByTestId("council-trace-stream")).toContainText("intent_interpreter");
  await expect(page.getByTestId("council-trace-stream")).toContainText("narrative");
  const adminBalance = await readBalance();
  await page.getByTestId("adjust-delta").fill(String(-adminBalance));
  await page.getByTestId("submit-adjustment").click();
  await expect(page.getByTestId("last-adjustment")).toContainText("balance 0");

  await page.getByTestId("nav-game").click();
  await expect(page.getByTestId("sp-balance")).toContainText("0");
  await page.getByTestId("choice-progress").click();
  await expect(page.getByTestId("error-banner")).toContainText("Insufficient SP balance", { timeout: 15_000 });
});
