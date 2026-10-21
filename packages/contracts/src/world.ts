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
    aspect: z
      .string()
      .describe("受容した側面・範囲。textがない場合は、受容内容の本文も含める"),
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
    text: z
      .string()
      .optional()
      .describe("関係の内容。seeではその存在に提示できる受容内容の本文"),
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
