import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { WORLD_DAY_MS } from "@gestaloka/contracts";
import { connectDatabases } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
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

async function fixture(
  pause = false,
  observationWake = false,
  pausePlay = false,
  omitReceiverWake = false,
  activityMilestone = false,
) {
  const budgetId = randomUUID();
  budgets.push(budgetId);
  const queueName = `construction-test-${randomUUID()}`;
  queues.push(queueName);
  const actor = randomUUID(),
    place = randomUUID();
  let interrupted = false;
  let playInterrupted = false;
  const actions: string[] = [];
  const intents: string[] = [];
  const plans: {
    actor: string;
    period: { from: number; until: number } | null;
    own: string[];
  }[] = [];
  const packets: {
    phase: string;
    at: number;
    until?: number;
    activityUntil?: number;
    intentions: {
      actorId: string;
      actionText: string;
      continuing: boolean;
      planUntil?: number;
    }[];
    triggerEdgeIds?: string[];
    controlledActionText?: string;
  }[] = [];
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
      if (user.observerId) {
        intents.push(user.observerId);
        plans.push({
          actor: user.observerId,
          period: user.planningPeriod ?? null,
          own: user.ownIntentions ?? [],
        });
        return response({ actionText: "知覚した場所へ働きかけ続ける" });
      }
      const request = user.request as {
        phase: string;
        at: number;
        until?: number;
        activityUntil?: number;
        controlledActorId?: string;
        controlledActionText?: string;
        triggerEdgeIds?: string[];
        actionText: string;
        intentions?: {
          actorId: string;
          actionText: string;
          continuing: boolean;
        }[];
      };
      if (request.phase === "observation" && pause && !interrupted) {
        interrupted = true;
        return response({ type: "pause", reason: "参照の確認を保留した" });
      }
      const proposal = {
        type: "propose",
        changes: empty(),
        summary: "局所的な確認記録",
        resolvedUntil: request.until ?? request.at + 100,
        wakeups: [] as unknown[],
      };
      if (request.intentions)
        packets.push({
          phase: request.phase,
          at: request.at,
          ...(request.until === undefined ? {} : { until: request.until }),
          ...(request.activityUntil === undefined
            ? {}
            : { activityUntil: request.activityUntil }),
          intentions: request.intentions,
          ...(request.triggerEdgeIds === undefined
            ? {}
            : { triggerEdgeIds: request.triggerEdgeIds }),
          ...(request.controlledActionText === undefined
            ? {}
            : { controlledActionText: request.controlledActionText }),
        });
      if (request.controlledActorId && request.intentions?.length) {
        if (
          request.phase === "resolution" &&
          request.intentions.every((member) => !member.actionText)
        )
          return response({
            ...proposal,
            resolvedUntil: request.at,
            wakeups: [{ actorId: place, at: request.at + 1, mode: "intent" }],
          });
        if (pausePlay && !playInterrupted) {
          playInterrupted = true;
          return response({ type: "pause", reason: "区間を保存して保留した" });
        }
        const human = request.intentions.find(
          (member) => member.actorId === request.controlledActorId,
        );
        const from = human ? request.controlledActorId : place,
          to = human ? place : request.controlledActorId;
        return response({
          ...proposal,
          changes: {
            ...empty(),
            edges: [
              {
                id: randomUUID(),
                kind: "effect",
                source: from,
                target: to,
                period: { from: request.at, until: proposal.resolvedUntil },
              },
              {
                id: randomUUID(),
                kind: "see",
                source: to,
                target: from,
                text: human ? human.actionText : "本人に届いた応答",
                period: { from: request.at, until: proposal.resolvedUntil },
              },
            ],
          },
          wakeups:
            human && omitReceiverWake
              ? []
              : [
                  {
                    actorId: to,
                    at: proposal.resolvedUntil + 1,
                    mode: "intent",
                  },
                ],
        });
      }
      if (activityMilestone && request.phase === "schedule" && request.at === 0)
        return response({
          ...proposal,
          wakeups: [{ actorId: place, at: 0, mode: "intent" }],
        });
      if (
        activityMilestone &&
        request.phase === "interaction" &&
        request.at === 0
      )
        return response({
          ...proposal,
          resolvedUntil: WORLD_DAY_MS / 2,
          wakeups: [{ actorId: actor, at: WORLD_DAY_MS / 2, mode: "intent" }],
        });
      if (request.phase === "observation" && observationWake)
        return response({
          ...proposal,
          wakeups: [{ actorId: place, at: WORLD_DAY_MS, mode: "resolve" }],
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
      if (request.phase === "interaction" || request.phase === "resolution") {
        actions.push(
          ...(request.intentions ?? [{ actionText: request.actionText }]).map(
            (item) => item.actionText,
          ),
        );
        proposal.wakeups.push({
          actorId: actor,
          at: proposal.resolvedUntil,
          mode: "resolve",
        });
      }
      return response(proposal);
    });
  const model = new LlmClient(
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
  return {
    id,
    runtime,
    agent,
    transport,
    actor,
    place,
    actions,
    intents,
    plans,
    packets,
  };
}
beforeAll(async () => {
  await databases.verify();
  databases.queue.on("error", console.error);
  await databases.queue.start();
});
afterAll(async () => {
  for (const name of queues) {
    await databases.queue.deleteQueue(name);
    await databases.queue.deleteQueue(`${name}-play`);
  }
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
    await scene.runtime.command(scene.id, "advance", WORLD_DAY_MS);
    await vi.waitFor(
      async () => {
        expect((await scene.runtime.get(scene.id)).state).toBe("ready");
      },
      { timeout: 30000, interval: 100 },
    );
    expect((await scene.runtime.get(scene.id)).at).toBe(WORLD_DAY_MS);
    const records = (await scene.runtime.report(scene.id)).records;
    expect(new Set(records.map((record) => record.operation_id)).size).toBe(
      records.length,
    );
    expect(scene.actions).toHaveLength(1);
  } finally {
    await databases.queue.offWork(scene.runtime.queueName);
    await databases.queue.offWork(`${scene.runtime.queueName}-play`);
  }
});

