import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import {
  ApiError,
  Member,
  Operation,
  LegacyClaimPage,
  CatalogPageQuery,
  WorldCatalogPage,
  PlayerPresetPage,
  WorldPlayerPage,
  PlayerIconInput,
  PlayerIcon,
  ResourceId,
  InspectionReadResult,
} from "@gestaloka/contracts";
import { IdentityError, type OryIdentity } from "@gestaloka/server/identity";
import { type Operations } from "@gestaloka/server/operations";
import type { WorldPlayers } from "@gestaloka/server/players";
import { AccessError } from "@gestaloka/server/access";
import type { WorldAccess } from "@gestaloka/server/access";
import { authPage, escapeHtml } from "./auth-page.js";

export async function operationsRoutes(
  instance: FastifyInstance,
  identity?: OryIdentity,
  operations?: Operations,
  players?: WorldPlayers,
  access?: WorldAccess,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const identities = new WeakMap<FastifyRequest, string>();
  const devices = new WeakMap<
    FastifyRequest,
    {
      id: string;
      actor_id: string | null;
      preset_id: string | null;
      character_approved: boolean;
    }
  >();
  app.addHook("onSend", async (request, reply, payload) => {
    const id = identities.get(request);
    if (id) reply.header("X-Gestaloka-Subject", id);
    return payload;
  });
  const service = () => {
    if (!operations || !identity)
      throw new AccessError(
        503,
        "IDENTITY_NOT_CONFIGURED",
        "認証サービスを設定してください",
      );
    return operations;
  };
  const actor = async (request: FastifyRequest) => {
    service();
    if (request.headers.authorization) {
      const operation =
        request.routeOptions.url === "/api/operations" &&
        request.method === "POST";
      const player =
        (request.method === "GET" &&
          [
            "/api/worlds/:id/players",
            "/api/worlds/:id/players/:playerId",
          ].includes(request.routeOptions.url ?? "")) ||
        (request.method === "PUT" &&
          request.routeOptions.url ===
            "/api/worlds/:id/players/:playerId/icon");
      if (!access || (!operation && !player))
        throw new AccessError(
          403,
          "PLAYER_DEVICE_SCOPE",
          "許可されたプレイ操作を指定してください",
        );
      const params = request.params as { id?: string; playerId?: string };
      const device = await access.devices.authorize(
        request.headers.authorization,
        player ? params.id : undefined,
      );
      if (player) {
        if (params.playerId) {
          const selected = (
            await access.players.list(
              device.user_id!,
              device.world_id,
              undefined,
              params.playerId,
            )
          ).items[0];
          if (
            !selected ||
            (device.preset_id || device.character_approved
              ? selected.id !== device.id
              : selected.actorId !== device.actor_id)
          )
            throw new AccessError(
              403,
              "PLAYER_DEVICE_SCOPE",
              "許可された村民を指定してください",
            );
        }
        devices.set(request, device);
        identities.set(request, device.user_id!);
        return device.user_id!;
      }
      const { requestId, command } = request.body as {
        requestId: string;
        command: z.infer<typeof Operation>;
      };
      const joining =
        command.operation === "worlds.join" &&
        requestId === device.id &&
        command.worldId === device.world_id &&
        (device.character_approved
          ? command.character === device.character
          : command.presetId === device.preset_id &&
            command.presetVersion === device.preset_version);
      const resuming =
        command.operation === "worlds.resumeJoin" &&
        command.joinId === device.id &&
        !!(device.preset_id || device.character_approved);
      if (!joining && !resuming)
        throw new AccessError(
          403,
          "PLAYER_DEVICE_SCOPE",
          "許可された参加要求を指定してください",
        );
      identities.set(request, device.user_id!);
      return device.user_id!;
    }
    const id = (await identity!.session(request.headers.cookie)).userId;
    identities.set(request, id);
    return id;
  };
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Referrer-Policy", "no-referrer");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.url.startsWith("/api/") &&
      (request.headers["x-gestaloka-request"] !== "1" ||
        (request.headers.origin &&
          request.headers.origin !==
            `${request.protocol}://${request.headers.host}`))
    )
      throw new AccessError(
        403,
        "ORIGIN_REQUIRED",
        "同じ画面から操作してください",
      );
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AccessError)
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message });
    if (error instanceof IdentityError)
      return reply
        .code(error.status)
        .send({ code: "LOGIN_REQUIRED", message: error.message });
    if (
      typeof error === "object" &&
      error !== null &&
      ("validation" in error || error instanceof z.ZodError)
    )
      return reply
        .code(400)
        .send({ code: "INPUT_INVALID", message: "入力を確認してください" });
    return reply
      .code(500)
      .send({ code: "INTERNAL_ERROR", message: "処理を確認できませんでした" });
  });
  const errors = {
    400: ApiError,
    401: ApiError,
    403: ApiError,
    404: ApiError,
    409: ApiError,
    500: ApiError,
    503: ApiError,
  };
  app.get(
    "/api/account",
    {
      schema: {
        response: {
          200: z.object({
            member: Member.nullable(),
            inviteRequired: z.boolean(),
            bootstrapAvailable: z.boolean(),
          }),
          ...errors,
        },
      },
    },
    async (request) => service().state(await actor(request)),
  );
  app.post(
    "/api/operations",
    {
      schema: {
        body: z.object({ requestId: z.uuid(), command: Operation }).strict(),
        response: {
          200: z.object({
            result: z.union([
              InspectionReadResult.passthrough(),
              z.record(z.string(), z.unknown()),
            ]),
          }),
          ...errors,
        },
      },
    },
    async (request) => ({
      result: await service().execute(
        await actor(request),
        request.body.requestId,
        request.body.command,
        { legacyToken: request.cookies.gestaloka, players },
      ),
    }),
  );
  app.get(
    "/api/catalog/worlds",
    {
      schema: {
        querystring: CatalogPageQuery,
        response: { 200: WorldCatalogPage, ...errors },
      },
    },
    async (request) =>
      service().catalog(await actor(request), request.query.before),
  );
  app.get(
    "/api/catalog/worlds/:id",
    {
      schema: {
        params: ResourceId,
        response: { 200: WorldCatalogPage.shape.items.element, ...errors },
      },
    },
    async (request) => {
      const row = (
        await service().catalog(
          await actor(request),
          undefined,
          request.params.id,
        )
      ).items[0];
      if (!row)
        throw new AccessError(
          404,
          "WORLD_NOT_FOUND",
          "参加できる世界が見つかりません",
        );
      return row;
    },
  );
  app.get(
    "/api/catalog/presets",
    {
      schema: {
        querystring: CatalogPageQuery,
        response: { 200: PlayerPresetPage, ...errors },
      },
    },
    async (request) =>
      service().presets(await actor(request), request.query.before),
  );
  app.get(
    "/api/worlds/:id/players",
    {
      schema: {
        params: ResourceId,
        querystring: CatalogPageQuery,
        response: { 200: WorldPlayerPage, ...errors },
      },
    },
    async (request) => {
      if (!players)
        throw new AccessError(
          503,
          "MODEL_NOT_CONFIGURED",
          "参加処理を設定してください",
        );
      const userId = await actor(request),
        device = devices.get(request);
      return players.list(
        userId,
        request.params.id,
        request.query.before,
        device && (device.preset_id || device.character_approved)
          ? device.id
          : undefined,
        device?.actor_id ?? undefined,
      );
    },
  );
  app.get(
    "/api/worlds/:id/players/:playerId",
    {
      schema: {
        params: z.object({ id: z.uuid(), playerId: z.uuid() }),
        response: {
          200: z.object({
            player: WorldPlayerPage.shape.items.element.nullable(),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      if (!players)
        throw new AccessError(
          503,
          "MODEL_NOT_CONFIGURED",
          "参加処理を設定してください",
        );
      const page = await players.list(
        await actor(request),
        request.params.id,
        undefined,
        request.params.playerId,
      );
      return { player: page.items[0] ?? null };
    },
  );
  app.put(
    "/api/worlds/:id/players/:playerId/icon",
    {
      bodyLimit: 7 * 1024 * 1024,
      schema: {
        params: z.object({ id: z.uuid(), playerId: z.uuid() }),
        body: PlayerIconInput,
        response: { 200: PlayerIcon, ...errors },
      },
    },
    async (request) => {
      if (!players)
        throw new AccessError(
          503,
          "MODEL_NOT_CONFIGURED",
          "参加処理を設定してください",
        );
      return players.setIcon(
        await actor(request),
        request.params.id,
        request.params.playerId,
        request.body.image,
      );
    },
  );
  app.get(
    "/api/account/legacy",
    {
      schema: {
        querystring: z.object({ before: z.uuid().optional() }),
        response: { 200: LegacyClaimPage, ...errors },
      },
    },
    async (request) =>
      service().legacyPreview(
        await actor(request),
        request.cookies.gestaloka,
        request.query.before,
      ),
  );
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  const formCookie = (path: string) =>
    `gestaloka_form_${path.split("/").at(-1)}`;
  const fields = (
    request: FastifyRequest,
    reply: Parameters<typeof authPage>[0],
    path: string,
  ) => {
    const csrf = randomBytes(32).toString("hex");
    reply.header("Referrer-Policy", "same-origin");
    reply.setCookie(formCookie(path), csrf, {
      path,
      httpOnly: true,
      sameSite: "strict",
      secure: request.protocol === "https",
      maxAge: 600,
    });
    return `<input type="hidden" name="requestId" value="${randomUUID()}"><input type="hidden" name="csrf" value="${csrf}">`;
  };
  const form = async (
    request: FastifyRequest,
    reply: Parameters<typeof authPage>[0],
    error = "",
  ) => {
    const { player, invitation } = z
      .object({
        player: z
          .string()
          .regex(/^[A-F0-9]{10}$/)
          .optional(),
        invitation: z.string().optional(),
      })
      .parse(request.method === "POST" ? request.body : request.query);
    const userId = await actor(request);
    const state = await service().state(userId);
    if (player && state.member && !state.member.banned)
      return reply.redirect(`/auth/player?code=${player}`);
    const status = state.member?.banned
      ? "<p>利用が停止されています。</p>"
      : state.member
        ? `<p>${state.member.role === "admin" ? "管理者として" : ""}利用登録済みです。</p><a href="/auth/claim">このブラウザーのデータを引き継ぐ</a>`
        : `${state.bootstrapAvailable ? "<p>最初に利用登録した1人が管理者になります。その後は招待制になります。</p>" : state.inviteRequired ? (player && invitation ? "<p>招待を受け取っています。下の「利用登録する」を押してください。</p>" : "<p>利用登録には招待トークンが必要です。</p>") : "<p>利用登録できます。</p>"}<form method="post">${fields(request, reply, "/auth/register")}${player ? `<input type="hidden" name="player" value="${player}">` : ""}${state.bootstrapAvailable || !state.inviteRequired ? "" : player && invitation ? `<input type="hidden" name="invitation" value="${escapeHtml(invitation)}">` : '<label>招待トークン <input name="invitation" autocomplete="off" required></label>'}<button>利用登録する</button></form>`;
    return authPage(
      reply,
      "利用登録",
      `${player ? "" : `<p>アプリID: ${escapeHtml(userId)}</p>`}${error ? `<p>${escapeHtml(error)}</p>` : ""}${status}`,
    );
  };
  const claimForm = async (
    request: FastifyRequest,
    reply: Parameters<typeof authPage>[0],
    error = "",
  ) => {
    const userId = await actor(request);
    try {
      const { before } = z
        .object({ before: z.uuid().optional() })
        .parse(request.query);
      const page = await service().legacyPreview(
        userId,
        request.cookies.gestaloka,
        before,
      );
      return authPage(
        reply,
        "このブラウザーのデータを引き継ぐ",
        `<p>アプリID: ${escapeHtml(userId)}</p>${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}<p>対象は全${page.total}件の世界です。人物や履歴は保持し、このユーザーで利用できるようにします。管理操作には管理者権限が必要です。</p><ul>${page.items.map((w) => `<li><p>${escapeHtml(w.prompt)}</p><p>世界: ${w.id}${w.actorId ? `<br>操作対象: ${w.actorId}` : ""}</p></li>`).join("")}</ul>${page.next ? `<a href="?before=${page.next}">次の対象を確認</a>` : ""}${before ? '<a href="/auth/claim">先頭へ戻る</a>' : ""}${page.linked ? "<p>引き継ぎ済みです。</p>" : page.total ? `<form method="post" action="/auth/claim">${fields(request, reply, "/auth/claim")}<input type="hidden" name="version" value="${page.version}"><button>全${page.total}件の世界をこのユーザーへ引き継ぐ</button></form>` : "<p>引き継ぐ世界はありません。</p>"}`,
      );
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      return authPage(
        reply.code(error.status),
        "データの引き継ぎ",
        `<p role="alert">${escapeHtml(error.message)}</p><a href="/auth/register">利用登録を確認</a>`,
      );
    }
  };
  for (const [path, render] of [
    ["/auth/register", form],
    ["/auth/claim", claimForm],
  ] as const) {
    app.get(path, { schema: { hide: true } }, async (request, reply) => {
      try {
        return await render(request, reply);
      } catch (error) {
        if (error instanceof IdentityError && error.status === 401)
          return reply.redirect(
            `/auth/login?return_to=${encodeURIComponent(`${request.protocol}://${request.headers.host}${request.url}`)}`,
          );
        throw error;
      }
    });
    app.post<{
      Body: {
        csrf?: string;
        requestId?: string;
        invitation?: string;
        version?: string;
        player?: string;
      };
    }>(path, { schema: { hide: true } }, async (request, reply) => {
      const { csrf, requestId, invitation, version } = request.body,
        saved = request.cookies[formCookie(path)];
      if (
        !csrf ||
        !saved ||
        Buffer.byteLength(csrf) !== Buffer.byteLength(saved) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(saved)) ||
        (request.headers.origin &&
          request.headers.origin !==
            `${request.protocol}://${request.headers.host}`)
      )
        throw new AccessError(
          403,
          "ORIGIN_REQUIRED",
          "同じ画面から操作してください",
        );
      try {
        await service().execute(
          await actor(request),
          z.uuid().parse(requestId),
          path === "/auth/claim"
            ? {
                operation: "account.claim",
                version: LegacyClaimPage.shape.version.parse(version),
              }
            : {
                operation: "account.register",
                ...(invitation?.trim()
                  ? { invitation: invitation.trim() }
                  : {}),
              },
          { legacyToken: request.cookies.gestaloka },
        );
      } catch (error) {
        if (error instanceof AccessError)
          return render(
            request,
            reply.code(error.status),
            request.body.player && error.code === "INVITATION_REQUIRED"
              ? "この招待では登録できませんでした。招待を送った人に確認してください。"
              : error.message,
          );
        throw error;
      }
      const player = request.body.player;
      return reply.redirect(
        path === "/auth/register" && player
          ? `/auth/player?code=${z
              .string()
              .regex(/^[A-F0-9]{10}$/)
              .parse(player)}`
          : path,
      );
    });
  }
}
