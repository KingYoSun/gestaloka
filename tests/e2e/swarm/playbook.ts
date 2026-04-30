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
      reason: `${persona.label} values actions that can become shared memory through this lens: ${persona.evaluationLens}`,
      expectedWorldImpact: "A local act of support should surface later as rumor, relationship, or world beat.",
    };
  }

  if (scenario === "resource-conflict") {
    return {
      scenario,
      inputMode: "choice",
      choiceId: "progress",
      reason: `${persona.label} pressure-tests progress paths and shared-resource contention through this play style: ${persona.playStyle}`,
      expectedWorldImpact: "Concurrent progress should resolve fairly and record any resource constraint without blocking play.",
    };
  }

  return {
    scenario,
    inputMode: "free_text",
    inputText:
      "I compare the current gate reports with what travelers are saying and ask which recent action changed the local situation.",
    reason: `${persona.label} joins late and probes whether public world events have a traceable cause.`,
    expectedWorldImpact: "The response should expose shared-world continuity through broadcast, memory, or recent history.",
  };
}
