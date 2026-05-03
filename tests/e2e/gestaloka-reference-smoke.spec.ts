import { expect, test } from "@playwright/test";

const adminBaseURL = process.env.ADMIN_PLAYWRIGHT_BASE_URL ?? "http://localhost:5174";

type ProgressPhaseCollector = {
  completedPhases: () => string[];
};

async function openCharacterCreation(page: import("@playwright/test").Page, worldId: string): Promise<void> {
  await expect(page.getByTestId("continue-to-character")).toBeDisabled({ timeout: 60_000 });
  await page.getByTestId(`world-card-${worldId}`).click();
  await expect(page.getByTestId("continue-to-character")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("continue-to-character").click();
  const createCard = page.getByTestId("create-character-card");
  if (await createCard.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await createCard.click();
  }
  await expect(page.getByTestId("profile-display-name")).toBeVisible({ timeout: 30_000 });
}

function collectCompletedProgressPhases(page: import("@playwright/test").Page): ProgressPhaseCollector {
  const completedPhases: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload.toString();
      try {
        const message = JSON.parse(text) as { event?: unknown; data?: { phase?: unknown; status?: unknown } };
        const phase = typeof message.data?.phase === "string" ? message.data.phase : "";
        if (message.event === "turn.progress" && message.data?.status === "completed" && phase) {
          completedPhases.push(phase);
        }
      } catch {
        // Non-JSON websocket frames are irrelevant to turn progress.
      }
    });
  });
  return { completedPhases: () => [...completedPhases] };
}

async function expectSituationMappingBeforeWorldProgress(collector: ProgressPhaseCollector): Promise<void> {
  let completedPhases: string[] = [];
  await expect
    .poll(
      () => {
        completedPhases = collector.completedPhases();
        return hasSituationMappingBeforeWorldProgress(completedPhases);
      },
      { timeout: 30_000, message: "situation_mapping should complete before world_progress" },
    )
    .toBe(true);
  expect(completedPhases).toContain("situation_mapping");
  expect(completedPhases).toContain("world_progress");
  expect(completedPhases.indexOf("situation_mapping")).toBeLessThan(completedPhases.indexOf("world_progress"));
}

function hasSituationMappingBeforeWorldProgress(completedPhases: string[]): boolean {
  const situationIndex = completedPhases.indexOf("situation_mapping");
  const worldProgressIndex = completedPhases.indexOf("world_progress");
  return situationIndex >= 0 && worldProgressIndex >= 0 && situationIndex < worldProgressIndex;
}

test("login, select GESTALOKA reference world, and clear the nexus smoke flow", async ({ page }) => {
  test.setTimeout(360_000);
  const worldId = "gestaloka_world_reference";
  const slowTimeout = 30_000;
  const turnTimeout = 180_000;

  await page.goto("/");
  await expect(page.getByTestId("error-banner").filter({ hasText: "A 'Keycloak' instance can only be initialized once." })).toHaveCount(0);
  await page.getByTestId("sign-in").click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByTestId("auth-status")).toContainText("authenticated");
  await expect(page.getByTestId("error-banner").filter({ hasText: "A 'Keycloak' instance can only be initialized once." })).toHaveCount(0);
  await expect(page.getByTestId("sp-balance")).toContainText(/SP balance:\s*-?\d+/, { timeout: slowTimeout });
  await expect(page.getByTestId("sp-balance")).toContainText(/Paid:\s*-?\d+/, { timeout: slowTimeout });
  await expect(page.getByTestId("sp-balance")).toContainText(/Bonus:\s*-?\d+/, { timeout: slowTimeout });
  await expect(page.getByTestId("sp-budget-note")).toContainText("execution budget");

  await openCharacterCreation(page, worldId);
  await page.getByTestId("profile-display-name").fill("Demo Player");
  await page.getByTestId("profile-play-language").selectOption("en");
  await page.getByTestId("create-player-profile").click();
  await expect(page.getByRole("button", { name: /Demo Player/ })).toBeVisible({ timeout: slowTimeout });
  await expect(page.getByTestId("start-session")).toBeEnabled({ timeout: slowTimeout });
  const progressPhases = collectCompletedProgressPhases(page);
  await page.getByTestId("start-session").click();

  await expect(page.getByTestId("socket-status")).toContainText("open", { timeout: 20_000 });
  await expect(page.getByTestId("session-pack")).toContainText("GESTALOKA World Reference", { timeout: 20_000 });
  await expect(page.getByTestId("session-pack")).toContainText("Layered World Foundation", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).toContainText("session.connected", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).toContainText("GESTALOKA World Reference", { timeout: 20_000 });
  await expect(page.getByTestId("ops-stream")).not.toContainText("missing world context");
  await expect(page.getByTestId("ops-stream")).not.toContainText("global");
  await expect(page.getByTestId("ops-stream")).not.toContainText("{");
  await expect(page.getByTestId("npc-routine-stream")).not.toContainText("{");
  await expect(page.getByTestId("current-place-summary")).toContainText(/Nexus City/i, { timeout: 20_000 });
  await expect(page.getByTestId("active-quest")).toContainText("Exploring...", { timeout: 20_000 });
  await expect(page.getByTestId("local-figures-stream")).toContainText(/Nexus Entry Liaison/i, { timeout: 20_000 });
  await expect(page.getByTestId("nearby-routes-stream")).toContainText(/Universal Library/i, { timeout: 20_000 });
  await expect(page.getByTestId("faction-standing")).toContainText(/Nexus City/i, { timeout: 20_000 });
  await expect(page.getByTestId("turn-progress-status")).toContainText("選択待ち");
  await expect(page.getByTestId("turn-cost-note")).toContainText(/消費SP|Choice cost|SP/);
  await page.getByTestId("toggle-free-text").click();
  await expect(page.getByTestId("turn-cost-note")).toContainText(/自由入力|Free input|SP/);
  await page.getByTestId("toggle-choice-mode").click();
  await expect(page.getByTestId("choice-progress")).toContainText("Help Rikka steady the disturbed arrival record");
  await expect(page.getByTestId("choice-explore")).toContainText("Go upstairs and learn how the city keeps records");

  await page.getByTestId("choice-progress").click();
  await expect(page.getByTestId("turn-progress-status")).toContainText("進行中", { timeout: 5_000 });
  await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: turnTimeout });
  await expectSituationMappingBeforeWorldProgress(progressPhases);
  const offerDialog = page.getByTestId("quest-offer-dialog");
  await expect(offerDialog).toBeVisible({ timeout: slowTimeout });
  const ignoredTurnRequest = page
    .waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/turns", { timeout: 1_000 })
    .then(() => true)
    .catch(() => false);
  await offerDialog.getByRole("button", { name: /^(Ignore|無視)$/i }).click();
  await expect(offerDialog).toBeHidden({ timeout: slowTimeout });
  expect(await ignoredTurnRequest).toBe(false);

  await page.getByTestId("quest-list-open").click();
  await expect(page.getByTestId("quest-list-dialog")).toBeVisible({ timeout: slowTimeout });
  await expect(page.getByTestId("quest-list-dialog")).not.toContainText(/dynamic_quest_|followup_quest_|\bdynamic\b/i);
  await expect(page.getByTestId("quest-list-dialog").getByRole("button", { name: /^(Accept|受諾)$/i })).toBeVisible({
    timeout: slowTimeout,
  });
  await page.getByTestId("quest-list-dialog").getByRole("button", { name: /^(Accept|受諾)$/i }).click();
  await expect(page.getByTestId("turn-progress-status")).toContainText("進行中", { timeout: 5_000 });
  await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: turnTimeout });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/\S/, { timeout: slowTimeout });
  await expect(page.getByTestId("active-quest")).not.toContainText("Exploring...");
  await expect(page.getByTestId("quest-progress")).toContainText(/\d+\/\d+/, { timeout: slowTimeout });
  await expect(page.getByTestId("active-quest")).not.toContainText(/dynamic_quest_|followup_quest_|\bdynamic\b/i);
  await expect(page.getByTestId("quest-stage")).toHaveText("");
  await expect(page.getByTestId("quest-stage")).toHaveAttribute("data-value", /\S/);
  await expect(page.getByTestId("quest-unlock-requirements")).toHaveText("");
  await expect(page.getByTestId("quest-unlock-requirements")).toHaveAttribute("data-value", /\S/);

  await page.getByTestId("choice-progress").click();
  await expect(page.getByTestId("turn-progress-status")).toContainText("進行中", { timeout: 5_000 });
  await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: turnTimeout });
  await expect(page.getByTestId("current-chapter-summary")).toContainText(/\S/, { timeout: slowTimeout });
  await expect(page.getByTestId("active-quest")).toContainText(/\d+\/\d+/, { timeout: slowTimeout });
});

