import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import {
  ApiError,
  PlayCommand,
  PlayResponse,
  PlayerReportInput,
  PlayerReportStatus,
  PlayerNotices,
  ViewersInput,
  ViewersResult,
  PlayerReportReceipt,
  WaitingCommand,
  WaitingContextStatus,
  WaitingStatus,
  BrowserSession,
  ResourceId,
  CreateWorld,
  WorldCommand,
  WorldStatus,
  WorldList,
  PageQuery,
  AdminPage,
  KnowledgePage,
  EventQuery,
  WorldEvent,
  PlayerAction,
  PlayerStatus,
  RequestIdentity,
  PlayRun,
  DeliveryCursor,
  SceneCommand,
  SceneResponse,
  SceneViewQuery,
  SceneRecordQuery,
  SceneRecordPage,
  KnowledgeQuery,
  ActorQuery,
  Belongings,
  SessionPartners,
  NpcModeCommand,
  NpcReport,
  ScenePresence,
  ScenePresenceStatus,
  SceneInbox,
  SceneInboxQuery,
} from "@gestaloka/contracts";
import {
  AccessError,
  TurnSignals,
  type WorldAccess,
} from "@gestaloka/server/access";
import { IdentityError, type OryIdentity } from "@gestaloka/server/identity";
import type { Operations } from "@gestaloka/server/operations";

