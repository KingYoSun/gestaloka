import type { SwarmUserPersona } from "./userPersonas";

export type SwarmDecision = {
  scenario:
    | "shared-impact"
    | "resource-conflict"
    | "world-event"
    | "persistent-entity-revisit"
    | "starter-quest-opening"
    | "starter-quest-advance"
    | "quest-leave"
    | "post-leave-explore"
    | "quest-resume"
    | "quest-epilogue-progress";
  submissionMode: "suggested_action" | "free_text" | "quest_button";
  suggestedActionSelection?: SwarmSuggestedActionSelection;
  inputText?: string;
  questButtonAction?: "accept_quest" | "decline_quest" | "ignore_quest" | "leave_quest" | "resume_quest";
  reason: string;
  expectedWorldImpact: string;
};

export type SwarmSuggestedActionSelection = {
  label: string;
  preferredTextPatterns: string[];
  fallbackActionNumber: 1 | 2 | 3;
};

export function decisionForPersona(persona: SwarmUserPersona, scenario: SwarmDecision["scenario"]): SwarmDecision {
  if (scenario === "starter-quest-opening") {
    return {
      scenario,
      submissionMode: "suggested_action",
      suggestedActionSelection: {
        label: "公開証言ホールで来訪者ログを確認する",
        preferredTextPatterns: [
          "公開.*(登録|証言|ログ|市民権)",
          "来訪者ログ.*(確認|登録|証言|確定)",
          "到着ログ.*(確認|登録|証言)",
          "visitor log|witness|public",
        ],
        fallbackActionNumber: 1,
      },
      reason: `${persona.label} は「${persona.evaluationLens}」という観点から、開始時点で提示済みの来訪者ログ登録を文面どおり進める。`,
      expectedWorldImpact: "starter quest が開始時点から active で表示され、公開ログ確認の行動で章または進捗が前へ進むことを期待する。",
    };
  }

  if (scenario === "starter-quest-advance") {
    return {
      scenario,
      submissionMode: "free_text",
      inputText: "来訪者ログ登録を進めるため、公開証言ホールでカナタの手続きを手伝い、確認済みの到着ログを正式な証言へ近づける。",
      reason: `${persona.label} は active な starter quest を進め、文面が前進や完了を示す行動で chapter が更新されるかを確認する。`,
      expectedWorldImpact: "来訪者ログ登録の行動により body または epilogue の文脈が journal と scene に残ることを期待する。",
    };
  }

  if (scenario === "quest-leave") {
    return {
      scenario,
      submissionMode: "free_text",
      inputText: "来訪者ログ登録から一度だけ距離を取り、今いる場所と周囲の反応を確かめてから戻れる余地を残す。",
      reason: `${persona.label} はクエストを一度離れ、AI GM が自然文の離脱意図を同じ場面の結果として扱うかを確認する。`,
      expectedWorldImpact: "hidden quest action ではなく自然文行動として解決され、journal と scene に寄り道可能な文脈が残ることを期待する。",
    };
  }

  if (scenario === "post-leave-explore") {
    return {
      scenario,
      submissionMode: "suggested_action",
      suggestedActionSelection: {
        label: "離脱中に周辺の噂と手掛かりを探る",
        preferredTextPatterns: [
          "(探|噂|視線|手掛かり|痕跡|記録|万象図書館)",
          "explore|trace|rumor|lead|record|library",
        ],
        fallbackActionNumber: 3,
      },
      reason: `${persona.label} はクエスト離脱後も同じ世界で探索を続け、寄り道が通常 turn として解決されるかを確認する。`,
      expectedWorldImpact: "寄り道の自然文 turn が解決され、同一 world の event として記録され、戻れる文脈が scene に残ることを期待する。",
    };
  }

  if (scenario === "quest-resume") {
    return {
      scenario,
      submissionMode: "free_text",
      inputText: "寄り道で得た手掛かりを持って、来訪者ログ登録の場面へ戻り、カナタと公開証言ホールの手続きを再び進める。",
      reason: `${persona.label} は寄り道後に自然文でクエスト文脈へ戻り、AI GM が中断前後の因果を保てるかを確認する。`,
      expectedWorldImpact: "hidden resume action ではなく、自然文の再開意図として同じ quest context の続きが scene に残ることを期待する。",
    };
  }

  if (scenario === "quest-epilogue-progress") {
    return {
      scenario,
      submissionMode: "free_text",
      inputText:
        "再開した来訪者ログ登録を最後まで手伝い、公開証言ホールで確認済みログを確定し、案内担当へ完了報告を届ける。",
      reason: `${persona.label} は再開したクエストを最後まで進めようとし、AI GM が締めの意図を結果と次状況に反映するかを確認する。`,
      expectedWorldImpact: "自然文の締め行動が解決され、完了または次の確認点が journal と scene に残ることを期待する。",
    };
  }

  if (scenario === "persistent-entity-revisit") {
    return {
      scenario,
      submissionMode: "free_text",
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
      submissionMode: "suggested_action",
      suggestedActionSelection: forwardSuggestedActionSelection("共有世界に残る前進行動を選ぶ"),
      reason: `${persona.label} は「${persona.evaluationLens}」という観点から、共有記憶になり得る行動を重視する。`,
      expectedWorldImpact: "探索中の局所的な支援行動が、後続の噂、関係性、world beat として現れることを期待する。",
    };
  }

  if (scenario === "resource-conflict") {
    return {
      scenario,
      submissionMode: "free_text",
      inputText:
        "ネクサス公開登録所で、同じ案内担当カナタと公開証言ホールの確認枠を使って来訪者ログ登録を急いで進め、他の来訪者と同じ手続き資源に同時に圧をかける。",
      reason: `${persona.label} は「${persona.playStyle}」というプレイスタイルで、同じ世界内の同時行動と共有リソース競合を検証する。`,
      expectedWorldImpact: "同時探索または進行時の競合が公平に解決され、プレイを止めずに resource constraint が記録されることを期待する。",
    };
  }

  return {
    scenario,
    submissionMode: "free_text",
    inputText:
      "ネクサス市の公開ログ、市場の痕跡、生成された現地NPCや小コミュニティを照合し、どの直近行動が共有世界の状況を変えたのかを尋ねる。",
    reason: `${persona.label} は遅れて参加し、公開された世界イベントに追跡可能な原因があるかを検証する。`,
    expectedWorldImpact: "応答から broadcast、memory、recent history を通じた共有世界の連続性が観測できることを期待する。",
  };
}

