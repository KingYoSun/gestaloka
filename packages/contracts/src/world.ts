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

const SpawnSubject = z.object({
  kind: z.enum(["instant-npc", "existence", "script", "event"]),
  species: z.string().trim().min(1),
  description: z.string().trim().min(1),
});
const spawnCount = z.number().int().positive().safe();
const spawn = SpawnSubject.extend({ probability: z.number().min(0).max(1) });
export const SpawnRule = z.union([
  spawn
    .extend({ minCount: spawnCount, maxCount: spawnCount })
    .strict()
    .refine(
      (rule) => rule.minCount <= rule.maxCount,
      "最大発生数は最低発生数以上にしてください",
    ),
  spawn.extend({ count: spawnCount }).strict(),
]);
export const Appearance = SpawnSubject.extend({
  id: z.uuid(),
  count: spawnCount
    .optional()
    .describe("個数つきの1つの物品として残った数。死亡ドロップの物品に付く"),
  ruleId: z
    .uuid()
    .optional()
    .describe(
      "出現させた発生用ノード。個体が死亡したときのドロップの抽選に使う",
    ),
}).strict();
export type Appearance = z.infer<typeof Appearance>;

// 出現個体はノードを持たない。行為者・作用の対象になった個体を、出現を記録した出来事までたどれるようにする。
const InstantRef = z.object({ id: z.uuid(), sourceEventId: z.uuid() }).strict();
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
      count: z
        .number()
        .int()
        .positive()
        .safe()
        .optional()
        .describe("物品の個数。無い物品は、個数を数えないひとまとまり"),
    })
    .strict(),
  z
    .object({
      ...Content,
      kind: z.literal("script"),
      type: z.literal("memo").optional(),
      spawn: SpawnRule.optional(),
    })
    .strict(),
  z
    .object({
      ...Content,
      kind: z.literal("event"),
      appearances: z.array(Appearance).optional(),
      instantActor: InstantRef.optional(),
      instantTarget: InstantRef.optional(),
      period: Period,
    })
    .strict(),
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
// hasの役割。holdは物品の所在、useは保管先の利用、skillは身につけた技能を表す。
export const BelongingRole = z.enum(["hold", "use", "skill"]);
export type BelongingRole = z.infer<typeof BelongingRole>;
export const WorldEdge = z
  .object({
    id: z.uuid(),
    kind: RelationKind,
    source: z.uuid(),
    target: z.uuid(),
    role: z
      .enum(["content", "about", ...BelongingRole.options, "summary"])
      .optional()
      .describe(
        "status/interpretはcontentかabout。hasは役割なしが所有で、hold・use・skill・summaryは実行側だけが記録する",
      ),
    text: z
      .string()
      .optional()
      .describe(
        "関係の内容。seeでは受容本文。status/contentでtext=locationは主体の現在の所在専用のscriptを示し、status/aboutで場所を参照する",
      ),
    period: Period,
    observation: Observation.optional(),
  })
  .strict()
  .refine(
    (edge) =>
      edge.kind === "status" || edge.kind === "interpret"
        ? edge.role === "content" || edge.role === "about"
        : edge.role === undefined ||
          (edge.kind === "has" &&
            edge.role !== "content" &&
            edge.role !== "about"),
    "status/interpretはcontent/about、hasは所在・利用・技能・要約の役割だけを持てます",
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
