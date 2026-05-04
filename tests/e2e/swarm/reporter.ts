import fs from "node:fs/promises";
import path from "node:path";

import type { TestInfo } from "@playwright/test";

import type { DerivedPlayerProfile } from "./playerProfiles";
import type { SwarmDecision } from "./playbook";
import type { SwarmExperienceEvaluation, ExperienceDimension } from "./experienceJudge";
import type { SwarmUiTurnObservation } from "./uiDriver";
import type { SwarmUserPersona } from "./userPersonas";

export type PersonaEvaluation = {
  personaId: string;
  rating: "good" | "acceptable" | "needs work" | "blocked";
  observedImpact: string;
  evidence: string[];
};

export type SwarmReport = {
  run_id: string;
  mode?: "short" | "long";
  created_at: string;
  world_id: string;
  user_personas: SwarmUserPersona[];
  derived_player_profiles: DerivedPlayerProfile[];
  persona_decision_log: Array<SwarmDecision & { personaId: string }>;
  persona_experience_evaluation: PersonaEvaluation[];
  experience_evaluation: SwarmExperienceEvaluation[];
  hard_checks: Record<string, boolean>;
  runtime: Array<{
    personaId: string;
    actorId: string;
    sessionId: string;
    locationId: string;
    eventIds: string[];
    turnIds: string[];
  }>;
  turn_observations?: SwarmUiTurnObservation[];
  generated_entity_observation?: GeneratedEntityObservation;
  artifacts: string[];
  failure_diagnostics?: {
    stage: string;
    message: string;
    stack?: string;
  };
};

export type GeneratedEntityObservation = {
  created_count: number;
  reused_count: number;
  entity_types: string[];
  origin_kinds: string[];
  source_turn_ids: string[];
  source_event_ids: string[];
};

