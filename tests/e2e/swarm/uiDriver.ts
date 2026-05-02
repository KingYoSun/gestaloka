import { expect, type Page, type Response } from "@playwright/test";

import type { DerivedPlayerProfile } from "./playerProfiles";
import type { SwarmDecision } from "./playbook";
import type { AssignedSwarmUserPersona } from "./userPersonas";

export type SwarmViewportProfile = {
  kind: "desktop" | "mobile";
  width: number;
  height: number;
};

export type SwarmUiTurnObservation = {
  personaId: string;
  scenario: SwarmDecision["scenario"];
  inputMode: SwarmDecision["inputMode"];
  action: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  httpDurationMs: number;
  finalResolutionDurationMs: number;
  eventId: string;
  turnId: string;
  waitStatusSamples: string[];
  waitStatusTimeline: Array<{ elapsedSeconds: number; status: string }>;
  progressTimeline: Array<{
    phase: string;
    status: string;
    elapsedMs: number | null;
    roleElapsedMs: number | null;
  }>;
  lastWaitStatus: string;
  maxWaitElapsedSeconds: number;
  latestNarrative: string;
  latestReaction: string;
  latestConsequence: string;
  recentSceneHistory: string[];
  recentConsequenceHistory: string[];
  recentWorldBeats: string[];
  opsStream: string[];
  choiceLabels: string[];
  playInfoTexts: string[];
  englishPlayInfoTexts: string[];
  questText: string;
  questProgress: string;
  chapterText: string;
  questActionLabels: string[];
  hasExploringLabel: boolean;
  hasOfferedQuest: boolean;
  hasChapterSummary: boolean;
  screenshotPath?: string;
};

export type SwarmUiSessionObservation = {
  personaId: string;
  sessionId: string;
  locationId: string;
  startedAt: string;
};

export type SwarmUiQuestSnapshot = {
  questText: string;
  questProgress: string;
  chapterText: string;
  questActionLabels: string[];
  hasExploringLabel: boolean;
  hasOfferedQuest: boolean;
  hasChapterSummary: boolean;
};

