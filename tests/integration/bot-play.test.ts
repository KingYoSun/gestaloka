import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, expect, test, vi } from "vitest";
import { PlayCommand } from "@gestaloka/contracts";
import { WorldAccess } from "@gestaloka/server/access";
import { changeBelongings, readBelongings } from "@gestaloka/server/belongings";
import { derivedId } from "@gestaloka/server/world";
import { BotPlay } from "@gestaloka/server/play";
import { createApp } from "../../apps/api/src/app.js";
import { playerCli } from "../support/player-cli.js";
import { join } from "node:path";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";

const isolated = isolatedDatabases();
let runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  access: WorldAccess,
  auth: Awaited<ReturnType<typeof fixtureAuth>>;
const graphs: string[] = [];
const answer = (id: string, content: unknown) => ({
  id,
  model: "fixture",
  content: JSON.stringify(content),
  finishReason: "stop",
  usage: {
    prompt_tokens: 1,
    completion_tokens: 1,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 1,
  },
});
afterEach(async () => {
  vi.restoreAllMocks();
  await isolated.databases.postgres.query("DELETE FROM bot_npc");
});
beforeAll(async () => {
  await isolated.setup();
  ({ runtime } = await fixtureRuntime(
    `bot-play-${randomUUID()}`,
    undefined,
    isolated.databases,
  ));
  auth = await fixtureAuth(isolated.databases.postgres);
  access = new WorldAccess(runtime);
  await access.setup();
}, 60000);
afterAll(async () => {
  await isolated.databases.queue.stop();
  for (const world of graphs)
    await isolated.databases.graph.executeQuery(
      "MATCH(n {worldId:$world}) DETACH DELETE n",
      { world },
    );
  await isolated.close();
});

async function fixture() {
  const admin = await auth.person(),
    world = (
      await access.create(admin.id, {
        requestId: randomUUID(),
        budgetUsd: 10,
        prompt: "独立したbotの検証世界",
      })
    ).id;
  await runtime.tick(world);
  const graph = (await runtime.get(world)).world_id!;
  graphs.push(graph);
  const people = await Promise.all([
    auth.person("user"),
    auth.person("user"),
    auth.person("user"),
  ]);
  const actors = people.map(() => randomUUID()),
    place = randomUUID(),
    far = randomUUID();
  const store = runtime.agent.store;
  await store.commit(
    await store.claim(graph, randomUUID()),
    store.context(graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [
          ...actors.map((id, i) => ({
            id,
            kind: "existence" as const,
            text: `人物${i}`,
          })),
          { id: place, kind: "existence", text: "広場" },
          { id: far, kind: "existence", text: "離れた場所" },
        ],
        edges: [],
        revisions: [],
        endEdges: [],
      },
    },
  );
  for (const [i, p] of people.entries()) {
    await isolated.databases.postgres.query(
      "INSERT INTO world_subject(id,user_id) VALUES($1,$1)",
      [p.id],
    );
    await isolated.databases.postgres.query(
      "INSERT INTO world_access(subject_id,construction_id,role,actor_id) VALUES($1,$2,'player',$3)",
      [p.id, world, actors[i]],
    );
    await isolated.databases.postgres.query(
      "INSERT INTO world_controlled_actor(world_id,actor_id) VALUES($1,$2)",
      [graph, actors[i]],
    );
  }
  const apply = (ops: unknown) =>
    changeBelongings(
      store,
      { worldId: graph, runId: randomUUID(), generation: 1 },
      { commitId: randomUUID(), at: 0, ops },
    );
  const move = async (i: number, location: string) => {
    await changeBelongings(store, await store.claim(graph, randomUUID()), {
      commitId: randomUUID(),
      at: 0,
      ops: [
        {
          type: "locate",
          subjectId: actors[i],
          text: location === place ? "広場" : "離れた場所",
          aboutIds: [location],
        },
      ],
    });
  };
  for (let i = 0; i < 3; i++) await move(i, i === 2 ? far : place);
  const send = (i: number, input: Record<string, unknown>) =>
    access.botCommand(
      people[i]!.id,
      world,
      PlayCommand.parse({ requestId: randomUUID(), ...input }),
      actors[i],
    );
  const status = (i: number) =>
    access.botStatus(people[i]!.id, world, actors[i]);
  for (let i = 0; i < 3; i++) await send(i, { command: "start" });
  const calls = vi.spyOn(runtime.agent.model, "complete");
  return {
    world,
    graph,
    people,
    actors,
    place,
    far,
    store,
    send,
    status,
    move,
    calls,
    apply,
  };
}

