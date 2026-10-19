import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { WORLD_DAY_MS } from "@gestaloka/contracts";
import { connectDatabases } from "@gestaloka/server";
import { DeepSeekClient } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldConstruction } from "@gestaloka/server/construction";
import { WorldAccess } from "@gestaloka/server/access";
import { createApp } from "../../apps/api/src/app.js";

const databases = connectDatabases(),
  budgetId = randomUUID();
const subjects: string[] = [],
  ids: string[] = [],
  worlds: string[] = [];
const queueName = `api-test-${randomUUID()}`;
const empty = () => ({ nodes: [], edges: [], revisions: [], endEdges: [] });
const model = new DeepSeekClient(
  databases.postgres,
  { DEEPSEEK_API_KEY: "unused", LLM_BUDGET_ID: budgetId },
  async (_url, options) => {
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
                text: "自分で見た風景",
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
  },
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
const headers = (cookie: string) => ({ cookie, "x-gestaloka-request": "1" });
async function session() {
  const reply = await app.inject({
    method: "POST",
    url: "/api/session",
    headers: { "x-gestaloka-request": "1" },
  });
  expect(reply.statusCode).toBe(200);
  const subject = reply.json<{ id: string }>().id;
  expect(reply.headers["x-gestaloka-subject"]).toBe(subject);
  subjects.push(subject);
  const cookie = String(reply.headers["set-cookie"]).split(";")[0]!;
  expect(reply.headers["set-cookie"]).toContain("HttpOnly");
  expect(reply.headers["set-cookie"]).toContain("SameSite=Strict");
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
beforeAll(async () => {
  await databases.verify();
  databases.queue.on("error", console.error);
  await databases.queue.start();
  await access.setup();
  app = await createApp(access);
  address = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterAll(async () => {
  await app?.close();
  await databases.queue.deleteQueue(queueName);
  await databases.queue.deleteQueue(`${queueName}-play`);
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
  await databases.postgres.query(
    "DELETE FROM browser_session WHERE id=ANY($1)",
    [subjects],
  );
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

test("Cookieの主体・世界の操作権・同一オリジンを確認し、要求を同時保存して再送する", async () => {
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
  const other = await session();
  expect(
    (
      await app.inject({
        url: `/api/worlds/${scene.id}`,
        headers: headers(other.cookie),
      })
    ).statusCode,
  ).toBe(404);
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
    await databases.postgres.query(
      "UPDATE browser_session SET active=false WHERE id=$1",
      [scene.subject],
    );
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