export async function preparePlayerUiForSession(page: Page, profile: DerivedPlayerProfile): Promise<void> {
  await expect(page.getByTestId("continue-to-character")).toBeDisabled({ timeout: 60_000 });
  await page.getByTestId("world-card-gestaloka_reference").click();
  await expect(page.getByTestId("continue-to-character")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("continue-to-character").click();
  await page.getByRole("button", { name: new RegExp(escapeRegExp(profile.displayName)) }).click();
  await expect(page.getByTestId("start-session")).toBeEnabled({ timeout: 30_000 });
}

export async function startPlayerSessionViaUi(
  page: Page,
  persona: AssignedSwarmUserPersona,
): Promise<SwarmUiSessionObservation> {
  const startedAt = new Date().toISOString();
  let response: Response;
  try {
    [response] = await Promise.all([
      waitForSessionResponseOrNetworkFailure(page, persona.id, 120_000),
      page.getByTestId("start-session").click(),
    ]);
  } catch (error) {
    throw new Error(
      `UI session start did not observe /sessions for ${persona.id}: ${errorMessage(error)}; ${await sessionStartDiagnostics(page)}`,
    );
  }
  if (!response.ok()) {
    throw new Error(`UI session start failed for ${persona.id}: ${response.status()} ${await response.text()}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  await waitForSessionUiReady(page, persona.id);
  return {
    personaId: persona.id,
    sessionId: stringValue(payload.session_id),
    locationId: stringValue(payload.location_id),
    startedAt,
  };
}

async function waitForSessionResponseOrNetworkFailure(
  page: Page,
  personaId: string,
  timeout: number,
): Promise<Response> {
  const isSessionPost = (url: string, method: string): boolean => {
    try {
      return method === "POST" && new URL(url).pathname === "/sessions";
    } catch {
      return false;
    }
  };
  const responsePromise = page.waitForResponse(
    (candidate) => isSessionPost(candidate.url(), candidate.request().method()),
    { timeout },
  );
  const requestFailurePromise = page
    .waitForEvent("requestfailed", {
      predicate: (request) => isSessionPost(request.url(), request.method()),
      timeout,
    })
    .then((request): never => {
      const failure = request.failure();
      throw new Error(
        `UI session request failed for ${personaId}: ${failure?.errorText ?? "unknown network failure"}`,
      );
    });
  return Promise.race([responsePromise, requestFailurePromise]);
}

async function sessionStartDiagnostics(page: Page): Promise<string> {
  const [errorBanner, startEnabled, worldValue, worldLabel] = await Promise.all([
    textContent(page, "error-banner"),
    locatorEnabled(page, "start-session"),
    inputValue(page, "world-select"),
    selectedOptionText(page, "world-select"),
  ]);
  return [
    `start-session enabled=${startEnabled}`,
    `world=${worldValue || "(empty)"} ${worldLabel ? `(${worldLabel})` : ""}`,
    `error-banner=${errorBanner || "(empty)"}`,
  ].join("; ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForSessionUiReady(page: Page, personaId: string): Promise<void> {
  try {
    await expect(page.getByTestId("story-scroll")).toBeVisible({ timeout: 60_000 });
    await ensureActionSurface(page);
    await expect(page.getByTestId("choice-progress")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: 60_000 });
    await ensureStatusSurface(page);
    await expect(page.getByTestId("active-quest")).toBeVisible({ timeout: 60_000 });
  } catch (error) {
    throw new Error(
      `UI session did not render a ready play surface for ${personaId}: ${errorMessage(error)}; ${await playSurfaceDiagnostics(page)}`,
    );
  }
}

export async function executeTurnViaUi(
  page: Page,
  persona: AssignedSwarmUserPersona,
  decision: SwarmDecision,
  artifactDir: string,
  attemptLabel: string,
): Promise<SwarmUiTurnObservation> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const waitStatusSamples: string[] = [];
  const waitStatusTimeline: Array<{ elapsedSeconds: number; status: string }> = [];
  const sampleTimer = setInterval(async () => {
    try {
      const status = await page.getByTestId("turn-progress-status").innerText({ timeout: 500 });
      waitStatusSamples.push(status);
      if (status.trim()) {
        waitStatusTimeline.push({
          elapsedSeconds: Math.max(Math.floor((Date.now() - started) / 1000), 0),
          status,
        });
      }
    } catch {
      // Sampling should never change test outcome.
    }
  }, 2_000);

  try {
    const turnTimeoutMs = envInt("SWARM_TURN_TIMEOUT_MS", 600_000);
    let response: Response;
    try {
      [response] = await Promise.all([
        waitForTurnResponseOrNetworkFailure(page, persona.id, turnTimeoutMs),
        submitDecision(page, decision),
      ]);
    } catch (error) {
      throw new Error(
        `UI turn did not observe /turns for ${persona.id}/${decision.scenario}: ${errorMessage(error)}; ${await turnSubmissionDiagnostics(page, decision)}`,
      );
    }
    const responseText = await response.text();
    const payload = parseJsonObject(responseText);
    if (!response.ok() && !(response.status() === 422 && typeof payload.event_id === "string")) {
      throw new Error(`UI turn failed for ${persona.id}: ${response.status()} ${responseText}`);
    }
    const httpCompleted = Date.now();
    await expect(page.getByTestId("turn-progress-status")).toBeVisible({ timeout: 30_000 });
    const acceptedTurnId = stringValue(payload.turn_id);
    if (isAcceptedTurnResponse(response, payload)) {
      await waitForAcceptedTurnFinal(page, acceptedTurnId, turnTimeoutMs);
    }
    await waitForTurnIdle(page);
    const screenshotPath = `${artifactDir}/${attemptLabel}-${persona.id}-${decision.scenario}-after-turn.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const completed = Date.now();
    const nonEmptyWaitStatusSamples = uniqueNonEmpty(waitStatusSamples);
    const opsStream = await listText(page, "ops-stream");
    const playInfoTexts = await playerVisiblePlayInfoTexts(page);
    const questSnapshot = await questSnapshotViaUi(page);
    const eventsStream = await waitForEventsStreamForTurn(page, acceptedTurnId);
    const progressTimeline = progressTimelineFromOpsStream(opsStream);
    return {
      personaId: persona.id,
      scenario: decision.scenario,
      inputMode: decision.inputMode,
      action: decision.questAction ?? decision.choiceId ?? decision.inputText ?? decision.inputMode,
      startedAt,
      completedAt: new Date(completed).toISOString(),
      durationMs: completed - started,
      httpDurationMs: httpCompleted - started,
      finalResolutionDurationMs: completed - started,
      eventId: stringValue(payload.event_id) || eventIdForTurn(eventsStream, acceptedTurnId) || eventIdFromOpsStream(opsStream),
      turnId: acceptedTurnId,
      waitStatusSamples: nonEmptyWaitStatusSamples.slice(0, 16),
      waitStatusTimeline,
      progressTimeline,
      lastWaitStatus: nonEmptyWaitStatusSamples[nonEmptyWaitStatusSamples.length - 1] ?? "",
      maxWaitElapsedSeconds: Math.max(Math.floor((completed - started) / 1000), 0),
      latestNarrative: await textContent(page, "latest-narrative"),
      latestReaction: await textContent(page, "latest-reaction"),
      latestConsequence: await textContent(page, "last-consequence-summary"),
      recentSceneHistory: await listText(page, "recent-scene-history"),
      recentConsequenceHistory: await listText(page, "recent-consequence-history"),
      recentWorldBeats: await listText(page, "recent-world-beats"),
      opsStream,
      choiceLabels: await listText(page, "choice-list"),
      playInfoTexts,
      englishPlayInfoTexts: playInfoTexts.filter(hasEnglishPlayTextResidue).slice(0, 12),
      ...questSnapshot,
      screenshotPath,
    };
  } finally {
    clearInterval(sampleTimer);
  }
}

async function waitForEventsStreamForTurn(page: Page, turnId: string): Promise<string[]> {
  let eventsStream = await listText(page, "events-stream");
  if (!turnId || eventIdForTurn(eventsStream, turnId)) {
    return eventsStream;
  }
  await expect
    .poll(
      async () => {
        eventsStream = await listText(page, "events-stream");
        return Boolean(eventIdForTurn(eventsStream, turnId));
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
  return eventsStream;
}

function eventIdForTurn(items: string[], turnId: string): string {
  if (!turnId) {
    return "";
  }
  const chunks = items.flatMap((item) =>
    item
      .split("event_id:")
      .slice(1)
      .map((chunk) => `event_id:${chunk}`),
  );
  for (const chunk of chunks) {
    if (!chunk.includes(`turn_id: ${turnId}`)) {
      continue;
    }
    const match = /event_id: ([0-9a-f-]{36})/i.exec(chunk);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function progressTimelineFromOpsStream(items: string[]): SwarmUiTurnObservation["progressTimeline"] {
  const progressChunks = items.flatMap((item) =>
    item
      .split("turn.progress")
      .slice(1)
      .map((chunk) => `turn.progress${chunk}`),
  );
  return progressChunks
    .map((item) => {
      const phase = valueAfterKey(item, "phase");
      const status = valueAfterKey(item, "status");
      return {
        phase,
        status,
        elapsedMs: numberAfterKey(item, "elapsed_ms"),
        roleElapsedMs: numberAfterKey(item, "role_elapsed_ms"),
      };
    })
    .filter((item) => item.phase || item.status || item.elapsedMs !== null || item.roleElapsedMs !== null)
    .reverse();
}

function valueAfterKey(text: string, key: string): string {
  const match = new RegExp(`\\b${key}: ([^/\\n]+)`, "i").exec(text);
  return match?.[1]?.trim() ?? "";
}

function numberAfterKey(text: string, key: string): number | null {
  const value = Number(valueAfterKey(text, key));
  return Number.isFinite(value) ? value : null;
}

function eventIdFromOpsStream(items: string[]): string {
  for (const item of items) {
    const match = item.match(/\b(?:event_id|id): ([0-9a-f-]{36})\b/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function isAcceptedTurnResponse(response: Response, payload: Record<string, unknown>): boolean {
  return response.status() === 202 || payload.status === "accepted";
}

async function waitForAcceptedTurnFinal(page: Page, turnId: string, timeout: number): Promise<void> {
  if (!turnId) {
    return;
  }
  const deadline = Date.now() + timeout;
  let opsStream: string[] = [];
  while (Date.now() < deadline) {
    opsStream = await listText(page, "ops-stream");
    const finalStatus = turnFinalStatusFromOpsStream(opsStream, turnId);
    if (finalStatus?.status === "failed") {
      const detail = await textContent(page, "error-banner");
      throw new Error(
        `UI turn background resolution failed for turn_id=${turnId}: ${detail || finalStatus.evidence}`,
      );
    }
    if (finalStatus?.status === "resolved") {
      return;
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(
    `UI turn did not observe turn.resolved or turn.failed for turn_id=${turnId}: ${opsStream.join(" | ") || "(empty ops-stream)"}`,
  );
}

function turnFinalStatusFromOpsStream(
  items: string[],
  turnId: string,
): { status: "resolved" | "failed"; evidence: string } | null {
  for (const chunk of opsEventChunks(items)) {
    if (!chunk.includes(`turn_id: ${turnId}`)) {
      continue;
    }
    if (/turn\.failed/i.test(chunk)) {
      return { status: "failed", evidence: chunk };
    }
    if (/turn\.resolved/i.test(chunk)) {
      return { status: "resolved", evidence: chunk };
    }
  }
  return null;
}

function opsEventChunks(items: string[]): string[] {
  return items.flatMap((item) =>
    item
      .split(/(?=turn\.(?:accepted|progress|provisional|resolved|failed))/i)
      .map((chunk) => chunk.trim())
      .filter(Boolean),
  );
}

async function waitForTurnResponseOrNetworkFailure(
  page: Page,
  personaId: string,
  timeout: number,
): Promise<Response> {
  const isTurnPost = (url: string, method: string): boolean => {
    try {
      return method === "POST" && new URL(url).pathname === "/turns";
    } catch {
      return false;
    }
  };
  const responsePromise = page.waitForResponse(
    (candidate) => isTurnPost(candidate.url(), candidate.request().method()),
    { timeout },
  );
  const requestFailurePromise = page
    .waitForEvent("requestfailed", {
      predicate: (request) => isTurnPost(request.url(), request.method()),
      timeout,
    })
    .then((request): never => {
      const failure = request.failure();
      throw new Error(
        `UI turn request failed for ${personaId}: ${failure?.errorText ?? "unknown network failure"}`,
      );
    });
  return Promise.race([responsePromise, requestFailurePromise]);
}

async function submitDecision(page: Page, decision: SwarmDecision): Promise<void> {
  if (decision.inputMode === "quest_action") {
    await ensureStatusSurface(page);
    await clickQuestAction(page, decision.questAction);
    return;
  }
  await ensureActionSurface(page);
  if (decision.inputMode === "choice") {
    const choice = page.getByTestId(`choice-${decision.choiceId}`);
    await expect(choice).toBeVisible({ timeout: 60_000 });
    await expect(choice).toBeEnabled({ timeout: 60_000 });
    await choice.click();
    return;
  }
  const toggle = page.getByTestId("toggle-free-text");
  await expect(toggle).toBeEnabled({ timeout: 60_000 });
  await toggle.click();
  const input = page.getByTestId("turn-input");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await expect(input).toBeEnabled({ timeout: 60_000 });
  await input.fill(decision.inputText ?? "");
  const submit = page.getByTestId("submit-turn");
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await submit.click();
}

async function ensureActionSurface(page: Page): Promise<void> {
  if (await locatorVisible(page, "toggle-free-text")) {
    return;
  }
  const actionsButton = page.getByRole("button", { name: /^(行動|Actions)$/i });
  if (!(await roleVisible(actionsButton))) {
    return;
  }
  await closeVisibleDrawer(page);
  await actionsButton.click();
  await expect(page.getByTestId("toggle-free-text")).toBeVisible({ timeout: 20_000 });
}

async function ensureStatusSurface(page: Page): Promise<void> {
  if (await locatorVisible(page, "active-quest")) {
    return;
  }
  const statusButton = page.getByRole("button", { name: /^(情報|Info)$/i });
  if (!(await roleVisible(statusButton))) {
    return;
  }
  await closeVisibleDrawer(page);
  await statusButton.click();
  await expect(page.getByTestId("active-quest")).toBeVisible({ timeout: 20_000 });
}

async function closeVisibleDrawer(page: Page): Promise<void> {
  const closeButton = page.getByRole("button", { name: /^(閉じる|Close)$/i }).first();
  if (await roleVisible(closeButton)) {
    await closeButton.click();
  }
}

async function turnSubmissionDiagnostics(page: Page, decision: SwarmDecision): Promise<string> {
  const choiceTestId = decision.choiceId ? `choice-${decision.choiceId}` : "";
  const [errorBanner, progressStatus, choiceEnabled, toggleEnabled, submitEnabled, inputValueText, choiceLabels, questSnapshot] =
    await Promise.all([
      textContent(page, "error-banner"),
      textContent(page, "turn-progress-status"),
      choiceTestId ? locatorEnabled(page, choiceTestId) : Promise.resolve("n/a"),
      locatorEnabled(page, "toggle-free-text"),
      locatorEnabled(page, "submit-turn"),
      inputValue(page, "turn-input"),
      listText(page, "choice-list"),
      questSnapshotViaUi(page),
    ]);
  return [
    `mode=${decision.inputMode}`,
    `choice=${decision.choiceId ?? "(none)"} enabled=${choiceEnabled}`,
    `quest_action=${decision.questAction ?? "(none)"}`,
    `quest_actions=${questSnapshot.questActionLabels.join(" | ") || "(empty)"}`,
    `quest=${questSnapshot.questText || "(empty)"}`,
    `toggle-free-text enabled=${toggleEnabled}`,
    `submit-turn enabled=${submitEnabled}`,
    `turn-input=${inputValueText || "(empty)"}`,
    `turn-progress-status=${progressStatus || "(empty)"}`,
    `choices=${choiceLabels.join(" | ") || "(empty)"}`,
    `error-banner=${errorBanner || "(empty)"}`,
  ].join("; ");
}

async function playSurfaceDiagnostics(page: Page): Promise<string> {
  const [
    errorBanner,
    storyText,
    activeQuest,
    progressStatus,
    actionButtonEnabled,
    statusButtonEnabled,
    toggleEnabled,
    choiceLabels,
  ] = await Promise.all([
    textContent(page, "error-banner"),
    textContent(page, "story-scroll"),
    textContent(page, "active-quest"),
    textContent(page, "turn-progress-status"),
    roleEnabled(page.getByRole("button", { name: /^(行動|Actions)$/i })),
    roleEnabled(page.getByRole("button", { name: /^(情報|Info)$/i })),
    locatorEnabled(page, "toggle-free-text"),
    listText(page, "choice-list"),
  ]);
  return [
    `story=${storyText || "(empty)"}`,
    `active-quest=${activeQuest || "(empty)"}`,
    `turn-progress-status=${progressStatus || "(empty)"}`,
    `actions-button enabled=${actionButtonEnabled}`,
    `status-button enabled=${statusButtonEnabled}`,
    `toggle-free-text enabled=${toggleEnabled}`,
    `choices=${choiceLabels.join(" | ") || "(empty)"}`,
    `error-banner=${errorBanner || "(empty)"}`,
  ].join("; ");
}

async function clickQuestAction(page: Page, action: SwarmDecision["questAction"]): Promise<void> {
  const label = questActionLabelPattern(action);
  const button = page.getByTestId("active-quest").getByRole("button", { name: label });
  await expect(button).toBeVisible({ timeout: 60_000 });
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await button.click();
}

function questActionLabelPattern(action: SwarmDecision["questAction"]): RegExp {
  if (action === "decline_quest") {
    return /^(見送る|Decline)$/i;
  }
  if (action === "leave_quest") {
    return /^(離れる|Leave)$/i;
  }
  if (action === "resume_quest") {
    return /^(再開|Resume)$/i;
  }
  return /^(受諾|Accept)$/i;
}

async function waitForTurnIdle(page: Page): Promise<void> {
  try {
    await expect(page.getByTestId("choice-progress")).toBeEnabled({ timeout: 60_000 });
    return;
  } catch {
    // Some fail-forward or late-scene states may settle without a progress
    // choice. The next action's locator wait will enforce readiness when needed.
  }
  try {
    await expect(page.getByTestId("toggle-free-text")).toBeEnabled({ timeout: 10_000 });
  } catch {
    await page.waitForTimeout(1_000);
  }
}

async function textContent(page: Page, testId: string): Promise<string> {
  try {
    return ((await page.getByTestId(testId).textContent({ timeout: 1_000 })) ?? "").trim();
  } catch {
    return "";
  }
}

async function listText(page: Page, testId: string): Promise<string[]> {
  try {
    const text = ((await page.getByTestId(testId).textContent({ timeout: 1_000 })) ?? "").trim();
    return uniqueNonEmpty(text.split("\n")).slice(0, 12);
  } catch {
    return [];
  }
}

async function locatorVisible(page: Page, testId: string): Promise<boolean> {
  try {
    return await page.getByTestId(testId).isVisible({ timeout: 500 });
  } catch {
    return false;
  }
}

async function roleVisible(locator: ReturnType<Page["getByRole"]>): Promise<boolean> {
  try {
    return await locator.isVisible({ timeout: 500 });
  } catch {
    return false;
  }
}

async function roleEnabled(locator: ReturnType<Page["getByRole"]>): Promise<string> {
  try {
    return String(await locator.isEnabled({ timeout: 1_000 }));
  } catch {
    return "not-found";
  }
}

async function playerVisiblePlayInfoTexts(page: Page): Promise<string[]> {
  const groups = await Promise.all([
    textContent(page, "current-place-summary"),
    textContent(page, "current-chapter-summary"),
    textContent(page, "current-scene-summary"),
    textContent(page, "active-quest"),
    listText(page, "local-figures-stream"),
    listText(page, "nearby-routes-stream"),
    listText(page, "inventory-stream"),
    listText(page, "choice-list"),
  ]);
  return uniqueNonEmpty(
    groups.flatMap((item) => (Array.isArray(item) ? item : [item])).map((item) => item.trim()),
  ).slice(0, 32);
}

export async function questSnapshotViaUi(page: Page): Promise<SwarmUiQuestSnapshot> {
  const [questText, questProgress, chapterText, questActionLabels] = await Promise.all([
    textContent(page, "active-quest"),
    textContent(page, "quest-progress"),
    textContent(page, "current-chapter-summary"),
    questActionTexts(page),
  ]);
  return {
    questText,
    questProgress,
    chapterText,
    questActionLabels,
    hasExploringLabel: /探索中\.\.\.|Exploring\.\.\./i.test(questText),
    hasOfferedQuest: questActionLabels.some((label) => /^(受諾|Accept|見送る|Decline)$/i.test(label)),
    hasChapterSummary: Boolean(chapterText.trim()),
  };
}

async function questActionTexts(page: Page): Promise<string[]> {
  try {
    const labels = await page.getByTestId("active-quest").getByRole("button").allTextContents();
    return uniqueNonEmpty(labels);
  } catch {
    return [];
  }
}

function hasEnglishPlayTextResidue(value: string): boolean {
  const normalized = value.replace(/\b(SP|JA|EN|URL|ID)\b/g, "").replace(/\bgestaloka\b/gi, "");
  return /[A-Za-z]{3,}/.test(normalized);
}

async function locatorEnabled(page: Page, testId: string): Promise<string> {
  try {
    return String(await page.getByTestId(testId).isEnabled({ timeout: 1_000 }));
  } catch {
    return "unavailable";
  }
}

async function inputValue(page: Page, testId: string): Promise<string> {
  try {
    return await page.getByTestId(testId).inputValue({ timeout: 1_000 });
  } catch {
    return "";
  }
}

async function selectedOptionText(page: Page, testId: string): Promise<string> {
  try {
    return ((await page.getByTestId(testId).locator("option:checked").textContent({ timeout: 1_000 })) ?? "").trim();
  } catch {
    return "";
  }
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
