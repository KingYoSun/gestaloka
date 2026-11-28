import { z } from "zod";
import { Change, PlaceSeries, RelationKind, StartingItem } from "./world.js";
import { BlueprintDraft, BlueprintPublication } from "./play.js";
import { StoryDates, StoryListQuery, StoryReadQuery } from "./stories.js";
export * from "./stories.js";

export const WorldDice = z
  .strictObject({
    count: z.number().int().positive().describe("振るダイスの個数"),
    sides: z.number().int().min(2).describe("ダイス1個の面数"),
  })
  .refine(
    ({ count, sides }) => count * sides <= 2147483647,
    "出目の合計が保存できる整数の範囲を超えています",
  );
export type WorldDice = z.infer<typeof WorldDice>;
export const defaultDice: WorldDice = { count: 3, sides: 6 };

export {
  DrawReward,
  DrawTable,
  DrawTableResult,
  drawTableLimit,
  type DrawTableAction,
} from "./draw.js";
export {
  DeferredApplication,
  ExchangeOffer,
  StockExchangeOffer,
  ExchangeTerms,
  BlueprintDraft,
  BlueprintPublication,
  BlueprintProposal,
  type BlueprintAction,
  InstallationPolicy,
  type StorageAction,
  PlayCommand,
  PlayerPlayCommand,
  PlayQuote,
  playQuote,
  ApplyCommand,
  WorldApplication,
  applicationSp,
  NpcAction,
  ItemOutcome,
  PlaySearch,
  PlayResponse,
  SkillRequestResult,
  SpectatingView,
  BelongingOp,
  LocationOp,
  PlayerReportInput,
  PlayerReportStatus,
  PlayerReportReceipt,
  PlayerNotices,
  FriendCommand,
  FriendResult,
  ViewersInput,
  ViewersResult,
  WaitingCommand,
  WaitingContextStatus,
  ReceiptResult,
  playActionMessage,
  WaitingEvent,
  WaitingStatus,
} from "./play.js";
export {
  PlaceSeries,
  Change,
  Appearance,
  InstantProfile,
  InstantReduction,
  InstantReductionResult,
  WorldNode,
  WorldEdge,
  RelationKind,
  BelongingRole,
  CommandRestriction,
  CommandRestrictions,
  ConditionExpression,
  StartingItem,
} from "./world.js";

export const Health = z.object({
  service: z.literal("gestaloka"),
  status: z.literal("ok"),
});
export const HealthEvent = z.object({
  type: z.literal("health"),
  data: Health,
});

