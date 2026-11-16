import { isolatedDatabases } from "../support/isolated-db.js";
import { WorldBudget } from "../../packages/server/src/llm/world-budget.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { ExecutionBudget, ExecutionLimit } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldAgent, SupersededWorker } from "@gestaloka/server/agent";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldConstruction } from "@gestaloka/server/construction";
import { WorldAccess } from "@gestaloka/server/access";
import { createApp } from "../../apps/api/src/app.js";
import { sceneAnchors } from "../../packages/server/src/runtime/scene-data.js";
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
  disposition = randomUUID(),
  cognition = randomUUID(),
  playerCondition = randomUUID(),
  world = randomUUID(),
  construction = randomUUID();
let backgroundCalls = 0;
let modelCalls = 0,
  worldPaused = false,
  resultCalls = 0,
  partialReply = false;
type SceneSnapshot = Awaited<ReturnType<WorldAccess["scenes"]["latest"]>>;
let exploration: { id: string; sourced: boolean } | undefined;
const partialNpcAction =
  "問いの一部に返答し、選んだ活動を続けて相手の判断を待つ";
const inputs: Record<string, unknown>[] = [],
  ids: string[] = [];
const faults = new Map<string, { content?: string; finish?: string }[]>();
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
    if (user.pendingScenes) {
      content = { type: "selection", candidates: [], mergeInto: null };
    } else if (
      exploration &&
      user.background &&
      !user.background.creations.some(
        (n: { id: string }) => n.id === exploration!.id,
      )
    ) {
      expect(user.responseSchema.oneOf).toContainEqual(
        expect.objectContaining({
          properties: expect.objectContaining({
            type: expect.objectContaining({ const: "context" }),
            creations: expect.anything(),
          }),
        }),
      );
      content = {
        type: "context",
        participants: [exploration.id],
        creations: [{ id: exploration.id, text: "探索で具体化した存在" }],
        facts: [
          {
            subjectId: exploration.id,
            text: "NEW_ACTOR_CONDITION",
            aboutIds: [place],
            ...(exploration.sourced ? { sourceRelationIds: [] } : {}),
          },
          {
            subjectId: exploration.id,
            text: "奥の作業場",
            aboutIds: [place],
            location: true,
            ...(exploration.sourced ? { sourceRelationIds: [] } : {}),
          },
        ],
        beliefs: [
          {
            subjectId: exploration.id,
            text: "NEW_ACTOR_PURPOSE",
            aboutIds: [exploration.id],
            ...(exploration.sourced ? { sourceRelationIds: [] } : {}),
          },
        ],
        resolvedUnknowns: [],
      };
    } else if (exploration && user.observerId === exploration.id) {
      expect(user.conditions).toContainEqual(
        expect.objectContaining({ text: "NEW_ACTOR_CONDITION" }),
      );
      expect(JSON.stringify(user.interpretations)).toContain(
        "NEW_ACTOR_PURPOSE",
      );
      expect(JSON.stringify(user.observations)).toContain("呼びかけが聞こえた");
      expect(JSON.stringify(user.observations)).not.toContain(
        "NEW_ACTOR_CONDITION",
      );
      content = { actionText: "今は取り込み中だと伝える" };
    } else if (
      exploration &&
      user.request?.controlledActionText === "作業の気配を探して声をかける"
    ) {
      const person = exploration.id;
      const decisions = Object.fromEntries(
        user.request.intentions.map((i: { actorId: string }) => [
          i.actorId,
          "finished",
        ]),
      );
      if (
        !user.background.creations.some((n: { id: string }) => n.id === person)
      ) {
        content = {
          type: "scene",
          events: [
            {
              actorId: actor,
              text: "入口まで歩いた",
              receipts: [{ observerId: actor, text: "入口に着いた" }],
            },
          ],
          elapsedMs: 1000,
          decisions: { ...decisions, [actor]: "pending" },
          newDecisions: [],
          needsContext: {
            evidence: "observation",
            reason: "作業の気配を確かめる",
            remainingActions: { [actor]: "作業の気配を探して声をかける" },
          },
        };
      } else {
        expect(user.background.participants).toContain(person);
        expect(JSON.stringify(user.controlledView)).not.toMatch(
          /NEW_ACTOR_CONDITION|NEW_ACTOR_PURPOSE/,
        );
        const chosen = user.request.intentions.find(
          (i: { actorId: string }) => i.actorId === person,
        );
        content = {
          type: "scene",
          events: [
            {
              actorId: chosen ? person : actor,
              text: chosen ? chosen.actionText : "姿を認めて声をかけた",
              receipts: chosen
                ? [{ observerId: actor, text: "今は取り込み中だと聞いた" }]
                : [
                    { observerId: actor, text: "作業する姿が見えた" },
                    { observerId: person, text: "呼びかけが聞こえた" },
                  ],
            },
          ],
          elapsedMs: 1000,
          decisions: { ...decisions, [actor]: chosen ? "decide" : "pending" },
          newDecisions: chosen ? [] : [person],
        };
      }
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
            subjectId: backgroundCalls++ === 0 ? secret : npc,
            text: "村の道で若者の声が届く距離にいる",
            aboutIds: [actor, place],
          },
        ],
        perceptions: [
          { observerId: actor, text: "村人が見える", sourceIds: [npc] },
          { observerId: npc, text: "若者が見える", sourceIds: [actor] },
        ],
        unknowns:
          user.request.actionText === "封印された箱の印を探す"
            ? [{ question: "探す箱にどんな印があるか", targetId: place }]
            : [],
      };
    else if (user.observerId) {
      expect(user.observerId).toBe(npc);
      expect(JSON.stringify(user)).toContain("NPCだけの秘密");
      expect(JSON.stringify(user)).not.toContain("人間だけの記憶");
      const startedAt = (await access.scenes.latest(construction))!.data
        .startedAt;
      expect(user.conditions).toEqual(
        expect.arrayContaining([
          { text: "NPC_DISPOSITION", about: [npc], at: startedAt },
          { text: "NPC_COGNITION", about: [npc], at: startedAt },
        ]),
      );
      expect(JSON.stringify(user.observations)).not.toMatch(
        /NPC_DISPOSITION|NPC_COGNITION/,
      );
      expect(JSON.stringify(user.interpretations)).not.toMatch(
        /NPC_DISPOSITION|NPC_COGNITION/,
      );
      expect(JSON.stringify(user)).not.toContain("PLAYER_UNOBSERVED_CONDITION");
      content = {
        actionText: partialReply
          ? partialNpcAction
          : "「明日の手伝いはこれから相談しよう」と伝え、返事を待つ。",
      };
    } else if (user.background) {
      expect(user.controlledView.observerId).toBe(actor);
      expect(JSON.stringify(user.controlledView)).toContain("人間だけの記憶");
      expect(JSON.stringify(user.controlledView)).not.toContain(
        "NPCだけの秘密",
      );
      expect(user.controlledView).not.toHaveProperty("conditions");
      expect(JSON.stringify(user.controlledView)).not.toMatch(
        /NPC_DISPOSITION|NPC_COGNITION|PLAYER_UNOBSERVED_CONDITION/,
      );
      const intentions = user.request.intentions as {
          actorId: string;
          actionText: string;
        }[],
        response = intentions.some((i) => i.actorId === npc);
      if (intentions.some((i) => i.actionText === "隣の箱を調べる")) {
        content = {
          type: "scene",
          events: [
            {
              actorId: actor,
              text: "隣の箱を調べた",
              receipts: [
                { observerId: actor, text: "手前の箱の表には印が見えない" },
              ],
            },
          ],
          decisions: { [actor]: "decide" },
          newDecisions: [],
        };
      } else if (
        intentions.some((i) => i.actionText === "前の返答を読み直す")
      ) {
        expect(user.sceneHistory).toEqual([]);
        expect(user.controlledView.observations).toContainEqual(
          expect.objectContaining({
            text: "明日の手伝いはこれから相談しようと聞いた",
          }),
        );
        content = {
          type: "scene",
          events: [
            {
              actorId: actor,
              text: "若者が以前に受け取った返答を読み直した",
              receipts: [
                {
                  observerId: actor,
                  text: "前の返答は「明日の手伝いはこれから相談しよう」だった。",
                },
              ],
            },
          ],
          decisions: { [actor]: "finished" },
          newDecisions: [],
          elapsedMs: 0,
        };
      } else if (
        intentions.some((i) => i.actionText === "挨拶して橋を見に行く")
      )
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
            evidence: "world",
            reason: "橋への道を確認する",
            remainingActions: {
              [actor]: "橋の方へ歩く",
              [npc]: "今回は選ばれていない行動を実行する",
            },
          },
        };
      else if (intentions.some((i) => i.actionText === "橋の方へ歩く")) {
        if (
          !user.background.facts.some(
            (f: { text: string }) =>
              f.text === "橋へ続く道が声をかけた場所から延びている",
          )
        ) {
          const queried = body.messages.some(
            (m: { role: string; content: string }) =>
              m.role === "user" && m.content.includes('"results"'),
          );
          content = queried
            ? {
                type: "context",
                participants: [],
                creations: [],
                beliefs: [],
                resolvedUnknowns: [],
                facts: [
                  {
                    subjectId: place,
                    text: "橋へ続く道が声をかけた場所から延びている",
                    aboutIds: [actor, user.sceneHistory[0].id],
                  },
                ],
              }
            : { type: "query", requests: [{ kind: "node", id: place }] };
        } else {
          expect(user.background.facts.at(-1)).toMatchObject({
            at: user.sceneHistory.at(-1).period.until,
          });
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
        }
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
          events: [
            {
              actorId: actor,
              text: "若者が道へ出た",
              receipts: [
                { observerId: actor, text: "道へ出て、次の行き先を選べる" },
              ],
            },
          ],
          decisions: Object.fromEntries(
            intentions.map((i) => [
              i.actorId,
              i.actorId === actor ? "decide" : "pending",
            ]),
          ),
          newDecisions: [],
          elapsedMs: 0,
        };
      else if (partialReply) {
        content = response
          ? {
              type: "scene",
              events: [
                {
                  actorId: npc,
                  text: "問いの一部に返答した",
                  receipts: [
                    { observerId: actor, text: "一つ目のことだけを聞いた" },
                  ],
                },
              ],
              decisions: { [actor]: "decide", [npc]: "pending" },
              newDecisions: [],
              elapsedMs: 0,
              responseCoverage: [
                {
                  requestPart: "一つ目の問い",
                  outcome: "delivered",
                  evidence: [{ eventIndex: 0, receiptIndex: 0 }],
                  explanation: "一つ目は返答した",
                },
                {
                  requestPart: "もう一つの問い",
                  outcome: "pending",
                  evidence: [],
                  explanation: "この部分には答えていない",
                },
              ],
            }
          : {
              type: "scene",
              events: [
                {
                  actorId: actor,
                  text: "二つのことを尋ねた",
                  receipts: [
                    { observerId: npc, text: "二つのことを尋ねられた" },
                  ],
                },
              ],
              decisions: { [actor]: "pending" },
              newDecisions: [npc],
              elapsedMs: 0,
            };
      } else if (!response && user.sceneHistory.length) {
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
            ? {
                ...(intentions.some((i) => i.actorId === actor)
                  ? { [actor]: "decide" }
                  : {}),
                [npc]: "pending",
              }
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
    const stage = user.confirmed
      ? "result"
      : user.observerId
        ? "intent"
        : user.background
          ? "resolve"
          : (content as { type?: string }).type === "background"
            ? "background"
            : "";
    const fault = faults.get(stage)?.shift();
    return new Response(
      JSON.stringify({
        id: randomUUID(),
        model: "gemini-3.8-flash",
        choices: [
          {
            finish_reason: fault?.finish ?? "stop",
            message: { content: fault?.content ?? JSON.stringify(content) },
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
const complete = model.complete.bind(model);
model.complete = async (
  id,
  role,
  messages,
  target = "default",
  effortTarget,
  shorten,
  formatAttempts = 0,
) => {
  const targets = new Map([
    ["scene-resolve", "default"],
    ["scene-background", "default"],
    ["scene-intent", "resolution"],
    ["scene-result", "default"],
  ]);
  if (targets.has(role) && !formatAttempts)
    expect(target).toBe(targets.get(role));
  if (role === "scene-background") expect(effortTarget).toBe("resolution");
  return complete(
    id,
    role,
    messages,
    target,
    effortTarget,
    shorten,
    formatAttempts,
  );
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
        { id: actor, kind: "existence", text: "若者" },
        { id: npc, kind: "existence", text: "PRIVATE_NPC" },
        { id: place, kind: "existence", text: "PRIVATE_PLACE" },
        { id: secret, kind: "script", text: "NPCだけの秘密" },
        { id: disposition, kind: "script", text: "NPC_DISPOSITION" },
        { id: cognition, kind: "script", text: "NPC_COGNITION" },
        {
          id: playerCondition,
          kind: "script",
          text: "PLAYER_UNOBSERVED_CONDITION",
        },
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
        ...[
          [npc, disposition],
          [npc, cognition],
          [actor, playerCondition],
        ].flatMap(([owner, condition]) => [
          {
            id: randomUUID(),
            kind: "status" as const,
            role: "content" as const,
            source: owner!,
            target: condition!,
            period: { from: 0 },
          },
          {
            id: randomUUID(),
            kind: "status" as const,
            role: "about" as const,
            source: condition!,
            target: owner!,
            period: { from: 0 },
          },
        ]),
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
  for (const q of [
    queue,
    `${queue}-play`,
    `${queue}-scenes`,
    `${queue}-joins`,
    `${queue}-shared-scenes`,
    `${queue}-scene-deadlines`,
  ])
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
  expect(JSON.stringify(page)).not.toMatch(
    /NPC_DISPOSITION|NPC_COGNITION|PLAYER_UNOBSERVED_CONDITION/,
  );
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

test.each([false, true])(
  "形式修復・保存後の再開でも継続判断を反転させず、履歴を一度だけ表示する（API形式修復: %s）",
  async (providerRepair) => {
    const id = randomUUID();
    await command({
      requestId: id,
      command: "prepare",
      purpose: "箱の印を調べる",
    });
    await access.scenes.tick(id);
    await command({ requestId: randomUUID(), command: "start" });
    const response = {
      type: "scene",
      concluded: false,
      events: [
        {
          actorId: actor,
          text: "箱の表を調べた",
          locations: [{ subjectId: actor, text: "道端", aboutIds: [place] }],
          receipts: [{ observerId: actor, text: "箱の表に青い印が見える" }],
        },
      ],
      decisions: { [actor]: "decide" },
    };
    faults.set("resolve", [
      {
        content: JSON.stringify({
          ...response,
          events: [{ ...response.events[0], locations: [] }],
        }),
      },
      { content: JSON.stringify({ ...response, concluded: true }) },
      { content: JSON.stringify(response) },
    ]);
    let stopped = false;
    const calls = vi
      .spyOn(model, "complete")
      .mockImplementation(async (...args) => {
        if (
          args[1] === "scene-resolve" &&
          args[2].some(
            (m) =>
              m.role === "user" &&
              m.content.includes('"preserveConclusion":false'),
          )
        ) {
          const repair = JSON.parse(args[2].at(-1)!.content);
          expect(repair.preserveConclusion).toBe(false);
          expect(
            repair.responseSchema.oneOf[0].properties.concluded.const,
          ).toBe(false);
          if (!stopped) {
            stopped = true;
            throw new SupersededWorker("修復要求を保存して停止");
          }
        }
        const result = await complete(...args);
        if (providerRepair && args[1] === "scene-resolve" && !args[6])
          return {
            ...result,
            formatAttempts: 1,
            formatHistory: [result.content],
            content: JSON.stringify({
              ...JSON.parse(result.content),
              concluded: true,
            }),
          };
        return result;
      });
    try {
      await command({
        requestId: randomUUID(),
        command: "act",
        actionText: "隣の箱を調べる",
      });
      await access.scenes.tick(id);
      expect(stopped).toBe(true);
      expect((await access.scenes.latest(construction))!.data.events).toEqual(
        [],
      );
      await new WorldAccess(runtime).scenes.tick(id);
      const row = (await access.scenes.latest(construction))!;
      expect(row.state).toBe("active");
      expect(row.data.result).toBeUndefined();
      expect(row.data.events).toHaveLength(1);
      expect(row.data.events[0]!.receipts[0]!.text).toBe(
        "箱の表に青い印が見える",
      );
      expect(faults.get("resolve")).toEqual([]);
      const count = modelCalls;
      await access.scenes.tick(id);
      expect(modelCalls).toBe(count);
    } finally {
      calls.mockRestore();
      faults.clear();
      await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [id]);
      inputs.length = 0;
    }
  },
);

test.each(["background", "intent", "resolve"])(
  "%sのJSON・型・未完了応答を同じ要求内で修正し、確定前の履歴を重複させない",
  async (stage) => {
    faults.set(stage, [
      { content: "{" },
      { content: "{}" },
      { finish: "length" },
    ]);
    const opened = await command({
      requestId: randomUUID(),
      command: "prepare",
      purpose: "相手と話す",
    });
    const id = opened.json().scene.id;
    try {
      await access.scenes.tick(id);
      expect((await status()).state).toBe("ready");
      await command({ requestId: randomUUID(), command: "start" });
      partialReply = true;
      const requestId = randomUUID();
      await command({
        requestId,
        command: "act",
        actionText: "相手に尋ねて返答を待つ",
      });
      await access.scenes.tick(id);
      const row = (await access.scenes.latest(construction))!;
      expect(row.state).toBe("active");
      expect(row.data.error).toBeUndefined();
      expect(row.data.events).toHaveLength(2);
      expect(faults.get(stage)).toEqual([]);
      const calls = modelCalls;
      await command({
        requestId,
        command: "act",
        actionText: "相手に尋ねて返答を待つ",
      });
      await access.scenes.tick(id);
      expect(modelCalls).toBe(calls);
      expect((await access.scenes.latest(construction))!.data.events).toEqual(
        row.data.events,
      );
      const counted = (
        await d.postgres.query(
          "SELECT b.llm_used,(SELECT count(*)::int FROM llm_call c WHERE c.response_id=b.id) AS calls FROM execution_budget b WHERE id=$1",
          [stage === "background" ? id : requestId],
        )
      ).rows[0];
      expect(counted.llm_used).toBe(counted.calls);
      expect(counted.calls).toBeGreaterThanOrEqual(4);
    } finally {
      faults.clear();
      partialReply = false;
      await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [id]);
    }
  },
);

async function addVillager(newcomer: string) {
  await agent.store.commit(
    await agent.store.claim(world, randomUUID()),
    agent.store.context(world),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [{ id: newcomer, kind: "existence", text: "新しい村人" }],
        edges: [
          {
            id: randomUUID(),
            kind: "has",
            source: place,
            target: newcomer,
            period: { from: 0 },
          },
        ],
        endEdges: [],
      },
    },
  );
}

test.each(["自動", "旧版からの手動再開"])(
  "初回の準備中に世界が変わっても最新の情報で開始できる（%s）",
  async (mode) => {
    const id = randomUUID(),
      newcomer = randomUUID();
    await command({ requestId: id, command: "prepare", purpose: "村を訪ねる" });
    const calls = vi
      .spyOn(model, "complete")
      .mockImplementationOnce(async (...args) => {
        const response = await complete(...args);
        await addVillager(newcomer);
        // Reproduce the durable pause left by the old worker after its model call.
        if (mode === "旧版からの手動再開")
          throw new Error("保存済みの文脈が変わりました");
        return response;
      });
    try {
      if (mode === "旧版からの手動再開") {
        await expect(access.scenes.tick(id)).rejects.toThrow(
          "保存済みの文脈が変わりました",
        );
        await access.scenes.tick(id);
        expect((await status()).state).toBe("paused");
        expect(calls).toHaveBeenCalledTimes(1);
        expect(
          (await command({ requestId: randomUUID(), command: "resume" }))
            .statusCode,
        ).toBe(202);
      }
      await access.scenes.tick(id);
      expect(calls).toHaveBeenCalledTimes(mode === "自動" ? 2 : 3);
      const [before] = calls.mock.calls;
      const after = calls.mock.calls.at(-1);
      expect(before![2][1]!.content).not.toContain(newcomer);
      expect(after![2][1]!.content).toContain(newcomer);
      expect((await status()).state).toBe("ready");
      await command({ requestId: randomUUID(), command: "start" });
      expect((await status()).state).toBe("active");
    } finally {
      calls.mockRestore();
      await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [id]);
    }
  },
);

test("自動修正も元の呼出し上限を使い、上限後に送信や履歴を増やさない", async () => {
  await d.postgres.query(
    "UPDATE response_call_policy SET calls=3 WHERE singleton",
  );
  faults.set(
    "background",
    Array.from({ length: 4 }, () => ({ content: "{" })),
  );
  const opened = await command({
    requestId: randomUUID(),
    command: "prepare",
    purpose: "周囲を確かめる",
  });
  const id = opened.json().scene.id;
  try {
    await expect(access.scenes.tick(id)).rejects.toBeInstanceOf(ExecutionLimit);
    const row = (await access.scenes.latest(construction))!;
    expect(row.state).toBe("paused");
    expect(row.data.limitReached).toBe(true);
    expect(row.data.events).toEqual([]);
    expect(faults.get("background")).toHaveLength(2);
    expect(
      (
        await d.postgres.query(
          "SELECT llm_used,llm_limit FROM execution_budget WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ llm_used: 3, llm_limit: 3 });
    const count = modelCalls;
    await command({ requestId: randomUUID(), command: "resume" });
    await expect(access.scenes.tick(id)).rejects.toBeInstanceOf(ExecutionLimit);
    expect(modelCalls).toBe(count);
    expect((await access.scenes.latest(construction))!.data.work).toEqual(
      row.data.work,
    );
  } finally {
    faults.clear();
    await d.postgres.query(
      "UPDATE response_call_policy SET calls=64 WHERE singleton",
    );
    await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [id]);
  }
});

test("NPCの部分返答で本人へ判断を返し、NPCの継続を再判断へ書き換えない", async () => {
  const opened = await command({
    requestId: randomUUID(),
    command: "prepare",
    purpose: "相手に二つのことを尋ねる",
  });
  const id = opened.json().scene.id;
  try {
    await access.scenes.tick(id);
    await command({ requestId: randomUUID(), command: "start" });
    await d.postgres.query(
      "UPDATE world_scene SET data=data #- $2::text[] WHERE id=$1",
      [id, ["views", npc, "conditions"]],
    );
    partialReply = true;
    const before = modelCalls;
    await command({
      requestId: randomUUID(),
      command: "act",
      actionText: "二つのことを尋ねて、相手の返答を待つ",
    });
    await access.scenes.tick(id);
    const row = (await access.scenes.latest(construction))!;
    expect(row.state).toBe("active");
    expect(row.data.actions.at(-1)?.state).toBe("complete");
    expect(row.data.events).toHaveLength(2);
    expect(row.data.nextDecisions).toEqual([]);
    expect(row.data.pending[npc]).toMatchObject({
      actionText: partialNpcAction,
      continuing: true,
    });
    expect(
      row.data.choices.filter((choice) => choice.actorId === npc),
    ).toHaveLength(1);
    expect(modelCalls).toBe(before + 3);
    const returned = modelCalls;
    await access.scenes.tick(id);
    expect(modelCalls).toBe(returned);
    expect((await status()).messages).toContainEqual(
      expect.objectContaining({ text: "一つ目のことだけを聞いた" }),
    );
  } finally {
    partialReply = false;
    inputs.length = 0;
    await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [id]);
  }
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
    expect(legacy.actions).toEqual(
      actions.map((action) => ({
        ...action,
        characters: [{ actorId: actor, name: "若者", icon: null }],
      })),
    );
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
test("未同席の既存NPCへの受容も本人判断へ渡し、再送では判断や履歴を増やさない", async () => {
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
    await d.postgres.query(
      "UPDATE world_scene SET data=jsonb_set(jsonb_set(data,'{background,participants}',$2::jsonb),'{views}',(data->'views')-$3::text) WHERE id=$1",
      [scene.id, JSON.stringify([actor]), npc],
    );
    await command({ requestId: randomUUID(), command: "start" });
    const requestId = randomUUID(),
      before = modelCalls;
    const first = await command({
      requestId,
      command: "act",
      actionText: "礼だけを伝える",
    });
    await access.scenes.tick(scene.id);
    expect(modelCalls).toBe(before + 3);
    const row = (await access.scenes.latest(construction))!;
    expect(row.state).toBe("active");
    expect(row.data.actions.at(-1)?.state).toBe("complete");
    expect(row.data.nextDecisions).toEqual([]);
    expect(row.data.events).toHaveLength(2);
    expect(row.data.choices.filter((c) => c.actorId === npc)).toHaveLength(1);
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
    expect(
      row.data.events.at(-1)?.receipts.some((r) => r.observerId === actor),
    ).toBe(true);
    expect(row.data.pending[npc]?.continuing).toBe(true);
    expect(resultCalls).toBe(0);
  } finally {
    await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [scene.id]);
    inputs.length = 0;
  }
});

test("行動の解決中に世界が更新されても、表示済みの出来事と入力を保って残りだけを続ける", async () => {
  const id = randomUUID(),
    inputId = randomUUID(),
    newcomer = randomUUID();
  await command({ requestId: id, command: "prepare", purpose: "橋へ向かう" });
  await access.scenes.tick(id);
  await command({ requestId: randomUUID(), command: "start" });
  await command({
    requestId: inputId,
    command: "act",
    actionText: "挨拶して橋を見に行く",
  });
  let prefix: SceneSnapshot;
  const calls = vi
    .spyOn(model, "complete")
    .mockImplementation(async (...args) => {
      const response = await complete(...args);
      if (
        !prefix &&
        args[1] === "scene-resolve" &&
        JSON.parse(args[2][1]!.content).sceneHistory.length
      ) {
        prefix = (await access.scenes.latest(construction))!;
        await addVillager(newcomer);
      }
      return response;
    });
  try {
    await access.scenes.tick(id);
    const row = (await access.scenes.latest(construction))!;
    expect(row.state).toBe("active");
    expect(prefix!.data.events).toHaveLength(1);
    expect(row.data.events.slice(0, 1)).toEqual(prefix!.data.events);
    expect(
      row.data.presentations!.slice(0, prefix!.data.presentations!.length),
    ).toEqual(prefix!.data.presentations);
    expect(row.data.actions).toMatchObject([
      { ...prefix!.data.actions[0], state: "complete" },
    ]);
    expect(
      row.data.background!.facts.slice(
        0,
        prefix!.data.background!.facts.length,
      ),
    ).toEqual(prefix!.data.background!.facts);
    expect(row.data.background!.perceptions).toEqual(
      prefix!.data.background!.perceptions,
    );
    expect(row.data.events.map((e) => e.inputId)).toEqual([inputId, inputId]);
    const refresh = calls.mock.calls
      .filter(([, role]) => role === "scene-resolve")
      .at(-1)!;
    expect(refresh[2][1]!.content).toContain(newcomer);
    expect(
      JSON.parse(refresh[2][1]!.content).request.intentions.find(
        (i: { actorId: string }) => i.actorId === actor,
      ).actionText,
    ).toBe("橋の方へ歩く");
  } finally {
    calls.mockRestore();
    await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [id]);
  }
});

test.each([false, true])(
  "観察中に未記録の主体を具体化し、受容・本人判断へ引き継ぐ（根拠参照=%s）",
  async (sourced) => {
    const id = randomUUID(),
      person = randomUUID();
    await command({
      requestId: id,
      command: "prepare",
      purpose: "作業の様子を知る",
    });
    let initializationStopped = false;
    const commit = agent.store.commit.bind(agent.store);
    const interruption = sourced
      ? vi.spyOn(agent.store, "commit").mockImplementation(async (...args) => {
          if (
            !initializationStopped &&
            (args[2].changes as { nodes: { id: string }[] }).nodes.some(
              (n) => n.id === person,
            )
          ) {
            const checkpoint = structuredClone(
              (await access.scenes.latest(construction))!,
            );
            await commit(...args);
            initializationStopped = true;
            await d.postgres.query(
              "UPDATE world_scene SET state='paused',data=$2 WHERE id=$1",
              [
                id,
                {
                  ...checkpoint.data,
                  resumeState: "acting",
                  error: "初期登録の確定後に停止",
                },
              ],
            );
            throw new SupersededWorker("初期登録の確定後に停止");
          }
          return commit(...args);
        })
      : undefined;
    try {
      await access.scenes.tick(id);
      await command({ requestId: randomUUID(), command: "start" });
      if (sourced)
        await d.postgres.query(
          "UPDATE world_scene SET data=jsonb_set(data,'{sources}','{}'::jsonb) WHERE id=$1",
          [id],
        );
      const initial = (await access.scenes.latest(construction))!.data
        .background!;
      exploration = { id: person, sourced };
      const inputId = randomUUID();
      await command({
        requestId: inputId,
        command: "act",
        actionText: "作業の気配を探して声をかける",
      });
      await access.scenes.tick(id);
      expect(initializationStopped).toBe(sourced);
      if (initializationStopped) {
        expect((await access.scenes.latest(construction))!.state).toBe(
          "paused",
        );
        await command({ requestId: randomUUID(), command: "resume" });
        await access.scenes.tick(id);
      }
      const row = (await access.scenes.latest(construction))!;
      expect(row.state).toBe("active");
      expect(row.data.actions.at(-1)).toMatchObject({
        id: inputId,
        state: "complete",
      });
      expect(row.data.contextNeed).toBeUndefined();
      expect(row.data.background!.facts.slice(0, initial.facts.length)).toEqual(
        initial.facts,
      );
      expect(row.data.background!.perceptions).toEqual(initial.perceptions);
      expect(row.data.events.map((e) => e.text)).toEqual([
        "姿を認めて声をかけた",
        "今は取り込み中だと伝える",
      ]);
      expect(row.data.events.every((e) => e.inputId === inputId)).toBe(true);
      expect(row.data.choices.filter((c) => c.actorId === person)).toHaveLength(
        1,
      );
      expect(await agent.store.context(world).node(person)).toMatchObject({
        kind: "existence",
        text: "探索で具体化した存在",
      });
      expect(
        await agent.store.context(world).node(row.data.events[0]!.id),
      ).toBeUndefined();
      const anchors = sceneAnchors(
        row.data.background!,
        row.data.events,
        row.data.startedAt,
        id,
      );
      expect(anchors.nodes).toContainEqual({
        id: person,
        kind: "existence",
        text: "探索で具体化した存在",
      });
      expect(anchors.edges).toContainEqual(
        expect.objectContaining({
          kind: "see",
          source: actor,
          text: "今は取り込み中だと聞いた",
        }),
      );
    } finally {
      interruption?.mockRestore();
      exploration = undefined;
      await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [id]);
    }
  },
);

test("返答の受容から本人へ戻り、終了・再開でも履歴・未完了の意図・再送を維持する", async () => {
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
  const original = new Set(
    (
      await d.graph.executeQuery(
        "MATCH(n:WorldNode {worldId:$world}) RETURN n.id AS id",
        { world },
      )
    ).records.map((r) => r.get("id")),
  );

  await access.scenes.tick(scene.id);
  let view = await status();
  const beganAt = view.at;
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
  ).toEqual({ llm_used: 64 + modelCalls - beforeLimit, llm_limit: 128 });
  await d.postgres.query(
    "UPDATE response_call_policy SET calls=64 WHERE singleton",
  );
  view = await status();
  expect(view.state).toBe("active");
  expect(view.at).toBe(beganAt);
  expect((await access.scenes.latest(construction))!.data.events).toHaveLength(
    2,
  );
  expect(view.messages.map((m: { text: string }) => m.text)).toContain(
    "明日の手伝いはこれから相談しようと聞いた",
  );
  expect(resultCalls).toBe(0);
  const stagedNodes = (
    await d.graph.executeQuery(
      "MATCH(n:WorldNode {worldId:$world}) RETURN n.id AS id",
      { world },
    )
  ).records.filter((r) => !original.has(r.get("id")));
  for (const node of stagedNodes)
    expect(
      (
        await agent.store
          .context(world)
          .relations(node.get("id"), "status", "in", Number.MAX_SAFE_INTEGER)
      ).some((e) => e.role === "content" && e.text === "location"),
    ).toBe(true);

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
  expect(view.at).toBe(beganAt + 1000);
  expect((await runtime.get(construction)).at).toBe(0);
  const outsider = await auth.person("user");
  const hidden = await app.inject({
    url: `/api/worlds/${construction}/scene`,
    headers: { cookie: outsider.cookie },
  });
  expect(hidden.statusCode).toBe(404);
  await command({
    requestId: randomUUID(),
    command: "act",
    actionText: "別の場所へ向かう",
  });
  await access.scenes.tick(scene.id);
  worldPaused = true;
  await command({ requestId: randomUUID(), command: "finish" });
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
  expect(view.actions.at(-1)?.state).toBe("complete");
  expect(view.messages).toHaveLength(3);
  expect(resultCalls).toBe(0);
  worldPaused = false;
  faults.set("result", [
    { content: "{" },
    { content: "{}" },
    { finish: "length" },
  ]);
  await command({ requestId: randomUUID(), command: "resume" });
  // Invalidate the projection's world read after its first proposal.
  const newcomer = randomUUID();
  const projection = vi
    .spyOn(model, "complete")
    .mockImplementationOnce(async (...args) => {
      expect(args[1]).toBe("world-update");
      const response = await complete(...args);
      await addVillager(newcomer);
      return response;
    });
  try {
    await access.scenes.tick(scene.id);
    const updates = projection.mock.calls.filter(
      ([, role]) => role === "world-update",
    );
    expect(updates).toHaveLength(2);
    const latest = JSON.parse(updates[1]![2][1]!.content);
    expect(JSON.stringify(latest.initialContext)).toContain(newcomer);
    expect(latest.request.completedScene.events).toEqual(saved!.data.events);
    const finished = (await access.scenes.latest(construction))!;
    expect(finished.data.operationId).toBe(saved!.data.operationId);
    expect(finished.data.events).toEqual(saved!.data.events);
    expect(finished.data.actions).toEqual(saved!.data.actions);
    expect(
      finished.data.presentations!.slice(0, saved!.data.presentations!.length),
    ).toEqual(saved!.data.presentations);
  } finally {
    projection.mockRestore();
  }
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
  expect(resultCalls).toBe(4);
  expect(faults.get("result")).toEqual([]);
  faults.clear();
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
  expect(row.at).toBe(view.at);
  expect(row.agenda.some((w) => w.actorId === actor && w.deferred)).toBe(true);
  const movement = (await agent.view(world, actor, 2000)).observations.find(
    (o) => o.text === "一歩近づいた",
  );
  expect(movement?.period).toEqual({
    from: beganAt + 1000,
    until: beganAt + 1000,
  });
  const occurrence = (await access.scenes.latest(
    construction,
  ))!.data.events.find((e) =>
    e.receipts.some((r) => r.text === "一歩近づいた"),
  );
  expect(occurrence?.period).toEqual({ from: beganAt, until: beganAt + 1000 });
  const finalCount = modelCalls;
  await access.scenes.tick(scene.id);
  expect(modelCalls).toBe(finalCount);
  expect(backgroundCalls).toBeGreaterThan(1);
});

test("前シーンで受け取った本文を追加照会なしで読み直し、他者の秘密は渡さない", async () => {
  const opened = await command({
    requestId: randomUUID(),
    command: "prepare",
    purpose: "前の返答を読み直す",
  });
  const id = opened.json().scene.id;
  try {
    await access.scenes.tick(id);
    await command({ requestId: randomUUID(), command: "start" });
    const before = modelCalls;
    await command({
      requestId: randomUUID(),
      command: "act",
      actionText: "前の返答を読み直す",
    });
    await access.scenes.tick(id);
    expect(modelCalls).toBe(before + 1);
    const view = await status();
    expect(view.state).toBe("active");
    expect(view.actions.at(-1)?.state).toBe("complete");
    expect(view.messages.map((m: { text: string }) => m.text)).toContain(
      "前の返答は「明日の手伝いはこれから相談しよう」だった。",
    );
  } finally {
    await d.postgres.query("DELETE FROM world_scene WHERE id=$1", [id]);
  }
});
