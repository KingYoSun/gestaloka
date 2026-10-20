import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { WORLD_DAY_MS } from "@gestaloka/contracts";
import { connectDatabases } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldConstruction } from "@gestaloka/server/construction";
import { WorldAccess } from "@gestaloka/server/access";
import { createApp } from "../../apps/api/src/app.js";
import { modelEnvironment, approvedTransport } from "../support/model.js";
import { fixtureAuth } from "../support/auth.js";

const databases = connectDatabases(),
  budgetId = randomUUID();
const subjects: string[] = [],
  ids: string[] = [],
  worlds: string[] = [];
const queueName = `api-test-${randomUUID()}`;
const empty = () => ({ nodes: [], edges: [], revisions: [], endEdges: [] });
const model = new LlmClient(
  databases.postgres,
  modelEnvironment(budgetId),
  approvedTransport(async (_url, options) => {
    const user = JSON.parse(
      JSON.parse(String(options?.body)).messages.find(
        (message: { role: string }) => message.role === "user",
      ).content,
    );
    const actor = randomUUID(),
      place = randomUUID(),
      state = randomUUID();
    const content = user.initialPrompt
      ? {
          changes: {
            ...empty(),
            nodes: [
              { id: actor, kind: "existence", text: "PRIVATE_ACTOR" },
              { id: place, kind: "existence", text: "PRIVATE_PLACE" },
            ],
            edges: [
              {
                id: randomUUID(),
                kind: "see",
                source: actor,
                target: place,
                text: "試遊主体だけが得た情報",
                period: { from: 0 },
              },
            ],
          },
          playerId: actor,
          rootIds: [place],
          report: "管理者向けの初期記録",
        }
      : {
          type: "propose",
          summary: "管理者向けの参加診断",
          resolvedUntil: user.request.until,
          newParticipantId: actor,
          wakeups: [],
          changes: {
            ...empty(),
            nodes: [
              { id: actor, kind: "existence", text: "PRIVATE_NEW_ACTOR" },
              { id: state, kind: "script", text: "PRIVATE_STATE" },
            ],
            edges: [
              {
                id: randomUUID(),
                kind: "status",
                role: "content",
                source: actor,
                target: state,
                period: { from: 0 },
              },
              {
                id: randomUUID(),
                kind: "status",
                role: "about",
                source: state,
                target: user.request.rootIds[0],
                period: { from: 0 },
              },
              {
                id: randomUUID(),
                kind: "see",
                source: actor,
                target: user.request.rootIds[0],
                text: "自分で見た風景。川へ向かう人を見かけた。",
                observation: {
                  aspect: "風景の様子",
                  through: user.request.at,
                  sourceIds: [user.request.rootIds[0]],
                  pathIds: [],
                },
                period: { from: user.request.at },
              },
            ],
          },
        };
    return new Response(
      JSON.stringify({
        id: randomUUID(),
        model: "deepseek-flash",
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(content) },
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 1,
        },
      }),
    );
  }),
);
const runtime = new WorldConstruction(
  new WorldBuilder(
    databases.postgres,
    databases.graph,
    databases.checkpointer,
    model,
  ),
  new WorldAgent(
    databases.postgres,
    databases.graph,
    databases.checkpointer,
    model,
  ),
  databases.queue,
  queueName,
);
const access = new WorldAccess(runtime);
let app: Awaited<ReturnType<typeof createApp>>, address: string;
let auth: Awaited<ReturnType<typeof fixtureAuth>>;
const headers = (cookie: string) => ({ cookie, "x-gestaloka-request": "1" });
async function session(role: "admin" | "user" = "admin") {
  const person = await auth.person(role);
  const reply = await app.inject({
    method: "POST",
    url: "/api/session",
    headers: { "x-gestaloka-request": "1", cookie: person.cookie },
  });
  expect(reply.statusCode).toBe(200);
  const subject = reply.json<{ id: string }>().id;
  expect(reply.headers["x-gestaloka-subject"]).toBe(subject);
  subjects.push(subject);
  const cookie = person.cookie;
  expect(reply.headers["set-cookie"]).toBeUndefined();
  return { subject, cookie };
}
async function fixture() {
  const browser = await session(),
    requestId = randomUUID();
  const created = await app.inject({
    method: "POST",
    url: "/api/worlds",
    headers: headers(browser.cookie),
    payload: { requestId, prompt: "初期世界の自由記述" },
  });
  expect(created.statusCode).toBe(202);
  const id = created.json<{ id: string }>().id;
  ids.push(id);
  await runtime.tick(id);
  worlds.push((await runtime.get(id)).world_id!);
  return { ...browser, id, requestId, created: created.json() };
}
async function legacyFixture() {
  const scene = await fixture();
  for (const command of ["finish", "join"] as const)
    await access.command(scene.subject, scene.id, {
      requestId: randomUUID(),
      command,
    });
  await runtime.tick(scene.id);
  const legacyId = randomUUID(),
    token = randomUUID();
  subjects.push(legacyId);
  await databases.postgres.query(
    "INSERT INTO world_subject(id,token_hash) VALUES($1,$2)",
    [legacyId, createHash("sha256").update(token).digest("hex")],
  );
  const action = {
    requestId: randomUUID(),
    actionText: "見える範囲を確かめる",
  };
  const accepted = await access.play(scene.subject, scene.id, action);
  for (const table of ["world_access", "world_event", "api_request"])
    await databases.postgres.query(
      `UPDATE ${table} SET subject_id=$2 WHERE subject_id=$1`,
      [scene.subject, legacyId],
    );
  return { ...scene, legacyId, token, action, accepted };
}
beforeAll(async () => {
  await databases.verify();
  databases.queue.on("error", console.error);
  await databases.queue.start();
  auth = await fixtureAuth(databases.postgres);
  await access.setup();
  app = await createApp(access, auth.identity, undefined, auth.operations);
  address = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterAll(async () => {
  await app?.close();
  await databases.queue.deleteQueue(queueName);
  await databases.queue.deleteQueue(`${queueName}-play`);
  await databases.queue.deleteQueue(`${queueName}-scenes`);
  await databases.postgres.query(
    "DELETE FROM world_event WHERE construction_id=ANY($1)",
    [ids],
  );
  await databases.postgres.query(
    "DELETE FROM world_access WHERE construction_id=ANY($1)",
    [ids],
  );
  await databases.postgres.query(
    "DELETE FROM api_request WHERE subject_id=ANY($1)",
    [subjects],
  );
  await databases.postgres.query("DELETE FROM world_subject WHERE id=ANY($1)", [
    subjects,
  ]);
  await auth.cleanup();
  await databases.postgres.query(
    "DELETE FROM construction_log WHERE construction_id=ANY($1)",
    [ids],
  );
  await databases.postgres.query(
    "DELETE FROM world_construction WHERE id=ANY($1)",
    [ids],
  );
  await databases.postgres.query(
    "DELETE FROM world_build WHERE run_id=ANY($1)",
    [ids],
  );
  await databases.postgres.query(
    "DELETE FROM world_operation WHERE request->>'worldId'=ANY($1)",
    [worlds],
  );
  await databases.postgres.query("DELETE FROM llm_call WHERE budget_id=$1", [
    budgetId,
  ]);
  await databases.postgres.query("DELETE FROM llm_budget WHERE id=$1", [
    budgetId,
  ]);
  for (const worldId of worlds)
    await databases.graph.executeQuery(
      "MATCH(n) WHERE n.worldId=$worldId DETACH DELETE n",
      { worldId },
    );
  await databases.queue.stop();
  await databases.close();
});

test("本人の確認で匿名主体を結び付け、操作対象・世界・履歴・再送を保持する", async () => {
  const legacy = await legacyFixture(),
    person = await session("user");
  const cookie = `${person.cookie}; gestaloka=${legacy.token}`;
  const before = await runtime.get(legacy.id);
  const known = await runtime.agent.store
    .context(before.world_id!)
    .history(before.participant_id!, "see", "out", 0);
  expect(
    (
      await app.inject({
        url: `/api/worlds/${legacy.id}/play`,
        headers: headers(cookie),
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: "/api/session",
        headers: { cookie: `gestaloka=${legacy.token}` },
      })
    ).statusCode,
  ).toBe(401);
  const preview = await app.inject({
    url: "/api/account/legacy",
    headers: headers(cookie),
  });
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toMatchObject({
    subjectId: legacy.legacyId,
    linked: false,
    total: 1,
    items: [{ id: legacy.id, actorId: before.participant_id }],
  });
  expect(
    (
      await databases.postgres.query(
        "SELECT user_id FROM world_subject WHERE id=$1",
        [legacy.legacyId],
      )
    ).rows[0].user_id,
  ).toBeNull();
  const payload = {
    requestId: randomUUID(),
    command: { operation: "account.claim", version: preview.json().version },
  };
  const claim = await app.inject({
    method: "POST",
    url: "/api/operations",
    headers: headers(cookie),
    payload,
  });
  expect(claim.statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/operations",
        headers: headers(cookie),
        payload,
      })
    ).json(),
  ).toEqual(claim.json());
  expect(
    (
      await app.inject({
        url: `/api/worlds/${legacy.id}`,
        headers: headers(cookie),
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        url: `/api/worlds/${legacy.id}/play`,
        headers: headers(cookie),
      })
    ).json().viewerId,
  ).toBe(before.participant_id);
  const replay = await app.inject({
    method: "POST",
    url: `/api/worlds/${legacy.id}/actions`,
    headers: headers(cookie),
    payload: legacy.action,
  });
  expect(replay.statusCode).toBe(202);
  expect(replay.json()).toEqual(legacy.accepted);
  expect(await runtime.get(legacy.id)).toEqual(before);
  expect(
    await runtime.agent.store
      .context(before.world_id!)
      .history(before.participant_id!, "see", "out", 0),
  ).toEqual(known);
  expect(
    (
      await databases.postgres.query(
        "SELECT count(*) FROM operation_audit WHERE request_id=$1 AND outcome='accepted'",
        [payload.requestId],
      )
    ).rows[0].count,
  ).toBe("1");
  expect(
    JSON.stringify(
      (
        await databases.postgres.query(
          "SELECT * FROM operation_audit WHERE actor_id=$1",
          [person.subject],
        )
      ).rows,
    ),
  ).not.toContain(legacy.token);
});

