import type { SwarmUserPersona } from "./userPersonas";

export type SwarmDecision = {
  scenario:
    | "shared-impact"
    | "resource-conflict"
    | "world-event"
    | "quest-offer"
    | "quest-accept"
    | "quest-body-progress";
  inputMode: "choice" | "free_text" | "quest_action";
  choiceId?: "safe" | "progress" | "explore";
  inputText?: string;
  questAction?: "accept_quest" | "decline_quest" | "leave_quest" | "resume_quest";
  questAssignmentId?: string;
  reason: string;
  expectedWorldImpact: string;
};

export function decisionForPersona(persona: SwarmUserPersona, scenario: SwarmDecision["scenario"]): SwarmDecision {
  if (scenario === "quest-offer") {
    return {
      scenario,
      inputMode: "choice",
      choiceId: "progress",
      reason: `${persona.label} は「${persona.evaluationLens}」という観点から、探索中に物語の糸口が自然に発生するかを確認する。`,
      expectedWorldImpact: "探索行動から任意の動的クエストが提示され、受諾するかどうかをプレイヤーが選べることを期待する。",
    };
  }

  if (scenario === "quest-accept") {
    return {
      scenario,
      inputMode: "quest_action",
      questAction: "accept_quest",
      reason: `${persona.label} は提示された物語の糸口を受け入れ、固定導線ではなく自分の選択でクエストへ入る。`,
      expectedWorldImpact: "クエスト受諾が通常 turn として解決され、prologue chapter が文脈として表示されることを期待する。",
    };
  }

  if (scenario === "quest-body-progress") {
    return {
      scenario,
      inputMode: "choice",
      choiceId: "progress",
      reason: `${persona.label} は受諾したクエストを進め、プレイ内容から chapter が更新されるかを確認する。`,
      expectedWorldImpact: "受諾後の行動により body chapter が開き、クエストの文脈が journal と scene に残ることを期待する。",
    };
  }

  if (scenario === "shared-impact") {
    return {
      scenario,
      inputMode: "choice",
      choiceId: "progress",
      reason: `${persona.label} は「${persona.evaluationLens}」という観点から、共有記憶になり得る行動を重視する。`,
      expectedWorldImpact: "探索中の局所的な支援行動が、後続の噂、関係性、world beat として現れることを期待する。",
    };
  }

  if (scenario === "resource-conflict") {
    return {
      scenario,
      inputMode: "choice",
      choiceId: "progress",
      reason: `${persona.label} は「${persona.playStyle}」というプレイスタイルで、同じ世界内の同時行動と共有リソース競合を検証する。`,
      expectedWorldImpact: "同時探索または進行時の競合が公平に解決され、プレイを止めずに resource constraint が記録されることを期待する。",
    };
  }

  return {
    scenario,
    inputMode: "free_text",
    inputText:
      "現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。",
    reason: `${persona.label} は遅れて参加し、公開された世界イベントに追跡可能な原因があるかを検証する。`,
    expectedWorldImpact: "応答から broadcast、memory、recent history を通じた共有世界の連続性が観測できることを期待する。",
  };
}
