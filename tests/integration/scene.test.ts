import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldConstruction } from "@gestaloka/server/construction";
import { WorldAccess } from "@gestaloka/server/access";
import { createApp } from "../../apps/api/src/app.js";
import { modelEnvironment, approvedTransport } from "../support/model.js";

const d = connectDatabases(),
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
    if (
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
      if (intentions.some((i) => i.actionText === "別の場所へ向かう"))
        content = { type: "boundary", reason: "移動先の背景情報が必要" };
      else if (
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
          newDecisions: response ? [] : [npc],
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
      expect(user.confirmed.observations).toContain(
        "明日の手伝いはこれから相談しようと聞いた",
      );
      expect(user.confirmed.unfinishedAction).toBe("別の場所へ向かう");
      expect(
        (await agent.view(world, actor, 0)).observations.some(
          (o) => o.text === "明日の手伝いはこれから相談しようと聞いた",
        ),
      ).toBe(true);
      content = {
        text: "村人と挨拶を交わしました。手伝いの内容はまだ決まっておらず、相談の続きが残っています。",
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
  await d.verify();
  d.queue.on("error", console.error);
  await d.queue.start();
  await access.setup();
  app = await createApp(access);
  const s = await app.inject({
    method: "POST",
    url: "/api/session",
    headers: { "x-gestaloka-request": "1" },
  });
  subject = s.json().id;
  cookie = String(s.headers["set-cookie"]).split(";")[0]!;
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
  for (const q of [queue, `${queue}-play`, `${queue}-scenes`])
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
  await d.postgres.query("DELETE FROM browser_session WHERE id=$1", [subject]);
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
  await d.close();
});
test("あらすじ→開始→本人の返答→背景更新の区切り→確定後のリザルトを保存し、失敗と再送でもシーンを維持する", async () => {
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
  const requestId = randomUUID(),
    act = await command({
      requestId,
      command: "act",
      actionText: "何か手伝えることはありますかと聞き、返答を待つ",
    });
  expect(act.statusCode).toBe(202);
  await access.scenes.tick(scene.id);
  view = await status();
  expect(view.state).toBe("active");
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
  expect(view.at).toBe(1000);
  expect((await runtime.get(construction)).at).toBe(0);
  const outsider = await app.inject({
    method: "POST",
    url: "/api/session",
    headers: { "x-gestaloka-request": "1" },
  });
  const hidden = await app.inject({
    url: `/api/worlds/${construction}/scene`,
    headers: { cookie: String(outsider.headers["set-cookie"]).split(";")[0]! },
  });
  expect(hidden.statusCode).toBe(404);
  await d.postgres.query("DELETE FROM browser_session WHERE id=$1", [
    outsider.json().id,
  ]);
  worldPaused = true;
  await command({
    requestId: randomUUID(),
    command: "act",
    actionText: "別の場所へ向かう",
  });
  await expect(access.scenes.tick(scene.id)).rejects.toThrow("世界への確定");
  view = await status();
  expect(view.state).toBe("paused");
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
  expect(view.result).toContain("まだ決まっておらず");
  expect(JSON.stringify(view)).not.toMatch(/PRIVATE_|NPCだけの秘密/);
  expect(resultCalls).toBe(1);
  const restored = await new WorldAccess(runtime).scene(subject, construction);
  expect(restored.scene).toEqual(view);
  const row = await runtime.get(construction);
  expect(
    row.agenda.some(
      (w) =>
        w.actorId === npc && w.deferred && w.actionText?.includes("返事を待つ"),
    ),
  ).toBe(true);
  expect(row.at).toBe(1000);
  expect(row.agenda.some((w) => w.actorId === actor && w.deferred)).toBe(true);
  const movement = (await agent.view(world, actor, 1000)).observations.find(
    (o) => o.text === "一歩近づいた",
  );
  expect(movement?.period).toEqual({ from: 0, until: 1000 });
  const finalCount = modelCalls;
  await access.scenes.tick(scene.id);
  expect(modelCalls).toBe(finalCount);
  expect(inputs.filter((i) => "observerId" in i)).toHaveLength(1);
});
