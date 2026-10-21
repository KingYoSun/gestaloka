import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  RuntimeControl,
  RuntimeExecutions,
  ExecutionBudget,
} from "@gestaloka/server";
import { WorldAccess } from "@gestaloka/server/access";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { createApp } from "../../apps/api/src/app.js";

let isolated: ReturnType<typeof isolatedDatabases>,
  runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  auth: Awaited<ReturnType<typeof fixtureAuth>>,
  access: WorldAccess,
  admin: string,
  user: string,
  scope: string;
let transform:
  ((content: unknown, user: Record<string, unknown>) => unknown) | undefined;
const gate = () => {
  let release!: () => void;
  const ready = new Promise<void>((r) => {
    release = r;
  });
  let arrived = false;
  return {
    ready,
    release: () => {
      arrived = true;
      release();
    },
    wait: () =>
      vi.waitFor(() => expect(arrived).toBe(true), { timeout: 10000 }),
  };
};
const policy = async (paused: boolean) => {
  const old = await RuntimeControl.read(isolated.databases.postgres);
  return auth.operations.execute(admin, randomUUID(), {
    operation: "runtime.put",
    configuration: { ...old.configuration, paused },
    expectedVersion: old.version,
    reason: "試験",
  });
};
const create = async () =>
  (
    await access.create(admin, {
      requestId: randomUUID(),
      prompt: "停止と再開の確認",
      budgetUsd: 100,
    })
  ).id;
const resume = async (
  kind: "construction" | "scene" | "join",
  id: string,
  requestId = randomUUID(),
) =>
  auth.operations.execute(
    admin,
    requestId,
    { operation: "jobs.resume", kind, id, reason: "保存状態から再開" },
    { players: access.players },
  );
async function prepareJoin() {
  const world = await create();
  await runtime.tick(world);
  await access.command(admin, world, {
    command: "finish",
    requestId: randomUUID(),
  });
  await auth.operations.execute(admin, randomUUID(), {
    operation: "worlds.configure",
    worldId: world,
    title: "参加用",
    description: "検証",
    published: true,
    accepting: true,
    reason: "試験",
  });
  const presetId = randomUUID();
  await auth.operations.execute(admin, randomUUID(), {
    operation: "presets.put",
    presetId,
    title: "参加者",
    description: "確認用",
    settings: "この世界の一員になる",
    expectedVersion: 0,
    reason: "試験",
  });
  const id = randomUUID();
  await auth.operations.execute(
    user,
    id,
    { operation: "worlds.join", worldId: world, presetId, presetVersion: 1 },
    { players: access.players },
  );
  return { world, id };
}
beforeEach(async () => {
  isolated = isolatedDatabases();
  await isolated.setup();
  scope = `control-${randomUUID()}`;
  transform = undefined;
  ({ runtime } = await fixtureRuntime(
    scope,
    (c, u) => transform?.(c, u) ?? c,
    isolated.databases,
  ));
  auth = await fixtureAuth(isolated.databases.postgres);
  admin = (await auth.person()).id;
  user = (await auth.person("user")).id;
  access = new WorldAccess(runtime);
  await access.setup();
});
afterEach(async () => {
  const d = isolated.databases;
  for (const r of (await d.postgres.query("SELECT world_id FROM world_build"))
    .rows)
    await d.graph.executeQuery(
      "MATCH(n) WHERE n.worldId=$worldId DETACH DELETE n",
      { worldId: r.world_id },
    );
  for (const suffix of ["", "-play", "-scenes", "-joins"])
    await d.queue.deleteQueue(`e2e-${scope}${suffix}`);
  await d.queue.stop();
  await isolated.close();
});