test("個別検索を同報せず、成功した8回だけで手番を進め、コメントと再送を別枠にする", async () => {
  const f = await fixture();
  const own = await f.status(0),
    other = await f.status(1);
  const joined = await f.send(0, { command: "contact", targetId: f.actors[1] });
  expect(joined.sessionId).toBe(other.sessionId);
  expect((await f.status(0)).sceneId).toBe(own.sceneId);
  await expect(
    f.send(0, { command: "comment", text: "他人の手番" }),
  ).rejects.toMatchObject({ code: "TURN_REQUIRED" });
  const request = {
    requestId: randomUUID(),
    command: "search",
    query: { kind: "self" },
  };
  const first = await f.send(1, request);
  expect(first.callsUsed).toBe(1);
  expect(await f.send(1, request)).toEqual(first);
  const stored = (
    await isolated.databases.postgres.query("SELECT $1::jsonb AS body", [
      JSON.stringify(request),
    ])
  ).rows[0].body;
  expect(
    await access.botCommand(f.people[1]!.id, f.world, stored, f.actors[1]),
  ).toEqual(first);
  await f.send(1, { command: "comment", text: "本人だけが選んだコメント" });
  await expect(
    f.send(1, { command: "comment", text: "二度目" }),
  ).rejects.toMatchObject({ code: "COMMENT_USED" });
  await expect(
    f.send(1, {
      command: "search",
      query: { kind: "subject", targetId: randomUUID() },
    }),
  ).rejects.toMatchObject({ code: "MATERIAL_NOT_AVAILABLE" });
  expect((await f.status(1)).callsUsed).toBe(1);
  for (let i = 0; i < 7; i++)
    await f.send(1, { command: "search", query: { kind: "belongings" } });
  const next = await f.status(0);
  expect(next.actorId).toBe(f.actors[0]);
  expect(next.callsUsed).toBe(0);
  expect(JSON.stringify(next.entries)).toContain("本人だけが選んだコメント");
  expect(JSON.stringify(next.entries)).not.toContain("material");
  expect(JSON.stringify((await f.status(2)).entries)).not.toContain(
    "本人だけが選んだコメント",
  );
  await f.send(0, { command: "say", text: "同席した相手に伝えた話" });
  await f.send(0, { command: "end-turn" });
  const history = await f.send(1, {
    command: "search",
    query: { kind: "history", targetId: f.actors[0] },
  });
  expect(JSON.stringify(history.material)).toContain("同席した相手に伝えた話");
  const unseen = await f.send(2, {
    command: "search",
    query: { kind: "history", targetId: f.actors[0] },
  });
  expect(unseen.material).toEqual([]);
  expect(f.calls).not.toHaveBeenCalled();
  f.calls.mockRestore();
});

test("接触の不一致から移動・再申請でき、本人のシーンを保って分離・終了する", async () => {
  const f = await fixture(),
    before = await f.status(2);
  await expect(
    f.send(2, { command: "contact", targetId: f.actors[0] }),
  ).rejects.toMatchObject({ code: "CONTACT_MISMATCH" });
  expect((await f.status(2)).callsUsed).toBe(0);
  await f.send(2, {
    command: "update",
    text: "広場へ歩く",
    operations: [
      {
        type: "locate",
        subjectId: f.actors[2],
        text: "広場",
        aboutIds: [f.place],
      },
    ],
    dependencies: [],
  });
  await f.send(2, { command: "contact", targetId: f.actors[0] });
  expect((await f.status(2)).sceneId).toBe(before.sceneId);
  expect(JSON.stringify((await f.status(2)).entries)).toContain("接触する");
  await f.send(2, { command: "leave" });
  expect((await f.status(2)).sceneId).toBe(before.sceneId);
  expect((await f.status(2)).sessionId).not.toBe((await f.status(0)).sessionId);
  const ended = await f.send(2, { command: "finish" });
  expect(ended.result).toBeDefined();
  expect((await f.status(0)).sessionId).toBeTruthy();
  expect(f.calls).not.toHaveBeenCalled();
  f.calls.mockRestore();
});