test("他人の引き継ぎ・対象変更・同時確定を拒否する", async () => {
  const legacy = await legacyFixture(),
    one = await session("user"),
    two = await session("user");
  const preview = await auth.operations.legacyPreview(
    one.subject,
    legacy.token,
  );
  await expect(
    auth.operations.execute(
      one.subject,
      randomUUID(),
      { operation: "account.claim", version: preview.version },
      { legacyToken: randomUUID() },
    ),
  ).rejects.toMatchObject({ code: "LEGACY_COOKIE_REQUIRED" });
  await databases.postgres.query(
    "UPDATE world_access SET actor_id=$2 WHERE subject_id=$1 AND role='player'",
    [legacy.legacyId, randomUUID()],
  );
  await expect(
    auth.operations.execute(
      one.subject,
      randomUUID(),
      { operation: "account.claim", version: preview.version },
      { legacyToken: legacy.token },
    ),
  ).rejects.toMatchObject({ code: "CLAIM_CHANGED" });
  const updated = await auth.operations.legacyPreview(
    one.subject,
    legacy.token,
  );
  const results = await Promise.allSettled(
    [one, two].map((p) =>
      auth.operations.execute(
        p.subject,
        randomUUID(),
        { operation: "account.claim", version: updated.version },
        { legacyToken: legacy.token },
      ),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "LEGACY_ALREADY_CLAIMED" },
  });
});

