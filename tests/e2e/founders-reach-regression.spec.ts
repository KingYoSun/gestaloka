import { expect, test } from "@playwright/test";

test("login, select founders reach explicitly, and keep the founders regression flow green", async ({ page }) => {
  test.setTimeout(420_000);
  const worldId = `e2e-founders-${Date.now()}`;
  const slowTimeout = 30_000;

  const readBalance = async () => {
    const text = await page.getByTestId("sp-balance").textContent();
    const match = text?.match(/SP balance:\s*(-?\d+)/);
    expect(match).not.toBeNull();
    return Number(match?.[1]);
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

  const submitChoice = async (choiceId: "safe" | "progress" | "explore") => {
    await page.getByTestId(`choice-${choiceId}`).click();
    await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: 120_000 });
  };

  const submitFreeText = async (text: string) => {
    await page.getByTestId("toggle-free-text").click();
    await page.getByTestId("turn-input").fill(text);
    await page.getByTestId("submit-turn").click();
    await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: 120_000 });
  };

  await page.goto("/");
  await page.getByTestId("sign-in").click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByTestId("auth-status")).toContainText("authenticated");
  await expect(page.getByTestId("sp-balance")).toContainText(/SP balance:\s*-?\d+/, { timeout: slowTimeout });
  await expect(page.getByTestId("sp-budget-note")).toContainText("execution budget");

  await page.getByTestId("pack-select").selectOption("founders_reach");
  await page.getByTestId("template-select").selectOption("founders_reach");
  await page.getByTestId("world-id-input").fill(worldId);
  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("socket-status")).toContainText("open", { timeout: 20_000 });
  await expect(page.getByTestId("session-pack")).toContainText("Founders Reach", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).toContainText("session.connected", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).toContainText("Founders Reach", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).not.toContainText("missing world context");
  await expect(page.getByTestId("ops-stream")).not.toContainText("global");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Founders Square/i, { timeout: 20_000 });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/opening|Founders/i, { timeout: 20_000 });
  await expect(page.getByTestId("current-scene-summary")).toContainText(/Square|request/i, { timeout: 20_000 });
  await expect(page.getByTestId("active-quest")).toContainText("First Watch Request", { timeout: 20_000 });
  await expect(page.getByTestId("quest-progress")).toContainText("0/2", { timeout: 20_000 });
  await expect(page.getByTestId("local-figures-stream")).toContainText(/Courier Pell/i, { timeout: 20_000 });
  await expect(page.getByTestId("nearby-routes-stream")).toContainText(/Archive Steps/i, { timeout: 20_000 });
  await expect(page.getByTestId("choice-list")).toContainText(/Archive Steps/i, { timeout: 20_000 });

  await submitChoice("explore");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Archive Steps/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-travel-history")).toContainText(/Archive Steps|archive|stone steps/i, {
    timeout: slowTimeout,
  });
  await expect(page.getByTestId("local-figures-stream")).toContainText(/Archivist Nera/i, { timeout: slowTimeout });

  await page.getByTestId("nav-admin").click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByTestId("trigger-idle-pass").click();
  await expect(page.getByTestId("world-tick-stream")).toContainText(/idle_world_pass/i, { timeout: slowTimeout });
  await expect(page.getByTestId("npc-location-stream")).toContainText(/Archivist Nera|Lamplighter Sera|Courier Pell/i, {
    timeout: slowTimeout,
  });
  await expect(page.getByTestId("offstage-beat-stream")).not.toContainText("No offstage beat log loaded.", {
    timeout: slowTimeout,
  });
  await page.getByTestId("nav-game").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("ops-stream")).toContainText("idle.updated", { timeout: slowTimeout });
  await expect(page.getByTestId("ops-stream")).toContainText("Founders Reach", { timeout: slowTimeout });
  await expect(page.getByTestId("ops-stream")).not.toContainText("missing world context");
  await expect(page.getByTestId("ops-stream")).not.toContainText("global");
  await expect(page.getByTestId("npc-locations-stream")).not.toContainText("No wider district movement is visible yet.", {
    timeout: slowTimeout,
  });
  await expect(page.getByTestId("recent-world-beats")).not.toContainText("No wider district beat has risen yet.", {
    timeout: slowTimeout,
  });

  await submitChoice("safe");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Founders Square/i, { timeout: slowTimeout });

  await submitChoice("progress");
  await expect(page.getByTestId("quest-progress")).toContainText("1/2", { timeout: slowTimeout });

  await submitChoice("progress");
  await expect(page.getByTestId("quest-progress")).toContainText("2/2", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("Lantern Sigil", { timeout: slowTimeout });
  await expect(page.getByTestId("relationship-summary")).toContainText(/warm|trust/i, { timeout: slowTimeout });

  await ensureBalanceAtLeast(6);
  await submitChoice("safe");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Founders Square/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-travel-history")).toContainText(/Founders Square|square/i, { timeout: slowTimeout });

  await submitChoice("progress");
  await expect(page.getByTestId("active-quest")).toContainText("Watch Path Unsealed", { timeout: slowTimeout });
  await expect(page.getByTestId("quest-stage")).toContainText("watch_path_followup", { timeout: slowTimeout });
  await expect(page.getByTestId("inventory-stream")).toContainText("used", { timeout: slowTimeout });
  await expect(page.getByTestId("nearby-routes-stream")).toContainText(/Watch Path/i, { timeout: slowTimeout });

  await submitChoice("progress");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Watch Path/i, { timeout: slowTimeout });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/watch path|Lantern Sigil/i, { timeout: slowTimeout });
  await expect(page.getByTestId("local-figures-stream")).toContainText(/Lamplighter Sera/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-travel-history")).toContainText(/Watch Path|watch path|巡回路/i, {
    timeout: slowTimeout,
  });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/watch path/i, { timeout: slowTimeout });

  await ensureBalanceAtLeast(6);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await submitFreeText("Archivist Neraとの約束を守り、Watch OathとしてLantern Sigilの務めを引き受ける");
  }
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/follow-up route|formal oath|watch path/i, {
    timeout: slowTimeout,
  });
  await expect(page.getByTestId("choice-list")).toContainText(/Watch Oath|Lantern Whispers|formal path|rumor/i, {
    timeout: slowTimeout,
  });

  await submitChoice("progress");
  await expect(page.getByTestId("latest-reaction")).toContainText(/watch|巡回|Lantern|Sigil/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-world-beats")).toContainText(/Lamplighter Sera|Watch Path|watch/i, { timeout: slowTimeout });
  await expect(page.getByTestId("recent-scene-history")).not.toContainText("No scene echoes", { timeout: slowTimeout });
});
