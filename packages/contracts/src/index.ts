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
export const WorldCommand = z.discriminatedUnion("command", [
  z
    .object({
      requestId: z.uuid(),
      command: z.literal("advance"),
      duration: z.number().int().positive().safe(),
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
