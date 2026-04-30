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
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, markdownReport(report, attemptLabel), "utf8");
  await fs.copyFile(jsonPath, latestJsonPath);
  await fs.copyFile(markdownPath, latestMarkdownPath);
  await testInfo.attach("swarm-test-result", {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach("swarm-test-report", {
    path: markdownPath,
    contentType: "text/markdown",
  });
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
