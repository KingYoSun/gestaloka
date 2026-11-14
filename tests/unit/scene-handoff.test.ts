import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { shortIds } from "../../packages/server/src/llm/short-ids.js";
import { sceneSources } from "../../packages/server/src/runtime/scene-sources.js";

test("短縮IDは呼び出し単位で再現でき、本文中のリテラルを保つ", () => {
  const id = randomUUID(),
    call = randomUUID(),
    messages = [
      {
        role: "user" as const,
        content: JSON.stringify({
          id,
          text: "~g1~",
          responseSchema: { format: "uuid", type: "string" },
        }),
      },
    ];
  const a = shortIds(call, messages),
    packet = JSON.parse(a.messages[0]!.content);
  expect(packet.id).toBe("~~g1~");
  expect(packet.text).toBe("~g1~");
  expect(packet.responseSchema.pattern).toMatch(/~~/);
  const result = JSON.stringify({
    changes: {
      nodes: [{ id: "~~n1~" }],
      edges: [{ id: "~~n2~", source: packet.id, target: "~~n1~" }],
    },
    text: packet.text,
  });
  const restored = JSON.parse(a.expand(result));
  expect(restored.changes.edges[0]).toMatchObject({
    source: id,
    target: restored.changes.nodes[0].id,
  });
  expect(restored.text).toBe("~g1~");
  expect(a.expand(result)).toBe(shortIds(call, messages).expand(result));
  expect(a.expand('{"id":"~~g9~"}')).toContain("invalidShortId");
});

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
