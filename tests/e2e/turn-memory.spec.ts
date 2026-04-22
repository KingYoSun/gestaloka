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

  await page.getByTestId("turn-input").fill("広場で旅人を助け、灯をともす");
  await page.getByTestId("submit-turn").click();

  await expect(page.getByTestId("latest-narrative")).not.toContainText("No turn resolved yet.", { timeout: slowTimeout });
  await expect(page.getByTestId("memories-stream").locator("li").first()).toBeVisible({ timeout: slowTimeout });
  await expect(page.getByTestId("ops-stream")).toContainText("memory_council", { timeout: slowTimeout });
  await expect(page.getByTestId("ops-stream")).toContainText("narrative", { timeout: slowTimeout });
  await expect(page.getByTestId("sp-balance")).toContainText("9", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-progress")).toContainText("1/2", { timeout: slowTimeout });
  await expect(page.getByTestId("faction-standing")).toContainText("Founders Watch");

  await page.getByTestId("nav-admin").click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId("ops-status")).toContainText("ready");
  await expect(page.getByTestId("embedding-status-summary")).toContainText(/Embedding:/);
  await expect(page.getByTestId("graph-faction-count")).toContainText("1");
  await expect(page.getByTestId("graph-quest-count")).toContainText("1");
  await expect(page.getByTestId("admin-ledger")).toContainText("turn_cost");
  await expect(page.getByTestId("council-trace-stream")).toContainText("memory_manager");
  await expect(page.getByTestId("council-trace-stream")).toContainText("narrative");
  await expect(page.getByTestId("memory-retrieval-trace")).toContainText(/Latest retrieval:/);
  await page.getByTestId("run-eval-smoke").click();
  await expect(page.getByTestId("eval-runs-stream")).toContainText("turn_resolution_smoke", { timeout: slowTimeout });
  await expect(page.getByTestId("observability-summary")).toContainText("Lag:");
  await expect(page.getByTestId("canary-health-status")).toContainText(/Canary:/);
  await page.getByTestId("run-release-checklist").click();
  await expect(page.getByTestId("release-gate-verdict")).toContainText(/blocked|passed/, { timeout: slowTimeout });
  await expect(page.getByTestId("release-runbook")).toContainText("promote");

  await page.getByTestId("adjust-delta").fill("2");
  await page.getByTestId("submit-adjustment").click();
  await expect(page.getByTestId("last-adjustment")).toContainText("balance 11");

  await page.getByTestId("nav-game").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("sp-balance")).toContainText("11");

  await page.getByTestId("turn-input").fill("旅人へ報告し、広場を見回して次の見回りを約束する");
  await page.getByTestId("submit-turn").click();
  await expect(page.getByTestId("latest-reaction")).not.toContainText("No NPC reaction yet.", { timeout: slowTimeout });
  await expect(page.getByTestId("sp-balance")).toContainText("10", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-progress")).toContainText("2/2", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("Lantern Sigil", { timeout: slowTimeout });
  await page.getByTestId("inventory-stream").getByRole("button", { name: "Use" }).click();
  await expect(page.getByTestId("sp-balance")).toContainText("9", { timeout: slowTimeout });
  await expect(page.getByTestId("active-quest")).toContainText("Watch Path Unsealed", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-stage")).toContainText("watch_path_followup", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("used", { timeout: slowTimeout });

  await page.getByTestId("turn-input").fill("Lantern Sigilで開いた watch path の様子を観察する");
  await page.getByTestId("submit-turn").click();
  await expect(page.getByTestId("latest-reaction")).not.toContainText("No NPC reaction yet.", { timeout: slowTimeout });
  await expect(page.getByTestId("latest-reaction")).toContainText(/Lantern|Sigil|watch|巡回|見回|灯/, { timeout: slowTimeout });
  await expect(page.getByTestId("sp-balance")).toContainText("8", { timeout: slowTimeout });

  await page.getByTestId("nav-admin").click();
  await expect(page.getByTestId("sp-admin-separation-note")).toContainText("separate");
  await expect(page.getByTestId("progression-stream")).toContainText("Watch Path Unsealed");
  await expect(page.getByTestId("progression-stream")).toContainText("used");
  await page.getByTestId("memory-search-query").fill("Lantern Sigil");
  await page.getByTestId("run-memory-search").click();
  await expect(page.getByTestId("memory-search-stream").locator("li").first()).toBeVisible({ timeout: slowTimeout });
  await expect(page.getByTestId("memory-search-stream")).toContainText(/Lantern Sigil|watch path|巡回路/, { timeout: slowTimeout });
  await page.getByTestId("rebuild-graph").click();
  await expect(page.getByTestId("rebuild-result")).toContainText("Rebuilt", { timeout: slowTimeout });
  await page.getByTestId("reindex-memories").click();
  await expect(page.getByTestId("memory-reindex-result")).toContainText("Reindexed", { timeout: slowTimeout });
  const adminBalance = await readBalance();
  await page.getByTestId("adjust-delta").fill(String(-adminBalance));
  await page.getByTestId("submit-adjustment").click();
  await expect(page.getByTestId("last-adjustment")).toContainText("balance 0");

  await page.getByTestId("nav-game").click();
  await expect(page.getByTestId("sp-balance")).toContainText("0");
  await page.getByTestId("turn-input").fill("広場で第三の行動を試す");
  await page.getByTestId("submit-turn").click();
  await expect(page.getByTestId("error-banner")).toContainText("Insufficient SP balance", { timeout: 15_000 });
});
