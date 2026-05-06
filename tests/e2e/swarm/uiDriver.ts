import { expect, type Locator, type Page, type Response } from "@playwright/test";

import { derivePlayerProfile } from "./playerProfiles";
import type { DerivedPlayerProfile } from "./playerProfiles";
import { decisionActionText, type SwarmDecision } from "./playbook";
import type { AssignedSwarmUserPersona } from "./userPersonas";

export type SwarmViewportProfile = {
  kind: "desktop" | "mobile";
  width: number;
  height: number;
};

export type SwarmUiTurnObservation = {
  personaId: string;
  scenario: SwarmDecision["scenario"];
  submissionMode: SwarmDecision["submissionMode"];
  action: string;
  playerActionText: string;
  turnRequestPayloadKeys: string[];
  turnRequestPayloadPublicOnly: boolean;
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
  currentPlaceText: string;
  currentSceneText: string;
  localFigureTexts: string[];
  nearbyRouteTexts: string[];
  inventoryTexts: string[];
  recentSceneHistory: string[];
  recentConsequenceHistory: string[];
  recentWorldBeats: string[];
  opsStream: string[];
  suggestedActionLabels: string[];
  playInfoTexts: string[];
  englishPlayInfoTexts: string[];
  questText: string;
  questProgress: string;
  chapterText: string;
  questActionLabels: string[];
  inlineQuestActionLabels: string[];
  hasExploringLabel: boolean;
  hasStarterQuest: boolean;
  hasQuestProgress: boolean;
  hasOfferedQuest: boolean;
  hasInlineQuestDecision: boolean;
  hasChapterSummary: boolean;
  hasEntityUpdatesField: boolean;
  entityUpdates: SwarmEntityUpdate[];
  screenshotPath?: string;
};

export type SwarmEntityUpdate = {
  entity_type?: string;
  entity_id?: string;
  entity_key?: string;
  display_name?: string;
  origin_kind?: string;
  created?: boolean;
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
  inlineQuestActionLabels: string[];
  hasExploringLabel: boolean;
  hasStarterQuest: boolean;
  hasQuestProgress: boolean;
  hasOfferedQuest: boolean;
  hasInlineQuestDecision: boolean;
  hasChapterSummary: boolean;
};

type CapturedProgressEvent = SwarmUiTurnObservation["progressTimeline"][number] & {
  turnId: string;
};

type CapturedResolvedTurn = {
  turnId: string;
  entityUpdates: SwarmEntityUpdate[];
  hasEntityUpdatesField: boolean;
};

const capturedProgressByPage = new WeakMap<Page, CapturedProgressEvent[]>();
const capturedResolvedTurnsByPage = new WeakMap<Page, CapturedResolvedTurn[]>();
const progressCaptureAttached = new WeakSet<Page>();
const suggestedActionButtonSelector = 'button[data-testid^="suggested-action-"]';
const allowedTurnRequestKeys = new Set(["player_action_text", "session_id"]);
const forbiddenTurnRequestKeys = new Set([
  "action_kind",
  "action_type",
  "choice_id",
  "effect_kind",
  "input_mode",
  "item_id",
  "destination_key",
  "pack_id",
  "quest_assignment_id",
  "route_key",
  "session_key",
  "target",
  "travel_target_key",
  "world_id",
  "world_template_id",
]);

export async function preparePlayerUiForSession(page: Page, profile: DerivedPlayerProfile): Promise<void> {
  const worldCard = page.getByTestId("world-card-gestaloka_world_reference");
  const continueButton = page.getByTestId("continue-to-character");
  const characterButton = page.getByRole("button", { name: new RegExp(escapeRegExp(profile.displayName)) });

  await expect(worldCard).toBeVisible({ timeout: 60_000 });
  await worldCard.click();
  await expect(continueButton).toBeEnabled({ timeout: 60_000 });
  await continueButton.click();
  await expect(characterButton).toBeVisible({ timeout: 30_000 });
  await characterButton.click();
  await expect(page.getByTestId("start-session")).toBeEnabled({ timeout: 30_000 });
}

