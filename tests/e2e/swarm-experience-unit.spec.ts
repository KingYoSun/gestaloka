import { expect, test } from "@playwright/test";

import { parseJudgeResponse, experienceHasWarning, type SwarmExperienceEvaluation } from "./swarm/experienceJudge";
import { experienceWarningCount, experienceWarnings } from "./swarm/reporter";

test("swarm experience judge parses valid JSON response", () => {
  const parsed = parseJudgeResponse({
    personas: [
      {
        personaId: "story-player",
        ux_clarity: { score: 4, rating: "good", rationale: "Clear turn state." },
        gameplay_fun: { score: 3, rating: "acceptable", rationale: "Meaningful but slow." },
        story_progression: { score: 5, rating: "good", rationale: "Causal echoes are visible." },
        overall: { score: 4, rating: "good", rationale: "Strong enough." },
        suggestions: ["Keep consequence summaries closer to the action."],
      },
    ],
  });

  expect(parsed.personas).toHaveLength(1);
  expect(parsed.personas[0].overall.score).toBe(4);
});

test("swarm experience judge rejects malformed scores", () => {
  expect(() =>
    parseJudgeResponse({
      personas: [
        {
          personaId: "story-player",
          ux_clarity: { score: 6, rating: "good", rationale: "Invalid." },
          gameplay_fun: { score: 3, rating: "acceptable", rationale: "Ok." },
          story_progression: { score: 3, rating: "acceptable", rationale: "Ok." },
          overall: { score: 3, rating: "acceptable", rationale: "Ok." },
          suggestions: [],
        },
      ],
    }),
  ).toThrow(/score/);
});

test("swarm experience warnings summarize low and blocked evaluations", () => {
  const low = evaluation("story-player", 2, "needs work", "Thin story evidence.");
  const blocked = evaluation("mmo-player", null, "blocked", "Missing judge config.");

  expect(experienceHasWarning(low, 3)).toBe(true);
  expect(experienceWarningCount([low, blocked])).toBe(2);
  expect(experienceWarnings([low, blocked]).join("\n")).toContain("story-player");
  expect(experienceWarnings([low, blocked]).join("\n")).toContain("mmo-player");
});

function evaluation(
  personaId: string,
  score: number | null,
  rating: SwarmExperienceEvaluation["overall"]["rating"],
  rationale: string,
): SwarmExperienceEvaluation {
  const dimension = { score, rating, rationale };
  return {
    personaId,
    ux_clarity: dimension,
    gameplay_fun: dimension,
    story_progression: dimension,
    overall: dimension,
    suggestions: [],
    warnings: rating === "blocked" ? [rationale] : [],
    judge: { status: rating === "blocked" ? "blocked" : "ok", modelId: "test-model", message: null },
    evidence: {
      viewport: { kind: "desktop", width: 1280, height: 900 },
      decisions: [],
      turns: [],
    },
  };
}