test("BANと降格を既存の世界APIと再送へ反映する", async () => {
  const scene = await fixture();
  await databases.postgres.query(
    "UPDATE app_user SET role='user' WHERE id=$1",
    [scene.subject],
  );
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/worlds",
        headers: headers(scene.cookie),
        payload: { requestId: scene.requestId, prompt: "初期世界の自由記述" },
      })
    ).statusCode,
  ).toBe(403);
  await databases.postgres.query(
    "UPDATE app_user SET banned=true WHERE id=$1",
    [scene.subject],
  );
  await expect(access.status(scene.subject, scene.id)).rejects.toMatchObject({
    code: "USER_BANNED",
  });
  expect(
    (
      await app.inject({ url: "/api/session", headers: headers(scene.cookie) })
    ).json().code,
  ).toBe("USER_BANNED");
});

test.each(["users.ban", "users.role"] as const)(
  "%sを接続済みSSEへ反映する",
  async (operation) => {
    const scene = await fixture(),
      manager = await session();
    const controller = new AbortController();
    const response = await fetch(
      `${address}/api/worlds/${scene.id}/events?role=admin`,
      { headers: { cookie: scene.cookie }, signal: controller.signal },
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
      await reader.read();
      await auth.operations.execute(
        manager.subject,
        randomUUID(),
        operation === "users.ban"
          ? { operation, userId: scene.subject, banned: true, reason: "テスト" }
          : {
              operation,
              userId: scene.subject,
              role: "user",
              reason: "テスト",
            },
      );
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        while (!(await reader.read()).done) {
          /* Revocation closes the stream. */
        }
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      controller.abort();
      await reader.cancel();
    }
  },
);