export async function startPlayerSessionViaUi(
  page: Page,
  persona: AssignedSwarmUserPersona,
): Promise<SwarmUiSessionObservation> {
  ensureProgressFrameCapture(page);
  const attempts = 3;
  const errors: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = new Date().toISOString();
    let response: Response;
    try {
      [response] = await Promise.all([
        waitForSessionResponseOrNetworkFailure(page, persona.id, 120_000),
        page.getByTestId("start-session").click(),
      ]);
    } catch (error) {
      errors.push(`attempt ${attempt}: ${errorMessage(error)}; ${await sessionStartDiagnostics(page)}`);
      if (attempt < attempts) {
        await page.waitForTimeout(2_000 * attempt);
        continue;
      }
      throw new Error(`UI session start did not observe /sessions for ${persona.id}: ${errors.join(" | ")}`);
    }
    if (!response.ok()) {
      const responseText = await response.text();
      errors.push(`attempt ${attempt}: ${response.status()} ${responseText}`);
      if (attempt < attempts && response.status() >= 500) {
        await page.waitForTimeout(2_000 * attempt);
        continue;
      }
      throw new Error(`UI session start failed for ${persona.id}: ${errors.join(" | ")}`);
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
  throw new Error(`UI session start exhausted retries for ${persona.id}: ${errors.join(" | ")}`);
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
  const readyTimeoutMs = envInt("SWARM_SESSION_READY_TIMEOUT_MS", envInt("SWARM_POLL_TIMEOUT_MS", 120_000));
  try {
    await expect(page.getByTestId("story-scroll")).toBeVisible({ timeout: readyTimeoutMs });
    await ensureActionSurface(page);
    await expect(page.locator(suggestedActionButtonSelector).first()).toBeVisible({ timeout: readyTimeoutMs });
    await expect(page.locator(suggestedActionButtonSelector).first()).toBeEnabled({ timeout: readyTimeoutMs });
    await ensureStatusSurface(page);
    await expect(page.getByTestId("active-quest")).toBeVisible({ timeout: readyTimeoutMs });
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
    const submitResponseTimeoutMs = envInt("SWARM_TURN_SUBMIT_RESPONSE_TIMEOUT_MS", 120_000);
    let response: Response;
    let submittedAction = "";
    try {
      const submitted = await submitDecisionAndWaitForResponse(page, persona.id, decision, submitResponseTimeoutMs);
      response = submitted.response;
      submittedAction = submitted.action;
    } catch (error) {
      if (decision.submissionMode !== "suggested_action") {
        throw new Error(
          `UI turn did not observe /turns for ${persona.id}/${decision.scenario}: ${errorMessage(error)}; ${await turnSubmissionDiagnostics(page, decision)}`,
        );
      }
      const fallbackAction = submittedAction || decisionActionText(decision);
      const status = await textContent(page, "turn-progress-status");
      if (status && !/^(選択待ち|Waiting)$/i.test(status.trim())) {
        throw new Error(
          `UI turn did not observe /turns for ${persona.id}/${decision.scenario} after suggested action click while status=${status}: ${errorMessage(error)}; ${await turnSubmissionDiagnostics(page, decision)}`,
        );
      }
      response = (
        await submitFreeTextActionAndWaitForResponse(page, persona.id, fallbackAction, submitResponseTimeoutMs)
      ).response;
    }
    const responseText = await response.text();
    const payload = parseJsonObject(responseText);
    const turnRequestPayload = parseJsonObject(response.request().postData() ?? "{}");
    const playerActionText = stringValue(turnRequestPayload.player_action_text);
    const turnRequestPayloadKeys = Object.keys(turnRequestPayload).sort();
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
    const reviewSnapshot = await playSurfaceReviewSnapshot(page);
    const englishResidueAllowlist = playerNameResidueAllowlist(persona);
    const questSnapshot = await questSnapshotViaUi(page);
    const eventsStream = await waitForEventsStreamForTurn(page, acceptedTurnId);
    const progressTimeline = progressTimelineForTurn(page, opsStream, acceptedTurnId);
    const resolvedTurn = resolvedTurnForTurn(page, acceptedTurnId);
    return {
      personaId: persona.id,
      scenario: decision.scenario,
      submissionMode: decision.submissionMode,
      action: playerActionText || submittedAction || decisionActionText(decision),
      playerActionText,
      turnRequestPayloadKeys,
      turnRequestPayloadPublicOnly: turnRequestPayloadIsPublicOnly(turnRequestPayload),
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
      ...reviewSnapshot,
      recentSceneHistory: await listText(page, "recent-scene-history"),
      recentConsequenceHistory: await listText(page, "recent-consequence-history"),
      recentWorldBeats: await listText(page, "recent-world-beats"),
      opsStream,
      suggestedActionLabels: await listText(page, "choice-list"),
      playInfoTexts,
      englishPlayInfoTexts: playInfoTexts
        .filter((value) => hasEnglishPlayTextResidue(value, englishResidueAllowlist))
        .slice(0, 12),
      ...questSnapshot,
      hasEntityUpdatesField: resolvedTurn?.hasEntityUpdatesField ?? false,
      entityUpdates: resolvedTurn?.entityUpdates ?? [],
      screenshotPath,
    };
  } finally {
    clearInterval(sampleTimer);
  }
}

async function submitDecisionAndWaitForResponse(
  page: Page,
  personaId: string,
  decision: SwarmDecision,
  timeout: number,
): Promise<{ response: Response; action: string }> {
  const responsePromise = waitForTurnResponseOrNetworkFailure(page, personaId, timeout);
  responsePromise.catch(() => undefined);
  try {
    const action = await submitDecision(page, decision);
    const response = await responsePromise;
    return { response, action };
  } catch (error) {
    responsePromise.catch(() => undefined);
    throw error;
  }
}

async function submitFreeTextActionAndWaitForResponse(
  page: Page,
  personaId: string,
  actionText: string,
  timeout: number,
): Promise<{ response: Response }> {
  const responsePromise = waitForTurnResponseOrNetworkFailure(page, personaId, timeout);
  responsePromise.catch(() => undefined);
  try {
    await submitFreeTextAction(page, actionText);
    return { response: await responsePromise };
  } catch (error) {
    responsePromise.catch(() => undefined);
    throw error;
  }
}

async function waitForEventsStreamForTurn(page: Page, turnId: string): Promise<string[]> {
  const eventsTimeoutMs = envInt("SWARM_EVENTS_STREAM_TIMEOUT_MS", envInt("SWARM_POLL_TIMEOUT_MS", 120_000));
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
      { timeout: eventsTimeoutMs, intervals: [1_000, 2_000, 5_000] },
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

function ensureProgressFrameCapture(page: Page): void {
  if (progressCaptureAttached.has(page)) {
    return;
  }
  progressCaptureAttached.add(page);
  capturedProgressByPage.set(page, []);
  capturedResolvedTurnsByPage.set(page, []);
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload.toString();
      try {
        const message = JSON.parse(text) as {
          event?: unknown;
          data?: {
            turn_id?: unknown;
            phase?: unknown;
            status?: unknown;
            elapsed_ms?: unknown;
            role_elapsed_ms?: unknown;
            entity_updates?: unknown;
          };
        };
        if (message.event === "turn.resolved") {
          const turnId = typeof message.data?.turn_id === "string" ? message.data.turn_id : "";
          if (!turnId) {
            return;
          }
          const resolvedTurns = capturedResolvedTurnsByPage.get(page) ?? [];
          resolvedTurns.push({
            turnId,
            entityUpdates: normalizeEntityUpdates(message.data?.entity_updates),
            hasEntityUpdatesField: Object.prototype.hasOwnProperty.call(message.data ?? {}, "entity_updates"),
          });
          capturedResolvedTurnsByPage.set(page, resolvedTurns);
          return;
        }
        if (message.event !== "turn.progress") {
          return;
        }
        const turnId = typeof message.data?.turn_id === "string" ? message.data.turn_id : "";
        const phase = typeof message.data?.phase === "string" ? message.data.phase : "";
        const status = typeof message.data?.status === "string" ? message.data.status : "";
        if (!turnId || (!phase && !status)) {
          return;
        }
        const progressEvents = capturedProgressByPage.get(page) ?? [];
        progressEvents.push({
          turnId,
          phase,
          status,
          elapsedMs: numberValue(message.data?.elapsed_ms),
          roleElapsedMs: numberValue(message.data?.role_elapsed_ms),
        });
        capturedProgressByPage.set(page, progressEvents);
      } catch {
        // Ignore non-JSON websocket frames.
      }
    });
  });
}