test("停止中は新規生成を拒否し、閲覧と管理操作を維持する", async () => {
  const world = await create();
  await policy(true);
  await expect(create()).rejects.toMatchObject({ code: "MAINTENANCE" });
  expect((await access.status(admin, world)).id).toBe(world);
  const person = await auth.person(),
    app = await createApp(access, auth.identity, undefined, auth.operations);
  try {
    const denied = await app.inject({
      method: "POST",
      url: "/api/worlds",
      headers: { cookie: person.cookie, "x-gestaloka-request": "1" },
      payload: {
        requestId: randomUUID(),
        prompt: "直接APIからの生成",
        budgetUsd: 100,
      },
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().code).toBe("MAINTENANCE");
  } finally {
    await app.close();
  }
  await runtime.tick(world).catch(() => undefined);
  expect((await runtime.get(world)).state).toBe("paused");
  expect((await runtime.agent.model.ledger.summary()).calls).toBe(0);
  await expect(
    auth.operations.execute(user, randomUUID(), { operation: "runtime.read" }),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  await policy(false);
  const request = randomUUID();
  await resume("construction", world, request);
  await resume("construction", world, request);
  const queues = (
    await isolated.databases.postgres.query(
      "SELECT count(*)::int AS n FROM pgboss.job WHERE name=$1 AND data->>'id'=$2",
      [`e2e-${scope}`, world],
    )
  ).rows[0];
  expect(queues.n).toBe(2); // initial delivery and one resume
  await runtime.tick(world);
  expect((await runtime.get(world)).state).toBe("ready");
});

test.each(["maintenance", "ban", "demotion"] as const)(
  "API待機中の%sを反映し、応答の保存後に次の推論を止める",
  async (mode) => {
    const world = await create(),
      waiting = gate(),
      sent = gate();
    let proposals = 0;
    transform = async (c, u) => {
      if (u.initialPrompt) {
        proposals++;
        sent.release();
        await waiting.ready;
      }
      return c;
    };
    const running = runtime.tick(world).catch((error) => error);
    try {
      await sent.wait();
      if (mode !== "maintenance") await auth.person();
      if (mode === "maintenance") await policy(true);
      else
        await isolated.databases.postgres.query(
          mode === "ban"
            ? "UPDATE app_user SET banned=true WHERE id=$1"
            : "UPDATE app_user SET role='user' WHERE id=$1",
          [admin],
        );
    } finally {
      waiting.release();
    }
    expect(await running).toMatchObject({
      code:
        mode === "maintenance"
          ? "MAINTENANCE"
          : mode === "ban"
            ? "USER_BANNED"
            : "AUTHORITY_LOST",
    });
    expect((await runtime.get(world)).state).toBe("paused");
    expect(await runtime.agent.model.ledger.summary()).toMatchObject({
      calls: 1,
      unsettled: 0,
    });
    const graph = (
      await isolated.databases.postgres.query(
        "SELECT world_id FROM world_build WHERE run_id=$1",
        [world],
      )
    ).rows[0].world_id;
    expect(
      (
        await isolated.databases.graph.executeQuery(
          "MATCH(n:WorldNode {worldId:$worldId}) RETURN count(n) AS n",
          { worldId: graph },
        )
      ).records[0]!.get("n").toNumber(),
    ).toBe(0);
    if (mode === "maintenance") await policy(false);
    else
      await isolated.databases.postgres.query(
        "UPDATE app_user SET banned=false,role='admin' WHERE id=$1",
        [admin],
      );
    await resume("construction", world);
    await runtime.tick(world);
    expect((await runtime.get(world)).state).toBe("ready");
    expect(proposals).toBe(1);
    expect(await runtime.agent.model.ledger.summary()).toMatchObject({
      calls: 2,
      unsettled: 0,
    });
  },
);

test("確定判断の応答後に停止した場合、判断を再生成せず世界確定から再開する", async () => {
  const world = await create(),
    model = runtime.agent.model,
    original = model.complete.bind(model);
  const spy = vi
    .spyOn(model, "complete")
    .mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1] === "initial-commit") await policy(true);
      return result;
    });
  await expect(runtime.tick(world)).rejects.toMatchObject({
    code: "MAINTENANCE",
  });
  spy.mockRestore();
  expect((await model.ledger.summary()).calls).toBe(2);
  await policy(false);
  await resume("construction", world);
  await runtime.tick(world);
  expect((await runtime.get(world)).state).toBe("ready");
  expect((await model.ledger.summary()).calls).toBe(2);
  const job = await auth.operations.execute(admin, randomUUID(), {
    operation: "jobs.read",
    kind: "construction",
    id: world,
  });
  expect(job.job).toMatchObject({
    id: world,
    userId: admin,
    responseId: world,
    deliveries: 2,
    state: "ready",
    calls: { used: 2 },
  });
  expect(JSON.stringify(job)).not.toMatch(/PRIVATE_|reasoning_content/);
});

