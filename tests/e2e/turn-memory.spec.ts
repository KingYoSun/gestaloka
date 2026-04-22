import { expect, test } from "@playwright/test";

test("login, progress a starter quest, receive a reward item, and keep admin/SP flows working", async ({ page }) => {
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
  await expect(page.getByTestId("active-quest")).toContainText("First Watch Request");
  await expect(page.getByTestId("quest-progress")).toContainText("0/2");

  await page.getByTestId("turn-input").fill("広場で旅人を助け、灯をともす");
  await page.getByTestId("submit-turn").click();

  await expect(page.getByTestId("latest-narrative")).toContainText(/world_tags=/i);
  await expect(page.getByTestId("memories-stream")).toContainText("旅人を助け");
  await expect(page.getByTestId("ops-stream")).toContainText("memory_council");
  await expect(page.getByTestId("ops-stream")).toContainText("narrative");
  await expect(page.getByTestId("sp-balance")).toContainText("9");
  await expect(page.getByTestId("quest-progress")).toContainText("1/2");
  await expect(page.getByTestId("faction-standing")).toContainText("Founders Watch");

  await page.getByTestId("nav-admin").click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId("ops-status")).toContainText("ready");
  await expect(page.getByTestId("graph-faction-count")).toContainText("1");
  await expect(page.getByTestId("graph-quest-count")).toContainText("1");
  await expect(page.getByTestId("admin-ledger")).toContainText("turn_cost");
  await expect(page.getByTestId("council-trace-stream")).toContainText("memory_manager");
  await expect(page.getByTestId("council-trace-stream")).toContainText("narrative");
  await page.getByTestId("run-eval-smoke").click();
  await expect(page.getByTestId("eval-runs-stream")).toContainText("turn_resolution_smoke");
  await expect(page.getByTestId("observability-summary")).toContainText("Lag:");
  await expect(page.getByTestId("canary-health-status")).toContainText(/Canary:/);
  await page.getByTestId("run-release-checklist").click();
  await expect(page.getByTestId("release-gate-verdict")).toContainText(/blocked|passed/);
  await expect(page.getByTestId("release-runbook")).toContainText("promote");

  await page.getByTestId("adjust-delta").fill("2");
  await page.getByTestId("submit-adjustment").click();
  await expect(page.getByTestId("last-adjustment")).toContainText("balance 11");

  await page.getByTestId("nav-game").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("sp-balance")).toContainText("11");

  await page.getByTestId("turn-input").fill("旅人へ報告し、広場を見回して次の見回りを約束する");
  await page.getByTestId("submit-turn").click();
  await expect(page.getByTestId("latest-reaction")).toContainText("旅人を助け");
  await expect(page.getByTestId("sp-balance")).toContainText("10");
  await expect(page.getByTestId("quest-progress")).toContainText("2/2");
  await expect(page.getByTestId("inventory-stream")).toContainText("Lantern Sigil");

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