function resolvedTurnForTurn(page: Page, turnId: string): CapturedResolvedTurn | null {
  if (!turnId) {
    return null;
  }
  const resolvedTurns = capturedResolvedTurnsByPage.get(page) ?? [];
  return [...resolvedTurns].reverse().find((item) => item.turnId === turnId) ?? null;
}

function normalizeEntityUpdates(value: unknown): SwarmEntityUpdate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      entity_type: stringValue(item.entity_type),
      entity_id: stringValue(item.entity_id),
      entity_key: stringValue(item.entity_key),
      display_name: stringValue(item.display_name),
      origin_kind: stringValue(item.origin_kind),
      created: typeof item.created === "boolean" ? item.created : undefined,
    }));
}

function progressTimelineForTurn(
  page: Page,
  opsStreamItems: string[],
  turnId: string,
): SwarmUiTurnObservation["progressTimeline"] {
  const captured = (capturedProgressByPage.get(page) ?? [])
    .filter((event) => event.turnId === turnId)
    .map(({ turnId: _turnId, ...event }) => event);
  const visible = progressTimelineFromOpsStream(opsStreamItems, turnId);
  return uniqueProgressEvents([...captured, ...visible]);
}

function progressTimelineFromOpsStream(items: string[], turnId: string): SwarmUiTurnObservation["progressTimeline"] {
  const progressChunks = items.flatMap((item) =>
    item
      .split("turn.progress")
      .slice(1)
      .map((chunk) => `turn.progress${chunk}`),
  );
  return progressChunks
    .filter((item) => !turnId || item.includes(`turn_id: ${turnId}`))
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

function uniqueProgressEvents(
  events: SwarmUiTurnObservation["progressTimeline"],
): SwarmUiTurnObservation["progressTimeline"] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.phase}\u0000${event.status}\u0000${event.elapsedMs ?? ""}\u0000${event.roleElapsedMs ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function valueAfterKey(text: string, key: string): string {
  const match = new RegExp(`\\b${key}: ([^/\\n]+)`, "i").exec(text);
  return match?.[1]?.trim() ?? "";
}

function numberAfterKey(text: string, key: string): number | null {
  const value = Number(valueAfterKey(text, key));
  return Number.isFinite(value) ? value : null;
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

async function submitDecision(page: Page, decision: SwarmDecision): Promise<string> {
  if (decision.submissionMode === "quest_button") {
    await clickQuestAction(page, decision.questButtonAction);
    return decisionActionText(decision);
  }
  await ensureActionSurface(page);
  if (decision.submissionMode === "suggested_action") {
    await activateSuggestedActionMode(page);
    const action = await selectSuggestedActionButton(page, decision);
    await expect(action.locator).toBeVisible({ timeout: 60_000 });
    await expect(action.locator).toBeEnabled({ timeout: 60_000 });
    await action.locator.click();
    return action.text || decisionActionText(decision);
  }
  const toggle = page.getByTestId("toggle-free-text");
  await submitFreeTextAction(page, decision.inputText ?? "");
  return decisionActionText(decision);
}

async function submitFreeTextAction(page: Page, actionText: string): Promise<void> {
  await ensureActionSurface(page);
  const toggle = page.getByTestId("toggle-free-text");
  await expect(toggle).toBeEnabled({ timeout: 60_000 });
  await activateFreeTextMode(page);
  const input = page.getByTestId("turn-input");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await expect(input).toBeEnabled({ timeout: 60_000 });
  await input.fill(actionText);
  const submit = page.getByTestId("submit-turn");
  await expect(submit).toBeEnabled({ timeout: 60_000 });
  await submit.click();
}

async function activateFreeTextMode(page: Page): Promise<void> {
  const input = page.getByTestId("turn-input");
  if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
    return;
  }
  const toggle = page.getByTestId("toggle-free-text");
  await toggle.click({ timeout: 10_000 }).catch(async () => {
    await toggle.evaluate((element) => {
      if (element instanceof HTMLElement) {
        element.click();
      }
    });
  });
  if (await input.isVisible({ timeout: 3_000 }).catch(() => false)) {
    return;
  }
  await toggle.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.click();
    }
  });
  await expect(input).toBeVisible({ timeout: 20_000 });
}

