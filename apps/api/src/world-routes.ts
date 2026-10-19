import { setTimeout as delay } from "node:timers/promises";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import {
  ApiError,
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
} from "@gestaloka/contracts";
import { AccessError, type WorldAccess } from "@gestaloka/server/access";

export async function worldRoutes(
  instance: FastifyInstance,
  access?: WorldAccess,
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
  const subject = (request: FastifyRequest) =>
    service().authenticate(request.cookies.gestaloka);
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
    if (error instanceof AccessError)
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message });
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
    async (request, reply) => {
      const session = await service().session(request.cookies.gestaloka);
      if (session.credential)
        reply.setCookie("gestaloka", session.credential, {
          path: "/",
          httpOnly: true,
          sameSite: "strict",
          secure: request.protocol === "https",
          maxAge: 31536000,
        });
      return { id: session.id };
    },
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
      ),
  );
  app.get(
    "/api/worlds/:id/knowledge",
    {
      schema: {
        params: ResourceId,
        querystring: PageQuery,
        response: { 200: KnowledgePage, ...errors },
      },
    },
    async (request) =>
      service().knowledge(
        await subject(request),
        request.params.id,
        request.query.before,
      ),
  );
  app.get(
    "/api/worlds/:id/play",
    {
      schema: {
        params: ResourceId,
        response: { 200: PlayerStatus, ...errors },
      },
    },
    async (request) =>
      service().player(await subject(request), request.params.id),
  );
  app.get(
    "/api/runs/:id",
    { schema: { params: ResourceId, response: { 200: PlayRun, ...errors } } },
    async (request) => service().run(await subject(request), request.params.id),
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
      let events = await service().events(identity, id, role, cursor);
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
          for (const event of events) {
            await service().authorize(identity, id, role);
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
          events = await service().events(identity, id, role, cursor);
        }
      } catch (error) {
        if (!controller.signal.aborted && !(error instanceof AccessError))
          app.log.error(error);
      } finally {
        controller.abort();
        reply.sse.close();
        streams.delete(controller);
      }
    },
  );
}
