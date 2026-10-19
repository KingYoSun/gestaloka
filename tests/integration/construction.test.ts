import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { DeepSeekClient } from "@gestaloka/server/llm";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldConstruction } from "@gestaloka/server/construction";

const databases = connectDatabases();
const ids: string[] = [],
  worlds: string[] = [],
  queues: string[] = [],
  budgets: string[] = [];
const empty = () => ({ nodes: [], edges: [], revisions: [], endEdges: [] });
const response = (content: unknown) =>
  new Response(
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

async function fixture(pause = false, observationWake = false) {
  const budgetId = randomUUID();
  budgets.push(budgetId);
  const queueName = `construction-test-${randomUUID()}`;
  queues.push(queueName);
  const actor = randomUUID(),
    place = randomUUID();
  let interrupted = false;
  const actions: string[] = [];
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, options) => {
      const input = JSON.parse(String(options?.body)) as {
        messages: { role: string; content: string }[];
      };
      const user = JSON.parse(
        input.messages.find((message) => message.role === "user")!.content,
      );
      if (user.initialPrompt)
        return response({
          playerId: actor,
          rootIds: [place],
          report: "初期参照を作成",
          changes: {
            ...empty(),
            nodes: [
              { id: actor, kind: "existence", text: "試遊主体" },
              { id: place, kind: "existence", text: "場所" },
            ],
            edges: [
              {
                id: randomUUID(),
                kind: "see",
                source: actor,
                target: place,
                text: "場所の一面を知覚した",
                period: { from: 0 },
              },
            ],
          },
        });
      if (user.observerId)
        return response({ actionText: "知覚した場所へ働きかけ続ける" });
      const request = user.request as {
        phase: string;
        at: number;
        until: number;
        actionText: string;
      };
      if (request.phase === "observation" && pause && !interrupted) {
        interrupted = true;
        return response({ type: "pause", reason: "参照の確認を保留した" });
      }
      const proposal = {
        type: "propose",
        changes: empty(),
        summary: "局所的な確認記録",
        resolvedUntil: request.until,
        wakeups: [] as unknown[],
      };
      if (request.phase === "observation" && observationWake)
        return response({
          ...proposal,
          wakeups: [{ actorId: place, at: 10000, mode: "resolve" }],
        });
      if (request.phase === "participant") {
        const newcomer = randomUUID();
        return response({
          ...proposal,
          newParticipantId: newcomer,
          changes: {
            ...empty(),
            nodes: [{ id: newcomer, kind: "existence", text: "別の参加者" }],
            edges: [
              {
                id: randomUUID(),
                kind: "see",
                source: newcomer,
                target: place,
                text: "自分で得た初期観測",
                period: { from: request.at },
              },
            ],
          },
        });
      }
      if (request.phase === "interaction") {
        actions.push(request.actionText);
        proposal.wakeups.push({
          actorId: actor,
          at: request.until,
          mode: "resolve",
        });
      }
      return response(proposal);
    });
  const model = new DeepSeekClient(
    databases.postgres,
    { DEEPSEEK_API_KEY: "unused", LLM_BUDGET_ID: budgetId },
    transport,
  );
  const agent = new WorldAgent(
    databases.postgres,
    databases.graph,
    databases.checkpointer,
    model,
  );
  const runtime = new WorldConstruction(
    new WorldBuilder(
      databases.postgres,
      databases.graph,
      databases.checkpointer,
      model,
    ),
    agent,
    databases.queue,
    queueName,
  );
  await runtime.setup();
  const id = await runtime.create("自由記述の初期入力");
  ids.push(id);
  await runtime.tick(id);
  worlds.push((await runtime.get(id)).world_id!);
  return { id, runtime, agent, transport, actor, place, actions };
}
beforeAll(async () => {
  await databases.verify();
  databases.queue.on("error", console.error);
  await databases.queue.start();
});
afterAll(async () => {
  for (const name of queues) await databases.queue.deleteQueue(name);
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
  await databases.postgres.query(
    "DELETE FROM world_intent WHERE world_id=ANY($1::uuid[])",
    [worlds],
  );
  await databases.postgres.query(
    "DELETE FROM llm_call WHERE budget_id=ANY($1)",
    [budgets],
  );
  await databases.postgres.query("DELETE FROM llm_budget WHERE id=ANY($1)", [
    budgets,
  ]);
  for (const worldId of worlds)
    await databases.graph.executeQuery(
      "MATCH(n) WHERE n.worldId=$worldId DETACH DELETE n",
      { worldId },
    );
  await databases.queue.stop();
  await databases.close();
});
async function reach(runtime: WorldConstruction, id: string) {
  for (let i = 0; i < 10; i++) {
    const row = await runtime.get(id);
    if (row.state !== "running") return row;
    await runtime.tick(id);
  }
  throw new Error("試験の期待する区切りに到達しませんでした");
}

test("受付した構築区間を独立したpg-bossワーカーが取得して進める", async () => {
  const scene = await fixture();
  await databases.queue.deleteQueue(scene.runtime.queueName);
  await scene.runtime.setup();
  await scene.runtime.work();
  try {
    await scene.runtime.command(scene.id, "advance", 10000);
    await vi.waitFor(
      async () => {
        expect((await scene.runtime.get(scene.id)).state).toBe("ready");
      },
      { timeout: 10000, interval: 100 },
    );
    expect((await scene.runtime.get(scene.id)).at).toBe(10000);
    const records = (await scene.runtime.report(scene.id)).records;
    expect(new Set(records.map((record) => record.operation_id)).size).toBe(
      records.length,
    );
    expect(scene.actions).toHaveLength(1);
  } finally {
    await databases.queue.offWork(scene.runtime.queueName);
  }
});

