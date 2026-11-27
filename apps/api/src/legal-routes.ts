import { randomUUID } from "node:crypto";
import { Signer } from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { IdentityError, type OryIdentity } from "@gestaloka/server/identity";
import {
  beginRegistrationConsent,
  legalConfigured,
  legalContact,
  legalEdition,
  legalVersion,
  privacy,
  recordLegalConsent,
  terms,
} from "@gestaloka/server/legal";
import { AccessError } from "@gestaloka/server/access";
import type { Operations } from "@gestaloka/server/operations";
import { authPage, escapeHtml as escape } from "./auth-page.js";

export const registrationCookie = "gestaloka_registration_consent";
const documents = [
  { path: "terms", title: "利用規約", text: terms },
  { path: "privacy", title: "プライバシーポリシー", text: privacy },
];
const edition = legalConfigured
  ? `<p class="legal-edition"><span>適用開始日 <time datetime="${legalEdition}">${legalEdition}</time></span><span>版 ${legalVersion}</span></p>`
  : '<p role="status">運営者名と問い合わせ先を設定中です。両方がそろうまで同意の受付を休止しています。接続と通知の読み取りは利用できます。</p>';
function articles(text: string, heading = "h3") {
  const contactUrl = /^https?:\/\//i.test(legalContact)
    ? legalContact
    : /^[^\s@]+@[^\s@]+$/.test(legalContact)
      ? "mailto:" + legalContact
      : null;
  return text
    .split("\n\n")
    .map((section) => {
      const [title, ...paragraphs] = section.split("\n");
      const body = paragraphs
        .map((p) => {
          if (p === "問い合わせ先 " + legalContact && contactUrl)
            return `<p>問い合わせ先 <a href="${escape(contactUrl)}">${escape(legalContact)}</a></p>`;
          return `<p>${escape(p)}</p>`;
        })
        .join("");
      return `<${heading}>${escape(title)}</${heading}>${body}`;
    })
    .join("");
}
export const legalPageUrl = (next: string) =>
  "/auth/legal?" + new URLSearchParams({ next });
export function accessMessage(request: FastifyRequest, error: AccessError) {
  return error.code === "LEGAL_CONSENT_REQUIRED"
    ? `${error.message} 持ち主に ${request.protocol}://${request.headers.host}/auth/legal を渡してください。`
    : error.message;
}
function continuation(value?: string) {
  const base = "https://local.invalid";
  const url = URL.parse(value ?? "", base);
  return url?.origin === base &&
    ["/auth/registration", "/auth/register"].includes(url.pathname)
    ? url
    : null;
}

export function legalRoutes(
  app: FastifyInstance,
  identity: OryIdentity,
  operations?: Operations,
) {
  for (const doc of documents)
    app.get(
      "/auth/" + doc.path,
      { schema: { hide: true } },
      async (_request, reply) =>
        authPage(reply, doc.title, edition + articles(doc.text, "h2")),
    );

  const signer = operations && new Signer(operations.tokenSecret);
  const owner = async (request: FastifyRequest, registering: boolean) => {
    if (request.headers.authorization)
      throw new AccessError(
        403,
        "OWNER_LOGIN_REQUIRED",
        "持ち主がブラウザーで同意してください。",
      );
    return registering
      ? "registration"
      : (await identity.session(request.headers.cookie)).userId;
  };
  const options = (request: FastifyRequest) => ({
    httpOnly: true,
    secure: request.protocol === "https",
    sameSite: "strict" as const,
    path: "/auth/legal",
    maxAge: 1800,
  });
  const sections = documents
    .map(
      ({ path, title, text }) =>
        `<h2 id="${path}">${title}</h2><section class="legal-scroll" tabindex="0" aria-labelledby="${path}">${articles(text)}</section><a href="/auth/${path}" target="_blank" rel="noopener">${title}を別のページで読む</a>`,
    )
    .join("");
  const pending = (reply: FastifyReply) =>
    authPage(reply, "同意の受付を準備しています", edition + sections);
  const page = (
    request: FastifyRequest,
    reply: FastifyReply,
    subject: string,
    message = "",
  ) => {
    if (!signer) throw new IdentityError(503);
    const csrf = randomUUID();
    reply.header("Referrer-Policy", "same-origin");
    reply.setCookie(
      "gestaloka_legal_form",
      signer.sign(`legal:${subject}:${csrf}`),
      options(request),
    );
    return authPage(
      reply,
      "利用規約とプライバシーポリシーへの同意",
      edition +
        sections +
        (message ? `<p role="alert">${escape(message)}</p>` : "") +
        `<p>運営者は、プレイログ及びSTORIESの文章・画像を、公式サイトやSNSなどでゲームの紹介に利用します（利用規約第5条）。</p><form method="post" class="legal-form"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="version" value="${legalVersion}"><label><input type="checkbox" name="agree" value="yes" required> 利用規約及びプライバシーポリシーに同意します</label><button>同意して進む</button></form>`,
      `'self' ${new URL(identity.publicUrl).origin}`,
    );
  };
  type Query = { next?: string };
  app.get<{ Querystring: Query }>(
    "/auth/legal",
    { schema: { hide: true } },
    async (request, reply) => {
      if (!legalConfigured) return pending(reply);
      const next = continuation(request.query.next);
      try {
        return page(
          request,
          reply,
          await owner(request, next?.pathname === "/auth/registration"),
        );
      } catch (error) {
        if (!(error instanceof IdentityError) || error.status !== 401)
          throw error;
        const back = `${request.protocol}://${request.headers.host}${request.url}`;
        return reply.redirect(
          "/auth/login?" + new URLSearchParams({ return_to: back }),
        );
      }
    },
  );
  app.post<{
    Querystring: Query;
    Body: { csrf?: string; version?: string; agree?: string };
  }>("/auth/legal", { schema: { hide: true } }, async (request, reply) => {
    if (!legalConfigured) return pending(reply.code(503));
    if (!signer || !operations) throw new IdentityError(503);
    const next = continuation(request.query.next);
    const registering = next?.pathname === "/auth/registration";
    const subject = await owner(request, registering);
    const { csrf, version, agree } = request.body ?? {};
    const saved = signer.unsign(request.cookies.gestaloka_legal_form ?? "");
    if (
      !csrf ||
      !saved.valid ||
      saved.value !== `legal:${subject}:${csrf}` ||
      (request.headers.origin &&
        request.headers.origin !==
          `${request.protocol}://${request.headers.host}`)
    )
      throw new AccessError(
        403,
        "ORIGIN_REQUIRED",
        "本人の同意ページを開き直してください。",
      );
    if (version !== legalVersion || agree !== "yes")
      return page(
        request,
        reply.code(version !== legalVersion ? 409 : 400),
        subject,
        version !== legalVersion
          ? "文書が改定されました。最新版をご確認ください。"
          : "続行するには両方の文書への同意が必要です。",
      );
    if (registering)
      reply.setCookie(
        registrationCookie,
        await beginRegistrationConsent(operations.pool),
        { ...options(request), path: "/", sameSite: "lax" },
      );
    else await recordLegalConsent(operations.pool, subject);
    reply.clearCookie("gestaloka_legal_form", { path: "/auth/legal" });
    if (next) return reply.redirect(next.pathname + next.search, 303);
    return authPage(
      reply,
      "同意を記録しました",
      edition +
        '<p>同じアカウントでプレイを再開できます。AIをお使いの方は、AIに同意が済んだことをお知らせください。</p><a href="/auth/register">ゲームへ戻る</a>',
    );
  });
}