export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  callsUsed: z.number().int().optional(),
});
export const BlockingState = z.object({
  stateId: z.uuid(),
  shortId: z.string(),
  text: z.string(),
  until: z.number().optional(),
});
export type BlockingState = z.infer<typeof BlockingState>;
export function describeBlockingStates(states: readonly BlockingState[] = []) {
  return states
    .map(({ shortId, text }) => `原因の状態 ${shortId}「${text}」。`)
    .join("");
}
export const PlayError = ApiError.extend({
  blockingStates: z.array(BlockingState).optional(),
  capacity: z
    .object({
      holderId: z.uuid(),
      usedSlots: z.number(),
      limitSlots: z.number(),
      projectedSlots: z.number(),
    })
    .optional(),
  item: z
    .object({
      itemId: z.uuid(),
      requestedCount: z.number(),
      maxAcceptableCount: z.number(),
    })
    .optional(),
});
export const PlayerCliRelease = z.object({
  version: z.string(),
  node: z.string(),
  downloadUrl: z.string().startsWith("/"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive(),
  setupUrl: z.string().startsWith("/"),
});
export const BrowserSession = z.object({ id: z.uuid() });
export const ResourceId = z.object({ id: z.uuid() });
export const WorldList = z.array(ResourceId);
export const BudgetUsd = z
  .number()
  .min(0.000000001)
  .finite()
  .max(Number.MAX_SAFE_INTEGER / 1_000_000_000);
export const CreateWorld = z
  .object({
    requestId: z.uuid(),
    prompt: z.string().min(1),
    playerSettings: z.string().optional(),
    budgetUsd: BudgetUsd,
  })
  .strict();
export const WORLD_DAY_MS = 86_400_000;
export const ConstructionDuration = z
  .number()
  .int()
  .safe()
  .min(WORLD_DAY_MS)
  .multipleOf(WORLD_DAY_MS)
  .describe("管理者が追加する期間。ミリ秒表記で、1日以上かつ1日の整数倍");
export const WorldCommand = z.discriminatedUnion("command", [
  z
    .object({
      requestId: z.uuid(),
      command: z.literal("advance"),
      duration: ConstructionDuration,
    })
    .strict(),
  z
    .object({
      requestId: z.uuid(),
      command: z.enum(["resume", "finish"]),
    })
    .strict(),
]);
const InventoryLimits = z.object({
  carrySlots: z.number().int().positive().safe().describe("人物の手持ち枠"),
  storageSlots: z.number().int().positive().safe().describe("保管庫の標準枠"),
  bundleSlots: z
    .number()
    .int()
    .positive()
    .safe()
    .optional()
    .describe("バンドルに収められる通常枠の合計。既定は15"),
  unitsPerSlot: z
    .number()
    .int()
    .positive()
    .safe()
    .describe("物品の1枠あたりの標準個数"),
  skillSlots: z
    .number()
    .int()
    .positive()
    .safe()
    .describe(
      "人物の技能枠。既定は50。手持ち枠の有効・無効にかかわらず適用する",
    ),
});
export const CombatMode = z.enum(["pve", "pvp"]);
export type CombatMode = z.infer<typeof CombatMode>;
export const NonCombatAreas = z.array(
  z.strictObject({
    rootId: z.uuid(),
    memberPlaceIds: z.array(z.uuid()),
  }),
);
export type NonCombatAreas = z.infer<typeof NonCombatAreas>;
export const WorldStatus = z.object({
  inventoryLimits: InventoryLimits.optional(),
  inventoryCapacity: z.boolean().optional(),
  id: z.uuid(),
  prompt: z.string(),
  playerSettings: z.string().optional(),
  startingItems: z.array(StartingItem).optional(),
  createdAt: z.iso.datetime(),
  state: z.enum([
    "generating",
    "ready",
    "running",
    "paused",
    "finished",
    "joining",
    "playing",
    "play_paused",
  ]),
  at: z.number().int().nonnegative().safe(),
  target: z.number().int().nonnegative().safe(),
  hasParticipant: z.boolean(),
  publication: z.object({
    title: z.string(),
    description: z.string(),
    published: z.boolean(),
    accepting: z.boolean(),
    freePlayerLimit: z.int32().nonnegative().default(1),
    playerList: z.boolean(),
    instantNpcMultiplier: z.number().int().positive(),
    deathJudgment: z.boolean(),
    combatMode: CombatMode,
    respawnEnabled: z.boolean(),
    deathCriteria: z.string(),
    deathPlaceId: z.uuid().nullable(),
    nonCombatAreas: NonCombatAreas,
    nonCombatPlaceSeries: z.array(PlaceSeries).default([]),
  }),
  error: z.string().nullable(),
});
export const PageQuery = z
  .object({ before: z.string().optional(), after: z.string().optional() })
  .refine((value) => !value.before || !value.after);
export const AdminRecord = z.object({
  id: z.string(),
  at: z.number().int().nonnegative().safe(),
  summary: z.string(),
  continuation: z.string().nullable(),
  counts: z.object({ nodes: z.number().int(), edges: z.number().int() }),
});
export const AdminPage = z.object({
  items: z.array(AdminRecord),
  next: z.string().nullable(),
  previous: z.string().nullable(),
});
export const PlayerCharacter = z.object({
  actorId: z.uuid(),
  name: z.string(),
  icon: z.string().nullable(),
  count: z.number().int().positive().safe().optional(),
});
export const PLAYER_ICON_MAX_BYTES = 5 * 1024 * 1024;
export const PlayerIconInput = z
  .object({
    image: z
      .string()
      .max(4 * Math.ceil(PLAYER_ICON_MAX_BYTES / 3))
      .nullable(),
  })
  .strict();
export const PlayerIcon = PlayerIconInput.extend({
  image: z.string().nullable(),
});
export const KnowledgeRecord = z.object({
  id: z.uuid(),
  kind: z.enum(["observation", "interpretation"]),
  text: z.string(),
  characters: z.array(PlayerCharacter).optional(),
  from: z.number().int().nonnegative().safe(),
  until: z.number().int().nonnegative().safe().optional(),
});
export const KnowledgePage = z.object({
  viewerId: z.uuid(),
  at: z.number().int().nonnegative().safe(),
  items: z.array(KnowledgeRecord),
  next: z.string().nullable(),
  previous: z.string().nullable(),
});
const HeldItem = z.object({
  label: z.string(),
  quantity: z.number().int().positive().safe(),
  mine: z.boolean(),
});
// 本人の携行品、利用できる保管先の最新の在庫、技能。同じ呼称の物品は数量にまとめる。
export const Belongings = z.object({
  viewerId: z.uuid(),
  items: z.array(HeldItem),
  storages: z.array(
    z.object({ id: z.uuid(), label: z.string(), items: z.array(HeldItem) }),
  ),
  skills: z.array(
    z.object({ id: z.uuid(), text: z.string(), name: z.string().optional() }),
  ),
});
// いまシーンで出会える相手。プレイヤーは待機接続があるかNPCモードの人物、NPCはプレイヤーが操作していない人物。
export const SessionPartners = z.object({
  items: z.array(
    z.object({
      actorId: z.uuid(),
      name: z.string(),
      placeId: z.uuid().nullable(),
      place: z.string().nullable(),
    }),
  ),
  next: z.uuid().nullable(),
});
export const EventQuery = z.object({
  actorId: z.uuid().optional(),
  role: z.enum(["admin", "player"]),
  after: z.string().regex(/^\d+$/).optional(),
});
export const ActorQuery = z.object({ actorId: z.uuid().optional() });
export const InventoryContentsQuery = ActorQuery.extend({
  containerId: z.uuid(),
  after: z.uuid().optional(),
});
export const InventoryContents = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      count: z.number().optional(),
      unitsPerSlot: z.union([z.number(), z.literal("unlimited")]).optional(),
      slots: z.number(),
      totalSlots: z.number(),
      states: z.array(z.string()).optional(),
    }),
  ),
  next: z.uuid().nullable(),
});
const BundleRequest = {
  requestId: z.uuid(),
  storageId: z.uuid(),
};
const bundleId = z.uuid();
const bundleItems = z.array(z.uuid());
export const InventoryBundleCommand = z.discriminatedUnion("action", [
  z
    .object({
      ...BundleRequest,
      action: z.literal("create"),
      label: z.string().trim().min(1),
      itemIds: bundleItems.min(2),
    })
    .strict(),
  z
    .object({
      ...BundleRequest,
      action: z.literal("add"),
      bundleId,
      itemIds: bundleItems.min(1),
    })
    .strict(),
  z
    .object({
      ...BundleRequest,
      action: z.literal("release"),
      bundleId,
      itemId: z.uuid(),
    })
    .strict(),
  z
    .object({ ...BundleRequest, action: z.literal("dissolve"), bundleId })
    .strict(),
]);
export const InventoryBundleResult = z.object({
  bundleId,
  itemCount: z.number(),
  normalSlots: z.number(),
});
export const WorldEvent = z.object({
  id: z.string().regex(/^\d+$/),
  worldId: z.uuid(),
  type: z.literal("invalidate"),
});
export const DeliveryCursor = z.object({ cursor: z.string().regex(/^\d+$/) });
export const PlayerAction = z
  .object({ requestId: z.uuid(), actionText: z.string().min(1) })
  .strict();
export const RequestIdentity = z.object({ requestId: z.uuid() }).strict();
export const PlayerStatus = z.object({
  id: z.uuid(),
  viewerId: z.uuid(),
  runId: z.uuid().nullable(),
  at: z.number().int().nonnegative().safe(),
  state: z.enum(["ready", "running", "paused"]),
  error: z.string().nullable(),
});
export const PlayRun = z.object({
  id: z.uuid(),
  viewerId: z.uuid(),
  worldId: z.uuid(),
  actionText: z.string(),
  startedAt: z.number().int().nonnegative().safe(),
  at: z.number().int().nonnegative().safe(),
  state: z.enum(["ready", "running", "paused"]),
  error: z.string().nullable(),
});

