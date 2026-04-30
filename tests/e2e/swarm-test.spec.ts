import fs from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { derivePlayerProfile } from "./swarm/playerProfiles";
import { decisionForPersona } from "./swarm/playbook";
import {
  authenticatePage,
  createPlayerSession,
  getAccessToken,
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
  test.setTimeout(900_000);

  const runId = buildRunId();
  const artifactDir = defaultArtifactDir(runId);
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
  const artifacts: string[] = [];
  const attemptLabel = `attempt-${testInfo.retry + 1}`;
  await fs.mkdir(artifactDir, { recursive: true });

  const activePersonas = selectRandomPersonas(runId);
  const profiles = activePersonas.map(derivePlayerProfile);

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
    const accessTokens = new Map<string, string>();
    for (const persona of activePersonas) {
      accessTokens.set(persona.id, await getAccessToken(request, persona.user));
    }

    const runtimeByPersona = new Map<string, PlayerRuntime>();
    const [sharedImpactPersona, resourceConflictPersona, worldEventPersona] = activePersonas;
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
    const aSharedImpactTurn = await resolveTurn(request, a.accessToken, a.sessionId, aSharedImpactDecision);
    const aConflictDecision = decisionForPersona(a.persona, "resource-conflict");
    const bConflictDecision = decisionForPersona(b.persona, "resource-conflict");

    const [aConflictTurn, bConflictTurn] = await Promise.all([
      resolveTurn(request, a.accessToken, a.sessionId, aConflictDecision),
      resolveTurn(request, b.accessToken, b.sessionId, bConflictDecision),
    ]);

    const cBase = requiredRuntime(runtimeByPersona, worldEventPersona.id);
    const cSession = await createPlayerSession(request, cBase.accessToken, cBase.actorId);
    const c: PlayerRuntime = {
      ...cBase,
      sessionId: cSession.session_id,
      locationId: cSession.location_id,
    };
    runtimeByPersona.set(worldEventPersona.id, c);
    const cStateBeforeTurn = await getSessionState(request, c.accessToken, c.sessionId);
    const cDecision = decisionForPersona(c.persona, "world-event");
    const cTurn = await resolveTurn(request, c.accessToken, c.sessionId, cDecision);
    const freshAToken = await getAccessToken(request, a.persona.user);
    const freshBToken = await getAccessToken(request, b.persona.user);
    const freshCToken = await getAccessToken(request, c.persona.user);
    const freshOpsToken = await getAccessToken(request, { username: "swarm-ops", password: "swarm-password" });

    const [aState, bState, cState, events, memories, opsShared, opsHistory] = await Promise.all([
      getSessionState(request, freshAToken, a.sessionId),
      getSessionState(request, freshBToken, b.sessionId),
      getSessionState(request, freshCToken, c.sessionId),
      getWorldEvents(request, freshAToken),
      getWorldMemories(request, freshAToken),
      getOpsSharedWorld(request, freshOpsToken),
      getOpsHistory(request, freshOpsToken),
    ]);

    const eventItems = eventList(events);
    const turnEventIds = [eventId(aSharedImpactTurn), eventId(aConflictTurn), eventId(bConflictTurn), eventId(cTurn)].filter(Boolean);
    const novelLoverEventIds = [eventId(aSharedImpactTurn), eventId(aConflictTurn)].filter(Boolean);
    const turnEvents = eventItems.filter((event) => turnEventIds.includes(event.id));
    const conflictEventIds = [eventId(aConflictTurn), eventId(bConflictTurn)].filter(Boolean);
    const conflictEvents = eventItems.filter((event) => conflictEventIds.includes(event.id));
    const privacyPayloads = [aState, bState, cState, cStateBeforeTurn, events, memories, opsShared, opsHistory];
    const leakTerms = personaLeakTerms(activePersonas);
    const privacyLeakFree = privacyPayloads.every((payload) => !containsAnyTerm(payload, leakTerms));
    const canonicalSequences = eventItems
      .map((event) => event.canonical_sequence)
      .filter((sequence): sequence is number => typeof sequence === "number");
    const hardChecks = {
      persona_profile_separation: profiles.every((profile) => !containsAnyTerm(profile, leakTerms)),
      runtime_privacy_leak_free: privacyLeakFree,
      all_turns_return_event_ids: turnEventIds.length === 4,
      all_turn_events_same_world: turnEvents.length === 4 && turnEvents.every((event) => event.world_id === worldId),
      canonical_sequence_unique:
        canonicalSequences.length > 0 && new Set(canonicalSequences).size === canonicalSequences.length,
      shared_impact_visible: novelLoverEventIds.some((sourceEventId) =>
        visibleInSharedContext([bState, cState, opsShared, opsHistory, memories], sourceEventId),
      ),
      resource_conflict_recorded: conflictEvents.some((event) => JSON.stringify(event.payload).includes("resource_constraints")),
      world_broadcast_or_constraint_visible:
        turnEvents.some((event) => JSON.stringify(event.payload).includes("world_broadcast_event")) ||
        JSON.stringify(cStateBeforeTurn).includes("world_broadcast_constraints") ||
        JSON.stringify(cState).includes("world_broadcast_constraints"),
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
  } finally {
    await Promise.all(pageEntries.map((entry) => entry.context.close()));
  }
});

function requiredToken(tokens: Map<string, string>, personaId: string): string {
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
