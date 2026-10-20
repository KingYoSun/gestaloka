import type { FastifyReply } from "fastify";

export const escapeHtml = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function authPage(
  reply: FastifyReply,
  title: string,
  body: string,
  formOrigin = "'self'",
) {
  reply.header(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'self'; form-action ${formOrigin}; base-uri 'none'; frame-ancestors 'none'`,
  );
  return reply
    .type("text/html")
    .send(
      `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — GESTALOKA</title><link rel="stylesheet" href="/auth/style.css"></head><body><main><p>GESTALOKA</p><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`,
    );
}

export const authStyle = `:root { --cream: #f2eadf; --paper: #f8f2e8; --navy: #0b2034; --gold: #c6922e; --focus: #7bcfd0; }
body { margin: 0; background: var(--cream); color: var(--navy); font: 16px/1.7 "Helvetica Neue", "Hiragino Sans", Arial, "Noto Sans JP", Meiryo, sans-serif; }
main { max-width: 720px; margin: 48px auto; padding: 24px; }
form { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 24px; }
button { padding: 12px 24px; border: 1px solid var(--gold); border-radius: 8px; background: var(--paper); color: var(--navy); font: inherit; cursor: pointer; }
button:first-of-type { background: var(--gold); }
button:focus-visible, a:focus-visible { outline: 3px solid var(--focus); outline-offset: 4px; }
a { color: var(--navy); }
@media (max-width: 640px) { main { margin: 24px auto; padding: 16px; } }`;
