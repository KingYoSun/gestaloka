import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { sceneSources } from "../../packages/server/src/runtime/scene-sources.js";

test("背景の根拠には生成中に実際に読んだ関係だけを保存する", () => {
  const id = randomUUID(),
    source = randomUUID(),
    target = randomUUID(),
    edge = {
      id,
      source,
      target,
      kind: "status",
      role: "content",
      period: { from: 0 },
    };
  const node = { id: target, kind: "script", text: "元の状態" };
  const messages = [
    {
      role: "user" as const,
      content: JSON.stringify({
        initialContext: [{ result: { edge, script: node } }],
      }),
    },
  ];
  expect(
    sceneSources(messages, [{ subjectId: source, sourceRelationIds: [id] }])[
      id
    ],
  ).toMatchObject({ edge, targetText: node.text });
  expect(() =>
    sceneSources(messages, [
      { subjectId: source, sourceRelationIds: [target] },
    ]),
  ).toThrow("未照会");
});
