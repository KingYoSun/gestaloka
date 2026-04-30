import type { SwarmUserPersona } from "./userPersonas";

export type SwarmDecision = {
  scenario: "shared-impact" | "resource-conflict" | "world-event";
  inputMode: "choice" | "free_text";
  choiceId?: "safe" | "progress" | "explore";
  inputText?: string;
  reason: string;
  expectedWorldImpact: string;
};

export function decisionForPersona(persona: SwarmUserPersona, scenario: SwarmDecision["scenario"]): SwarmDecision {
  if (scenario === "shared-impact") {
    return {
      scenario,
      inputMode: "choice",
      choiceId: "progress",
      reason: `${persona.label} は「${persona.evaluationLens}」という観点から、共有記憶になり得る行動を重視する。`,
      expectedWorldImpact: "局所的な支援行動が、後続の噂、関係性、world beat として現れることを期待する。",
    };
  }

  if (scenario === "resource-conflict") {
    return {
      scenario,
      inputMode: "choice",
      choiceId: "progress",
      reason: `${persona.label} は「${persona.playStyle}」というプレイスタイルで、進行経路と共有リソース競合を検証する。`,
      expectedWorldImpact: "同時進行時の競合が公平に解決され、プレイを止めずに resource constraint が記録されることを期待する。",
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
