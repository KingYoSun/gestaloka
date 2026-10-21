import { createHash, randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, test } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { fixtureAuth } from "../support/auth.js";
import { fixtureRuntime } from "../support/provider.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { WorldAccess } from "@gestaloka/server/access";
import { RuntimeControl } from "@gestaloka/server";
import { createApp } from "../../apps/api/src/app.js";
const hydra = "http://127.0.0.1:24444",
  hydraAdmin = "http://127.0.0.1:24445",
  resource = "http://127.0.0.1:18983/mcp";
const isolated = isolatedDatabases(),
  scope = `mcp-auth-${randomUUID()}`;
let auth: Awaited<ReturnType<typeof fixtureAuth>>,
  runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  access: WorldAccess,
  app: Awaited<ReturnType<typeof createApp>>,
  admin: string,
  cookie: string;
const clients: string[] = [];
beforeAll(async () => {
  await isolated.setup();
  ({ runtime } = await fixtureRuntime(scope, undefined, isolated.databases));
  auth = await fixtureAuth(isolated.databases.postgres, undefined, {
    resource,
    issuer: hydra,
    hydraAdminUrl: hydraAdmin,
  });
  ({ id: admin, cookie } = await auth.person());
  access = new WorldAccess(runtime);
  await access.setup();
  app = await createApp(access, auth.identity, hydraAdmin, auth.operations);
  await app.listen({ host: "127.0.0.1", port: 18983 });
});
afterAll(async () => {
  await app?.close();
  for (const id of clients)
    await fetch(`${hydraAdmin}/admin/clients/${id}`, { method: "DELETE" });
  const db = isolated.databases;
  for (const r of (await db.postgres.query("SELECT world_id FROM world_build"))
    .rows)
    await db.graph.executeQuery(
      "MATCH(n) WHERE n.worldId=$world DETACH DELETE n",
      { world: r.world_id },
    );
  for (const suffix of ["", "-play", "-scenes", "-joins"])
    await db.queue.deleteQueue(`e2e-${scope}${suffix}`);
  await db.queue.stop();
  await isolated.close();
});
async function client(scopes: string[]) {
  const id = randomUUID();
  clients.push(id);
  await auth.operations.execute(admin, randomUUID(), {
    operation: "mcp.clients.put",
    clientId: id,
    configuration: {
      name: "実Hydraの試験",
      enabled: true,
      redirectUris: ["http://127.0.0.1:18984/callback"],
      scopes,
      worldIds: null,
    },
    expectedVersion: 0,
    reason: "実認可試験",
  });
  return id;
}
async function authorize(
  id: string,
  requestedScopes: string[],
  target = resource,
  rejectVerifier = false,
  withoutPkce = false,
) {
  const verifier =
      randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    state = randomUUID(),
    jar = new Map<string, string>();
  const remember = (values: string[]) => {
    for (const value of values) {
      const pair = value.split(";", 1)[0]!;
      jar.set(pair.slice(0, pair.indexOf("=")), pair);
    }
  };
  const headers = () => ({ cookie: [cookie, ...jar.values()].join("; ") });
  const url = new URL(`${hydra}/oauth2/auth`);
  url.search = new URLSearchParams({
    client_id: id,
    response_type: "code",
    redirect_uri: "http://127.0.0.1:18984/callback",
    scope: ["mcp.connect", ...requestedScopes].join(" "),
    state,
    resource: target,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  if (withoutPkce) {
    url.searchParams.delete("code_challenge");
    url.searchParams.delete("code_challenge_method");
  }
  const first = await fetch(url, { redirect: "manual", headers: headers() });
  remember(first.headers.getSetCookie());
  expect(first.status).toBe(302);
  const loginUrl = new URL(first.headers.get("location")!);
  const login = await app.inject({
    url: loginUrl.pathname + loginUrl.search,
    headers: headers(),
  });
  expect(login.statusCode).toBe(302);
  const next = await fetch(String(login.headers.location), {
    redirect: "manual",
    headers: headers(),
  });
  remember(next.headers.getSetCookie());
  const consentUrl = new URL(next.headers.get("location")!);
  const page = await app.inject({
    url: consentUrl.pathname + consentUrl.search,
    headers: headers(),
  });
  if (page.statusCode !== 200) return { denied: page, token: null };
  remember(
    Array.isArray(page.headers["set-cookie"])
      ? page.headers["set-cookie"]
      : [String(page.headers["set-cookie"])],
  );
  const csrf = page.body.match(/name="csrf" value="([^"]+)"/)![1]!;
  const accepted = await app.inject({
    method: "POST",
    url: "/auth/oauth/consent",
    headers: {
      ...headers(),
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: new URLSearchParams({
      csrf,
      challenge: consentUrl.searchParams.get("consent_challenge")!,
      decision: "accept",
    }).toString(),
  });
  expect(accepted.statusCode, accepted.body).toBe(302);
  const callback = await fetch(String(accepted.headers.location), {
    redirect: "manual",
    headers: headers(),
  });
  const result = new URL(callback.headers.get("location")!);
  expect(result.searchParams.get("state")).toBe(state);
  const response = await fetch(`${hydra}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: id,
      code: result.searchParams.get("code")!,
      redirect_uri: "http://127.0.0.1:18984/callback",
      code_verifier: rejectVerifier ? "invalid-verifier" : "" + verifier,
      resource: target,
    }),
  });
  if (rejectVerifier) {
    expect(response.status).toBe(400);
    return { denied: null, token: null };
  }
  expect(response.status).toBe(200);
  const token = (await response.json()) as { access_token: string };
  return { denied: null, token: token.access_token };
}
test("事前登録・実HydraのPKCE・本人同意から外部MCPクライアントで運用し、失効を反映する", async () => {
  const id = await client([
      "worlds.create",
      "worlds.read",
      "worlds.graph",
      "worlds.edit",
      "costs.read",
      "users.list",
    ]),
    session = await authorize(id, [
      "worlds.create",
      "worlds.read",
      "worlds.graph",
      "worlds.edit",
      "costs.read",
      "users.list",
    ]);
  expect(session.denied).toBeNull();
  expect(session.token).toBeTruthy();
  const external = new Client({ name: "native-oauth-client", version: "1" });
  try {
    await external.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: { authorization: `Bearer ${session.token}` } },
      }),
    );
    const requestId = randomUUID(),
      argumentsForWorld = {
        requestId,
        prompt: "OAuthからの世界構築",
        budgetUsd: 100,
        reason: "一貫試験",
      };
    const policy = await RuntimeControl.read(isolated.databases.postgres);
    await auth.operations.execute(admin, randomUUID(), {
      operation: "runtime.put",
      configuration: { ...policy.configuration, paused: true },
      expectedVersion: policy.version,
      reason: "MCPの停止確認",
    });
    const stopped = await external.callTool({
      name: "worlds_create",
      arguments: argumentsForWorld,
    });
    expect(stopped.isError).toBe(true);
    expect(JSON.stringify(stopped)).toContain("MAINTENANCE");
    expect((await runtime.agent.model.ledger.summary()).calls).toBe(0);
    await auth.operations.execute(admin, randomUUID(), {
      operation: "runtime.put",
      configuration: policy.configuration,
      expectedVersion: policy.version + 1,
      reason: "停止を解除",
    });
    const response = await external.callTool({
      name: "worlds_create",
      arguments: argumentsForWorld,
    });
    expect(response.isError).not.toBe(true);
    const world = JSON.parse((response.content[0] as { text: string }).text).id;
    await runtime.tick(world);
    const graph = await external.callTool({
      name: "worlds_graph",
      arguments: {
        requestId: randomUUID(),
        worldId: world,
        query: { kind: "nodes" },
      },
    });
    expect(graph.isError).not.toBe(true);
    expect(
      JSON.parse((graph.content[0] as { text: string }).text).items,
    ).toHaveLength(3);
    const fee = await external.callTool({
      name: "costs_read",
      arguments: {
        requestId: randomUUID(),
        query: {
          from: "2020-01-01T00:00:00Z",
          to: "2099-01-01T00:00:00Z",
          worldId: world,
          view: "summary",
        },
      },
    });
    expect(JSON.parse((fee.content[0] as { text: string }).text).basis).toBe(
      "calculated",
    );
    const revoke = await fetch(`${hydra}/oauth2/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, token: session.token! }),
    });
    expect(revoke.status).toBe(200);
    await expect(
      external.callTool({
        name: "users_list",
        arguments: { requestId: randomUUID() },
      }),
    ).rejects.toThrow();
  } finally {
    await external.close();
  }
});
test("登録外scopeと別リソースを本人同意の前で拒否する", async () => {
  const id = await client(["costs.read"]);
  const wrong = await authorize(
    id,
    ["costs.read"],
    "https://another.invalid/mcp",
  );
  expect(wrong.denied?.statusCode, wrong.denied?.body).toBe(403);
});
test("自動登録とPKCEなしの認可を拒否し、誤ったverifierではトークンを発行しない", async () => {
  const id = await client(["costs.read"]);
  const missing = await authorize(id, ["costs.read"], resource, false, true);
  expect(missing.denied?.statusCode).toBe(403);
  expect(missing.denied?.json().code).toBe("MCP_AUTH_PARAMETERS");
  const automatic = await fetch(`${hydra}/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["http://127.0.0.1:18984/callback"],
      token_endpoint_auth_method: "none",
    }),
    redirect: "manual",
  });
  expect(automatic.status).toBe(404);
  const wrong = await authorize(id, ["costs.read"], resource, true);
  expect(wrong.token).toBeNull();
});
