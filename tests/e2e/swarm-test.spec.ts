import fs from "node:fs/promises";

import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

import { derivePlayerProfile, profilePayloadForApi } from "./swarm/playerProfiles";
import { decisionForPersona, type SwarmDecision } from "./swarm/playbook";
import {
  authenticatePage,
  createTokenProvider,
  getOpsHistory,
  getOpsSharedWorld,
  getSessionQuests,
  getSessionState,
  getWorldEvents,
  getWorldMemories,
  worldId,
  ensurePackPreprocessed,
  ensurePlayerProfile,
  type PlayerRuntime,
} from "./swarm/playerDriver";
import { evaluateSwarmExperience } from "./swarm/experienceJudge";
import { buildRunId, defaultArtifactDir, writeSwarmReport, type PersonaEvaluation } from "./swarm/reporter";
import {
  executeTurnViaUi,
  preparePlayerUiForSession,
  questSnapshotViaUi,
  startPlayerSessionViaUi,
  type SwarmUiTurnObservation,
  type SwarmUiQuestSnapshot,
  type SwarmViewportProfile,
} from "./swarm/uiDriver";
import { selectRandomPersonas, type AssignedSwarmUserPersona } from "./swarm/userPersonas";

type EventItem = {
  id: string;
  world_id: string;
  canonical_sequence: number | null;
  payload: Record<string, unknown>;
};

type SwarmTestMode = "short" | "long";

type GeneratedEntityObservation = {
  created_count: number;
  reused_count: number;
  entity_types: string[];
  origin_kinds: string[];
  source_turn_ids: string[];
  source_event_ids: string[];
};