type SuggestedActionCandidate = {
  locator: Locator;
  index: number;
  testId: string;
  text: string;
};

async function selectSuggestedActionButton(page: Page, decision: SwarmDecision): Promise<SuggestedActionCandidate> {
  const actions = page.locator(suggestedActionButtonSelector);
  await expect(actions.first()).toBeVisible({ timeout: 60_000 });
  const candidates = await suggestedActionCandidates(page);
  if (!candidates.length) {
    throw new Error(`No visible suggested action buttons for ${decision.scenario}; ${await playSurfaceDiagnostics(page)}`);
  }
  const selection = decision.suggestedActionSelection;
  const preferred = candidates.find((candidate) => suggestedActionMatches(candidate.text, selection?.preferredTextPatterns ?? []));
  if (preferred) {
    return preferred;
  }
  const fallbackIndex = Math.min(Math.max((selection?.fallbackActionNumber ?? 1) - 1, 0), candidates.length - 1);
  return candidates[fallbackIndex];
}

async function activateSuggestedActionMode(page: Page): Promise<void> {
  const toggle = page.getByTestId("toggle-choice-mode");
  await expect(toggle).toBeEnabled({ timeout: 60_000 });
  await toggle.click();
}

async function suggestedActionCandidates(page: Page): Promise<SuggestedActionCandidate[]> {
  const actions = page.locator(suggestedActionButtonSelector);
  const count = await actions.count();
  const candidates: SuggestedActionCandidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const locator = actions.nth(index);
    const visible = await locatorVisibleByLocator(locator);
    if (!visible) {
      continue;
    }
    candidates.push({
      locator,
      index,
      testId: (await locator.getAttribute("data-testid")) ?? "",
      text: normalizeActionText((await locator.textContent()) ?? ""),
    });
  }
  return candidates;
}

