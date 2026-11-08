import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import {
  ApiError,
  PlayerDeviceRequest,
  PlayerDeviceCode,
  PlayerDeviceStatus,
  PlayerDeviceApproval,
  PLAYER_ICON_MAX_BYTES,
} from "@gestaloka/contracts";
import { AccessError, type WorldAccess } from "@gestaloka/server/access";
import { IdentityError, type OryIdentity } from "@gestaloka/server/identity";
import type { Operations } from "@gestaloka/server/operations";
import { authPage, escapeHtml as escape } from "./auth-page.js";

export async function playerDeviceRoutes(
  instance: FastifyInstance,
  access?: WorldAccess,
  identity?: OryIdentity,
  operations?: Operations,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  const service = () => {
    if (!access || !identity || !operations)
      throw new AccessError(
        503,
        "IDENTITY_NOT_CONFIGURED",
        "認証とプレイを設定してください",
      );
    return access;
  };
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Referrer-Policy", "no-referrer");
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
  app.post(
    "/api/player-devices",
    {
      bodyLimit:
        instance.initialConfig.bodyLimit! +
        4 * Math.ceil(PLAYER_ICON_MAX_BYTES / 3),
      schema: {
        body: PlayerDeviceRequest,
        response: { 200: PlayerDeviceCode, ...errors },
      },
    },
    async (request) => {
      if (request.headers["x-gestaloka-request"] !== "1")
        throw new AccessError(
          403,
          "ORIGIN_REQUIRED",
          "CLIから接続してください",
        );
      const { requestId, worldId, secret, character, icon } = request.body;
      return service().devices.begin(
        requestId,
        worldId,
        secret,
        character,
        icon,
      );
    },
  );
  app.get(
    "/api/player-device",
    { schema: { response: { 200: PlayerDeviceStatus, ...errors } } },
    async (request) => {
      const devices = service().devices;
      return devices.status(await devices.read(request.headers.authorization));
    },
  );
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  const fields = (reply: FastifyReply) => {
    reply.header("Referrer-Policy", "same-origin");
    const csrf = randomBytes(32).toString("hex");
    reply.setCookie("gestaloka_player_form", csrf, {
      path: "/auth/player",
      httpOnly: true,
      secure: reply.request.protocol === "https",
      sameSite: "strict",
      maxAge: 600,
    });
    return `<input type="hidden" name="csrf" value="${csrf}">`;
  };
  const owner = async (request: FastifyRequest) => {
    service();
    if (request.headers.authorization)
      throw new AccessError(
        403,
        "OWNER_LOGIN_REQUIRED",
        "持ち主としてログインしてください",
      );
    const userId = (await identity!.session(request.headers.cookie)).userId;
    await operations!.authorize(userId);
    return userId;
  };
  const Query = z.object({
    code: z
      .string()
      .regex(/^[A-F0-9]{10}$/)
      .optional(),
    before: z.uuid().optional(),
    presetsBefore: z.uuid().optional(),
    invitation: z.string().optional(),
  });
  app.get(
    "/auth/player",
    { schema: { querystring: Query, hide: true } },
    async (request, reply) => {
      let userId: string;
      try {
        userId = await owner(request);
      } catch (error) {
        if (
          error instanceof AccessError &&
          error.code === "REGISTRATION_REQUIRED"
        )
          return reply.redirect(
            `/auth/register?${new URLSearchParams({
              ...(request.query.code ? { player: request.query.code } : {}),
              ...(request.query.invitation
                ? { invitation: request.query.invitation }
                : {}),
            })}`,
          );
        if (error instanceof IdentityError && error.status === 401)
          return reply.redirect(
            `/auth/login?return_to=${encodeURIComponent(`${request.protocol}://${request.headers.host}${request.url}`)}`,
          );
        throw error;
      }
      const devices = service().devices,
        { code, before, presetsBefore } = request.query;
      const csrf = fields(reply);
      if (!code) {
        const page = await devices.list(userId, before);
        return authPage(
          reply,
          "AIへのプレイ許可",
          `<p>許可を解除すると、そのAIは、この村民で遊べなくなります。村民と履歴は残ります。</p>${page.items.map((d) => `<section><p>世界: ${escape(d.world_id)}<br>人物: ${escape(d.actor_id ?? "新規参加")}<br>接続: ${escape(d.user_code)}</p><form method="post" action="/auth/player"><input type="hidden" name="revoke" value="${d.id}">${csrf}<button>許可を解除する</button></form></section>`).join("")}${page.next ? `<a href="?before=${page.next}">次の許可へ</a>` : ""}`,
        );
      }
      const device = await devices.pending(code);
      if (device.user_id) {
        if (device.user_id !== userId)
          throw new AccessError(
            403,
            "PLAYER_DEVICE_DENIED",
            "プレイの許可を確認してください",
          );
        return authPage(
          reply,
          "プレイを許可しました",
          '<p>AIとの会話に戻り、「できた」と伝えてください。続きの準備はAIが進めます。</p><a href="/auth/player">許可を確認・解除する</a>',
        );
      }
      const world = (
        await operations!.catalog(userId, undefined, device.world_id)
      ).items[0];
      if (!world)
        throw new AccessError(404, "WORLD_NOT_FOUND", "世界が見つかりません");
      const people = await service().players.list(
        userId,
        device.world_id,
        before,
      );
      const presets = world.canJoin
        ? await operations!.presets(userId, presetsBefore)
        : { items: [], next: null };
      const choices = people.items
        .filter((p) => p.actorId)
        .map(
          (p) =>
            `<label><input type="radio" name="choice" value="actor:${p.actorId}" required title="${p.actorId}">続きから遊ぶ: ${escape(p.name ?? "名前のない村民")}</label>`,
        )
        .concat(
          presets.items.map(
            (p) =>
              `<label><input type="radio" name="choice" value="preset:${p.id}:${p.version}" required>新規参加: ${escape(p.title)} — ${escape(p.description)}</label>`,
          ),
        );
      if (device.character && world.canJoin)
        choices.unshift(
          `<section><h2>AIが用意した人物</h2>${device.icon ? `<img src="${escape(device.icon)}" width="96" alt="AIが用意した人物のアイコン">` : ""}<p>${escape(device.character).replaceAll("\n", "<br>")}</p><label><input type="radio" name="choice" value="character" checked required>この人物を新しく作って参加する</label></section>`,
        );
      return authPage(
        reply,
        "AIにプレイを許可する",
        `<p>${escape(world.title || world.id)}</p><p>${escape(world.description)}</p><p>AIから届いた確認のことばが <strong>${code}</strong> と同じか確かめてください。</p><p>選んだ村民として遊び、顔の画像を変え、その村民が知っていることを読むのを許可します。新しく参加する場合は、その一人だけに許可します。</p><form method="post" action="/auth/player">${csrf}<input type="hidden" name="code" value="${code}">${choices.join("<br>")}${choices.length ? "<button>この人物のプレイを許可する</button>" : "<p>選択できる人物・参加設定がありません。</p>"}</form>${people.next ? `<a href="?code=${code}&before=${people.next}${presetsBefore ? `&presetsBefore=${presetsBefore}` : ""}">次の人物へ</a>` : ""}${presets.next ? `<a href="?code=${code}&presetsBefore=${presets.next}${before ? `&before=${before}` : ""}">次の参加設定へ</a>` : ""}`,
      );
    },
  );
  app.post<{
    Body: { csrf?: string; code?: string; choice?: string; revoke?: string };
  }>("/auth/player", { schema: { hide: true } }, async (request, reply) => {
    const { csrf, code, choice, revoke } = request.body,
      saved = request.cookies.gestaloka_player_form;
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
    const userId = await owner(request),
      devices = service().devices;
    if (revoke) await devices.revoke(userId, z.uuid().parse(revoke));
    else {
      const [kind, id, version] = (choice ?? "").split(":");
      if (kind !== "actor" && kind !== "preset" && kind !== "character")
        throw new AccessError(409, "INPUT_INVALID", "村民を選んでください");
      await devices.approve(
        userId,
        Query.shape.code.unwrap().parse(code),
        PlayerDeviceApproval.parse(
          kind === "character"
            ? { character: true }
            : kind === "actor"
              ? { actorId: id }
              : { presetId: id, presetVersion: Number(version) },
        ),
      );
    }
    reply.clearCookie("gestaloka_player_form", { path: "/auth/player" });
    return reply.redirect(
      revoke ? "/auth/player" : `/auth/player?code=${code}`,
    );
  });
}