export const SceneCommand = z.discriminatedUnion("command", [
  z
    .object({
      requestId: z.uuid(),
      command: z.literal("prepare"),
      purpose: z.string().min(1),
      shared: z.literal(true).optional(),
    })
    .strict(),
  z
    .object({
      requestId: z.uuid(),
      command: z.literal("invite"),
      invitationId: z.uuid(),
      accept: z.boolean(),
    })
    .strict(),
  z
    .object({
      requestId: z.uuid(),
      command: z.literal("act"),
      actionText: z.string().min(1),
    })
    .strict(),
  z
    .object({
      requestId: z.uuid(),
      command: z.literal("react"),
      opportunityId: z.uuid(),
      actionText: z.string().min(1).nullable(),
    })
    .strict(),
  z
    .object({
      requestId: z.uuid(),
      command: z.literal("vote"),
      proposalId: z.uuid(),
      continue: z.boolean(),
    })
    .strict(),
  z
    .object({
      requestId: z.uuid(),
      command: z.enum(["start", "finish", "resume", "leave"]),
    })
    .strict(),
]);
export const SceneStatus = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  viewerId: z.uuid(),
  at: z.number().int().nonnegative().safe(),
  state: z.enum([
    "preparing",
    "ready",
    "active",
    "acting",
    "reflecting",
    "result",
    "paused",
  ]),
  synopsis: z.string().nullable(),
  synopsisCharacters: z.array(PlayerCharacter).optional(),
  result: z.string().nullable(),
  resultCharacters: z.array(PlayerCharacter).optional(),
  error: z.string().nullable(),
  messages: z.array(
    z.object({
      id: z.uuid(),
      text: z.string(),
      characters: z.array(PlayerCharacter).optional(),
    }),
  ),
  actions: z.array(
    z.object({
      id: z.uuid(),
      text: z.string(),
      state: z.enum(["running", "complete", "boundary"]),
      characters: z.array(PlayerCharacter).optional(),
    }),
  ),
  recordIds: z.array(z.uuid()),
  nextPurpose: z.string().nullable(),
  waiting: z
    .array(
      z.object({
        kind: z.enum(["participants", "npc", "system"]),
        actors: z.array(z.object({ id: z.uuid(), name: z.string() })),
        reason: z.string(),
        deadline: z.iso.datetime().nullable(),
      }),
    )
    .optional(),
  departed: z.boolean().optional(),
  waitingFor: z.array(z.uuid()).optional(),
  waitingInvitation: z.boolean().optional(),
  soloProposal: z.uuid().optional(),
  shared: z
    .object({
      owner: z.boolean(),
      requestIds: z.array(z.uuid()),
      phase: z.enum(["selecting", "inviting", "settled"]),
      pending: z.number().int().nonnegative(),
      deadline: z.iso.datetime().nullable(),
      rounds: z.number().int().nonnegative().optional(),
      flow: z
        .enum(["open", "manual", "voting", "rounds", "inactive", "closing"])
        .optional(),
    })
    .optional(),
});
export const NpcModeCommand = z.discriminatedUnion("command", [
  z
    .object({ requestId: z.uuid(), command: z.enum(["away", "return"]) })
    .strict(),
  z
    .object({
      requestId: z.uuid(),
      command: z.enum(["join", "decline"]),
      sceneId: z.uuid(),
    })
    .strict(),
]);
export const NpcReport = z.object({
  active: z.boolean(),
  summary: z.string(),
  scenes: z.array(
    z.object({
      sceneId: z.uuid(),
      handoff: z.enum(["available", "processing"]).nullable(),
      log: z.array(
        z.object({ kind: z.enum(["observation", "intent"]), text: z.string() }),
      ),
    }),
  ),
});
export const ScenePresence = z
  .object({ requestId: z.uuid(), connectionId: z.uuid(), active: z.boolean() })
  .strict();
export const ScenePresenceStatus = z.object({
  connectionId: z.uuid(),
  active: z.boolean(),
  kind: z.enum(["human", "bot"]),
  expiresAt: z.iso.datetime(),
});
export const SceneInboxQuery = z.object({
  actorId: z.uuid().optional(),
  after: z.string().optional(),
});
export const SceneInbox = z.object({
  viewerId: z.uuid(),
  opportunities: z
    .array(
      z.object({
        id: z.uuid(),
        sceneId: z.uuid(),
        sourceInputId: z.uuid(),
        nextInput: z.literal(true).optional(),
        deadline: z.iso.datetime(),
        seenEventIds: z.array(z.uuid()),
        context: z.array(z.string()),
      }),
    )
    .default([]),
  proposals: z
    .array(
      z.object({ id: z.uuid(), sceneId: z.uuid(), deadline: z.iso.datetime() }),
    )
    .default([]),
  invitations: z.array(
    z.object({
      id: z.uuid(),
      sceneId: z.uuid(),
      deadline: z.iso.datetime(),
      context: z.array(z.string()),
    }),
  ),
  items: z.array(
    z.object({
      id: z.string(),
      sceneId: z.uuid().nullable(),
      kind: z.enum([
        "invitation",
        "invitation_closed",
        "participation_settled",
        "scene_ready",
        "scene_started",
        "participant_left",
        "result",
        "presence_inactive",
        "opportunity",
        "end_proposal",
        "paused",
      ]),
      invitationId: z.uuid().optional(),
      contact: z.boolean().optional(),
      contactOutcome: z
        .enum(["delivered", "unreachable", "unanswered"])
        .optional(),
      opportunityId: z.uuid().optional(),
      sourceInputId: z.uuid().optional(),
      proposalId: z.uuid().optional(),
      requestId: z.uuid().optional(),
      answer: z.enum(["accepted", "declined", "expired"]).optional(),
      deadline: z.iso.datetime().optional(),
      context: z.array(z.string()).optional(),
    }),
  ),
  next: z.string().nullable(),
});
export const SceneResponse = z.object({ scene: SceneStatus.nullable() });
export const SceneViewQuery = z.object({
  actorId: z.uuid().optional(),
  sceneId: z.uuid().optional(),
  view: z.literal("compact").optional(),
});
export const SceneRecordQuery = PageQuery.safeExtend({
  actorId: z.uuid().optional(),
  sceneId: z.uuid(),
  kind: z.enum(["events", "actions"]),
});
export const SceneRecordPage = z.object({
  viewerId: z.uuid(),
  items: z.array(
    z.object({
      id: z.uuid(),
      at: z.number().nonnegative().safe().nullable(),
      text: z.string(),
      kind: z.enum(["message", "action"]),
      continuation: z.string().nullable(),
      characters: z.array(PlayerCharacter).optional(),
    }),
  ),
  next: z.string().nullable(),
  previous: z.string().nullable(),
});
export const KnowledgeQuery = PageQuery.safeExtend({
  actorId: z.uuid().optional(),
});

