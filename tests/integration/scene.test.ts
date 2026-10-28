import { isolatedDatabases } from "../support/isolated-db.js";
import { WorldBudget } from "../../packages/server/src/llm/world-budget.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ExecutionBudget, ExecutionLimit } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldConstruction } from "@gestaloka/server/construction";
import { WorldAccess } from "@gestaloka/server/access";
import { createApp } from "../../apps/api/src/app.js";
import { fixtureAuth } from "../support/auth.js";
import { modelEnvironment, approvedTransport } from "../support/model.js";

const isolated = isolatedDatabases();
const d = isolated.databases,
  budget = randomUUID(),
  queue = `scene-test-${randomUUID()}`;
const actor = randomUUID(),
  npc = randomUUID(),
  place = randomUUID(),
  secret = randomUUID(),
  world = randomUUID(),
  construction = randomUUID();
let modelCalls = 0,
  worldPaused = false,
  resultCalls = 0;
const inputs: Record<string, unknown>[] = [],
  ids: string[] = [];
const model = new LlmClient(
  d.postgres,
  { ...modelEnvironment(budget), LLM_RESOLUTION_JUDGMENT: "combined" },
  approvedTransport(async (_url, options) => {
    modelCalls++;
    const body = JSON.parse(String(options?.body)),
      user = JSON.parse(
        body.messages.find((m: { role: string }) => m.role === "user").content,
      );
    inputs.push(user);
    let content: unknown;
    if (user.needsContext) {
      expect(user.stagedScene.events).toHaveLength(1);
      expect(user.stagedScene.events[0].text).toBe("若者が挨拶した");
      content = {
        type: "context",
        participants: [],
        creations: [],
        beliefs: [],
        resolvedUnknowns: [],
        facts: [
          {
            subjectId: place,
            text: "橋へ続く道が声をかけた場所から延びている",
            aboutIds: [actor],
          },
        ],
      };
    } else if (
      user.responseSchema?.oneOf?.some(
        (s: { properties?: { type?: { const?: string } } }) =>
          s.properties?.type?.const === "background",
      )
    )
      content = {
        type: "background",
        synopsis: "村の道に、話しかけられる距離の村人がいます。",
        participants: [actor, npc],
        facts: [
          {
            subjectId: npc,
            text: "村の道で若者の声が届く距離にいる",
            aboutIds: [actor, place],
          },
        ],
        perceptions: [
          { observerId: actor, text: "村人が見える", sourceIds: [npc] },
          { observerId: npc, text: "若者が見える", sourceIds: [actor] },
        ],
        unknowns: [],
      };
    else if (user.observerId) {
      expect(user.observerId).toBe(npc);
      expect(JSON.stringify(user)).toContain("NPCだけの秘密");
      expect(JSON.stringify(user)).not.toContain("人間だけの記憶");
      content = {
        actionText: "「明日の手伝いはこれから相談しよう」と伝え、返事を待つ。",
      };
    } else if (user.background) {
      const intentions = user.request.intentions as {
          actorId: string;
          actionText: string;
        }[],
        response = intentions.some((i) => i.actorId === npc);
      if (intentions.some((i) => i.actionText === "挨拶して橋を見に行く"))
        content = {
          type: "scene",
          events: [
            {
              actorId: actor,
              text: "若者が挨拶した",
              receipts: [
                {
                  observerId: actor,
                  text: "挨拶をした",
                  information: [{ id: "$event" }, { id: "$receipt" }],
                },
              ],
            },
          ],
          decisions: { [actor]: "finished" },
          newDecisions: [],
          elapsedMs: 1000,
          needsContext: {
            reason: "橋への道を確認する",
            remainingActions: {
              [actor]: "橋の方へ歩く",
              [npc]: "今回は選ばれていない行動を実行する",
            },
          },
        };
      else if (intentions.some((i) => i.actionText === "橋の方へ歩く")) {
        expect(user.background.facts.at(-1)).toMatchObject({ at: 1000 });
        expect(user.background.perceptions).toHaveLength(2);
        content = {
          type: "scene",
          events: [
            {
              actorId: actor,
              text: "若者が道を歩いた",
              receipts: [
                {
                  observerId: actor,
                  text: "道を進んだ",
                  information: [{ id: "$event" }, { id: "$receipt" }],
                },
              ],
            },
          ],
          decisions: { [actor]: "decide" },
          newDecisions: [],
          elapsedMs: 1000,
          needsContext: {
            reason: "橋の先は本人の次の選択を待つ",
            remainingActions: { [actor]: "" },
          },
        };
      } else if (intentions.some((i) => i.actionText === "礼だけを伝える"))
        content = {
          type: "scene",
          events: [
            {
              actorId: actor,
              text: "若者が礼を伝えた",
              receipts: [
                { observerId: actor, text: "礼を伝えた" },
                { observerId: npc, text: "若者から礼を聞いた" },
              ],
            },
          ],
          decisions: { [actor]: "finished" },
          newDecisions: [npc],
          elapsedMs: 0,
        };
      else if (intentions.some((i) => i.actionText === "別の場所へ向かう"))
        content = {
          type: "scene",
          events: [],
          decisions: Object.fromEntries(
            intentions.map((i) => [i.actorId, "pending"]),
          ),
          newDecisions: [],
          elapsedMs: 0,
        };
      else if (!response && user.sceneHistory.length) {
        // 返答待ちには新たな判断主体がなくても、同じ意図で時間が進む。
        expect(intentions).toEqual([
          {
            actorId: actor,
            actionText: "何か手伝えることはありますかと聞き、返答を待つ",
            continuing: true,
          },
        ]);
        expect(user.sceneHistory).toHaveLength(1);
        content = {
          type: "scene",
          events: [],
          decisions: { [actor]: "pending" },
          newDecisions: user.request.at === 0 ? [] : [npc],
          elapsedMs: user.request.at === 0 ? 1000 : 0,
        };
      } else if (
        intentions.find((i) => i.actorId === actor)?.actionText.includes("一歩")
      ) {
        content = {
          type: "scene",
          events: [
            {
              actorId: actor,
              text: "若者が一歩歩いた",
              receipts: [{ observerId: actor, text: "一歩近づいた" }],
            },
          ],
          decisions: { [actor]: "decide", [npc]: "pending" },
          newDecisions: [],
          elapsedMs: 1000,
        };
      } else {
        const owner = response ? npc : actor;
        content = {
          type: "scene",
          events: [
            {
              actorId: owner,
              text: response ? "村民が相談を持ちかけた" : "若者が質問した",
              receipts: [
                {
                  observerId: response ? actor : npc,
                  text: response
                    ? "明日の手伝いはこれから相談しようと聞いた"
                    : "何か手伝えることはありますかと聞かれた",
                },
              ],
            },
          ],
          decisions: response
            ? { [actor]: "decide", [npc]: "pending" }
            : { [actor]: "pending" },
          newDecisions: [],
        };
      }
    } else if (user.request?.completedScene) {
      content = worldPaused
        ? { type: "pause", reason: "世界への確定を保留する試験" }
        : {
            type: "propose",
            changes: { nodes: [], edges: [], endEdges: [] },
            summary: "PRIVATE_ADMIN_RESULT",
            resolvedUntil: user.request.until,
            settledIntentions: [],
            deferredIntentions: [actor, npc],
            wakeups: [],
          };
    } else if (user.confirmed) {
      resultCalls++;
      expect(JSON.stringify(user.confirmed)).not.toMatch(
        /PRIVATE_|NPCだけの秘密/,
      );
      const observation = user.confirmed.observations.find(
        (o: { text: string }) =>
          o.text === "明日の手伝いはこれから相談しようと聞いた",
      );
      expect(observation).toBeDefined();
      expect(user.confirmed.unfinishedAction).toBe("別の場所へ向かう");
      expect(
        (await agent.view(world, actor, 1000)).observations,
      ).toContainEqual(
        expect.objectContaining({
          id: observation.id,
          target: observation.targetId,
          text: observation.text,
        }),
      );
      content = {
        text: "村人と挨拶を交わしました。手伝いの内容はまだ決まっておらず、相談の続きが残っています。",
        information: [
          {
            kind: "edge",
            id: observation.id,
            aspect: "村人の返答",
            state: observation.text,
            version: null,
            at: 1000,
            origin: "reference",
            evidence:
              "手伝いの内容はまだ決まっておらず、相談の続きが残っています。",
          },
        ],
      };
    } else
      throw new Error(
        `Unexpected test input: ${JSON.stringify(Object.keys(user))}`,
      );
    return new Response(
      JSON.stringify({
        id: randomUUID(),
        model: "gemini-3.8-flash",
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(content) },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  }),
);
const agent = new WorldAgent(d.postgres, d.graph, d.checkpointer, model),
  runtime = new WorldConstruction(
    new WorldBuilder(d.postgres, d.graph, d.checkpointer, model),
    agent,
    d.queue,
    queue,
  ),
  access = new WorldAccess(runtime);
let app: Awaited<ReturnType<typeof createApp>>, cookie: string, subject: string;
let auth: Awaited<ReturnType<typeof fixtureAuth>>;
const headers = () => ({ cookie, "x-gestaloka-request": "1" });
const command = async (payload: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url: `/api/worlds/${construction}/scene`,
    headers: headers(),
    payload,
  });
const status = async () => {
  const r = await app.inject({
    url: `/api/worlds/${construction}/scene`,
    headers: headers(),
  });
  expect(r.statusCode).toBe(200);
  return r.json().scene;
};
beforeAll(async () => {
  await isolated.setup();
  await WorldBudget.setup(d.postgres);
  await WorldBudget.create(d.postgres, world, 100);
  await d.verify();
  d.queue.on("error", console.error);
  await d.queue.start();
  auth = await fixtureAuth(d.postgres);
  await access.setup();
  app = await createApp(access, auth.identity, undefined, auth.operations);
  const person = await auth.person();
  const s = await app.inject({
    method: "POST",
    url: "/api/session",
    headers: { "x-gestaloka-request": "1", cookie: person.cookie },
  });
  subject = s.json().id;
  cookie = person.cookie;
  await d.postgres.query(
    "INSERT INTO world_subject(id,user_id) VALUES($1,$1)",
    [subject],
  );
  const lease = await agent.store.claim(world, randomUUID());
  await agent.store.commit(lease, agent.store.context(world), {
    commitId: randomUUID(),
    at: 0,
    changes: {
      nodes: [
        { id: actor, kind: "existence", text: "PRIVATE_ACTOR" },
        { id: npc, kind: "existence", text: "PRIVATE_NPC" },
        { id: place, kind: "existence", text: "PRIVATE_PLACE" },
        { id: secret, kind: "script", text: "NPCだけの秘密" },
      ],
      edges: [
        {
          id: randomUUID(),
          kind: "see",
          source: actor,
          target: place,
          text: "人間だけの記憶",
          period: { from: 0 },
        },
        {
          id: randomUUID(),
          kind: "interpret",
          role: "content",
          source: npc,
          target: secret,
          period: { from: 0 },
        },
        {
          id: randomUUID(),
          kind: "interpret",
          role: "about",
          source: secret,
          target: npc,
          period: { from: 0 },
        },
      ],
      endEdges: [],
    },
  });
  await d.postgres.query(
    "INSERT INTO world_build(run_id,world_id,commit_id,initial_prompt,state,result) VALUES($1,$2,$3,'scene test','ready',$4)",
    [
      construction,
      world,
      randomUUID(),
      JSON.stringify({
        playerId: npc,
        rootIds: [place, npc],
        changes: { nodes: [], edges: [], endEdges: [] },
        report: "private",
      }),
    ],
  );
  await d.postgres.query(
    "INSERT INTO world_construction(id,state,world_id,actor_id,root_ids,participant_id) VALUES($1,'finished',$2,$3,$4,$5)",
    [construction, world, npc, JSON.stringify([place, npc]), actor],
  );
  for (const role of ["admin", "player"])
    await d.postgres.query(
      "INSERT INTO world_access(subject_id,construction_id,role,actor_id) VALUES($1,$2,$3,$4)",
      [subject, construction, role, role === "player" ? actor : null],
    );
});
afterAll(async () => {
  await app?.close();
  for (const q of [queue, `${queue}-play`, `${queue}-scenes`, `${queue}-joins`])
    await d.queue.deleteQueue(q);
  await d.postgres.query("DELETE FROM world_event WHERE construction_id=$1", [
    construction,
  ]);
  await d.postgres.query("DELETE FROM world_access WHERE construction_id=$1", [
    construction,
  ]);
  await d.postgres.query("DELETE FROM api_request WHERE subject_id=$1", [
    subject,
  ]);
  await d.postgres.query("DELETE FROM world_subject WHERE id=$1", [subject]);
  await auth.cleanup();
  await d.postgres.query(
    "DELETE FROM construction_log WHERE construction_id=$1",
    [construction],
  );
  await d.postgres.query("DELETE FROM world_construction WHERE id=$1", [
    construction,
  ]);
  await d.postgres.query("DELETE FROM world_build WHERE run_id=$1", [
    construction,
  ]);
  await d.postgres.query(
    "DELETE FROM world_operation WHERE request->>'worldId'=$1",
    [world],
  );
  await d.postgres.query("DELETE FROM llm_call WHERE budget_id=$1", [budget]);
  await d.postgres.query("DELETE FROM llm_budget WHERE id=$1", [budget]);
  await d.graph.executeQuery(
    "MATCH(n) WHERE n.worldId=$world DETACH DELETE n",
    { world },
  );
  await d.queue.stop();
  await isolated.close();
});

test("シーン前に本人へ返した初期知識だけを保存し、再取得で増やさない", async () => {
  const before = modelCalls;
  const page = await access.knowledge(
    subject,
    construction,
    undefined,
    undefined,
    undefined,
    actor,
  );
  expect(page.items.map((i) => i.text)).toEqual(["人間だけの記憶"]);
  await access.knowledge(
    subject,
    construction,
    undefined,
    undefined,
    undefined,
    actor,
  );
  const saved = (
    await d.postgres.query(
      "SELECT data FROM player_initial_presentation WHERE construction_id=$1 AND actor_id=$2",
      [construction, actor],
    )
  ).rows;
  expect(saved).toHaveLength(1);
  expect(saved[0].data).toMatchObject({
    text: "人間だけの記憶",
    information: [
      { kind: "edge", id: page.items[0]!.id },
      { kind: "node", id: place },
    ],
  });
  expect(saved[0].data.providedAt).toMatch(/Z$/);
  expect(JSON.stringify(saved)).not.toContain("NPCだけの秘密");
  expect(modelCalls).toBe(before);
});

test("長いシーンを50件ずつ前後に復元し、概要の転送量と他者の受容を抑える", async () => {
  const sceneId = randomUUID();
  const events = Array.from({ length: 261 }, (_, i) => ({
    id: randomUUID(),
    actorId: npc,
    text: "PRIVATE_EVENT",
    period: { from: i, until: i },
    receipts: [
      {
        observerId: i % 10 === 0 ? npc : actor,
        text: `記録${i} ${"長い受容本文。".repeat(40)}`,
      },
    ],
  }));
  const actions = Array.from({ length: 261 }, (_, i) => ({
    id: randomUUID(),
    text: `入力${i}`,
    state: "complete",
  }));
  await d.postgres.query(
    "INSERT INTO world_scene(id,construction_id,actor_id,state,data) VALUES($1,$2,$3,'result',$4)",
    [
      sceneId,
      construction,
      actor,
      JSON.stringify({
        commandId: randomUUID(),
        at: 260,
        startedAt: 0,
        events,
        actions,
        background: {
          synopsis: "あらすじ",
          creations: [],
          facts: [],
          beliefs: [],
          perceptions: [],
        },
        result: "確定したリザルト",
      }),
    ],
  );
  try {
    const compact = await app.inject({
      url: `/api/worlds/${construction}/scene?view=compact`,
      headers: headers(),
    });
    expect(compact.statusCode).toBe(200);
    expect(compact.json().scene).toMatchObject({
      id: sceneId,
      messages: [],
      actions: [actions.at(-1)],
      recordIds: [],
    });
    expect(compact.body.length).toBeLessThan(2000);
    const legacy = await status();
    expect(legacy.messages).toHaveLength(
      events.filter((e) => e.receipts[0]!.observerId === actor).length,
    );
    expect(legacy.actions).toEqual(actions);
    for (const kind of ["events", "actions"] as const) {
      let before: string | undefined;
      const collected: string[] = [];
      let last: Awaited<ReturnType<typeof access.sceneRecords>> | undefined;
      do {
        const page = await access.sceneRecords(subject, construction, {
          sceneId,
          kind,
          ...(before ? { before } : {}),
        });
        expect(page.items.length).toBeLessThanOrEqual(50);
        collected.push(...page.items.map((e) => e.id));
        before = page.next ?? undefined;
        last = page;
      } while (before);
      const expected =
        kind === "actions"
          ? actions
          : events.filter((e) => e.receipts[0]!.observerId === actor);
      expect(collected).toEqual(expected.map((e) => e.id).reverse());
      expect(new Set(collected).size).toBe(collected.length);
      const newer = await access.sceneRecords(subject, construction, {
        sceneId,
        kind,
        after: last!.previous!,
      });
      expect(newer.items.length).toBeGreaterThan(0);
      expect(JSON.stringify(newer)).not.toContain("PRIVATE_EVENT");
      await expect(
        access.sceneRecords(subject, construction, {
          sceneId: randomUUID(),
          kind,
        }),
      ).rejects.toThrow("利用できるシーン");
    }
  } finally {
    await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [sceneId]);
  }
});
test("入力完了で操作を返し、NPCの判定待ちを次の入力へ渡して、再送では進めない", async () => {
  const opened = await command({
    requestId: randomUUID(),
    command: "prepare",
    purpose: "村人へ礼を伝える",
  });
  const scene = opened.json().scene;
  ids.push(scene.id);
  try {
    await d.postgres.query(
      "UPDATE world_scene SET data=jsonb_set(data,'{originalAgenda}',$2::jsonb) WHERE id=$1",
      [
        scene.id,
        JSON.stringify([
          {
            id: randomUUID(),
            actorId: npc,
            at: 0,
            mode: "resolve",
            deferred: true,
            actionText: "既に挨拶を返し、次の契機を待つ",
          },
        ]),
      ],
    );
    await access.scenes.tick(scene.id);
    await command({ requestId: randomUUID(), command: "start" });
    const requestId = randomUUID(),
      before = modelCalls;
    const first = await command({
      requestId,
      command: "act",
      actionText: "礼だけを伝える",
    });
    await access.scenes.tick(scene.id);
    expect(modelCalls).toBe(before + 1);
    const row = (await access.scenes.latest(construction))!;
    expect(row.state).toBe("active");
    expect(row.data.actions.at(-1)?.state).toBe("complete");
    expect(row.data.nextDecisions).toEqual([npc]);
    expect(row.data.events).toHaveLength(1);
    expect(row.data.choices.filter((c) => c.actorId === npc)).toEqual([]);
    const count = modelCalls;
    expect(
      (
        await command({
          requestId,
          command: "act",
          actionText: "礼だけを伝える",
        })
      ).json(),
    ).toEqual(first.json());
    await access.scenes.tick(scene.id);
    expect(modelCalls).toBe(count);
    await command({
      requestId: randomUUID(),
      command: "act",
      actionText: "村人の反応を待つ",
    });
    await access.scenes.tick(scene.id);
    const next = (await access.scenes.latest(construction))!;
    expect(next.state).toBe("active");
    expect(next.data.events).toHaveLength(2);
    expect(
      next.data.events.at(-1)?.receipts.some((r) => r.observerId === actor),
    ).toBe(true);
    expect(next.data.pending[npc]?.continuing).toBe(true);
    expect(next.data.choices.filter((c) => c.actorId === npc)).toHaveLength(1);
    expect(resultCalls).toBe(0);
  } finally {
    await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [scene.id]);
    inputs.length = 0;
  }
});

