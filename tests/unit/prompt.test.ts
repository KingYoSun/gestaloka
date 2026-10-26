import { expect, test } from "vitest";
import { z } from "zod";
import {
  anthropicPrompt,
  compact,
  outputSchema,
  parseOutput,
} from "../../packages/server/src/llm/prompt.js";

test("重複したグラフと観測を参照へ置換し、期間・来歴・変更フラグ・依存版を完全に復元できる", () => {
  const edge = {
    id: "edge",
    kind: "see",
    source: "person",
    target: "event",
    period: { from: 3, until: 9 },
    observation: {
      sourceIds: ["event"],
      pathIds: ["cause"],
      through: 9,
      aspect: "本人が実際に聞いた自由な記述".repeat(10),
    },
  };
  const input = {
    observations: [{ ...edge, sourceChanged: true }],
    history: [edge],
    node: {
      id: "event",
      kind: "event",
      text: edge.observation.aspect,
      period: edge.period,
    },
    anchors: {
      nodes: [
        {
          id: "event",
          kind: "event",
          text: edge.observation.aspect,
          period: edge.period,
        },
      ],
      edges: [edge],
    },
    dependencies: [{ key: "node:event", version: 7 }],
  };
  const packed = compact(input) as { values: unknown[]; context: unknown };
  const expand = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(expand);
    if (v && typeof v === "object") {
      if ("$value" in v)
        return expand(packed.values[(v as { $value: number }).$value]);
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, expand(x)]),
      );
    }
    return v;
  };
  expect(expand(packed.context)).toEqual(input);
  expect(JSON.stringify(packed).length).toBeLessThan(
    JSON.stringify(input).length,
  );
});

test("構造化出力の辞書を可逆変換し、APIにない制約と意味の検証をZodへ残す", () => {
  const schema = z
    .object({
      decisions: z.record(z.uuid(), z.enum(["pending", "finished"])),
      elapsed: z.number().int().nonnegative(),
      text: z.string().min(1),
    })
    .strict();
  const original = z.toJSONSchema(schema, { io: "input" });
  const wire = outputSchema(original);
  expect(wire).toMatchObject({
    properties: {
      decisions: {
        type: "array",
        items: { required: ["key", "value"], additionalProperties: false },
      },
      elapsed: { type: "integer" },
      text: { type: "string" },
    },
  });
  expect(JSON.stringify(wire)).not.toMatch(/minimum|minLength|propertyNames/);
  const id = "00000000-0000-4000-8000-000000000001";
  const value = parseOutput(
    JSON.stringify({
      decisions: [{ key: id, value: "pending" }],
      elapsed: 0,
      text: "自由な内容",
    }),
    original,
  );
  expect(schema.parse(value)).toEqual({
    decisions: { [id]: "pending" },
    elapsed: 0,
    text: "自由な内容",
  });
  expect(() =>
    schema.parse(
      parseOutput('{"decisions":[],"elapsed":-1,"text":""}', original),
    ),
  ).toThrow();
  expect(() =>
    parseOutput(
      JSON.stringify({
        decisions: [
          { key: id, value: "pending" },
          { key: id, value: "finished" },
        ],
        elapsed: 0,
        text: "x",
      }),
      original,
    ),
  ).toThrow("重複");
});

test("応答全体が単一のJSONコードフェンスの場合だけ正規化する", () => {
  expect(parseOutput('```json\n{"text":"自由な内容"}\n```')).toEqual({
    text: "自由な内容",
  });
  for (const text of [
    "説明\n```json\n{}\n```",
    "```json\n{}\n```\n追加説明",
    "```json\n{}\n```\n```json\n{}\n```",
    '{"text":',
  ])
    expect(() => parseOutput(text)).toThrow();
});

test("背景・追記履歴を可変の入力より前に置き、本人以外の知識を加えず同じprefixを再利用する", () => {
  const schema = z.toJSONSchema(z.object({ text: z.string() }).strict());
  const messages = (history: unknown[], at: number) => [
    { role: "system" as const, content: "固定の指示" },
    {
      role: "user" as const,
      content: JSON.stringify({
        background: { synopsis: "背景" },
        sceneHistory: history,
        request: { at },
        responseSchema: schema,
      }),
    },
  ];
  const first = anthropicPrompt(messages([{ text: "出来事1" }], 1))!;
  const next = anthropicPrompt(
    messages([{ text: "出来事1" }, { text: "出来事2" }], 2),
  )!;
  expect(first.system).toEqual(next.system);
  const blocks = (p: typeof first) =>
    p.messages[0]!.content as { text: string; cache_control?: unknown }[];
  expect(
    blocks(first)
      .slice(0, 2)
      .map((b) => b.text),
  ).toEqual(
    blocks(next)
      .slice(0, 2)
      .map((b) => b.text),
  );
  expect(blocks(first)[0]!.cache_control).toBeDefined();
  expect(blocks(first).at(-1)!.cache_control).toBeUndefined();
  expect(JSON.stringify(first.messages)).not.toContain("responseSchema");
  const own = anthropicPrompt([
    { role: "system", content: "本人の意図" },
    {
      role: "user",
      content: JSON.stringify({
        observerId: "本人",
        observations: [{ text: "本人だけが知る情報" }],
        interpretations: [],
        at: 2,
        responseSchema: schema,
      }),
    },
  ])!;
  expect(JSON.stringify(own.messages)).toContain("本人だけが知る情報");
  expect(JSON.stringify(own.messages)).not.toContain("他人の秘密");
  const empty = anthropicPrompt(messages([], 0))!;
  expect(JSON.stringify(empty.messages)).toContain("sceneHistory");
  const fallback = anthropicPrompt(messages([], 0), false)!;
  expect(fallback.format).toBeUndefined();
  expect(fallback.schema).toBeUndefined();
  expect(fallback.system[0]!.text).toContain(
    "responseSchema=" + JSON.stringify(schema),
  );
});