export const Member = z.object({
  id: z.uuid(),
  role: z.enum(["admin", "user"]),
  banned: z.boolean(),
  createdAt: z.iso.datetime(),
});
export const SpectatingSetting = z.strictObject({
  public: z.boolean(),
  publicDiceBasis: z.boolean(),
});
export const SpectatingUpdate = SpectatingSetting.partial().refine(
  (value) => Object.keys(value).length > 0,
);
const operationPage = { before: z.uuid().optional() };
const operationReason = z.string().trim().min(1);
export const CatalogPageQuery = z.object({ before: z.uuid().optional() });
export const WorldCatalogPage = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      description: z.string(),
      playerSettings: z.string().optional(),
      combatMode: CombatMode,
      accepting: z.boolean(),
      canJoin: z.boolean(),
      joinBlock: z
        .enum(["WORLD_INVITATION_REQUIRED", "PLAYER_LIMIT_REACHED"])
        .optional(),
    }),
  ),
  next: z.uuid().nullable(),
});
export const PlayerPreset = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1),
  description: z.string(),
  version: z.number().int().positive().safe(),
});
export const PlayerPresetPage = z.object({
  items: z.array(PlayerPreset),
  next: z.uuid().nullable(),
});
export const WorldPlayerPage = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      actorId: z.uuid().nullable(),
      state: z.enum(["joining", "ready", "paused"]),
      name: z.string().nullable().optional(),
      icon: z.string().nullable().optional(),
      at: z.number().int().nonnegative().safe(),
    }),
  ),
  next: z.uuid().nullable(),
});
export const LegacyClaimPage = z.object({
  subjectId: z.uuid(),
  version: z.string().regex(/^[a-f0-9]{32}$/),
  linked: z.boolean(),
  total: z.number().int().nonnegative().safe(),
  items: z.array(
    z.object({
      id: z.uuid(),
      prompt: z.string(),
      actorId: z.uuid().nullable(),
    }),
  ),
  next: z.uuid().nullable(),
});
const DisableRespawn = z
  .boolean()
  .optional()
  .describe("この人物をリスポーンなしで作成する。省略すると世界の設定に従う");
export const JoinWorld = z
  .object({
    operation: z.literal("worlds.join"),
    worldId: z.uuid(),
    name: z.string().trim().min(1).optional(),
    presetId: z.uuid().optional(),
    presetVersion: z.number().int().positive().safe().optional(),
    character: z.string().min(1).optional(),
    disableRespawn: DisableRespawn,
  })
  .strict()
  .refine((v) =>
    v.character !== undefined
      ? v.presetId === undefined && v.presetVersion === undefined
      : v.name === undefined &&
        v.presetId !== undefined &&
        v.presetVersion !== undefined,
  );
export const PlayerDeviceRequest = z
  .object({
    requestId: z.uuid(),
    worldId: z.uuid(),
    secret: z.string().regex(/^[a-f0-9]{64}$/),
    character: z.string().min(1).optional(),
    icon: PlayerIconInput.shape.image.optional(),
  })
  .strict();