test("同席者への受領判断を挟み、拒否・承認後に元の手番へ戻す。借り手の破棄は貸し手の承認を求めない", async () => {
  const f = await fixture();
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const item = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [{ id: item, kind: "existence", text: "借りた道具" }],
        edges: [
          {
            id: randomUUID(),
            kind: "has",
            source: f.actors[1]!,
            target: item,
            period: { from: 0 },
          },
          {
            id: randomUUID(),
            kind: "has",
            role: "hold",
            source: f.actors[0]!,
            target: item,
            period: { from: 0 },
          },
        ],
        revisions: [],
        endEdges: [],
      },
    },
  );
  const operations = [
    {
      type: "move",
      item,
      from: f.actors[0],
      to: f.actors[1],
      basis: "道具を返す",
    },
  ];
  const pending = await f.send(0, {
    command: "update",
    text: "道具を返す",
    operations,
    dependencies: [],
  });
  expect(pending.actorId).toBe(f.actors[1]);
  expect(
    (await readBelongings(f.store.context(f.graph), f.actors[0]!)).items,
  ).toHaveLength(1);
  await f.send(1, {
    command: "receive",
    applicationId: pending.applicationId,
    accept: false,
  });
  expect((await f.status(0)).actorId).toBe(f.actors[0]);
  const removing = {
    requestId: randomUUID(),
    command: "update",
    text: "道具が壊れる",
    operations: [{ type: "remove", id: item }],
    dependencies: [],
  };
  const accepted = await f.send(0, removing);
  expect(accepted.receiving).toBeNull();
  expect(await f.send(0, removing)).toEqual(accepted);
  expect(
    (await readBelongings(f.store.context(f.graph), f.actors[0]!)).items,
  ).toHaveLength(0);
  expect(f.calls).not.toHaveBeenCalled();
  f.calls.mockRestore();
});

test("遠隔受領は即時拒否し、同席者の承認・退出・無応答で原子的に確定またはfailedとなる", async () => {
  const f = await fixture();
  const seed = async () => {
    const item = randomUUID();
    await f.store.commit(
      await f.store.claim(f.graph, randomUUID()),
      f.store.context(f.graph),
      {
        commitId: randomUUID(),
        at: 0,
        changes: {
          nodes: [{ id: item, kind: "existence", text: "渡す道具" }],
          edges: [
            {
              id: randomUUID(),
              kind: "has",
              role: "hold",
              source: f.actors[0]!,
              target: item,
              period: { from: 0 },
            },
          ],
          revisions: [],
          endEdges: [],
        },
      },
    );
    return item;
  };
  const give = (item: string, to: string) =>
    f.send(0, {
      command: "update",
      text: "道具を渡す",
      operations: [
        { type: "move", item, from: f.actors[0], to, basis: "手渡す" },
      ],
      dependencies: [],
    });
  const remote = await seed();
  await expect(give(remote, f.actors[2]!)).rejects.toMatchObject({
    code: "REMOTE_RECEIVING",
  });
  expect(f.calls).not.toHaveBeenCalled();
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const accepted = await give(remote, f.actors[1]!);
  await f.send(1, {
    command: "receive",
    applicationId: accepted.applicationId,
    accept: true,
  });
  expect((await f.status(0)).actorId).toBe(f.actors[0]);
  expect(
    (await readBelongings(f.store.context(f.graph), f.actors[1]!)).items.map(
      (v) => v.id,
    ),
  ).toContain(remote);
  const timeoutItem = await seed(),
    timeout = await give(timeoutItem, f.actors[1]!);
  const clock = new BotPlay(runtime, () => new Date(Date.now() + 601000));
  await clock.expire(f.world);
  const resumed = await f.status(0);
  expect(resumed.receiving).toBeNull();
  expect(resumed.actorId).toBe(f.actors[0]);
  expect(JSON.stringify(resumed.entries)).toContain(
    timeout.applicationId as string,
  );
  expect(JSON.stringify(resumed.entries)).toContain("failed");
  const leaving = await give(timeoutItem, f.actors[1]!);
  await f.send(1, { command: "leave" });
  expect((await f.status(0)).receiving).toBeNull();
  expect(
    (await readBelongings(f.store.context(f.graph), f.actors[0]!)).items.map(
      (v) => v.id,
    ),
  ).toContain(timeoutItem);
  expect(JSON.stringify((await f.status(0)).entries)).toContain(
    leaving.applicationId as string,
  );
  expect(f.calls).not.toHaveBeenCalled();
});

