import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, expect, test } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { OryIdentity } from "@gestaloka/server/identity";
import { createApp } from "../../apps/api/src/app.js";

const kratos = "http://127.0.0.1:24433";
const kratosAdmin = "http://127.0.0.1:24434";
const hydra = "http://127.0.0.1:24444";
const hydraAdmin = "http://127.0.0.1:24445";
const databases = connectDatabases();
const request = (url: string, options: RequestInit = {}) =>
  fetch(url, {
    ...options,
    headers: { ...options.headers, connection: "close" },
  });
const identities: string[] = [],
  clients: string[] = [];
beforeAll(async () => {
  expect((await fetch(`${kratos}/health/ready`)).status).toBe(200);
});
afterAll(async () => {
  for (const id of identities)
    await fetch(`${kratosAdmin}/admin/identities/${id}`, { method: "DELETE" });
  for (const id of clients)
    await fetch(`${hydraAdmin}/admin/clients/${id}`, { method: "DELETE" });
  await databases.close();
});

test("実KratosがブラウザーフローとCSRF Cookieを発行し、未認証のwhoamiを拒否する", async () => {
  const response = await fetch(`${kratos}/self-service/login/browser`, {
    redirect: "manual",
    headers: { accept: "text/html" },
  });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toContain("/auth/login?flow=");
  expect(response.headers.getSetCookie().join(";")).toContain("csrf_token_");
  expect((await fetch(`${kratos}/sessions/whoami`)).status).toBe(401);
});

test("Kratos・Hydraの再起動後もIdentity・OAuthクライアント・署名鍵を保つ", async () => {
  const created = await request(`${kratosAdmin}/admin/identities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schema_id: "default", traits: {} }),
  });
  expect(created.status).toBe(201);
  const id = ((await created.json()) as { id: string }).id;
  identities.push(id);
  const clientId = randomUUID();
  clients.push(clientId);
  const client = await request(`${hydraAdmin}/admin/clients`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      redirect_uris: ["http://127.0.0.1:5173/callback"],
      scope: "openid",
    }),
  });
  expect(client.status).toBe(201);
  const keys = await (await request(`${hydra}/.well-known/jwks.json`)).json();
  expect(keys.keys.length).toBeGreaterThan(0);
  const compose = [
    "compose",
    "--env-file",
    ".env",
    "--env-file",
    ".env.ory",
    "-f",
    "compose.yaml",
    "-f",
    "compose.ory.yaml",
  ];
  execFileSync(
    "docker",
    [...compose, "restart", "identity-postgres", "kratos", "hydra"],
    { stdio: "pipe" },
  );
  execFileSync(
    "docker",
    [...compose, "up", "-d", "--wait", "kratos", "hydra"],
    { stdio: "pipe" },
  );
  expect((await fetch(`${kratosAdmin}/admin/identities/${id}`)).status).toBe(
    200,
  );
  expect((await fetch(`${hydraAdmin}/admin/clients/${clientId}`)).status).toBe(
    200,
  );
  expect(await (await fetch(`${hydra}/.well-known/jwks.json`)).json()).toEqual(
    keys,
  );
});

test("実Hydraとアプリのログイン・同意を経てPKCEコードを発行し、CSRFと別ユーザーの同意を拒否する", async () => {
  const clientId = randomUUID();
  clients.push(clientId);
  const client = await fetch(`${hydraAdmin}/admin/clients`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_name: "test client",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      redirect_uris: ["http://127.0.0.1:5173/callback"],
      scope: "openid",
    }),
  });
  expect(client.status).toBe(201);
  // This test covers the Hydra handshake. Real social authentication remains a separate acceptance check.
  const oryId = randomUUID();
  let currentId = oryId;
  const identity = new OryIdentity(databases.postgres, kratos, async () =>
    Response.json({
      id: randomUUID(),
      active: true,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      identity: { id: currentId, state: "active" },
    }),
  );
  await identity.setup();
  const app = await createApp(undefined, identity, hydraAdmin);
  const verifier =
    randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
  const authUrl = new URL(`${hydra}/oauth2/auth`);
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "openid",
    state: randomUUID(),
    redirect_uri: "http://127.0.0.1:5173/callback",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  const jar = new Map<string, string>();
  const save = (cookies: string[]) => {
    for (const raw of cookies) {
      const pair = raw.split(";", 1)[0]!;
      jar.set(pair.slice(0, pair.indexOf("=")), pair);
    }
  };
  const cookie = () => [...jar.values(), "ory_kratos_session=test"].join("; ");
  const follow = async (url: string) => {
    const r = await fetch(url, {
      redirect: "manual",
      headers: { cookie: cookie() },
    });
    save(r.headers.getSetCookie());
    return r;
  };
  try {
    const start = await follow(authUrl.toString());
    const login = await app.inject({
      url:
        new URL(start.headers.get("location")!).pathname +
        new URL(start.headers.get("location")!).search,
      headers: { cookie: cookie() },
    });
    expect(login.statusCode).toBe(302);
    const next = await follow(String(login.headers.location));
    const consentUrl = new URL(next.headers.get("location")!);
    const page = await app.inject({
      url: consentUrl.pathname + consentUrl.search,
      headers: { cookie: cookie() },
    });
    expect(page.statusCode).toBe(200);
    save(
      Array.isArray(page.headers["set-cookie"])
        ? page.headers["set-cookie"]
        : [String(page.headers["set-cookie"])],
    );
    const csrf = page.body.match(/name="csrf" value="([^"]+)"/)![1]!;
    const challenge = consentUrl.searchParams.get("consent_challenge")!;
    const submit = (token: string) =>
      app.inject({
        method: "POST",
        url: "/auth/oauth/consent",
        headers: {
          cookie: cookie(),
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: new URLSearchParams({
          challenge,
          csrf: token,
          decision: "accept",
        }).toString(),
      });
    expect((await submit("invalid")).statusCode).toBe(401);
    currentId = randomUUID();
    identities.push(currentId);
    expect((await submit(csrf)).statusCode).toBe(401);
    await databases.postgres.query("DELETE FROM app_identity WHERE ory_id=$1", [
      currentId,
    ]);
    currentId = oryId;
    const accepted = await submit(csrf);
    expect(accepted.statusCode).toBe(302);
    const callback = await follow(String(accepted.headers.location));
    const code = new URL(callback.headers.get("location")!).searchParams.get(
      "code",
    );
    expect(code).toBeTruthy();
    const token = await fetch(`${hydra}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: "http://127.0.0.1:5173/callback",
        client_id: clientId,
        code_verifier: verifier,
      }),
    });
    expect(token.status).toBe(200);
    const body = (await token.json()) as { id_token: string };
    const claims = JSON.parse(
      Buffer.from(body.id_token.split(".")[1]!, "base64url").toString(),
    );
    expect(claims.sub).toBe((await identity.session("session=test")).userId);
  } finally {
    await app.close();
    await databases.postgres.query("DELETE FROM app_identity WHERE ory_id=$1", [
      oryId,
    ]);
  }
});
