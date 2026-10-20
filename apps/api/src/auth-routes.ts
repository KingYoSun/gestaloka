import type { FastifyInstance } from "fastify";
import { IdentityError, type OryIdentity } from "@gestaloka/server/identity";
import { oauthRoutes } from "./oauth-routes.js";
import { authPage, authStyle, escapeHtml as escape } from "./auth-page.js";
import { BrowserSession } from "@gestaloka/contracts";

export async function authRoutes(
  app: FastifyInstance,
  identity: OryIdentity,
  hydraAdminUrl?: string,
) {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof IdentityError ? error.status : 503;
    return reply.code(status).send({
      code: status === 401 ? "LOGIN_REQUIRED" : "IDENTITY_UNAVAILABLE",
      message:
        status === 401
          ? "ログインしてください"
          : "認証サービスに接続できません",
    });
  });
  app.get(
    "/auth/session",
    { schema: { response: { 200: BrowserSession } } },
    async (request) => ({
      id: (await identity.session(request.headers.cookie)).userId,
    }),
  );
  app.get("/auth/style.css", async (_request, reply) =>
    reply.type("text/css").send(authStyle),
  );
  for (const kind of ["login", "registration"] as const) {
    app.get<{ Querystring: { flow?: string; return_to?: string } }>(
      `/auth/${kind}`,
      async (request, reply) => {
        const { flow, return_to } = request.query;
        const base = identity.publicUrl.replace(/\/$/, "");
        if (!flow) {
          const url = new URL(`${base}/self-service/${kind}/browser`);
          if (return_to) url.searchParams.set("return_to", return_to);
          return reply.redirect(url.toString());
        }
        const response = await identity.transport(
          `${base}/self-service/${kind}/flows?id=${encodeURIComponent(flow)}`,
          {
            headers: {
              cookie: request.headers.cookie ?? "",
              accept: "application/json",
            },
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!response.ok)
          return authPage(
            reply.code(410),
            "ログイン",
            `<p>ログインを開始し直してください。</p><a href="/auth/${kind}">やり直す</a>`,
          );
        const data = (await response.json()) as {
          ui: {
            action: string;
            nodes: {
              attributes: {
                name?: string;
                type?: string;
                value?: string;
                disabled?: boolean;
              };
              meta?: { label?: { text?: string } };
            }[];
          };
        };
        const inputs = data.ui.nodes
          .filter(
            ({ attributes: a }) =>
              a.name === "csrf_token" || a.name === "provider",
          )
          .map(({ attributes: a, meta }) =>
            a.name === "csrf_token"
              ? `<input type="hidden" name="csrf_token" value="${escape(a.value)}">`
              : `<button name="provider" value="${escape(a.value)}"${a.disabled ? " disabled" : ""}>${escape(meta?.label?.text ?? a.value)}</button>`,
          )
          .join("\n");
        const hasProvider = data.ui.nodes.some(
          ({ attributes: a }) => a.name === "provider",
        );
        return authPage(
          reply,
          "ログイン",
          hasProvider
            ? `<form action="${escape(data.ui.action)}" method="post">${inputs}</form>`
            : "<p>ソーシャルログインの接続設定が必要です。</p>",
          `${new URL(base).origin} https://accounts.google.com https://api.twitter.com https://api.x.com https://twitter.com https://x.com`,
        );
      },
    );
  }
  app.get("/auth/logout", async (request, reply) => {
    await identity.session(request.headers.cookie);
    const response = await identity.transport(
      new URL(
        "self-service/logout/browser",
        `${identity.publicUrl.replace(/\/$/, "")}/`,
      ),
      {
        headers: {
          cookie: request.headers.cookie ?? "",
          accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new IdentityError(503);
    const { logout_url } = (await response.json()) as { logout_url: string };
    return reply.redirect(logout_url);
  });
  app.get("/auth/error", async (_request, reply) =>
    authPage(
      reply.code(400),
      "ログイン",
      '<p>ログインできませんでした。</p><a href="/auth/login">やり直す</a>',
    ),
  );
  if (hydraAdminUrl) await oauthRoutes(app, identity, hydraAdminUrl);
}
