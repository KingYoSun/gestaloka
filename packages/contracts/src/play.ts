import { z } from "zod";
import { Change } from "./world.js";

const request = { requestId: z.uuid() },
  text = z.string().trim().min(1);
const id = z.uuid(),
  basis = text.describe(
    "この事実が成立した根拠。初期設定、または成立した出来事の内容",
  ),
  count = z.number().int().positive().safe();
export const ItemOutcome = z.object({
  itemId: id,
  label: z.string(),
  count: count.optional(),
  holding: z.object({ fromId: id.nullable(), toId: id }).optional(),
  ownership: z.object({ fromIds: z.array(id), toId: id }).optional(),
});
export type ItemOutcome = z.infer<typeof ItemOutcome>;
export const LocationOp = z
  .object({
    type: z.literal("locate"),
    subjectId: z.uuid(),
    text: z.string().trim().min(1),
    aboutIds: z.array(z.uuid()),
    directPlaceId: z
      .uuid()
      .optional()
      .describe("直接滞在する具体的な場所。複数の場所を参照するときに指定する"),
  })
  .strict();

// 同じ申請で同じ物品に同じ個数を指定した移動と譲渡は、同じ取り分に作用する。
const part = count
  .optional()
  .describe(
    "対象にする個数。省くと全部。一部なら、その個数を別の物品として分ける",
  );
export const BelongingOp = z.discriminatedUnion("type", [
  LocationOp,
  z
    .object({
      type: z.literal("create"),
      label: text,
      count: count.optional().describe("個数。数えないまとまりなら省く"),
      holder: id,
      owner: id.optional(),
      basis,
    })
    .strict()
    .describe("新しい物品を保持者のもとに成立させる"),
  z
    .object({
      type: z.literal("move"),
      item: id,
      from: id.nullable().describe("現在の保持者。所在が未記録ならnull"),
      to: id,
      count: part,
      basis,
    })
    .strict()
    .describe("物品の所在を移す。所有者は変えない"),
  z
    .object({
      type: z.literal("transfer"),
      item: id,
      to: id,
      count: part,
      basis,
    })
    .strict()
    .describe("物品の所有者を替える。所在は変えない"),
  z
    .object({ type: z.literal("grant"), person: id, storage: id, basis })
    .strict()
    .describe("保管先を利用できるようにする"),
  z
    .object({ type: z.literal("revoke"), person: id, storage: id })
    .strict()
    .describe("保管先の利用を終える"),
  z
    .object({ type: z.literal("learn"), person: id, text, basis })
    .strict()
    .describe("できることとその範囲を技能として記録する"),
  z
    .object({
      type: z.literal("update"),
      id,
      text: text.optional(),
      count: count
        .optional()
        .describe(
          "物品の新しい個数。増やす・新しく付けるときはダイスで判定する",
        ),
      basis: basis.optional(),
    })
    .strict()
    .refine(
      (op) => op.text !== undefined || op.count !== undefined,
      "textかcountを指定してください",
    )
    .describe(
      "物品の呼称・個数、または技能の内容と範囲を改める。技能の根拠が変わる場合はbasisを指定する",
    ),
  z
    .object({
      type: z.literal("remove"),
      id,
      count: count.optional().describe("減らす個数。省くと全部"),
    })
    .strict()
    .describe("消費・消失した物品、または失った技能の所有・所在・習得を終える"),
]);
export type BelongingOp = z.infer<typeof BelongingOp>;
export const PlaySearch = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("surroundings") }).strict(),
  z.object({ kind: z.literal("self") }).strict(),
  z.object({ kind: z.literal("memos") }).strict(),
  z
    .object({ kind: z.literal("history"), targetId: z.uuid().optional() })
    .strict(),
  z.object({ kind: z.literal("subject"), targetId: z.uuid() }).strict(),
]);
const dependencies = z.array(
  z
    .object({ key: z.string(), version: z.number().int().nonnegative().safe() })
    .strict(),
);
const Effect = z
  .object({
    targetId: id.describe("その場の存在、または同席している出現個体のID"),
    state: text.describe("後から対象を調べて観察できる状態"),
    replacesStateId: id
      .optional()
      .describe("同じ性質について置き換える既存状態のID"),
  })
  .strict();
export const NpcAction = z
  .object({ text, effect: Effect.optional(), departs: z.boolean().optional() })
  .strict();