test("未開始の参加生成をBANで止め、解除後に同じ参加要求を再開する", async () => {
  const { world, id } = await prepareJoin();
  await isolated.databases.postgres.query(
    "UPDATE app_user SET banned=true WHERE id=$1",
    [user],
  );
  const calls = (await runtime.agent.model.ledger.summary()).calls;
  await expect(access.players.tick(id)).rejects.toMatchObject({
    code: "USER_BANNED",
  });
  expect((await runtime.agent.model.ledger.summary()).calls).toBe(calls);
  await expect(resume("join", id)).rejects.toMatchObject({
    code: "USER_BANNED",
  });
  await isolated.databases.postgres.query(
    "UPDATE app_user SET banned=false WHERE id=$1",
    [user],
  );
  await resume("join", id);
  await access.players.tick(id);
  expect((await access.players.list(user, world)).items).toHaveLength(1);
});

test("古いワーカーからの新たな送信を拒否し、現行実行の状態を上書きしない", async () => {
  const pool = isolated.databases.postgres,
    id = randomUUID(),
    old = gate(),
    started = gate();
  let invoked = false;
  const running = RuntimeExecutions.run(
    pool,
    "construction",
    id,
    undefined,
    () =>
      ExecutionBudget.run(pool, randomUUID(), async () => {
        started.release();
        await old.ready;
        await ExecutionBudget.check();
        invoked = true;
      }),
  ).catch((e) => e);
  await started.wait();
  await RuntimeExecutions.run(
    pool,
    "construction",
    id,
    undefined,
    async () => {},
  );
  old.release();
  expect(await running).toMatchObject({ code: "SUPERSEDED" });
  expect(invoked).toBe(false);
  expect(
    (
      await pool.query(
        "SELECT state,deliveries FROM runtime_execution WHERE id=$1",
        [id],
      )
    ).rows[0],
  ).toMatchObject({ state: "finished", deliveries: 2 });
});

test("明示した共有処理枠で待機し、解放後に続行する", async () => {
  const pool = isolated.databases.postgres,
    state = await RuntimeControl.read(pool);
  await auth.operations.execute(admin, randomUUID(), {
    operation: "runtime.put",
    configuration: { ...state.configuration, concurrency: 1 },
    expectedVersion: state.version,
    reason: "試験",
  });
  const first = gate(),
    ready = gate();
  let secondStarted = false;
  const a = RuntimeExecutions.run(
    pool,
    "construction",
    randomUUID(),
    undefined,
    async () => {
      ready.release();
      await first.ready;
    },
  );
  await ready.wait();
  const b = RuntimeExecutions.run(
    pool,
    "scene",
    randomUUID(),
    undefined,
    async () => {
      secondStarted = true;
    },
  );
  try {
    await vi.waitFor(async () =>
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM runtime_execution WHERE state='waiting'",
          )
        ).rows[0].n,
      ).toBe(1),
    );
    expect(secondStarted).toBe(false);
  } finally {
    first.release();
    await Promise.all([a, b]);
  }
  expect(secondStarted).toBe(true);
});

test("操作対象の権限失効を未開始シーンへ反映し、再付与後に同じシーンを再開する", async () => {
  const { world, id } = await prepareJoin();
  await access.players.tick(id);
  const actor = (await access.players.list(user, world)).items[0]!.actorId!,
    scene = (
      await access.sceneCommand(
        user,
        world,
        {
          requestId: randomUUID(),
          command: "prepare",
          purpose: "周囲を確かめる",
        },
        false,
        actor,
      )
    ).scene!;
  const pool = isolated.databases.postgres;
  await pool.query("UPDATE world_subject SET active=false WHERE user_id=$1", [
    user,
  ]);
  const before = (await runtime.agent.model.ledger.summary()).calls;
  await expect(access.scenes.tick(scene.id)).rejects.toMatchObject({
    code: "AUTHORITY_LOST",
  });
  expect((await runtime.agent.model.ledger.summary()).calls).toBe(before);
  await expect(resume("scene", scene.id)).rejects.toMatchObject({
    code: "AUTHORITY_LOST",
  });
  await pool.query("UPDATE world_subject SET active=true WHERE user_id=$1", [
    user,
  ]);
  await resume("scene", scene.id);
  await access.scenes.tick(scene.id);
  expect((await access.scene(user, world, false, actor)).scene).toMatchObject({
    id: scene.id,
    state: "ready",
  });
});

