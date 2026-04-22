import { expect, test } from "@playwright/test";

test("login, carry relationship pressure across turns, unlock follow-up progression, and keep admin/SP flows separate", async ({ page }) => {
  test.setTimeout(420_000);
  const worldId = `e2e-memory-${Date.now()}`;
  const slowTimeout = 120_000;

  const readBalance = async () => {
    const text = await page.getByTestId("sp-balance").textContent();
    const match = text?.match(/SP balance:\s*(-?\d+)/);
    expect(match).not.toBeNull();
    return Number(match?.[1]);
  };

  const readTurnSnapshot = async () => {
    const [progressText, inventoryText, consequenceText, narrativeText, eventsText, opsText, balance] = await Promise.all([
      page.getByTestId("quest-progress").textContent(),
      page.getByTestId("inventory-stream").textContent(),
      page.getByTestId("last-consequence-summary").textContent(),
      page.getByTestId("latest-narrative").textContent(),
      page.getByTestId("events-stream").textContent(),
      page.getByTestId("ops-stream").textContent(),
      readBalance(),
    ]);
    return `${progressText ?? ""}|${inventoryText ?? ""}|${consequenceText ?? ""}|${narrativeText ?? ""}|${eventsText ?? ""}|${opsText ?? ""}|${balance}`;
  };

  const ensureBalanceAtLeast = async (minimum: number) => {
    const balance = await readBalance();
    if (balance >= minimum) {
      return;
    }
    await page.getByTestId("nav-admin").click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByTestId("adjust-delta").fill(String(Math.max(10, minimum) - balance));
    await page.getByTestId("submit-adjustment").click();
    await expect.poll(readBalance, { timeout: slowTimeout }).toBeGreaterThanOrEqual(minimum);
    await page.getByTestId("nav-game").click();
    await expect(page).toHaveURL(/\/$/);
  };

  const submitChoiceAndWaitForMutation = async (choiceId: "safe" | "progress" | "explore") => {
    const beforeSnapshot = await readTurnSnapshot();
    await page.getByTestId(`choice-${choiceId}`).click();
    await expect.poll(readTurnSnapshot, { timeout: slowTimeout }).not.toBe(beforeSnapshot);
  };

  const submitFreeTextAndWaitForMutation = async (text: string) => {
    await page.getByTestId("toggle-free-text").click();
    await page.getByTestId("turn-input").fill(text);
    await expect(page.getByTestId("submit-turn")).toBeEnabled({ timeout: slowTimeout });
    const beforeSnapshot = await readTurnSnapshot();
    await page.getByTestId("submit-turn").click();
    await expect.poll(readTurnSnapshot, { timeout: slowTimeout }).not.toBe(beforeSnapshot);
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
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/opening|Founders Reach|chapter/i, { timeout: 20_000 });
  await expect(page.getByTestId("current-scene-summary")).toContainText(/square|scene|request/i, { timeout: 20_000 });
  await expect(page.getByTestId("quest-progress")).toContainText("0/2", { timeout: 20_000 });
  await expect(page.getByTestId("choice-list")).toContainText("困っている相手", { timeout: 20_000 });
  await expect(page.getByTestId("relationship-summary")).toContainText(/Archivist|Nera|trust|ordinary|neutral/i, {
    timeout: 20_000,
  });

  await submitChoiceAndWaitForMutation("progress");

  await expect(page.getByTestId("latest-narrative")).not.toContainText("No turn resolved yet.", { timeout: slowTimeout });
  await expect(page.getByTestId("memories-stream").locator("li").first()).toBeVisible({ timeout: slowTimeout });
  await expect(page.getByTestId("ops-stream")).toContainText("intent_interpretation", { timeout: slowTimeout });
  await expect(page.getByTestId("ops-stream")).toContainText("choice_generation", { timeout: slowTimeout });
  await expect(page.getByTestId("sp-balance")).toContainText("9", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-progress")).toContainText("1/2", { timeout: slowTimeout });
  await expect(page.getByTestId("faction-standing")).toContainText("Founders Watch");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const progressText = await page.getByTestId("quest-progress").textContent();
    const inventoryText = await page.getByTestId("inventory-stream").textContent();
    if (progressText?.includes("2/2") && inventoryText?.includes("Lantern Sigil")) {
      break;
    }
    await submitChoiceAndWaitForMutation("progress");
  }
  await expect(page.getByTestId("latest-reaction")).not.toContainText("No NPC reaction yet.", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-progress")).toContainText("2/2", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("Lantern Sigil", { timeout: slowTimeout });
  await expect(page.getByTestId("relationship-summary")).toContainText(/warm|trust/i, { timeout: slowTimeout });
  await ensureBalanceAtLeast(7);
  const afterRewardBalance = await readBalance();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const beforeBalance = await readBalance();
    await submitFreeTextAndWaitForMutation("今は行かない。あとで約束には応える。");
    const recentHistory = (await page.getByTestId("recent-consequence-history").textContent()) ?? "";
    const afterBalance = await readBalance();
    if (afterBalance === beforeBalance - 3 && /promise|約束|square/i.test(recentHistory)) {
      break;
    }
  }
  await expect.poll(readBalance, { timeout: slowTimeout }).toBe(afterRewardBalance - 3);
  await expect(page.getByTestId("last-consequence-summary")).not.toContainText("The scene is waiting", { timeout: slowTimeout });
  await expect(page.getByTestId("undercurrents-stream")).not.toContainText("No unresolved undercurrents", { timeout: slowTimeout });
  await expect(page.getByTestId("recent-consequence-history")).toContainText(/promise|約束|square/i, { timeout: slowTimeout });
  const afterPromiseDelayBalance = await readBalance();

  await submitChoiceAndWaitForMutation("progress");
  await expect.poll(readBalance, { timeout: slowTimeout }).toBe(afterPromiseDelayBalance - 1);
  await expect(page.getByTestId("active-quest")).toContainText("Watch Path Unsealed", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-stage")).toContainText("watch_path_followup", { timeout: slowTimeout });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/watch path|Lantern Sigil/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-scene-history")).not.toContainText("No scene echoes", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("used", { timeout: slowTimeout });
  const afterSigilUseBalance = await readBalance();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const beforeBalance = await readBalance();
    await submitFreeTextAndWaitForMutation("Lantern Sigilで開いた watch path の様子を観察する");
    const latestReaction = (await page.getByTestId("latest-reaction").textContent()) ?? "";
    const afterBalance = await readBalance();
    if (afterBalance === beforeBalance - 3 && /Lantern|Sigil|watch|巡回|見回|灯/.test(latestReaction)) {
      break;
    }
  }
  await expect(page.getByTestId("latest-reaction")).not.toContainText("No NPC reaction yet.", { timeout: slowTimeout });
  await expect(page.getByTestId("latest-reaction")).toContainText(/Lantern|Sigil|watch|巡回|見回|灯/, { timeout: slowTimeout });
  await expect.poll(readBalance, { timeout: slowTimeout }).toBe(afterSigilUseBalance - 3);
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
  await expect(page.getByTestId("relationship-ops-stream")).toContainText(/Archivist|Nera/i);
  await expect(page.getByTestId("consequence-thread-stream")).toContainText(/promise|resolved|cooling|active/i);
  await expect(page.getByTestId("chapter-timeline-stream")).toContainText(/founders_watch_opening|watch_path_followup/i);
  await expect(page.getByTestId("scene-timeline-stream")).toContainText(/establish|reveal|active|closed|cooling/i);
  let adminBalance = await readBalance();
  for (let attempt = 0; attempt < 12 && adminBalance > 0; attempt += 1) {
    const before = adminBalance;
    await page.getByTestId("adjust-delta").fill("-1");
    await page.getByTestId("submit-adjustment").click();
    await expect.poll(readBalance, { timeout: slowTimeout }).toBeLessThan(before);
    adminBalance = await readBalance();
  }

  await page.getByTestId("nav-game").click();
  await expect(page.getByTestId("sp-balance")).toContainText("0", { timeout: slowTimeout });
  await page.getByTestId("choice-progress").click();
  await expect(page.getByTestId("error-banner")).toContainText("Insufficient SP balance", { timeout: 15_000 });
});