test("知覚の更新で生じた未処理の作用を区間の次へ保持する", async () => {
  const scene = await fixture(false, true);
  await scene.runtime.command(scene.id, "advance", WORLD_DAY_MS);
  const row = await reach(scene.runtime, scene.id);
  expect(row.state).toBe("ready");
  expect(row.agenda).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actorId: scene.place,
        at: WORLD_DAY_MS,
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

test("同時刻の意図をそろえ、NPCの反応を経て人間へ操作を返す", async () => {
  const scene = await fixture();
  await scene.runtime.command(scene.id, "finish");
  await scene.runtime.command(scene.id, "join");
  await scene.runtime.tick(scene.id);
  const joined = await scene.runtime.get(scene.id),
    human = joined.participant_id!;
  const previous = "継続中の意図を保持する";
  await databases.postgres.query(
    "UPDATE world_construction SET agenda=$2 WHERE id=$1",
    [
      scene.id,
      JSON.stringify([
        { id: randomUUID(), at: 0, mode: "intent", actorId: scene.place },
        {
          id: randomUUID(),
          at: 0,
          mode: "resolve",
          actorId: scene.actor,
          actionText: previous,
        },
      ]),
    ],
  );
  const actionText = "近くの相手へ声をかける。\n返答を待つ。";
  await scene.runtime.play(scene.id, actionText);
  for (
    let count = 0;
    count < 10 && (await scene.runtime.get(scene.id)).state === "playing";
    count++
  )
    await scene.runtime.tick(scene.id);
  const row = await scene.runtime.get(scene.id);
  expect(row.state).toBe("finished");
  expect(row.at).toBeGreaterThan(0);
  const first = scene.packets[0]!;
  expect(first.until).toBeUndefined();
  expect(first.activityUntil).toBeUndefined();
  expect(scene.plans.every((plan) => plan.period === null)).toBe(true);
  expect(new Set(first.intentions.map((member) => member.actorId)).size).toBe(
    3,
  );
  expect(first.intentions).toContainEqual({
    actorId: human,
    actionText,
    continuing: false,
  });
  expect(first.intentions).toContainEqual({
    actorId: scene.actor,
    actionText: previous,
    continuing: true,
  });
  expect(scene.intents).not.toContain(human);
  expect(scene.intents.filter((actor) => actor === scene.place)).toHaveLength(
    2,
  );
  expect(
    (await scene.agent.view(row.world_id!, human, row.at)).observations.map(
      (item) => item.text,
    ),
  ).toContain("本人に届いた応答");
});

test("人間の行動を途中保留から再開し、既に形成したNPCの意図を再生成しない", async () => {
  const scene = await fixture(false, false, true);
  await scene.runtime.command(scene.id, "finish");
  await scene.runtime.command(scene.id, "join");
  await scene.runtime.tick(scene.id);
  const joined = await scene.runtime.get(scene.id),
    human = joined.participant_id!;
  await databases.postgres.query(
    "UPDATE world_construction SET agenda=$2 WHERE id=$1",
    [
      scene.id,
      JSON.stringify([
        { id: randomUUID(), at: 0, mode: "intent", actorId: scene.place },
      ]),
    ],
  );
  const actionText = "相手へ問いかける";
  await scene.runtime.play(scene.id, actionText);
  await expect(scene.runtime.tick(scene.id)).rejects.toThrow(
    "区間を保存して保留した",
  );
  expect((await scene.runtime.get(scene.id)).state).toBe("play_paused");
  expect(
    (
      await databases.postgres.query(
        "SELECT state FROM world_run WHERE construction_id=$1",
        [scene.id],
      )
    ).rows[0].state,
  ).toBe("paused");
  const formed = scene.intents.length;
  const stopped = await scene.runtime.get(scene.id);
  const cached = stopped.current!.members!.find(
    (member) => member.actorId === scene.place,
  )!;
  const cachedId = cached.id;
  delete cached.actionText;
  await databases.postgres.query(
    "UPDATE world_construction SET current=$2 WHERE id=$1",
    [scene.id, JSON.stringify(stopped.current)],
  );
  await scene.runtime.command(scene.id, "resume");
  expect(
    (await scene.runtime.get(scene.id)).current!.members!.find(
      (member) => member.actorId === scene.place,
    )!.id,
  ).toBe(cachedId);
  await scene.runtime.tick(scene.id);
  expect(scene.intents).toHaveLength(formed);
  for (
    let count = 0;
    count < 10 && (await scene.runtime.get(scene.id)).state === "playing";
    count++
  )
    await scene.runtime.tick(scene.id);
  expect((await scene.runtime.get(scene.id)).state).toBe("finished");
  expect(scene.intents).not.toContain(human);
  expect(
    scene.packets
      .slice(0, 2)
      .map(
        (packet) =>
          packet.intentions.find((member) => member.actorId === human)
            ?.actionText,
      ),
  ).toEqual([actionText, actionText]);
});

test("起動の提案がなくても確定した作用の受け手を評価し、人間の元の意図を保持する", async () => {
  const scene = await fixture(false, false, false, true);
  await scene.runtime.command(scene.id, "finish");
  await scene.runtime.command(scene.id, "join");
  await scene.runtime.tick(scene.id);
  const human = (await scene.runtime.get(scene.id)).participant_id!;
  const actionText = "相手に問いかけ、応答を待つ";
  await scene.runtime.play(scene.id, actionText);
  for (
    let count = 0;
    count < 10 && (await scene.runtime.get(scene.id)).state === "playing";
    count++
  )
    await scene.runtime.tick(scene.id);
  expect((await scene.runtime.get(scene.id)).state).toBe("finished");
  expect(scene.intents).toEqual([scene.place]);
  expect(scene.intents).not.toContain(human);
  const recovery = scene.packets.find(
    (packet) => packet.phase === "resolution",
  )!;
  expect(recovery.triggerEdgeIds).toHaveLength(2);
  const world = (await scene.runtime.get(scene.id)).world_id!;
  for (const id of recovery.triggerEdgeIds!)
    expect(await scene.agent.store.context(world).edge(id)).toBeDefined();
  expect(
    scene.packets.every((packet) => packet.controlledActionText === actionText),
  ).toBe(true);
});

test("時間指定・追加進行・明示完了・別の村民の参加で履歴と継続を保持する", async () => {
  const scene = await fixture();
  for (const duration of [WORLD_DAY_MS - 1, WORLD_DAY_MS * 1.5])
    await expect(
      scene.runtime.command(scene.id, "advance", duration),
    ).rejects.toThrow();
  expect((await scene.runtime.get(scene.id)).target).toBe(0);
  await scene.runtime.command(scene.id, "advance", WORLD_DAY_MS);
  let row = await reach(scene.runtime, scene.id);
  expect(row).toMatchObject({
    state: "ready",
    at: WORLD_DAY_MS,
    target: WORLD_DAY_MS,
    participant_id: null,
  });
  expect(row.agenda).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        mode: "resolve",
        actorId: scene.actor,
        at: WORLD_DAY_MS,
      }),
    ]),
  );
  const first = await scene.runtime.report(scene.id);
  await scene.runtime.command(scene.id, "advance", WORLD_DAY_MS);
  row = await reach(scene.runtime, scene.id);
  expect(row).toMatchObject({ state: "ready", at: WORLD_DAY_MS * 2 });
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
  const before = await scene.agent.view(
    row.world_id!,
    scene.actor,
    WORLD_DAY_MS * 2,
  );
  await scene.runtime.command(scene.id, "join");
  await scene.runtime.tick(scene.id);
  row = await scene.runtime.get(scene.id);
  expect(row.participant_id).not.toBe(scene.actor);
  expect(
    await scene.agent.view(row.world_id!, scene.actor, WORLD_DAY_MS * 2),
  ).toEqual(before);
  expect(
    (
      await scene.agent.view(
        row.world_id!,
        row.participant_id!,
        WORLD_DAY_MS * 2,
      )
    ).observations.map((item) => item.text),
  ).toEqual(["自分で得た初期観測"]);
  await scene.runtime.command(scene.id, "join");
  expect((await scene.runtime.get(scene.id)).participant_id).toBe(
    row.participant_id,
  );
});