test("HTTPとCLIは本人の手番APIを使い、旧書込を拒否し、同じ要求を復元する", async () => {
  const f = await fixture(),
    app = await createApp(access, auth.identity, undefined, auth.operations),
    cli = await playerCli(app);
  try {
    const profile = join(cli.directory, "bot.json");
    const connected = await cli.run(
      profile,
      "connect",
      "--server",
      cli.base,
      "--world",
      f.world,
    );
    expect(
      (
        await cli.approve(
          f.people[0]!.cookie,
          connected.userCode,
          `actor:${f.actors[0]}`,
        )
      ).statusCode,
    ).toBe(302);
    const result = await cli.run(profile, "search", "--kind", "self");
    expect(result.result.callsUsed).toBe(1);
    expect(
      await cli.run(profile, "recover", "--request", result.requestId),
    ).toEqual(result);
    const old = await app.inject({
      method: "POST",
      url: `/api/worlds/${f.world}/scene?actorId=${f.actors[0]}`,
      headers: { cookie: f.people[0]!.cookie, "x-gestaloka-request": "1" },
      payload: {
        requestId: randomUUID(),
        command: "prepare",
        purpose: "旧入口",
      },
    });
    expect(old.statusCode).toBe(409);
    expect(old.json().code).toBe("PLAY_API_CHANGED");
    expect(f.calls).not.toHaveBeenCalled();
  } finally {
    await cli.close();
    await app.close();
  }
});

test("個体指定のない旧NPCフラグを無視し、bot担当とサーバー担当を個別に指定する", async () => {
  const f = await fixture(),
    admin = await auth.person(),
    npcs = [randomUUID(), randomUUID(), randomUUID()];
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: npcs.map((id, i) => ({
          id,
          kind: "existence",
          text: `固有NPC${i}`,
        })),
        edges: [],
        revisions: [],
        endEdges: [],
      },
    },
  );
  await isolated.databases.postgres.query(
    "INSERT INTO world_controlled_actor(world_id,actor_id,npc_active) VALUES($1,$2,true)",
    [f.graph, npcs[0]],
  );
  await access.botPlay.tickNpcs();
  expect(f.calls).not.toHaveBeenCalled();
  for (const [i, controller] of ["bot", "server"].entries())
    await auth.operations.execute(
      admin.id,
      randomUUID(),
      {
        operation: "npcs.put",
        worldId: f.world,
        actorId: npcs[i + 1]!,
        controller: controller as "bot" | "server",
        ...(controller === "bot" ? { userId: f.people[0]!.id } : {}),
        reason: "個体ごとの担当指定",
      },
      { players: access.players },
    );
  await access.botCommand(
    f.people[0]!.id,
    f.world,
    { requestId: randomUUID(), command: "start" },
    npcs[1],
  );
  f.calls.mockImplementation(async (id, role) =>
    answer(
      id,
      role === "world-server-npc"
        ? { command: "say", text: "独立した人物としての一手" }
        : { allowed: true, reason: "許可" },
    ),
  );
  await access.botPlay.tickNpcs();
  expect(f.calls.mock.calls.map((c) => c[1])).toEqual(["world-server-npc"]);
  expect(await access.botPlay.current(f.world, npcs[0]!)).toBeUndefined();
  expect(await access.botPlay.current(f.world, npcs[2]!)).toBeDefined();
  const before = (
    await f.store.driver.executeQuery(
      "MATCH(n:WorldNode {worldId:$world,kind:'existence'}) RETURN count(n) AS n",
      { world: f.graph },
    )
  ).records[0]!.get("n").toNumber();
  await f.send(0, {
    command: "say",
    text: "木陰を小さな動物が横切る",
    instantNpcs: ["その場だけの小動物"],
  });
  expect(
    (
      await f.store.driver.executeQuery(
        "MATCH(n:WorldNode {worldId:$world,kind:'existence'}) RETURN count(n) AS n",
        { world: f.graph },
      )
    ).records[0]!.get("n").toNumber(),
  ).toBe(before);
});

