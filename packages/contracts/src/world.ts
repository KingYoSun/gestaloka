import { z } from "zod";
import { DrawTable } from "./draw.js";

const Time = z.number().int().nonnegative().safe();
const Period = z
  .object({ from: Time, until: Time.optional() })
  .strict()
  .refine(
    (period) => period.until === undefined || period.until >= period.from,
    "期間の終点は始点以降にしてください",
  );
export const PlaceSeries = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^\r\n]+$/)
  .describe("この世界の特定の地理的範囲を識別する系統名");
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
const spawn = SpawnSubject.extend({
  probability: z.number().min(0).max(1),
  price: z
    .object({
      seriesId: z.uuid(),
      label: z.string().trim().min(1),
      count: spawnCount,
    })
    .strict()
    .optional()
    .describe(
      "出現個体が品物と引き換えに受け取る代価の系列・呼称・個数。spawn-tradeで個体の発生用ノードへ結んだ品物に指定する",
    ),
});
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
  summons: z.string().trim().min(1).optional(),
  count: spawnCount
    .optional()
    .describe("出現した一団の個体数、または一つにまとまった物品の個数"),
  ruleId: z
    .uuid()
    .optional()
    .describe(
      "出現させた発生用ノード。個体が死亡したときのドロップの抽選に使う",
    ),
}).strict();
export type Appearance = z.infer<typeof Appearance>;

// 出現個体はノードを持たない。行為者・作用の対象になった個体を、出現を記録した出来事までたどれるようにする。
// 本人以外の参加者のうち、誰が読めるか。世界内の事実ではなく読取りの範囲で、GMの判定は範囲に関係なく読む。
const viewers = z
  .union([z.literal("all"), z.array(z.uuid())])
  .optional()
  .describe(
    "本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ。省くと、手にしている物と状態は全員、技能と保管先の中身は本人だけ",
  );
const InstantRef = z.object({ id: z.uuid(), sourceEventId: z.uuid() }).strict();
export const InstantReduction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("death"), count: spawnCount }).strict(),
  z
    .object({
      kind: z.literal("separation"),
      count: spawnCount,
      stays: z.boolean(),
    })
    .strict(),
]);
export const InstantReductionResult = z
  .object({
    targetId: z.uuid(),
    kind: z.enum(["death", "separation"]),
    count: spawnCount,
    remaining: z.number().int().nonnegative().safe(),
    separatedId: z.uuid().optional(),
  })
  .strict();
const UnitsPerSlot = z.union([
  z.number().int().positive().safe(),
  z.literal("unlimited"),
]);
// 世界の設定で、参加する人物へ渡す系列つきの物品。
export const StartingItem = z
  .object({
    label: z.string().trim().min(1).describe("物品の呼称"),
    count: z.number().int().positive().safe().describe("個数"),
    seriesId: z.uuid().describe("物品の系列ID"),
    unitsPerSlot: UnitsPerSlot.optional().describe(
      "1枠あたりの個数。省くと世界の標準、unlimitedなら何個でも1枠",
    ),
  })
  .strict();
const ConditionRelationKind = z.enum([
  "has",
  "effect",
  "happen",
  "see",
  "interpret",
  "status",
]);
export const RelationKind = z.enum([
  ...ConditionRelationKind.options,
  "required",
]);
export type RelationKind = z.infer<typeof RelationKind>;
const WorldRole = z.enum(["content", "about", "use", "skill", "summary"]);
const ConditionNodeRef = z.union([
  z.uuid(),
  z.enum(["$actor", "$target", "$effect"]),
]);
const ConditionOperand = z.union([
  z.uuid(),
  z.templateLiteral([
    z.union([z.uuid(), z.enum(["$actor", "$target"])]),
    ".directPlaceId",
  ]),
]);
const ConditionEdge = z
  .strictObject({
    id: z.union([z.uuid(), z.literal("$effect")]).optional(),
    kind: ConditionRelationKind.optional(),
    source: ConditionNodeRef.optional(),
    target: ConditionNodeRef.optional(),
    role: WorldRole.nullable().optional(),
    text: z.string().optional(),
  })
  .refine(
    (edge) => edge.id || (edge.kind && (edge.source || edge.target)),
    "辺のIDか、種類と接続先の少なくとも一方を指定してください",
  );
