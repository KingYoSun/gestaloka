import { z } from "zod";

const Time = z.number().int().nonnegative().safe();
const Period = z
  .object({ from: Time, until: Time.optional() })
  .strict()
  .refine(
    (period) => period.until === undefined || period.until >= period.from,
    "期間の終点は始点以降にしてください",
  );
const Content = { id: z.uuid(), text: z.string() };
const Observation = z
  .object({
    aspect: z.string(),
    through: Time,
    sourceIds: z.array(z.uuid()).default([]),
    pathIds: z.array(z.uuid()).default([]),
    versions: z
      .record(z.string(), Time)
      .optional()
      .describe("サーバーが確定時に保存する版。モデルからの値は使用しない"),
  })
  .strict();

export const WorldNode = z.discriminatedUnion("kind", [
  z
    .object({
      ...Content,
      text: z
        .string()
        .describe(
          "同一性を参照するための呼称・識別用ラベル。職業・所属・居場所・性質・状態の事実はscriptとstatusで表す",
        ),
      kind: z.literal("existence"),
    })
    .strict(),
  z.object({ ...Content, kind: z.literal("script") }).strict(),
  z.object({ ...Content, kind: z.literal("event"), period: Period }).strict(),
]);
export type WorldNode = z.infer<typeof WorldNode>;
export const RelationKind = z.enum([
  "has",
  "effect",
  "happen",
  "see",
  "interpret",
  "status",
]);
export type RelationKind = z.infer<typeof RelationKind>;
export const WorldEdge = z
  .object({
    id: z.uuid(),
    kind: RelationKind,
    source: z.uuid(),
    target: z.uuid(),
    role: z.enum(["content", "about"]).optional(),
    text: z.string().optional(),
    period: Period,
    observation: Observation.optional(),
  })
  .strict()
  .refine(
    (edge) =>
      edge.kind === "status" || edge.kind === "interpret"
        ? edge.role !== undefined
        : edge.role === undefined,
    "status/interpretだけがcontent/aboutの役割を持ちます",
  )
  .refine(
    (edge) => edge.observation === undefined || edge.kind === "see",
    "観測の範囲はseeだけに指定してください",
  );
export type WorldEdge = z.infer<typeof WorldEdge>;

export const Change = z
  .object({
    nodes: z.array(WorldNode),
    revisions: z.array(WorldNode).default([]),
    edges: z.array(WorldEdge),
    endEdges: z.array(z.uuid()),
  })
  .strict()
  .refine(
    (change) =>
      new Set([...change.nodes, ...change.revisions].map((node) => node.id))
        .size ===
        change.nodes.length + change.revisions.length &&
      new Set([...change.edges.map((edge) => edge.id), ...change.endEdges])
        .size ===
        change.edges.length + change.endEdges.length,
    "一つの差分で同じ同一性を重複して変更できません",
  );
export type Change = z.infer<typeof Change>;

export function normalizeChange(change: Change, at: number): Change {
  return {
    ...change,
    edges: change.edges.map((edge) => {
      if (edge.kind !== "see") return edge;
      const through =
        edge.observation?.through ?? Math.min(edge.period.until ?? at, at);
      if (through < edge.period.from || through > at)
        throw new Error("観測・受容した範囲が確定時点と整合しません");
      return {
        ...edge,
        observation: {
          aspect: edge.observation?.aspect ?? edge.text ?? "",
          through,
          sourceIds: [
            ...new Set([edge.target, ...(edge.observation?.sourceIds ?? [])]),
          ].sort(),
          pathIds: [...new Set(edge.observation?.pathIds ?? [])].sort(),
        },
      };
    }),
  };
}

export function requestedChange(change: Change, at: number): Change {
  return {
    ...change,
    edges: change.edges.map((edge) => {
      const { observation, ...base } = edge;
      if (!observation) return edge;
      if (
        observation.aspect === (edge.text ?? "") &&
        observation.through === Math.min(edge.period.until ?? at, at) &&
        observation.sourceIds.length === 1 &&
        observation.sourceIds[0] === edge.target &&
        observation.pathIds.length === 0
      )
        return base;
      const { versions: _versions, ...scope } = observation;
      void _versions;
      return { ...base, observation: scope };
    }),
  };
}

export function validateConnection(
  edge: WorldEdge,
  source: WorldNode,
  target: WorldNode,
) {
  const valid = (() => {
    switch (edge.kind) {
      case "has":
        return source.kind === "existence" && target.kind !== "event";
      case "effect":
        return source.kind !== "script" && target.kind === "existence";
      case "happen":
        return source.kind === "existence" && target.kind === "event";
      case "see":
        return source.kind === "existence";
      case "interpret":
      case "status":
        return edge.role === "content"
          ? source.kind === "existence" && target.kind === "script"
          : source.kind === "script";
    }
  })();
  if (!valid)
    throw new Error(`接続形式が不正です: ${edge.kind}/${edge.role ?? ""}`);
}

export function bindingScripts(edges: readonly WorldEdge[]) {
  return [
    ...new Map(
      edges
        .filter((edge) => edge.kind === "interpret" || edge.kind === "status")
        .map((edge) => [
          `${edge.kind}:${edge.role === "content" ? edge.target : edge.source}`,
          {
            kind: edge.kind as "interpret" | "status",
            id: edge.role === "content" ? edge.target : edge.source,
          },
        ]),
    ).values(),
  ];
}

export function validateBindings(
  kind: "interpret" | "status",
  id: string,
  edges: readonly WorldEdge[],
) {
  const contents = edges.filter(
    (edge) =>
      edge.kind === kind && edge.role === "content" && edge.target === id,
  );
  const abouts = edges.filter(
    (edge) => edge.kind === kind && edge.role === "about" && edge.source === id,
  );
  if (abouts.length && !contents.length)
    throw new Error(
      `${kind}/aboutの記述に主体からのcontent接続がありません: ${id}`,
    );
  if (kind !== "interpret") return;
  if (contents.length && !abouts.length)
    throw new Error(`interpretには主体・内容・対象の接続が必要です: ${id}`);
  const intervals = abouts
    .map((edge) => edge.period)
    .sort((a, b) => a.from - b.from);
  for (const content of contents) {
    let cursor = content.period.from;
    for (const interval of intervals) {
      if (interval.from > cursor) break;
      cursor = Math.max(cursor, interval.until ?? Infinity);
    }
    if (cursor < (content.period.until ?? Infinity))
      throw new Error(`解釈が成立する期間にabout接続の欠落があります: ${id}`);
  }
}