test("対抗行動の0%・100%ではGMも抽選も使わず、不確実な行動だけ一度の設定と抽選を保存する", async () => {
  const f = await fixture(),
    items = [randomUUID(), randomUUID()];
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: items.map((id) => ({ id, kind: "existence", text: "道具" })),
        edges: items.map((target, i) => ({
          id: randomUUID(),
          kind: "has",
          role: "hold",
          source: f.actors[i]!,
          target,
          period: { from: 0 },
        })),
        revisions: [],
        endEdges: [],
      },
    },
  );
  const attempt = (
    itemId: string,
    holderId: string,
    requestId = randomUUID(),
  ) =>
    f.send(0, {
      requestId,
      command: "oppose",
      text: "道具を確保する",
      operations: [
        {
          type: "move",
          item: itemId,
          from: holderId,
          to: f.actors[0],
          basis: "道具を確保する",
        },
      ],
      dependencies: [],
    });
  expect((await attempt(items[1]!, f.actors[2]!)).outcome).toMatchObject({
    success: false,
  });
  expect((await attempt(items[0]!, f.actors[0]!)).outcome).toMatchObject({
    success: true,
  });
  expect(f.calls).not.toHaveBeenCalled();
  f.calls.mockImplementation(async (id) =>
    answer(id, { sides: 6, successThrough: 3 }),
  );
  const requestId = randomUUID(),
    uncertain = await attempt(items[1]!, f.actors[1]!, requestId);
  expect((uncertain.outcome as { roll: number }).roll).toBeGreaterThan(0);
  expect(await attempt(items[1]!, f.actors[1]!, requestId)).toEqual(uncertain);
  expect(f.calls).toHaveBeenCalledTimes(1);
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT count(*)::int AS n FROM bot_dice WHERE id=$1",
        [requestId],
      )
    ).rows[0].n,
  ).toBe(1);
});

test("作成の規則で許可・拒否できる場合はGMを呼ばず、本人の解釈をチャットへ同報しない", async () => {
  const f = await fixture();
  const speech = randomUUID(),
    event = derivedId(`${speech}:speech`),
    thought = randomUUID(),
    script = randomUUID();
  const make = (
    nodes: unknown[],
    edges: unknown[],
    text = "本人からの新規作成申請",
  ) =>
    f.send(0, {
      command: "create",
      text,
      changes: { nodes, revisions: [], edges, endEdges: [] },
      dependencies: [],
    });
  await f.send(0, { requestId: speech, command: "say", text: "本人の発言" });
  await expect(
    make(
      [{ id: randomUUID(), kind: "script", text: "不正な接続" }],
      [
        {
          id: randomUUID(),
          kind: "has",
          source: event,
          target: f.actors[0],
          period: { from: 0 },
        },
      ],
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_REJECTED" });
  await make(
    [{ id: thought, kind: "script", text: "本人だけが持つ人物解釈" }],
    [
      {
        id: randomUUID(),
        kind: "interpret",
        role: "content",
        source: f.actors[0],
        target: thought,
        period: { from: 0 },
      },
      {
        id: randomUUID(),
        kind: "interpret",
        role: "about",
        source: thought,
        target: f.actors[1],
        period: { from: 0 },
      },
    ],
    "私的な解釈を保存する",
  );
  expect(f.calls).not.toHaveBeenCalled();
  await f.send(0, { command: "end-turn" });
  expect(JSON.stringify((await f.status(0)).entries)).not.toContain(
    "私的な解釈",
  );
  f.calls.mockImplementation(async (id) =>
    answer(id, { allowed: true, reason: "材料に照らして作成可能" }),
  );
  await make(
    [{ id: script, kind: "script", text: "新しい自由な性質" }],
    [
      {
        id: randomUUID(),
        kind: "status",
        role: "content",
        source: f.actors[0],
        target: script,
        period: { from: 0 },
      },
    ],
  );
  expect(f.calls).toHaveBeenCalledTimes(1);
  expect(f.calls.mock.calls[0]![1]).toBe("world-creation-permission");
});

test("周囲の検索は所在地以外の記述が増えてもグラフ照会数を増やさない", async () => {
  const f = await fixture(),
    sessions = vi.spyOn(f.store.driver, "session");
  await f.send(0, { command: "search", query: { kind: "surroundings" } });
  const count = sessions.mock.calls.length;
  const nodes = Array.from({ length: 100 }, (_, i) => ({
    id: randomUUID(),
    kind: "script" as const,
    text: `場所についての記述${i}`,
  }));
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes,
        revisions: [],
        endEdges: [],
        edges: nodes.flatMap((n) => [
          {
            id: randomUUID(),
            kind: "status" as const,
            role: "content" as const,
            source: f.actors[2]!,
            target: n.id,
            period: { from: 0 },
          },
          {
            id: randomUUID(),
            kind: "status" as const,
            role: "about" as const,
            source: n.id,
            target: f.place,
            period: { from: 0 },
          },
        ]),
      },
    },
  );
  sessions.mockClear();
  const result = await f.send(0, {
    command: "search",
    query: { kind: "surroundings" },
  });
  expect(sessions.mock.calls.length).toBe(count);
  expect(JSON.stringify(result.material)).not.toContain(f.actors[2]);
  expect(f.calls).not.toHaveBeenCalled();
});