export async function worldRoutes(
  instance: FastifyInstance,
  access?: WorldAccess,
  identity?: OryIdentity,
  operations?: Operations,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  await app.register(cookie);
  const service = () => {
    if (!access)
      throw new AccessError(
        503,
        "MODEL_NOT_CONFIGURED",
        "モデルのAPIキーを設定してください",
      );
    return access;
  };
  const identities = new WeakMap<FastifyRequest, string>();
  const deviceIds = new WeakMap<FastifyRequest, string>();
  const subject = async (request: FastifyRequest) => {
    if (!identity || !operations)
      throw new AccessError(
        503,
        "IDENTITY_NOT_CONFIGURED",
        "認証サービスを設定してください",
      );
    let id: string;
    if (request.headers.authorization) {
      const allowed = [
        "/api/worlds/:id/scene",
        "/api/worlds/:id/session",
        "/api/worlds/:id/waiting",
        "/api/worlds/:id/waiting/events",
        "/api/worlds/:id/reports",
        "/api/worlds/:id/notices",
        "/api/worlds/:id/viewers",
        "/api/worlds/:id/npc-promotions",
        "/api/worlds/:id/scene/records",
        "/api/worlds/:id/knowledge",
        "/api/worlds/:id/belongings",
        "/api/worlds/:id/partners",
        "/api/worlds/:id/presence",
        "/api/worlds/:id/npc-mode",
        "/api/worlds/:id/scene/inbox",
      ];
      if (
        !allowed.includes(request.routeOptions.url ?? "") ||
        !["GET", "POST"].includes(request.method)
      )
        throw new AccessError(
          403,
          "PLAYER_DEVICE_SCOPE",
          "許可されたプレイ操作を指定してください",
        );
      const params = request.params as { id: string };
      const query = request.query as { actorId?: string };
      const device = await service().devices.authorize(
        request.headers.authorization,
        params.id,
        query.actorId,
      );
      if (
        !device.actor_id &&
        request.routeOptions.url !== "/api/worlds/:id/reports"
      )
        throw new AccessError(
          409,
          "PLAYER_JOIN_REQUIRED",
          "参加完了を確認してください",
        );
      if (device.actor_id) query.actorId = device.actor_id;
      deviceIds.set(request, device.id);
      id = device.user_id!;
    } else id = (await identity.session(request.headers.cookie)).userId;
    await operations.authorize(id);
    identities.set(request, id);
    return id;
  };
  app.addHook("onSend", async (request, reply, payload) => {
    const identity = identities.get(request);
    if (identity) reply.header("X-Gestaloka-Subject", identity);
    return payload;
  });
  const errors = {
    400: ApiError,
    500: ApiError,
    401: ApiError,
    403: ApiError,
    404: ApiError,
    409: ApiError,
    503: ApiError,
  };
  app.addHook("onRequest", async (request, reply) => {
    if (
      request.url.startsWith("/api/worlds") ||
      request.url.startsWith("/api/runs") ||
      request.url.startsWith("/api/session")
    )
      reply.header("Cache-Control", "private, no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      (request.url.startsWith("/api/worlds") ||
        request.url.startsWith("/api/session"))
    ) {
      if (
        request.headers["x-gestaloka-request"] !== "1" ||
        (request.headers.origin &&
          (!URL.canParse(request.headers.origin) ||
            new URL(request.headers.origin).origin !==
              new URL(`${request.protocol}://${request.headers.host}`).origin))
      )
        throw new AccessError(
          403,
          "ORIGIN_REQUIRED",
          "同じ画面から操作してください",
        );
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof IdentityError)
      return reply
        .code(error.status)
        .send({ code: "LOGIN_REQUIRED", message: error.message });
    if (error instanceof AccessError)
      return reply.code(error.status).send({
        code: error.code,
        message: error.message,
        callsUsed: error.callsUsed,
      });
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      error.validation
    )
      return reply
        .code(400)
        .send({ code: "INPUT_INVALID", message: "入力を確認してください" });
    app.log.error(error);
    return reply
      .code(500)
      .send({ code: "INTERNAL_ERROR", message: "処理を完了できませんでした" });
  });
  app.post(
    "/api/session",
    { schema: { response: { 200: BrowserSession, ...errors } } },
    async (request) => ({ id: await subject(request) }),
  );
  app.get(
    "/api/session",
    { schema: { response: { 200: BrowserSession, ...errors } } },
    async (request) => ({ id: await subject(request) }),
  );
  app.get(
    "/api/worlds",
    { schema: { response: { 200: WorldList, ...errors } } },
    async (request) => service().list(await subject(request)),
  );
  app.post(
    "/api/worlds",
    {
      schema: { body: CreateWorld, response: { 202: WorldStatus, ...errors } },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(await service().create(await subject(request), request.body)),
  );
  app.get(
    "/api/worlds/:id",
    {
      schema: { params: ResourceId, response: { 200: WorldStatus, ...errors } },
    },
    async (request) =>
      service().status(await subject(request), request.params.id),
  );
  app.post(
    "/api/worlds/:id/commands",
    {
      schema: {
        params: ResourceId,
        body: WorldCommand,
        response: { 202: WorldStatus, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await service().command(
            await subject(request),
            request.params.id,
            request.body,
          ),
        ),
  );
  app.get(
    "/api/worlds/:id/records",
    {
      schema: {
        params: ResourceId,
        querystring: PageQuery,
        response: { 200: AdminPage, ...errors },
      },
    },
    async (request) =>
      service().records(
        await subject(request),
        request.params.id,
        request.query.before,
        request.query.after,
      ),
  );
  app.get(
    "/api/worlds/:id/knowledge",
    {
      schema: {
        params: ResourceId,
        querystring: KnowledgeQuery,
        response: { 200: KnowledgePage, ...errors },
      },
    },
    async (request) =>
      service().knowledge(
        await subject(request),
        request.params.id,
        request.query.before,
        request.query.after,
        request.query.actorId,
      ),
  );
  app.get(
    "/api/worlds/:id/belongings",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery,
        response: { 200: Belongings, ...errors },
      },
    },
    async (request) =>
      service().belongings(
        await subject(request),
        request.params.id,
        request.query.actorId,
      ),
  );
  app.get(
    "/api/worlds/:id/partners",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery.extend({ before: z.uuid().optional() }),
        response: { 200: SessionPartners, ...errors },
      },
    },
    async (request) =>
      service().partners(
        await subject(request),
        request.params.id,
        request.query.actorId,
        request.query.before,
      ),
  );
  app.get(
    "/api/worlds/:id/play",
    {
      schema: {
        params: ResourceId,
        response: { 200: PlayerStatus, ...errors },
        querystring: ActorQuery,
      },
    },
    async (request) =>
      service().player(
        await subject(request),
        request.params.id,
        request.query.actorId,
      ),
  );
  app.get(
    "/api/runs/:id",
    { schema: { params: ResourceId, response: { 200: PlayRun, ...errors } } },
    async (request) => service().run(await subject(request), request.params.id),
  );
  app.get(
    "/api/worlds/:id/scene",
    {
      schema: {
        params: ResourceId,
        querystring: SceneViewQuery,
        response: { 200: SceneResponse, ...errors },
      },
    },
    async (request) =>
      service().scene(
        await subject(request),
        request.params.id,
        request.query.view === "compact",
        request.query.actorId,
        request.query.sceneId,
      ),
  );
  app.get(
    "/api/worlds/:id/scene/records",
    {
      schema: {
        params: ResourceId,
        querystring: SceneRecordQuery,
        response: { 200: SceneRecordPage, ...errors },
      },
    },
    async (request) =>
      service().sceneRecords(
        await subject(request),
        request.params.id,
        request.query,
      ),
  );
  app.post(
    "/api/worlds/:id/scene",
    {
      schema: {
        params: ResourceId,
        querystring: SceneViewQuery,
        body: SceneCommand,
        response: { 202: SceneResponse, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await service().sceneCommand(
            await subject(request),
            request.params.id,
            request.body,
            request.query.view === "compact",
            request.query.actorId,
            request.query.sceneId,
            deviceIds.has(request) ? "bot" : "human",
            deviceIds.get(request),
          ),
        ),
  );
  app.get(
    "/api/worlds/:id/session",
    {
      schema: {
        params: ResourceId,
        querystring: SceneViewQuery.extend({
          view: z.enum(["wait", "joins", "screen"]).optional(),
          after: z
            .string()
            .regex(/^\d{1,19}$/)
            .refine((v) => v.length < 19 || v <= "9223372036854775807")
            .optional(),
        }),
        response: { 200: PlayResponse, ...errors },
      },
    },
    async (request) => {
      const user = await subject(request);
      const { actorId, sceneId, view, after } = request.query;
      const connection = deviceIds.get(request);
      if (view === "wait" || view === "joins") {
        if (sceneId)
          throw new AccessError(
            400,
            "INVALID_STATUS_VIEW",
            "表示の絞り込みは現在のセッションを対象にします",
          );
        return service().botStatusView(
          user,
          request.params.id,
          view,
          actorId,
          connection,
          after,
        );
      }
      return service().botStatus(
        user,
        request.params.id,
        actorId,
        sceneId,
        connection,
        after,
        view === "screen",
      );
    },
  );
  app.post(
    "/api/worlds/:id/session",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery,
        body: PlayCommand,
        response: { 200: PlayResponse, ...errors },
      },
    },
    async (request) =>
      service().botCommand(
        await subject(request),
        request.params.id,
        request.body,
        request.query.actorId,
        deviceIds.get(request),
      ),
  );
  app.get(
    "/api/worlds/:id/waiting",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery,
        response: { 200: WaitingStatus, ...errors },
      },
    },
    async (request) =>
      service().waiting(
        await subject(request),
        request.params.id,
        request.query.actorId,
        deviceIds.get(request),
      ),
  );
  app.post(
    "/api/worlds/:id/waiting",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery.extend({ context: z.literal("1").optional() }),
        body: WaitingCommand,
        response: { 200: WaitingContextStatus, ...errors },
      },
    },
    async (request) =>
      service().waiting(
        await subject(request),
        request.params.id,
        request.query.actorId,
        deviceIds.get(request),
        request.body.active,
        true,
        request.query.context === "1",
      ),
  );
  app.get(
    "/api/worlds/:id/reports",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery,
        response: { 200: PlayerReportStatus, ...errors },
      },
    },
    async (request) =>
      service().reportStatus(
        await subject(request),
        request.params.id,
        request.query.actorId,
        deviceIds.get(request),
      ),
  );
  app.get(
    "/api/worlds/:id/notices",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery,
        response: { 200: PlayerNotices, ...errors },
      },
    },
    async (request) =>
      service().notices(
        await subject(request),
        request.params.id,
        request.query.actorId,
      ),
  );
  app.post(
    "/api/worlds/:id/viewers",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery,
        body: ViewersInput,
        response: { 200: ViewersResult, ...errors },
      },
    },
    async (request) =>
      service().setViewers(
        await subject(request),
        request.params.id,
        request.body,
        request.query.actorId,
      ),
  );
  app.post(
    "/api/worlds/:id/reports",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery,
        body: PlayerReportInput,
        response: { 200: PlayerReportReceipt, ...errors },
      },
    },
    async (request) =>
      service().report(
        await subject(request),
        request.params.id,
        request.body,
        request.query.actorId,
        deviceIds.get(request),
      ),
  );
  app.get(
    "/api/worlds/:id/npc-promotions",
    {
      schema: {
        params: ResourceId,
        querystring: PageQuery.extend(ActorQuery.shape),
        response: { 200: PlayResponse, ...errors },
      },
    },
    async (request) =>
      service().promotions(
        await subject(request),
        request.params.id,
        request.query.actorId,
        request.query.before,
      ),
  );
  app.get(
    "/api/worlds/:id/npc-mode",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery,
        response: { 200: NpcReport, ...errors },
      },
    },
    async (request) =>
      service().npcMode(
        await subject(request),
        request.params.id,
        request.query.actorId,
      ),
  );
  app.post(
    "/api/worlds/:id/npc-mode",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery,
        body: NpcModeCommand,
        response: { 200: NpcReport, ...errors },
      },
    },
    async (request) =>
      service().npcMode(
        await subject(request),
        request.params.id,
        request.query.actorId,
        request.body,
        deviceIds.has(request) ? "bot" : "human",
      ),
  );
  app.post(
    "/api/worlds/:id/presence",
    {
      schema: {
        params: ResourceId,
        querystring: ActorQuery,
        body: ScenePresence,
        response: { 200: ScenePresenceStatus, ...errors },
      },
    },
    async (request) =>
      service().presence(
        await subject(request),
        request.params.id,
        request.body,
        request.headers.authorization ? "bot" : "human",
        request.query.actorId,
        deviceIds.get(request),
      ),
  );
  app.get(
    "/api/worlds/:id/scene/inbox",
    {
      schema: {
        params: ResourceId,
        querystring: SceneInboxQuery,
        response: { 200: SceneInbox, ...errors },
      },
    },
    async (request) =>
      service().inbox(
        await subject(request),
        request.params.id,
        request.query.actorId,
        request.query.after,
      ),
  );
  app.post(
    "/api/worlds/:id/actions",
    {
      schema: {
        params: ResourceId,
        body: PlayerAction,
        response: { 202: PlayerStatus, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          await service().play(
            await subject(request),
            request.params.id,
            request.body,
          ),
        ),
  );
  app.post(
    "/api/worlds/:id/play/resume",
    {
      schema: {
        params: ResourceId,
        body: RequestIdentity,
        response: { 202: PlayerStatus, ...errors },
      },
    },
    async (request, reply) =>
      reply.code(202).send(
        await service().play(await subject(request), request.params.id, {
          ...request.body,
          resume: true,
        }),
      ),
  );
  const streams = new Map<AbortController, () => void>();
  app.get(
    "/api/worlds/:id/cursor",
    {
      schema: {
        params: ResourceId,
        querystring: EventQuery.pick({ role: true, actorId: true }),
        response: { 200: DeliveryCursor, ...errors },
      },
    },
    async (request) =>
      service().cursor(
        await subject(request),
        request.params.id,
        request.query.role,
        request.query.actorId,
      ),
  );
  const turnSignals = new TurnSignals();
  app.addHook("onClose", () => turnSignals.close());
  app.get(
    "/api/worlds/:id/waiting/events",
    {
      sse: "only",
      schema: {
        hide: true,
        params: ResourceId,
        querystring: ActorQuery.extend({
          context: z.literal("1").optional(),
          after: z
            .string()
            .regex(/^\d{1,19}$/)
            .refine((v) => v.length < 19 || v <= "9223372036854775807")
            .optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = await subject(request),
        world = request.params.id,
        actor = request.query.actorId,
        device = deviceIds.get(request);
      if (!device || !actor)
        throw new AccessError(
          403,
          "PLAYER_DEVICE_REQUIRED",
          "本人のプレイ端末を指定してください",
        );
      const controller = new AbortController();
      let dirty = true,
        resume: (() => void) | undefined;
      const changed = () => {
        dirty = true;
        resume?.();
      };
      const close = () => {
        controller.abort();
        changed();
      };
      reply.sse.onClose(close);
      const unsubscribe = await turnSignals.subscribe(
        service().pool,
        world + ":" + actor,
        changed,
        close,
      );
      streams.set(controller, () => {
        close();
        reply.sse.close();
      });
      const renewal = setTimeout(close, 240000);
      let sent = false,
        last = "",
        after = request.query.after;
      const includeJoins = request.query.context === "1";
      try {
        while (!controller.signal.aborted) {
          if (!dirty)
            await new Promise<void>((resolve) => {
              resume = resolve;
            });
          resume = undefined;
          if (controller.signal.aborted) break;
          dirty = false;
          // Reauthorize before every delivery. Only a fresh client subscription renews presence.
          if (sent && (await subject(request)) !== user)
            throw new AccessError(
              401,
              "SESSION_CHANGED",
              "ログインが変わりました",
            );
          const frame = await service().waiting(
            user,
            world,
            actor,
            device,
            undefined,
            !sent,
            includeJoins && after === undefined,
          );
          if (controller.signal.aborted) break;
          if (frame.context?.receiving && dirty) continue;
          const progress =
            after === undefined
              ? undefined
              : await service().botPlay.turnFeed(
                  world,
                  frame.viewerId,
                  after,
                  includeJoins,
                );
          const key = JSON.stringify([
            frame.state,
            frame.wakeKey,
            frame.noticeKey,
            ...(progress
              ? [
                  frame.sessionId,
                  frame.turn,
                  progress.actorId,
                  progress.waitingForReturn?.deadline,
                  progress.cursor,
                ]
              : []),
          ]);
          if (key !== last) {
            if (!sent) {
              reply.header("X-Accel-Buffering", "no");
              reply.sse.keepAlive();
            }
            await reply.sse.send({
              event: "waiting",
              data: { ...frame, ...(progress ? { progress } : {}) },
            });
            sent = true;
            last = key;
            if (progress) after = progress.cursor;
          }
          if (!frame.active || frame.state === "inactive") break;
        }
      } catch (error) {
        if (!sent) throw error;
        if (
          !controller.signal.aborted &&
          !(error instanceof AccessError) &&
          !(error instanceof IdentityError)
        )
          app.log.error(error);
      } finally {
        clearTimeout(renewal);
        unsubscribe();
        streams.delete(controller);
        if (sent) reply.sse.close();
      }
    },
  );
  app.addHook("preClose", async () => {
    for (const [controller, close] of streams) {
      controller.abort();
      close();
    }
  });
  app.get(
    "/api/worlds/:id/events",
    {
      sse: "only",
      schema: { hide: true, params: ResourceId, querystring: EventQuery },
    },
    async (request, reply) => {
      const identity = await subject(request),
        id = request.params.id,
        role = request.query.role;
      let cursor = String(
        request.headers["last-event-id"] ?? request.query.after ?? "0",
      );
      let events = await service().events(
        identity,
        id,
        role,
        cursor,
        request.query.actorId,
      );
      const controller = new AbortController();
      streams.set(controller, () => reply.sse.close());
      reply.sse.onClose(() => {
        controller.abort();
        streams.delete(controller);
      });
      reply.sse.keepAlive();
      try {
        await reply.sse.send({ event: "connected", data: { worldId: id } });
        while (reply.sse.isConnected && !controller.signal.aborted) {
          if ((await subject(request)) !== identity)
            throw new AccessError(
              401,
              "SESSION_CHANGED",
              "ログインが変わりました",
            );
          for (const event of events) {
            await service().authorize(
              identity,
              id,
              role,
              service().pool,
              request.query.actorId,
            );
            await reply.sse.send({
              id: event.id,
              event: "update",
              data: WorldEvent.parse({
                id: event.id,
                worldId: id,
                type: "invalidate",
              }),
            });
            cursor = event.id;
          }
          if (events.length < 50)
            await delay(500, undefined, { signal: controller.signal });
          events = await service().events(
            identity,
            id,
            role,
            cursor,
            request.query.actorId,
          );
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !(error instanceof AccessError) &&
          !(error instanceof IdentityError)
        )
          app.log.error(error);
      } finally {
        controller.abort();
        reply.sse.close();
        streams.delete(controller);
      }
    },
  );
}
