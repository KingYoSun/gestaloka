import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Operation } from "@gestaloka/contracts";
import { WorldAccess } from "@gestaloka/server/access";
import type { McpPrincipal } from "@gestaloka/server/mcp";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { createApp } from "../../apps/api/src/app.js";
let isolated: ReturnType<typeof isolatedDatabases>,
  runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  auth: Awaited<ReturnType<typeof fixtureAuth>>,
  access: WorldAccess,
  admin: string,
  scope: string;
let transform:
  ((c: unknown, u: Record<string, unknown>) => unknown) | undefined;
const tokens = new Map<string, Record<string, unknown>>();
async function delegation(
  scopes: string[],
  worldIds: string[] | null = null,
  userId = admin,
) {
  const clientId = randomUUID();
  await auth.operations.execute(admin, randomUUID(), {
    operation: "mcp.clients.put",
    clientId,
    configuration: {
      name: "試験クライアント",
      enabled: true,
      redirectUris: ["http://127.0.0.1:18981/callback"],
      scopes,
      worldIds,
    },
    expectedVersion: 0,
    reason: "試験",
  });
  const grantId = randomUUID(),
    token = randomUUID();
  await isolated.databases.postgres.query(
    "INSERT INTO mcp_grant(id,client_id,user_id,scopes,world_ids,consent_hash) VALUES($1,$2,$3,$4,$5,$6)",
    [
      grantId,
      clientId,
      userId,
      ["mcp.connect", ...scopes],
      worldIds,
      randomUUID(),
    ],
  );
  const principal: McpPrincipal = {
    grantId,
    clientId,
    userId,
    scopes: ["mcp.connect", ...scopes],
    worldIds,
    scope: "mcp.connect",
  };
  tokens.set(token, {
    active: true,
    client_id: clientId,
    sub: userId,
    aud: [auth.operations.mcp.resource],
    scope: principal.scopes.join(" "),
    exp: Math.ceil(Date.now() / 1000) + 3600,
    ext: { gestaloka_grant: grantId },
  });
  return { principal, token };
}
beforeEach(async () => {
  isolated = isolatedDatabases();
  await isolated.setup();
  scope = `mcp-${randomUUID()}`;
  transform = undefined;
  tokens.clear();
  ({ runtime } = await fixtureRuntime(
    scope,
    (c, u) => transform?.(c, u) ?? c,
    isolated.databases,
  ));
  auth = await fixtureAuth(isolated.databases.postgres, undefined, {
    resource: "http://127.0.0.1:18980/mcp",
    issuer: "http://127.0.0.1:24444",
  });
  admin = (await auth.person()).id;
  access = new WorldAccess(runtime);
  await access.setup();
  vi.spyOn(auth.operations.mcp, "hydra").mockImplementation(
    async (path, _method, body) =>
      path.endsWith("introspect")
        ? (tokens.get((body as URLSearchParams).get("token")!) ?? {
            active: false,
          })
        : {},
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  const db = isolated.databases;
  for (const w of (await db.postgres.query("SELECT world_id FROM world_build"))
    .rows)
    await db.graph.executeQuery(
      "MATCH(n) WHERE n.worldId=$id DETACH DELETE n",
      { id: w.world_id },
    );
  for (const suffix of ["", "-play", "-scenes", "-joins"])
    await db.queue.deleteQueue(`e2e-${scope}${suffix}`);
  await db.queue.stop();
  await isolated.close();
});
const create = async () => {
  const id = (
    await access.create(admin, {
      requestId: randomUUID(),
      prompt: "MCPの検証",
      budgetUsd: 100,
    })
  ).id;
  await runtime.tick(id);
  return id;
};

test("要求の受付照会にも元の操作のscopeが必要となる", async () => {
  const id = randomUUID();
  await auth.operations.execute(admin, id, { operation: "settings.read" });
  const limited = await delegation(["requests.read"]);
  await expect(
    auth.operations.execute(
      admin,
      randomUUID(),
      { operation: "requests.read", id },
      { mcp: limited.principal },
    ),
  ).rejects.toMatchObject({ code: "MCP_SCOPE_DENIED" });
  const allowed = await delegation(["requests.read", "settings.read"]);
  expect(
    await auth.operations.execute(
      admin,
      randomUUID(),
      { operation: "requests.read", id },
      { mcp: allowed.principal },
    ),
  ).toMatchObject({ state: "accepted", operation: "settings.read" });
});

test("外部MCPクライアントが世界を構築・完了・読取・編集し、同じ確定と費用を再利用する", async () => {
  const { token } = await delegation([
    "worlds.create",
    "worlds.command",
    "worlds.read",
    "worlds.graph",
    "worlds.edit",
    "requests.read",
    "costs.read",
    "jobs.list",
  ]);
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  await app.listen({ host: "127.0.0.1", port: 18980 });
  const client = new Client({ name: "world-operator", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://127.0.0.1:18980/mcp"), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({
        name,
        arguments: { requestId: randomUUID(), ...args },
      });
      expect(result.isError).not.toBe(true);
      const text = result.content.find((v) => v.type === "text")?.text;
      if (typeof text !== "string") throw new Error("MCPの応答がありません");
      return JSON.parse(text) as Record<string, unknown>;
    };
    const created = await call("worlds_create", {
        prompt: "外部MCPから作る世界",
        budgetUsd: 10,
        reason: "一貫検証",
      }),
      worldId = String(created.id);
    await runtime.tick(worldId);
    expect(await call("worlds_read", { worldId })).toMatchObject({
      world: { id: worldId, state: "ready" },
    });
    expect(
      await call("worlds_command", {
        worldId,
        command: { command: "finish" },
        reason: "構築完了",
      }),
    ).toMatchObject({ state: "finished" });
    const graph = await call("worlds_graph", {
        worldId,
        query: { kind: "nodes" },
      }),
      nodeId = randomUUID(),
      requestId = randomUUID();
    const input = {
      requestId,
      worldId,
      at: 0,
      dependencies: graph.dependencies,
      changes: {
        nodes: [
          { id: nodeId, kind: "existence", text: "外部LLMが設定した目印" },
        ],
        edges: [],
        revisions: [],
        endEdges: [],
      },
      reason: "管理者による明示的な世界修正",
    };
    const db = isolated.databases.postgres;
    const count = async () =>
      (await db.query("SELECT count(*)::int AS n FROM llm_call")).rows[0].n;
    const calls = await count(),
      first = await call("worlds_edit", input);
    expect(first.commitId).toBe(requestId);
    expect(await call("worlds_edit", input)).toEqual(first);
    expect(await count()).toBe(calls);
    expect(await call("requests_read", { id: requestId })).toMatchObject({
      state: "accepted",
      operation: "worlds.edit",
      result: { commitId: requestId },
    });
    expect(
      JSON.stringify(
        await call("worlds_graph", {
          worldId,
          query: { kind: "node", id: nodeId },
        }),
      ),
    ).toContain("外部LLMが設定した目印");
    const receipts = await isolated.databases.graph.executeQuery(
      "MATCH(r:WorldReceipt {commitId:$id}) RETURN r",
      { id: requestId },
    );
    expect(receipts.records).toHaveLength(1);
    expect(
      await call("costs_read", {
        query: {
          from: new Date(Date.now() - 86400000).toISOString(),
          to: new Date(Date.now() + 86400000).toISOString(),
          worldId,
          view: "summary",
        },
      }),
    ).toMatchObject({ basis: "calculated", totals: { calls } });
    expect(await call("jobs_list", { query: { worldId } })).toMatchObject({
      items: [{ id: worldId, state: "finished" }],
    });
  } finally {
    await client.close();
    await app.close();
  }
});
test("外部SDKのMCP接続で全共通操作を列挙し、認証・scope・再送・監査を適用する", async () => {
  const { token, principal } = await delegation(["users.list", "users.role"]),
    user = (await auth.person("user")).id;
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  await app.listen({ host: "127.0.0.1", port: 18980 });
  const client = new Client({ name: "external-test", version: "1" });
  try {
    const unauth = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { host: "127.0.0.1:18980" },
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.headers["www-authenticate"]).toContain(
      "oauth-protected-resource/mcp",
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://127.0.0.1:18980/mcp"), {
        requestInit: {
          headers: { authorization: `Bearer ${token}` },
        },
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(
      Operation.options
        .map((s) => s.shape.operation.value.replaceAll(".", "_"))
        .sort(),
    );
    const id = randomUUID(),
      args = {
        requestId: id,
        userId: user,
        role: "admin",
        reason: "追加管理者の任命",
      };
    const first = await client.callTool({
      name: "users_role",
      arguments: args,
    });
    expect(first.isError).not.toBe(true);
    await client.callTool({ name: "users_role", arguments: args });
    expect((await auth.operations.state(user)).member?.role).toBe("admin");
    const audit = (
      await isolated.databases.postgres.query(
        "SELECT outcome,details FROM operation_audit WHERE request_id=$1 ORDER BY id",
        [id],
      )
    ).rows;
    expect(audit.map((r) => r.outcome)).toEqual(["accepted", "replayed"]);
    expect(audit[0].details.clientId).toBe(principal.clientId);
    const third = (await auth.person("user")).id,
      additional = await delegation(["users.role"], null, user),
      appointed = new Client({ name: "additional-admin", version: "1" });
    try {
      await appointed.connect(
        new StreamableHTTPClientTransport(
          new URL("http://127.0.0.1:18980/mcp"),
          {
            requestInit: {
              headers: { authorization: `Bearer ${additional.token}` },
            },
          },
        ),
      );
      const result = await appointed.callTool({
        name: "users_role",
        arguments: {
          requestId: randomUUID(),
          userId: third,
          role: "admin",
          reason: "追加管理者から任命",
        },
      });
      expect(result.isError).not.toBe(true);
      expect((await auth.operations.state(third)).member?.role).toBe("admin");
    } finally {
      await appointed.close();
    }
    const banId = randomUUID(),
      ban = { requestId: banId, userId: user, banned: true, reason: "scope外" };
    await expect(
      client.callTool({
        name: "users_ban",
        arguments: ban,
      }),
    ).rejects.toThrow("users.ban");
    const renewed = await delegation(["users.ban"]),
      second = new Client({ name: "renewed-test", version: "1" });
    try {
      await second.connect(
        new StreamableHTTPClientTransport(
          new URL("http://127.0.0.1:18980/mcp"),
          {
            requestInit: {
              headers: { authorization: `Bearer ${renewed.token}` },
            },
          },
        ),
      );
      const afterConsent = await second.callTool({
        name: "users_ban",
        arguments: ban,
      });
      expect(afterConsent.isError).not.toBe(true);
      expect((await auth.operations.state(user)).member?.banned).toBe(true);
      const attempts = (
        await isolated.databases.postgres.query(
          "SELECT outcome FROM operation_audit WHERE request_id=$1 ORDER BY id",
          [banId],
        )
      ).rows;
      expect(attempts.map((r) => r.outcome)).toEqual(["denied", "accepted"]);
    } finally {
      await second.close();
    }
    await auth.operations.execute(admin, randomUUID(), {
      operation: "mcp.grants.revoke",
      grantId: principal.grantId,
      reason: "接続後に失効",
    });
    await expect(
      client.callTool({
        name: "users_list",
        arguments: { requestId: randomUUID() },
      }),
    ).rejects.toThrow();
  } finally {
    await client.close();
    await app.close();
  }
});
test("限定対象・scopeの縮小・一般ユーザー・別audienceを共通の認可で拒否する", async () => {
  const world = await create(),
    other = await create(),
    { principal, token } = await delegation(
      ["worlds.list", "worlds.read", "costs.read"],
      [world],
    );
  const invoke = (command: Parameters<typeof auth.operations.execute>[2]) =>
    auth.operations.execute(admin, randomUUID(), command, {
      players: access.players,
      mcp: principal,
    });
  expect((await invoke({ operation: "worlds.list" })).items).toEqual([
    { id: world },
  ]);
  await invoke({ operation: "worlds.read", worldId: world });
  await expect(
    invoke({ operation: "worlds.read", worldId: other }),
  ).rejects.toMatchObject({ code: "MCP_TARGET_DENIED" });
  const q = {
    from: "2020-01-01T00:00:00Z",
    to: "2099-01-01T00:00:00Z",
    view: "summary" as const,
    interval: "day" as const,
  };
  await expect(
    invoke({ operation: "costs.read", query: q }),
  ).rejects.toMatchObject({ code: "MCP_TARGET_DENIED" });
  await invoke({ operation: "costs.read", query: { ...q, worldId: world } });
  const client = (
    await auth.operations.mcp.clients(isolated.databases.postgres)
  ).items.find((c) => c.id === principal.clientId)!;
  await auth.operations.execute(admin, randomUUID(), {
    operation: "mcp.clients.put",
    clientId: principal.clientId,
    configuration: { ...client.configuration, scopes: ["worlds.list"] },
    expectedVersion: 1,
    reason: "scopeを縮小",
  });
  await expect(
    invoke({ operation: "worlds.read", worldId: world }),
  ).rejects.toMatchObject({ code: "MCP_SCOPE_DENIED" });
  tokens.get(token)!.aud = ["https://another.invalid/mcp"];
  await expect(
    auth.operations.mcp.verify(`Bearer ${token}`),
  ).rejects.toMatchObject({ code: "MCP_TOKEN_INVALID" });
  tokens.get(token)!.aud = [auth.operations.mcp.resource];
  tokens.get(token)!.exp = 0;
  await expect(
    auth.operations.mcp.verify(`Bearer ${token}`),
  ).rejects.toMatchObject({ code: "MCP_TOKEN_INVALID" });
  tokens.get(token)!.exp = Math.ceil(Date.now() / 1000) + 3600;
  await auth.operations.execute(admin, randomUUID(), {
    operation: "mcp.clients.put",
    clientId: principal.clientId,
    configuration: {
      ...client.configuration,
      scopes: ["worlds.list"],
      enabled: false,
    },
    expectedVersion: 2,
    reason: "クライアントの利用を終了",
  });
  await expect(
    auth.operations.mcp.verify(`Bearer ${token}`),
  ).rejects.toMatchObject({ code: "MCP_AUTH_REVOKED" });
  const user = (await auth.person("user")).id,
    ordinary = await delegation(["users.role"], null, user);
  await expect(
    auth.operations.mcp.verify(`Bearer ${ordinary.token}`),
  ).rejects.toMatchObject({ code: "MCP_AUTH_REVOKED" });
});
test("管理修正で依存版・履歴・構造と原子的確定を守り、通信断後の再送でも重ねない", async () => {
  const world = await create(),
    row = await runtime.get(world),
    nodeId = row.actor_id!,
    { principal } = await delegation(["worlds.graph", "worlds.edit"], [world]);
  const invoke = (
    id: string,
    command: Parameters<typeof auth.operations.execute>[2],
  ) =>
    auth.operations.execute(admin, id, command, {
      players: access.players,
      mcp: principal,
    });
  const read = await invoke(randomUUID(), {
    operation: "worlds.graph",
    worldId: world,
    query: { kind: "node", id: nodeId },
  });
  const id = randomUUID(),
    changes = {
      nodes: [],
      edges: [],
      endEdges: [],
      revisions: [
        {
          ...(read.node as { id: string; kind: "existence"; text: string }),
          text: "改訂後の呼称",
        },
      ],
    };
  const command = {
    operation: "worlds.edit" as const,
    worldId: world,
    at: 1000,
    dependencies: read.dependencies as { key: string; version: number }[],
    changes,
    reason: "管理者による呼称の改訂",
  };
  const result = await invoke(id, command);
  expect(result.management).toMatchObject({
    editorId: admin,
    reason: command.reason,
  });
  expect(await invoke(id, command)).toEqual(result);
  const editedAudit = (
    await isolated.databases.postgres.query(
      "SELECT details FROM operation_audit WHERE request_id=$1 ORDER BY id LIMIT 1",
      [id],
    )
  ).rows[0].details;
  expect(editedAudit).toMatchObject({
    commitId: id,
    clientId: principal.clientId,
    management: { editorId: admin, reason: command.reason },
    changes: { revisions: changes.revisions },
  });
  expect(
    await runtime.agent.store
      .context(row.world_id!)
      .history(nodeId, "see", "out", 3000),
  ).toHaveLength(1);
  expect(
    await runtime.agent.store
      .context(row.world_id!)
      .history(nodeId, "interpret", "out", 3000),
  ).toHaveLength(0);
  // The graph commit is durable even when the application transaction rolls back.
  const interrupted = randomUUID(),
    before = await invoke(randomUUID(), {
      operation: "worlds.graph",
      worldId: world,
      query: { kind: "node", id: nodeId },
    });
  const write = {
    ...command,
    dependencies: before.dependencies as { key: string; version: number }[],
    at: 2000,
    changes: {
      ...changes,
      revisions: [
        { id: nodeId, kind: "existence" as const, text: "保存された改訂" },
      ],
    },
  };
  const commit = vi.spyOn(runtime.agent.store, "commit"),
    original = runtime.agent.store.commit.bind(runtime.agent.store);
  commit.mockImplementationOnce(async (...args) => {
    await original(...args);
    throw new TypeError("simulated disconnect");
  });
  await expect(invoke(interrupted, write)).rejects.toThrow("disconnect");
  commit.mockRestore();
  await expect(
    invoke(interrupted, {
      ...write,
      dependencies: [
        ...write.dependencies,
        { key: `node:${randomUUID()}`, version: 0 },
      ],
    }),
  ).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  const recovered = await invoke(interrupted, write);
  expect(recovered.commitId).toBe(interrupted);
  const prior = await invoke(randomUUID(), {
    operation: "worlds.graph",
    worldId: world,
    query: { kind: "node", id: nodeId, at: 0 },
  });
  expect(prior.node).toEqual(read.node);
  await expect(
    invoke(randomUUID(), { ...command, at: 3000 }),
  ).rejects.toMatchObject({ code: "WORLD_CHANGED" });
  const invalid = {
    ...command,
    at: 3000,
    dependencies: [],
    changes: {
      nodes: [
        { id: randomUUID(), kind: "script" as const, text: "成立しない差分" },
      ],
      revisions: [],
      endEdges: [],
      edges: [
        {
          id: randomUUID(),
          kind: "has" as const,
          source: randomUUID(),
          target: nodeId,
          period: { from: 3000 },
        },
      ],
    },
  };
  await expect(invoke(randomUUID(), invalid)).rejects.toMatchObject({
    code: "WORLD_EDIT_REJECTED",
  });
  const receipts = await invoke(randomUUID(), {
    operation: "worlds.graph",
    worldId: world,
    query: { kind: "receipts" },
  });
  expect(
    (receipts.items as { commitId: string }[]).filter(
      (r) => r.commitId === interrupted,
    ),
  ).toHaveLength(1);
  const graph = (
    await isolated.databases.graph.executeQuery(
      "MATCH(n:WorldNode {worldId:$id}) RETURN count(n) AS n",
      { id: row.world_id },
    )
  ).records[0]!.get("n").toNumber();
  expect(graph).toBe(3);
});
test("実行中の応答を保存し、MCP認可の失効後は次の推論と確定を止め、新しい認可で再開する", async () => {
  const first = await delegation(["worlds.create"]);
  let entered!: () => void, release!: () => void;
  const arrived = new Promise<void>((r) => {
      entered = r;
    }),
    waiting = new Promise<void>((r) => {
      release = r;
    });
  transform = async (content, user) => {
    if (user.initialPrompt) {
      entered();
      await waiting;
    }
    return content;
  };
  const created = await auth.operations.execute(
    admin,
    randomUUID(),
    {
      operation: "worlds.create",
      prompt: "実行中の失効",
      budgetUsd: 100,
      reason: "試験",
    },
    { players: access.players, mcp: first.principal },
  );
  const id = String(created.id),
    execution = runtime.tick(id).then(
      () => null,
      (error) => error,
    );
  await arrived;
  await auth.operations.execute(admin, randomUUID(), {
    operation: "mcp.grants.revoke",
    grantId: first.principal.grantId,
    reason: "応答待ちの間に失効",
  });
  release();
  expect(await execution).toMatchObject({ code: "MCP_AUTH_REVOKED" });
  expect((await runtime.get(id)).state).toBe("paused");
  expect((await runtime.agent.model.ledger.summary()).calls).toBe(1);
  const next = await delegation(["jobs.resume"]);
  await auth.operations.execute(
    admin,
    randomUUID(),
    {
      operation: "jobs.resume",
      kind: "construction",
      id,
      reason: "新しい認可で保存状態から再開",
    },
    { players: access.players, mcp: next.principal },
  );
  transform = undefined;
  await runtime.tick(id);
  expect((await runtime.get(id)).state).toBe("ready");
  expect((await runtime.agent.model.ledger.summary()).calls).toBe(2);
});
test("グラフ全体と各関係の履歴はページで辿り、依存版と全記録を保持する", async () => {
  const world = await create(),
    row = await runtime.get(world),
    actor = row.actor_id!,
    { principal } = await delegation(["worlds.graph", "worlds.edit"], [world]);
  const invoke = (command: Parameters<typeof auth.operations.execute>[2]) =>
    auth.operations.execute(admin, randomUUID(), command, {
      players: access.players,
      mcp: principal,
    });
  const nodes = Array.from({ length: 75 }, (_, i) => ({
      id: randomUUID(),
      kind: "script" as const,
      text: `自由記述の性質 ${i}`,
    })),
    edges = nodes.map((n) => ({
      id: randomUUID(),
      kind: "has" as const,
      source: actor,
      target: n.id,
      period: { from: 0 },
    }));
  await invoke({
    operation: "worlds.edit",
    worldId: world,
    at: 0,
    dependencies: [],
    changes: { nodes, edges, revisions: [], endEdges: [] },
    reason: "ページ取得の確認",
  });
  let cursor: string | undefined,
    all: string[] = [];
  do {
    const page = await invoke({
      operation: "worlds.graph",
      worldId: world,
      query: {
        kind: "relations",
        id: actor,
        relation: "has",
        direction: "out",
        at: 0,
        ...(cursor ? { after: cursor } : {}),
      },
    });
    expect((page.items as unknown[]).length).toBeLessThanOrEqual(50);
    expect(page.dependencies).toEqual([
      expect.objectContaining({ key: `relations:${actor}:has:out` }),
    ]);
    all.push(...(page.items as { id: string }[]).map((e) => e.id));
    cursor = (page.next as string | null) ?? undefined;
  } while (cursor);
  expect(all.sort()).toEqual(edges.map((e) => e.id).sort());
  let historyCursor: { from: number; id: string } | undefined;
  all = [];
  do {
    const page = await invoke({
      operation: "worlds.graph",
      worldId: world,
      query: {
        kind: "history",
        id: actor,
        relation: "has",
        direction: "out",
        through: 0,
        from: 0,
        ...(historyCursor ? { after: historyCursor } : {}),
      },
    });
    all.push(...(page.items as { id: string }[]).map((e) => e.id));
    historyCursor = page.next as typeof historyCursor;
  } while (historyCursor);
  expect(all.sort()).toEqual(edges.map((e) => e.id).sort());
  cursor = undefined;
  all = [];
  do {
    const page = await invoke({
      operation: "worlds.graph",
      worldId: world,
      query: { kind: "nodes", ...(cursor ? { after: cursor } : {}) },
    });
    all.push(...(page.items as { id: string }[]).map((n) => n.id));
    cursor = (page.next as string | null) ?? undefined;
  } while (cursor);
  expect(new Set(all).size).toBe(78);
});