export function decisionActionText(decision: SwarmDecision): string {
  const legacy = decision as SwarmDecision & {
    choiceSelection?: { label?: string };
    inputMode?: string;
    questAction?: string;
  };
  return (
    decision.inputText ??
    decision.suggestedActionSelection?.label ??
    questButtonActionText(decision.questButtonAction) ??
    legacy.choiceSelection?.label ??
    legacy.questAction ??
    decision.submissionMode ??
    legacy.inputMode ??
    ""
  );
}

function forwardSuggestedActionSelection(label: string): SwarmSuggestedActionSelection {
  return {
    label,
    preferredTextPatterns: [
      "(手伝|進展|前へ|信頼|見聞き|報告|次の段取り|次の進展)",
      "help|advance|report|next|forward",
    ],
    fallbackActionNumber: 2,
  };
}

function questButtonActionText(action: SwarmDecision["questButtonAction"]): string | null {
  if (action === "accept_quest") {
    return "提示されたクエストを受ける";
  }
  if (action === "decline_quest") {
    return "提示されたクエストを見送る";
  }
  if (action === "ignore_quest") {
    return "提示されたクエストを無視して今の場面を続ける";
  }
  if (action === "leave_quest") {
    return "進行中のクエストからいったん離れる";
  }
  if (action === "resume_quest") {
    return "中断していたクエストを再開する";
  }
  return null;
}