export type ConditionExpression =
  | { all: ConditionExpression[] }
  | { any: ConditionExpression[] }
  | { eq: [string, string] }
  | z.infer<typeof ConditionEdge>;
export const ConditionExpression: z.ZodType<ConditionExpression> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(ConditionExpression).nonempty() }),
    z.strictObject({ any: z.array(ConditionExpression).nonempty() }),
    z.strictObject({ eq: z.tuple([ConditionOperand, ConditionOperand]) }),
    ConditionEdge,
  ]),
);
z.globalRegistry.add(ConditionExpression, { id: "WorldConditionExpression" });

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
      seriesId: z.uuid().optional().describe("管理者が指定する物品の系列ID"),
      summons: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("召喚石を使うと現れる生物の呼称"),
      unitsPerSlot: UnitsPerSlot.optional(),
      storageLimitSlots: z.number().int().positive().safe().optional(),
      viewers,
    })
    .strict(),
  z
    .object({
      ...Content,
      kind: z.literal("script"),
      name: z.string().trim().min(1).optional(),
      derivedFromSkills: z.array(z.uuid()).optional(),
      type: z.enum(["memo", "draw-source", "place-series"]).optional(),
      drawTable: DrawTable.optional(),
      spawn: SpawnRule.optional(),
      viewers,
    })
    .strict()
    .refine(
      (node) => !node.drawTable || node.type === "draw-source",
      "固定表は抽選器に指定してください",
    ),
  z
    .object({
      ...Content,
      kind: z.literal("event"),
      appearances: z.array(Appearance).optional(),
      instantActor: InstantRef.optional(),
      instantTarget: InstantRef.optional(),
      instantReduction: InstantReductionResult.optional(),
      period: Period,
    })
    .strict(),
  z.strictObject({
    ...Content,
    kind: z.literal("condition"),
    expression: ConditionExpression,
    stateId: z.uuid(),
  }),
]);
export type WorldNode = z.infer<typeof WorldNode>;
// hasの役割。useは家・場所の保管先の登録、skillは身につけた技能を表す。
// 役割なしのhasは、存在へ向くと物品を持つこと（持つ存在の物であること）、記述へ向くと記録やメモを持つことを表す。
export const BelongingRole = z.enum(["use", "skill"]);
export type BelongingRole = z.infer<typeof BelongingRole>;
export const CommandRestriction = z.enum(["say", "move", "vehicle-travel"]);
export type CommandRestriction = z.infer<typeof CommandRestriction>;
export const CommandRestrictions = z.array(CommandRestriction);
export const WorldEdge = z
  .object({
    id: z.uuid(),
    kind: RelationKind,
    source: z.uuid(),
    target: z.uuid(),
    role: WorldRole.optional().describe(
      "status/interpretはcontentかabout。hasの役割なしは、存在へ向くと物品を持つこと、記述へ向くと記録やメモを持つこと。useは家・場所の保管先の登録。use・skill・summaryと物品を持つhasは実行側だけが記録する",
    ),
    text: z
      .string()
      .optional()
      .describe(
        "関係の内容。seeでは受容本文。status/contentでtext=locationは主体の現在の所在専用のscriptを示し、status/aboutで場所を参照する",
      ),
    period: Period,
    observation: Observation.optional(),
    splitDescription: z
      .strictObject({
        originEdge: z.uuid().nullable(),
        source: z.uuid(),
      })
      .optional(),
    stateOrigin: z
      .strictObject({
        requestId: z.uuid(),
        actorId: z.uuid(),
        attachedItemId: z.uuid().optional(),
        affectsMovement: z.literal(true).optional(),
      })
      .optional(),
    commandRestrictions: CommandRestrictions.optional(),
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
    (edge) => !edge.splitDescription || (edge.kind === "has" && !edge.role),
    "取り分けた品の説明は所持の関係にだけ指定できます",
  )
  .refine(
    (edge) => edge.observation === undefined || edge.kind === "see",
    "観測の範囲はseeだけに指定してください",
  )
  .refine(
    (edge) =>
      edge.stateOrigin === undefined ||
      (edge.kind === "status" && edge.role === "content"),
    "状態の由来はstatus/contentだけに指定してください",
  )
  .refine(
    (edge) =>
      edge.commandRestrictions === undefined ||
      (edge.kind === "status" && edge.role === "content"),
    "コマンド制限はstatus/contentだけに指定してください",
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
