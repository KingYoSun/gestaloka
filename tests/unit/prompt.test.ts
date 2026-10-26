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
    observations: [{ edge, sourceChanged: true, timeAdvanced: true }],
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
  const packed = compact(input) as {
    values: Record<string, unknown>;
    context: unknown;
  };
  const expand = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(expand);
    if (v && typeof v === "object") {
      if ("$ref" in v) {
        const key = String(v.$ref);
        const item = expand(packed.values[key]);
        return item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          "kind" in item &&
          !("id" in item)
          ? { id: key, ...item }
          : item;
      }
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

test("照会をまたぐグラフの参照を共有し、追記で既存のprefixを変更しない", () => {
  const node = {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "existence",
    text: "本人",
  };
  const schema = z.toJSONSchema(z.object({ text: z.string() }).strict());
  const initial = [
    { role: "system" as const, content: "指示" },
    {
      role: "user" as const,
      content: JSON.stringify({
        initialContext: [node, node],
        controlledActorIds: [node.id],
        request: { at: 1 },
        responseSchema: schema,
      }),
    },
  ];
  const first = anthropicPrompt(initial)!;
  const next = anthropicPrompt([
    ...initial,
    { role: "assistant", content: '{"type":"query"}' },
    {
      role: "user",
      content: JSON.stringify({
        results: [node],
        dependencies: [{ key: `node:${node.id}`, version: 7 }],
      }),
    },
  ])!;
  expect(next.messages[0]).toEqual(first.messages[0]);
  const source = JSON.stringify(next.messages);
  expect(source.match(/\\"kind\\":\\"existence\\"/g)?.length).toBe(1);
  expect(source).toContain("$ref");
  expect(source).toContain(`node:${node.id}`);
});

test("キャッシュ境界で分割しても単一のJSONを復元でき、履歴・参照・変更フラグを失わない", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const node = { id, kind: "existence", text: "同一性を維持する存在" };
  const schema = z.toJSONSchema(z.object({ text: z.string() }).strict());
  const original = {
    initialContext: [
      { node },
      { node, sourceChanged: null, period: { from: 1, until: 9 } },
    ],
    controlledActorIds: [id],
    request: { at: 9, rootIds: [id] },
  };
  const prompt = anthropicPrompt([
    { role: "system", content: "指示" },
    {
      role: "user",
      content: JSON.stringify({ ...original, responseSchema: schema }),
    },
  ])!;
  const blocks = prompt.messages[0]!.content as {
    text: string;
    cache_control?: unknown;
  }[];
  const packet = JSON.parse(blocks.map((b) => b.text).join("")) as {
    records: Record<string, unknown>;
    [key: string]: unknown;
  };
  const expand = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(expand);
    if (v && typeof v === "object") {
      if ("$ref" in v) {
        const key = String(v.$ref);
        const item = expand(packet.records[key]);
        return item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          "kind" in item &&
          !("id" in item)
          ? { id: key, ...item }
          : item;
      }
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, expand(x)]),
      );
    }
    return v;
  };
  expect(
    expand(
      Object.fromEntries(
        Object.entries(packet).filter(([key]) => key !== "records"),
      ),
    ),
  ).toEqual(original);
  expect(
    blocks.filter((b) => b.cache_control).length + prompt.system.length,
  ).toBeLessThanOrEqual(4);
  const history = Array.from({ length: 105 }, (_, at) => ({
    text: `出来事${at}`,
    period: { from: at },
  }));
  const own = {
    observerId: id,
    interpretations: [],
    observations: history,
    at: 105,
    ownIntentions: ["本人だけの意図"],
  };
  const ownPrompt = anthropicPrompt([
    { role: "system", content: "本人の意図" },
    {
      role: "user",
      content: JSON.stringify({ ...own, responseSchema: schema }),
    },
  ])!;
  const ownBlocks = ownPrompt.messages[0]!.content as { text: string }[];
  expect(JSON.parse(ownBlocks.map((b) => b.text).join(""))).toEqual(own);
});

test("動的な判断主体のキーをAPIの固定オブジェクトへ展開し、値の意味とZod検証を維持する", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const schema = z
    .object({
      decisions: z.record(z.uuid(), z.enum(["pending", "finished"])),
      elapsed: z.number().int().nonnegative(),
      text: z.string().min(1),
    })
    .strict();
  const original = z.toJSONSchema(schema, { io: "input" });
  const wire = outputSchema(original, [id]);
  expect(wire).toMatchObject({
    properties: {
      decisions: {
        type: "object",
        properties: { [id]: { enum: ["pending", "finished"] } },
        required: [id],
        additionalProperties: false,
      },
    },
  });
  expect(JSON.stringify(wire)).not.toMatch(/minimum|minLength|propertyNames/);
  expect(
    schema.parse(
      parseOutput(
        JSON.stringify({
          decisions: { [id]: "pending" },
          elapsed: 0,
          text: "自由な内容",
        }),
      ),
    ),
  ).toEqual({ decisions: { [id]: "pending" }, elapsed: 0, text: "自由な内容" });
  expect(() =>
    schema.parse(parseOutput('{"decisions":{},"elapsed":-1,"text":""}')),
  ).toThrow();
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
  expect(
    blocks(first).find((b) => b.text.includes("background"))!.cache_control,
  ).toBeDefined();
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
  expect(fallback.system[0]!.text).toContain(
    "responseSchema=" + JSON.stringify(outputSchema(schema)),
  );
});