export const PlayerDeviceCode = z.object({
  id: z.uuid(),
  userCode: z.string(),
  verificationPath: z.string(),
});
export const PlayerDeviceApproval = z.union([
  z
    .object({ character: z.literal(true), disableRespawn: DisableRespawn })
    .strict(),
  z.object({ actorId: z.uuid() }).strict(),
  z
    .object({
      presetId: z.uuid(),
      presetVersion: z.number().int().positive().safe(),
      disableRespawn: DisableRespawn,
    })
    .strict(),
]);
export const PlayerDeviceStatus = z.object({
  legalConsentRequired: z.literal(true).optional(),
  id: z.uuid(),
  worldId: z.uuid(),
  combatMode: CombatMode.optional(),
  actorId: z.uuid().nullable(),
  joinId: z.uuid().nullable(),
  presetId: z.uuid().nullable(),
  presetVersion: z.number().int().positive().nullable(),
  character: z.string().optional(),
  welcome: z
    .object({
      worldName: z.string(),
      playerName: z.string(),
      dailySpLimit: z.number().int().positive(),
      webUrl: z.url().optional(),
    })
    .optional(),
  state: z.enum([
    "authorization_pending",
    "authorized",
    "joining",
    "paused",
    "ready",
  ]),
});
const quotaCount = z.number().int().positive().safe();
export const ModelLimit = z
  .object({
    concurrency: quotaCount.optional(),
    requestsPerMinute: quotaCount.optional(),
    tokensPerMinute: quotaCount.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const ModelLimitName = z
  .string()
  .regex(/^(deepseek|gemini|openai|anthropic|openrouter):.+$/);
export const ModelProvider = z.enum([
  "deepseek",
  "gemini",
  "openai",
  "anthropic",
  "openrouter",
]);
export const ModelSetting = z
  .object({
    provider: ModelProvider,
    model: z.string().trim().min(1),
    baseUrl: z.url(),
    api: z.enum(["chat-completions", "responses", "messages"]),
    effort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
    initialEffort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
    contextTokens: quotaCount,
    maxOutputTokens: quotaCount,
    inputUsdPerMillion: z.number().positive().finite(),
    cachedInputUsdPerMillion: z.number().nonnegative().finite(),
    cacheWrite5mUsdPerMillion: z.number().nonnegative().finite().optional(),
    cacheWrite1hUsdPerMillion: z.number().nonnegative().finite().optional(),
    cacheWrite30mUsdPerMillion: z.number().nonnegative().finite().optional(),
    cacheWrite12hUsdPerMillion: z.number().nonnegative().finite().optional(),
    cacheStorageUsdPerMillionTokenHour: z
      .number()
      .nonnegative()
      .finite()
      .optional(),
    outputUsdPerMillion: z.number().positive().finite(),
    pricingDate: z.iso.date(),
  })
  .strict();
export const ModelConfiguration = z
  .object({
    default: ModelSetting,
    resolution: ModelSetting,
    judgment: z.enum(["separate", "combined"]),
  })
  .strict();
export const CostQuery = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    provider: ModelProvider.nullable().optional(),
    model: z.string().min(1).optional(),
    worldId: z.uuid().nullable().optional(),
    userId: z.uuid().nullable().optional(),
    task: z.string().min(1).nullable().optional(),
    responseId: z.uuid().optional(),
    operationId: z.uuid().optional(),
    callId: z.uuid().optional(),
    view: z.enum(["summary", "calls", "timeline", "groups"]),
    interval: z.enum(["hour", "day", "month"]).default("day"),
    by: z.enum(["user", "task", "model"]).optional(),
    order: z.enum(["calls", "cost"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    after: z.string().optional(),
  })
  .strict()
  .refine((v) => Date.parse(v.from) < Date.parse(v.to), {
    message: "期間の終了は開始より後にしてください",
  })
  .refine((v) => (v.view === "groups") === (v.by !== undefined), {
    message: "集計の単位はview: groupsでだけ指定してください",
  });
const nanoAmount = z.string().regex(/^\d+$/);
export const CostTotals = z.object({
  calls: z.number().int().nonnegative(),
  calculatedNanoUsd: nanoAmount,
  reservedNanoUsd: nanoAmount,
  unknownNanoUsd: nanoAmount,
  reservedCalls: z.number().int().nonnegative(),
  unknownCalls: z.number().int().nonnegative(),
});
const tokens = z.number().nonnegative().nullable();
const CostGroup = CostTotals.extend({
  usageMissingCalls: z.number().int().nonnegative(),
  inputTokens: tokens,
  cachedInputTokens: tokens,
  cacheWriteTokens: tokens,
  outputTokens: tokens,
  cacheHitRate: z.number().min(0).max(1).nullable(),
  callShare: z.number().min(0).max(1).nullable(),
  costShare: z.number().min(0).max(1).nullable(),
});
export const CostCall = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  worldId: z.uuid().nullable(),
  graphWorldId: z.uuid().nullable(),
  userId: z.uuid().nullable(),
  responseId: z.uuid().nullable(),
  operationId: z.uuid().nullable(),
  provider: ModelProvider.nullable(),
  requestedModel: z.string().nullable(),
  responseModel: z.string().nullable(),
  task: z.string().nullable(),
  configurationVersion: z.number().int().nullable(),
  pricingDate: z.string().nullable(),
  status: z.enum(["calculated", "reserved", "unknown"]),
  calculatedNanoUsd: nanoAmount.nullable(),
  reservationNanoUsd: nanoAmount,
  elapsedMs: z.number().int().nullable(),
  cacheStorage: z
    .object({
      tokenSeconds: z.number().nonnegative(),
      nanoUsdPerTokenSecond: z.number().nonnegative(),
    })
    .nullable()
    .optional(),
  usage: z
    .object({
      input: z.number(),
      cachedInput: z.number(),
      cacheMissInput: z.number(),
      output: z.number(),
      cacheWrite5m: z.number().nullable(),
      cacheWrite1h: z.number().nullable(),
      cacheWrite30m: z.number().nullable().optional(),
      cacheWrite12h: z.number().nullable().optional(),
      reasoning: z.number().nullable(),
    })
    .nullable(),
  ratesNanoUsdPerToken: z
    .object({
      input: z.number(),
      cachedInput: z.number(),
      output: z.number(),
      cacheWrite5m: z.number().nullable(),
      cacheWrite1h: z.number().nullable(),
      cacheWrite30m: z.number().nullable().optional(),
      cacheWrite12h: z.number().nullable().optional(),
    })
    .nullable(),
});
export const CostReport = z.object({
  currency: z.literal("USD"),
  basis: z.literal("calculated"),
  totals: CostTotals.optional(),
  calls: z.array(CostCall).optional(),
  timeline: z.array(CostTotals.extend({ at: z.iso.datetime() })).optional(),
  groups: z
    .object({
      by: z.enum(["user", "task", "model"]),
      order: z.enum(["calls", "cost"]),
      total: CostGroup,
      top: z.array(CostGroup.extend({ key: z.string() })),
      others: CostGroup.extend({ groups: z.number().int().nonnegative() }),
      unassigned: CostGroup,
    })
    .optional(),
  next: z.string().nullable(),
});
export const PlayUsageQuery = z
  .object({
    worldId: z.uuid(),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((v) => Date.parse(v.from) < Date.parse(v.to), {
    message: "期間の終了は開始より後にしてください",
  });
const count = z.number().int().nonnegative();
export const PlayUsageReport = z.object({
  timeZone: z.literal("Asia/Tokyo"),
  rows: z.array(
    z.object({
      date: z.iso.date(),
      userId: z.uuid().nullable(),
      command: z.string().nullable(),
      requests: count,
      completed: count,
      rolledIncomplete: count,
      notRolled: count,
      originals: count,
      originalsUnknown: count,
      batchSizes: z.record(z.string(), count),
      rolls: z.object({
        fresh: count,
        reused: count,
        unrolled: count,
        succeeded: count,
      }),
      results: z.object({ succeeded: count, partial: count, failed: count }),
      spentSp: count,
      gmCalls: count,
      changes: z.object({
        receipts: count,
        existences: count,
        items: count,
        skills: count,
      }),
    }),
  ),
  missing: z.object({ timeOfDay: count }),
});
export const RuntimeSettings = z
  .object({
    paused: z.boolean(),
    worldEditsUntil: z.iso.datetime().optional(),
    concurrency: z.number().int().positive().safe().nullable(),
    sampleIntervalSeconds: z.number().int().positive().safe(),
    retentionDays: z.number().int().positive().safe(),
    thresholds: z.partialRecord(
      z.enum([
        "errorPercent",
        "latencyMs",
        "queueAgeSeconds",
        "postgresBytes",
        "postgresConnectionPercent",
        "postgresUnavailable",
        "graphUnavailable",
        "calculatedUsd",
        "unsettledUsd",
      ]),
      z.number().nonnegative().finite(),
    ),
  })
  .strict();
export const JobKind = z.enum(["construction", "scene", "join"]);
export const JobQuery = z
  .object({
    kind: JobKind.optional(),
    worldId: z.uuid().optional(),
    userId: z.uuid().optional(),
    before: z.uuid().optional(),
  })
  .strict();
export const MonitorPageQuery = z
  .object({ before: z.string().regex(/^\d+$/).optional() })
  .strict();
const backupSettings = z.object({
  enabled: z.boolean(),
  intervalHours: z.number().int().positive().safe(),
  retentionDays: z.number().int().positive().safe(),
  password: z.string().min(16),
});
export const BackupConfiguration = z.union([
  backupSettings
    .extend({
      repository: z.string().regex(/^s3:https?:\/\/[^\s?#@]+$/),
      accessKey: z.string().min(1),
      secretKey: z.string().min(1),
      region: z.string().min(1),
    })
    .strict(),
  backupSettings.extend({ repository: z.literal("local") }).strict(),
]);
const worldTime = z.number().int().nonnegative().safe();
export const WorldGraphQuery = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("inventory"),
      minCount: z.number().int().positive().safe(),
      standard: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("edge"), id: z.uuid() }).strict(),
  z.object({ kind: z.literal("nodes"), after: z.uuid().optional() }).strict(),
  z
    .object({ kind: z.literal("node"), id: z.uuid(), at: worldTime.optional() })
    .strict(),
  z
    .object({
      kind: z.literal("relations"),
      id: z.uuid(),
      relation: RelationKind,
      direction: z.enum(["in", "out"]),
      at: worldTime,
      through: worldTime.optional(),
      after: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("history"),
      id: z.uuid(),
      relation: RelationKind,
      direction: z.enum(["in", "out"]),
      through: worldTime,
      from: worldTime.default(0),
      after: z.object({ from: worldTime, id: z.uuid() }).optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("receipts"), after: z.uuid().optional() })
    .strict(),
]);
export const isReadOnlyOperation = (name: string) =>
  /\.(read|list|records|graph|samples|notifications|jobs|job|uses|history|evaluation|settings|promotions|stats)$/.test(
    name,
  );

