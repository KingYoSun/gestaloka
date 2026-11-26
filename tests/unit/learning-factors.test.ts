import { expect, test } from "vitest";
import {
  learningReferences,
  resolveLearningFactors,
} from "../../packages/server/src/runtime/learning-factors.js";
import { derivedId } from "../../packages/server/src/world/model.js";

test.each([":experience", ":action", ":proposal:2:experience"])(
  "同じ行動の確定済み経験 %s が選ばれたときだけ過去の試行を省く",
  (suffix) => {
    const commitId = derivedId("今回の行動");
    const id = derivedId(commitId + suffix);
    const experience = { ref: `experience:${id}`, impact: "hindered" };
    const attempt = { ref: "attempt:1", impact: "helped" };
    const unrelated = { ref: "attempt:2", impact: "helped" };
    const references = learningReferences(
      "本人",
      [
        {
          node: { id, kind: "event", text: "苦味で判別が難しくなる" },
          experiencedBy: "本人",
        },
      ],
      [
        {
          action: "茶を味見する",
          success: true,
          commitId,
          proposalIndex: suffix.startsWith(":proposal") ? 2 : undefined,
        },
        {
          action: "茶を味見する",
          success: true,
          commitId: derivedId("別の行動"),
        },
      ],
    );
    expect(resolveLearningFactors(references, [attempt])).toEqual([
      { label: "過去の試行（成功）「茶を味見する」", impact: "helped" },
    ]);
    expect(
      resolveLearningFactors(references, [attempt, experience, unrelated]),
    ).toEqual([
      { label: "経験「苦味で判別が難しくなる」", impact: "hindered" },
      { label: "過去の試行（成功）「茶を味見する」", impact: "helped" },
    ]);
  },
);
