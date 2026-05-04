import type { SwarmUserPersona } from "./userPersonas";

export type SwarmDecision = {
  scenario:
    | "shared-impact"
    | "resource-conflict"
    | "world-event"
    | "persistent-entity-revisit"
    | "quest-offer"
    | "quest-accept"
    | "quest-body-progress"
    | "quest-leave"
    | "post-leave-explore"
    | "quest-resume"
    | "quest-epilogue-progress";
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

  if (scenario === "quest-leave") {
    return {
      scenario,
      inputMode: "quest_action",
      questAction: "leave_quest",
      reason: `${persona.label} はクエストを一度離れ、進行中の物語が中断可能な状態として保持されるかを確認する。`,
      expectedWorldImpact: "クエストが paused になり、再開操作を選べる状態で journal に残ることを期待する。",
    };
  }

  if (scenario === "post-leave-explore") {
    return {
      scenario,
      inputMode: "choice",
      choiceId: "explore",
      reason: `${persona.label} はクエスト離脱後も同じ世界で探索を続け、寄り道が通常 turn として解決されるかを確認する。`,
      expectedWorldImpact: "paused quest を保持したまま探索 turn が解決され、同一 world の event として記録されることを期待する。",
    };
  }

  if (scenario === "quest-resume") {
    return {
      scenario,
      inputMode: "quest_action",
      questAction: "resume_quest",
      reason: `${persona.label} は寄り道後にクエストへ戻り、中断した文脈を再開できるかを確認する。`,
      expectedWorldImpact: "paused quest が active に戻り、同じ quest context の続きとして進行できることを期待する。",
    };
  }

  if (scenario === "quest-epilogue-progress") {
    return {
      scenario,
      inputMode: "free_text",
      inputText:
        "再開した来訪者ログ登録を最後まで手伝い、約束した確認を続け、案内担当へ完了報告を届ける。",
      reason: `${persona.label} は再開したクエストを最後まで進め、結末が epilogue として明示されるかを確認する。`,
      expectedWorldImpact: "クエストが completed になり、epilogue chapter が journal と scene に残ることを期待する。",
    };
  }

  if (scenario === "persistent-entity-revisit") {
    return {
      scenario,
      inputMode: "free_text",
      inputText:
        "ネクサス市の公開ログに残った同じ市場の小さな商店、情報屋、自治集団を探し、前の来訪者が関わった相手として再会できるか確かめる。",
      reason: `${persona.label} は後続参加者として、生きたNPC・場所・小コミュニティが一度きりで消えず、同じ世界で再利用されるかを確認する。`,
      expectedWorldImpact:
        "以前のturnで生成されたNPC、location、communityのいずれかが同じ semantic entity として再利用され、created=false の entity update または同等の再利用証拠が残ることを期待する。",
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
      "ネクサス市の公開ログ、市場の痕跡、生成された現地NPCや小コミュニティを照合し、どの直近行動が共有世界の状況を変えたのかを尋ねる。",
    reason: `${persona.label} は遅れて参加し、公開された世界イベントに追跡可能な原因があるかを検証する。`,
    expectedWorldImpact: "応答から broadcast、memory、recent history を通じた共有世界の連続性が観測できることを期待する。",
  };
}
