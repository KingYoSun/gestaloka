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
  screenshotPath?: string;
};

export type SwarmUiSessionObservation = {
  personaId: string;
  sessionId: string;
  locationId: string;
  startedAt: string;
};

export async function preparePlayerUiForSession(page: Page, profile: DerivedPlayerProfile): Promise<void> {
  await expect(page.getByTestId("world-select")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("world-select").selectOption("gestaloka_reference");
  const profileSelect = page.getByTestId("player-profile-select");
  await expect(profileSelect).toBeVisible({ timeout: 60_000 });
  await profileSelect.selectOption({ label: profile.displayName });
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
  await expect(page.getByTestId("choice-list")).toBeVisible({ timeout: 60_000 });
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
  const [errorBanner, startEnabled, worldValue, worldLabel, profileValue, profileLabel] = await Promise.all([
    textContent(page, "error-banner"),
    locatorEnabled(page, "start-session"),
    inputValue(page, "world-select"),
    selectedOptionText(page, "world-select"),
    inputValue(page, "player-profile-select"),
    selectedOptionText(page, "player-profile-select"),
  ]);
  return [
    `start-session enabled=${startEnabled}`,
    `world=${worldValue || "(empty)"} ${worldLabel ? `(${worldLabel})` : ""}`,
    `profile=${profileValue || "(empty)"} ${profileLabel ? `(${profileLabel})` : ""}`,
    `error-banner=${errorBanner || "(empty)"}`,
  ].join("; ");
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
    await waitForTurnIdle(page);
    const screenshotPath = `${artifactDir}/${attemptLabel}-${persona.id}-${decision.scenario}-after-turn.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const completed = Date.now();
    const nonEmptyWaitStatusSamples = uniqueNonEmpty(waitStatusSamples);
    const opsStream = await listText(page, "ops-stream");
    const acceptedTurnId = stringValue(payload.turn_id);
    const eventsStream = await waitForEventsStreamForTurn(page, acceptedTurnId);
    const progressTimeline = progressTimelineFromOpsStream(opsStream);
    return {
      personaId: persona.id,
      scenario: decision.scenario,
      inputMode: decision.inputMode,
      action: decision.choiceId ?? decision.inputText ?? decision.inputMode,
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

async function turnSubmissionDiagnostics(page: Page, decision: SwarmDecision): Promise<string> {
  const choiceTestId = decision.choiceId ? `choice-${decision.choiceId}` : "";
  const [errorBanner, progressStatus, choiceEnabled, toggleEnabled, submitEnabled, inputValueText, choiceLabels] =
    await Promise.all([
      textContent(page, "error-banner"),
      textContent(page, "turn-progress-status"),
      choiceTestId ? locatorEnabled(page, choiceTestId) : Promise.resolve("n/a"),
      locatorEnabled(page, "toggle-free-text"),
      locatorEnabled(page, "submit-turn"),
      inputValue(page, "turn-input"),
      listText(page, "choice-list"),
    ]);
  return [
    `mode=${decision.inputMode}`,
    `choice=${decision.choiceId ?? "(none)"} enabled=${choiceEnabled}`,
    `toggle-free-text enabled=${toggleEnabled}`,
    `submit-turn enabled=${submitEnabled}`,
    `turn-input=${inputValueText || "(empty)"}`,
    `turn-progress-status=${progressStatus || "(empty)"}`,
    `choices=${choiceLabels.join(" | ") || "(empty)"}`,
    `error-banner=${errorBanner || "(empty)"}`,
  ].join("; ");
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