test("認証済みでも未登録の利用者は世界APIへ進めない", async () => {
  const person = await auth.person("user");
  await databases.postgres.query("DELETE FROM app_user WHERE id=$1", [
    person.id,
  ]);
  const r = await app.inject({
    url: "/api/session",
    headers: headers(person.cookie),
  });
  expect(r.statusCode).toBe(403);
  expect(r.json().code).toBe("REGISTRATION_REQUIRED");
});

test("引き継ぎ対象は全件をページで確認でき、確定も全対象へ適用する", async () => {
  const legacy = await legacyFixture(),
    person = await session("user");
  for (let i = 0; i < 53; i++) {
    const id = await runtime.builder.create(`引き継ぎ対象 ${i}`);
    ids.push(id);
    await databases.postgres.query(
      "INSERT INTO world_construction(id,state) VALUES($1,'generating')",
      [id],
    );
    await databases.postgres.query(
      "INSERT INTO world_access(subject_id,construction_id,role) VALUES($1,$2,'admin')",
      [legacy.legacyId, id],
    );
  }
  const first = await auth.operations.legacyPreview(
    person.subject,
    legacy.token,
  );
  expect(first.total).toBe(54);
  expect(first.items).toHaveLength(50);
  const next = await auth.operations.legacyPreview(
    person.subject,
    legacy.token,
    first.next!,
  );
  expect(next.items).toHaveLength(4);
  expect(next.next).toBeNull();
  expect(next.version).toBe(first.version);
  expect(new Set([...first.items, ...next.items].map((w) => w.id)).size).toBe(
    54,
  );
  const result = await auth.operations.execute(
    person.subject,
    randomUUID(),
    { operation: "account.claim", version: first.version },
    { legacyToken: legacy.token },
  );
  expect(result.worldCount).toBe(54);
  expect(
    (await auth.operations.legacyPreview(person.subject, legacy.token)).linked,
  ).toBe(true);
});

