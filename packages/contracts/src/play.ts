import { z } from "zod";
import { Change } from "./world.js";
import { DrawTableActions } from "./draw.js";

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
});
export const ExchangeTerms = z
  .object({
    storageId: id,
    itemId: id,
    count,
    paymentSeriesId: id,
    paymentLabel: text,
    paymentCount: count,
    text,
  })
  .strict();
export const ExchangeOffer = ExchangeTerms.extend({
  id,
  sellerId: id,
  itemLabel: text,
});
export const DeferredApplication = z.object({
  id,
  senderId: id,
  senderName: z.string(),
  text,
  deadline: z.iso.datetime(),
  awaitingYou: z.boolean(),
  preview: z.array(z.string()),
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
      holder: id.describe("物品を持つ存在。持つ存在の物になる"),
      basis,
    })
    .strict()
    .describe("新しい物品を持つ存在のもとに成立させる"),
  z
    .object({
      type: z.literal("move"),
      item: id,
      from: id.nullable().describe("今持っている存在。所在が未記録ならnull"),
      to: id,
      count: part,
      basis,
    })
    .strict()
    .describe("物品を渡す・置く・預ける。物品は受け取った存在の物になる"),
  z
    .object({ type: z.literal("grant"), person: id, storage: id, basis })
    .strict()
    .describe("家・場所を保管先として登録する"),
  z
    .object({ type: z.literal("revoke"), person: id, storage: id })
    .strict()
    .describe("保管先の登録を終える"),
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
    .describe("消費・消失した物品、または失った技能を除く"),
]);
export type BelongingOp = z.infer<typeof BelongingOp>;
export const PlaySearch = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("surroundings"),
      vehicleAfter: id.optional(),
      passengerAfter: id.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("seek") }).strict(),
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
const BlueprintMode = z.enum(["build", "open", "build-and-open", "craft"]);
export const InstallationPolicy = z
  .object({
    relocatable: z.boolean(),
    pickup: z.array(z.enum(["public", "addressed"])),
  })
  .strict();
export const BlueprintPublication = z
  .object({
    mode: BlueprintMode,
    name: text,
    version: z.number().int().positive(),
    authorId: id,
  })
  .strict();
const BlueprintMaterial = z
  .object({
    label: text,
    count,
    usage: z.enum(["consume", "tool"]),
  })
  .strict();
export const BlueprintDraft = BlueprintPublication.extend({
  installation: InstallationPolicy.optional().describe(
    "製作した物を保管先として設置し、許可する利用条件",
  ),
  instructions: text.describe("プレイヤーに示す使い方と、完成後にできること"),
  materials: z
    .array(BlueprintMaterial)
    .nonempty()
    .optional()
    .describe("建築・製作に必要な消費材と道具。開店のみの場合は省く"),
  testerIds: z
    .array(id)
    .optional()
    .describe("原案者と一緒に下書きを試せる人物"),
})
  .refine(
    (template) =>
      (template.mode === "open") === (template.materials === undefined),
    "建築・製作のテンプレートに材料を指定してください",
  )
  .refine(
    (template) => !template.installation || template.mode === "craft",
    "物品の設置は製作テンプレートで指定してください",
  );
export const BlueprintProposal = z
  .object({
    templateId: id,
    placeId: id,
    keeperId: id,
    description: text,
    product: z.object({ label: text }).strict().optional(),
    building: z
      .object({
        label: text,
        materials: z.array(BlueprintMaterial).nonempty().optional(),
      })
      .strict()
      .optional(),
    shop: z
      .object({
        stock: z
          .array(
            ExchangeTerms.omit({ storageId: true }).extend({
              stockCount: count,
            }),
          )
          .nonempty(),
      })
      .strict()
      .optional(),
  })
  .strict();
