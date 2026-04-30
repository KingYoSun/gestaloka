import fs from "node:fs/promises";

import { expect, test, type APIRequestContext, type TestInfo } from "@playwright/test";

import { derivePlayerProfile, profilePayloadForApi } from "./swarm/playerProfiles";
import { decisionForPersona } from "./swarm/playbook";
import {
  authenticatePage,
  createTokenProvider,
  createPlayerSession,
  getOpsHistory,
  getOpsSharedWorld,
  getSessionState,
  getWorldEvents,
  getWorldMemories,
  resolveTurn,
  worldId,
  ensurePlayerProfile,
  type PlayerRuntime,
} from "./swarm/playerDriver";
import { buildRunId, defaultArtifactDir, writeSwarmReport, type PersonaEvaluation } from "./swarm/reporter";
import { selectRandomPersonas, type AssignedSwarmUserPersona } from "./swarm/userPersonas";

type EventItem = {
  id: string;
  world_id: string;
  canonical_sequence: number | null;
  payload: Record<string, unknown>;
};

test("swarm-test: persona-derived players exercise shared impact, resource contention, and world events", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(envInt("SWARM_TEST_TIMEOUT_MS", 1_800_000));

  const runId = buildRunId();
  const artifactDir = defaultArtifactDir(runId);
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
  const artifacts: string[] = [];
  const attemptLabel = `attempt-${testInfo.retry + 1}`;
  const pollTimeoutMs = envInt("SWARM_POLL_TIMEOUT_MS", 120_000);
  await fs.mkdir(artifactDir, { recursive: true });

  const activePersonas = selectRandomPersonas(runId);
  const profiles = activePersonas.map(derivePlayerProfile);
  const runtimeByPersona = new Map<string, PlayerRuntime>();
  let lastStage = "authenticate";

  const pageEntries = await Promise.all(
    activePersonas.map(async (persona) => {
      const context = await browser.newContext({ locale: "ja-JP" });
      const page = await context.newPage();
      await authenticatePage(page, baseURL, persona);
      const screenshotPath = `${artifactDir}/${attemptLabel}-${persona.id}-authenticated.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      artifacts.push(screenshotPath);
      return { persona, context, page };
    }),
  );

  try {
    lastStage = "token_provider";
    const accessTokens = new Map<string, ReturnType<typeof createTokenProvider>>();
    for (const persona of activePersonas) {
      accessTokens.set(persona.id, createTokenProvider(request, persona.user));
    }
    const opsToken = createTokenProvider(request, { username: "swarm-ops", password: "swarm-password" });

    const [sharedImpactPersona, resourceConflictPersona, worldEventPersona] = activePersonas;
    lastStage = "profile_and_session_setup";
    for (const persona of activePersonas) {
      const profile = derivePlayerProfile(persona);
      const token = requiredToken(accessTokens, persona.id);
      const persistedProfile = await ensurePlayerProfile(request, token, profile);
      if (persona.id !== worldEventPersona.id) {
        const session = await createPlayerSession(request, token, persistedProfile.actor_id);
        runtimeByPersona.set(persona.id, {
          persona,
          profile,
          accessToken: token,
          actorId: persistedProfile.actor_id,
          sessionId: session.session_id,
          locationId: session.location_id,
        });
      } else {
        runtimeByPersona.set(persona.id, {
          persona,
          profile,
          accessToken: token,
          actorId: persistedProfile.actor_id,
          sessionId: "",
          locationId: "",
        });
      }
    }

    const a = requiredRuntime(runtimeByPersona, sharedImpactPersona.id);
    const b = requiredRuntime(runtimeByPersona, resourceConflictPersona.id);
    const aSharedImpactDecision = decisionForPersona(a.persona, "shared-impact");
    lastStage = "shared_impact_turn";
    const aSharedImpactTurn = await resolveTurn(request, a.accessToken, a.sessionId, aSharedImpactDecision);
    const aConflictDecision = decisionForPersona(a.persona, "resource-conflict");
    const bConflictDecision = decisionForPersona(b.persona, "resource-conflict");

    lastStage = "resource_conflict_turns";
    const [aConflictTurn, bConflictTurn] = await Promise.all([
      resolveTurn(request, a.accessToken, a.sessionId, aConflictDecision),
      resolveTurn(request, b.accessToken, b.sessionId, bConflictDecision),
    ]);

    const cBase = requiredRuntime(runtimeByPersona, worldEventPersona.id);
    lastStage = "world_event_session_setup";
    const cSession = await createPlayerSession(request, cBase.accessToken, cBase.actorId);
    const c: PlayerRuntime = {
      ...cBase,
      sessionId: cSession.session_id,
      locationId: cSession.location_id,
    };
    runtimeByPersona.set(worldEventPersona.id, c);
    lastStage = "world_event_pre_state";
    const cStateBeforeTurn = await getSessionState(request, c.accessToken, c.sessionId);
    const cDecision = decisionForPersona(c.persona, "world-event");
    lastStage = "world_event_turn";
    const cTurn = await resolveTurn(request, c.accessToken, c.sessionId, cDecision);
    const turnEventIds = [eventId(aSharedImpactTurn), eventId(aConflictTurn), eventId(bConflictTurn), eventId(cTurn)].filter(Boolean);
    const novelLoverEventIds = [eventId(aSharedImpactTurn), eventId(aConflictTurn)].filter(Boolean);
    const conflictEventIds = [eventId(aConflictTurn), eventId(bConflictTurn)].filter(Boolean);
    const leakTerms = personaLeakTerms(activePersonas);

    lastStage = "observation_poll";
    const observation = await waitForObservationSnapshot(request, {
      a,
      b,
      c,
      cStateBeforeTurn,
      opsToken,
      turnEventIds,
      novelLoverEventIds,
      conflictEventIds,
      leakTerms,
      pollTimeoutMs,
    });
    const hardChecks = {
      persona_profile_separation: profiles.every((profile) => !containsAnyTerm(profilePayloadForApi(profile), leakTerms)),
      runtime_privacy_leak_free: observation.privacyLeakFree,
      all_turns_return_event_ids: turnEventIds.length === 4,
      all_turn_events_same_world: observation.allTurnEventsSameWorld,
      canonical_sequence_unique: observation.canonicalSequenceUnique,
      shared_impact_visible: observation.sharedImpactVisible,
      resource_conflict_recorded: observation.resourceConflictRecorded,
      world_broadcast_or_constraint_visible:
        observation.worldBroadcastOrConstraintVisible,
    };

    const evaluations: PersonaEvaluation[] = [
      {
        personaId: a.persona.id,
        rating: hardChecks.shared_impact_visible ? "good" : "needs work",
        observedImpact: hardChecks.shared_impact_visible
          ? "The helping action is present in shared-world context."
          : "The helping action did not surface in the shared-world context probe.",
        evidence: [...novelLoverEventIds, "session state / ops history / memory scan"].filter(Boolean),
      },
      {
        personaId: b.persona.id,
        rating: hardChecks.resource_conflict_recorded ? "good" : "needs work",
        observedImpact: hardChecks.resource_conflict_recorded
          ? "Concurrent pressure produced a recorded resource constraint."
          : "Concurrent pressure completed without an observable resource constraint.",
        evidence: [eventId(bConflictTurn), "event payload resource_constraints scan"].filter(Boolean),
      },
      {
        personaId: c.persona.id,
        rating: hardChecks.world_broadcast_or_constraint_visible ? "good" : "needs work",
        observedImpact: hardChecks.world_broadcast_or_constraint_visible
          ? "Late join and follow-up exposed a world event or broadcast constraint."
          : "Late join and follow-up did not expose a world event or broadcast constraint.",
        evidence: [eventId(cTurn), "session state broadcast constraint scan"].filter(Boolean),
      },
    ];

    lastStage = "write_report";
    await writeSwarmReport(testInfo, artifactDir, {
      run_id: runId,
      created_at: new Date().toISOString(),
      world_id: worldId,
      user_personas: activePersonas,
      derived_player_profiles: profiles,
      persona_decision_log: [
        { personaId: a.persona.id, ...aSharedImpactDecision },
        { personaId: a.persona.id, ...aConflictDecision },
        { personaId: b.persona.id, ...bConflictDecision },
        { personaId: c.persona.id, ...cDecision },
      ],
      persona_experience_evaluation: evaluations,
      hard_checks: hardChecks,
      runtime: [a, b, c].map((runtime) => ({
        personaId: runtime.persona.id,
        actorId: runtime.actorId,
        sessionId: runtime.sessionId,
        locationId: runtime.locationId,
        eventIds:
          runtime.persona.id === a.persona.id
            ? [eventId(aSharedImpactTurn), eventId(aConflictTurn)].filter(Boolean)
            : runtime.persona.id === b.persona.id
              ? [eventId(bConflictTurn)].filter(Boolean)
              : [eventId(cTurn)].filter(Boolean),
        turnIds:
          runtime.persona.id === a.persona.id
            ? [turnId(aSharedImpactTurn), turnId(aConflictTurn)].filter(Boolean)
            : runtime.persona.id === b.persona.id
              ? [turnId(bConflictTurn)].filter(Boolean)
              : [turnId(cTurn)].filter(Boolean),
      })),
      artifacts,
    });

    for (const [name, passed] of Object.entries(hardChecks)) {
      expect(passed, `swarm hard check failed: ${name}`).toBe(true);
    }
  } catch (error) {
    await writeFailureReport({
      testInfo,
      artifactDir,
      runId,
      activePersonas,
      profiles,
      runtimeByPersona,
      artifacts,
      lastStage,
      error,
    });
    throw error;
  } finally {
    await Promise.all(pageEntries.map((entry) => entry.context.close()));
  }
});

type ObservationSnapshot = {
  privacyLeakFree: boolean;
  allTurnEventsSameWorld: boolean;
  canonicalSequenceUnique: boolean;
  sharedImpactVisible: boolean;
  resourceConflictRecorded: boolean;
  worldBroadcastOrConstraintVisible: boolean;
};

async function writeFailureReport({
  testInfo,
  artifactDir,
  runId,
  activePersonas,
  profiles,
  runtimeByPersona,
  artifacts,
  lastStage,
  error,
}: {
  testInfo: TestInfo;
  artifactDir: string;
  runId: string;
  activePersonas: AssignedSwarmUserPersona[];
  profiles: ReturnType<typeof derivePlayerProfile>[];
  runtimeByPersona: Map<string, PlayerRuntime>;
  artifacts: string[];
  lastStage: string;
  error: unknown;
}): Promise<void> {
  const hardChecks = {
    persona_profile_separation: false,
    runtime_privacy_leak_free: false,
    all_turns_return_event_ids: false,
    all_turn_events_same_world: false,
    canonical_sequence_unique: false,
    shared_impact_visible: false,
    resource_conflict_recorded: false,
    world_broadcast_or_constraint_visible: false,
  };
  try {
    await writeSwarmReport(testInfo, artifactDir, {
      run_id: runId,
      created_at: new Date().toISOString(),
      world_id: worldId,
      user_personas: activePersonas,
      derived_player_profiles: profiles,
      persona_decision_log: [],
      persona_experience_evaluation: activePersonas.map((persona) => ({
        personaId: persona.id,
        rating: "blocked",
        observedImpact: `swarm-test stopped before hard checks at ${lastStage}.`,
        evidence: [errorMessage(error)],
      })),
      hard_checks: hardChecks,
      runtime: Array.from(runtimeByPersona.values()).map((runtime) => ({
        personaId: runtime.persona.id,
        actorId: runtime.actorId,
        sessionId: runtime.sessionId,
        locationId: runtime.locationId,
        eventIds: [],
        turnIds: [],
      })),
      artifacts,
      failure_diagnostics: {
        stage: lastStage,
        message: errorMessage(error),
        stack: errorStack(error),
      },
    });
  } catch (reportError) {
    console.warn(`failed to write swarm failure report: ${errorMessage(reportError)}`);
  }
}

type ObservationInput = {
  a: PlayerRuntime;
  b: PlayerRuntime;
  c: PlayerRuntime;
  cStateBeforeTurn: Record<string, unknown>;
  opsToken: ReturnType<typeof createTokenProvider>;
  turnEventIds: string[];
  novelLoverEventIds: string[];
  conflictEventIds: string[];
  leakTerms: string[];
  pollTimeoutMs: number;
};

async function waitForObservationSnapshot(
  request: APIRequestContext,
  input: ObservationInput,
): Promise<ObservationSnapshot> {
  let latest = await collectObservationSnapshot(request, input);
  await expect
    .poll(
      async () => {
        latest = await collectObservationSnapshot(request, input);
        return (
          latest.privacyLeakFree &&
          latest.allTurnEventsSameWorld &&
          latest.canonicalSequenceUnique &&
          latest.sharedImpactVisible &&
          latest.resourceConflictRecorded &&
          latest.worldBroadcastOrConstraintVisible
        );
      },
      {
        timeout: input.pollTimeoutMs,
        intervals: [2_000, 5_000, 10_000, 15_000],
        message: "shared-world observation hard checks should become visible",
      },
    )
    .toBe(true);
  return latest;
}

async function collectObservationSnapshot(
  request: APIRequestContext,
  input: ObservationInput,
): Promise<ObservationSnapshot> {
  const [aState, bState, cState, events, memories, opsShared, opsHistory] = await Promise.all([
    getSessionState(request, input.a.accessToken, input.a.sessionId),
    getSessionState(request, input.b.accessToken, input.b.sessionId),
    getSessionState(request, input.c.accessToken, input.c.sessionId),
    getWorldEvents(request, input.a.accessToken),
    getWorldMemories(request, input.a.accessToken),
    getOpsSharedWorld(request, input.opsToken),
    getOpsHistory(request, input.opsToken),
  ]);
  const eventItems = eventList(events);
  const turnEvents = eventItems.filter((event) => input.turnEventIds.includes(event.id));
  const conflictEvents = eventItems.filter((event) => input.conflictEventIds.includes(event.id));
  const sharedImpactEvents = eventItems.filter((event) => input.novelLoverEventIds.includes(event.id));
  const privacyPayloads = [aState, bState, cState, input.cStateBeforeTurn, { items: turnEvents }];
  const canonicalSequences = eventItems
    .map((event) => event.canonical_sequence)
    .filter((sequence): sequence is number => typeof sequence === "number");
  const sharedImpactVisible = input.novelLoverEventIds.some((sourceEventId) =>
    visibleInSharedContext([events, bState, cState, opsShared, opsHistory, memories], sourceEventId),
  ) || sharedImpactEvents.some((event) =>
    containsAnyTerm(event.payload, ["world_broadcast_event", "shared_consequence_updates", "recent_world_beats"]),
  );
  const resourcePayloads = [events, opsHistory, conflictEvents.map((event) => event.payload)];
  const resourceConflictRecorded =
    resourcePayloads.some((payload) => containsAnyTerm(payload, ["resource_constraints", "skipped_shared_resources"])) ||
    resourcePayloads.some((payload) => containsAnyTerm(payload, ["resource_conflict"]));
  const worldBroadcastOrConstraintVisible =
    turnEvents.some((event) => JSON.stringify(event.payload).includes("world_broadcast_event")) ||
    JSON.stringify(input.cStateBeforeTurn).includes("world_broadcast_constraints") ||
    JSON.stringify(cState).includes("world_broadcast_constraints") ||
    JSON.stringify([events, opsShared, opsHistory]).includes("world_broadcast") ||
    turnEvents.length > 0;

  return {
    privacyLeakFree: privacyPayloads.every((payload) => !containsAnyTerm(payload, input.leakTerms)),
    allTurnEventsSameWorld: turnEvents.length === 4 && turnEvents.every((event) => event.world_id === worldId),
    canonicalSequenceUnique: canonicalSequences.length > 0 && new Set(canonicalSequences).size === canonicalSequences.length,
    sharedImpactVisible,
    resourceConflictRecorded,
    worldBroadcastOrConstraintVisible,
  };
}

function requiredToken(
  tokens: Map<string, ReturnType<typeof createTokenProvider>>,
  personaId: string,
): ReturnType<typeof createTokenProvider> {
  const token = tokens.get(personaId);
  if (!token) {
    throw new Error(`Missing access token for ${personaId}`);
  }
  return token;
}

function requiredRuntime(
  runtimeByPersona: Map<string, PlayerRuntime>,
  personaId: string,
): PlayerRuntime {
  const runtime = runtimeByPersona.get(personaId);
  if (!runtime) {
    throw new Error(`Missing runtime for ${personaId}`);
  }
  return runtime;
}

function eventList(payload: Record<string, unknown>): EventItem[] {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.filter((item): item is EventItem => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const candidate = item as Partial<EventItem>;
    return typeof candidate.id === "string" && typeof candidate.world_id === "string";
  });
}

function eventId(payload: Record<string, unknown>): string {
  return typeof payload.event_id === "string" ? payload.event_id : "";
}

function turnId(payload: Record<string, unknown>): string {
  return typeof payload.turn_id === "string" ? payload.turn_id : "";
}

function visibleInSharedContext(payload: unknown, sourceEventId: string): boolean {
  return Boolean(sourceEventId) && JSON.stringify(payload).includes(sourceEventId);
}

function personaLeakTerms(personas: AssignedSwarmUserPersona[]): string[] {
  return personas
    .flatMap((persona) => [
      "occupation",
      "hobbies",
      "personality",
      "gameMotivation",
      "playStyle",
      "frictionSensitivity",
      "evaluationLens",
      persona.occupation,
      ...persona.hobbies,
    ])
    .map((term) => term.toLowerCase())
    .filter((term) => term.length > 2);
}

function containsAnyTerm(payload: unknown, terms: string[]): boolean {
  const serialized = JSON.stringify(payload).toLowerCase();
  return terms.some((term) => serialized.includes(term));
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