test("知覚の更新で生じた未処理の作用を区間の次へ保持する", async () => {
  const scene = await fixture(false, true);
  await scene.runtime.command(scene.id, "advance", 10000);
  const row = await reach(scene.runtime, scene.id);
  expect(row.state).toBe("ready");
  expect(row.agenda).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actorId: scene.place,
        at: 10000,
        mode: "resolve",
      }),
    ]),
  );
  expect(
    (await scene.runtime.report(scene.id)).records.some((record) =>
      record.result.wakeups.some((work) => work.actorId === scene.place),
    ),
  ).toBe(true);
});

test("時間指定・追加進行・明示完了・別の村民の参加で履歴と継続を保持する", async () => {
  const scene = await fixture();
  await scene.runtime.command(scene.id, "advance", 10000);
  let row = await reach(scene.runtime, scene.id);
  expect(row).toMatchObject({
    state: "ready",
    at: 10000,
    target: 10000,
    participant_id: null,
  });
  expect(row.agenda).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        mode: "resolve",
        actorId: scene.actor,
        at: 10000,
      }),
    ]),
  );
  const first = await scene.runtime.report(scene.id);
  await scene.runtime.command(scene.id, "advance", 5000);
  row = await reach(scene.runtime, scene.id);
  expect(row).toMatchObject({ state: "ready", at: 15000 });
  expect(scene.actions).toEqual([
    "知覚した場所へ働きかけ続ける",
    "知覚した場所へ働きかけ続ける",
  ]);
  const report = await scene.runtime.report(scene.id);
  expect(report.records.slice(0, first.records.length)).toEqual(first.records);
  const calls = scene.transport.mock.calls.length;
  await scene.runtime.get(scene.id);
  await scene.runtime.report(scene.id);
  expect(scene.transport).toHaveBeenCalledTimes(calls);
  await scene.runtime.command(scene.id, "finish");
  expect((await scene.runtime.get(scene.id)).state).toBe("finished");
  const before = await scene.agent.view(row.world_id!, scene.actor, 15000);
  await scene.runtime.command(scene.id, "join");
  await scene.runtime.tick(scene.id);
  row = await scene.runtime.get(scene.id);
  expect(row.participant_id).not.toBe(scene.actor);
  expect(await scene.agent.view(row.world_id!, scene.actor, 15000)).toEqual(
    before,
  );
  expect(
    (
      await scene.agent.view(row.world_id!, row.participant_id!, 15000)
    ).observations.map((item) => item.text),
  ).toEqual(["自分で得た初期観測"]);
  await scene.runtime.command(scene.id, "join");
  expect((await scene.runtime.get(scene.id)).participant_id).toBe(
    row.participant_id,
  );
});

test("途中保留を時刻到達・構築完了と区別し、再開して同じ世界へ到達する", async () => {
  const scene = await fixture(true);
  await scene.runtime.command(scene.id, "advance", 10000);
  await scene.runtime.tick(scene.id);
  await expect(scene.runtime.tick(scene.id)).rejects.toThrow(
    "参照の確認を保留した",
  );
  const stopped = await scene.runtime.get(scene.id);
  expect(stopped).toMatchObject({ state: "paused", at: 0, target: 10000 });
  await expect(scene.runtime.command(scene.id, "finish")).rejects.toThrow(
    "指定時刻へ到達",
  );
  await scene.runtime.command(scene.id, "resume");
  const resumed = await reach(scene.runtime, scene.id);
  expect(resumed).toMatchObject({
    state: "ready",
    at: 10000,
    world_id: stopped.world_id,
    actor_id: stopped.actor_id,
  });
  expect(scene.actions).toHaveLength(1);
});

test("確定後の構築進捗喪失を同じoperationのreceiptから復旧する", async () => {
  const scene = await fixture();
  await scene.runtime.command(scene.id, "advance", 10000);
  await scene.runtime.tick(scene.id);
  const original = scene.agent.run.bind(scene.agent);
  let staged: Awaited<ReturnType<WorldConstruction["get"]>> | undefined;
  const spy = vi
    .spyOn(scene.agent, "run")
    .mockImplementation(async (id, input) => {
      const row = await scene.runtime.get(scene.id);
      if (row.current?.operationId === id) staged = row;
      return original(id, input);
    });
  await reach(scene.runtime, scene.id);
  spy.mockRestore();
  expect(staged?.current?.operationId).toBeDefined();
  const calls = scene.transport.mock.calls.length;
  await databases.postgres.query(
    "DELETE FROM construction_log WHERE operation_id=$1",
    [staged!.current!.operationId],
  );
  await databases.postgres.query(
    "UPDATE world_construction SET state='running',at=$2,agenda=$3,current=$4 WHERE id=$1",
    [
      scene.id,
      staged!.at,
      JSON.stringify(staged!.agenda),
      JSON.stringify(staged!.current),
    ],
  );
  await scene.runtime.tick(scene.id);
  expect(scene.transport).toHaveBeenCalledTimes(calls);
  expect((await scene.runtime.get(scene.id)).state).toBe("ready");
  expect(
    (await scene.runtime.report(scene.id)).records.filter(
      (record) => record.operation_id === staged!.current!.operationId,
    ),
  ).toHaveLength(1);
});
