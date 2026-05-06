import { expect, test } from "@playwright/test";

const adminBaseURL = process.env.ADMIN_PLAYWRIGHT_BASE_URL ?? "http://localhost:5174";
const choiceButtonSelector = 'button[data-testid^="suggested-action-"]';
const sceneContextSummarySelector = '[data-testid="current-chapter-summary"], [data-testid="current-scene-summary"]';

type ProgressPhaseCollector = {
  completedPhases: () => string[];
  completedPhaseSequences: () => Promise<string[][]>;
  resolvedTurns: () => TurnResolvedPayload[];
};

type TurnResolvedPayload = {
  turn_id?: unknown;
  entity_updates?: unknown;
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

function collectTurnProgressAndResolved(page: import("@playwright/test").Page): ProgressPhaseCollector {
  const completedPhases: string[] = [];
  const completedPhasesByTurn = new Map<string, string[]>();
  const resolvedTurns: TurnResolvedPayload[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload.toString();
      try {
        const message = JSON.parse(text) as {
          event?: unknown;
          data?: TurnResolvedPayload & { phase?: unknown; status?: unknown; turn_id?: unknown };
        };
        const phase = typeof message.data?.phase === "string" ? message.data.phase : "";
        const turnId = typeof message.data?.turn_id === "string" ? message.data.turn_id : "";
        if (message.event === "turn.progress" && message.data?.status === "completed" && phase) {
          completedPhases.push(phase);
          if (turnId) {
            completedPhasesByTurn.set(turnId, [...(completedPhasesByTurn.get(turnId) ?? []), phase]);
          }
        }
        if (message.event === "turn.resolved" && message.data && typeof message.data === "object") {
          resolvedTurns.push(message.data);
        }
      } catch {
        // Non-JSON websocket frames are irrelevant to turn progress.
      }
    });
  });
  return {
    completedPhases: () => [...completedPhases],
    completedPhaseSequences: async () => {
      const opsText = await page.getByTestId("ops-stream").innerText().catch(() => "");
      return [
        ...[...completedPhasesByTurn.values()].map((phases) => [...phases]),
        ...completedPhaseSequencesFromOpsStream(opsText),
      ];
    },
    resolvedTurns: () => [...resolvedTurns],
  };
}

const stateApplicationPhases = [
  "world_tag_updates",
  "state_draft_materialization",
  "consequence_resolution",
  "scene_framing",
  "memory_materialization",
  "shared_consequence",
  "post_state_build",
];

async function expectAiGmBeforeStateApplication(collector: ProgressPhaseCollector): Promise<void> {
  let completedPhases: string[] = [];
  await expect
    .poll(
      async () => {
        completedPhases = findCompletedPhaseSequence(
          await collector.completedPhaseSequences(),
          hasAiGmBeforeStateApplication,
        );
        return completedPhases.length > 0;
      },
      { timeout: 30_000, message: "ai_gm_turn should complete before state application" },
    )
    .toBe(true);
  const aiGmIndex = completedPhases.indexOf("ai_gm_turn");
  const firstStateIndex = completedPhases.findIndex((phase) => stateApplicationPhases.includes(phase));
  expect(aiGmIndex).toBeGreaterThanOrEqual(0);
  expect(firstStateIndex).toBeGreaterThan(aiGmIndex);
}

async function expectPublicStateApplicationCompleted(collector: ProgressPhaseCollector): Promise<void> {
  let completedPhases: string[] = [];
  await expect
    .poll(
      async () => {
        completedPhases = findCompletedPhaseSequence(
          await collector.completedPhaseSequences(),
          hasPublicStateApplicationCompleted,
        );
        return completedPhases.length > 0;
      },
      { timeout: 30_000, message: "public state application phases should complete" },
    )
    .toBe(true);
  for (const phase of ["world_tag_updates", "state_draft_materialization", "consequence_resolution", "scene_framing", "memory_materialization", "post_state_build"]) {
    expect(completedPhases).toContain(phase);
  }
  expect(completedPhases.indexOf("world_tag_updates")).toBeLessThan(completedPhases.indexOf("post_state_build"));
}

async function expectResolvedTurnEntityUpdatesArray(collector: ProgressPhaseCollector): Promise<void> {
  let resolvedTurns: TurnResolvedPayload[] = [];
  await expect
    .poll(
      () => {
        resolvedTurns = collector.resolvedTurns();
        return resolvedTurns.some((turn) => Array.isArray(turn.entity_updates));
      },
      { timeout: 30_000, message: "turn.resolved should include entity_updates array" },
    )
    .toBe(true);
}

function hasAiGmBeforeStateApplication(completedPhases: string[]): boolean {
  const aiGmIndex = completedPhases.indexOf("ai_gm_turn");
  const firstStateIndex = completedPhases.findIndex((phase) => stateApplicationPhases.includes(phase));
  return aiGmIndex >= 0 && firstStateIndex > aiGmIndex;
}

function hasPublicStateApplicationCompleted(completedPhases: string[]): boolean {
  return ["world_tag_updates", "state_draft_materialization", "consequence_resolution", "scene_framing", "memory_materialization", "post_state_build"].every(
    (phase) => completedPhases.includes(phase),
  );
}

function findCompletedPhaseSequence(
  completedPhaseSequences: string[][],
  predicate: (completedPhases: string[]) => boolean,
): string[] {
  return completedPhaseSequences.find((completedPhases) => predicate(completedPhases)) ?? [];
}