test("mobile player shell does not overflow at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await expect(page.getByTestId("sign-in")).toBeVisible();
  await expect(page.getByRole("button", { name: "アカウントを作成して始める" })).toBeVisible();
  await expect(page.getByTestId("error-banner").filter({ hasText: "A 'Keycloak' instance can only be initialized once." })).toHaveCount(0);

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
});

test("mobile player drawers expose actions and status", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("sign-in").click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await openCharacterCreation(page, "gestaloka_world_reference");
  await page.getByTestId("profile-display-name").fill(`Mobile Player ${Date.now()}`);
  await page.getByTestId("profile-play-language").selectOption("ja");
  await page.getByTestId("create-player-profile").click();
  await expect(page.getByTestId("start-session")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("start-session").click();

  await expect(page.getByTestId("story-scroll")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "行動" }).click();
  await expect(page.getByTestId("choice-list")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "閉じる" }).click();

  await page.getByRole("button", { name: "情報" }).click();
  await expect(page.getByTestId("active-quest")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("active-quest")).toContainText("探索中...", { timeout: 20_000 });
  await expect(page.getByTestId("local-figures-stream")).toBeVisible();
  await expect(page.getByTestId("nearby-routes-stream")).toBeVisible();
  await expect(page.getByTestId("inventory-stream")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
});

test("player language switcher changes fixed UI labels and persists", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("sign-in")).toContainText("ログインして続ける");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");

  await page.getByRole("button", { name: /EN/ }).click();
  await expect(page.getByTestId("sign-in")).toContainText("Sign in to continue");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.reload();
  await expect(page.getByTestId("sign-in")).toContainText("Sign in to continue");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByRole("button", { name: /JA/ }).click();
  await expect(page.getByTestId("sign-in")).toContainText("ログインして続ける");
});

test("admin unauthenticated language switcher changes labels and persists", async ({ page }) => {
  await page.goto(adminBaseURL);

  await expect(page.getByTestId("admin-sign-in")).toContainText("ログイン");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");

  await page.getByRole("button", { name: /EN/ }).click();
  await expect(page.getByTestId("admin-sign-in")).toContainText("Sign in");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.reload();
  await expect(page.getByTestId("admin-sign-in")).toContainText("Sign in");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("admin release page does not overflow at 375px", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(adminBaseURL);
  await page.getByTestId("admin-sign-in").click();

  await page.locator("#username").fill("demo");
  await page.locator("#password").fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByTestId("admin-nav-release")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("admin-nav-release").click();
  await expect(page.getByTestId("admin-release")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("admin-release-blocked-reasons")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
});