test("旧進行の表示済み履歴を本人のシーンへ引き継ぎ、一つのリザルトに含める", async () => {
  const f = await fixture();
  await f.send(0, { command: "finish" });
  const publicId = randomUUID(),
    segment = randomUUID(),
    event = randomUUID(),
    db = isolated.databases.postgres;
  const background = {
    type: "background",
    synopsis: "保存した本人の場面",
    participants: f.actors,
    facts: [],
    perceptions: [
      {
        observerId: f.actors[0],
        text: "本人の初期の見聞",
        sourceIds: [f.place],
      },
    ],
    unknowns: [],
    creations: [],
    beliefs: [],
  };
  const data = {
    worldId: f.graph,
    at: 0,
    startedAt: 0,
    commandId: randomUUID(),
    background,
    actions: [],
    events: [],
    choices: [],
    pending: {},
    intentions: {},
    previous: {},
    views: {},
    roots: [f.place],
    originalAgenda: [],
    basis: [],
    purpose: "過去の場面",
    nextDecisions: [],
  };
  for (const id of [publicId, segment])
    await db.query(
      "INSERT INTO world_scene(id,construction_id,actor_id,state,data) VALUES($1,$2,$3,'active',$4)",
      [id, f.world, f.actors[0], data],
    );
  await db.query(
    "INSERT INTO world_scene_session(id,actor_id,world_id,current_id,opening) VALUES($1,$2,$3,$4,$5)",
    [
      publicId,
      f.actors[0],
      f.world,
      segment,
      { sceneId: publicId, at: 0, background },
    ],
  );
  await db.query(
    "INSERT INTO world_scene_member(scene_id,world_id,actor_id,request_id,state,kind,session_id) VALUES($1,$2,$3,$4,'joined','bot',$5)",
    [segment, f.world, f.actors[0], randomUUID(), publicId],
  );
  await db.query(
    "INSERT INTO world_actor_scene(world_id,actor_id,scene_id) VALUES($1,$2,$3)",
    [f.world, f.actors[0], segment],
  );
  await db.query(
    "INSERT INTO world_scene_record(session_id,actor_id,kind,id,scene_id,position,payload) VALUES($1,$2,'events',$3,$4,0,$5)",
    [
      publicId,
      f.actors[0],
      event,
      segment,
      {
        id: event,
        actorId: f.actors[0],
        text: "保存された出来事",
        period: { from: 0, until: 0 },
        receipts: [{ observerId: f.actors[0], text: "本人に届いた見聞" }],
      },
    ],
  );
  const archived = await access.scene(
    f.people[0]!.id,
    f.world,
    false,
    f.actors[0],
    publicId,
  );
  expect(archived.scene?.id).toBe(publicId);
  expect(archived.scene?.messages[0]?.text).toBe("本人に届いた見聞");
  await f.send(0, { command: "start" });
  expect((await f.status(0)).sceneId).toBe(publicId);
  const finished = await f.send(0, { command: "finish" });
  expect((finished.result as { legacy: unknown[] }).legacy).toHaveLength(1);
  expect(f.calls).not.toHaveBeenCalled();
});

