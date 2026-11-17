import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sceneDecision } from "../../packages/server/src/runtime/scene-decision.js";
import {
  outputSchema,
  strictOutput,
} from "../../packages/server/src/llm/prompt.js";

const actor = randomUUID(),
  npc = randomUUID(),
  place = randomUUID(),
  event = randomUUID(),
  inputId = randomUUID();
const frame = {
  request: {
    controlledActorId: actor,
    controlledInputId: inputId,
    intentions: [{ actorId: actor }],
    leavingActorIds: [] as string[],
  },
  background: { participants: [actor, npc] },
  sceneHistory: [
    { id: event, actorId: actor, receipts: [{ observerId: actor }] },
  ],
};
const messages = [{ role: "user" as const, content: JSON.stringify(frame) }];
const arrival = (eventId = event, observerId = npc) => ({
  type: "scene",
  events: [{ eventId, receipts: [{ observerId, text: "届いた内容" }] }],
  decisions: { [actor]: "finished" },
  elapsedMs: 0,
});

test("入力ID・他の発生・操作主体を既存の発生への受容として返さない", () => {
  const schema = sceneDecision([{ actorId: actor }], undefined, messages);
  expect(schema.safeParse(arrival()).success).toBe(true);
  expect(schema.safeParse(arrival(inputId)).success).toBe(false);
  expect(schema.safeParse(arrival(event, actor)).success).toBe(false);
  expect(
    schema.safeParse({
      ...arrival(),
      departures: [{ actorId: actor, eventIndex: 0 }],
    }).success,
  ).toBe(false);
});

test("照会で取得した履歴と新しい存在を参照へ追加し、本文と終了判断を保つ", () => {
  const older = randomUUID(),
    receiver = randomUUID();
  const query = {
    type: "query",
    requests: [{ kind: "scene-records", source: "history", id: older }],
  };
  const before = sceneDecision([{ actorId: actor }], false, messages);
  expect(before.safeParse(query).success).toBe(true);
  expect(
    before.safeParse({ ...arrival(older, receiver), concluded: false }).success,
  ).toBe(false);
  const update = {
    requests: query.requests,
    results: [
      {
        items: [
          { id: older, actorId: npc, receipts: [{ observerId: receiver }] },
        ],
      },
    ],
  };
  const after = sceneDecision([{ actorId: actor }], false, [
    ...messages,
    { role: "user", content: JSON.stringify(update) },
  ]);
  expect(
    after.safeParse({ ...arrival(older, receiver), concluded: false }).success,
  ).toBe(true);
  expect(
    after.safeParse({ ...arrival(older, receiver), concluded: true }).success,
  ).toBe(false);
  const wire = JSON.stringify(z.toJSONSchema(after, { io: "output" }));
  expect(wire).toContain(older);
  expect(wire).toContain(receiver);
});

test("空のcontextを生成せず、性質・解釈・存在・参加の追加は自由記述で扱う", () => {
  const schema = sceneDecision([{ actorId: actor }], undefined, messages);
  const empty = {
    type: "context",
    participants: [],
    facts: [],
    beliefs: [],
    creations: [],
    resolvedUnknowns: [],
  };
  expect(schema.safeParse(empty).success).toBe(false);
  expect(
    schema.safeParse({
      ...empty,
      facts: [{ subjectId: place, text: "新しい局所条件", aboutIds: [] }],
    }).success,
  ).toBe(true);
  expect(
    schema.safeParse({
      ...empty,
      beliefs: [{ subjectId: npc, text: "本人の解釈", aboutIds: [npc] }],
    }).success,
  ).toBe(true);
  expect(
    schema.safeParse({
      ...empty,
      creations: [{ id: randomUUID(), text: "新しい存在" }],
    }).success,
  ).toBe(true);
  expect(schema.safeParse({ ...empty, participants: [npc] }).success).toBe(
    true,
  );
});

test("OpenRouterでは空の説明・未完了内容を形式に含めない", () => {
  const original = z.toJSONSchema(z.object({ pending: z.string().min(1) }));
  expect(outputSchema(original, undefined, true)).toMatchObject({
    properties: { pending: { minLength: 1 } },
  });
  expect(
    strictOutput(outputSchema(original, undefined, true)).schema,
  ).toMatchObject({
    properties: { response: { properties: { pending: { minLength: 1 } } } },
  });
});
