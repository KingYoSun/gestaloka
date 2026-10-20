import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import { ApiError, Member, Operation } from "@gestaloka/contracts";
import { IdentityError, type OryIdentity } from "@gestaloka/server/identity";
import { type Operations } from "@gestaloka/server/operations";
import { AccessError } from "@gestaloka/server/access";
import { authPage, escapeHtml } from "./auth-page.js";

export async function operationsRoutes(
  instance: FastifyInstance,
  identity?: OryIdentity,
  operations?: Operations,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
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
    return (await identity!.session(request.headers.cookie)).userId;
  };
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Referrer-Policy", "no-referrer");
    if (
      request.method === "POST" &&
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
          200: z.object({ result: z.record(z.string(), z.unknown()) }),
          ...errors,
        },
      },
    },
    async (request) => ({
      result: await service().execute(
        await actor(request),
        request.body.requestId,
        request.body.command,
      ),
    }),
  );
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  const form = async (
    request: FastifyRequest,
    reply: Parameters<typeof authPage>[0],
    error = "",
  ) => {
    const userId = await actor(request);
    const state = await service().state(userId);
    const csrf = randomBytes(32).toString("hex");
    reply.header("Referrer-Policy", "same-origin");
    reply.setCookie("gestaloka_registration", csrf, {
      path: "/auth/register",
      httpOnly: true,
      sameSite: "strict",
      secure: request.protocol === "https",
      maxAge: 600,
    });
    const status = state.member?.banned
      ? "<p>利用が停止されています。</p>"
      : state.member
        ? `<p>${state.member.role === "admin" ? "管理者として" : ""}利用登録済みです。</p>`
        : `${state.bootstrapAvailable ? "<p>最初に利用登録した1人が管理者になります。その後は招待制になります。</p>" : state.inviteRequired ? "<p>利用登録には招待トークンが必要です。</p>" : "<p>利用登録できます。</p>"}<form method="post"><input type="hidden" name="requestId" value="${randomUUID()}"><input type="hidden" name="csrf" value="${csrf}">${state.bootstrapAvailable || !state.inviteRequired ? "" : '<label>招待トークン <input name="invitation" autocomplete="off" required></label>'}<button>利用登録する</button></form>`;
    return authPage(
      reply,
      "利用登録",
      `<p>アプリID: ${escapeHtml(userId)}</p>${error ? `<p>${escapeHtml(error)}</p>` : ""}${status}`,
    );
  };
  app.get(
    "/auth/register",
    { schema: { hide: true } },
    async (request, reply) => {
      try {
        return await form(request, reply);
      } catch (error) {
        if (error instanceof IdentityError && error.status === 401)
          return reply.redirect(
            `/auth/login?return_to=${encodeURIComponent(`${request.protocol}://${request.headers.host}/auth/register`)}`,
          );
        throw error;
      }
    },
  );
  app.post<{
    Body: { csrf?: string; requestId?: string; invitation?: string };
  }>("/auth/register", { schema: { hide: true } }, async (request, reply) => {
    const { csrf, requestId, invitation } = request.body,
      saved = request.cookies.gestaloka_registration;
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
      await service().execute(await actor(request), z.uuid().parse(requestId), {
        operation: "account.register",
        ...(invitation?.trim() ? { invitation: invitation.trim() } : {}),
      });
    } catch (error) {
      if (error instanceof AccessError)
        return form(request, reply.code(error.status), error.message);
      throw error;
    }
    return reply.redirect("/auth/register");
  });
}
