import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { z } from "zod";
import {
  strictOutput,
  parseOutput,
} from "../../packages/server/src/llm/prompt.js";
import { Query } from "../../packages/server/src/runtime/agent.js";
import { SceneRecordQuery } from "../../packages/server/src/runtime/scene-records.js";
import {
  SceneContext,
  SceneStep,
  presentationEvidence,
} from "../../packages/server/src/runtime/scene-data.js";

const { cases } = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL("../fixtures/strict-output-2026-11-17.json.gz", import.meta.url),
    ),
  ).toString(),
) as {
  cases: {
    id: string;
    schema: Parameters<typeof strictOutput>[0];
    content: string;
    expected: unknown;
  }[];
};
const decision = z.discriminatedUnion("type", [
  ...SceneStep.options,
  SceneContext,
  z
    .object({
      type: z.literal("query"),
      requests: z.array(z.union([Query, SceneRecordQuery])),
    })
    .strict(),
]);

test("本番の復元失敗255件を固定している", () =>
  expect(cases).toHaveLength(255));
test.each(cases)(
  "本番応答$idの文字列・値・未指定と明示値を保って復元する",
  (fixture) => {
    const before = JSON.stringify(fixture);
    const decoded = strictOutput(fixture.schema).decode(
      parseOutput(fixture.content),
    );
    expect(decoded).toEqual(fixture.expected);
    expect(decision.safeParse(presentationEvidence(decoded)).success).toBe(
      true,
    );
    expect(JSON.stringify(fixture)).toBe(before);
  },
);
