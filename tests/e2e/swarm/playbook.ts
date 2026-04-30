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
  if (persona.id === "novel-lover") {
    return {
      scenario,
      inputMode: "choice",
      choiceId: "progress",
      reason: "This persona values emotionally meaningful help that can become shared memory.",
      expectedWorldImpact: "A local act of support should surface later as rumor, relationship, or world beat.",
    };
  }

  if (persona.id === "mmo-gamer") {
    return {
      scenario,
      inputMode: "choice",
      choiceId: "progress",
      reason: "This persona pressure-tests progress paths and shared-resource contention.",
      expectedWorldImpact: "Concurrent progress should resolve fairly and record any resource constraint without blocking play.",
    };
  }

  return {
    scenario,
    inputMode: "free_text",
    inputText:
      "I compare the current gate reports with what travelers are saying and ask which recent action changed the local situation.",
    reason: "This persona joins late and probes whether public world events have a traceable cause.",
    expectedWorldImpact: "The response should expose shared-world continuity through broadcast, memory, or recent history.",
  };
}

