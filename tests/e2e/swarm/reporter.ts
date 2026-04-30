import fs from "node:fs/promises";
import path from "node:path";

import type { TestInfo } from "@playwright/test";

import type { DerivedPlayerProfile } from "./playerProfiles";
import type { SwarmDecision } from "./playbook";
import type { SwarmUserPersona } from "./userPersonas";

export type PersonaEvaluation = {
  personaId: string;
  rating: "good" | "acceptable" | "needs work" | "blocked";
  observedImpact: string;
  evidence: string[];
};

export type SwarmReport = {
  run_id: string;
  created_at: string;
  world_id: string;
  user_personas: SwarmUserPersona[];
  derived_player_profiles: DerivedPlayerProfile[];
  persona_decision_log: Array<SwarmDecision & { personaId: string }>;
  persona_experience_evaluation: PersonaEvaluation[];
  hard_checks: Record<string, boolean>;
  runtime: Array<{
    personaId: string;
    actorId: string;
    sessionId: string;
    locationId: string;
    eventIds: string[];
    turnIds: string[];
  }>;
  artifacts: string[];
};

export function buildRunId(): string {
  if (process.env.SWARM_RUN_ID?.trim()) {
    return process.env.SWARM_RUN_ID.trim();
  }
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function defaultArtifactDir(runId: string): string {
  return (
    process.env.SWARM_ARTIFACT_DIR ??
    path.resolve(process.cwd(), "../documents/testplay-reports/artifacts", `swarm-test-${runId}`)
  );
}

export async function writeSwarmReport(testInfo: TestInfo, artifactDir: string, report: SwarmReport): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  const attemptLabel = `attempt-${testInfo.retry + 1}`;
  const jsonPath = path.join(artifactDir, `swarm-test-result-${attemptLabel}.json`);
  const markdownPath = path.join(artifactDir, `swarm-test-report-${attemptLabel}.md`);
  const latestJsonPath = path.join(artifactDir, "swarm-test-result.json");
  const latestMarkdownPath = path.join(artifactDir, "swarm-test-report.md");
  const aggregateJsonPath = path.join(artifactDir, "swarm-test-aggregate-result.json");
  const aggregateMarkdownPath = path.join(artifactDir, "swarm-test-aggregate-report.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, markdownReport(report, attemptLabel), "utf8");
  await fs.copyFile(jsonPath, latestJsonPath);
  await fs.copyFile(markdownPath, latestMarkdownPath);
  const aggregate = await buildAggregateReport(artifactDir);
  await fs.writeFile(aggregateJsonPath, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
  await fs.writeFile(aggregateMarkdownPath, aggregateMarkdownReport(aggregate), "utf8");
  await testInfo.attach("swarm-test-result", {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach("swarm-test-report", {
    path: markdownPath,
    contentType: "text/markdown",
  });
  await testInfo.attach("swarm-test-aggregate-report", {
    path: aggregateMarkdownPath,
    contentType: "text/markdown",
  });
}

type AggregateAttempt = {
  attempt_label: string;
  result_file: string;
  report_file: string;
  created_at: string;
  world_id: string;
  hard_checks: Record<string, boolean>;
  persona_ratings: Record<string, PersonaEvaluation["rating"]>;
};

type SwarmAggregateReport = {
  run_id: string;
  generated_at: string;
  world_id: string;
  attempt_count: number;
  latest_attempt: string;
  latest_result: "pass" | "fail";
  attempts: AggregateAttempt[];
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

async function buildAggregateReport(artifactDir: string): Promise<SwarmAggregateReport> {
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
      result_file: attempt.resultFile,
      report_file: attempt.reportFile,
      created_at: attempt.report.created_at,
      world_id: attempt.report.world_id,
      hard_checks: attempt.report.hard_checks,
      persona_ratings: Object.fromEntries(
        attempt.report.persona_experience_evaluation.map((evaluation) => [evaluation.personaId, evaluation.rating]),
      ),
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

function aggregateMarkdownReport(report: SwarmAggregateReport): string {
  const lines = [
    `# swarm-test 総合レポート ${report.run_id}`,
    "",
    `- 生成日時: ${report.generated_at}`,
    `- world_id: ${report.world_id}`,
    `- attempt 数: ${report.attempt_count}`,
    `- 最新 attempt: ${report.latest_attempt}`,
    `- 最新結果: ${report.latest_result === "pass" ? "合格" : "失敗"}`,
    "",
    "## Attempt 一覧",
    "",
    "| attempt | 作成日時 | 結果 | persona 評価 | report |",
    "| --- | --- | --- | --- | --- |",
    ...report.attempts.map((attempt) => {
      const result = Object.values(attempt.hard_checks).every(Boolean) ? "合格" : "失敗";
      const ratings = Object.entries(attempt.persona_ratings)
        .map(([personaId, rating]) => `${ja(personaId)}=${ja(rating)}`)
        .join("<br>");
      return `| ${attempt.attempt_label} | ${attempt.created_at} | ${result} | ${ratings} | ${attempt.report_file} |`;
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
    `- world_id: ${report.world_id}`,
    `- 試行: ${attemptLabel}`,
    "",
    "## ハードチェック",
    "",
    ...Object.entries(report.hard_checks).map(([key, value]) => `- ${ja(key)}: ${value ? "合格" : "失敗"}`),
    "",
    "## ユーザーペルソナ",
    "",
    ...report.user_personas.map(
      (persona) =>
        `- ${ja(persona.id)}: 性別=${ja(persona.gender)}, 年齢=${persona.age}, 職業=${ja(
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
        `- ${ja(profile.sourcePersonaId)}: ${profile.displayName}; 性別=${ja(profile.gender)}; プレイ言語=${
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
        )}; 行動=${ja(decision.choiceId ?? decision.inputText ?? "")}; 理由=${ja(
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
  "shared-impact": "共有影響",
  "resource-conflict": "リソース競合",
  "world-event": "世界イベント",
  choice: "選択肢",
  free_text: "自由入力",
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
  "I compare the current gate reports with what travelers are saying and ask which recent action changed the local situation.":
    "現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。",
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
  "Late join and follow-up did not expose a world event or broadcast constraint.":
    "遅れて参加した後の追跡行動では、世界イベントまたは broadcast constraint を観測できなかった。",
};