export function buildRunId(): string {
  if (process.env.SWARM_RUN_ID?.trim()) {
    return process.env.SWARM_RUN_ID.trim();
  }
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function defaultArtifactDir(runId: string): string {
  if (process.env.SWARM_ARTIFACT_DIR?.trim()) {
    return process.env.SWARM_ARTIFACT_DIR.trim();
  }
  if (process.env.SWARM_RUN_GROUP_DIR?.trim()) {
    return path.join(process.env.SWARM_RUN_GROUP_DIR.trim(), `swarm-test-${runId}`);
  }
  return path.resolve(process.cwd(), "../documents/testplay-reports/artifacts", "swarm-test-local", `swarm-test-${runId}`);
}

export async function writeSwarmReport(testInfo: TestInfo, artifactDir: string, report: SwarmReport): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  const attemptLabel = `attempt-${testInfo.retry + 1}`;
  const jsonPath = path.join(artifactDir, `swarm-test-result-${attemptLabel}.json`);
  const markdownPath = path.join(artifactDir, `swarm-test-report-${attemptLabel}.md`);
  const latestJsonPath = path.join(artifactDir, "swarm-test-result.json");
  const latestMarkdownPath = path.join(artifactDir, "swarm-test-report.md");
  const attemptSummaryJsonPath = path.join(artifactDir, "swarm-test-attempt-summary-result.json");
  const attemptSummaryMarkdownPath = path.join(artifactDir, "swarm-test-attempt-summary-report.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, markdownReport(report, attemptLabel), "utf8");
  await fs.copyFile(jsonPath, latestJsonPath);
  await fs.copyFile(markdownPath, latestMarkdownPath);
  const attemptSummary = await buildAttemptSummaryReport(artifactDir);
  await fs.writeFile(attemptSummaryJsonPath, `${JSON.stringify(attemptSummary, null, 2)}\n`, "utf8");
  await fs.writeFile(attemptSummaryMarkdownPath, attemptSummaryMarkdownReport(attemptSummary), "utf8");
  const runGroupDir = process.env.SWARM_RUN_GROUP_DIR?.trim();
  if (runGroupDir) {
    await writeRunGroupAggregateReport(runGroupDir, process.env.SWARM_RUN_GROUP_ID?.trim() ?? path.basename(runGroupDir));
  }
  await testInfo.attach("swarm-test-result", {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach("swarm-test-report", {
    path: markdownPath,
    contentType: "text/markdown",
  });
  await testInfo.attach("swarm-test-attempt-summary-report", {
    path: attemptSummaryMarkdownPath,
    contentType: "text/markdown",
  });
  if (runGroupDir) {
    await testInfo.attach("swarm-test-run-group-aggregate-report", {
      path: path.join(runGroupDir, "swarm-test-aggregate-report.md"),
      contentType: "text/markdown",
    });
  }
}

export async function writeRunGroupAggregateReport(runGroupDir: string, runGroupId: string): Promise<void> {
  await fs.mkdir(runGroupDir, { recursive: true });
  const report = await buildRunGroupAggregateReport(runGroupDir, runGroupId);
  await fs.writeFile(
    path.join(runGroupDir, "swarm-test-aggregate-result.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(runGroupDir, "swarm-test-aggregate-report.md"),
    runGroupAggregateMarkdownReport(report),
    "utf8",
  );
}

type RunGroupRun = {
  run_id: string;
  run_dir: string;
  mode: "short" | "long";
  created_at: string | null;
  world_id: string | null;
  status: "pass" | "fail" | "blocked";
  result_file: string | null;
  report_file: string | null;
  hard_checks: Record<string, boolean>;
  persona_ratings: Record<string, PersonaEvaluation["rating"]>;
  persona_observed_impacts: Record<string, string>;
  experience_warning_count: number;
  experience_warnings: string[];
  experience_overall_ratings: Record<string, SwarmExperienceEvaluation["overall"]["rating"]>;
  experience_evaluations: SwarmExperienceEvaluation[];
  story_observations: RunStoryObservation[];
  turn_timing_observations: SwarmUiTurnObservation[];
  generated_entity_observation: GeneratedEntityObservation;
};

type RunStoryObservation = {
  personaId: string;
  personaLabel: string;
  scenario: SwarmDecision["scenario"];
  action: string;
  expectedWorldImpact: string;
  observedImpact: string | null;
  rating: PersonaEvaluation["rating"] | null;
  locationId: string | null;
  eventIds: string[];
  turnIds: string[];
};

type RunGroupAggregateReport = {
  run_group_id: string;
  generated_at: string;
  run_group_dir: string;
  run_count: number;
  completed_run_count: number;
  passed_run_count: number;
  failed_run_count: number;
  blocked_run_count: number;
  latest_completed_run_id: string | null;
  latest_completed_result: "pass" | "fail" | null;
  runs: RunGroupRun[];
  hard_check_summary: Record<
    string,
    {
      latest: boolean | null;
      passed_runs: number;
      completed_runs: number;
    }
  >;
  persona_experience_summary: Array<{
    personaId: string;
    latestRating: PersonaEvaluation["rating"] | null;
    latestObservedImpact: string | null;
    ratings: Record<PersonaEvaluation["rating"], number>;
    runs: Array<{
      run_id: string;
      rating: PersonaEvaluation["rating"];
      observedImpact: string;
    }>;
  }>;
  scenario_story_summary: Array<{
    scenario: SwarmDecision["scenario"];
    completed_runs: number;
    observed_runs: number;
    event_count: number;
    latestObservedImpact: string | null;
    runs: Array<{
      run_id: string;
      observed: boolean;
      story: string;
      worldImpact: string;
      eventIds: string[];
    }>;
  }>;
  experience_summary: {
    warning_count: number;
    warning_runs: number;
    dimensions: Record<
      ExperienceDimension,
      {
        average_score: number | null;
        ratings: Record<SwarmExperienceEvaluation["overall"]["rating"], number>;
      }
    >;
    personas: Array<{
      personaId: string;
      latestOverallRating: SwarmExperienceEvaluation["overall"]["rating"] | null;
      latestOverallScore: number | null;
      warnings: string[];
    }>;
  };
  turn_timing_summary: {
    turn_count: number;
    http_duration_ms: DurationSummary;
    final_resolution_duration_ms: DurationSummary;
    phase_durations: Array<{
      phase: string;
      sample_count: number;
      duration_ms: DurationSummary;
    }>;
  };
  generated_entity_summary: GeneratedEntityObservation;
};

type DurationSummary = {
  p50: number | null;
  p95: number | null;
  max: number | null;
};

async function buildRunGroupAggregateReport(
  runGroupDir: string,
  runGroupId: string,
): Promise<RunGroupAggregateReport> {
  const entries = await fs.readdir(runGroupDir, { withFileTypes: true });
  const runDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("swarm-test-"))
    .map((entry) => entry.name)
    .sort();
  const runs = await Promise.all(runDirs.map((runDir) => readRunGroupRun(runGroupDir, runDir)));
  const completedRuns = runs.filter((run) => run.status !== "blocked");
  const latestCompletedRun = completedRuns[completedRuns.length - 1] ?? null;
  const hardCheckKeys = Array.from(new Set(completedRuns.flatMap((run) => Object.keys(run.hard_checks))));
  const personaIds = Array.from(new Set(completedRuns.flatMap((run) => Object.keys(run.persona_ratings))));
  const scenarios = Array.from(
    new Set(
      completedRuns.flatMap((run) => run.story_observations.map((observation) => observation.scenario)),
    ),
  );

  return {
    run_group_id: runGroupId,
    generated_at: new Date().toISOString(),
    run_group_dir: runGroupDir,
    run_count: runs.length,
    completed_run_count: completedRuns.length,
    passed_run_count: runs.filter((run) => run.status === "pass").length,
    failed_run_count: runs.filter((run) => run.status === "fail").length,
    blocked_run_count: runs.filter((run) => run.status === "blocked").length,
    latest_completed_run_id: latestCompletedRun?.run_id ?? null,
    latest_completed_result:
      latestCompletedRun?.status === "pass" || latestCompletedRun?.status === "fail" ? latestCompletedRun.status : null,
    runs,
    hard_check_summary: Object.fromEntries(
      hardCheckKeys.map((key) => [
        key,
        {
          latest: latestCompletedRun ? latestCompletedRun.hard_checks[key] === true : null,
          passed_runs: completedRuns.filter((run) => run.hard_checks[key] === true).length,
          completed_runs: completedRuns.length,
        },
      ]),
    ),
    persona_experience_summary: personaIds.map((personaId) => {
      const personaRuns = completedRuns
        .filter((run) => run.persona_ratings[personaId])
        .map((run) => ({
          run_id: run.run_id,
          rating: run.persona_ratings[personaId],
          observedImpact: run.persona_observed_impacts[personaId],
        }));
      const latest = personaRuns[personaRuns.length - 1] ?? null;
      return {
        personaId,
        latestRating: latest?.rating ?? null,
        latestObservedImpact: latest?.observedImpact ?? null,
        ratings: {
          good: personaRuns.filter((run) => run.rating === "good").length,
          acceptable: personaRuns.filter((run) => run.rating === "acceptable").length,
          "needs work": personaRuns.filter((run) => run.rating === "needs work").length,
          blocked: personaRuns.filter((run) => run.rating === "blocked").length,
        },
        runs: personaRuns,
      };
    }),
    scenario_story_summary: scenarios.map((scenario) => {
      const scenarioRuns = completedRuns.map((run) => {
        const observations = run.story_observations.filter((observation) => observation.scenario === scenario);
        const observed = run.hard_checks[hardCheckForScenario(scenario)] === true;
        return {
          run_id: run.run_id,
          observed,
          story: observations.map((observation) => storyObservationText(observation)).join(" / "),
          worldImpact: Array.from(
            new Set(
              observations
                .map((observation) => observation.observedImpact)
                .filter((impact): impact is string => Boolean(impact))
                .map((impact) => ja(impact)),
            ),
          ).join(" / "),
          eventIds: observations.flatMap((observation) => observation.eventIds),
        };
      });
      const observedScenarioRuns = scenarioRuns.filter((run) => run.worldImpact);
      const latestObservedRun = observedScenarioRuns[observedScenarioRuns.length - 1] ?? null;
      return {
        scenario,
        completed_runs: completedRuns.length,
        observed_runs: scenarioRuns.filter((run) => run.observed).length,
        event_count: scenarioRuns.reduce((total, run) => total + run.eventIds.length, 0),
        latestObservedImpact: latestObservedRun?.worldImpact ?? null,
        runs: scenarioRuns,
      };
    }),
    experience_summary: buildExperienceSummary(completedRuns),
    turn_timing_summary: buildTurnTimingSummary(completedRuns),
    generated_entity_summary: buildGeneratedEntitySummary(completedRuns),
  };
}

async function readRunGroupRun(runGroupDir: string, runDir: string): Promise<RunGroupRun> {
  const runPath = path.join(runGroupDir, runDir);
  const resultFile = await findLatestRunResultFile(runPath);
  if (!resultFile) {
    return {
      run_id: runDir.replace(/^swarm-test-/, ""),
      run_dir: runDir,
      mode: "short",
      created_at: null,
      world_id: null,
      status: "blocked",
      result_file: null,
      report_file: null,
      hard_checks: {},
      persona_ratings: {},
      persona_observed_impacts: {},
      experience_warning_count: 0,
      experience_warnings: [],
      experience_overall_ratings: {},
      experience_evaluations: [],
      story_observations: [],
      turn_timing_observations: [],
      generated_entity_observation: emptyGeneratedEntityObservation(),
    };
  }
  const raw = await fs.readFile(path.join(runPath, resultFile), "utf8");
  const report = JSON.parse(raw) as SwarmReport;
  const experienceEvaluation = report.experience_evaluation ?? [];
  const passed = Object.values(report.hard_checks).every(Boolean);
  return {
    run_id: report.run_id,
    run_dir: runDir,
    mode: report.mode ?? "short",
    created_at: report.created_at,
    world_id: report.world_id,
    status: passed ? "pass" : "fail",
    result_file: path.join(runDir, resultFile),
    report_file: path.join(runDir, reportFileForResultFile(resultFile)),
    hard_checks: report.hard_checks,
    persona_ratings: Object.fromEntries(
      report.persona_experience_evaluation.map((evaluation) => [evaluation.personaId, evaluation.rating]),
    ),
    persona_observed_impacts: Object.fromEntries(
      report.persona_experience_evaluation.map((evaluation) => [evaluation.personaId, evaluation.observedImpact]),
    ),
    experience_warning_count: experienceWarningCount(experienceEvaluation),
    experience_warnings: experienceWarnings(experienceEvaluation),
    experience_overall_ratings: Object.fromEntries(
      experienceEvaluation.map((evaluation) => [evaluation.personaId, evaluation.overall.rating]),
    ),
    experience_evaluations: experienceEvaluation,
    story_observations: buildStoryObservations(report),
    turn_timing_observations: report.turn_observations ?? [],
    generated_entity_observation: report.generated_entity_observation ?? emptyGeneratedEntityObservation(),
  };
}

function emptyGeneratedEntityObservation(): GeneratedEntityObservation {
  return {
    created_count: 0,
    reused_count: 0,
    entity_types: [],
    origin_kinds: [],
    source_turn_ids: [],
    source_event_ids: [],
  };
}

function buildGeneratedEntitySummary(runs: RunGroupRun[]): GeneratedEntityObservation {
  return {
    created_count: runs.reduce((total, run) => total + run.generated_entity_observation.created_count, 0),
    reused_count: runs.reduce((total, run) => total + run.generated_entity_observation.reused_count, 0),
    entity_types: uniqueStrings(runs.flatMap((run) => run.generated_entity_observation.entity_types)),
    origin_kinds: uniqueStrings(runs.flatMap((run) => run.generated_entity_observation.origin_kinds)),
    source_turn_ids: uniqueStrings(runs.flatMap((run) => run.generated_entity_observation.source_turn_ids)),
    source_event_ids: uniqueStrings(runs.flatMap((run) => run.generated_entity_observation.source_event_ids)),
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function buildTurnTimingSummary(runs: RunGroupRun[]): RunGroupAggregateReport["turn_timing_summary"] {
  const turns = runs.flatMap((run) => run.turn_timing_observations);
  const phaseSamples = new Map<string, number[]>();
  for (const turn of turns) {
    for (const progress of turn.progressTimeline ?? []) {
      if (progress.status !== "completed" || !progress.phase || typeof progress.roleElapsedMs !== "number") {
        continue;
      }
      phaseSamples.set(progress.phase, [...(phaseSamples.get(progress.phase) ?? []), progress.roleElapsedMs]);
    }
  }
  return {
    turn_count: turns.length,
    http_duration_ms: durationSummary(turns.map((turn) => turn.httpDurationMs)),
    final_resolution_duration_ms: durationSummary(turns.map((turn) => turn.finalResolutionDurationMs)),
    phase_durations: Array.from(phaseSamples.entries())
      .map(([phase, values]) => ({
        phase,
        sample_count: values.length,
        duration_ms: durationSummary(values),
      }))
      .sort((left, right) => left.phase.localeCompare(right.phase)),
  };
}

function durationSummary(values: number[]): DurationSummary {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) {
    return { p50: null, p95: null, max: null };
  }
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

function percentile(sortedValues: number[], ratio: number): number {
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * ratio) - 1));
  return sortedValues[index];
}

function buildExperienceSummary(runs: RunGroupRun[]): RunGroupAggregateReport["experience_summary"] {
  const evaluations = runs.flatMap((run) => run.experience_evaluations);
  const personaIds = Array.from(new Set(evaluations.map((evaluation) => evaluation.personaId)));
  return {
    warning_count: runs.reduce((total, run) => total + run.experience_warning_count, 0),
    warning_runs: runs.filter((run) => run.experience_warning_count > 0).length,
    dimensions: Object.fromEntries(
      experienceDimensions.map((dimension) => {
        const scores = evaluations
          .map((evaluation) => evaluation[dimension].score)
          .filter((score): score is number => typeof score === "number");
        return [
          dimension,
          {
            average_score: scores.length ? roundScore(scores.reduce((total, score) => total + score, 0) / scores.length) : null,
            ratings: {
              good: evaluations.filter((evaluation) => evaluation[dimension].rating === "good").length,
              acceptable: evaluations.filter((evaluation) => evaluation[dimension].rating === "acceptable").length,
              "needs work": evaluations.filter((evaluation) => evaluation[dimension].rating === "needs work").length,
              blocked: evaluations.filter((evaluation) => evaluation[dimension].rating === "blocked").length,
            },
          },
        ];
      }),
    ) as RunGroupAggregateReport["experience_summary"]["dimensions"],
    personas: personaIds.map((personaId) => {
      const personaEvaluations = evaluations.filter((evaluation) => evaluation.personaId === personaId);
      const latest = personaEvaluations[personaEvaluations.length - 1] ?? null;
      return {
        personaId,
        latestOverallRating: latest?.overall.rating ?? null,
        latestOverallScore: latest?.overall.score ?? null,
        warnings: Array.from(new Set(personaEvaluations.flatMap((evaluation) => evaluation.warnings))).slice(0, 8),
      };
    }),
  };
}

export function experienceWarningCount(evaluations: SwarmExperienceEvaluation[]): number {
  return evaluations.filter((evaluation) => experienceEvaluationHasWarning(evaluation)).length;
}

export function experienceWarnings(evaluations: SwarmExperienceEvaluation[]): string[] {
  return evaluations.flatMap((evaluation) => [
    ...evaluation.warnings.map((warning) => `${evaluation.personaId}: ${warning}`),
    ...experienceDimensions
      .filter((dimension) => {
        const score = evaluation[dimension].score;
        return typeof score !== "number" || score < experienceWarningThreshold() || evaluation[dimension].rating === "needs work";
      })
      .map((dimension) => `${evaluation.personaId}: ${dimension}=${scoreLabel(evaluation[dimension].score)} (${evaluation[dimension].rating})`),
  ]);
}

function experienceEvaluationHasWarning(evaluation: SwarmExperienceEvaluation): boolean {
  return (
    evaluation.judge.status === "blocked" ||
    evaluation.warnings.length > 0 ||
    experienceDimensions.some((dimension) => {
      const score = evaluation[dimension].score;
      return typeof score !== "number" || score < experienceWarningThreshold() || evaluation[dimension].rating === "needs work";
    })
  );
}

function buildStoryObservations(report: SwarmReport): RunStoryObservation[] {
  const runtimeByPersona = new Map(report.runtime.map((runtime) => [runtime.personaId, runtime]));
  const personaById = new Map(report.user_personas.map((persona) => [persona.id, persona]));
  const evaluationByPersona = new Map(
    report.persona_experience_evaluation.map((evaluation) => [evaluation.personaId, evaluation]),
  );
  const evaluationByScenario = new Map<SwarmDecision["scenario"], PersonaEvaluation>();
  for (const [scenario, evaluation] of [
    ["shared-impact", report.persona_experience_evaluation[0]],
    ["quest-offer", report.persona_experience_evaluation[0]],
    ["quest-accept", report.persona_experience_evaluation[0]],
    ["quest-body-progress", report.persona_experience_evaluation[0]],
    ["quest-leave", report.persona_experience_evaluation[0]],
    ["post-leave-explore", report.persona_experience_evaluation[0]],
    ["quest-resume", report.persona_experience_evaluation[0]],
    ["quest-epilogue-progress", report.persona_experience_evaluation[0]],
    ["resource-conflict", report.persona_experience_evaluation[1]],
    ["world-event", report.persona_experience_evaluation[2]],
    ["persistent-entity-revisit", report.persona_experience_evaluation[2]],
  ] as Array<[SwarmDecision["scenario"], PersonaEvaluation | undefined]>) {
    if (evaluation) {
      evaluationByScenario.set(scenario, evaluation);
    }
  }
  const personaDecisionCounts = new Map<string, number>();
  return report.persona_decision_log.map((decision) => {
    const decisionIndex = personaDecisionCounts.get(decision.personaId) ?? 0;
    personaDecisionCounts.set(decision.personaId, decisionIndex + 1);
    const runtime = runtimeByPersona.get(decision.personaId);
    const evaluation = evaluationByScenario.get(decision.scenario) ?? evaluationByPersona.get(decision.personaId);
    return {
      personaId: decision.personaId,
      personaLabel: personaById.get(decision.personaId)?.label ?? ja(decision.personaId),
      scenario: decision.scenario,
      action: decision.questAction ?? decision.choiceId ?? decision.inputText ?? decision.inputMode,
      expectedWorldImpact: decision.expectedWorldImpact,
      observedImpact: evaluation?.observedImpact ?? null,
      rating: evaluation?.rating ?? null,
      locationId: runtime?.locationId ?? null,
      eventIds: runtime?.eventIds[decisionIndex] ? [runtime.eventIds[decisionIndex]] : [],
      turnIds: runtime?.turnIds[decisionIndex] ? [runtime.turnIds[decisionIndex]] : [],
    };
  });
}

function hardCheckForScenario(scenario: SwarmDecision["scenario"]): string {
  if (scenario === "shared-impact") {
    return "shared_impact_visible";
  }
  if (scenario === "quest-offer") {
    return "dynamic_quest_offered";
  }
  if (scenario === "quest-accept") {
    return "quest_accept_turn_resolved";
  }
  if (scenario === "quest-body-progress") {
    return "quest_chapter_visible";
  }
  if (scenario === "quest-leave") {
    return "quest_left_and_paused";
  }
  if (scenario === "post-leave-explore") {
    return "post_leave_exploration_resolved";
  }
  if (scenario === "quest-resume") {
    return "quest_resumed";
  }
  if (scenario === "quest-epilogue-progress") {
    return "quest_epilogue_visible";
  }
  if (scenario === "resource-conflict") {
    return "resource_conflict_recorded";
  }
  if (scenario === "persistent-entity-revisit") {
    return "generated_entity_reused";
  }
  return "world_broadcast_or_constraint_visible";
}

function storyObservationText(observation: RunStoryObservation): string {
  return `${observation.personaLabel}: ${ja(observation.scenario)}で${ja(observation.action)}を実行`;
}

async function findLatestRunResultFile(runPath: string): Promise<string | null> {
  const entries = await fs.readdir(runPath);
  if (entries.includes("swarm-test-result.json")) {
    return "swarm-test-result.json";
  }
  const attempts = entries
    .map((entry) => {
      const match = /^swarm-test-result-attempt-(\d+)\.json$/.exec(entry);
      return match ? { file: entry, attempt: Number(match[1]) } : null;
    })
    .filter((entry): entry is { file: string; attempt: number } => entry !== null)
    .sort((left, right) => left.attempt - right.attempt);
  return attempts[attempts.length - 1]?.file ?? null;
}

function reportFileForResultFile(resultFile: string): string {
  if (resultFile === "swarm-test-result.json") {
    return "swarm-test-report.md";
  }
  return resultFile.replace(/^swarm-test-result-/, "swarm-test-report-").replace(/\.json$/, ".md");
}

function experienceWarningThreshold(): number {
  const raw = process.env.SWARM_EXPERIENCE_WARNING_THRESHOLD?.trim();
  if (!raw) {
    return 3;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function scoreLabel(score: number | null): string {
  return typeof score === "number" ? String(score) : "未採点";
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function durationLabel(value: number | null): string {
  return typeof value === "number" ? `${Math.round(value)}ms` : "-";
}

const experienceDimensions: ExperienceDimension[] = ["ux_clarity", "gameplay_fun", "story_progression", "overall"];

function runGroupAggregateMarkdownReport(report: RunGroupAggregateReport): string {
  const lines = [
    `# swarm-test 実装評価レポート ${report.run_group_id}`,
    "",
    `- 生成日時: ${report.generated_at}`,
    `- 実装コミット: ${report.run_group_id}`,
    `- run group dir: ${report.run_group_dir}`,
    `- run 数: ${report.run_count}`,
    `- 完了 run: ${report.completed_run_count}`,
    `- 合格 run: ${report.passed_run_count}`,
    `- 失敗 run: ${report.failed_run_count}`,
    `- レポート未生成 run: ${report.blocked_run_count}`,
    `- 最新完了 run: ${report.latest_completed_run_id ?? "なし"}`,
    `- 最新完了結果: ${report.latest_completed_result ? jaStatus(report.latest_completed_result) : "なし"}`,
    "",
    "## Run 一覧",
    "",
    "| run_id | mode | 状態 | 作成日時 | world_id | report |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.runs.map(
      (run) =>
        `| ${run.run_id} | ${run.mode} | ${jaStatus(run.status)} | ${run.created_at ?? "-"} | ${run.world_id ?? "-"} | ${
          run.report_file ?? "未生成"
        } |`,
    ),
    "",
    "## ストーリー展開・世界影響・イベント発生",
    "",
    "| run_id | ストーリー展開 | 世界への影響 | 発生イベント |",
    "| --- | --- | --- | --- |",
    ...report.runs.map(
      (run) =>
        `| ${run.run_id} | ${runStorySummary(run)} | ${runWorldImpactSummary(run)} | ${runEventSummary(run)} |`,
    ),
    "",
    "## Turn timing telemetry",
    "",
    `- turn 数: ${report.turn_timing_summary.turn_count}`,
    `- HTTP duration: p50=${durationLabel(report.turn_timing_summary.http_duration_ms.p50)}, p95=${durationLabel(
      report.turn_timing_summary.http_duration_ms.p95,
    )}, max=${durationLabel(report.turn_timing_summary.http_duration_ms.max)}`,
    `- final resolution duration: p50=${durationLabel(
      report.turn_timing_summary.final_resolution_duration_ms.p50,
    )}, p95=${durationLabel(report.turn_timing_summary.final_resolution_duration_ms.p95)}, max=${durationLabel(
      report.turn_timing_summary.final_resolution_duration_ms.max,
    )}`,
    "",
    "| phase | samples | p50 | p95 | max |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...(report.turn_timing_summary.phase_durations.length
      ? report.turn_timing_summary.phase_durations.map(
          (phase) =>
            `| ${phase.phase} | ${phase.sample_count} | ${durationLabel(phase.duration_ms.p50)} | ${durationLabel(
              phase.duration_ms.p95,
            )} | ${durationLabel(phase.duration_ms.max)} |`,
        )
      : ["| - | 0 | - | - | - |"]),
    "",
    "## 生成Entity永続化",
    "",
    `- created: ${report.generated_entity_summary.created_count}`,
    `- reused: ${report.generated_entity_summary.reused_count}`,
    `- entity types: ${report.generated_entity_summary.entity_types.join(", ") || "なし"}`,
    `- origin kinds: ${report.generated_entity_summary.origin_kinds.join(", ") || "なし"}`,
    `- source turns: ${report.generated_entity_summary.source_turn_ids.join(", ") || "なし"}`,
    `- source events: ${report.generated_entity_summary.source_event_ids.join(", ") || "なし"}`,
    "",
    "## シナリオ別の展開",
    "",
    ...report.scenario_story_summary.flatMap((summary) => [
      `### ${ja(summary.scenario)}`,
      "",
      `- 観測 run: ${summary.observed_runs}/${summary.completed_runs}`,
      `- 発生 event 数: ${summary.event_count}`,
      `- 最新観測: ${summary.latestObservedImpact ?? "なし"}`,
      ...summary.runs.map(
        (run) =>
          `- ${run.run_id}: ${run.observed ? "観測あり" : "観測なし"}; 展開=${run.story || "なし"}; 影響=${
            run.worldImpact || "なし"
          }; event_ids=${run.eventIds.join(", ") || "なし"}`,
      ),
      "",
    ]),
    "",
    "## UX・ゲームプレイ・ストーリー評価",
    "",
    `- warning 件数: ${report.experience_summary.warning_count}`,
    `- warning run: ${report.experience_summary.warning_runs}/${report.completed_run_count}`,
    "",
    "| 評価軸 | 平均 score | 良好 | 許容 | 要改善 | ブロック |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...experienceDimensions.map((dimension) => {
      const summary = report.experience_summary.dimensions[dimension];
      return `| ${ja(dimension)} | ${summary.average_score ?? "-"} | ${summary.ratings.good} | ${summary.ratings.acceptable} | ${summary.ratings["needs work"]} | ${summary.ratings.blocked} |`;
    }),
    "",
    "## LLM judge warnings",
    "",
    ...(report.runs.some((run) => run.experience_warnings.length)
      ? report.runs.flatMap((run) =>
          run.experience_warnings.map((warning) => `- ${run.run_id}: ${ja(warning)}`),
        )
      : ["- なし"]),
    "",
    "## ハードチェック横断",
    "",
    "| 項目 | 最新完了 run | 通過 run |",
    "| --- | --- | --- |",
    ...Object.entries(report.hard_check_summary).map(
      ([key, summary]) =>
        `| ${ja(key)} | ${summary.latest === null ? "なし" : summary.latest ? "合格" : "失敗"} | ${
          summary.passed_runs
        }/${summary.completed_runs} |`,
    ),
    "",
    "## ペルソナ別横断評価",
    "",
    ...report.persona_experience_summary.flatMap((summary) => [
      `### ${ja(summary.personaId)}`,
      "",
      `- 最新評価: ${summary.latestRating ? ja(summary.latestRating) : "なし"}`,
      `- 最新観測: ${summary.latestObservedImpact ? ja(summary.latestObservedImpact) : "なし"}`,
      `- 評価分布: 良好=${summary.ratings.good}, 許容=${summary.ratings.acceptable}, 要改善=${summary.ratings["needs work"]}, ブロック=${summary.ratings.blocked}`,
      ...summary.runs.map((run) => `- ${run.run_id}: 評価=${ja(run.rating)}; 観測=${ja(run.observedImpact)}`),
      "",
    ]),
    "## 現時点の評価",
    "",
    implementationAssessment(report),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function runStorySummary(run: RunGroupRun): string {
  if (run.status === "blocked") {
    return "未生成";
  }
  return run.story_observations.map((observation) => storyObservationText(observation)).join("<br>") || "なし";
}

function runWorldImpactSummary(run: RunGroupRun): string {
  if (run.status === "blocked") {
    return "未生成";
  }
  const impacts = Array.from(
    new Set(
      run.story_observations
        .map((observation) => observation.observedImpact)
        .filter((impact): impact is string => Boolean(impact))
        .map((impact) => ja(impact)),
    ),
  );
  return impacts.join("<br>") || "なし";
}

function runEventSummary(run: RunGroupRun): string {
  if (run.status === "blocked") {
    return "未生成";
  }
  const eventRows = run.story_observations
    .filter((observation) => observation.eventIds.length > 0 || observation.turnIds.length > 0)
    .map(
      (observation) =>
        `${observation.personaLabel} ${ja(observation.scenario)}: ${observation.eventIds.join(", ") || "eventなし"}`,
    );
  return eventRows.join("<br>") || "なし";
}

function implementationAssessment(report: RunGroupAggregateReport): string {
  if (report.run_count === 0) {
    return "- 評価対象の swarm run がありません。";
  }
  const notes = [];
  if (report.passed_run_count > 0) {
    notes.push(
      `- 少なくとも ${report.passed_run_count} run では、shared impact / resource conflict / world event / privacy separation の hard check が通過しています。`,
    );
  }
  if (report.failed_run_count > 0) {
    notes.push(`- ${report.failed_run_count} run で hard check failure があり、該当項目の再確認が必要です。`);
  }
  if (report.blocked_run_count > 0) {
    notes.push(
      `- ${report.blocked_run_count} run は完了レポート未生成です。live run の安定性または backend concurrency failure を別途確認してください。`,
    );
  }
  if (report.completed_run_count > 0 && report.passed_run_count === report.completed_run_count && report.blocked_run_count === 0) {
    notes.push("- 現時点の完了 run 群では、実装評価は合格です。");
  } else if (report.passed_run_count > 0) {
    notes.push("- 現時点では体験要件を満たす run はありますが、失敗または未完了 run が残るため安定性評価は保留です。");
  }
  return notes.join("\n");
}

function jaStatus(status: "pass" | "fail" | "blocked"): string {
  if (status === "pass") {
    return "合格";
  }
  if (status === "fail") {
    return "失敗";
  }
  return "未完了";
}

type AttemptSummaryAttempt = {
  attempt_label: string;
  mode: "short" | "long";
  result_file: string;
  report_file: string;
  created_at: string;
  world_id: string;
  hard_checks: Record<string, boolean>;
  persona_ratings: Record<string, PersonaEvaluation["rating"]>;
  experience_warning_count: number;
};

type SwarmAttemptSummaryReport = {
  run_id: string;
  generated_at: string;
  world_id: string;
  attempt_count: number;
  latest_attempt: string;
  latest_result: "pass" | "fail";
  attempts: AttemptSummaryAttempt[];
  hard_check_summary: Record<
    string,
    {
      latest: boolean;
      passed_attempts: number;
      total_attempts: number;
    }
  >;
  persona_experience_summary: Array<{
    personaId: string;
    latestRating: PersonaEvaluation["rating"];
    latestObservedImpact: string;
    attempts: Array<{
      attempt_label: string;
      rating: PersonaEvaluation["rating"];
      observedImpact: string;
      evidence: string[];
    }>;
  }>;
  reports: Array<{
    attempt_label: string;
    result_file: string;
    report_file: string;
  }>;
};

async function buildAttemptSummaryReport(artifactDir: string): Promise<SwarmAttemptSummaryReport> {
  const attempts = await readAttemptReports(artifactDir);
  if (attempts.length === 0) {
    throw new Error(`No swarm attempt reports found in ${artifactDir}`);
  }

  const latest = attempts[attempts.length - 1];
  const hardCheckKeys = Array.from(new Set(attempts.flatMap((attempt) => Object.keys(attempt.report.hard_checks))));
  const hardCheckSummary = Object.fromEntries(
    hardCheckKeys.map((key) => [
      key,
      {
        latest: latest.report.hard_checks[key] === true,
        passed_attempts: attempts.filter((attempt) => attempt.report.hard_checks[key] === true).length,
        total_attempts: attempts.length,
      },
    ]),
  );
  const personaIds = Array.from(
    new Set(
      attempts.flatMap((attempt) =>
        attempt.report.persona_experience_evaluation.map((evaluation) => evaluation.personaId),
      ),
    ),
  );
  const personaExperienceSummary = personaIds.map((personaId) => {
    const personaAttempts = attempts.flatMap((attempt) =>
      attempt.report.persona_experience_evaluation
        .filter((evaluation) => evaluation.personaId === personaId)
        .map((evaluation) => ({
          attempt_label: attempt.attemptLabel,
          rating: evaluation.rating,
          observedImpact: evaluation.observedImpact,
          evidence: evaluation.evidence,
        })),
    );
    const latestEvaluation = personaAttempts[personaAttempts.length - 1];
    return {
      personaId,
      latestRating: latestEvaluation.rating,
      latestObservedImpact: latestEvaluation.observedImpact,
      attempts: personaAttempts,
    };
  });

  return {
    run_id: latest.report.run_id,
    generated_at: new Date().toISOString(),
    world_id: latest.report.world_id,
    attempt_count: attempts.length,
    latest_attempt: latest.attemptLabel,
    latest_result: Object.values(latest.report.hard_checks).every(Boolean) ? "pass" : "fail",
    attempts: attempts.map((attempt) => ({
      attempt_label: attempt.attemptLabel,
      mode: attempt.report.mode ?? "short",
      result_file: attempt.resultFile,
      report_file: attempt.reportFile,
      created_at: attempt.report.created_at,
      world_id: attempt.report.world_id,
      hard_checks: attempt.report.hard_checks,
      persona_ratings: Object.fromEntries(
        attempt.report.persona_experience_evaluation.map((evaluation) => [evaluation.personaId, evaluation.rating]),
      ),
      experience_warning_count: experienceWarningCount(attempt.report.experience_evaluation ?? []),
    })),
    hard_check_summary: hardCheckSummary,
    persona_experience_summary: personaExperienceSummary,
    reports: attempts.map((attempt) => ({
      attempt_label: attempt.attemptLabel,
      result_file: attempt.resultFile,
      report_file: attempt.reportFile,
    })),
  };
}

async function readAttemptReports(
  artifactDir: string,
): Promise<Array<{ attemptLabel: string; resultFile: string; reportFile: string; report: SwarmReport }>> {
  const entries = await fs.readdir(artifactDir);
  const resultFiles = entries
    .map((entry) => {
      const match = /^swarm-test-result-(attempt-(\d+))\.json$/.exec(entry);
      return match ? { attemptLabel: match[1], attemptNumber: Number(match[2]), resultFile: entry } : null;
    })
    .filter((entry): entry is { attemptLabel: string; attemptNumber: number; resultFile: string } => entry !== null)
    .sort((left, right) => left.attemptNumber - right.attemptNumber);

  return Promise.all(
    resultFiles.map(async ({ attemptLabel, resultFile }) => {
      const raw = await fs.readFile(path.join(artifactDir, resultFile), "utf8");
      return {
        attemptLabel,
        resultFile,
        reportFile: `swarm-test-report-${attemptLabel}.md`,
        report: JSON.parse(raw) as SwarmReport,
      };
    }),
  );
}

function attemptSummaryMarkdownReport(report: SwarmAttemptSummaryReport): string {
  const lines = [
    `# swarm-test attempt summary ${report.run_id}`,
    "",
    `- 生成日時: ${report.generated_at}`,
    `- world_id: ${report.world_id}`,
    `- attempt 数: ${report.attempt_count}`,
    `- 最新 attempt: ${report.latest_attempt}`,
    `- 最新結果: ${report.latest_result === "pass" ? "合格" : "失敗"}`,
    "",
    "## Attempt 一覧",
    "",
    "| attempt | mode | 作成日時 | 結果 | persona 評価 | judge warnings | report |",
    "| --- | --- | --- | --- | --- | ---: | --- |",
    ...report.attempts.map((attempt) => {
      const result = Object.values(attempt.hard_checks).every(Boolean) ? "合格" : "失敗";
      const ratings = Object.entries(attempt.persona_ratings)
        .map(([personaId, rating]) => `${ja(personaId)}=${ja(rating)}`)
        .join("<br>");
      return `| ${attempt.attempt_label} | ${attempt.mode} | ${attempt.created_at} | ${result} | ${ratings} | ${attempt.experience_warning_count} | ${attempt.report_file} |`;
    }),
    "",
    "## ハードチェック総合",
    "",
    "| 項目 | 最新 | 通過 attempt |",
    "| --- | --- | --- |",
    ...Object.entries(report.hard_check_summary).map(
      ([key, summary]) =>
        `| ${ja(key)} | ${summary.latest ? "合格" : "失敗"} | ${summary.passed_attempts}/${summary.total_attempts} |`,
    ),
    "",
    "## ペルソナ別総合評価",
    "",
    ...report.persona_experience_summary.flatMap((summary) => [
      `### ${ja(summary.personaId)}`,
      "",
      `- 最新評価: ${ja(summary.latestRating)}`,
      `- 最新観測: ${ja(summary.latestObservedImpact)}`,
      ...summary.attempts.map(
        (attempt) =>
          `- ${attempt.attempt_label}: 評価=${ja(attempt.rating)}; 観測=${ja(
            attempt.observedImpact,
          )}; 証跡=${attempt.evidence.join(" | ")}`,
      ),
      "",
    ]),
    "## 個別レポート",
    "",
    ...report.reports.map(
      (attempt) => `- ${attempt.attempt_label}: ${attempt.report_file}, ${attempt.result_file}`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function markdownReport(report: SwarmReport, attemptLabel: string): string {
  const lines = [
    `# swarm-test レポート ${report.run_id}`,
    "",
    `- 作成日時: ${report.created_at}`,
    `- mode: ${report.mode ?? "short"}`,
    `- world_id: ${report.world_id}`,
    `- 試行: ${attemptLabel}`,
    "",
    "## ハードチェック",
    "",
    ...Object.entries(report.hard_checks).map(([key, value]) => `- ${ja(key)}: ${value ? "合格" : "失敗"}`),
    "",
    "## 生成Entity観測",
    "",
    `- created: ${report.generated_entity_observation?.created_count ?? 0}`,
    `- reused: ${report.generated_entity_observation?.reused_count ?? 0}`,
    `- entity types: ${(report.generated_entity_observation?.entity_types ?? []).join(", ") || "なし"}`,
    `- origin kinds: ${(report.generated_entity_observation?.origin_kinds ?? []).join(", ") || "なし"}`,
    `- source turns: ${(report.generated_entity_observation?.source_turn_ids ?? []).join(", ") || "なし"}`,
    `- source events: ${(report.generated_entity_observation?.source_event_ids ?? []).join(", ") || "なし"}`,
    "",
    ...(report.failure_diagnostics
      ? [
          "## 失敗診断",
          "",
          `- stage: ${report.failure_diagnostics.stage}`,
          `- message: ${report.failure_diagnostics.message}`,
          ...(report.failure_diagnostics.stack ? [`- stack: ${report.failure_diagnostics.stack.split("\n")[0]}`] : []),
          "",
        ]
      : []),
    "## ユーザーペルソナ",
    "",
    ...report.user_personas.map(
      (persona) =>
        `- ${persona.label}: 性別=${ja(persona.gender)}, 年齢=${persona.age}, 職業=${ja(
          persona.occupation,
        )}, 趣味=${jaList(persona.hobbies)}, 性格=${jaList(persona.personality)}, 評価観点=${ja(
          persona.evaluationLens,
        )}`,
    ),
    "",
    "## 派生プレイヤープロフィール",
    "",
    ...report.derived_player_profiles.map(
      (profile) =>
        `- ${profile.sourcePersonaId}: ${profile.displayName}; 性別=${ja(profile.gender)}; プレイ言語=${
          profile.playLanguage.preset
        }`,
    ),
    "",
    "## ペルソナ別行動ログ",
    "",
    ...report.persona_decision_log.map(
      (decision) =>
        `- ${ja(decision.personaId)}: シナリオ=${ja(decision.scenario)}; 入力=${ja(
          decision.inputMode,
        )}; 行動=${ja(decision.questAction ?? decision.choiceId ?? decision.inputText ?? "")}; 理由=${ja(
          decision.reason,
        )}; 期待する世界影響=${ja(decision.expectedWorldImpact)}`,
    ),
    "",
    "## ペルソナ別体験評価",
    "",
    ...report.persona_experience_evaluation.map(
      (evaluation) =>
        `- ${ja(evaluation.personaId)}: 評価=${ja(evaluation.rating)}; 観測された影響=${ja(
          evaluation.observedImpact,
        )}; 証跡=${evaluation.evidence.join(
          " | ",
        )}`,
    ),
    "",
    "## UX・ゲームプレイ・ストーリー評価",
    "",
    ...report.experience_evaluation.flatMap((evaluation) => [
      `### ${ja(evaluation.personaId)}`,
      "",
      `- judge: ${evaluation.judge.status}${evaluation.judge.modelId ? ` (${evaluation.judge.modelId})` : ""}`,
      `- UX 評価: score=${scoreLabel(evaluation.ux_clarity.score)}; 評価=${ja(evaluation.ux_clarity.rating)}; 理由=${ja(evaluation.ux_clarity.rationale)}`,
      `- ゲームプレイの面白さ: score=${scoreLabel(evaluation.gameplay_fun.score)}; 評価=${ja(evaluation.gameplay_fun.rating)}; 理由=${ja(evaluation.gameplay_fun.rationale)}`,
      `- ストーリー展開評価: score=${scoreLabel(evaluation.story_progression.score)}; 評価=${ja(evaluation.story_progression.rating)}; 理由=${ja(evaluation.story_progression.rationale)}`,
      `- overall: score=${scoreLabel(evaluation.overall.score)}; 評価=${ja(evaluation.overall.rating)}; 理由=${ja(evaluation.overall.rationale)}`,
      `- warnings: ${evaluation.warnings.length ? evaluation.warnings.map(ja).join(" | ") : "なし"}`,
      `- suggestions: ${evaluation.suggestions.length ? evaluation.suggestions.map(ja).join(" | ") : "なし"}`,
      `- viewport: ${evaluation.evidence.viewport.kind} ${evaluation.evidence.viewport.width}x${evaluation.evidence.viewport.height}`,
      `- screenshots: ${evaluation.evidence.turns.map((turn) => turn.screenshotPath).filter(Boolean).join(" | ") || "なし"}`,
      "",
    ]),
    "## 実行時 ID",
    "",
    ...report.runtime.map(
      (runtime) =>
        `- ${runtime.personaId}: actor_id=${runtime.actorId}; session_id=${runtime.sessionId}; location_id=${
          runtime.locationId
        }; event_ids=${runtime.eventIds.join(", ")}; turn_ids=${runtime.turnIds.join(", ")}`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function jaList(values: string[]): string {
  return values.map((value) => ja(value)).join(", ");
}

function ja(value: string): string {
  return japaneseLabels[value] ?? value;
}

const japaneseLabels: Record<string, string> = {
  "novel-lover": "Persona A: 小説愛好家",
  "mmo-gamer": "Persona B: MMO ゲーマー",
  "it-engineer": "Persona C: IT エンジニア",
  female: "女性",
  male: "男性",
  other: "その他",
  unspecified: "未指定",
  editor: "編集者",
  sales: "営業職",
  "software engineer": "ソフトウェアエンジニア",
  novels: "小説",
  "tabletop RPGs": "TRPG",
  "character analysis": "登場人物考察",
  MMOs: "MMO",
  "raid progression": "レイド攻略",
  "build optimization": "ビルド検証",
  "technical verification": "技術検証",
  "simulation games": "シミュレーションゲーム",
  "log analysis": "ログ分析",
  empathetic: "共感的",
  observant: "観察好き",
  "values foreshadowing and afterglow": "伏線や余韻を重視",
  "goal-oriented": "目標志向",
  "efficiency-minded": "効率重視",
  "enjoys competition": "競争を楽しむ",
  analytical: "分析的",
  careful: "慎重",
  "causality-focused": "因果関係を重視",
  "Can I feel that my action became part of someone else's story?":
    "自分の行動が他者の物語の一部になったと感じられるか。",
  "Did contention around the same goal resolve fairly and keep play moving?":
    "同じ目標を巡る競合が公平に解決され、プレイが進み続けるか。",
  "Do broadcasts, memories, timeline sequence, and constraints line up?":
    "broadcast、memory、timeline sequence、constraint の整合性が取れているか。",
  persona_profile_separation: "ユーザーペルソナとプレイヤープロフィールの分離",
  runtime_privacy_leak_free: "実行時データへのユーザーペルソナ漏えいなし",
  all_turns_return_event_ids: "全ターンが event_id を返す",
  all_turn_events_same_world: "全ターンイベントが同一 world_id に属する",
  canonical_sequence_unique: "canonical sequence が一意",
  shared_impact_visible: "共有世界への影響が観測可能",
  resource_conflict_recorded: "リソース競合が記録される",
  world_broadcast_or_constraint_visible: "世界イベントまたは制約が観測可能",
  exploration_label_visible: "探索中表示が観測可能",
  dynamic_quest_offered: "動的クエスト提示が観測可能",
  quest_accept_turn_resolved: "クエスト受諾 turn が解決",
  quest_chapter_visible: "クエスト chapter が観測可能",
  quest_lifecycle_events_same_world: "クエスト lifecycle event が同一 world に属する",
  entity_updates_field_present: "turn.resolved の entity_updates 配線が観測可能",
  entity_materialization_completed: "entity_materialization phase が完了",
  quest_prologue_visible: "クエスト prologue が観測可能",
  quest_left_and_paused: "クエスト離脱後 paused と再開操作が観測可能",
  post_leave_exploration_resolved: "クエスト離脱後の探索 turn が解決",
  quest_resumed: "クエスト再開が観測可能",
  quest_epilogue_visible: "クエスト epilogue が観測可能",
  generated_entity_created: "生成entity作成が観測可能",
  generated_entity_reused: "生成entity再利用が観測可能",
  "shared-impact": "共有影響",
  "quest-offer": "クエスト提示",
  "quest-accept": "クエスト受諾",
  "quest-body-progress": "クエスト進行",
  "quest-leave": "クエスト離脱",
  "post-leave-explore": "離脱後探索",
  "quest-resume": "クエスト再開",
  "quest-epilogue-progress": "クエストエピローグ進行",
  "resource-conflict": "リソース競合",
  "world-event": "世界イベント",
  "persistent-entity-revisit": "永続生成entity再訪",
  ux_clarity: "UX 評価",
  gameplay_fun: "ゲームプレイの面白さ",
  story_progression: "ストーリー展開評価",
  overall: "総合体験",
  choice: "選択肢",
  free_text: "自由入力",
  quest_action: "クエスト操作",
  accept_quest: "クエスト受諾",
  decline_quest: "クエスト辞退",
  ignore_quest: "クエスト無視",
  leave_quest: "クエスト離脱",
  resume_quest: "クエスト再開",
  progress: "進行",
  safe: "安全",
  explore: "探索",
  good: "良好",
  acceptable: "許容",
  "needs work": "要改善",
  blocked: "ブロック",
  "This persona values emotionally meaningful help that can become shared memory.":
    "このペルソナは、共有記憶として残る情緒的に意味のある支援を重視する。",
  "A local act of support should surface later as rumor, relationship, or world beat.":
    "局所的な支援行動が、後続の噂・関係性・world beat として現れることを期待する。",
  "This persona pressure-tests progress paths and shared-resource contention.":
    "このペルソナは、進行経路と共有リソース競合を負荷検証する。",
  "Concurrent progress should resolve fairly and record any resource constraint without blocking play.":
    "同時進行時の競合が公平に解決され、プレイを止めずに resource constraint が記録されることを期待する。",
  "I compare Nexus public logs, market traces, generated local NPCs, and small communities, then ask which recent action changed shared-world conditions.":
    "ネクサス市の公開ログ、市場の痕跡、生成された現地NPCや小コミュニティを照合し、どの直近行動が共有世界の状況を変えたのかを尋ねる。",
  "This persona joins late and probes whether public world events have a traceable cause.":
    "このペルソナは遅れて参加し、公開された世界イベントに追跡可能な原因があるかを検証する。",
  "The response should expose shared-world continuity through broadcast, memory, or recent history.":
    "応答から broadcast、memory、recent history を通じた共有世界の連続性が観測できることを期待する。",
  "The helping action is present in shared-world context.":
    "支援行動が shared-world context に現れている。",
  "The helping action did not surface in the shared-world context probe.":
    "shared-world context のプローブで支援行動を確認できなかった。",
  "Concurrent pressure produced a recorded resource constraint.":
    "同時行動の圧力により、resource constraint が記録された。",
  "Concurrent pressure completed without an observable resource constraint.":
    "同時行動は完了したが、観測可能な resource constraint は残らなかった。",
  "Late join and follow-up exposed a world event or broadcast constraint.":
    "遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。",
  "Late join and follow-up reused a generated living entity in the same world.":
    "遅れて参加した後の追跡行動で、同じ世界内の生成済み生きたentity再利用を観測できた。",
  "Exploration produced an optional quest, and accepting it opened a chapter that remained visible.":
    "探索から任意クエストが提示され、受諾後の chapter が見える形で残った。",
  "Long quest lifecycle reached pause, exploration, resume, and epilogue completion.":
    "クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。",
  "The dynamic quest offer or accepted chapter was not visible enough in the probe.":
    "動的クエスト提示または受諾後 chapter の可視性が十分に確認できなかった。",
  "Late join and follow-up did not expose a world event or broadcast constraint.":
    "遅れて参加した後の追跡行動では、世界イベントまたは broadcast constraint を観測できなかった。",
};