test("背景不足があればfinishedでも発生済み部分を保持し、同じ入力の残りだけ続ける", async () => {
  const opened = await command({
    requestId: randomUUID(),
    command: "prepare",
    purpose: "橋へ向かう",
  });
  const id = opened.json().scene.id;
  try {
    await access.scenes.tick(id);
    await command({ requestId: randomUUID(), command: "start" });
    const inputId = randomUUID();
    await command({
      requestId: inputId,
      command: "act",
      actionText: "挨拶して橋を見に行く",
    });
    await access.scenes.tick(id);
    const row = (await access.scenes.latest(construction))!;
    expect(row.state).toBe("active");
    expect(row.data.actions).toMatchObject([
      { id: inputId, state: "complete" },
    ]);
    expect(row.data.events.map((e) => e.text)).toEqual([
      "若者が挨拶した",
      "若者が道を歩いた",
    ]);
    expect(row.data.events.map((e) => e.period)).toEqual([
      { from: 0, until: 1000 },
      { from: 1000, until: 2000 },
    ]);
    expect(new Set(row.data.events.map((e) => e.inputId))).toEqual(
      new Set([inputId]),
    );
    expect(row.data.choices.filter((i) => i.actorId === actor)).toHaveLength(1);
    expect(row.data.contextRequests).toHaveLength(1);
    expect(Object.keys(row.data.contextRequests![0]!.remainingActions)).toEqual(
      [actor],
    );
    expect(row.data.choices.some((i) => i.actorId === npc)).toBe(false);
    expect(row.data.contextNeed).toBeUndefined();
    expect(
      row.data
        .presentations!.filter((p) => p.kind === "response")
        .every((p) => p.information?.every((r) => r.canonical)),
    ).toBe(true);
    const before = modelCalls;
    await access.scenes.tick(id);
    expect(modelCalls).toBe(before);
  } finally {
    await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [id]);
    inputs.length = 0;
  }
});