function suggestedActionMatches(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(text);
    } catch {
      return false;
    }
  });
}

function normalizeActionText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function ensureActionSurface(page: Page): Promise<void> {
  await closeVisibleOverlay(page);
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
  await closeVisibleOverlay(page);
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
  await closeVisibleOverlay(page);
}

async function closeVisibleOverlay(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const closeButton = page.getByRole("button", { name: /^(閉じる|Close)$/i }).first();
    if (!(await roleVisible(closeButton))) {
      return;
    }
    await closeButton.click({ timeout: 5_000 }).catch(async () => {
      await closeButton.evaluate((element) => {
        if (element instanceof HTMLElement) {
          element.click();
        }
      });
    });
    await page.waitForTimeout(250);
  }
}

async function turnSubmissionDiagnostics(page: Page, decision: SwarmDecision): Promise<string> {
  const [errorBanner, progressStatus, actionEnabled, actionButtons, toggleEnabled, submitEnabled, inputValueText, suggestedActionLabels, questSnapshot] =
    await Promise.all([
      textContent(page, "error-banner"),
      textContent(page, "turn-progress-status"),
      decision.submissionMode === "suggested_action" ? firstSuggestedActionEnabled(page) : Promise.resolve("n/a"),
      suggestedActionButtonSummaries(page),
      locatorEnabled(page, "toggle-free-text"),
      locatorEnabled(page, "submit-turn"),
      inputValue(page, "turn-input"),
      listText(page, "choice-list"),
      questSnapshotViaUi(page),
    ]);
  return [
    `mode=${decision.submissionMode}`,
    `suggested_action_selection=${decision.suggestedActionSelection?.label ?? "(none)"} enabled=${actionEnabled}`,
    `suggested_action_buttons=${actionButtons.join(" | ") || "(empty)"}`,
    `quest_button_action=${decision.questButtonAction ?? "(none)"}`,
    `quest_actions=${questSnapshot.questActionLabels.join(" | ") || "(empty)"}`,
    `quest=${questSnapshot.questText || "(empty)"}`,
    `toggle-free-text enabled=${toggleEnabled}`,
    `submit-turn enabled=${submitEnabled}`,
    `turn-input=${inputValueText || "(empty)"}`,
    `turn-progress-status=${progressStatus || "(empty)"}`,
    `suggested_actions=${suggestedActionLabels.join(" | ") || "(empty)"}`,
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
    suggestedActionLabels,
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
    `suggested_actions=${suggestedActionLabels.join(" | ") || "(empty)"}`,
    `error-banner=${errorBanner || "(empty)"}`,
  ].join("; ");
}