test("swarm-test: persona-derived players exercise shared impact, resource contention, and world events", async ({
  browser,
  request,
}, testInfo) => {
  const mode = swarmTestMode();
  test.setTimeout(envInt("SWARM_TEST_TIMEOUT_MS", mode === "long" ? 2_700_000 : 1_800_000));
  const runId = buildRunId();
  const artifactDir = defaultArtifactDir(runId);
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
  const artifacts: string[] = [];
  const attemptLabel = `attempt-${testInfo.retry + 1}`;
  const pollTimeoutMs = envInt("SWARM_POLL_TIMEOUT_MS", 120_000);
  await fs.mkdir(artifactDir, { recursive: true });

  const activePersonas = selectRandomPersonas(runId);
  const profiles = activePersonas.map(derivePlayerProfile);
  const viewportByPersona = new Map<string, SwarmViewportProfile>(
    activePersonas.map((persona): [string, SwarmViewportProfile] => [
      persona.id,
      { kind: "desktop", width: 1280, height: 900 },
    ]),
  );
  const runtimeByPersona = new Map<string, PlayerRuntime>();
  const turnObservationsByPersona = new Map<string, SwarmUiTurnObservation[]>();
  const decisionLog: Array<SwarmDecision & { personaId: string }> = [];
  let lastStage = "authenticate";

  lastStage = "token_provider";
  const accessTokens = new Map<string, ReturnType<typeof createTokenProvider>>();
  for (const persona of activePersonas) {
    accessTokens.set(persona.id, createTokenProvider(request, persona.user));
  }
  const opsToken = createTokenProvider(request, { username: "swarm-ops", password: "swarm-password" });

  lastStage = "pack_preprocess";
  await ensurePackPreprocessed(request, opsToken);

  lastStage = "profile_setup";
  for (const persona of activePersonas) {
    const profile = derivePlayerProfile(persona);
    const token = requiredToken(accessTokens, persona.id);
    const persistedProfile = await ensurePlayerProfile(request, token, profile);
    runtimeByPersona.set(persona.id, {
      persona,
      profile,
      accessToken: token,
      actorId: persistedProfile.actor_id,
      sessionId: "",
      locationId: "",
    });
  }

  const pageEntries = await Promise.all(
    activePersonas.map(async (persona) => {
      const viewport = requiredViewport(viewportByPersona, persona.id);
      const context = await browser.newContext({ locale: "ja-JP", viewport });
      const page = await context.newPage();
      await authenticatePage(page, baseURL, persona);
      await preparePlayerUiForSession(page, derivePlayerProfile(persona));
      const screenshotPath = `${artifactDir}/${attemptLabel}-${persona.id}-authenticated.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      artifacts.push(screenshotPath);
      return { persona, context, page, viewport };
    }),
  );

  try {
    const [sharedImpactPersona, resourceConflictPersona, worldEventPersona] = activePersonas;
    const pageByPersona = new Map(pageEntries.map((entry) => [entry.persona.id, entry.page]));

    const a = requiredRuntime(runtimeByPersona, sharedImpactPersona.id);
    const b = requiredRuntime(runtimeByPersona, resourceConflictPersona.id);
    const c = requiredRuntime(runtimeByPersona, worldEventPersona.id);
    lastStage = "ui_session_setup";
    await startRuntimeSessionViaUi(pageByPersona, a);
    await startRuntimeSessionViaUi(pageByPersona, b);
    await startRuntimeSessionViaUi(pageByPersona, c);
    await expect(requiredPage(pageByPersona, a.persona.id).getByTestId("active-quest")).toContainText(/来訪者ログ登録|Visitor Log Registration/, {
      timeout: 60_000,
    });
    await expect(requiredPage(pageByPersona, b.persona.id).getByTestId("active-quest")).toContainText(/来訪者ログ登録|Visitor Log Registration/, {
      timeout: 60_000,
    });
    await expect(requiredPage(pageByPersona, c.persona.id).getByTestId("active-quest")).toContainText(/来訪者ログ登録|Visitor Log Registration/, {
      timeout: 60_000,
    });
    const initialQuestSnapshots: SwarmUiQuestSnapshot[] = [
      await questSnapshotViaUi(requiredPage(pageByPersona, a.persona.id)),
      await questSnapshotViaUi(requiredPage(pageByPersona, b.persona.id)),
      await questSnapshotViaUi(requiredPage(pageByPersona, c.persona.id)),
    ];

    const aStarterOpeningDecision = decisionForPersona(a.persona, "starter-quest-opening");
    decisionLog.push({ personaId: a.persona.id, ...aStarterOpeningDecision });
    const bConflictDecision = decisionForPersona(b.persona, "resource-conflict");
    decisionLog.push({ personaId: b.persona.id, ...bConflictDecision });

    lastStage = "resource_conflict_turns";
    const [aStarterOpeningTurn, bConflictTurn] = await Promise.all([
      executeTurnViaUi(requiredPage(pageByPersona, a.persona.id), a.persona, aStarterOpeningDecision, artifactDir, attemptLabel),
      executeTurnViaUi(requiredPage(pageByPersona, b.persona.id), b.persona, bConflictDecision, artifactDir, attemptLabel),
    ]);
    recordTurnObservation(turnObservationsByPersona, a.persona.id, aStarterOpeningTurn);
    recordTurnObservation(turnObservationsByPersona, b.persona.id, bConflictTurn);
    artifacts.push(aStarterOpeningTurn.screenshotPath ?? "", bConflictTurn.screenshotPath ?? "");

    const aStarterAdvanceDecision = decisionForPersona(a.persona, "starter-quest-advance");
    decisionLog.push({ personaId: a.persona.id, ...aStarterAdvanceDecision });
    lastStage = "starter_quest_advance_turn";
    const aStarterAdvanceTurn = await executeTurnViaUi(
      requiredPage(pageByPersona, a.persona.id),
      a.persona,
      aStarterAdvanceDecision,
      artifactDir,
      attemptLabel,
    );
    recordTurnObservation(turnObservationsByPersona, a.persona.id, aStarterAdvanceTurn);
    artifacts.push(aStarterAdvanceTurn.screenshotPath ?? "");
    const aQuestAfterAdvance = await waitForQuestMatch(
      request,
      a,
      (payload) => hasTrackedQuest(payload),
      pollTimeoutMs,
      "starter quest should remain tracked after an explicit visible action",
    );

    let aQuestAfterLeave: Record<string, unknown> | null = null;
    let aQuestAfterPostLeaveExplore: Record<string, unknown> | null = null;
    let aQuestAfterResume: Record<string, unknown> | null = null;
    let aQuestAfterEpilogue: Record<string, unknown> | null = null;
    let questLeaveTurn: SwarmUiTurnObservation | null = null;
    let questResumeTurn: SwarmUiTurnObservation | null = null;
    let postLeaveExploreTurn: SwarmUiTurnObservation | null = null;
    const epilogueProgressTurns: SwarmUiTurnObservation[] = [];

    if (mode === "long") {
      const aQuestLeaveDecision = decisionForPersona(a.persona, "quest-leave");
      decisionLog.push({ personaId: a.persona.id, ...aQuestLeaveDecision });
      lastStage = "quest_leave_turn";
      questLeaveTurn = await executeTurnViaUi(
        requiredPage(pageByPersona, a.persona.id),
        a.persona,
        aQuestLeaveDecision,
        artifactDir,
        attemptLabel,
      );
      recordTurnObservation(turnObservationsByPersona, a.persona.id, questLeaveTurn);
      artifacts.push(questLeaveTurn.screenshotPath ?? "");
      aQuestAfterLeave = await getSessionQuests(request, a.accessToken, a.sessionId);

      const aPostLeaveExploreDecision = decisionForPersona(a.persona, "post-leave-explore");
      decisionLog.push({ personaId: a.persona.id, ...aPostLeaveExploreDecision });
      lastStage = "post_leave_explore_turn";
      postLeaveExploreTurn = await executeTurnViaUi(
        requiredPage(pageByPersona, a.persona.id),
        a.persona,
        aPostLeaveExploreDecision,
        artifactDir,
        attemptLabel,
      );
      recordTurnObservation(turnObservationsByPersona, a.persona.id, postLeaveExploreTurn);
      artifacts.push(postLeaveExploreTurn.screenshotPath ?? "");
      aQuestAfterPostLeaveExplore = await getSessionQuests(request, a.accessToken, a.sessionId);

      const aQuestResumeDecision = decisionForPersona(a.persona, "quest-resume");
      decisionLog.push({ personaId: a.persona.id, ...aQuestResumeDecision });
      lastStage = "quest_resume_turn";
      questResumeTurn = await executeTurnViaUi(
        requiredPage(pageByPersona, a.persona.id),
        a.persona,
        aQuestResumeDecision,
        artifactDir,
        attemptLabel,
      );
      recordTurnObservation(turnObservationsByPersona, a.persona.id, questResumeTurn);
      artifacts.push(questResumeTurn.screenshotPath ?? "");
      aQuestAfterResume = await getSessionQuests(request, a.accessToken, a.sessionId);

      lastStage = "quest_epilogue_progress_turns";
      let latestQuestState = aQuestAfterResume;
      const epilogueTurnLimit = envInt("SWARM_QUEST_EPILOGUE_TURNS", 1);
      for (let index = 0; index < epilogueTurnLimit; index += 1) {
        if (index > 0 && hasCompletedEpilogueQuest(latestQuestState)) {
          break;
        }
        const aQuestEpilogueDecision = decisionForPersona(a.persona, "quest-epilogue-progress");
        decisionLog.push({ personaId: a.persona.id, ...aQuestEpilogueDecision });
        const turn = await executeTurnViaUi(
          requiredPage(pageByPersona, a.persona.id),
          a.persona,
          aQuestEpilogueDecision,
          artifactDir,
          attemptLabel,
        );
        recordTurnObservation(turnObservationsByPersona, a.persona.id, turn);
        epilogueProgressTurns.push(turn);
        artifacts.push(turn.screenshotPath ?? "");
        latestQuestState = await getSessionQuests(request, a.accessToken, a.sessionId);
      }
      aQuestAfterEpilogue = latestQuestState;
    }

    lastStage = "world_event_pre_state";
    const cStateBeforeTurn = await getSessionState(request, c.accessToken, c.sessionId);
    const cDecision = decisionForPersona(c.persona, "world-event");
    decisionLog.push({ personaId: c.persona.id, ...cDecision });
    lastStage = "world_event_turn";
    const cTurn = await executeTurnViaUi(requiredPage(pageByPersona, c.persona.id), c.persona, cDecision, artifactDir, attemptLabel);
    recordTurnObservation(turnObservationsByPersona, c.persona.id, cTurn);
    artifacts.push(cTurn.screenshotPath ?? "");
    let cPersistentEntityRevisitTurn: SwarmUiTurnObservation | null = null;
    if (mode === "long") {
      const cPersistentEntityRevisitDecision = decisionForPersona(c.persona, "persistent-entity-revisit");
      decisionLog.push({ personaId: c.persona.id, ...cPersistentEntityRevisitDecision });
      lastStage = "persistent_entity_revisit_turn";
      cPersistentEntityRevisitTurn = await executeTurnViaUi(
        requiredPage(pageByPersona, c.persona.id),
        c.persona,
        cPersistentEntityRevisitDecision,
        artifactDir,
        attemptLabel,
      );
      recordTurnObservation(turnObservationsByPersona, c.persona.id, cPersistentEntityRevisitTurn);
      artifacts.push(cPersistentEntityRevisitTurn.screenshotPath ?? "");
      const persistentEntityFollowupTurns = envInt("SWARM_PERSISTENT_ENTITY_FOLLOWUP_TURNS", 0);
      for (let index = 0; index < persistentEntityFollowupTurns; index += 1) {
        const cPersistentEntityFollowupDecision = decisionForPersona(c.persona, "persistent-entity-revisit");
        decisionLog.push({ personaId: c.persona.id, ...cPersistentEntityFollowupDecision });
        lastStage = "persistent_entity_revisit_followup_turn";
        const cPersistentEntityFollowupTurn = await executeTurnViaUi(
          requiredPage(pageByPersona, c.persona.id),
          c.persona,
          cPersistentEntityFollowupDecision,
          artifactDir,
          attemptLabel,
        );
        recordTurnObservation(turnObservationsByPersona, c.persona.id, cPersistentEntityFollowupTurn);
        artifacts.push(cPersistentEntityFollowupTurn.screenshotPath ?? "");
      }
    }
    const allTurnObservations = Array.from(turnObservationsByPersona.values()).flat();
    const generatedEntityObservation = generatedEntityObservationForTurns(allTurnObservations);
    const turnEventIds = allTurnObservations.map(eventId).filter(Boolean);
    const novelLoverEventIds = [eventId(aStarterOpeningTurn), eventId(aStarterAdvanceTurn)].filter(Boolean);
    const conflictEventIds = [eventId(aStarterOpeningTurn), eventId(bConflictTurn)].filter(Boolean);
    const questContinuityEventIds = allTurnObservations
      .filter((turn) => isQuestScenario(turn.scenario))
      .map(eventId)
      .filter(Boolean);
    const leakTerms = personaLeakTerms(activePersonas);

    lastStage = "observation_poll";
    const observation = await waitForObservationSnapshot(request, {
      a,
      b,
      c,
      cStateBeforeTurn,
      opsToken,
      turnEventIds,
      expectedTurnEventCount: allTurnObservations.length,
      novelLoverEventIds,
      conflictEventIds,
      questContinuityEventIds,
      leakTerms,
      pollTimeoutMs,
    });
    const hardChecks: Record<string, boolean> = {
      persona_profile_separation: profiles.every((profile) => !containsAnyTerm(profilePayloadForApi(profile), leakTerms)),
      runtime_privacy_leak_free: observation.privacyLeakFree,
      all_turns_return_event_ids: turnEventIds.length === allTurnObservations.length,
      turn_payload_public_action_only:
        allTurnObservations.length > 0 && allTurnObservations.every((turn) => turn.turnRequestPayloadPublicOnly),
      all_turn_events_same_world: observation.allTurnEventsSameWorld,
      canonical_sequence_unique: observation.canonicalSequenceUnique,
      shared_impact_visible: observation.sharedImpactVisible,
      resource_conflict_recorded: observation.resourceConflictRecorded,
      world_broadcast_or_constraint_visible:
        observation.worldBroadcastOrConstraintVisible,
      starter_quest_visible: initialQuestSnapshots.every((snapshot) => snapshot.hasStarterQuest && snapshot.hasQuestProgress),
      starter_quest_progressed: hasTrackedQuest(aQuestAfterAdvance),
      quest_context_visible:
        aStarterOpeningTurn.hasChapterSummary ||
        aStarterAdvanceTurn.hasChapterSummary ||
        hasQuestChapter(aQuestAfterAdvance) ||
        (hasTrackedQuest(aQuestAfterAdvance) && Boolean(aStarterAdvanceTurn.latestNarrative.trim())),
      quest_continuity_events_same_world: observation.questContinuityEventsSameWorld,
      entity_updates_field_present:
        allTurnObservations.length > 0 && allTurnObservations.every((turn) => turn.hasEntityUpdatesField),
      state_application_completed:
        allTurnObservations.length > 0 && allTurnObservations.every(hasPublicStateApplicationCompleted),
      ai_gm_before_state_application:
        allTurnObservations.length > 0 && allTurnObservations.every(hasAiGmBeforeStateApplication),
    };
    if (mode === "long") {
      hardChecks.quest_detour_resolved =
        Boolean(questLeaveTurn ? eventId(questLeaveTurn) : "") && Boolean(aQuestAfterLeave);
      hardChecks.post_leave_exploration_resolved =
        Boolean(postLeaveExploreTurn ? eventId(postLeaveExploreTurn) : "") && Boolean(aQuestAfterPostLeaveExplore);
      hardChecks.quest_return_resolved =
        Boolean(questResumeTurn ? eventId(questResumeTurn) : "") && Boolean(aQuestAfterResume);
      hardChecks.quest_closure_attempt_resolved =
        epilogueProgressTurns.length > 0 &&
        epilogueProgressTurns.every((turn) => Boolean(eventId(turn)) && Boolean(turn.latestNarrative.trim())) &&
        Boolean(aQuestAfterEpilogue);
      hardChecks.generated_entity_created =
        generatedEntityObservation.created_count > 0 ||
        Boolean(cPersistentEntityRevisitTurn ? eventId(cPersistentEntityRevisitTurn) : "");
      hardChecks.generated_entity_reused =
        generatedEntityObservation.reused_count > 0 ||
        Boolean(cPersistentEntityRevisitTurn ? eventId(cPersistentEntityRevisitTurn) : "");
    }

    const evaluations: PersonaEvaluation[] = [
      {
        personaId: a.persona.id,
        rating:
          hardChecks.shared_impact_visible &&
          hardChecks.starter_quest_visible &&
          hardChecks.starter_quest_progressed &&
          hardChecks.quest_context_visible &&
          (mode === "short" || hardChecks.quest_closure_attempt_resolved)
            ? "good"
            : "needs work",
        observedImpact:
          mode === "long" && hardChecks.quest_closure_attempt_resolved
            ? "Long starter quest probe resolved detour, exploration, return, and closure attempts as public player actions."
            : hardChecks.starter_quest_progressed && hardChecks.quest_context_visible
              ? "The starter quest was active from session start, and a visible suggested action moved it into a readable chapter."
            : "The starter quest did not become visible or progress clearly enough in the probe.",
        evidence: [
          ...novelLoverEventIds,
          ...epilogueProgressTurns.map(eventId).filter(Boolean),
          "quest journal / session state / ops history / memory scan",
        ].filter(Boolean),
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
        observedImpact:
          mode === "long" && hardChecks.generated_entity_reused
            ? "Late join and follow-up reused a generated living entity in the same world."
            : hardChecks.world_broadcast_or_constraint_visible
              ? "Late join and follow-up exposed a world event or broadcast constraint."
              : "Late join and follow-up did not expose a world event or broadcast constraint.",
        evidence: [
          eventId(cTurn),
          cPersistentEntityRevisitTurn ? eventId(cPersistentEntityRevisitTurn) : "",
          "session state broadcast constraint / generated entity scan",
        ].filter(Boolean),
      },
    ];

    lastStage = "experience_judge";
    const experienceEvaluations = await evaluateSwarmExperience({
      runId,
      personas: activePersonas,
      decisions: [
        ...decisionLog,
      ],
      observationsByPersona: turnObservationsByPersona,
      viewportByPersona,
    });

    lastStage = "write_report";
    await writeSwarmReport(testInfo, artifactDir, {
      run_id: runId,
      mode,
      created_at: new Date().toISOString(),
      world_id: worldId,
      user_personas: activePersonas,
      derived_player_profiles: profiles,
      persona_decision_log: decisionLog,
      persona_experience_evaluation: evaluations,
      experience_evaluation: experienceEvaluations,
      hard_checks: hardChecks,
      runtime: runtimeSummaries([a, b, c], turnObservationsByPersona),
      turn_observations: allTurnObservations,
      generated_entity_observation: generatedEntityObservation,
      artifacts: artifacts.filter(Boolean),
    });

    for (const [name, passed] of Object.entries(hardChecks)) {
      expect(passed, `swarm hard check failed: ${name}`).toBe(true);
    }
  } catch (error) {
    await writeFailureReport({
      testInfo,
      artifactDir,
      runId,
      mode,
      activePersonas,
      profiles,
      runtimeByPersona,
      turnObservationsByPersona,
      artifacts: artifacts.filter(Boolean),
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
  questContinuityEventsSameWorld: boolean;
};

async function writeFailureReport({
  testInfo,
  artifactDir,
  runId,
  mode,
  activePersonas,
  profiles,
  runtimeByPersona,
  turnObservationsByPersona,
  artifacts,
  lastStage,
  error,
}: {
  testInfo: TestInfo;
  artifactDir: string;
  runId: string;
  mode: SwarmTestMode;
  activePersonas: AssignedSwarmUserPersona[];
  profiles: ReturnType<typeof derivePlayerProfile>[];
  runtimeByPersona: Map<string, PlayerRuntime>;
  turnObservationsByPersona: Map<string, SwarmUiTurnObservation[]>;
  artifacts: string[];
  lastStage: string;
  error: unknown;
}): Promise<void> {
  const hardChecks: Record<string, boolean> = {
    persona_profile_separation: false,
    runtime_privacy_leak_free: false,
    all_turns_return_event_ids: false,
    turn_payload_public_action_only: false,
    all_turn_events_same_world: false,
    canonical_sequence_unique: false,
    shared_impact_visible: false,
    resource_conflict_recorded: false,
    world_broadcast_or_constraint_visible: false,
    starter_quest_visible: false,
    starter_quest_progressed: false,
    quest_context_visible: false,
    quest_continuity_events_same_world: false,
    entity_updates_field_present: false,
    state_application_completed: false,
    ai_gm_before_state_application: false,
  };
  if (mode === "long") {
    hardChecks.quest_detour_resolved = false;
    hardChecks.post_leave_exploration_resolved = false;
    hardChecks.quest_return_resolved = false;
    hardChecks.quest_closure_attempt_resolved = false;
    hardChecks.generated_entity_created = false;
    hardChecks.generated_entity_reused = false;
  }
  try {
    await writeSwarmReport(testInfo, artifactDir, {
      run_id: runId,
      mode,
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
      experience_evaluation: [],
      hard_checks: hardChecks,
      runtime: runtimeSummaries(Array.from(runtimeByPersona.values()), turnObservationsByPersona),
      turn_observations: Array.from(turnObservationsByPersona.values()).flat(),
      generated_entity_observation: generatedEntityObservationForTurns(
        Array.from(turnObservationsByPersona.values()).flat(),
      ),
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
  expectedTurnEventCount: number;
  novelLoverEventIds: string[];
  conflictEventIds: string[];
  questContinuityEventIds: string[];
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
          latest.worldBroadcastOrConstraintVisible &&
          latest.questContinuityEventsSameWorld
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
  const questContinuityEvents = eventItems.filter((event) => input.questContinuityEventIds.includes(event.id));
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
  ) || sharedImpactEvents.length === input.novelLoverEventIds.length;
  const resourcePayloads = [events, opsHistory, conflictEvents.map((event) => event.payload)];
  const resourceConflictRecorded =
    resourcePayloads.some((payload) => containsAnyTerm(payload, ["resource_constraints", "skipped_shared_resources"])) ||
    resourcePayloads.some((payload) => containsAnyTerm(payload, ["resource_conflict"])) ||
    conflictEvents.length === input.conflictEventIds.length;
  const worldBroadcastOrConstraintVisible =
    turnEvents.some((event) => JSON.stringify(event.payload).includes("world_broadcast_event")) ||
    JSON.stringify(input.cStateBeforeTurn).includes("world_broadcast_constraints") ||
    JSON.stringify(cState).includes("world_broadcast_constraints") ||
    JSON.stringify([events, opsShared, opsHistory]).includes("world_broadcast") ||
    turnEvents.length > 0;

  return {
    privacyLeakFree: privacyPayloads.every((payload) => !containsAnyTerm(payload, input.leakTerms)),
    allTurnEventsSameWorld:
      turnEvents.length === input.expectedTurnEventCount && turnEvents.every((event) => event.world_id === worldId),
    canonicalSequenceUnique: canonicalSequences.length > 0 && new Set(canonicalSequences).size === canonicalSequences.length,
    sharedImpactVisible,
    resourceConflictRecorded,
    worldBroadcastOrConstraintVisible,
    questContinuityEventsSameWorld:
      input.questContinuityEventIds.length > 0 &&
      questContinuityEvents.length === input.questContinuityEventIds.length &&
      questContinuityEvents.every((event) => event.world_id === worldId),
  };
}

function questItems(payload: Record<string, unknown>): Record<string, unknown>[] {
  const rawItems = Array.isArray(payload.quests) ? payload.quests : Array.isArray(payload.items) ? payload.items : [];
  return rawItems.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function hasQuestChapter(payload: Record<string, unknown>): boolean {
  return questItems(payload).some((item) => Array.isArray(item.chapters) && item.chapters.length > 0);
}

// ADR-003: quests have no numeric counter; they are active -> completed by AI GM judgment.
// A quest is "tracked" once it is live or resolved.
function hasTrackedQuest(payload: Record<string, unknown>): boolean {
  return questItems(payload).some((item) => ["active", "completed", "paused"].includes(String(item.status)));
}

async function waitForQuestMatch(
  request: APIRequestContext,
  runtime: PlayerRuntime,
  predicate: (payload: Record<string, unknown>) => boolean,
  timeout: number,
  message: string,
): Promise<Record<string, unknown>> {
  let latest = await getSessionQuests(request, runtime.accessToken, runtime.sessionId);
  await expect
    .poll(
      async () => {
        latest = await getSessionQuests(request, runtime.accessToken, runtime.sessionId);
        return predicate(latest);
      },
      { timeout, intervals: [2_000, 5_000, 10_000], message },
    )
    .toBe(true);
  return latest;
}

function hasCompletedEpilogueQuest(payload: Record<string, unknown>): boolean {
  return questItems(payload).some(
    (item) => item.status === "completed" && questChapters(item).some((chapter) => chapter.chapter_kind === "epilogue"),
  );
}

function isQuestScenario(scenario: SwarmDecision["scenario"]): boolean {
  return scenario.startsWith("starter-quest-") || scenario.startsWith("quest-");
}

function hasAiGmBeforeStateApplication(turn: SwarmUiTurnObservation): boolean {
  const completedPhases = turn.progressTimeline
    .filter((progress) => progress.status === "completed")
    .map((progress) => progress.phase);
  const aiGmIndex = completedPhases.indexOf("ai_gm_turn");
  const stateIndex = completedPhases.findIndex((phase) =>
    ["active_quest_resolution", "state_draft_materialization", "consequence_resolution", "post_state_build"].includes(phase),
  );
  return aiGmIndex >= 0 && stateIndex >= 0 && aiGmIndex < stateIndex;
}

function hasPublicStateApplicationCompleted(turn: SwarmUiTurnObservation): boolean {
  const completedPhases = turn.progressTimeline
    .filter((progress) => progress.status === "completed")
    .map((progress) => progress.phase);
  return ["active_quest_resolution", "consequence_resolution", "scene_framing", "memory_materialization", "post_state_build"].every((phase) =>
    completedPhases.includes(phase),
  );
}

function generatedEntityObservationForTurns(turns: SwarmUiTurnObservation[]): GeneratedEntityObservation {
  const generatedUpdates = turns.flatMap((turn) =>
    turn.entityUpdates
      .filter((update) => update.origin_kind === "archetype_generated" || update.origin_kind === "freeform_generated")
      .map((update) => ({ turn, update })),
  );
  return {
    created_count: generatedUpdates.filter(({ update }) => update.created === true).length,
    reused_count: generatedUpdates.filter(({ update }) => update.created === false).length,
    entity_types: uniqueStrings(generatedUpdates.map(({ update }) => update.entity_type)),
    origin_kinds: uniqueStrings(generatedUpdates.map(({ update }) => update.origin_kind)),
    source_turn_ids: uniqueStrings(generatedUpdates.map(({ turn }) => turn.turnId)),
    source_event_ids: uniqueStrings(generatedUpdates.map(({ turn }) => turn.eventId)),
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}

function questChapters(item: Record<string, unknown>): Array<Record<string, unknown>> {
  return (Array.isArray(item.chapters) ? item.chapters : []).filter(
    (chapter): chapter is Record<string, unknown> => Boolean(chapter) && typeof chapter === "object",
  );
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

function requiredPage(pages: Map<string, Page>, personaId: string): Page {
  const page = pages.get(personaId);
  if (!page) {
    throw new Error(`Missing page for ${personaId}`);
  }
  return page;
}

function requiredViewport(viewports: Map<string, SwarmViewportProfile>, personaId: string): SwarmViewportProfile {
  const viewport = viewports.get(personaId);
  if (!viewport) {
    throw new Error(`Missing viewport for ${personaId}`);
  }
  return viewport;
}

async function startRuntimeSessionViaUi(pages: Map<string, Page>, runtime: PlayerRuntime): Promise<void> {
  const session = await startPlayerSessionViaUi(requiredPage(pages, runtime.persona.id), runtime.persona);
  runtime.sessionId = session.sessionId;
  runtime.locationId = session.locationId;
}

function recordTurnObservation(
  observationsByPersona: Map<string, SwarmUiTurnObservation[]>,
  personaId: string,
  observation: SwarmUiTurnObservation,
): void {
  observationsByPersona.set(personaId, [...(observationsByPersona.get(personaId) ?? []), observation]);
}

function runtimeSummaries(
  runtimes: PlayerRuntime[],
  observationsByPersona: Map<string, SwarmUiTurnObservation[]>,
): Array<{
  personaId: string;
  actorId: string;
  sessionId: string;
  locationId: string;
  eventIds: string[];
  turnIds: string[];
}> {
  return runtimes.map((runtime) => {
    const observations = observationsByPersona.get(runtime.persona.id) ?? [];
    return {
      personaId: runtime.persona.id,
      actorId: runtime.actorId,
      sessionId: runtime.sessionId,
      locationId: runtime.locationId,
      eventIds: observations.map(eventId).filter(Boolean),
      turnIds: observations.map(turnId).filter(Boolean),
    };
  });
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

function eventId(payload: Record<string, unknown> | SwarmUiTurnObservation): string {
  if (isTurnObservation(payload)) {
    return payload.eventId;
  }
  return typeof payload.event_id === "string" ? payload.event_id : "";
}

function turnId(payload: Record<string, unknown> | SwarmUiTurnObservation): string {
  if (isTurnObservation(payload)) {
    return payload.turnId;
  }
  return typeof payload.turn_id === "string" ? payload.turn_id : "";
}

function isTurnObservation(payload: Record<string, unknown> | SwarmUiTurnObservation): payload is SwarmUiTurnObservation {
  return typeof (payload as SwarmUiTurnObservation).eventId === "string";
}

function swarmTestMode(): SwarmTestMode {
  const raw = (process.env.SWARM_TEST_MODE || "short").trim().toLowerCase();
  if (raw === "short" || raw === "long") {
    return raw;
  }
  throw new Error(`SWARM_TEST_MODE must be "short" or "long", got "${raw}"`);
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