export const McpClientConfiguration = z
  .object({
    name: z.string().trim().min(1),
    enabled: z.boolean(),
    redirectUris: z
      .array(
        z.url().refine((s) => {
          const u = new URL(s);
          return (
            !u.hash &&
            !u.username &&
            !u.password &&
            (u.protocol === "https:" ||
              (u.protocol === "http:" &&
                ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) ||
              ![
                "http:",
                "javascript:",
                "data:",
                "file:",
                "about:",
                "vbscript:",
              ].includes(u.protocol))
          );
        }),
      )
      .min(1),
    scopes: z.array(z.string().regex(/^[a-zA-Z]+(?:\.[a-zA-Z]+)+$/)),
    requestAllScopes: z
      .boolean()
      .optional()
      .describe("OAuthの同意画面で登録済みの全操作権限をまとめて要求する"),
    worldIds: z.array(z.uuid()).nullable(),
  })
  .strict();
export * from "./inspection.js";
import {
  InspectionSelection,
  InspectionPageQuery,
  InspectionEvaluation,
  InspectionSchedule,
  InspectionHistoryQuery,
} from "./inspection.js";

export const Operation = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("inspection.select"),
      selection: InspectionSelection,
    })
    .strict(),
  z
    .object({
      operation: z.literal("inspection.read"),
      ...InspectionPageQuery.shape,
    })
    .strict(),
  z
    .object({
      operation: z.literal("inspection.evaluate"),
      worldId: z.uuid(),
      manifestId: z.string().regex(/^[a-f0-9]{64}$/),
      configuration: InspectionEvaluation,
    })
    .strict(),
  z
    .object({
      operation: z.literal("inspection.evaluation"),
      worldId: z.uuid(),
      id: z.uuid(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("inspection.history"),
      query: InspectionHistoryQuery,
    })
    .strict(),
  z
    .object({ operation: z.literal("inspection.settings"), worldId: z.uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("inspection.configure"),
      worldId: z.uuid(),
      configuration: InspectionSchedule,
      expectedVersion: z.number().int().nonnegative(),
      reason: operationReason,
    })
    .strict(),
  z.object({ operation: z.literal("requests.read"), id: z.uuid() }).strict(),
  z
    .object({
      operation: z.literal("mcp.clients.list"),
      before: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("mcp.clients.put"),
      clientId: z.uuid(),
      configuration: McpClientConfiguration,
      advertisedReadScopes: z.array(z.string()).optional(),
      expectedVersion: z.number().int().nonnegative(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("mcp.grants.list"),
      before: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("mcp.grants.revoke"),
      grantId: z.uuid(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("worlds.list"),
      before: z.uuid().optional(),
    })
    .strict(),
  z.object({ operation: z.literal("worlds.read"), worldId: z.uuid() }).strict(),
  z
    .object({
      operation: z.literal("worlds.records"),
      worldId: z.uuid(),
      before: z.string().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("worlds.create"),
      prompt: z.string().min(1),
      playerSettings: z.string().optional(),
      budgetUsd: BudgetUsd,
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("worlds.command"),
      worldId: z.uuid(),
      command: z.discriminatedUnion("command", [
        WorldCommand.options[0].omit({ requestId: true }),
        WorldCommand.options[1].omit({ requestId: true }),
      ]),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("worlds.graph"),
      worldId: z.uuid(),
      query: WorldGraphQuery,
    })
    .strict(),
  z
    .object({
      operation: z.literal("worlds.edit"),
      worldId: z.uuid(),
      at: worldTime,
      dependencies: z.array(
        z.object({ key: z.string().min(1), version: worldTime }).strict(),
      ),
      changes: Change,
      reason: operationReason,
    })
    .strict(),
  z.object({ operation: z.literal("backups.read") }).strict(),
  z
    .object({
      operation: z.literal("backups.jobs"),
      before: z.string().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("backups.list"),
      before: z.string().optional(),
    })
    .strict(),
  z.object({ operation: z.literal("backups.job"), id: z.uuid() }).strict(),
  z
    .object({
      operation: z.literal("backups.configure"),
      configuration: BackupConfiguration,
      expectedVersion: z.number().int().nonnegative(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({ operation: z.literal("backups.create"), reason: operationReason })
    .strict(),
  z
    .object({
      operation: z.literal("backups.restore"),
      snapshot: z.string().regex(/^[a-f0-9]{64}$/),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("monitor.samples"),
      query: MonitorPageQuery,
    })
    .strict(),
  z
    .object({
      operation: z.literal("monitor.notifications"),
      query: MonitorPageQuery,
    })
    .strict(),
  z
    .object({
      operation: z.literal("monitorWebhook.put"),
      url: z.url().nullable(),
      expectedVersion: z.number().int().nonnegative(),
      reason: z.string().trim().min(1),
    })
    .strict(),
  z.object({ operation: z.literal("runtime.read") }).strict(),
  z
    .object({
      operation: z.literal("runtime.put"),
      configuration: RuntimeSettings,
      expectedVersion: z.number().int().positive(),
      reason: z.string().trim().min(1),
    })
    .strict(),
  z.object({ operation: z.literal("jobs.list"), query: JobQuery }).strict(),
  z
    .object({ operation: z.literal("jobs.read"), kind: JobKind, id: z.uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("jobs.resume"),
      kind: JobKind,
      id: z.uuid(),
      reason: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({ operation: z.literal("playSessions.list"), worldId: z.uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("playSessions.advance"),
      worldId: z.uuid(),
      sessionId: z.uuid(),
      reason: operationReason,
    })
    .strict(),
  z.object({ operation: z.literal("costs.read"), query: CostQuery }).strict(),
  z
    .object({ operation: z.literal("playUsage.read"), query: PlayUsageQuery })
    .strict(),
  z.object({ operation: z.literal("models.read") }).strict(),
  z
    .object({
      operation: z.literal("models.put"),
      configuration: ModelConfiguration,
      expectedVersion: z.number().int().nonnegative().safe(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("credentials.put"),
      provider: ModelProvider,
      value: z.string().min(1),
      expectedVersion: z.number().int().nonnegative().safe(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({ operation: z.literal("worldBudgets.read"), worldId: z.uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("worldBudgets.put"),
      worldId: z.uuid(),
      budgetUsd: BudgetUsd,
      expectedVersion: z.number().int().nonnegative().safe(),
      reason: operationReason,
    })
    .strict(),
  z.object({ operation: z.literal("responseLimits.read") }).strict(),
  z.object({ operation: z.literal("playPolicy.read") }).strict(),
  z.object({ operation: z.literal("reportPolicy.read") }).strict(),
  z
    .object({
      operation: z.literal("reportPolicy.put"),
      dailyLimit: quotaCount,
      turnsPerReport: quotaCount,
      maxCharacters: quotaCount,
      expectedVersion: z.number().int().positive().safe(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("reports.list"),
      worldId: z.uuid(),
      before: z.uuid().optional(),
    })
    .strict(),
  z
    .object({ operation: z.literal("stories.list"), ...StoryListQuery.shape })
    .strict(),
  z
    .object({
      operation: z.literal("stories.read"),
      storyId: z.uuid(),
      ...StoryReadQuery.omit({ image: true }).shape,
    })
    .strict(),
  z
    .object({
      operation: z.literal("stories.stats"),
      worldId: z.uuid(),
      ...StoryDates.shape,
    })
    .strict(),
  z
    .object({
      operation: z.literal("activity.read"),
      worldId: z.uuid(),
      days: z.array(z.iso.date()).min(1).max(2),
    })
    .strict(),
  z
    .object({
      operation: z.literal("blueprints.create"),
      worldId: z.uuid(),
      template: BlueprintDraft,
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("blueprints.publish"),
      worldId: z.uuid(),
      template: z.union([
        BlueprintPublication,
        z.object({ templateId: z.uuid() }).strict(),
      ]),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("notices.send"),
      worldId: z.uuid(),
      text: z.string().trim().min(1).max(4000),
      actorIds: z
        .array(z.uuid())
        .min(1)
        .optional()
        .describe(
          "宛先の人物。省くと、サーバー担当のNPCを除く、操作中の人物全員",
        ),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("npcs.promotions"),
      worldId: z.uuid(),
      before: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("npcs.decidePromotion"),
      worldId: z.uuid(),
      promotionId: z.uuid(),
      approve: z.boolean(),
      reason: operationReason,
    })
    .strict(),
  z.object({ operation: z.literal("npcs.read"), worldId: z.uuid() }).strict(),
  z
    .object({ operation: z.literal("promotionPolicy.read"), worldId: z.uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("promotionPolicy.put"),
      worldId: z.uuid(),
      condition: z
        .string()
        .trim()
        .describe("明確に合致すれば承認する条件。空欄で手動判断のみ"),
      reason: operationReason,
    })
    .strict(),
  z
    .object({ operation: z.literal("creationPolicy.read"), worldId: z.uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("creationPolicy.put"),
      worldId: z.uuid(),
      dice: WorldDice.optional().describe(
        "世界の判定で振るダイス。既定は3d6。省略すると現在の設定を保つ",
      ),
      criteria: z
        .string()
        .trim()
        .optional()
        .describe("新規作成のダイス基準。空欄で既定、省略で現状維持"),
      exploreCriteria: z
        .string()
        .trim()
        .optional()
        .describe("探索の判定基準と拒否条件。空欄で既定、省略で現状維持"),
      skillCriteria: z
        .string()
        .trim()
        .optional()
        .describe(
          "技能の習得・発展・統合の成功範囲と、ダイスを振る前にエラーを返す条件。空欄で既定、省略で現状維持",
        ),
      fumbleCriteria: z
        .string()
        .trim()
        .optional()
        .describe(
          "失敗時のファンブルをGMが設定するときの基準。空欄で既定の基準。省略すると現在の設定を保つ",
        ),
      shown: z
        .boolean()
        .optional()
        .describe(
          "基準の文をプレイヤーのstatusに表示する。省略すると現在の設定を保つ。初期値は非表示",
        ),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("npcs.put"),
      worldId: z.uuid(),
      actorId: z.uuid(),
      controller: z.enum(["bot", "server"]).nullable(),
      userId: z.uuid().optional(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("playPolicy.put"),
      turnCalls: quotaCount,
      receiptTimeoutSeconds: quotaCount,
      expectedVersion: z.number().int().positive().safe(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("responseLimits.put"),
      calls: quotaCount,
      expectedVersion: z.number().int().positive().safe(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({ operation: z.literal("modelLimits.read"), name: ModelLimitName })
    .strict(),
  z
    .object({
      operation: z.literal("modelLimits.put"),
      name: ModelLimitName,
      limits: ModelLimit.nullable(),
      expectedVersion: z.number().int().nonnegative().safe(),
      reason: operationReason,
    })
    .strict(),
  JoinWorld,
  z
    .object({ operation: z.literal("worlds.resumeJoin"), joinId: z.uuid() })
    .strict(),
  z
    .object({
      operation: z.literal("worlds.disableActorRespawn"),
      worldId: z.uuid(),
      actorId: z.uuid(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("worlds.configure"),
      worldId: z.uuid(),
      freePlayerLimit: z
        .int32()
        .nonnegative()
        .optional()
        .describe(
          "一般アカウントがこの世界で所持できる無料プレイヤー数。既定は1。省略すると現在の設定を保つ",
        ),
      dailySpLimit: z
        .int32()
        .positive()
        .optional()
        .describe(
          "この世界のアカウントごとの日次SP上限。既定は100。省略すると現在の設定を保つ",
        ),
      inventoryCapacity: z
        .boolean()
        .optional()
        .describe("所持・保管枠の制限を有効にする"),
      inventoryLimits: InventoryLimits.partial().strict().optional(),
      title: z.string().trim().min(1),
      description: z.string(),
      playerSettings: z.string().optional(),
      published: z.boolean(),
      accepting: z.boolean(),
      playerList: z
        .boolean()
        .optional()
        .describe(
          "いま出会えるフレンドと居場所の一覧（players）を参加者へ提供する。省略すると現在の設定を保つ",
        ),
      instantNpcMultiplier: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "検索で出現した個体が同じ場所に同時に同席できる数を、発生用ノードの発生数（maxCount、旧形式はcount）の何倍までにするか。既定は2。省略すると現在の設定を保つ",
        ),
      startingItems: z
        .array(StartingItem)
        .max(12)
        .optional()
        .describe(
          "参加する人物が最初から手に持つ系列つきの物品。設定後に始まる参加から適用する。省略すると現在の設定を保つ",
        ),
      deathJudgment: z
        .boolean()
        .optional()
        .describe(
          "プレイヤーとユニークNPCを対抗行動の死亡判定の対象にする。既定は有効。省略すると現在の設定を保つ",
        ),
      combatMode: CombatMode.optional().describe(
        "新規世界の既定はpve。pvpではプレイヤー間の対抗行動と非戦闘地域を有効にする。省略すると現在の設定を保つ",
      ),
      respawnEnabled: z
        .boolean()
        .optional()
        .describe(
          "死亡した人物を復帰させる。既定は有効。無効なら死亡後はその人物で操作できない。省略すると現在の設定を保つ",
        ),
      deathCriteria: z
        .string()
        .optional()
        .describe(
          "人物の死亡を判定するGMへ渡す、この世界の条件文。空なら行動と結果だけから判定する。省略すると現在の設定を保つ",
        ),
      deathPlaceId: z
        .uuid()
        .nullable()
        .optional()
        .describe(
          "Homeが未設定の人物の復帰先。nullなら本人の最初の所在地へ移す。省略すると現在の設定を保つ",
        ),
      nonCombatPlaceSeries: z
        .array(PlaceSeries)
        .optional()
        .describe(
          "非戦闘にする場所の系統名。世界内の特定の範囲ごとに指定する。空配列で解除し、省略すると現在の設定を保つ",
        ),
      nonCombatAreas: NonCombatAreas.optional().describe(
        "非戦闘地域。範囲の場所IDと、古い地理記録を補う場所IDを指定する。両方の内部にあたる part-of の子にも適用する。空配列で解除し、省略すると現在の設定を保つ",
      ),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("presets.put"),
      presetId: z.uuid(),
      title: PlayerPreset.shape.title,
      description: z.string(),
      settings: z.string().trim().min(1),
      expectedVersion: z.number().int().nonnegative().safe(),
      reason: operationReason,
    })
    .strict(),
  z.object({ operation: z.literal("presets.list"), ...operationPage }).strict(),
  z
    .object({
      operation: z.literal("account.claim"),
      version: LegacyClaimPage.shape.version,
    })
    .strict(),
  z
    .object({
      operation: z.literal("account.register"),
      invitation: z.string().optional(),
    })
    .strict(),
  z.object({ operation: z.literal("settings.read") }).strict(),
  z
    .object({
      operation: z.literal("settings.invites"),
      enabled: z.boolean(),
      reason: operationReason,
    })
    .strict(),
  z.object({ operation: z.literal("users.list"), ...operationPage }).strict(),
  z
    .object({
      operation: z.literal("users.role"),
      userId: z.uuid(),
      role: z.enum(["admin", "user"]),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("users.ban"),
      userId: z.uuid(),
      banned: z.boolean(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("invites.create"),
      worldId: z.uuid().optional(),
      expiresAt: z.iso.datetime({ offset: true }),
      maxUses: z.number().int().positive().safe(),
      reason: operationReason,
    })
    .strict(),
  z.object({ operation: z.literal("invites.list"), ...operationPage }).strict(),
  z
    .object({
      operation: z.literal("invites.uses"),
      inviteId: z.uuid(),
      ...operationPage,
    })
    .strict(),
  z
    .object({
      operation: z.literal("invites.revoke"),
      inviteId: z.uuid(),
      reason: operationReason,
    })
    .strict(),
  z
    .object({
      operation: z.literal("audit.list"),
      before: DeliveryCursor.shape.cursor.optional(),
    })
    .strict(),
]);
