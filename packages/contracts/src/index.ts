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
export const CreateWorld = z
  .object({ requestId: z.uuid(), prompt: z.string().min(1) })
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
      command: z.enum(["resume", "finish", "join"]),
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
  role: z.enum(["admin", "player"]),
  after: z.string().regex(/^\d+$/).optional(),
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
  view: z.literal("compact").optional(),
});
export const SceneRecordQuery = PageQuery.safeExtend({
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
export const Operation = z.discriminatedUnion("operation", [
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
