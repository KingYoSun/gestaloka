import { z } from "zod";

export const Health = z.object({
  service: z.literal("gestaloka"),
  status: z.literal("ok"),
});
export const HealthEvent = z.object({
  type: z.literal("health"),
  data: Health,
});

export const ApiError = z.object({ code: z.string(), message: z.string() });
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
export const WorldStatus = z.object({
  id: z.uuid(),
  prompt: z.string(),
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
export const KnowledgeRecord = z.object({
  id: z.uuid(),
  kind: z.enum(["observation", "interpretation"]),
  text: z.string(),
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
export const EventQuery = z.object({
  actorId: z.uuid().optional(),
  role: z.enum(["admin", "player"]),
  after: z.string().regex(/^\d+$/).optional(),
});
export const ActorQuery = z.object({ actorId: z.uuid().optional() });
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
      command: z.enum(["start", "finish", "resume"]),
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
  result: z.string().nullable(),
  error: z.string().nullable(),
  messages: z.array(z.object({ id: z.uuid(), text: z.string() })),
  actions: z.array(
    z.object({
      id: z.uuid(),
      text: z.string(),
      state: z.enum(["running", "complete", "boundary"]),
    }),
  ),
  recordIds: z.array(z.uuid()),
  nextPurpose: z.string().nullable(),
});
export const SceneResponse = z.object({ scene: SceneStatus.nullable() });
export const SceneViewQuery = z.object({
  actorId: z.uuid().optional(),
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
    }),
  ),
  next: z.string().nullable(),
  previous: z.string().nullable(),
});
export const KnowledgeQuery = PageQuery.safeExtend({
  actorId: z.uuid().optional(),
  excludeScene: z.uuid().optional(),
});

export const Member = z.object({
  id: z.uuid(),
  role: z.enum(["admin", "user"]),
  banned: z.boolean(),
  createdAt: z.iso.datetime(),
});
const operationPage = { before: z.uuid().optional() };
const operationReason = z.string().trim().min(1);
export const CatalogPageQuery = z.object({ before: z.uuid().optional() });
export const WorldCatalogPage = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      description: z.string(),
      accepting: z.boolean(),
      canJoin: z.boolean(),
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
export const JoinWorld = z
  .object({
    operation: z.literal("worlds.join"),
    worldId: z.uuid(),
    presetId: z.uuid(),
    presetVersion: z.number().int().positive().safe(),
  })
  .strict();
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
  .regex(/^(deepseek|gemini|openai|anthropic):.+$/);
export const ModelProvider = z.enum([
  "deepseek",
  "gemini",
  "openai",
  "anthropic",
]);
export const ModelSetting = z
  .object({
    provider: ModelProvider,
    model: z.string().trim().min(1),
    baseUrl: z.url(),
    harnessBaseUrl: z.url().optional(),
    api: z.enum(["chat-completions", "responses", "messages"]),
    effort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
    initialEffort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
    contextTokens: quotaCount,
    maxOutputTokens: quotaCount,
    inputUsdPerMillion: z.number().positive().finite(),
    cachedInputUsdPerMillion: z.number().nonnegative().finite(),
    cacheWrite5mUsdPerMillion: z.number().nonnegative().finite().optional(),
    cacheWrite1hUsdPerMillion: z.number().nonnegative().finite().optional(),
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
    view: z.enum(["summary", "calls", "timeline"]),
    interval: z.enum(["hour", "day", "month"]).default("day"),
    after: z.string().optional(),
  })
  .strict()
  .refine((v) => Date.parse(v.from) < Date.parse(v.to), {
    message: "期間の終了は開始より後にしてください",
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
  usage: z
    .object({
      input: z.number(),
      cachedInput: z.number(),
      cacheMissInput: z.number(),
      output: z.number(),
      cacheWrite5m: z.number().nullable(),
      cacheWrite1h: z.number().nullable(),
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
    })
    .nullable(),
});
export const CostReport = z.object({
  currency: z.literal("USD"),
  basis: z.literal("calculated"),
  totals: CostTotals.optional(),
  calls: z.array(CostCall).optional(),
  timeline: z.array(CostTotals.extend({ at: z.iso.datetime() })).optional(),
  next: z.string().nullable(),
});
export const RuntimeSettings = z
  .object({
    paused: z.boolean(),
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
export const BackupConfiguration = z
  .object({
    enabled: z.boolean(),
    intervalHours: z.number().int().positive().safe(),
    retentionDays: z.number().int().positive().safe(),
    repository: z.string().regex(/^s3:https?:\/\/[^\s?#@]+$/),
    accessKey: z.string().min(1),
    secretKey: z.string().min(1),
    password: z.string().min(16),
    region: z.string().min(1),
  })
  .strict();
export const Operation = z.discriminatedUnion("operation", [
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
  z.object({ operation: z.literal("costs.read"), query: CostQuery }).strict(),
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
      operation: z.literal("worlds.configure"),
      worldId: z.uuid(),
      title: z.string().trim().min(1),
      description: z.string(),
      published: z.boolean(),
      accepting: z.boolean(),
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
