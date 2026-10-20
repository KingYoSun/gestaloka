import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { IdentityError, OryIdentity } from "@gestaloka/server/identity";
import { createApp } from "../../apps/api/src/app.js";

const databases = connectDatabases();
const identityId = randomUUID();
const sessionId = randomUUID();
const base = "http://identity.invalid";
const valid = () => ({
  id: sessionId,
  active: true,
  expires_at: new Date(Date.now() + 60000).toISOString(),
  identity: { id: identityId, state: "active", traits: { role: "admin" } },
});
const replies: unknown[] = [];
const received: { url: string; cookie: string | null }[] = [];
const identity = new OryIdentity(
  databases.postgres,
  base,
  async (input, options) => {
    received.push({
      url: String(input),
      cookie: new Headers(options?.headers).get("cookie"),
    });
    const data = replies.shift() ?? valid();
    return data instanceof Response ? data : Response.json(data);
  },
);
beforeAll(() => identity.setup());
afterAll(async () => {
  await databases.postgres.query("DELETE FROM app_identity WHERE ory_id=$1", [
    identityId,
  ]);
  await databases.close();
});

test("同じOry Identityへの同時要求・別セッション・接続し直しで同じアプリIDを保ち、traitsの権限を捨てる", async () => {
  const users = await Promise.all(
    Array.from({ length: 8 }, () =>
      identity.session("ory_kratos_session=verified"),
    ),
  );
  expect(new Set(users.map((s) => s.userId)).size).toBe(1);
  expect(users[0]).toEqual({
    userId: expect.any(String),
    sessionId,
    identityId,
  });
  replies.push({ ...valid(), id: randomUUID() });
  const another = new OryIdentity(databases.postgres, base, identity.transport);
  expect((await another.session("ory_kratos_session=another")).userId).toBe(
    users[0]!.userId,
  );
  expect(received[0]).toEqual({
    url: `${base}/sessions/whoami`,
    cookie: "ory_kratos_session=verified",
  });
});

test("未認証・期限切れ・失効・無効IdentityをAPIで拒否し、認証障害を認証成功に変えない", async () => {
  const app = await createApp(undefined, identity);
  try {
    expect((await app.inject("/auth/session")).statusCode).toBe(401);
    for (const data of [
      new Response(null, { status: 401 }),
      { ...valid(), active: false },
      { ...valid(), expires_at: "2000-01-01T00:00:00Z" },
      { ...valid(), identity: { id: identityId, state: "inactive" } },
    ]) {
      replies.push(data);
      const response = await app.inject({
        url: "/auth/session",
        headers: { cookie: "ory_kratos_session=rejected" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    replies.push(new Response("PRIVATE_UPSTREAM_SECRET", { status: 500 }));
    const response = await app.inject({
      url: "/auth/session",
      headers: { cookie: "ory_kratos_session=rejected" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("PRIVATE_UPSTREAM_SECRET");
  } finally {
    await app.close();
  }
});

test("ブラウザーフローへ遷移し、CSRFとProvider以外をフォームに写さずHTMLをエスケープする", async () => {
  const app = await createApp(undefined, identity);
  try {
    const start = await app.inject(
      "/auth/login?return_to=http%3A%2F%2Fapp.invalid%2F",
    );
    expect(start.headers.location).toBe(
      `${base}/self-service/login/browser?return_to=http%3A%2F%2Fapp.invalid%2F`,
    );
    replies.push({
      ui: {
        action: `${base}/self-service/login?flow=example`,
        nodes: [
          { attributes: { name: "csrf_token", value: 'token"<script>' } },
          {
            attributes: { name: "provider", value: "google" },
            meta: { label: { text: "Googleでログイン" } },
          },
          { attributes: { name: "role", value: "admin" } },
        ],
      },
    });
    const form = await app.inject("/auth/login?flow=example");
    expect(form.body).toContain("Googleでログイン");
    expect(form.body).toContain("token&quot;&lt;script&gt;");
    expect(form.body).not.toContain('name="role"');
    expect(form.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
  } finally {
    await app.close();
  }
});

test("認証通信失敗を上流の秘密値を含まない503に変える", async () => {
  const unavailable = new OryIdentity(databases.postgres, base, async () => {
    throw new Error("PRIVATE_CONNECTION_SECRET");
  });
  await expect(unavailable.session("session=example")).rejects.toEqual(
    new IdentityError(503),
  );
});

test("ログイン方法の追加は再認証へ誘導し、OryのlinkとCSRFだけを送る", async () => {
  const app = await createApp(undefined, identity);
  try {
    const start = await app.inject("/auth/link");
    const target = new URL(String(start.headers.location));
    expect(target.pathname).toBe("/self-service/login/browser");
    expect(target.searchParams.get("refresh")).toBe("true");
    expect(target.searchParams.get("return_to")).toBe(
      "http://localhost:80/auth/settings",
    );
    replies.push({
      ui: {
        action: `${base}/self-service/settings?flow=linking`,
        messages: [{ text: "<安全に表示>" }],
        nodes: [
          { attributes: { name: "csrf_token", value: "verified-token" } },
          { attributes: { name: "link", value: "twitter" } },
          { attributes: { name: "unlink", value: "google" } },
          { attributes: { name: "traits.name", value: "hidden" } },
        ],
      },
    });
    const response = await app.inject("/auth/settings?flow=linking");
    expect(response.body).toContain('name="link" value="twitter"');
    expect(response.body).toContain('name="method" value="oidc"');
    expect(response.body).toContain("&lt;安全に表示&gt;");
    expect(response.body).not.toContain('name="unlink"');
    expect(response.body).not.toContain('name="traits.name"');
  } finally {
    await app.close();
  }
});
