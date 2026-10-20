import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { IdentityError, type OryIdentity } from "@gestaloka/server/identity";
import { authPage, escapeHtml as escape } from "./auth-page.js";

export async function oauthRoutes(
  app: FastifyInstance,
  identity: OryIdentity,
  adminUrl: string,
) {
  const hydra = async <T>(
    path: string,
    challenge: string,
    body?: object,
  ): Promise<T> => {
    const url = new URL(
      `admin/oauth2/auth/requests/${path}`,
      `${adminUrl.replace(/\/$/, "")}/`,
    );
    url.searchParams.set(`${path.split("/")[0]}_challenge`, challenge);
    const response = await fetch(url, {
      method: body ? "PUT" : "GET",
      ...(body
        ? {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }
        : {}),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new IdentityError(response.status < 500 ? 401 : 503);
    return (await response.json()) as T;
  };
  app.get<{ Querystring: { login_challenge?: string } }>(
    "/auth/oauth/login",
    async (request, reply) => {
      const challenge = request.query.login_challenge;
      if (!challenge) throw new IdentityError(401);
      await hydra("login", challenge);
      let session;
      try {
        session = await identity.session(request.headers.cookie);
      } catch (error) {
        if (!(error instanceof IdentityError) || error.status !== 401)
          throw error;
        const url = new URL(
          "self-service/login/browser",
          `${identity.publicUrl.replace(/\/$/, "")}/`,
        );
        url.searchParams.set(
          "return_to",
          `${request.protocol}://${request.headers.host}/auth/oauth/login?login_challenge=${encodeURIComponent(challenge)}`,
        );
        return reply.redirect(url.toString());
      }
      const accepted = await hydra<{ redirect_to: string }>(
        "login/accept",
        challenge,
        {
          subject: session.userId,
          identity_provider_session_id: session.sessionId,
          remember: false,
        },
      );
      return reply.redirect(accepted.redirect_to);
    },
  );
  const consent = async (cookie: string | undefined, challenge: string) => {
    const session = await identity.session(cookie);
    const data = await hydra<{
      subject: string;
      request_url: string;
      requested_scope: string[];
      requested_access_token_audience: string[];
      client: { client_name?: string; client_id: string };
    }>("consent", challenge);
    if (data.subject !== session.userId) throw new IdentityError(401);
    return data;
  };
  app.get<{ Querystring: { consent_challenge?: string } }>(
    "/auth/oauth/consent",
    async (request, reply) => {
      const challenge = request.query.consent_challenge;
      if (!challenge) throw new IdentityError(401);
      const data = await consent(request.headers.cookie, challenge);
      const requestUrl = new URL(data.request_url);
      const callback = new URL(requestUrl.searchParams.get("redirect_uri")!);
      const formSources = `'self' ${requestUrl.origin} ${callback.origin === "null" ? callback.protocol : callback.origin}`;
      const csrf = randomBytes(32).toString("hex");
      reply.setCookie("gestaloka_consent", csrf, {
        path: "/auth/oauth/consent",
        httpOnly: true,
        secure: request.protocol === "https",
        sameSite: "strict",
        maxAge: 600,
      });
      return authPage(
        reply,
        "アクセスの許可",
        `<p>${escape(data.client.client_name ?? data.client.client_id)}</p><p>要求する権限: ${escape(data.requested_scope.join(", "))}</p><form method="post"><input type="hidden" name="challenge" value="${escape(challenge)}"><input type="hidden" name="csrf" value="${csrf}"><button name="decision" value="accept">許可する</button><button name="decision" value="reject">拒否する</button></form>`,
        formSources,
      );
    },
  );
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  app.post<{ Body: { challenge?: string; csrf?: string; decision?: string } }>(
    "/auth/oauth/consent",
    async (request, reply) => {
      const { challenge, csrf, decision } = request.body;
      const saved = request.cookies.gestaloka_consent;
      if (
        !challenge ||
        !csrf ||
        !saved ||
        Buffer.byteLength(csrf) !== Buffer.byteLength(saved) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(saved)) ||
        !["accept", "reject"].includes(decision ?? "")
      )
        throw new IdentityError(401);
      const data = await consent(request.headers.cookie, challenge);
      const result = await hydra<{ redirect_to: string }>(
        `consent/${decision}`,
        challenge,
        decision === "accept"
          ? {
              grant_scope: data.requested_scope,
              grant_access_token_audience: data.requested_access_token_audience,
              remember: false,
            }
          : {
              error: "access_denied",
              error_description: "The user declined consent.",
            },
      );
      reply.clearCookie("gestaloka_consent", { path: "/auth/oauth/consent" });
      return reply.redirect(result.redirect_to);
    },
  );
  app.get<{ Querystring: { logout_challenge?: string } }>(
    "/auth/oauth/logout",
    async (request, reply) => {
      const challenge = request.query.logout_challenge;
      if (!challenge) throw new IdentityError(401);
      const session = await identity.session(request.headers.cookie);
      const logout = await hydra<{ subject: string }>("logout", challenge);
      if (logout.subject !== session.userId) throw new IdentityError(401);
      const result = await hydra<{ redirect_to: string }>(
        "logout/accept",
        challenge,
        {},
      );
      return reply.redirect(result.redirect_to);
    },
  );
}