test("受領は関係する全員の判断を待ち、一人の拒否では全差分を未適用に保つ", async () => {
  const f = await fixture();
  await f.move(2, f.place);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  await f.send(2, { command: "contact", targetId: f.actors[0] });
  const storage = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [{ id: storage, kind: "existence", text: "保管先" }],
        edges: [
          {
            id: randomUUID(),
            kind: "has",
            source: f.actors[0]!,
            target: storage,
            period: { from: 0 },
          },
        ],
        revisions: [],
        endEdges: [],
      },
    },
  );
  const offer = () =>
    f.send(0, {
      command: "update",
      text: "二人へ保管先の利用を申し出る",
      operations: f.actors.slice(1).map((person) => ({
        type: "grant",
        person,
        storage,
        basis: "利用の申請",
      })),
      dependencies: [],
    });
  const first = await offer();
  await f.send(1, { command: "comment", text: "判断のコメント" });
  await expect(
    f.send(1, { command: "comment", text: "二度目" }),
  ).rejects.toMatchObject({ code: "COMMENT_USED" });
  await f.send(1, {
    command: "receive",
    applicationId: first.applicationId,
    accept: true,
  });
  expect((await f.status(0)).actorId).toBe(f.actors[2]);
  await f.send(2, {
    command: "receive",
    applicationId: first.applicationId,
    accept: false,
  });
  expect(
    (await readBelongings(f.store.context(f.graph), f.actors[1]!)).storages,
  ).toHaveLength(0);
  const second = await offer();
  for (const i of [1, 2])
    await f.send(i, {
      command: "receive",
      applicationId: second.applicationId,
      accept: true,
    });
  expect((await f.status(0)).actorId).toBe(f.actors[0]);
  for (const actor of f.actors.slice(1))
    expect(
      (await readBelongings(f.store.context(f.graph), actor)).storages,
    ).toHaveLength(1);
  expect(f.calls).not.toHaveBeenCalled();
});

test("依存版の不一致と運用停止を理由付きエラーにし、失敗した要求で枠を消費しない", async () => {
  const f = await fixture(),
    basis = await f.send(0, { command: "search", query: { kind: "self" } }),
    db = isolated.databases.postgres;
  await f.move(0, f.far);
  await expect(
    f.send(0, {
      command: "update",
      text: "移動",
      operations: [
        {
          type: "locate",
          subjectId: f.actors[0],
          text: "広場",
          aboutIds: [f.place],
        },
      ],
      dependencies: basis.dependencies,
    }),
  ).rejects.toMatchObject({ code: "WORLD_CHANGED" });
  await db.query(
    "UPDATE runtime_control SET configuration=jsonb_set(configuration,'{paused}','true') WHERE singleton",
  );
  try {
    await expect(
      f.send(0, { command: "say", text: "運用停止中の入力" }),
    ).rejects.toMatchObject({ code: "MAINTENANCE" });
  } finally {
    await db.query(
      "UPDATE runtime_control SET configuration=jsonb_set(configuration,'{paused}','false') WHERE singleton",
    );
  }
  expect((await f.status(0)).callsUsed).toBe(1);
  expect(f.calls).not.toHaveBeenCalled();
});

test("GM判断中に利用停止されても長いDBロックを持たず、確定前の権限確認で差分を拒否する", async () => {
  const f = await fixture(),
    script = randomUUID(),
    db = isolated.databases.postgres;
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    waiting = new Promise<void>((r) => {
      reached = r;
    });
  f.calls.mockImplementation(async (id) => {
    reached();
    await gate;
    return answer(id, { allowed: true, reason: "作成可" });
  });
  const pending = f.send(0, {
    command: "create",
    text: "性質を追加する",
    changes: {
      nodes: [{ id: script, kind: "script", text: "新しい性質" }],
      revisions: [],
      endEdges: [],
      edges: [
        {
          id: randomUUID(),
          kind: "status",
          role: "content",
          source: f.actors[0],
          target: script,
          period: { from: 0 },
        },
      ],
    },
    dependencies: [],
  });
  await waiting;
  await db.query("UPDATE app_user SET banned=true WHERE id=$1", [
    f.people[0]!.id,
  ]);
  release();
  await expect(pending).rejects.toMatchObject({ code: "USER_BANNED" });
  expect(await f.store.context(f.graph).node(script)).toBeUndefined();
});