function completedPhaseSequencesFromOpsStream(text: string): string[][] {
  const progressChunks = text
    .split("turn.progress")
    .slice(1)
    .map((chunk) => `turn.progress${chunk}`)
    .reverse();
  const phasesByTurn = new Map<string, string[]>();
  for (const chunk of progressChunks) {
    if (valueAfterKey(chunk, "status") !== "completed") {
      continue;
    }
    const turnId = valueAfterKey(chunk, "turn_id");
    const phase = valueAfterKey(chunk, "phase");
    if (!turnId || !phase) {
      continue;
    }
    phasesByTurn.set(turnId, [...(phasesByTurn.get(turnId) ?? []), phase]);
  }
  return [...phasesByTurn.values()];
}

function valueAfterKey(text: string, key: string): string {
  const match = new RegExp(`\\b${key}: ([^/\\n]+)`, "i").exec(text);
  return match?.[1]?.trim() ?? "";
}

async function expectVisibleSceneContextSummary(page: import("@playwright/test").Page, timeout: number): Promise<void> {
  await expect(page.locator(sceneContextSummarySelector).first()).toContainText(/\S/, { timeout });
}

async function submitFreeTextTurn(page: import("@playwright/test").Page, text: string): Promise<void> {
  const input = page.getByTestId("turn-input");
  if (!(await input.isVisible().catch(() => false))) {
    await page.getByTestId("toggle-free-text").click();
  }
  await expect(input).toBeVisible({ timeout: 60_000 });
  await expect(input).toBeEnabled({ timeout: 60_000 });
  await input.fill(text);
  await expect(page.getByTestId("submit-turn")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("submit-turn").click();
}

async function waitForTurnReady(page: import("@playwright/test").Page, timeout: number): Promise<void> {
  await expect(page.getByTestId("turn-progress-status")).toContainText("選択待ち", { timeout });
  await expect(page.getByTestId("toggle-free-text")).toBeEnabled({ timeout });
}

test("login, select GESTALOKA reference world, and clear the nexus smoke flow", async ({ page }) => {
  test.setTimeout(360_000);
  const worldId = "gestaloka_world_reference";
  const slowTimeout = 30_000;
  const turnTimeout = 180_000;
  const progressPhases = collectTurnProgressAndResolved(page);

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
  await expect(page.getByTestId("active-quest")).toContainText(/Visitor Log Registration|来訪者ログ登録/, { timeout: 20_000 });
  await expect(page.getByTestId("quest-progress")).toContainText("0/2", { timeout: 20_000 });
  await expect(page.getByTestId("local-figures-stream")).toContainText(/Nexus Entry Liaison Kanata/i, { timeout: 20_000 });
  await expect(page.getByTestId("nearby-routes-stream")).toContainText(/Universal Library/i, { timeout: 20_000 });
  await expect(page.getByTestId("faction-standing")).toContainText(/Nexus City/i, { timeout: 20_000 });
  await expect(page.getByTestId("turn-progress-status")).toContainText("選択待ち");
  await expect(page.getByTestId("turn-cost-note")).toContainText(/消費SP|Choice cost|SP/);
  await page.getByTestId("toggle-free-text").click();
  await expect(page.getByTestId("turn-cost-note")).toContainText(/自由入力|Free input|SP/);
  await page.getByTestId("toggle-choice-mode").click();
  await expect(page.locator(choiceButtonSelector).filter({ hasText: /Check your arrival log at the public Nexus registry/ })).toBeVisible();
  await expect(page.locator(choiceButtonSelector).filter({ hasText: /Go to the lift tower network and inspect recruiters and route logs/ })).toBeVisible();
  await expect(page.locator(choiceButtonSelector).filter({ hasText: /Go to the Universal Library and compare old records with your visitor log/ })).toBeVisible();

  await submitFreeTextTurn(page, "Help Kanata advance Visitor Log Registration by assisting the public witness hall procedure.");
  await expect(page.getByTestId("turn-progress-status")).toContainText("進行中", { timeout: 5_000 });
  await waitForTurnReady(page, turnTimeout);
  await expectAiGmBeforeStateApplication(progressPhases);
  await expectPublicStateApplicationCompleted(progressPhases);
  await expectResolvedTurnEntityUpdatesArray(progressPhases);
  await expectVisibleSceneContextSummary(page, slowTimeout);
  await expect(page.getByTestId("active-quest")).not.toContainText("Exploring...");
  await expect(page.getByTestId("quest-progress")).toContainText("1/2", { timeout: slowTimeout });
  await expect(page.getByTestId("active-quest")).not.toContainText(/dynamic_quest_|followup_quest_|\bdynamic\b/i);
  await expect(page.getByTestId("quest-stage")).toHaveText("");
  await expect(page.getByTestId("quest-stage")).toHaveAttribute("data-value", /\S/);
  await expect(page.getByTestId("quest-unlock-requirements")).toHaveText("");
  await expect(page.getByTestId("quest-unlock-requirements")).toHaveAttribute("data-value", /\S/);

  await submitFreeTextTurn(page, "Complete and confirm Visitor Log Registration at the public witness hall, then report it to Kanata.");
  await expect(page.getByTestId("turn-progress-status")).toContainText("進行中", { timeout: 5_000 });
  await expect(page.getByTestId("quest-completion-dialog")).toBeVisible({ timeout: turnTimeout });
  await expectVisibleSceneContextSummary(page, slowTimeout);
  await expect(page.getByTestId("quest-completion-dialog")).toContainText(/Visitor Log|来訪者ログ|Seal|印/, { timeout: slowTimeout });
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
  await expect(page.getByTestId("active-quest")).toContainText(/来訪者ログ登録|Visitor Log Registration/, { timeout: 20_000 });
  await expect(page.getByTestId("quest-progress")).toContainText("0/2", { timeout: 20_000 });
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