test("ワーカー中断時は未確定予約を残し、旧ワーカーと再開側の重複送信を防ぐ", async () => {
  const pool = isolated.databases.postgres,
    world = await create(),
    waiting = gate(),
    sent = gate();
  let proposals = 0;
  const jobId = (
    await pool.query(
      "SELECT id FROM pgboss.job WHERE name=$1 AND data->>'id'=$2",
      [`e2e-${scope}`, world],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE pgboss.job SET state='active' WHERE id=$1 AND name=$2",
    [jobId, `e2e-${scope}`],
  );
  transform = async (c, u) => {
    if (u.initialPrompt) {
      proposals++;
      sent.release();
      await waiting.ready;
    }
    return c;
  };
  const old = runtime.tick(world, jobId).catch((e) => e);
  try {
    await sent.wait();
    await pool.query(
      "UPDATE pgboss.job SET state='failed' WHERE id=$1 AND name=$2",
      [jobId, `e2e-${scope}`],
    );
    const read = await auth.operations.execute(admin, randomUUID(), {
      operation: "jobs.read",
      kind: "construction",
      id: world,
    });
    expect(read.job).toMatchObject({
      executionState: "interrupted",
      errorCode: "WORKER_INTERRUPTED",
      job: { id: jobId, state: "failed" },
    });
    expect(
      (await pool.query("SELECT delivery,state FROM llm_call")).rows[0],
    ).toMatchObject({ delivery: "unknown", state: "pending" });
    await resume("construction", world);
    await expect(runtime.tick(world)).rejects.toThrow("未確定");
    expect(proposals).toBe(1);
  } finally {
    waiting.release();
    await old;
  }
  expect(await runtime.agent.model.ledger.summary()).toMatchObject({
    calls: 1,
    unsettled: 0,
  });
  await resume("construction", world);
  await runtime.tick(world);
  expect((await runtime.get(world)).state).toBe("ready");
  expect(proposals).toBe(1);
});

test("ジョブ一覧のページ・世界・ユーザーの絞込みと費用への対応を確認する", async () => {
  const pool = isolated.databases.postgres;
  await pool.query(
    "WITH builds AS (INSERT INTO world_build(run_id,world_id,commit_id,initial_prompt) SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'fixture' FROM generate_series(1,51) RETURNING run_id) INSERT INTO world_construction(id,state,user_id) SELECT run_id,'generating',$1 FROM builds",
    [admin],
  );
  const first = (await auth.operations.execute(admin, randomUUID(), {
    operation: "jobs.list",
    query: { kind: "construction", userId: admin },
  })) as { items: { id: string }[]; next: string };
  expect(first.items).toHaveLength(50);
  const second = (await auth.operations.execute(admin, randomUUID(), {
    operation: "jobs.list",
    query: { kind: "construction", before: first.next, userId: admin },
  })) as { items: { id: string }[]; next: string | null };
  expect(second.items).toHaveLength(1);
  expect(second.next).toBeNull();
  const chosen = first.items[0]!.id;
  const selected = (await auth.operations.execute(admin, randomUUID(), {
    operation: "jobs.list",
    query: { worldId: chosen },
  })) as { items: { id: string }[] };
  expect(selected.items.map((r) => r.id)).toEqual([chosen]);
  await expect(
    auth.operations.execute(user, randomUUID(), {
      operation: "jobs.list",
      query: {},
    }),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  await expect(resume("construction", chosen)).rejects.toMatchObject({
    code: "STATE_CONFLICT",
  });
});