test("Oryの主体・世界の操作権・同一オリジンを確認し、要求を同時保存して再送する", async () => {
  const scene = await fixture();
  const duplicate = await app.inject({
    method: "POST",
    url: "/api/worlds",
    headers: headers(scene.cookie),
    payload: { requestId: scene.requestId, prompt: "初期世界の自由記述" },
  });
  expect(duplicate.json()).toEqual(scene.created);
  expect(
    (await app.inject({ url: `/api/worlds/${scene.id}` })).statusCode,
  ).toBe(401);
  const other = await session("user");
  expect(
    (
      await app.inject({
        url: `/api/worlds/${scene.id}`,
        headers: headers(other.cookie),
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/worlds/${scene.id}/commands`,
        headers: { cookie: scene.cookie },
        payload: { requestId: randomUUID(), command: "finish" },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/worlds/${scene.id}/commands`,
        headers: { ...headers(scene.cookie), origin: "https://other.invalid" },
        payload: { requestId: randomUUID(), command: "finish" },
      })
    ).statusCode,
  ).toBe(403);
  const input = {
    requestId: randomUUID(),
    command: "advance",
    duration: WORLD_DAY_MS,
  };
  for (const duration of [0, WORLD_DAY_MS - 1, WORLD_DAY_MS * 1.5])
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/worlds/${scene.id}/commands`,
          headers: headers(scene.cookie),
          payload: { ...input, duration },
        })
      ).statusCode,
    ).toBe(400);
  expect((await runtime.get(scene.id)).state).toBe("ready");
  const results = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: "POST",
        url: `/api/worlds/${scene.id}/commands`,
        headers: headers(scene.cookie),
        payload: input,
      }),
    ),
  );
  expect(results.map((reply) => reply.statusCode)).toEqual([202, 202]);
  expect(results[0]!.json()).toEqual(results[1]!.json());
  expect((await runtime.get(scene.id)).target).toBe(WORLD_DAY_MS);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/worlds/${scene.id}/commands`,
        headers: headers(scene.cookie),
        payload: { ...input, duration: WORLD_DAY_MS * 2 },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/worlds/${scene.id}/commands`,
        headers: headers(scene.cookie),
        payload: { requestId: randomUUID(), command: "finish" },
      })
    ).statusCode,
  ).toBe(409);
  const jobs = await databases.postgres.query(
    "SELECT id FROM pgboss.job WHERE name=$1 AND data->>'id'=$2",
    [queueName, scene.id],
  );
  expect(jobs.rowCount).toBe(2);
});

test("管理記録と村民の知識を分離し、全件を省略せずページで取得する", async () => {
  const scene = await fixture();
  const initial = await app.inject({
    url: `/api/worlds/${scene.id}/records`,
    headers: headers(scene.cookie),
  });
  expect(initial.json().items).toEqual([
    expect.objectContaining({ id: "initial", summary: "管理者向けの初期記録" }),
  ]);
  for (const command of ["finish", "join"]) {
    const reply = await app.inject({
      method: "POST",
      url: `/api/worlds/${scene.id}/commands`,
      headers: headers(scene.cookie),
      payload: { requestId: randomUUID(), command },
    });
    expect(reply.statusCode).toBe(202);
  }
  await runtime.tick(scene.id);
  const row = await runtime.get(scene.id),
    store = runtime.agent.store;
  const adminCursor = (
    await access.events(scene.subject, scene.id, "admin", "0")
  )[0]!.id;
  expect(
    (
      await app.inject({
        url: `/api/worlds/${scene.id}/events?role=player&after=${adminCursor}`,
        headers: headers(scene.cookie),
      })
    ).statusCode,
  ).toBe(409);
  await store.commit(
    await store.claim(row.world_id!, randomUUID()),
    store.context(row.world_id!),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        ...empty(),
        edges: Array.from({ length: 55 }, (_, index) => ({
          id: randomUUID(),
          kind: "see",
          source: row.participant_id!,
          target: row.root_ids[0]!,
          text: `追加の知覚 ${index}`,
          period: { from: 0 },
        })),
      },
    },
  );
  let before: string | undefined;
  let newer: string | undefined;
  let firstIds: string[] = [];
  const records: { id: string; text: string }[] = [];
  do {
    const reply = await app.inject({
      url: `/api/worlds/${scene.id}/knowledge${before ? `?before=${before}` : ""}`,
      headers: headers(scene.cookie),
    });
    expect(reply.statusCode).toBe(200);
    for (const secret of ["PRIVATE_", "試遊主体だけが得た情報", "管理者向け"])
      expect(reply.body).not.toContain(secret);
    const page = reply.json();
    if (!before) firstIds = page.items.map((item: { id: string }) => item.id);
    else newer = page.previous;
    expect(page.items.length).toBeLessThanOrEqual(50);
    records.push(...page.items);
    before = page.next;
  } while (before);
  expect(records).toHaveLength(56);
  expect(records.map((item) => item.text)).toContain(
    "自分で見た風景。川へ向かう人を見かけた。",
  );
  expect(new Set(records.map((item) => item.id)).size).toBe(56);
  const reverse = (
    await app.inject({
      url: `/api/worlds/${scene.id}/knowledge?after=${newer}`,
      headers: headers(scene.cookie),
    })
  ).json();
  expect(reverse.items.map((item: { id: string }) => item.id)).toEqual(
    firstIds,
  );
  expect(reverse.previous).toBeNull();
  const beforeReads = (
    await store
      .context(row.world_id!)
      .history(row.participant_id!, "see", "out", 0)
  ).length;
  await app.inject({
    url: `/api/worlds/${scene.id}/knowledge`,
    headers: headers(scene.cookie),
  });
  expect(
    (
      await store
        .context(row.world_id!)
        .history(row.participant_id!, "see", "out", 0)
    ).length,
  ).toBe(beforeReads);
});

test("SSEを保存済みIDから再送し、他の世界のcursorと権限失効を拒否する", async () => {
  const scene = await fixture(),
    other = await fixture();
  const first = (await access.events(scene.subject, scene.id, "admin", "0"))[0]!
    .id;
  const foreign = (
    await access.events(other.subject, other.id, "admin", "0")
  )[0]!.id;
  expect(
    (
      await fetch(
        `${address}/api/worlds/${scene.id}/events?role=admin&after=${foreign}`,
        { headers: { cookie: scene.cookie } },
      )
    ).status,
  ).toBe(409);
  const controller = new AbortController();
  const response = await fetch(
    `${address}/api/worlds/${scene.id}/events?role=admin`,
    {
      headers: { cookie: scene.cookie, "Last-Event-ID": first },
      signal: controller.signal,
    },
  );
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  let received = "";
  try {
    while (!received.includes("event: update"))
      received += new TextDecoder().decode((await reader.read()).value);
    expect(received).not.toContain(`id: ${first}\n`);
    expect(received).not.toContain("PRIVATE_");
    auth.logout(scene.cookie);
    while (!(await reader.read()).done) {
      /* Wait for the authorized stream to close. */
    }
    expect(
      (
        await app.inject({
          url: `/api/worlds/${scene.id}`,
          headers: headers(scene.cookie),
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    controller.abort();
    await reader.cancel();
  }
});

test("他者による世界確定を本人の受容に限って通知し、二重DB間の停止から配信だけを回復する", async () => {
  const scene = await fixture(),
    row = await runtime.get(scene.id);
  const actor = row.actor_id!,
    store = runtime.agent.store;
  await databases.postgres.query(
    "INSERT INTO world_access(subject_id,construction_id,role,actor_id) VALUES($1,$2,'player',$3)",
    [scene.subject, scene.id, actor],
  );
  const before = (await access.cursor(scene.subject, scene.id, "player"))
    .cursor;
  const secret = randomUUID();
  const commit = async (changes: unknown) =>
    store.commit(
      await store.claim(row.world_id!, randomUUID()),
      store.context(row.world_id!),
      { commitId: randomUUID(), at: 0, changes },
    );
  await commit({
    ...empty(),
    nodes: [{ id: secret, kind: "existence", text: "PRIVATE_UNOBSERVED" }],
  });
  expect(
    await access.events(scene.subject, scene.id, "player", before),
  ).toEqual([]);
  const receipt = await commit({
    ...empty(),
    edges: [
      {
        id: randomUUID(),
        kind: "see",
        source: actor,
        target: secret,
        text: "他者の働きかけで灯りが見えた",
        period: { from: 0 },
      },
    ],
  });
  // An older receipt is migrated only on first delivery access to its world.
  await databases.graph.executeQuery(
    "MATCH(r:WorldReceipt {worldId:$worldId,commitId:$commitId}) REMOVE r.pendingDelivery",
    { worldId: row.world_id!, commitId: receipt.commitId },
  );
  await databases.graph.executeQuery(
    "MATCH(g:WorldGuard {worldId:$worldId,key:'delivery:initialized'}) DELETE g",
    { worldId: row.world_id! },
  );
  const acknowledge = vi
    .spyOn(store, "ackReceipt")
    .mockRejectedValueOnce(new Error("通知保存後に停止"));
  try {
    await expect(
      access.events(scene.subject, scene.id, "player", before),
    ).rejects.toThrow("通知保存後に停止");
    const restarted = new WorldAccess(runtime);
    const events = await restarted.events(
      scene.subject,
      scene.id,
      "player",
      before,
    );
    expect(events).toHaveLength(1);
    expect(
      await restarted.events(scene.subject, scene.id, "player", before),
    ).toEqual(events);
    expect(
      await restarted.events(scene.subject, scene.id, "player", events[0]!.id),
    ).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("PRIVATE_");
    expect(await store.receipt(row.world_id!, receipt.commitId)).toEqual(
      receipt,
    );
    expect(
      (
        await store.context(row.world_id!).history(actor, "see", "out", 0)
      ).filter((e) => e.target === secret),
    ).toHaveLength(1);
    expect(await store.pendingReceipts(row.world_id!)).toEqual([]);
  } finally {
    acknowledge.mockRestore();
  }
});

test("同じ世界の同時通知はコミット順に採番し、取得済みcursorの後へ遅い通知を残す", async () => {
  const scene = await fixture();
  await access.cursor(scene.subject, scene.id, "admin");
  const first = await databases.postgres.connect(),
    second = await databases.postgres.connect();
  const sql =
    "INSERT INTO world_event(subject_id,construction_id,role,event_key) VALUES($1,$2,'admin',$3) RETURNING id::text";
  try {
    await first.query("BEGIN");
    await second.query("BEGIN");
    const pid = (await second.query("SELECT pg_backend_pid() AS id")).rows[0]
      .id;
    await first.query(sql, [scene.subject, scene.id, randomUUID()]);
    const blocked = second.query(sql, [scene.subject, scene.id, randomUUID()]);
    await vi.waitFor(async () =>
      expect(
        (
          await databases.postgres.query(
            "SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted",
            [pid],
          )
        ).rowCount,
      ).toBe(1),
    );
    await first.query(sql, [scene.subject, scene.id, randomUUID()]);
    await first.query("COMMIT");
    const late = (await blocked).rows[0].id;
    const cursor = (await access.cursor(scene.subject, scene.id, "admin"))
      .cursor;
    await second.query("COMMIT");
    expect(BigInt(late)).toBeGreaterThan(BigInt(cursor));
    expect(
      await access.events(scene.subject, scene.id, "admin", cursor),
    ).toEqual([{ id: late }]);
  } finally {
    await first.query("ROLLBACK");
    await second.query("ROLLBACK");
    first.release();
    second.release();
  }
});

test("割当済みの村民へ自由記述を一度だけ受け付け、操作対象の自己申告を拒否する", async () => {
  const scene = await fixture();
  for (const command of ["finish", "join"])
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/worlds/${scene.id}/commands`,
          headers: headers(scene.cookie),
          payload: { requestId: randomUUID(), command },
        })
      ).statusCode,
    ).toBe(202);
  await runtime.tick(scene.id);
  const actor = (await runtime.get(scene.id)).participant_id!;
  const input = {
    requestId: randomUUID(),
    actionText: "近くの人に挨拶する。\r\n辺りを見渡す。",
  };
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/worlds/${scene.id}/actions`,
        headers: headers(scene.cookie),
        payload: { ...input, actorId: randomUUID() },
      })
    ).statusCode,
  ).toBe(400);
  const accepted = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: "POST",
        url: `/api/worlds/${scene.id}/actions`,
        headers: headers(scene.cookie),
        payload: input,
      }),
    ),
  );
  expect(accepted.map((reply) => reply.statusCode)).toEqual([202, 202]);
  expect(accepted[0]!.json()).toEqual(accepted[1]!.json());
  expect(accepted[0]!.json()).toEqual({
    id: scene.id,
    viewerId: actor,
    runId: input.requestId,
    at: 0,
    state: "running",
    error: null,
  });
  expect((await runtime.get(scene.id)).agenda).toContainEqual(
    expect.objectContaining({
      actorId: actor,
      actionText: input.actionText,
      mode: "action",
    }),
  );
  const jobs = await databases.postgres.query(
    "SELECT id FROM pgboss.job WHERE name=$1 AND data->>'id'=$2",
    [`${queueName}-play`, scene.id],
  );
  expect(jobs.rowCount).toBe(1);
  const other = await session();
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/worlds/${scene.id}/actions`,
        headers: headers(other.cookie),
        payload: { ...input, requestId: randomUUID() },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: `/api/worlds/${scene.id}/play`,
        headers: headers(scene.cookie),
      })
    ).json(),
  ).toEqual({
    id: scene.id,
    viewerId: actor,
    runId: input.requestId,
    at: 0,
    state: "running",
    error: null,
  });
  expect(
    (
      await app.inject({
        url: `/api/runs/${input.requestId}`,
        headers: headers(scene.cookie),
      })
    ).json(),
  ).toMatchObject({
    id: input.requestId,
    worldId: scene.id,
    actionText: input.actionText,
    state: "running",
    at: 0,
    startedAt: 0,
  });
  expect(
    (
      await app.inject({
        url: `/api/runs/${input.requestId}`,
        headers: headers(other.cookie),
      })
    ).statusCode,
  ).toBe(404);
});