test("返答待ちでも進行し、進展のない応答は場面の区切りにして、履歴・未完了の意図・再送を維持する", async () => {
  const prepareId = randomUUID(),
    opened = await command({
      requestId: prepareId,
      command: "prepare",
      purpose: "近くの村人と話す",
    });
  expect(opened.statusCode).toBe(202);
  const scene = opened.json().scene;
  ids.push(scene.id);
  expect(
    (
      await command({
        requestId: prepareId,
        command: "prepare",
        purpose: "近くの村人と話す",
      })
    ).json(),
  ).toEqual(opened.json());
  const original = (
    await d.graph.executeQuery(
      "MATCH(n:WorldNode {worldId:$world}) RETURN count(n) AS count",
      { world },
    )
  ).records[0]!.get("count").toNumber();
  await access.scenes.tick(scene.id);
  let view = await status();
  expect(view.state).toBe("ready");
  expect(view.synopsis).toContain("話しかけられる");
  expect(JSON.stringify(view)).not.toMatch(/PRIVATE_|NPCだけの秘密/);
  expect(view.messages).toEqual([]);
  const early = await command({
    requestId: randomUUID(),
    command: "act",
    actionText: "質問する",
  });
  expect(early.statusCode).toBe(409);
  await command({ requestId: randomUUID(), command: "start" });
  const requestId = randomUUID();
  await ExecutionBudget.run(d.postgres, requestId, async () => {});
  await d.postgres.query(
    "UPDATE execution_budget SET llm_used=64 WHERE id=$1",
    [requestId],
  );
  const beforeLimit = modelCalls;
  const act = await command({
    requestId,
    command: "act",
    actionText: "何か手伝えることはありますかと聞き、返答を待つ",
  });
  expect(act.statusCode).toBe(202);
  const retry = await app.inject({
    method: "POST",
    url: `/api/worlds/${construction}/scene?view=compact`,
    headers: headers(),
    payload: {
      requestId,
      command: "act",
      actionText: "何か手伝えることはありますかと聞き、返答を待つ",
    },
  });
  expect(retry.json()).toEqual(act.json());
  await expect(access.scenes.tick(scene.id)).rejects.toBeInstanceOf(
    ExecutionLimit,
  );
  expect(modelCalls).toBe(beforeLimit);
  expect(await status()).toMatchObject({
    state: "paused",
    result: null,
    messages: [],
    error: expect.stringContaining("上限の見直し"),
  });
  const frozen = (await access.scenes.latest(construction))!.data.work;
  await command({ requestId: randomUUID(), command: "resume" });
  await expect(access.scenes.tick(scene.id)).rejects.toBeInstanceOf(
    ExecutionLimit,
  );
  expect(
    (
      await d.postgres.query(
        "SELECT llm_used FROM execution_budget WHERE id=$1",
        [requestId],
      )
    ).rows[0].llm_used,
  ).toBe(64);
  await d.postgres.query(
    "UPDATE response_call_policy SET calls=128 WHERE singleton",
  );
  const resumeId = randomUUID();
  await command({ requestId: resumeId, command: "resume" });
  expect((await access.scenes.latest(construction))!.data.work).toEqual(frozen);
  await access.scenes.tick(scene.id);
  await command({ requestId: resumeId, command: "resume" });
  expect(
    (
      await d.postgres.query(
        "SELECT llm_used,llm_limit FROM execution_budget WHERE id=$1",
        [requestId],
      )
    ).rows[0],
  ).toEqual({ llm_used: 69, llm_limit: 128 });
  await d.postgres.query(
    "UPDATE response_call_policy SET calls=64 WHERE singleton",
  );
  view = await status();
  expect(view.state).toBe("active");
  expect(view.at).toBe(1000);
  expect((await access.scenes.latest(construction))!.data.events).toHaveLength(
    2,
  );
  expect(view.messages.map((m: { text: string }) => m.text)).toContain(
    "明日の手伝いはこれから相談しようと聞いた",
  );
  expect(resultCalls).toBe(0);
  expect(
    (
      await d.graph.executeQuery(
        "MATCH(n:WorldNode {worldId:$world}) RETURN count(n) AS count",
        { world },
      )
    ).records[0]!.get("count").toNumber(),
  ).toBe(original);
  const count = modelCalls;
  await command({
    requestId,
    command: "act",
    actionText: "何か手伝えることはありますかと聞き、返答を待つ",
  });
  await access.scenes.tick(scene.id);
  expect(modelCalls).toBe(count);
  await command({
    requestId: randomUUID(),
    command: "act",
    actionText: "村人へ一歩近づく",
  });
  await access.scenes.tick(scene.id);
  view = await status();
  expect(view.at).toBe(2000);
  expect((await runtime.get(construction)).at).toBe(0);
  const outsider = await auth.person("user");
  const hidden = await app.inject({
    url: `/api/worlds/${construction}/scene`,
    headers: { cookie: outsider.cookie },
  });
  expect(hidden.statusCode).toBe(404);
  worldPaused = true;
  await command({
    requestId: randomUUID(),
    command: "act",
    actionText: "別の場所へ向かう",
  });
  await expect(access.scenes.tick(scene.id)).rejects.toThrow("世界への確定");
  view = await status();
  expect(view.state).toBe("paused");
  const saved = await access.scenes.latest(construction);
  await d.postgres.query(
    "UPDATE world_construction SET state='play_paused' WHERE id=$1",
    [construction],
  );
  await access.scenes.setup();
  expect((await runtime.get(construction)).state).toBe("finished");
  expect(await access.scenes.latest(construction)).toEqual(saved);
  expect(view.result).toBeNull();
  expect(view.nextPurpose).toBe("別の場所へ向かう");
  expect(view.actions.at(-1)?.state).toBe("boundary");
  expect(view.messages).toHaveLength(2);
  expect(resultCalls).toBe(0);
  worldPaused = false;
  await command({ requestId: randomUUID(), command: "resume" });
  await access.scenes.tick(scene.id);
  view = await status();
  expect(view.state).toBe("result");
  const recordedResult = (await access.scenes.latest(
    construction,
    d.postgres,
    false,
    actor,
  ))!.data.presentations!.find((p) => p.kind === "result")!;
  expect(recordedResult.information).toEqual([
    expect.objectContaining({
      kind: "edge",
      canonical: true,
      origin: "generated",
    }),
  ]);
  expect(view.result).toContain("まだ決まっておらず");
  expect(JSON.stringify(view)).not.toMatch(/PRIVATE_|NPCだけの秘密/);
  expect(resultCalls).toBe(1);
  const restored = await new WorldAccess(runtime).scene(subject, construction);
  expect(restored.scene).toEqual(view);
  const records = await access.knowledge(subject, construction);
  expect(records.items.some((item) => view.recordIds.includes(item.id))).toBe(
    true,
  );
  const separate = await access.knowledge(
    subject,
    construction,
    undefined,
    undefined,
    scene.id,
  );
  expect(separate.items.some((item) => view.recordIds.includes(item.id))).toBe(
    false,
  );
  expect(separate.items.some((item) => item.text === "人間だけの記憶")).toBe(
    true,
  );
  const row = await runtime.get(construction);
  expect(
    row.agenda.some(
      (w) =>
        w.actorId === npc && w.deferred && w.actionText?.includes("返事を待つ"),
    ),
  ).toBe(true);
  expect(row.at).toBe(2000);
  expect(row.agenda.some((w) => w.actorId === actor && w.deferred)).toBe(true);
  const movement = (await agent.view(world, actor, 2000)).observations.find(
    (o) => o.text === "一歩近づいた",
  );
  expect(movement?.period).toEqual({ from: 1000, until: 2000 });
  const finalCount = modelCalls;
  await access.scenes.tick(scene.id);
  expect(modelCalls).toBe(finalCount);
  expect(inputs.filter((i) => "observerId" in i)).toHaveLength(1);
});