export const PlayCommand = z.discriminatedUnion("command", [
  NpcAction.extend({ ...request, command: z.literal("npc-action"), npcId: id }),
  z.object({ ...request, command: z.literal("start") }).strict(),
  z
    .object({
      ...request,
      command: z.literal("search"),
      // 旧版のCLIが送るbelongingsは受け付けて、本人検索へ誘導する。
      query: z.union([
        PlaySearch,
        z
          .object({ kind: z.literal("belongings") })
          .strict()
          .describe("廃止。持ち物・保管先・技能はselfに含まれる"),
      ]),
    })
    .strict(),
  z
    .object({ ...request, command: z.literal("contact"), targetId: z.uuid() })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("say"),
      text,
      instantNpcs: z.array(text).default([]),
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("update"),
      text,
      operations: z.array(BelongingOp).min(1).optional(),
      changes: Change.optional(),
      waitMinutes: count
        .optional()
        .describe(
          "物品のcreateだけの申請にかける実時間（分）。ダイスの材料になり、成功すると物品はこの時間の後に成立する",
        ),
      dependencies,
    })
    .strict()
    .refine(
      (v) => !!v.operations !== !!v.changes,
      "operationsかchangesの一方を指定してください",
    ),
  z
    .object({
      ...request,
      command: z.literal("memo"),
      text,
      participants: z.array(z.uuid()).default([]),
      dependencies,
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("promote-npc"),
      sourceRequestId: z.uuid(),
      npcIndex: z.number().int().nonnegative(),
      description: text,
      ownerId: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("create"),
      text,
      changes: Change,
      dependencies,
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("explore"),
      text: text.describe("新しい場所の様子と、接続元からの行き方"),
      label: text.describe("新しい場所の呼び名"),
      fromId: z.uuid().describe("接続元の場所。本人の現在の所在地にある場所"),
      dependencies,
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("oppose"),
      text,
      operations: z.array(BelongingOp).min(1).optional(),
      changes: Change.optional(),
      effect: Effect.optional().describe(
        "同席している出現個体への作用。targetIdに個体のIDを指定する",
      ),
      dependencies,
    })
    .strict()
    .refine(
      (v) => [v.operations, v.changes, v.effect].filter(Boolean).length === 1,
      "operations・changes・effectのどれか一つを指定してください",
    ),
  z
    .object({
      ...request,
      command: z.literal("receive"),
      applicationId: z.uuid(),
      accept: z.boolean(),
    })
    .strict(),
  z.object({ ...request, command: z.literal("comment"), text }).strict(),
  z
    .object({ ...request, command: z.enum(["end-turn", "leave", "finish"]) })
    .strict(),
]);
export const PlayResponse = z.record(z.string(), z.unknown());
export const WaitingCommand = z.object({ active: z.boolean() }).strict();
const TurnTransition = z.object({
  type: z.enum([
    "turn-ended",
    "turn-skipped",
    "session-left",
    "session-joined",
  ]),
  actorId: z.uuid(),
  name: z.string(),
  turn: z.number().int(),
  at: z.iso.datetime(),
  reason: z.enum(["leave", "finish"]).optional(),
  cause: z.literal("contact").optional(),
  publicActivity: z.boolean().optional(),
  message: z.string(),
});
const TransitionRecord = z.object({
  id: z.string(),
  transition: TurnTransition,
});
export const ReceiptResult = z.object({
  applicationId: z.uuid(),
  outcome: z.enum(["accepted", "rejected", "expired", "cancelled"]),
  turn: z.number().int(),
  at: z.iso.datetime(),
  message: z.string(),
  rejectedBy: z.object({ actorId: z.uuid(), name: z.string() }).optional(),
});
export function playActionMessage(
  actionable: boolean,
  receiving: boolean,
  name?: string,
) {
  if (actionable) return receiving ? "受領判断が必要です" : "あなたの手番です";
  return `操作不要です${name ? `（${name}の手番中）` : ""}`;
}
export const WaitingStatus = z.object({
  state: z.enum(["inactive", "paused", "standby", "turn", "receiving"]),
  active: z.boolean(),
  connected: z.boolean(),
  viewerId: z.uuid(),
  actionable: z.boolean(),
  wakeKey: z.string().nullable(),
  noticeKey: z
    .string()
    .nullable()
    .optional()
    .describe("最新の未読の通知のID。未読がなければnull"),
  expiresAt: z.iso.datetime().optional(),
  sessionId: z.uuid().optional(),
  turn: z.number().int().optional(),
  applicationId: z.uuid().optional(),
  deadline: z.iso.datetime().optional(),
  code: z.string().optional(),
});
export const WaitingContextStatus = WaitingStatus.extend({
  context: z
    .object({
      actorId: z.uuid().nullable(),
      name: z.string().optional(),
      phase: z.enum(["turn", "receiving", "waiting-for-return", "parked"]),
      recent: z.array(TransitionRecord).max(3),
      receiptRequest: z
        .object({
          applicationId: z.uuid(),
          senderId: z.uuid(),
          senderName: z.string().optional(),
          deadline: z.iso.datetime(),
          memoTexts: z.array(z.string()).min(1),
        })
        .optional(),
      receiptResult: ReceiptResult.optional(),
    })
    .optional(),
});
export const WaitingEvent = WaitingContextStatus.extend({
  progress: z
    .object({
      cursor: z.string(),
      actorId: z.uuid().nullable(),
      name: z.string().optional(),
      message: z.string().optional(),
      waitingForReturn: z
        .object({
          actorId: z.uuid(),
          name: z.string(),
          deadline: z.iso.datetime(),
          remainingSeconds: z.number().int(),
          message: z.string(),
        })
        .optional(),
      updates: z.array(TransitionRecord),
      receiptResults: z
        .array(
          z.object({
            id: z.string(),
            receiptResult: ReceiptResult,
          }),
        )
        .optional(),
    })
    .optional(),
});

export const PlayerReportInput = z.object({ ...request, text }).strict();
export const PlayerReportStatus = z.object({
  date: z.string(),
  version: z.number().int(),
  dailyLimit: z.number().int(),
  turnsPerReport: z.number().int(),
  maxCharacters: z.number().int(),
  turns: z.number().int(),
  sent: z.number().int(),
  allowance: z.number().int(),
  available: z.number().int(),
});
export const PlayerReportReceipt = PlayerReportStatus.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
export const PlayerNotices = z.object({
  notices: z.array(
    z.object({
      id: z.uuid(),
      at: z.iso.datetime(),
      text: z.string(),
      unread: z.boolean(),
    }),
  ),
});