const BlueprintActions = [
  z
    .object({
      ...request,
      command: z.literal("blueprint-templates"),
      after: id.optional(),
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("blueprint-propose"),
      plan: BlueprintProposal,
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("blueprint-list"),
      after: id.optional(),
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("blueprint-show"),
      questId: id,
      provision: z
        .object({ requirement: z.number().int().nonnegative(), itemId: id })
        .strict()
        .optional()
        .describe("呼称で指定された建材・道具について、提供可能数を照会する"),
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("blueprint-consent"),
      questId: id,
    })
    .strict(),
  z
    .object({ ...request, command: z.literal("blueprint-start"), questId: id })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("blueprint-provide"),
      questId: id,
      phase: z.enum(["build", "open", "craft"]),
      requirement: z.number().int().nonnegative(),
      itemId: id,
      count,
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("blueprint-withdraw"),
      questId: id,
      contributionId: id,
    })
    .strict(),
  z
    .object({ ...request, command: z.literal("blueprint-cancel"), questId: id })
    .strict(),
] as const;
export type BlueprintAction = z.infer<(typeof BlueprintActions)[number]>;
const storage = { ...request, storageId: id };
const StorageActions = [
  z
    .object({
      ...request,
      command: z.literal("storage-list"),
      after: id.optional(),
    })
    .strict(),
  z
    .object({
      ...storage,
      command: z.literal("storage-post"),
      itemId: id,
      allocations: z
        .array(z.object({ count, recipientId: id.optional() }).strict())
        .nonempty(),
    })
    .strict(),
  z
    .object({
      ...storage,
      command: z.literal("storage-offers"),
      after: id.optional(),
    })
    .strict(),
  z
    .object({
      ...storage,
      command: z.literal("storage-claim"),
      allocationId: id,
      count,
    })
    .strict(),
  z
    .object({
      ...storage,
      command: z.literal("storage-withdraw"),
      allocationId: id,
    })
    .strict(),
  z
    .object({
      ...storage,
      command: z.literal("storage-history"),
      after: id.optional(),
    })
    .strict(),
  z
    .object({ ...storage, command: z.literal("storage-relocate"), placeId: id })
    .strict(),
] as const;
export type StorageAction = z.infer<(typeof StorageActions)[number]>;
export const PlayCommand = z.discriminatedUnion("command", [
  ...DrawTableActions,
  ...StorageActions,
  ...BlueprintActions,
  z
    .object({
      ...request,
      command: z.literal("vehicle-request-control"),
      vehicleId: id,
      oppose: z.boolean().optional(),
      applicationId: id.optional(),
    })
    .strict(),
  z
    .object({ ...request, command: z.literal("vehicle-board"), vehicleId: id })
    .strict(),
  z
    .object({ ...request, command: z.literal("vehicle-leave"), vehicleId: id })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("vehicle-travel"),
      vehicleId: id,
      destinationId: id,
    })
    .strict(),
  NpcAction.extend({ ...request, command: z.literal("npc-action"), npcId: id }),
  z.object({ ...request, command: z.literal("start") }).strict(),
  z
    .object({
      ...request,
      command: z.literal("draw-configure"),
      targetId: id,
      description: text.describe("この抽選器から繰り返し得られる結果の範囲"),
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("draw"),
      targetId: id,
      versionId: id.optional(),
      paymentItemId: id.optional(),
      text: text.optional().describe("同席者に伝える行動の描写"),
    })
    .strict(),
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
    .object({ ...request, command: z.literal("team-invite"), targetId: id })
    .strict(),
  z
    .object({ ...request, command: z.literal("team-join"), teamId: id })
    .strict(),
  z
    .object({ ...request, command: z.enum(["team-status", "team-leave"]) })
    .strict(),
  z
    .object({
      ...request,
      command: z.literal("companion-request"),
      targetId: id,
      text,
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.enum([
        "companion-follow",
        "companion-wait",
        "companion-return",
        "companion-dismiss",
      ]),
      targetId: id,
    })
    .strict(),
  z
    .object({
      ...request,
      command: z.enum(["companion-move", "companion-home"]),
      targetId: id,
      placeId: id,
    })
    .strict(),
  z.object({ ...request, command: z.literal("companion-status") }).strict(),
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
      stealth: z.boolean().optional(),
      operations: z.array(BelongingOp).min(1).optional(),
      changes: Change.optional(),
      deferredUntil: z.iso.datetime().optional(),
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
      deferredUntil: z.iso.datetime().optional(),
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
      command: z.literal("create-batch"),
      proposals: z
        .array(
          z.union([
            z.object({ text, changes: Change }).strict(),
            z
              .object({ text, operations: z.array(BelongingOp).min(1) })
              .strict(),
          ]),
        )
        .min(1)
        .max(5),
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
      stealth: z.boolean().optional(),
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
  z.object({ ...request, command: z.literal("applications") }).strict(),
  z
    .object({ ...request, command: z.literal("withdraw"), applicationId: id })
    .strict(),
  ExchangeTerms.extend({ ...request, command: z.literal("offer") }),
  z
    .object({
      ...request,
      command: z.literal("exchange"),
      offerId: id,
      paymentItemId: id,
    })
    .strict(),
  z
    .object({ ...request, command: z.enum(["end-turn", "leave", "finish"]) })
    .strict(),
]);
export const ViewersInput = z
  .object({
    ...request,
    targetId: id.describe("本人の物・保管先・技能・状態のID"),
    viewers: z
      .union([z.literal("all"), z.array(id)])
      .describe(
        "本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ",
      ),
  })
  .strict();
export const ViewersResult = ViewersInput.omit({ requestId: true });
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
  code: z.string().optional(),
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
const ReceiptRequest = z.object({
  applicationId: z.uuid(),
  senderId: z.uuid(),
  senderName: z.string().optional(),
  deadline: z.iso.datetime(),
});
export const WaitingContextStatus = WaitingStatus.extend({
  context: z
    .object({
      actorId: z.uuid().nullable(),
      name: z.string().optional(),
      phase: z.enum(["turn", "receiving", "waiting-for-return", "parked"]),
      recent: z.array(TransitionRecord).max(3),
      observations: z.array(z.string()).optional(),
      stealth: z.object({ placeId: z.uuid(), place: z.string() }).optional(),
      receiving: ReceiptRequest.extend({
        text: z.string(),
        changes: Change,
      }).optional(),
      receiptRequest: ReceiptRequest.extend({
        memoTexts: z.array(z.string()).min(1),
      }).optional(),
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