test("途中保留を時刻到達・構築完了と区別し、再開して同じ世界へ到達する", async () => {
  const scene = await fixture(true);
  await scene.runtime.command(scene.id, "advance", WORLD_DAY_MS);
  await scene.runtime.tick(scene.id);
  await expect(scene.runtime.tick(scene.id)).rejects.toThrow(
    "参照の確認を保留した",
  );
  const stopped = await scene.runtime.get(scene.id);
  expect(stopped).toMatchObject({
    state: "paused",
    at: 0,
    target: WORLD_DAY_MS,
  });
  await expect(scene.runtime.command(scene.id, "finish")).rejects.toThrow(
    "指定時刻へ到達",
  );
  await scene.runtime.command(scene.id, "resume");
  const resumed = await reach(scene.runtime, scene.id);
  expect(resumed).toMatchObject({
    state: "ready",
    at: WORLD_DAY_MS,
    world_id: stopped.world_id,
    actor_id: stopped.actor_id,
  });
  expect(scene.actions).toHaveLength(1);
});

test("確定後の構築進捗喪失を同じoperationのreceiptから復旧する", async () => {
  const scene = await fixture();
  await scene.runtime.command(scene.id, "advance", WORLD_DAY_MS);
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

test("活動方針を節目まで継続し、重要な判断と追加期間では本人の方針を更新する", async () => {
  const scene = await fixture(false, false, false, false, true);
  await scene.runtime.command(scene.id, "advance", WORLD_DAY_MS);
  expect((await reach(scene.runtime, scene.id)).at).toBe(WORLD_DAY_MS);
  const packets = scene.packets.filter(
    (packet) => packet.phase === "interaction",
  );
  expect(packets[0]).toMatchObject({ activityUntil: WORLD_DAY_MS, at: 0 });
  expect(packets[0]!.intentions).toHaveLength(2);
  expect(
    packets[0]!.intentions.every((member) => member.planUntil === WORLD_DAY_MS),
  ).toBe(true);
  expect(packets[1]).toMatchObject({
    at: WORLD_DAY_MS / 2,
    activityUntil: WORLD_DAY_MS,
  });
  expect(
    packets[1]!.intentions.find((member) => member.actorId === scene.place),
  ).toMatchObject({ continuing: true, planUntil: WORLD_DAY_MS });
  expect(scene.plans.filter((plan) => plan.actor === scene.place)).toHaveLength(
    1,
  );
  const renewed = scene.plans.filter((plan) => plan.actor === scene.actor);
  expect(renewed).toHaveLength(2);
  expect(renewed[1]).toMatchObject({
    period: { from: WORLD_DAY_MS / 2, until: WORLD_DAY_MS },
    own: ["知覚した場所へ働きかけ続ける"],
  });
  const saved = (await scene.runtime.report(scene.id)).records;
  await scene.runtime.command(scene.id, "advance", WORLD_DAY_MS);
  expect((await reach(scene.runtime, scene.id)).at).toBe(WORLD_DAY_MS * 2);
  expect(
    scene.plans
      .slice(-2)
      .every(
        (plan) =>
          plan.period?.from === WORLD_DAY_MS &&
          plan.period.until === WORLD_DAY_MS * 2,
      ),
  ).toBe(true);
  expect(
    scene.plans
      .slice(-2)
      .every((plan) => plan.own.includes("知覚した場所へ働きかけ続ける")),
  ).toBe(true);
  expect(
    (await scene.runtime.report(scene.id)).records.slice(0, saved.length),
  ).toEqual(saved);
});
