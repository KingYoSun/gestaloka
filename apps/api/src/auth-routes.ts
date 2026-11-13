import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Operations } from "@gestaloka/server/operations";
import { IdentityError, type OryIdentity } from "@gestaloka/server/identity";
import { oauthRoutes } from "./oauth-routes.js";
import { authPage, authStyle, escapeHtml as escape } from "./auth-page.js";
import { BrowserSession } from "@gestaloka/contracts";
import { AccessError } from "@gestaloka/server/access";

type Message = { id?: number; text: string };
const passwordErrors: Record<number, string> = {
  4000006: "IDまたはパスワードを確認してください。",
  4000007: "このIDはすでに使われています。別のIDを選んでください。",
  4000028: "このIDはすでに使われています。別のIDを選んでください。",
  4000031: "IDに似たパスワードは使えません。",
  4000032: "パスワードは15文字以上で入力してください。",
  4000034: "流出が確認されたパスワードです。別のパスワードを選んでください。",
};

export async function authRoutes(
  app: FastifyInstance,
  identity: OryIdentity,
  hydraAdminUrl?: string,
  operations?: Operations,
) {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
  });
  app.setErrorHandler((error, _request, reply) => {
    if (
      error instanceof Error &&
      "statusCode" in error &&
      error.statusCode === 429
    )
      return reply
        .code(429)
        .send("しばらく待ってから、もう一度お試しください。");
    if (error instanceof AccessError)
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message });
    const status = error instanceof IdentityError ? error.status : 503;
    return reply.code(status).send({
      code: status === 401 ? "LOGIN_REQUIRED" : "IDENTITY_UNAVAILABLE",
      message:
        status === 401
          ? "ログインしてください"
          : "認証サービスに接続できません",
    });
  });
  await app.register(rateLimit, { global: false });
  app.get(
    "/internal/auth/attempt",
    {
      schema: { hide: true },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (_request, reply) => reply.code(204).send(),
  );
  app.post(
    "/internal/auth/invitation",
    { schema: { hide: true } },
    async (request, reply) => {
      const { requestUrl } = request.body as { requestUrl?: string };
      const target =
        requestUrl && URL.canParse(requestUrl)
          ? new URL(requestUrl).searchParams.get("return_to")
          : null;
      const token =
        target && URL.canParse(target)
          ? new URL(target).searchParams.get("invitation")
          : null;
      if (token && (await operations?.hasInvitation(token)))
        return reply.code(204).send();
      return reply.code(403).send({
        messages: [
          {
            instance_ptr: "#/",
            messages: [
              {
                id: 1,
                type: "error",
                text: "この招待では登録できません。招待を送った人に確認してください。",
              },
            ],
          },
        ],
      });
    },
  );
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
  app.get("/auth/link", async (request, reply) => {
    const url = new URL(
      "self-service/login/browser",
      `${identity.publicUrl.replace(/\/$/, "")}/`,
    );
    url.searchParams.set("refresh", "true");
    url.searchParams.set(
      "return_to",
      `${request.protocol}://${request.headers.host}/auth/settings`,
    );
    return reply.redirect(url.toString());
  });
  for (const kind of ["login", "registration", "settings"] as const) {
    app.get<{
      Querystring: { flow?: string; return_to?: string; invitation?: string };
    }>(`/auth/${kind}`, async (request, reply) => {
      const { flow, return_to } = request.query;
      const base = identity.publicUrl.replace(/\/$/, "");
      if (!flow) {
        const url = new URL(`${base}/self-service/${kind}/browser`);
        if (return_to) url.searchParams.set("return_to", return_to);
        if (kind === "registration") {
          const origin = `${request.protocol}://${request.headers.host}`;
          const target =
            return_to && URL.canParse(return_to)
              ? new URL(return_to)
              : new URL("/auth/register", origin);
          if (
            target.origin !== origin ||
            !["/auth/player", "/auth/register"].includes(target.pathname)
          )
            return authPage(
              reply.code(400),
              "招待コードで登録",
              "<p>招待の案内から開き直してください。</p>",
            );
          if (request.query.invitation)
            target.searchParams.set("invitation", request.query.invitation);
          if (!target.searchParams.get("invitation"))
            return authPage(
              reply,
              "招待コードで登録",
              `<form method="get"><input type="hidden" name="return_to" value="${escape(target.href)}"><label>招待コード<input name="invitation" required></label><button>次へ</button></form>`,
            );
          url.searchParams.set("return_to", target.href);
        }
        return reply.redirect(url.toString());
      }
      const response = await identity.transport(
        `${identity.internalUrl.replace(/\/$/, "")}/self-service/${kind}/flows?id=${encodeURIComponent(flow)}`,
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
        return_to?: string;
        refresh?: boolean;
        ui: {
          action: string;
          messages?: Message[];
          nodes: {
            messages?: Message[];
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
      const button = kind === "settings" ? "link" : "provider";
      const { nodes, action } = data.ui;
      const csrf = nodes.find((n) => n.attributes.name === "csrf_token");
      const token = csrf
        ? `<input type="hidden" name="csrf_token" value="${escape(csrf.attributes.value)}">`
        : "";
      const providers = nodes
        .filter((n) => n.attributes.name === button)
        .map(
          ({ attributes: a, meta }) =>
            `<button name="${button}" value="${escape(a.value)}"${a.disabled ? " disabled" : ""}>${escape(meta?.label?.text ?? a.value)}</button>`,
        )
        .join("\n");
      const form = (fields: string) =>
        `<form action="${escape(action)}" method="post">${token}${fields}</form>`;
      const registering = kind === "registration";
      const identifier = registering ? "traits.username" : "identifier";
      const id = nodes.find((n) => n.attributes.name === identifier);
      let password = "";
      if (
        kind !== "settings" &&
        id &&
        nodes.some((n) => n.attributes.name === "password")
      ) {
        password = form(
          `<label>ログインID<input name="${identifier}" value="${escape(id.attributes.value ?? "")}" autocomplete="username" required></label><label>${registering ? "パスワード（15文字以上）" : "パスワード"}<input type="password" name="password" autocomplete="${registering ? "new-password" : "current-password"}"${registering ? ' minlength="15"' : ""} required></label><button name="method" value="password">${registering ? "IDを作成する" : "IDでログイン"}</button>`,
        );
        if (!registering && !data.refresh) {
          const query = new URLSearchParams({
            return_to:
              data.return_to ||
              `${request.protocol}://${request.headers.host}/auth/register`,
          });
          password += `<p><a href="/auth/registration?${escape(query.toString())}">招待コードで新しいIDを作る</a></p>`;
        }
      }
      return authPage(
        reply,
        kind === "settings"
          ? "ログイン方法の追加"
          : registering
            ? "招待コードで登録"
            : "ログイン",
        [...(data.ui.messages ?? []), ...nodes.flatMap((n) => n.messages ?? [])]
          .map(
            (m) =>
              `<p role="alert">${escape((password && m.id && passwordErrors[m.id]) || m.text)}</p>`,
          )
          .join("") +
          (providers
            ? form(
                (kind === "settings"
                  ? '<input type="hidden" name="method" value="oidc">'
                  : "") + providers,
              )
            : kind === "settings"
              ? "<p>追加できるログイン方法はありません。</p>"
              : "") +
          password,
        `'self' ${new URL(base).origin} https://accounts.google.com https://api.twitter.com https://api.x.com https://twitter.com https://x.com`,
      );
    });
  }
  app.get("/auth/logout", async (request, reply) => {
    await identity.session(request.headers.cookie);
    const response = await identity.transport(
      new URL(
        "self-service/logout/browser",
        `${identity.internalUrl.replace(/\/$/, "")}/`,
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
  if (hydraAdminUrl)
    await oauthRoutes(app, identity, hydraAdminUrl, operations);
}