async function clickQuestAction(page: Page, action: SwarmDecision["questButtonAction"]): Promise<void> {
  const label = questActionLabelPattern(action);
  const inlineButton = action ? page.getByTestId(`quest-action-${action}`) : null;
  if (inlineButton && await locatorVisibleByLocator(inlineButton)) {
    await expect(inlineButton).toBeEnabled({ timeout: 60_000 });
    await inlineButton.click();
    return;
  }

  await ensureStatusSurface(page);
  const activeQuestButton = page.getByTestId("active-quest").getByRole("button", { name: label });
  if (await roleVisible(activeQuestButton)) {
    await expect(activeQuestButton).toBeEnabled({ timeout: 60_000 });
    await activeQuestButton.click();
    return;
  }

  const questListOpen = page.getByTestId("quest-list-open");
  await expect(questListOpen).toBeVisible({ timeout: 60_000 });
  await expect(questListOpen).toBeEnabled({ timeout: 60_000 });
  await questListOpen.click();
  const dialogButton = page.getByTestId("quest-list-dialog").getByRole("button", { name: label });
  await expect(dialogButton).toBeVisible({ timeout: 60_000 });
  await expect(dialogButton).toBeEnabled({ timeout: 60_000 });
  await dialogButton.click();
}

function questActionLabelPattern(action: SwarmDecision["questButtonAction"]): RegExp {
  if (action === "decline_quest") {
    return /^(見送る|Decline)$/i;
  }
  if (action === "ignore_quest") {
    return /^(無視|Ignore)$/i;
  }
  if (action === "leave_quest") {
    return /^(離れる|クエストから離脱|Leave|Leave quest)$/i;
  }
  if (action === "resume_quest") {
    return /^(再開|Resume)$/i;
  }
  return /^(受諾|Accept)$/i;
}

async function waitForTurnIdle(page: Page): Promise<void> {
  try {
    await expect(page.locator(suggestedActionButtonSelector).first()).toBeEnabled({ timeout: 60_000 });
    return;
  } catch {
    // Some fail-forward or late-scene states may settle without a normal
    // suggested action list. The next action's locator wait will enforce readiness.
  }
  try {
    await expect(page.getByTestId("quest-action-accept_quest")).toBeEnabled({ timeout: 10_000 });
    return;
  } catch {
    // Offered quests replace the normal suggested action list with an inline decision
    // panel. If no offer is visible, fall through to the generic input check.
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

async function locatorVisibleByLocator(locator: Locator): Promise<boolean> {
  try {
    return await locator.isVisible({ timeout: 500 });
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

async function playSurfaceReviewSnapshot(
  page: Page,
): Promise<Pick<SwarmUiTurnObservation, "currentPlaceText" | "currentSceneText" | "localFigureTexts" | "nearbyRouteTexts" | "inventoryTexts">> {
  const [currentPlaceText, currentSceneText, localFigureTexts, nearbyRouteTexts, inventoryTexts] = await Promise.all([
    textContent(page, "current-place-summary"),
    textContent(page, "current-scene-summary"),
    listText(page, "local-figures-stream"),
    listText(page, "nearby-routes-stream"),
    listText(page, "inventory-stream"),
  ]);
  return {
    currentPlaceText,
    currentSceneText,
    localFigureTexts,
    nearbyRouteTexts,
    inventoryTexts,
  };
}

export async function questSnapshotViaUi(page: Page): Promise<SwarmUiQuestSnapshot> {
  const [questText, questProgress, chapterText, sceneText, questActionLabels, inlineQuestActionLabels, inlineQuestText] = await Promise.all([
    textContent(page, "active-quest"),
    textContent(page, "quest-progress"),
    textContent(page, "current-chapter-summary"),
    textContent(page, "current-scene-summary"),
    questActionTexts(page),
    inlineQuestActionTexts(page),
    textContent(page, "inline-quest-decision"),
  ]);
  const allQuestActionLabels = uniqueNonEmpty([...questActionLabels, ...inlineQuestActionLabels]);
  const sceneContextText = chapterText.trim() || sceneText.trim();
  return {
    questText,
    questProgress,
    chapterText: sceneContextText,
    questActionLabels: allQuestActionLabels,
    inlineQuestActionLabels,
    hasExploringLabel: /探索中\.\.\.|Exploring\.\.\./i.test(questText),
    hasStarterQuest: /来訪者ログ登録|Visitor Log Registration/i.test(questText),
    hasQuestProgress: /\b\d+\s*\/\s*\d+\b/.test(questProgress || questText),
    hasOfferedQuest: allQuestActionLabels.some((label) => /^(受諾|Accept|見送る|Decline|無視|Ignore)$/i.test(label)),
    hasInlineQuestDecision: Boolean(inlineQuestText.trim()) || inlineQuestActionLabels.length > 0,
    hasChapterSummary: Boolean(sceneContextText),
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

async function inlineQuestActionTexts(page: Page): Promise<string[]> {
  try {
    const labels = await page.getByTestId("inline-quest-decision").getByRole("button").allTextContents();
    return uniqueNonEmpty(labels);
  } catch {
    return [];
  }
}

function hasEnglishPlayTextResidue(value: string, allowlist: string[] = []): boolean {
  const normalized = value.replace(/\b(SP|JA|EN|URL|ID)\b/g, "").replace(/\bgestaloka\b/gi, "");
  const withoutAllowedNames = allowlist.reduce(
    (current, term) => current.split(term).join(""),
    normalized,
  );
  return /[A-Za-z]{3,}/.test(withoutAllowedNames);
}

function playerNameResidueAllowlist(persona: AssignedSwarmUserPersona): string[] {
  const displayName = derivePlayerProfile(persona).displayName;
  return uniqueNonEmpty([displayName, ...displayName.split(/\s+/)]).filter((term) => /[A-Za-z]{3,}/.test(term));
}

async function locatorEnabled(page: Page, testId: string): Promise<string> {
  try {
    return String(await page.getByTestId(testId).isEnabled({ timeout: 1_000 }));
  } catch {
    return "unavailable";
  }
}

async function firstSuggestedActionEnabled(page: Page): Promise<string> {
  try {
    return String(await page.locator(suggestedActionButtonSelector).first().isEnabled({ timeout: 1_000 }));
  } catch {
    return "unavailable";
  }
}

async function suggestedActionButtonSummaries(page: Page): Promise<string[]> {
  try {
    const candidates = await suggestedActionCandidates(page);
    return candidates.map((candidate) => `${candidate.index + 1}:${candidate.testId}:${candidate.text}`).slice(0, 6);
  } catch {
    return [];
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

function turnRequestPayloadIsPublicOnly(payload: Record<string, unknown>): boolean {
  const keys = Object.keys(payload);
  return (
    keys.length === 2 &&
    keys.every((key) => allowedTurnRequestKeys.has(key)) &&
    keys.every((key) => !forbiddenTurnRequestKeys.has(key)) &&
    typeof payload.session_id === "string" &&
    typeof payload.player_action_text === "string" &&
    payload.player_action_text.trim().length > 0
  );
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
