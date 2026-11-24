import { randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { readFile, readdir, writeFile } from "node:fs/promises";
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  type FriendCommand,
  BlueprintDraft,
  InventoryBundleCommand,
  PlayCommand,
  PlayerPlayCommand,
  SpectatingView,
  WaitingEvent,
} from "@gestaloka/contracts";
import { WorldAccess } from "@gestaloka/server/access";
import { LlmClient } from "@gestaloka/server/llm";
import { decisionSettings } from "../../packages/server/src/llm/config.js";
import { readPlayUsage } from "../../packages/server/src/runtime/play-usage.js";
import { changeBelongings, readBelongings } from "@gestaloka/server/belongings";
import { derivedId, WorldContext } from "@gestaloka/server/world";
import type { Change } from "@gestaloka/contracts";
import {
  addRoute,
  directPlaces,
  linkRoute,
  locationRecords,
} from "../../packages/server/src/world/locations.js";
import { BotPlay } from "@gestaloka/server/play";
import { createApp } from "../../apps/api/src/app.js";
import { cliVersionHeader, playerCli } from "../support/player-cli.js";
import { localTime } from "../../packages/player-cli/src/references.js";
import type { z } from "zod";
import { join, resolve } from "node:path";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import { approvedTransport, modelEnvironment } from "../support/model.js";
import { createCountedClient } from "../support/token-counting.js";
import { startPlayLoop } from "../../apps/worker/src/play-loop.js";
import {
  withDrainedWorker,
  workerSocket,
} from "../../apps/worker/src/deployment.js";
import { vehicleOperator } from "../../packages/server/src/runtime/vehicles.js";

const isolated = isolatedDatabases();
let runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  access: WorldAccess,
  auth: Awaited<ReturnType<typeof fixtureAuth>>;
const graphs: string[] = [];
// 成功範囲が面数未満という制約の中で、実質的に必ず成功するダイス設定。
const sure = { sides: 2147483647, successThrough: 2147483646 };
// 探索の判定で、GMが書き分ける道の記述と場所の説明。
const explored = {
  route: "広場の裏手から細い小道を抜けると、新しい場所に着く。",
  description: "木立に囲まれた静かな場所。",
  partOf: false,
};
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
  vi.unstubAllEnvs();
  await isolated.databases.postgres.query("DELETE FROM bot_npc");
  await isolated.databases.postgres.query(
    "UPDATE player_report_policy SET daily_limit=10,turns_per_report=3,max_characters=1200",
  );
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
}, 120000);

async function fixture(playerCount = 3) {
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
  const people = await Promise.all(
    Array.from({ length: playerCount }, () => auth.person("user")),
  );
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
  const apply = async (ops: unknown) =>
    changeBelongings(store, await store.claim(graph, randomUUID()), {
      commitId: randomUUID(),
      at: 0,
      ops,
    });
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
  for (const i of people.keys()) await move(i, i === 2 ? far : place);
  const send = (i: number, input: Record<string, unknown>) =>
    access.botCommand(
      people[i]!.id,
      world,
      (input.command === "apply" ? PlayerPlayCommand : PlayCommand).parse({
        requestId: randomUUID(),
        ...input,
      }),
      actors[i],
    );
  const status = (i: number) =>
    access.botStatus(people[i]!.id, world, actors[i]);
  for (const i of people.keys()) await send(i, { command: "start" });
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
    friend: (i: number, input: z.infer<typeof FriendCommand>) =>
      access.friend(people[i]!.id, world, input, actors[i]),
    view: (i: number, targetId: string, viewers: "all" | string[]) =>
      access.setViewers(
        people[i]!.id,
        world,
        { requestId: randomUUID(), targetId, viewers },
        actors[i],
      ),
  };
}

function mark(
  change: Change,
  source: string,
  marker: string,
  about: { id: string; text?: string }[] = [],
) {
  const script = randomUUID();
  change.nodes.push({ id: script, kind: "script", text: marker });
  change.edges.push(
    {
      id: randomUUID(),
      kind: "status",
      role: "content",
      source,
      target: script,
      text: marker,
      period: { from: 0 },
    },
    ...about.map(({ id, text }) => ({
      id: randomUUID(),
      kind: "status" as const,
      role: "about" as const,
      source: script,
      target: id,
      ...(text ? { text } : {}),
      period: { from: 0 },
    })),
  );
}

async function vehicleFixture(
  f: Awaited<ReturnType<typeof fixture>>,
  {
    npcId,
    holder,
    route = false,
  }: { npcId?: string; holder?: string; route?: boolean } = {},
) {
  const vehicleId = npcId ?? randomUUID();
  const changes: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  if (!npcId)
    changes.nodes.push({ id: vehicleId, kind: "existence", text: "台車" });
  mark(changes, vehicleId, "vehicle");
  if (holder)
    changes.edges.push({
      id: randomUUID(),
      kind: "has",
      source: holder,
      target: vehicleId,
      period: { from: 0 },
    });
  if (route) {
    const capability = randomUUID();
    const script = randomUUID();
    changes.nodes.push(
      { id: capability, kind: "existence", text: "溝を越えられる" },
      { id: script, kind: "script", text: "溝を越える区間" },
    );
    for (const place of [f.place, f.far]) {
      changes.edges.push(
        {
          id: randomUUID(),
          kind: "status",
          role: "content",
          source: place,
          target: script,
          text: "route",
          period: { from: 0 },
        },
        {
          id: randomUUID(),
          kind: "status",
          role: "about",
          source: script,
          target: place,
          period: { from: 0 },
        },
      );
    }
    changes.edges.push({
      id: randomUUID(),
      kind: "status",
      role: "about",
      source: script,
      target: capability,
      text: "route-requires",
      period: { from: 0 },
    });
    mark(changes, vehicleId, "capability", [{ id: capability }]);
  }
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes,
    },
  );
  if (!holder && !npcId)
    await f.apply([
      {
        type: "locate",
        subjectId: vehicleId,
        aboutIds: [f.place],
        text: "広場",
      },
    ]);
  return vehicleId;
}

const locate = (subjectId: string, placeId: string) => ({
  command: "update",
  text: "移動する",
  dependencies: [],
  operations: [
    { type: "locate", subjectId, aboutIds: [placeId], text: "移動先" },
  ],
});

test("乗降と運行は専用操作とlocateで同じ所在になり、通行条件と出発後の乗り場を照合する", async () => {
  const f = await fixture();
  const [driver, passenger, outside] = f.actors as [string, string, string];
  const vehicleId = await vehicleFixture(f, { route: true });
  await f.move(2, f.place);
  const at = (id: string) => directPlaces(f.store.context(f.graph), id);
  const search = (i: number, kind: "self" | "surroundings") =>
    f.send(i, { command: "search", query: { kind } });
  await expect(f.send(2, locate(outside, f.far))).rejects.toMatchObject({
    code: "ROUTE_REQUIREMENT_UNMET",
  });
  await expect(search(1, "surroundings")).resolves.toMatchObject({
    material: {
      vehicles: { items: [{ vehicleId, placeId: f.place }], next: null },
    },
  });
  await expect(
    f.send(0, { command: "vehicle-request-control", vehicleId }),
  ).resolves.toMatchObject({
    state: "accepted",
    vehicleId,
    operatorId: driver,
  });
  await expect(
    f.send(0, { command: "vehicle-board", vehicleId }),
  ).resolves.toMatchObject({
    state: "accepted",
    directPlaceId: vehicleId,
    outerPlaceId: f.place,
  });
  await f.send(1, locate(passenger, vehicleId));
  await expect(f.send(1, locate(vehicleId, f.far))).rejects.toMatchObject({
    code: "VEHICLE_CONTROL_REQUIRED",
  });
  const bag = (
    await f.apply([
      { type: "create", label: "隊の荷物", holder: driver, basis: "積み荷" },
    ])
  ).changes.nodes[0]!;
  await f.send(0, {
    command: "update",
    text: "荷を積む",
    dependencies: [],
    operations: [
      {
        type: "move",
        item: bag.id,
        from: driver,
        to: vehicleId,
        basis: "積み荷",
      },
    ],
  });
  await expect(
    f.send(0, { command: "vehicle-travel", vehicleId, destinationId: f.far }),
  ).resolves.toMatchObject({
    state: "accepted",
    vehicleId,
    fromId: f.place,
    destinationId: f.far,
  });
  expect(await at(passenger)).toEqual([vehicleId]);
  await expect(search(1, "self")).resolves.toMatchObject({
    material: {
      ride: { vehicleId, directPlaceId: vehicleId, outerPlaceId: f.far },
    },
  });
  await expect(search(1, "surroundings")).resolves.toMatchObject({
    material: {
      routes: [{ id: f.place }],
      passengers: {
        items: expect.arrayContaining([{ actorId: driver, name: "人物0" }]),
      },
    },
  });
  await expect(
    f.send(2, { command: "vehicle-board", vehicleId }),
  ).rejects.toMatchObject({ code: "VEHICLE_NOT_HERE" });
  await expect(f.send(2, locate(outside, vehicleId))).rejects.toMatchObject({
    code: "VEHICLE_NOT_HERE",
  });
  await expect(f.send(1, locate(passenger, f.place))).rejects.toMatchObject({
    code: "VEHICLE_NOT_HERE",
  });
  await expect(
    f.send(1, { command: "vehicle-leave", vehicleId }),
  ).resolves.toMatchObject({ state: "accepted", directPlaceId: f.far });
  await f.send(0, locate(vehicleId, f.place));
  expect(await at(passenger)).toEqual([f.far]);
  expect(await at(driver)).toEqual([vehicleId]);
  await f.send(0, locate(driver, f.place));
  expect(await at(driver)).toEqual([f.place]);
  expect((await f.store.context(f.graph).holding(bag.id))?.source).toBe(
    vehicleId,
  );
});

test("他人の所持と操縦権には明示したときだけ対抗し、相手別の出目で一括確定する", async () => {
  const f = await fixture();
  const [actor, operator, holder] = f.actors as [string, string, string];
  const db = isolated.databases.postgres;
  await f.move(2, f.place);
  const vehicleId = await vehicleFixture(f);
  const claim = (i: number, fields: object = {}) =>
    f.send(i, { command: "vehicle-request-control", vehicleId, ...fields });
  await claim(1);
  await f.apply([
    { type: "move", from: null, to: holder, item: vehicleId, basis: "運ぶ" },
  ]);
  const fuel = (
    await f.apply([
      {
        type: "create",
        label: "道具の材料",
        holder: actor,
        count: 3,
        basis: "手持ち",
      },
    ])
  ).changes.nodes[0]!;
  const rolls = () =>
    f.calls.mock.calls.filter((args) => args[1] === "world-opposition-dice");
  for (const flag of [{}, { oppose: false }])
    await expect(claim(0, flag)).rejects.toMatchObject({
      code: "VEHICLE_OPPOSITION_REQUIRED",
    });
  expect(rolls()).toHaveLength(0);
  const setting = {
    sides: 2,
    successThrough: 1,
    consumes: [{ id: fuel.id, count: 1 }],
  };
  f.calls.mockImplementation(async (id) => answer(id, setting));
  const prepare = async (requestId: string, failures: string[] = []) => {
    for (const opponent of [operator, holder])
      await db.query("INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,$3)", [
        derivedId(`${requestId}:vehicle-opposition:${opponent}`),
        setting,
        failures.includes(opponent) ? 2 : 1,
      ]);
  };
  const context = () => f.store.context(f.graph);
  const failedId = randomUUID();
  await prepare(failedId, [operator]);
  await expect(
    claim(0, { oppose: true, requestId: failedId }),
  ).resolves.toMatchObject({
    state: "rejected",
    outcome: {
      success: false,
      contests: expect.arrayContaining([
        expect.objectContaining({ opponentId: holder, success: true }),
        expect.objectContaining({ opponentId: operator, success: false }),
      ]),
    },
  });
  expect(await vehicleOperator(context(), vehicleId)).toMatchObject({
    actorId: operator,
  });
  expect((await context().holding(vehicleId))?.source).toBe(holder);
  expect(await context().node(fuel.id)).toHaveProperty("count", 3);
  const requestId = randomUUID();
  await prepare(requestId);
  const expected = await claim(0, { oppose: true, requestId });
  expect(expected).toMatchObject({
    state: "accepted",
    operatorId: actor,
    previousOperatorId: operator,
    outcome: { success: true },
  });
  expect(await claim(0, { oppose: true, requestId })).toEqual(expected);
  expect(rolls()).toHaveLength(4);
  expect(await context().holding(vehicleId)).toBeUndefined();
  expect(await directPlaces(context(), vehicleId)).toEqual([f.place]);
  expect(await vehicleOperator(context(), vehicleId)).toMatchObject({
    actorId: actor,
  });
  expect(await context().node(fuel.id)).toHaveProperty("count", 1);
  const duplicate = randomUUID();
  const callsUsed = (await f.status(0)).callsUsed;
  await expect(
    claim(0, { oppose: true, requestId: duplicate }),
  ).resolves.toMatchObject({ state: "accepted", operatorId: actor, callsUsed });
  expect(await f.store.receipt(f.graph, duplicate)).toBeUndefined();
  expect(rolls()).toHaveLength(4);
});

test("容器の所持者と現操縦者が同一なら一回だけ対抗し、申請者自身の所持は維持する", async () => {
  const f = await fixture();
  const [actor, other] = f.actors as [string, string, string];
  const vehicleId = await vehicleFixture(f);
  await f.send(1, { command: "vehicle-request-control", vehicleId });
  const box = (
    await f.apply([
      { type: "create", label: "箱", holder: other, basis: "携行" },
    ])
  ).changes.nodes[0]!;
  await f.apply([
    { type: "move", item: vehicleId, from: null, to: box.id, basis: "保管" },
  ]);
  f.calls.mockImplementation(async (id) => answer(id, sure));
  await expect(
    f.send(0, { command: "vehicle-request-control", vehicleId, oppose: true }),
  ).resolves.toMatchObject({
    operatorId: actor,
    previousOperatorId: other,
    outcome: { contests: [expect.objectContaining({ opponentId: other })] },
  });
  const context = () => f.store.context(f.graph);
  expect(await context().holding(vehicleId)).toBeUndefined();
  expect((await context().holding(box.id))?.source).toBe(other);
  await f.apply([
    { type: "move", item: vehicleId, from: null, to: other, basis: "携行" },
  ]);
  const hold = await context().holding(vehicleId);
  await expect(
    f.send(1, { command: "vehicle-request-control", vehicleId, oppose: true }),
  ).resolves.toMatchObject({
    operatorId: other,
    previousOperatorId: actor,
    outcome: { contests: [expect.objectContaining({ opponentId: actor })] },
  });
  expect(await context().holding(vehicleId)).toEqual(hold);
  expect(
    f.calls.mock.calls.filter((args) => args[1] === "world-opposition-dice"),
  ).toHaveLength(2);
});

async function setNpc(
  f: Awaited<ReturnType<typeof fixture>>,
  i: number,
  controller: "bot" | "server",
) {
  await isolated.databases.postgres.query(
    "INSERT INTO bot_npc(world_id,actor_id,controller,user_id,assignment_id) VALUES($1,$2,$3,$4,$5)",
    [f.world, f.actors[i], controller, f.people[i]!.id, randomUUID()],
  );
}

// 外部botが担当するNPCへの同行申請は、本人の受領で成立する。
async function accompany(
  f: Awaited<ReturnType<typeof fixture>>,
  targetId: string,
  text: string,
  accept = true,
) {
  const sent = await f.send(0, {
    command: "companion-request",
    targetId,
    text,
  });
  await f.send(
    f.actors.findIndex((id) => id === targetId),
    { command: "receive", applicationId: sent.applicationId, accept },
  );
  return sent;
}

async function giveTurn(
  f: Awaited<ReturnType<typeof fixture>>,
  target: number,
) {
  for (let i = 0; i < f.actors.length; i++) {
    const status = await f.status(target);
    if (status.actorId === f.actors[target]) return;
    await f.send(
      f.actors.findIndex((id) => id === status.actorId),
      { command: "end-turn" },
    );
  }
  throw new Error("手番を渡せませんでした");
}

test("乗り物のNPCの却下で終了し、承認済みの申請から第三者だけに対抗できる", async () => {
  const f = await fixture();
  const [actor, npcId, incumbent] = f.actors as [string, string, string];
  await setNpc(f, 1, "bot");
  await f.move(2, f.place);
  const vehicleId = await vehicleFixture(f, { npcId });
  const claim = (i: number, fields: object = {}) =>
    f.send(i, { command: "vehicle-request-control", vehicleId, ...fields });
  const opposeCalls = () =>
    f.calls.mock.calls.filter((args) => args[1] === "world-opposition-dice");
  await expect(claim(0)).rejects.toMatchObject({ code: "REMOTE_RECEIVING" });
  await f.send(1, { command: "contact", targetId: actor });
  await giveTurn(f, 0);
  const declined = randomUUID();
  await expect(claim(0, { requestId: declined })).resolves.toMatchObject({
    state: "receiving",
    applicationId: declined,
  });
  await expect(
    f.send(1, { command: "receive", applicationId: declined, accept: false }),
  ).resolves.toMatchObject({ application: { state: "rejected" } });
  expect(opposeCalls()).toHaveLength(0);
  expect(
    await vehicleOperator(f.store.context(f.graph), vehicleId),
  ).toBeUndefined();

  f.calls.mockImplementation(async (id) => answer(id, sure));
  await expect(claim(2, { oppose: true })).resolves.toMatchObject({
    state: "accepted",
    operatorId: incumbent,
  });
  const approval = randomUUID();
  await claim(0, { requestId: approval });
  await expect(
    f.send(1, { command: "receive", applicationId: approval, accept: true }),
  ).resolves.toMatchObject({
    application: {
      code: "VEHICLE_OPPOSITION_REQUIRED",
      applicationId: approval,
    },
  });
  expect(opposeCalls()).toHaveLength(1);
  await expect(
    claim(0, { oppose: true, applicationId: declined }),
  ).rejects.toMatchObject({ code: "VEHICLE_APPROVAL_INVALID" });
  await expect(
    claim(0, { oppose: true, applicationId: approval }),
  ).resolves.toMatchObject({
    state: "accepted",
    operatorId: actor,
    previousOperatorId: incumbent,
    outcome: {
      success: true,
      contests: [expect.objectContaining({ opponentId: incumbent })],
    },
  });
  expect(opposeCalls()).toHaveLength(2);
});

test("乗り物の性質を持つプレイヤーは自分で移動し、操縦の申請を本人が受領する", async () => {
  const f = await fixture();
  const [vehicleId, rider, third] = f.actors as [string, string, string];
  await vehicleFixture(f, { npcId: vehicleId });
  const at = (id: string) => directPlaces(f.store.context(f.graph), id);
  const operator = async () =>
    (await vehicleOperator(f.store.context(f.graph), vehicleId))?.actorId;
  const claim = (i: number, fields: object = {}) =>
    f.send(i, { command: "vehicle-request-control", vehicleId, ...fields });
  await f.send(1, { command: "vehicle-board", vehicleId });
  await f.send(0, locate(vehicleId, f.far));
  expect(await at(vehicleId)).toEqual([f.far]);
  expect(await at(rider)).toEqual([vehicleId]);

  await expect(claim(1)).rejects.toMatchObject({ code: "REMOTE_RECEIVING" });
  await f.send(0, { command: "contact", targetId: rider });
  for (const accept of [false, true]) {
    await giveTurn(f, 1);
    const applicationId = randomUUID();
    await expect(claim(1, { requestId: applicationId })).resolves.toMatchObject(
      { state: "receiving", applicationId },
    );
    await expect(
      f.send(0, { command: "receive", applicationId, accept }),
    ).resolves.toMatchObject({
      application: { state: accept ? "confirmed" : "rejected" },
    });
    expect(await operator()).toBe(accept ? rider : undefined);
  }
  expect(f.calls).not.toHaveBeenCalled();

  f.calls.mockImplementation(async (id) => answer(id, sure));
  await expect(claim(2, { oppose: true })).resolves.toMatchObject({
    operatorId: third,
    outcome: {
      contests: expect.arrayContaining([
        expect.objectContaining({ opponentId: vehicleId }),
        expect.objectContaining({ opponentId: rider }),
      ]),
    },
  });
});

test("人物の乗り物は車内を分けず、本人と乗客が車外の人物と同席して一緒に移る", async () => {
  const f = await fixture();
  const [vehicleId, rider, outsider] = f.actors as [string, string, string];
  await f.move(2, f.place);
  const cart = await vehicleFixture(f);
  await vehicleFixture(f, { npcId: vehicleId });
  const sessions = () =>
    Promise.all(f.actors.map(async (_, i) => (await f.status(i)).sessionId));

  await f.send(2, { command: "vehicle-board", vehicleId: cart });
  await expect(
    f.send(1, { command: "contact", targetId: outsider }),
  ).rejects.toMatchObject({ code: "CONTACT_MISMATCH" });
  await f.send(2, { command: "vehicle-leave", vehicleId: cart });

  await f.send(1, { command: "vehicle-board", vehicleId });
  await f.send(1, { command: "contact", targetId: outsider });
  await f.send(0, { command: "contact", targetId: outsider });
  const together = await sessions();
  expect(new Set(together).size).toBe(1);
  const pool = isolated.databases.postgres;
  // 検索がトランザクションを開始すると、接続プールに空きがなくなる。
  const occupied = await Promise.all(
    Array.from({ length: pool.options.max! - 1 }, () => pool.connect()),
  );
  const search = f.send(2, {
    command: "search",
    query: { kind: "surroundings" },
  });
  try {
    await expect(
      Promise.race([search, delay(10000, undefined, { ref: false })]),
    ).resolves.toMatchObject({
      material: {
        subjects: expect.arrayContaining([
          expect.objectContaining({ id: vehicleId, contactAvailable: true }),
          expect.objectContaining({ id: rider, contactAvailable: true }),
        ]),
      },
    });
  } finally {
    for (const client of occupied) client.release();
    await Promise.allSettled([search]);
  }

  await giveTurn(f, 0);
  await f.send(0, locate(vehicleId, f.far));
  const [moved, riding, staying] = await sessions();
  expect(riding).toBe(moved);
  expect(staying).not.toBe(moved);
  expect(await directPlaces(f.store.context(f.graph), rider)).toEqual([
    vehicleId,
  ]);
});

test("コンパニオン自身に乗る・降りる操作は自己参照を作らず、NPCの手番で自分の乗客を運べる", async () => {
  const f = await fixture();
  const [actor, npcId, companionId] = f.actors as [string, string, string];
  await setNpc(f, 1, "bot");
  await setNpc(f, 2, "bot");
  await f.move(2, f.place);
  await vehicleFixture(f, { npcId, route: true });
  await f.send(1, { command: "contact", targetId: actor });
  await f.send(2, { command: "contact", targetId: actor });
  await giveTurn(f, 0);
  for (const targetId of [npcId, companionId])
    await accompany(f, targetId, "一緒に移動したい");
  const at = (id: string) => directPlaces(f.store.context(f.graph), id);
  await f.send(0, { command: "vehicle-board", vehicleId: npcId });
  expect(await at(npcId)).toEqual([f.place]);
  expect(await at(companionId)).toEqual([npcId]);
  await f.send(0, { command: "companion-wait", targetId: companionId });
  await giveTurn(f, 1);
  expect((await f.status(1)).sessionId).toBe((await f.status(0)).sessionId);
  await f.send(1, locate(npcId, f.far));
  expect(await at(npcId)).toEqual([f.far]);
  expect(await at(actor)).toEqual([npcId]);
  expect(
    await vehicleOperator(f.store.context(f.graph), npcId),
  ).toBeUndefined();
  await giveTurn(f, 0);
  await f.send(0, { command: "vehicle-leave", vehicleId: npcId });
  expect(await at(companionId)).toEqual([npcId]);
  await giveTurn(f, 0);
  await f.send(0, {
    command: "companion-move",
    targetId: npcId,
    placeId: f.place,
  });
  expect(await at(npcId)).toEqual([f.place]);
  expect(await at(companionId)).toEqual([npcId]);
  expect(await at(actor)).toEqual([f.far]);
});

test("登録済みの保管先を守り、携行した乗り物は現在地で出して乗れる", async () => {
  const f = await fixture();
  const [actor, other] = f.actors as [string, string];
  const box = (
    await f.apply([
      { type: "create", label: "箱", holder: actor, basis: "手持ち" },
    ])
  ).changes.nodes[0]!;
  const vehicleId = await vehicleFixture(f, { holder: box.id });
  const context = () => f.store.context(f.graph);
  await f.send(0, locate(actor, f.far));
  await expect(
    f.send(1, { command: "vehicle-request-control", vehicleId, oppose: true }),
  ).rejects.toMatchObject({ code: "VEHICLE_NOT_HERE" });
  await expect(
    f.send(0, { command: "vehicle-request-control", vehicleId }),
  ).resolves.toMatchObject({ operatorId: actor });
  expect((await context().holding(vehicleId))?.source).toBe(box.id);
  await f.send(0, locate(actor, vehicleId));
  expect(await context().holding(vehicleId)).toBeUndefined();
  expect(await directPlaces(context(), vehicleId)).toEqual([f.far]);
  const registered = await vehicleFixture(f, { holder: f.place });
  await f.apply([
    { type: "grant", person: actor, storage: f.place, basis: "保管先" },
  ]);
  await expect(
    f.send(1, {
      command: "vehicle-request-control",
      vehicleId: registered,
      oppose: true,
    }),
  ).rejects.toMatchObject({ code: "STORAGE_NOT_REGISTERED" });
  expect((await context().holding(registered))?.source).toBe(f.place);
  expect(await vehicleOperator(context(), registered)).toBeUndefined();
  expect(f.calls).not.toHaveBeenCalled();
  expect(await directPlaces(context(), other)).toEqual([f.place]);
});

test.each(["専用コマンド", "locate"])(
  "%sで乗車と出発の両方が申請されると確定順に従う",
  async (entry) => {
    const f = await fixture();
    const [, rider] = f.actors as [string, string, string];
    const vehicleId = await vehicleFixture(f);
    await f.send(0, { command: "vehicle-request-control", vehicleId });
    await f.send(0, { command: "vehicle-board", vehicleId });
    const travel = (destinationId: string, requestId = randomUUID()) =>
      f.send(0, {
        requestId,
        ...(entry === "locate"
          ? locate(vehicleId, destinationId)
          : { command: "vehicle-travel", vehicleId, destinationId }),
      });
    const board = (requestId = randomUUID()) =>
      f.send(1, {
        requestId,
        ...(entry === "locate"
          ? locate(rider, vehicleId)
          : { command: "vehicle-board", vehicleId }),
      });
    const race = async (
      first: (requestId: ReturnType<typeof randomUUID>) => Promise<unknown>,
      second: () => Promise<unknown>,
    ) => {
      const firstId = randomUUID();
      let enter!: () => void;
      let resume!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const paused = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const commit = f.store.commit.bind(f.store);
      const hook = vi
        .spyOn(f.store, "commit")
        .mockImplementation(async (...args) => {
          if (args[2].commitId === firstId) {
            enter();
            await paused;
          }
          return commit(...args);
        });
      const pending = first(firstId);
      try {
        await Promise.race([entered, pending]);
        const after = second();
        resume();
        return await Promise.allSettled([pending, after]);
      } finally {
        resume();
        hook.mockRestore();
      }
    };
    expect(
      (await race(board, () => travel(f.far))).map((r) => r.status),
    ).toEqual(["fulfilled", "fulfilled"]);
    await expect(
      f.send(1, { command: "search", query: { kind: "self" } }),
    ).resolves.toMatchObject({
      material: { ride: { vehicleId, outerPlaceId: f.far } },
    });
    await travel(f.place);
    await f.send(1, { command: "vehicle-leave", vehicleId });
    const [departure, boarding] = await race((id) => travel(f.far, id), board);
    expect(departure).toMatchObject({ status: "fulfilled" });
    expect(boarding).toMatchObject({
      status: "rejected",
      reason: { code: "VEHICLE_NOT_HERE" },
    });
    expect(await directPlaces(f.store.context(f.graph), rider)).toEqual([
      f.place,
    ]);
  },
);

test("別セッションの二人が同じ乗り物を並行して申請しても専用の操縦者は一人だけ", async () => {
  const f = await fixture();
  const vehicleId = await vehicleFixture(f);
  const requests = [0, 1].map((i) =>
    f.send(i, { command: "vehicle-request-control", vehicleId }),
  );
  const settled = await Promise.allSettled(requests);
  const winner = settled.findIndex((r) => r.status === "fulfilled");
  expect(winner).toBeGreaterThanOrEqual(0);
  expect(settled[1 - winner]).toMatchObject({ status: "rejected" });
  const context = f.store.context(f.graph);
  expect(await context.marked(vehicleId, "status", "operator")).toHaveLength(1);
  expect(await vehicleOperator(context, vehicleId)).toMatchObject({
    actorId: f.actors[winner],
  });
  expect(f.calls).not.toHaveBeenCalled();
});

test("隔離試遊で配布用CLIから自動運転の乗り物に乗り、到着先で降りる", async () => {
  const f = await fixture();
  const [actor, npcId, bystander] = f.actors as [string, string, string];
  const db = isolated.databases.postgres;
  await setNpc(f, 1, "bot");
  await vehicleFixture(f, { npcId, route: true });
  const request = randomUUID();
  const context = f.store.context(f.graph);
  await f.store.commit(await f.store.claim(f.graph, request), context, {
    commitId: request,
    at: (await runtime.get(f.world)).at,
    changes: {
      nodes: [],
      edges: [],
      endEdges: [],
      revisions: [
        {
          id: npcId,
          kind: "existence",
          text: "コハク号。広場と作業場を往復する話せる乗合車。乗客が作業場へ行きたがったら、自分で運行できる。",
        },
        { id: f.far, kind: "existence", text: "作業場" },
      ],
    },
  });
  await f.move(2, f.place);
  const cart = await vehicleFixture(f);
  await f.send(2, { command: "vehicle-request-control", vehicleId: cart });
  await f.send(1, { command: "contact", targetId: actor });
  await giveTurn(f, 0);
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  const run = (...args: string[]) =>
    cli.run(join(cli.directory, "vehicle.json"), ...args, "--full-ids");
  const game = (...args: string[]) =>
    run(...args).then((value) => value.result);
  try {
    const connection = await run(
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
          connection.userCode,
          `actor:${actor}`,
        )
      ).statusCode,
    ).toBe(302);
    expect(
      await run("vehicle", "request-control", "--target", cart),
    ).toMatchObject({
      code: "VEHICLE_OPPOSITION_REQUIRED",
    });
    f.calls.mockImplementationOnce(async (id) => answer(id, sure));
    const takeover = await game(
      "vehicle",
      "request-control",
      "--target",
      cart,
      "--oppose",
    );
    expect(takeover).toMatchObject({
      state: "accepted",
      operatorId: actor,
      previousOperatorId: bystander,
    });
    const found = await game("search", "--kind", "surroundings");
    expect(found.material.vehicles.items).toContainEqual(
      expect.objectContaining({ vehicleId: npcId }),
    );
    const boarded = await game("vehicle", "board", "--target", npcId);
    expect(boarded).toMatchObject({
      state: "accepted",
      vehicleId: npcId,
      directPlaceId: npcId,
    });
    await game(
      "say",
      "--text",
      "作業場までお願いします。着いたら荷下ろしを手伝います。",
    );
    await game("end-turn");
    await auth.operations.execute(
      (await auth.person()).id,
      randomUUID(),
      {
        operation: "npcs.put",
        worldId: f.world,
        actorId: npcId,
        controller: "server",
        reason: "隔離試遊のコハク号をサーバー担当にする",
      },
      { players: access.players },
    );
    const actual = process.env.GESTALOKA_VEHICLE_TRIAL === "1";
    const model = actual
      ? new LlmClient(db, {
          ...process.env,
          LLM_BUDGET_ID: "vehicle-351-trial",
          LLM_BUDGET_USD: "1",
          LLM_MAX_OUTPUT_TOKENS: "4096",
          LLM_RESOLUTION_MAX_OUTPUT_TOKENS: "4096",
        })
      : undefined;
    await model?.ledger.setup();
    const choices: string[] = [];
    const models = new Set<string>();
    f.calls.mockImplementation(async (...args) => {
      const response = model
        ? await model.complete(...args)
        : answer(
            args[0],
            choices.length
              ? { command: "end-turn" }
              : {
                  command: "vehicle-travel",
                  vehicleId: npcId,
                  destinationId: f.far,
                },
          );
      choices.push(JSON.parse(response.content).command);
      models.add(response.model);
      return response;
    });
    for (let i = 0; i < 6 && (await f.status(0)).actorId === npcId; i++)
      await access.botPlay.tickNpcs(f.world);
    const self = await game("search", "--kind", "self");
    const outside = await directPlaces(f.store.context(f.graph), bystander);
    expect(self.material.ride).toMatchObject({
      vehicleId: npcId,
      outerPlaceId: f.far,
    });
    expect(outside).toEqual([f.place]);
    const after = await game("vehicle", "leave", "--target", npcId);
    expect(after).toMatchObject({ state: "accepted", directPlaceId: f.far });
    if (actual) {
      const path = resolve("artifacts/vehicle-351/playtest.json");
      await writeFile(
        path,
        JSON.stringify(
          {
            models: [...models],
            choices,
            takeover: takeover.state,
            rode: boarded.directPlaceId === npcId,
            arrived: self.material.ride.outerPlaceId === f.far,
            bystanderStayed: outside[0] === f.place,
            gotOff: after.directPlaceId === f.far,
          },
          null,
          2,
        ) + "\n",
      );
    }
  } finally {
    await cli.close();
    await app.close();
  }
}, 120000);

test("craftの定義から保管先を設置し、管理者不在の無償受領・指定分を保った移設・履歴を確認できる", async () => {
  const f = await fixture();
  const admin = await auth.person(),
    manager = f.actors[0]!,
    b = f.actors[1]!,
    c = f.actors[2]!;
  const definition = BlueprintDraft.parse({
    ...JSON.parse(
      await readFile("examples/blueprints/item-handoff-storage.json", "utf8"),
    ),
    authorId: manager,
  });
  const seed = await f.apply([
    {
      type: "create",
      label: "木板",
      holder: manager,
      count: 2,
      basis: "製作材料",
    },
    { type: "create", label: "組立用の木槌", holder: b, basis: "製作道具" },
    {
      type: "create",
      label: "焼き菓子",
      holder: manager,
      count: 3,
      basis: "受け渡し用",
    },
    {
      type: "create",
      label: "石材",
      holder: manager,
      count: 1,
      basis: "別の製作材料",
    },
    {
      type: "create",
      label: "布",
      holder: manager,
      count: 1,
      basis: "別の製作材料",
    },
  ]);
  const [wood, hammer, goods, stone, cloth] = seed.changes.nodes
    .filter((n) => n.kind === "existence")
    .map((n) => n.id);
  const db = isolated.databases.postgres;
  const app = await createApp(
      access,
      auth.identity,
      undefined,
      auth.operations,
    ),
    cli = await playerCli(app);
  try {
    const profiles = await Promise.all(
      f.actors.map(async (actor, i) => {
        const profile = join(cli.directory, "actor-" + i + ".json");
        const linked = await cli.run(
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
              f.people[i]!.cookie,
              linked.userCode,
              "actor:" + actor,
            )
          ).statusCode,
        ).toBe(302);
        return profile;
      }),
    );
    const play = async (i: number, input: Record<string, unknown>) => {
      const file = join(cli.directory, randomUUID() + ".json");
      await writeFile(file, JSON.stringify(input));
      const result = await cli.run(
        profiles[i],
        "play",
        "--file",
        file,
        "--full-ids",
      );
      expect(result.state, JSON.stringify(result)).not.toBe("error");
      return result.result;
    };
    const craft = async (
      template: typeof definition,
      product: string,
      items: { actor: number; id: string; count: number }[],
      legacy = false,
      beforeProvide?: (questId: string) => Promise<void>,
    ) => {
      const draft = await auth.operations.execute(
        admin.id,
        randomUUID(),
        {
          operation: "blueprints.create",
          worldId: f.world,
          reason: "隔離試遊",
          template,
        },
        { players: access.players },
      );
      const published = await auth.operations.execute(
        admin.id,
        randomUUID(),
        {
          operation: "blueprints.publish",
          worldId: f.world,
          reason: "隔離試遊",
          template: { templateId: String(draft.id) },
        },
        { players: access.players },
      );
      expect(
        (await play(0, { command: "blueprint-templates" })).templates,
      ).toContainEqual(
        expect.objectContaining({ id: published.id, mode: "craft" }),
      );
      const plan = {
        templateId: draft.id,
        placeId: f.place,
        keeperId: manager,
        description: template.instructions,
        product: { label: product },
      };
      const { quest } = await play(0, { command: "blueprint-propose", plan });
      expect(
        await play(0, { command: "blueprint-start", questId: quest.id }),
      ).toMatchObject({ quest: { phase: "craft" }, spentSp: 1 });
      if (legacy) {
        await db.query(
          "UPDATE blueprint_quest SET data=data-'storageLimitSlots' WHERE id=$1",
          [quest.id],
        );
        expect(
          await auth.operations.execute(
            admin.id,
            randomUUID(),
            {
              operation: "worlds.graph",
              worldId: f.world,
              query: { kind: "inventory", minCount: 1 },
            },
            { players: access.players },
          ),
        ).toMatchObject({ pendingLegacyStorages: 1 });
      }
      await beforeProvide?.(quest.id);
      let result;
      for (const [requirement, item] of items.entries())
        result = await play(item.actor, {
          command: "blueprint-provide",
          questId: quest.id,
          phase: "craft",
          requirement,
          itemId: item.id,
          count: item.count,
        });
      expect(result).toMatchObject({
        quest: { phase: "done", buildingId: null },
        spentSp: 0,
      });
      if (legacy)
        expect(
          await f.store.context(f.graph).node(result.quest.productId),
        ).toMatchObject({ storageLimitSlots: 175 });
      return result.quest.productId as string;
    };
    await f.store.configureInventory(f.graph, undefined, { storageSlots: 175 });
    f.calls.mockImplementationOnce(async (id, role, messages) => {
      expect(role).toBe("world-blueprint");
      expect(messages[0]?.content).toContain("標準的な家の175枠");
      return answer(id, {
        accepted: true,
        reason: "設置できる",
        storageLimitSlots: 28,
      });
    });
    const storage = await craft(definition, "広場の棚", [
      { actor: 0, id: wood!, count: 2 },
      { actor: 1, id: hammer!, count: 1 },
    ]);
    expect(await f.store.context(f.graph).node(storage)).toMatchObject({
      storageLimitSlots: 28,
    });
    const list = async (i: number) =>
      (await play(i, { command: "storage-list" })).items;
    const command = (
      command: string,
      storageId = storage,
      fields: Record<string, unknown> = {},
    ) => ({ command, storageId, ...fields });
    const offers = (actor: number, storageId = storage) =>
      play(actor, command("storage-offers", storageId)).then((x) => x.items);
    const history = (actor: number) =>
      play(actor, command("storage-history")).then((x) => x.items);
    const move = (
      actor: number,
      item: string,
      from: string | null,
      to: string,
      count?: number,
    ) =>
      f.send(actor, {
        command: "update",
        text: "品を移す",
        dependencies: [],
        operations: [
          {
            type: "move",
            item,
            from,
            to,
            basis: "受け渡し",
            ...(count ? { count } : {}),
          },
        ],
      });
    const bag = (id: string) =>
      readBelongings(f.store.context(f.graph), id).then((x) => x.items);
    expect(await list(0)).toContainEqual(
      expect.objectContaining({ id: storage, label: "広場の棚" }),
    );
    expect(await bag(b)).toContainEqual(
      expect.objectContaining({ id: hammer }),
    );
    expect(await bag(manager)).not.toContainEqual(
      expect.objectContaining({ id: wood }),
    );
    expect(await directPlaces(f.store.context(f.graph), storage)).toEqual([
      f.place,
    ]);
    expect(
      (
        await f.store
          .context(f.graph)
          .relations(storage, "status", "out", Number.MAX_SAFE_INTEGER)
      ).some((e) => e.text === "route"),
    ).toBe(false);

    await f.move(2, f.place);
    await move(0, goods!, manager, storage);
    const {
      allocationIds: [pub, priv],
    } = await play(
      0,
      command("storage-post", storage, {
        itemId: goods,
        allocations: [{ count: 2 }, { count: 1, recipientId: b }],
      }),
    );
    expect(await f.store.context(f.graph).reserved(goods!)).toBe(3);
    await expect(move(0, goods!, storage, manager, 1)).rejects.toThrow(
      "取り置き",
    );
    expect(await offers(2)).toHaveLength(1);
    expect(await offers(1)).toHaveLength(2);
    const claim = (id: string, count = 1) =>
      command("storage-claim", storage, { allocationId: id, count });
    await expect(f.send(2, claim(priv))).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    await f.move(0, f.far);
    await f.send(0, { command: "finish" });
    expect(await access.botPlay.current(f.world, manager)).toBeUndefined();
    const first = { ...claim(pub), requestId: randomUUID() };
    // SQL側の応答を失っても、グラフの確定を再利用し通知を回復できる。
    vi.spyOn(access.botPlay.applications, "notice").mockRejectedValueOnce(
      new Error("受領確定後の中断"),
    );
    await expect(f.send(2, first)).rejects.toThrow("受領確定後の中断");
    const { world_id: graph } = await runtime.get(f.world);
    expect(await f.store.receipt(graph!, first.requestId)).toBeDefined();
    await access.botPlay.blueprints.recover();
    expect(
      (
        await db.query(
          "SELECT actor_id FROM player_notice WHERE world_id=$1 AND text LIKE $2 ORDER BY actor_id",
          [f.world, "%個受け取りました（保管先 " + storage + "）"],
        )
      ).rows.map((r) => r.actor_id),
    ).toEqual([manager, c].sort());
    expect(await history(1)).toEqual([]);
    expect(await f.send(2, first)).toMatchObject({
      type: "claim",
      count: 1,
      remaining: 1,
      spentSp: 0,
    });
    expect(await f.send(2, first)).toMatchObject({ remaining: 1 });
    expect(await offers(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pub, count: 1 }),
        expect.objectContaining({ id: priv, count: 1 }),
      ]),
    );
    await expect(
      f.send(2, command("storage-relocate", storage, { placeId: f.far })),
    ).rejects.toThrow("権限");
    await f.send(0, { command: "start" });
    await f.move(0, f.place);
    for (const op of [
      { type: "move", item: storage, from: null, to: manager, basis: "運ぶ" },
      { type: "locate", subjectId: storage, text: "移動", aboutIds: [f.far] },
    ])
      await expect(
        f.send(op.type === "locate" ? 2 : 0, {
          command: "update",
          text: "移す",
          dependencies: [],
          operations: [op],
        }),
      ).rejects.toThrow("移設");
    expect(
      await play(0, command("storage-relocate", storage, { placeId: f.far })),
    ).toMatchObject({ storageId: storage, placeId: f.far, spentSp: 0 });
    expect(await directPlaces(f.store.context(f.graph), storage)).toEqual([
      f.far,
    ]);
    expect(await list(2)).not.toContainEqual(
      expect.objectContaining({ id: storage }),
    );
    await expect(f.send(2, claim(pub))).rejects.toThrow("設置場所");
    await f.move(2, f.far);
    await f.move(1, f.far);
    expect(await list(1)).toContainEqual(
      expect.objectContaining({ id: storage }),
    );
    expect(await bag(storage)).toContainEqual(
      expect.objectContaining({ id: goods, count: 2 }),
    );
    expect(await offers(2)).toEqual([
      expect.objectContaining({ id: pub, count: 1 }),
    ]);
    const simultaneous = await Promise.allSettled([
      f.send(2, claim(pub)),
      f.send(1, claim(pub)),
    ]);
    expect(simultaneous.filter((r) => r.status === "fulfilled")).toHaveLength(
      1,
    );
    await play(1, claim(priv));
    expect(await bag(storage)).toEqual([]);
    expect(await f.store.context(f.graph).reserved(goods!)).toBe(0);
    const journal = await history(0);
    expect(journal).toHaveLength(3);
    expect(journal).toContainEqual(
      expect.objectContaining({
        commitId: first.requestId,
        sender: manager,
        receiver: c,
        count: 1,
        at: expect.any(String),
      }),
    );
    expect(
      (await history(2)).every((r: { receiver: string }) => r.receiver === c),
    ).toBe(true);
    expect(await history(2)).not.toContainEqual(
      expect.objectContaining({ receiver: b }),
    );
    const notice = await db.query(
      "SELECT count(*)::int AS n FROM player_notice WHERE world_id=$1 AND text LIKE $2",
      [f.world, "%個受け取りました（保管先 " + storage + "）"],
    );
    expect(notice.rows[0].n).toBe(6);

    await f.move(0, f.far);
    await f.send(0, {
      command: "update",
      text: "空の保管先を戻す",
      dependencies: [],
      operations: [
        {
          type: "locate",
          subjectId: storage,
          text: "広場へ戻す",
          aboutIds: [f.place],
        },
      ],
    });
    expect(await list(1)).not.toContainEqual(
      expect.objectContaining({ id: storage }),
    );
    await f.move(0, f.place);
    expect(await list(0)).toContainEqual(
      expect.objectContaining({ id: storage }),
    );

    await f.move(1, f.place);
    const other = await craft(
      {
        ...definition,
        name: "石の受領台",
        materials: [{ label: "石材", count: 1, usage: "consume" }],
        installation: { relocatable: false, pickup: ["public", "addressed"] },
      },
      "試験用の受領台",
      [{ actor: 0, id: stone!, count: 1 }],
      true,
    );
    await expect(
      f.send(0, command("storage-relocate", other, { placeId: f.far })),
    ).rejects.toThrow("権限");
    const supply = await f.apply([
      {
        type: "create",
        holder: manager,
        label: "乾物",
        count: 3,
        basis: "別の掲示",
      },
    ]);
    const dry = supply.changes.nodes.find((n) => n.kind === "existence")!.id;
    await move(0, dry, manager, other);
    const posted = await play(
      0,
      command("storage-post", other, {
        itemId: dry,
        allocations: [{ count: 1, recipientId: b }, { count: 2 }],
      }),
    );
    await f.move(2, f.place);
    expect(await offers(2, other)).toHaveLength(1);
    await expect(
      f.send(
        2,
        command("storage-claim", other, {
          allocationId: posted.allocationIds[0],
          count: 1,
        }),
      ),
    ).rejects.toThrow("受け渡し枠");
    await play(
      1,
      command("storage-claim", other, {
        allocationId: posted.allocationIds[0],
        count: 1,
      }),
    );
    await play(
      2,
      command("storage-claim", other, {
        allocationId: posted.allocationIds[1],
        count: 1,
      }),
    );
    await play(
      0,
      command("storage-withdraw", other, {
        allocationId: posted.allocationIds[1],
      }),
    );
    await move(0, dry, other, manager, 1);
    const { installation: unused, ...base } = definition;
    expect(unused).toBeDefined();
    const plain = await craft(
      {
        ...base,
        name: "布の製作",
        materials: [{ label: "布", count: 1, usage: "consume" }],
      },
      "布製の袋",
      [{ actor: 0, id: cloth!, count: 1 }],
      false,
      async (questId) => {
        const ctx = () => f.store.context(f.graph);
        const remaining = 30 - (await ctx().inventorySlots(manager));
        const filler = await f.apply([
          { type: "update", id: cloth!, count: 2 },
          {
            type: "create",
            holder: manager,
            label: "道具",
            count: remaining * 30,
            basis: "手持ちを埋める",
          },
        ]);
        await f.store.configureInventory(f.graph, true);
        await expect(
          f.send(0, {
            command: "blueprint-provide",
            questId,
            phase: "craft",
            requirement: 0,
            itemId: cloth!,
            count: 1,
          }),
        ).rejects.toMatchObject({ code: "INVENTORY_CAPACITY_EXCEEDED" });
        expect(await ctx().node(cloth!)).toMatchObject({ count: 2 });
        await f.apply([
          {
            type: "remove",
            id: filler.changes.nodes.find((n) => n.kind === "existence")!.id,
          },
        ]);
      },
    );
    expect(await bag(manager)).toContainEqual(
      expect.objectContaining({ id: plain, label: "布製の袋" }),
    );
    expect(await list(0)).not.toContainEqual(
      expect.objectContaining({ id: plain }),
    );
    expect(f.calls.mock.calls.map((args) => args[1])).toEqual([
      "world-blueprint",
      "world-blueprint",
      "world-blueprint",
    ]);
  } finally {
    await cli.close();
    await app.close();
  }
}, 120000);

test("固定場所は店主でも動かせず、人物の入退店と店の品の出し入れは確定する", async () => {
  const f = await fixture();
  const owner = f.actors[0]!,
    shop = randomUUID(),
    chair = randomUUID(),
    tree = randomUUID();
  const changes: Change = {
    nodes: [
      { id: chair, kind: "existence", text: "椅子" },
      { id: tree, kind: "existence", text: "鉢植え" },
    ],
    edges: [],
    revisions: [],
    endEdges: [],
  };
  addRoute(
    changes,
    randomUUID(),
    0,
    { id: f.place, text: "広場" },
    { id: shop, text: "試験店舗" },
    "広場から店舗に入れる",
  );
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    { commitId: randomUUID(), at: 0, changes },
  );
  await f.apply([
    { type: "grant", person: owner, storage: shop, basis: "店主" },
    { type: "locate", subjectId: shop, text: "広場の中", aboutIds: [f.place] },
    {
      type: "grant",
      person: owner,
      storage: f.far,
      basis: "経路のない家の管理者",
    },
    { type: "move", item: chair, from: null, to: owner, basis: "手持ち" },
    { type: "move", item: tree, from: null, to: owner, basis: "手持ち" },
  ]);
  await f.move(2, tree);
  const decisions = { fixed: [f.far], movable: [tree] };
  const preview = await f.store.protectExistingPlaces(
    f.graph,
    f.actors,
    decisions,
  );
  expect(preview).toMatchObject({
    automatic: 2,
    reviewedFixed: 1,
    reviewedMovable: 1,
    added: 3,
    applied: false,
  });
  const ctx = () => f.store.context(f.graph);
  await ctx().assertMovable(shop);
  const old = ctx();
  await old.assertMovable(f.far);
  const before = await Promise.all([
    directPlaces(ctx(), shop),
    ctx().relations(shop, "has", "in", Number.MAX_SAFE_INTEGER),
    ctx().relations(shop, "status", "out", Number.MAX_SAFE_INTEGER),
  ]);
  await f.store.protectExistingPlaces(f.graph, f.actors, decisions, true);
  expect(
    (await f.store.protectExistingPlaces(f.graph, f.actors, decisions, true))
      .added,
  ).toBe(0);
  await expect(old.validate()).rejects.toThrow();
  const locate = (subjectId: string, to: string) => ({
    type: "locate",
    subjectId,
    aboutIds: [to],
    text: "移動",
  });
  const move = (item: string, from: string | null, to: string) => ({
    type: "move",
    item,
    from,
    to,
    basis: "移動",
  });
  const update = (operations: unknown[]) =>
    f.send(0, {
      command: "update",
      text: "所在地と品の確認",
      dependencies: [],
      operations,
    });
  for (const id of [shop, f.far]) {
    await expect(update([locate(id, f.place)])).rejects.toMatchObject({
      code: "FIXED_PLACE",
    });
    await expect(update([move(id, null, owner)])).rejects.toMatchObject({
      code: "FIXED_PLACE",
    });
  }
  await expect(
    update([locate(owner, shop), move(shop, null, owner)]),
  ).rejects.toMatchObject({ code: "FIXED_PLACE" });
  await expect(
    f.send(0, {
      command: "oppose",
      text: "店舗を押す",
      dependencies: [],
      operations: [locate(shop, f.far)],
    }),
  ).rejects.toMatchObject({ code: "FIXED_PLACE" });
  const [location] = (await ctx().locations(shop)).active;
  const raw = {
    nodes: [],
    revisions: [],
    endEdges: [],
    edges: [
      {
        id: randomUUID(),
        kind: "status",
        role: "about",
        source: location!.target,
        target: f.far,
        text: "direct-place",
        period: { from: 0 },
      },
    ],
  };
  await expect(
    f.send(0, {
      command: "update",
      text: "所在の参照を変える",
      changes: raw,
      dependencies: [],
    }),
  ).rejects.toMatchObject({ code: "FIXED_PLACE" });
  // 保存済みの差分でも確定時の検査が動く。
  await expect(
    f.store.commit(await f.store.claim(f.graph, randomUUID()), ctx(), {
      commitId: randomUUID(),
      at: 0,
      changes: raw,
      playerAction: true,
    }),
  ).rejects.toThrow("固定場所");
  expect(f.calls).not.toHaveBeenCalled();
  expect(await directPlaces(ctx(), owner)).toEqual([f.place]);
  expect(
    await Promise.all([
      directPlaces(ctx(), shop),
      ctx().relations(shop, "has", "in", Number.MAX_SAFE_INTEGER),
      ctx().relations(shop, "status", "out", Number.MAX_SAFE_INTEGER),
    ]),
  ).toEqual(before);
  await update([locate(owner, shop)]);
  expect(await directPlaces(ctx(), owner)).toEqual([shop]);
  await update([move(chair, owner, shop)]);
  expect((await readBelongings(ctx(), shop)).items.map((i) => i.id)).toContain(
    chair,
  );
  await update([move(chair, shop, owner), move(tree, owner, shop)]);
  expect((await readBelongings(ctx(), owner)).items.map((i) => i.id)).toContain(
    chair,
  );
  expect((await readBelongings(ctx(), shop)).items.map((i) => i.id)).toContain(
    tree,
  );
  await update([locate(owner, f.place)]);
  expect(await directPlaces(ctx(), owner)).toEqual([f.place]);
});

test("受領待ちの物が固定場所と確認された場合、同意後も移動させない", async () => {
  const f = await fixture();
  const item = (
    await f.apply([
      {
        type: "create",
        label: "登録待ちの施設",
        holder: f.actors[0],
        basis: "試験",
      },
    ])
  ).changes.nodes.find((n) => n.kind === "existence")!.id;
  const request = await f.send(0, {
    command: "update",
    text: "受け渡しを申請",
    deferredUntil: new Date(Date.now() + 60000).toISOString(),
    dependencies: [],
    operations: [
      { type: "move", item, from: f.actors[0], to: f.actors[1], basis: "試験" },
    ],
  });
  expect(request.state).toBe("pending");
  await f.store.protectExistingPlaces(
    f.graph,
    f.actors,
    { fixed: [item], movable: [] },
    true,
  );
  expect(
    await f.send(1, {
      command: "receive",
      applicationId: request.applicationId,
      accept: true,
    }),
  ).toMatchObject({ state: "changed" });
  expect(
    (await readBelongings(f.store.context(f.graph), f.actors[0]!)).items.map(
      (i) => i.id,
    ),
  ).toContain(item);
});

test("同じセッションの受領は申請者が検索で見た周囲の変化では止まらず、渡す物が変わっていれば却下として決着する", async () => {
  const f = await fixture();
  const holding = async (i: number) =>
    (await readBelongings(f.store.context(f.graph), f.actors[i]!)).items.map(
      (item) => item.id,
    );
  const create = async (label: string, holder: number) =>
    (
      await f.apply([
        { type: "create", label, holder: f.actors[holder], basis: "試験" },
      ])
    ).changes.nodes.find((n) => n.kind === "existence")!.id;
  const give = async (item: string) =>
    f.send(0, {
      command: "update",
      text: "受け渡しを申請",
      dependencies: (
        await f.send(0, { command: "search", query: { kind: "surroundings" } })
      ).dependencies,
      operations: [
        {
          type: "move",
          item,
          from: f.actors[0],
          to: f.actors[1],
          basis: "試験",
        },
      ],
    });
  const approve = (applicationId: unknown) =>
    f.send(1, { command: "receive", applicationId, accept: true });
  const first = await create("部品の束", 0),
    second = await create("工具", 0);
  await f.send(1, { command: "contact", targetId: f.actors[0] });

  const sent = await give(first);
  expect(sent).toMatchObject({ state: "receiving" });
  await f.move(2, f.place);
  await create("別の物", 1);
  expect(await approve(sent.applicationId)).toMatchObject({
    application: { state: "confirmed" },
  });
  expect(await holding(1)).toContain(first);

  const stale = await give(second);
  expect(stale).toMatchObject({ state: "receiving" });
  await f.apply([
    {
      type: "move",
      item: second,
      from: f.actors[0],
      to: f.actors[2],
      basis: "試験",
    },
  ]);
  expect(await approve(stale.applicationId)).toMatchObject({
    application: {
      applicationId: stale.applicationId,
      state: "rejected",
      code: "WORLD_CHANGED",
      message: "申請時の前提が変わりました。対象を確認して申請し直してください",
    },
  });
  expect((await f.status(1)).receiving).toBeNull();
  expect(
    (
      await access.waiting(
        f.people[0]!.id,
        f.world,
        f.actors[0],
        undefined,
        undefined,
        true,
        true,
      )
    ).context,
  ).toMatchObject({
    receiptResult: {
      applicationId: stale.applicationId,
      code: "WORLD_CHANGED",
    },
  });
  expect(await holding(1)).not.toContain(second);
});

test("同席受領の確定では、申請時に許可した追加の内容を照合する", async () => {
  const f = await fixture();
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const { applicationId, memoId } = await f.send(0, {
    command: "memo",
    text: "夕方に渡し場を見に行く",
    participants: [f.actors[1]],
    dependencies: [],
  });
  const edited = await isolated.databases.postgres.query(
    `UPDATE bot_session SET data=jsonb_set(data,'{receiving,changes,nodes,0,text}',to_jsonb($2::text),false)
     WHERE data#>>'{receiving,id}'=$1 AND data#>>'{receiving,changes,nodes,0,id}'=$3
       AND data->'receiving'?'directScope'`,
    [applicationId, "承認を求めていない本文", memoId],
  );
  expect(edited.rowCount).toBe(1);
  expect(
    await f.send(1, { command: "receive", applicationId, accept: true }),
  ).toMatchObject({
    application: { state: "rejected", code: "WORLD_CHANGED" },
  });
  expect(await f.store.context(f.graph).node(memoId as string)).toBeUndefined();
});

test("設計図の着工だけがGMとSPを使い、建築・開店・不在時の購入を一度ずつ確定する", async () => {
  const f = await fixture();
  const admin = await auth.person();
  const db = isolated.databases.postgres;
  const publish = (mode: "build" | "open" | "build-and-open") =>
    auth.operations.execute(
      admin.id,
      randomUUID(),
      {
        operation: "blueprints.publish",
        worldId: f.world,
        template: {
          mode,
          name: "水辺の店",
          version: 1,
          authorId: f.actors[0]!,
        },
        reason: "隔離世界でテンプレートを試す",
      },
      { players: access.players },
    );
  const materials = [
    { label: "板", count: 2, usage: "consume" as const },
    { label: "金槌", count: 1, usage: "tool" as const },
  ];
  const template = await auth.operations.execute(
    admin.id,
    randomUUID(),
    {
      operation: "blueprints.create",
      worldId: f.world,
      reason: "試遊用の下書き",
      template: {
        mode: "build-and-open",
        name: "水辺の店",
        version: 1,
        authorId: f.actors[0]!,
        instructions: "板と金槌を揃えて、桟橋の売店を建てる。",
        materials,
        testerIds: [f.actors[1]!],
      },
    },
    { players: access.players },
  );
  const publishedList = (actor: number) =>
    f.send(actor, { command: "blueprint-templates" });
  expect((await publishedList(0)).templates).not.toContainEqual(
    expect.objectContaining({ id: template.id }),
  );
  const openTemplate = await publish("open");
  const buildTemplate = await publish("build");
  const boards = [randomUUID(), randomUUID()];
  const tools = [randomUUID(), randomUUID()];
  const stock = randomUUID();
  const payment = randomUUID();
  const series = randomUUID();
  const seed = [
    ...boards.map((id, i) => ({ id, text: "板", count: 2, actor: i })),
    ...tools.map((id, i) => ({ id, text: "金槌", count: 1, actor: i })),
    { id: stock, text: "焼き菓子", count: 2, actor: 1 },
    { id: payment, text: "銅貨", count: 4, actor: 2, seriesId: series },
  ];
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      management: {
        editorId: admin.id,
        reason: "試遊用の手持ち品",
        requestHash: "0".repeat(64),
      },
      changes: {
        nodes: seed.map((item) => ({
          id: item.id,
          text: item.text,
          count: item.count,
          ...("seriesId" in item ? { seriesId: item.seriesId } : {}),
          kind: "existence",
        })),
        edges: seed.map(({ actor, id }) => ({
          id: randomUUID(),
          kind: "has",
          source: f.actors[actor],
          target: id,
          period: { from: 0 },
        })),
        revisions: [],
        endEdges: [],
      },
    },
  );
  const authorNotices = await db.query(
    "SELECT id FROM player_notice WHERE world_id=$1 AND actor_id=$2 AND text LIKE '%原案者%'",
    [f.world, f.actors[0]],
  );
  expect(authorNotices.rowCount).toBe(1);
  const building = {
    label: "桟橋の菓子店",
  };
  const shop = {
    stock: [
      {
        itemId: stock,
        stockCount: 2,
        count: 1,
        paymentSeriesId: series,
        paymentCount: 2,
        paymentLabel: "銅貨",
        text: "銅貨二枚で菓子一つ",
      },
    ],
  };
  const plan = {
    templateId: template.id,
    placeId: f.place,
    keeperId: f.actors[1],
    description: "桟橋に小さな店を組み、焼き菓子を売る",
    building,
    shop,
  };
  await expect(
    f.send(2, { command: "blueprint-propose", plan }),
  ).rejects.toThrow("利用できるテンプレート");
  await expect(
    f.send(1, { command: "blueprint-propose", plan }),
  ).resolves.toMatchObject({ quest: { requirements: { build: materials } } });
  await expect(
    f.send(0, {
      command: "blueprint-propose",
      plan: { ...plan, building: { ...building, materials: [materials[0]] } },
    }),
  ).rejects.toThrow("建築の材料をテンプレートで確認");
  const questId = randomUUID();
  await expect(
    f.send(0, { requestId: questId, command: "blueprint-propose", plan }),
  ).resolves.toMatchObject({ spentSp: 0, quest: { phase: "draft" } });
  await expect(
    f.send(0, { command: "blueprint-start", questId }),
  ).rejects.toMatchObject({
    code: "BLUEPRINT_UNAVAILABLE",
  });
  expect(f.calls).not.toHaveBeenCalled();
  await expect(
    f.send(1, { command: "blueprint-show", questId }),
  ).resolves.toMatchObject({ next: "blueprint-consent" });
  await f.send(1, { command: "blueprint-consent", questId });
  const start = {
    requestId: randomUUID(),
    command: "blueprint-start",
    questId,
  };
  const adopted = await f.send(0, start);
  expect(adopted).toMatchObject({
    spentSp: 1,
    dailySp: { remaining: 99 },
    quest: { phase: "build" },
    requirements: [{ provided: 0 }, { provided: 0 }],
  });
  expect(await f.send(0, start)).toMatchObject({
    spentSp: 1,
    dailySp: { remaining: 99 },
  });
  const call = await db.query(
    "SELECT charged_nano::int AS nanos FROM llm_call WHERE operation_id=$1 AND state='complete'",
    [start.requestId],
  );
  expect(call.rowCount).toBe(1);
  expect(call.rows[0]!.nanos).toBeGreaterThan(0);
  expect(f.calls.mock.calls.map((args) => args[1])).toEqual([
    "world-blueprint",
  ]);

  const provide = (
    actor: number,
    requirement: number,
    itemId: string,
    count = 1,
    requestId = randomUUID(),
  ) =>
    f.send(actor, {
      command: "blueprint-provide",
      questId,
      phase: itemId === stock ? "open" : "build",
      requirement,
      itemId,
      count,
      requestId,
    });
  const held = async (id: string) =>
    (
      await f.store
        .context(f.graph)
        .relations(id, "has", "in", Number.MAX_SAFE_INTEGER)
    ).find((edge) => !edge.role)?.source;
  const item = (id: string) => f.store.context(f.graph).node(id);
  const first = randomUUID();
  expect(await provide(0, 0, boards[0]!, 1, first)).toMatchObject({
    spentSp: 0,
    requirements: [{ provided: 1 }, { provided: 0 }],
  });
  await expect(
    f.apply([{ type: "remove", id: boards[0]!, count: 2 }]),
  ).rejects.toThrow("取り置き");
  await f.send(0, {
    command: "blueprint-withdraw",
    questId,
    contributionId: first,
  });
  await f.apply([{ type: "remove", id: boards[0]!, count: 1 }]);
  await provide(0, 0, boards[0]!);
  await provide(1, 0, boards[1]!);
  const ready = await f.send(1, { command: "blueprint-list" });
  expect(ready).toMatchObject({
    quests: [{ requirements: [{ provided: 2 }, { provided: 0 }] }],
  });
  const originalCommit = f.store.commit.bind(f.store);
  const buildCommit = derivedId(`blueprint:${questId}:build`);
  const interrupted = vi
    .spyOn(f.store, "commit")
    .mockImplementationOnce(async (...args) => {
      await originalCommit(...args);
      expect(args[2].commitId).toBe(buildCommit);
      throw new Error("グラフ確定後に応答を中断");
    });
  const last = randomUUID();
  await expect(provide(1, 1, tools[1]!, 1, last)).rejects.toThrow(
    "グラフ確定後",
  );
  interrupted.mockRestore();
  const finished = await Promise.allSettled([
    provide(1, 1, tools[1]!, 1, last),
    provide(0, 1, tools[0]!),
  ]);
  expect(finished[0]).toMatchObject({
    status: "fulfilled",
    value: { spentSp: 0, quest: { phase: "open" } },
  });
  expect(finished[1]).toMatchObject({ status: "rejected" });
  const shopId = derivedId(`blueprint:${questId}:building`);
  await expect(f.store.context(f.graph).assertMovable(shopId)).rejects.toThrow(
    "固定場所",
  );
  expect(await held(boards[0]!)).toBeUndefined();
  expect(await item(boards[1]!)).toMatchObject({ count: 1 });
  expect(await held(tools[1]!)).toBe(f.actors[1]);
  expect(
    await f.store
      .context(f.graph)
      .relations(shopId, "has", "in", Number.MAX_SAFE_INTEGER),
  ).toContainEqual(
    expect.objectContaining({ role: "use", source: f.actors[1] }),
  );

  const go = (actor: number, placeId: string, text: string) =>
    f.send(actor, {
      command: "update",
      text,
      operations: [
        {
          type: "locate",
          subjectId: f.actors[actor],
          text,
          aboutIds: [placeId],
        },
      ],
      dependencies: [],
    });
  await f.move(2, f.place);
  const roadside = await f.send(2, {
    command: "search",
    query: { kind: "surroundings" },
  });
  expect(JSON.stringify(roadside)).toContain(shopId);
  await go(2, shopId, building.label);
  expect(await f.send(2, { command: "blueprint-list" })).toMatchObject({
    quests: [{ quest: { phase: "open", buildingId: shopId } }],
  });
  await go(1, shopId, building.label);
  await f.send(1, {
    command: "update",
    text: "完成した店に金槌を置く",
    dependencies: [],
    operations: [
      {
        type: "move",
        item: tools[1],
        from: f.actors[1],
        to: shopId,
        basis: "完成した店を保管先として使う",
      },
    ],
  });
  expect(await held(tools[1]!)).toBe(shopId);
  await f.send(1, { command: "finish" });
  await expect(provide(1, 0, stock, 2)).resolves.toMatchObject({
    spentSp: 0,
    quest: { phase: "done" },
  });
  const view = await f.send(2, {
    command: "search",
    query: { kind: "surroundings" },
  });
  const [offer] = view.exchangeOffers as { id: string }[];
  const buying = {
    command: "exchange",
    requestId: randomUUID(),
    offerId: offer!.id,
    paymentItemId: payment,
  };
  expect(await f.send(2, buying)).toMatchObject({ state: "accepted" });
  expect(await f.send(2, buying)).toMatchObject({ state: "accepted" });
  expect(await item(stock)).toMatchObject({ count: 1 });
  expect(await item(payment)).toMatchObject({ count: 2 });
  const goods = await readBelongings(
    f.store.context(f.graph),
    f.actors[2]!,
    Number.MAX_SAFE_INTEGER,
  );
  expect(JSON.stringify(goods)).toContain("焼き菓子");
  const holdings = await f.store
    .context(f.graph)
    .relations(shopId, "has", "out", Number.MAX_SAFE_INTEGER);
  expect(
    await Promise.all(
      holdings.filter((edge) => !edge.role).map(({ target }) => item(target)),
    ),
  ).toContainEqual(expect.objectContaining({ count: 2, seriesId: series }));
  const notices = await db.query(
    "SELECT actor_id,text FROM player_notice WHERE world_id=$1 AND text LIKE $2",
    [f.world, `%${shopId}%`],
  );
  expect(
    notices.rows.filter((row) => row.text.includes("建築が完了")),
  ).toHaveLength(2);
  expect(
    notices.rows.filter((row) => row.text.includes("店が開店")),
  ).toHaveLength(2);
  expect(f.calls.mock.calls.map((args) => args[1])).toEqual([
    "world-blueprint",
  ]);

  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  try {
    await auth.operations.execute(
      admin.id,
      randomUUID(),
      {
        operation: "blueprints.publish",
        worldId: f.world,
        reason: "試遊した版を公開",
        template: { templateId: String(template.id) },
      },
      { players: access.players },
    );
    expect((await publishedList(2)).templates).toContainEqual(
      expect.objectContaining({ id: template.id, materials }),
    );
    const profile = join(cli.directory, "second-keeper.json");
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
          f.people[2]!.cookie,
          connected.userCode,
          `actor:${f.actors[2]}`,
        )
      ).statusCode,
    ).toBe(302);
    const file = join(cli.directory, "blueprint.json");
    const play = async (body: object) => {
      await writeFile(file, JSON.stringify(body), "utf8");
      const response = await cli.run(
        profile,
        "play",
        "--file",
        file,
        "--full-ids",
      );
      expect(response.state).not.toBe("error");
      return response.result;
    };
    const templates = await play({ command: "blueprint-templates" });
    const build = templates.templates.find(
      (entry: { mode: string }) => entry.mode === "build",
    );
    expect(build.id).toBe(buildTemplate.id);
    await go(2, f.place, "広場");
    const second = await play({
      command: "blueprint-propose",
      plan: {
        templateId: build.id,
        placeId: f.place,
        keeperId: f.actors[2],
        description: "広場に銅貨を飾った小屋を建てる",
        building: {
          label: "広場の小屋",
          materials: [{ label: "銅貨", count: 1, usage: "consume" }],
        },
      },
    });
    expect(second.next).toBe("blueprint-start");
    const secondStart = await play({
      command: second.next,
      questId: second.quest.id,
    });
    const next = secondStart.requirements[0];
    expect(next).toMatchObject({ label: "銅貨", count: 1, provided: 0 });
    expect(
      await play({
        command: "blueprint-show",
        questId: second.quest.id,
        provision: { requirement: next.index, itemId: payment },
      }),
    ).toMatchObject({
      next: "blueprint-provide",
      actions: {
        "blueprint-provide": { allowed: true, requirements: [{ maxCount: 1 }] },
      },
    });
    const built = await play({
      command: secondStart.next,
      questId: second.quest.id,
      phase: secondStart.quest.phase,
      requirement: next.index,
      itemId: payment,
      count: 1,
    });
    expect(built.quest).toMatchObject({
      phase: "done",
      template: { authorId: f.actors[0], origin: f.world },
      contributors: [f.actors[2]],
    });
    await go(2, built.quest.buildingId, "広場の小屋");
    const before = await item(stock);
    const existing = await play({
      command: "blueprint-propose",
      plan: {
        templateId: openTemplate.id,
        placeId: built.quest.buildingId,
        keeperId: f.actors[2],
        description: "手元の銅貨を一枚置き、二枚との交換を掲示する",
        shop: { stock: [{ ...shop.stock[0], itemId: payment, stockCount: 1 }] },
      },
    });
    const open = await play({
      command: existing.next,
      questId: existing.quest.id,
    });
    const opened = await play({
      command: open.next,
      questId: existing.quest.id,
      phase: open.quest.phase,
      requirement: 0,
      itemId: payment,
      count: 1,
    });
    expect(opened.quest).toMatchObject({
      phase: "done",
      buildingId: built.quest.buildingId,
    });
    expect(await item(stock)).toEqual(before);
  } finally {
    await cli.close();
    await app.close();
  }
}, 60000);

test("クエスト照会で本人の操作可否と、取り置きを引いた提供可能数が分かる", async () => {
  const f = await fixture();
  const admin = await auth.person();
  const keeper = f.actors[1]!;
  const db = isolated.databases.postgres;
  const publish = (mode: "build" | "open") =>
    auth.operations.execute(
      admin.id,
      randomUUID(),
      {
        operation: "blueprints.publish",
        worldId: f.world,
        reason: "隔離環境で試験する",
        template: {
          mode,
          name: "茶を扱う店",
          version: 1,
          authorId: f.actors[0]!,
        },
      },
      { players: access.players },
    );
  const builder = await publish("build"),
    opener = await publish("open");
  const grant = {
    type: "grant",
    person: keeper,
    storage: f.place,
    basis: "店主の保管先",
  };
  const created = await f.apply([
    grant,
    {
      type: "create",
      label: "茶葉",
      holder: keeper,
      count: 5,
      basis: "手持ちの試験用在庫",
    },
    {
      type: "create",
      label: "茶葉",
      holder: f.place,
      count: 2,
      basis: "保管先の試験用物品",
    },
  ]);
  const [stock, stored] = created.changes.nodes
    .filter((node) => node.kind === "existence")
    .map(({ id }) => id);
  const show = (actor: number, questId: string, itemId?: string) =>
    f.send(actor, {
      command: "blueprint-show",
      questId,
      ...(itemId ? { provision: { requirement: 0, itemId } } : {}),
    });
  const provide = (questId: string, phase: "build" | "open", count: number) =>
    f.send(1, {
      command: "blueprint-provide",
      questId,
      phase,
      requirement: 0,
      itemId: stock,
      count,
    });
  const buildId = randomUUID();
  await f.send(1, {
    command: "blueprint-propose",
    requestId: buildId,
    plan: {
      templateId: builder.id,
      placeId: f.place,
      keeperId: keeper,
      description: "試験用の小屋",
      building: {
        label: "広場の試験小屋",
        materials: [{ label: "茶葉", count: 5, usage: "consume" }],
      },
    },
  });
  await f.send(1, { command: "blueprint-start", questId: buildId });
  expect(await show(1, buildId)).toMatchObject({
    next: "blueprint-provide",
    actions: {
      "blueprint-provide": {
        allowed: false,
        requirements: [{ maxCount: null, reason: { code: "ITEM_REQUIRED" } }],
      },
    },
  });
  expect(await show(1, buildId, stored!)).toMatchObject({
    actions: {
      "blueprint-provide": {
        allowed: true,
        requirements: [
          { heldBy: f.place, totalCount: 2, reservedCount: 0, maxCount: 2 },
        ],
      },
    },
  });
  const lock = await provide(buildId, "build", 2);
  expect(lock).toMatchObject({
    quest: { phase: "build" },
    requirements: [{ provided: 2 }],
  });
  const build = await show(1, buildId);
  expect(build).toMatchObject({
    actions: { "blueprint-withdraw": { allowed: true } },
  });
  const contribution = (build.contributions as { id: string }[])[0]!.id;

  const shopId = randomUUID();
  await f.send(0, {
    command: "blueprint-propose",
    requestId: shopId,
    plan: {
      templateId: opener.id,
      placeId: f.place,
      keeperId: keeper,
      description: "店で茶葉を売る",
      shop: {
        stock: [
          {
            itemId: stock,
            stockCount: 4,
            count: 1,
            paymentSeriesId: randomUUID(),
            paymentLabel: "銅貨",
            paymentCount: 2,
            text: "茶葉一つと銅貨二枚",
          },
        ],
      },
    },
  });
  expect(await show(0, shopId)).toMatchObject({
    spentSp: 0,
    actions: {
      "blueprint-start": {
        allowed: false,
        reason: { code: "CONSENT_REQUIRED" },
      },
    },
  });
  expect(await show(1, shopId)).toMatchObject({
    actions: {
      "blueprint-consent": { allowed: true },
      "blueprint-start": {
        allowed: false,
        reason: { code: "AUTHOR_REQUIRED" },
      },
    },
  });
  await f.send(1, { command: "blueprint-consent", questId: shopId });
  await f.send(0, { command: "finish" });
  expect(await show(0, shopId)).toMatchObject({
    next: "blueprint-start",
    actions: {
      "blueprint-start": { allowed: false, reason: { code: "TURN_REQUIRED" } },
    },
  });
  await f.send(0, { command: "start" });
  const user = f.people[0]!.id;
  const { resetsAt } = await access.botPlay.dailySp(f.world, user);
  await db.query(
    `INSERT INTO bot_request(id,actor_id,world_id,hash,sp_user,sp_reset)
      SELECT gen_random_uuid(),$1,$2,'blueprint-preview-sp',$3,$4 FROM generate_series(1,100)`,
    [f.actors[0], f.world, user, resetsAt],
  );
  expect(await show(0, shopId)).toMatchObject({
    dailySp: { remaining: 0 },
    actions: {
      "blueprint-start": {
        allowed: false,
        reason: { code: "DAILY_SP_EXHAUSTED" },
      },
    },
  });
  await db.query(
    "DELETE FROM bot_request WHERE world_id=$1 AND hash='blueprint-preview-sp'",
    [f.world],
  );
  expect(await show(0, shopId)).toMatchObject({
    actions: { "blueprint-start": { allowed: true } },
  });
  await f.send(0, { command: "blueprint-start", questId: shopId });

  const other = await show(0, shopId);
  expect(other).toMatchObject({
    actions: {
      "blueprint-provide": {
        allowed: false,
        requirements: [
          { maxCount: 0, reason: { code: "ITEM_ACCESS_REQUIRED" } },
        ],
      },
    },
  });
  const otherDetails = (
    other.actions as { "blueprint-provide": { requirements: object[] } }
  )["blueprint-provide"].requirements[0];
  expect(otherDetails).not.toHaveProperty("totalCount");
  expect(otherDetails).not.toHaveProperty("reservedCount");
  expect(otherDetails).not.toHaveProperty("heldBy");

  await f.move(1, f.far);
  const away = await show(1, shopId);
  expect(away).toMatchObject({
    next: "blueprint-provide",
    location: { current: { id: f.far }, contributionPlaces: [{ id: f.place }] },
    actions: {
      "blueprint-provide": {
        allowed: false,
        reason: { code: "QUEST_LOCATION_REQUIRED" },
      },
    },
  });
  await f.move(1, f.place);
  expect(await show(1, shopId)).toMatchObject({
    spentSp: 0,
    actions: {
      "blueprint-provide": {
        allowed: true,
        requirements: [
          {
            itemId: stock,
            totalCount: 5,
            reservedCount: 2,
            remaining: 4,
            maxCount: 3,
          },
        ],
      },
    },
  });
  expect(await f.store.context(f.graph).reserved(stock!)).toBe(2);
  await expect(provide(shopId, "open", 4)).rejects.toThrow(
    "3個まで提供できます",
  );
  expect(await provide(shopId, "open", 3)).toMatchObject({
    spentSp: 0,
    requirements: [{ provided: 3 }],
  });

  await f.send(1, {
    command: "blueprint-withdraw",
    questId: buildId,
    contributionId: contribution,
  });
  await f.apply([{ type: "revoke", person: keeper, storage: f.place }]);
  expect(await show(1, shopId)).toMatchObject({
    actions: {
      "blueprint-provide": {
        allowed: false,
        requirements: [
          {
            remaining: 1,
            maxCount: 0,
            reason: { code: "SHOP_STORAGE_REQUIRED" },
          },
        ],
      },
    },
  });
  await expect(provide(shopId, "open", 1)).rejects.toThrow("保管先として登録");
  await f.apply([grant]);
  expect(await show(1, shopId)).toMatchObject({
    actions: {
      "blueprint-provide": { allowed: true, requirements: [{ maxCount: 1 }] },
    },
  });
  await f.move(1, f.far);
  await expect(provide(shopId, "open", 1)).rejects.toThrow("現地へ移動");
  await f.move(1, f.place);
  expect(await provide(shopId, "open", 1)).toMatchObject({
    spentSp: 0,
    next: null,
    quest: { phase: "done", buildingId: f.place },
  });
  expect(await show(1, shopId)).toMatchObject({
    actions: {
      "blueprint-provide": { allowed: false, reason: { code: "QUEST_PHASE" } },
    },
  });
  expect(f.calls.mock.calls.map((args) => args[1])).toEqual([
    "world-blueprint",
    "world-blueprint",
  ]);
}, 60000);

test("建築後に中止すると、開店用の取り置きだけが解放される", async () => {
  const f = await fixture();
  const admin = await auth.person();
  const mode = "build-and-open";
  const { id: templateId } = await auth.operations.execute(
    admin.id,
    randomUUID(),
    {
      operation: "blueprints.publish",
      worldId: f.world,
      template: { mode, name: "工房", version: 1, authorId: f.actors[0]! },
      reason: "試遊用",
    },
    { players: access.players },
  );
  const ids = await f.apply([
    {
      type: "create",
      label: "支柱",
      holder: f.actors[0],
      count: 1,
      basis: "試遊用",
    },
    {
      type: "create",
      label: "器",
      holder: f.actors[0],
      count: 2,
      basis: "試遊用",
    },
  ]);
  const [beam, cup] = ids.changes.nodes
    .filter((node) => node.kind === "existence")
    .map(({ id }) => id);
  const shop = {
    stock: [
      {
        itemId: cup,
        stockCount: 2,
        count: 1,
        paymentSeriesId: randomUUID(),
        paymentCount: 1,
        paymentLabel: "銅貨",
        text: "銅貨一枚で器一つ",
      },
    ],
  };
  const plan = {
    templateId,
    placeId: f.place,
    keeperId: f.actors[0],
    description: "広場に器の工房を建てる",
    building: {
      label: "小さな工房",
      materials: [{ label: "支柱", count: 1, usage: "consume" }],
    },
    shop,
  };
  const failedId = randomUUID();
  await f.send(0, {
    command: "blueprint-propose",
    requestId: failedId,
    plan: { ...plan, description: "月を持って来る" },
  });
  expect(
    await f.send(0, { command: "blueprint-start", questId: failedId }),
  ).toMatchObject({
    spentSp: 1,
    quest: { phase: "rejected", reason: "月はこの材料から運べません" },
  });
  const questId = randomUUID();
  await f.send(0, { command: "blueprint-propose", requestId: questId, plan });
  expect(
    await f.send(0, { command: "blueprint-start", questId }),
  ).toMatchObject({
    spentSp: 1,
    dailySp: { remaining: 98 },
  });
  const give = (itemId: string, phase: string) =>
    f.send(0, {
      command: "blueprint-provide",
      questId,
      requirement: 0,
      itemId,
      count: 1,
      phase,
    });
  const built = await give(beam!, "build");
  expect(built).toMatchObject({ quest: { phase: "open" } });
  const building = derivedId(`blueprint:${questId}:building`);
  await give(cup!, "open");
  expect(await f.store.context(f.graph).reserved(cup!)).toBe(1);
  expect(
    await f.send(0, { command: "blueprint-cancel", questId }),
  ).toMatchObject({
    spentSp: 0,
    quest: { phase: "cancelled", buildingId: building },
  });
  const context = f.store.context(f.graph);
  expect(await context.reserved(cup!)).toBe(0);
  expect(await context.node(building)).toMatchObject({ text: "小さな工房" });
  expect(
    await context.relations(beam!, "has", "in", Number.MAX_SAFE_INTEGER),
  ).toEqual([]);
  expect(
    await context.relations(building, "has", "in", Number.MAX_SAFE_INTEGER),
  ).toContainEqual(
    expect.objectContaining({ role: "use", source: f.actors[0] }),
  );
  expect(
    (await f.send(0, { command: "search", query: { kind: "surroundings" } }))
      .exchangeOffers ?? [],
  ).toEqual([]);
  expect(f.calls.mock.calls.map((args) => args[1])).toEqual([
    "world-blueprint",
    "world-blueprint",
  ]);
});

test("生成を終えた世界のプレイの記録は、確定した現実の時刻で成立する", async () => {
  const f = await fixture();
  await isolated.databases.postgres.query(
    "UPDATE world_construction SET state='finished' WHERE id=$1",
    [f.world],
  );
  const memo = async (text: string) => {
    const before = Date.now(),
      requestId = randomUUID(),
      sent = await f.send(0, {
        command: "memo",
        requestId,
        text,
        participants: [],
        dependencies: [],
      });
    const [edge] = await f.store
      .context(f.graph)
      .relations(sent.memoId as string, "has", "in", Number.MAX_SAFE_INTEGER);
    expect(edge!.period.from).toBeGreaterThanOrEqual(before);
    expect(edge!.period.from).toBeLessThanOrEqual(Date.now());
    return edge!.period.from;
  };
  // 生成時の記録(世界内時間の0)より後ろに、確定の順に並ぶ。
  const first = await memo("渡し場の水位を見る");
  expect(await memo("水位が下がったら知らせる")).toBeGreaterThanOrEqual(first);
  expect(first).toBeGreaterThan(
    (await f.store.context(f.graph).locations(f.actors[0]!)).latest,
  );
});
test("時間差のメモは退出後も受領でき、全員の承認で一度だけ確定する", async () => {
  const f = await fixture();
  const deferredUntil = new Date(Date.now() + 60_000).toISOString();
  const requestId = randomUUID();
  const input = {
    command: "memo",
    requestId,
    text: "水位が下がったら渡し場を確認する",
    participants: f.actors.slice(1),
    deferredUntil,
    dependencies: [],
  };
  const sent = await f.send(0, input);
  const memoId = sent.memoId as string;
  expect(sent).toMatchObject({
    applicationId: requestId,
    state: "pending",
    memoIdState: "pending",
    receiving: null,
  });
  expect(await f.send(0, input)).toMatchObject({
    applicationId: requestId,
    state: "pending",
  });
  expect(await f.store.context(f.graph).node(memoId)).toBeUndefined();
  await f.send(0, { command: "finish" });
  await f.send(2, { command: "finish" });
  expect(await f.send(2, { command: "applications" })).toMatchObject({
    applications: [
      {
        id: requestId,
        senderId: f.actors[0],
        awaitingYou: true,
        preview: [input.text],
      },
    ],
  });
  expect(
    await access.notices(f.people[2]!.id, f.world, f.actors[2]),
  ).toMatchObject({
    notices: [{ unread: true, text: expect.stringContaining(input.text) }],
  });
  const accept = { command: "receive", applicationId: requestId, accept: true };
  expect(await f.send(2, accept)).toMatchObject({ state: "pending" });
  expect(await f.store.context(f.graph).node(memoId)).toBeUndefined();
  const last = { ...accept, requestId: randomUUID() };
  expect(await f.send(1, last)).toMatchObject({
    state: "accepted",
    commitId: requestId,
  });
  expect(await f.send(1, last)).toMatchObject({
    state: "accepted",
    commitId: requestId,
  });
  expect(await f.store.context(f.graph).node(memoId)).toMatchObject({
    type: "memo",
    text: input.text,
  });
  expect(
    await access.notices(f.people[0]!.id, f.world, f.actors[0]),
  ).toMatchObject({
    notices: [{ text: expect.stringContaining("申請を確定しました") }],
  });
  expect(f.calls).not.toHaveBeenCalled();
});

test("時間差の受領は申請時に許可した差分だけを確定する", async () => {
  const f = await fixture();
  const { applicationId, memoId } = await f.send(0, {
    command: "memo",
    text: "水位が下がったら渡し場を確認する",
    participants: [f.actors[1]],
    deferredUntil: new Date(Date.now() + 60_000).toISOString(),
    dependencies: [],
  });
  const changed = await isolated.databases.postgres.query(
    `UPDATE play_application SET share=jsonb_set(share,'{changes,nodes,0,text}',to_jsonb($2::text),false)
     WHERE id=$1 AND share#>>'{changes,nodes,0,id}'=$3 AND share?'directScope'`,
    [applicationId, "申請で許可されていない本文", memoId],
  );
  expect(changed.rowCount).toBe(1);
  expect(
    await f.send(1, { command: "receive", applicationId, accept: true }),
  ).toMatchObject({ state: "changed" });
  expect(await f.store.context(f.graph).node(memoId as string)).toBeUndefined();
  expect(
    await f.store.receipt(f.graph, applicationId as string),
  ).toBeUndefined();
});

test("時間差の申請は関係者にだけ届き、競合や期限切れや取り下げで確定しない", async () => {
  const f = await fixture();
  const expires = Date.now() + 60_000;
  const deferredUntil = new Date(expires).toISOString();
  const memo = (text: string) =>
    f.send(0, {
      command: "memo",
      text,
      participants: [f.actors[1]],
      deferredUntil,
      dependencies: [],
    });
  const decision = (applicationId: unknown, accept = true) => ({
    command: "receive",
    applicationId,
    accept,
  });
  const { memoId, applicationId } = await memo("共同メモ");
  expect(await f.send(2, { command: "applications" })).toMatchObject({
    applications: [],
  });
  await expect(f.send(2, decision(applicationId))).rejects.toMatchObject({
    code: "RECEIVING_TURN_REQUIRED",
  });
  await f.send(1, decision(applicationId));
  const revise = (text: string) =>
    f.send(0, {
      command: "update",
      text,
      deferredUntil,
      dependencies: [],
      changes: {
        nodes: [],
        edges: [],
        endEdges: [],
        revisions: [{ id: memoId, kind: "script", type: "memo", text }],
      },
    });
  const first = await revise("先に確定する改訂"),
    second = await revise("同じ版を読んだ改訂");
  expect(await f.send(1, decision(first.applicationId))).toMatchObject({
    state: "accepted",
  });
  expect(await f.send(1, decision(second.applicationId))).toMatchObject({
    state: "changed",
  });
  expect(await f.store.context(f.graph).node(memoId as string)).toMatchObject({
    text: "先に確定する改訂",
  });
  const declined = await memo("却下するメモ");
  expect(
    await f.send(1, decision(declined.applicationId, false)),
  ).toMatchObject({ state: "rejected" });
  const withdrawn = await memo("取り下げるメモ");
  expect(
    await f.send(0, {
      command: "withdraw",
      applicationId: withdrawn.applicationId,
    }),
  ).toMatchObject({ state: "withdrawn" });
  const expired = await memo("期限が切れるメモ");
  const later = new BotPlay(runtime, () => new Date(expires + 1));
  await later.expire(f.world);
  await later.expire(f.world);
  expect(await f.send(1, decision(expired.applicationId))).toMatchObject({
    state: "expired",
  });
  for (const pending of [declined, withdrawn, expired])
    expect(
      await f.store.context(f.graph).node(pending.memoId as string),
    ).toBeUndefined();
  const { notices } = await access.notices(
    f.people[0]!.id,
    f.world,
    f.actors[0],
  );
  expect(
    notices.filter((notice) => notice.text.includes("受領期限が過ぎました")),
  ).toHaveLength(1);
});

test("従来形式で保存した時間差の物品受け渡しも受領後に確定する", async () => {
  const f = await fixture(),
    seller = f.actors[0]!,
    buyer = f.actors[2]!;
  const item = (
    await f.apply([
      {
        type: "create",
        label: "結び紐",
        count: 3,
        holder: seller,
        basis: "試験用",
      },
    ])
  ).changes.nodes.find((n) => n.text === "結び紐")!.id;
  const { applicationId } = await f.send(0, {
    command: "update",
    text: "結び紐を一本分ける",
    deferredUntil: new Date(Date.now() + 60_000).toISOString(),
    dependencies: [],
    operations: [
      {
        type: "move",
        item,
        from: seller,
        to: buyer,
        count: 1,
        basis: "受け渡し",
      },
    ],
  });
  expect(
    (await readBelongings(f.store.context(f.graph), seller)).items,
  ).toMatchObject([{ id: item, count: 3 }]);
  await isolated.databases.postgres.query(
    "UPDATE play_application SET share=share-'handoff'-'directScope'-'handoffScope' WHERE id=$1",
    [applicationId],
  );
  expect(
    await f.send(2, { command: "receive", applicationId, accept: true }),
  ).toMatchObject({ state: "accepted" });
  expect(
    (await readBelongings(f.store.context(f.graph), seller)).items,
  ).toMatchObject([{ id: item, count: 2 }]);
  expect(
    (await readBelongings(f.store.context(f.graph), buyer)).items,
  ).toMatchObject([{ label: "結び紐", count: 1 }]);
});

async function deferredHandoffFixture() {
  const f = await fixture(),
    [sender, other, recipient] = f.actors as [string, string, string],
    label = "試験用の銀貨";
  const { changes } = await f.apply(
    [
      [sender, 1_000],
      [recipient, 150],
    ].map(([holder, count]) => ({
      type: "create",
      label,
      count,
      holder,
      basis: "試験用の持ち物",
    })),
  );
  const [source, target] = changes.nodes
    .filter((node) => node.kind === "existence")
    .map((node) => node.id) as [string, string];
  const give = (to: string, count?: number) => [
    {
      type: "move",
      item: source,
      from: sender,
      to,
      count,
      basis: "銀貨を渡す",
    },
  ];
  const request = (count?: number) =>
    f.send(0, {
      command: "update",
      text: "銀貨を渡す",
      deferredUntil: new Date(Date.now() + 60_000).toISOString(),
      dependencies: [],
      operations: give(recipient, count),
    });
  const accept = (applicationId: unknown, requestId = randomUUID()) =>
    f.send(2, { command: "receive", applicationId, accept: true, requestId });
  const read = (actor: string) =>
    readBelongings(f.store.context(f.graph), actor);
  const amounts = async () => [
    (await read(sender)).items.find((item) => item.id === source)?.count,
    (await read(recipient)).items.find((item) => item.id === target)?.count,
  ];
  return {
    ...f,
    sender,
    other,
    recipient,
    source,
    target,
    give,
    request,
    accept,
    read,
    amounts,
  };
}

test("時間差の受領は保存した受け渡しの数量を照合する", async () => {
  const f = await deferredHandoffFixture();
  const { applicationId } = await f.request(10);
  const changed = await isolated.databases.postgres.query(
    `UPDATE play_application SET share=jsonb_set(share,'{handoff,operations,0,count}','12'::jsonb,false)
     WHERE id=$1 AND share?'handoffScope'`,
    [applicationId],
  );
  expect(changed.rowCount).toBe(1);
  expect(await f.accept(applicationId)).toMatchObject({ state: "changed" });
  expect(await f.amounts()).toEqual([1_000, 150]);
  expect(
    await f.store.receipt(f.graph, applicationId as string),
  ).toBeUndefined();
});

test("別の受け渡しで元の束が減っても、残数が足りれば時間差の受領を確定する", async () => {
  const f = await deferredHandoffFixture();
  const { applicationId } = await f.request(200);
  await f.send(1, { command: "contact", targetId: f.sender });
  const other = await f.send(0, {
    command: "update",
    text: "別の相手に銀貨を渡す",
    operations: f.give(f.other, 300),
    dependencies: [],
  });
  expect(other.state).toBe("receiving");
  await f.send(1, {
    command: "receive",
    applicationId: other.applicationId,
    accept: true,
  });
  expect(await f.amounts()).toEqual([700, 150]);
  await f.send(0, { command: "finish" });

  const requestId = randomUUID();
  expect(await f.accept(applicationId, requestId)).toMatchObject({
    state: "accepted",
    commitId: applicationId,
    items: [{ itemId: f.source, count: 200 }],
  });
  expect(await f.accept(applicationId, requestId)).toMatchObject({
    state: "accepted",
    commitId: applicationId,
  });
  expect(await f.amounts()).toEqual([500, 350]);
  expect((await f.read(f.other)).items).toMatchObject([{ count: 300 }]);
  expect(f.calls).not.toHaveBeenCalled();
});

test("元の残数に戻った物品と、メモが増えた受領者を最新の状態から再計画する", async () => {
  const f = await deferredHandoffFixture();
  const { applicationId } = await f.request(200);
  const split = await f.apply([
    {
      type: "move",
      item: f.source,
      from: f.sender,
      to: f.other,
      count: 100,
      basis: "一時的に預ける",
    },
  ]);
  expect(await f.amounts()).toEqual([900, 150]);
  await f.apply([
    {
      type: "move",
      item: split.changes.nodes.find((n) => n.kind === "existence")!.id,
      from: f.other,
      to: f.sender,
      basis: "元の束へ戻す",
    },
  ]);
  const memos = [
    await f.send(2, {
      command: "memo",
      text: "最初に記すこと",
      dependencies: [],
    }),
    await f.send(2, {
      command: "memo",
      text: "もう一つ記すこと",
      dependencies: [],
    }),
  ];
  expect(await f.amounts()).toEqual([1_000, 150]);

  expect(await f.accept(applicationId)).toMatchObject({
    state: "accepted",
    commitId: applicationId,
  });
  expect(await f.amounts()).toEqual([800, 350]);
  const links = await f.store
    .context(f.graph)
    .relations(f.recipient, "has", "out", Number.MAX_SAFE_INTEGER);
  expect(links.map((edge) => edge.target)).toEqual(
    expect.arrayContaining(memos.map((memo) => memo.memoId)),
  );
});

test.each([
  {
    condition: "個数不足",
    count: 200,
    ending: "指定した個数の物品がありません",
    operation: { type: "update", count: 150 },
  },
  {
    condition: "全部渡す個数の変更",
    count: undefined,
    ending: "全部を渡す物品の個数が変わりました",
    operation: { type: "update", count: 750 },
  },
  {
    condition: "保持先の変更",
    count: 200,
    ending: "保持先が変わりました",
    operation: { type: "move" },
  },
])(
  "申請条件が変わった時間差の受け渡しは確定しない（$condition）",
  async ({ count, ending, operation }) => {
    const f = await deferredHandoffFixture();
    const { applicationId } = await f.request(count);
    if (count === undefined)
      expect(await f.send(2, { command: "applications" })).toMatchObject({
        applications: [{ preview: [expect.stringContaining("× 1000")] }],
      });
    const fields =
      operation.type === "update"
        ? { id: f.source }
        : { item: f.source, to: f.other, from: f.sender };
    await f.apply([{ ...operation, ...fields, basis: "受領前の変更" }]);
    const before = await f.amounts();
    expect(await f.accept(applicationId)).toMatchObject({
      state: "changed",
      message: expect.stringContaining(ending),
    });
    expect(await f.amounts()).toEqual(before);
    expect(
      await f.store.receipt(f.graph, applicationId as string),
    ).toBeUndefined();
  },
);

test("再計画と確定の間に残数が変わったときは読み直して一度だけ渡す", async () => {
  const f = await deferredHandoffFixture();
  const { applicationId } = await f.request(200);
  const commit = f.store.commit.bind(f.store);
  let attempts = 0;
  vi.spyOn(f.store, "commit").mockImplementation(
    async (lease, context, input, fromBelongingOperations) => {
      if (input.commitId === applicationId && ++attempts === 1)
        await f.apply([
          { type: "update", id: f.source, count: 900, basis: "確定直前の使用" },
        ]);
      return commit(lease, context, input, fromBelongingOperations);
    },
  );
  const approvals = await Promise.all([
    f.accept(applicationId),
    f.accept(applicationId),
  ]);
  expect(approvals).toMatchObject([
    { state: "accepted", commitId: applicationId },
    { state: "accepted", commitId: applicationId },
  ]);
  expect(attempts).toBe(2);
  expect(await f.amounts()).toEqual([700, 350]);
});

test("公開交換は売り手の退出中も系列を照合し、最後の在庫と支払いを一度だけ移す", async () => {
  const f = await fixture(),
    [seller, buyer, other] = f.actors as [string, string, string],
    seriesId = randomUUID();
  const seed = await f.apply([
    {
      type: "create",
      label: "売店箱",
      holder: seller,
      basis: "試験用",
    },
    {
      type: "create",
      label: "銅貨",
      count: 100000,
      holder: buyer,
      basis: "試験用",
    },
    {
      type: "create",
      label: "銅貨",
      count: 100000,
      holder: other,
      basis: "試験用",
    },
    {
      type: "create",
      label: "銅貨",
      count: 8,
      holder: buyer,
      basis: "名前だけが同じ品",
    },
  ]);
  const [storage, payment, otherPayment, fake] = seed.changes.nodes.filter(
    (n) => n.kind === "existence",
  );
  const context = f.store.context(f.graph);
  const revisions = await Promise.all(
    [payment!, otherPayment!].map(async ({ id }) => ({
      ...(await context.node(id)),
      seriesId,
      unitsPerSlot: "unlimited",
    })),
  );
  const admin = await auth.person(),
    managementRequest = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, managementRequest),
    context,
    {
      commitId: managementRequest,
      at: 0,
      changes: { nodes: [], edges: [], revisions, endEdges: [] },
      management: {
        editorId: admin.id,
        reason: "支払い品の系列を指定",
        requestHash: "a".repeat(64),
      },
    },
  );
  const stock = await f.apply([
    {
      type: "locate",
      subjectId: storage!.id,
      text: "広場",
      aboutIds: [f.place],
    },
    {
      type: "create",
      label: "焼き菓子",
      count: 1,
      holder: storage!.id,
      basis: "販売する在庫",
    },
    {
      type: "grant",
      person: seller,
      storage: storage!.id,
      basis: "売店の在庫置き場",
    },
    {
      type: "create",
      label: "銅貨",
      count: 1000000,
      holder: storage!.id,
      basis: "釣り銭",
    },
    {
      type: "create",
      label: "日用品",
      count: 4440,
      holder: storage!.id,
      basis: "試験用",
    },
    {
      type: "create",
      label: "携行品",
      count: 840,
      holder: buyer,
      basis: "試験用",
    },
    {
      type: "create",
      label: "携行品",
      count: 840,
      holder: other,
      basis: "試験用",
    },
  ]);
  const till = stock.changes.nodes.find((n) => n.text === "銅貨")!;
  const settingsRequest = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, settingsRequest),
    f.store.context(f.graph),
    {
      commitId: settingsRequest,
      at: 0,
      changes: {
        nodes: [],
        edges: [],
        endEdges: [],
        revisions: [{ ...till, seriesId, unitsPerSlot: "unlimited" }],
      },
      management: {
        editorId: admin.id,
        reason: "通貨の枠設定",
        requestHash: "b".repeat(64),
      },
    },
  );
  await f.store.configureInventory(f.graph, true);
  const coin = await f.apply([
    {
      type: "move",
      item: till.id,
      from: storage!.id,
      to: buyer,
      count: 1,
      basis: "釣り銭",
    },
  ]);
  expect(coin.changes.revisions).toContainEqual(
    expect.objectContaining({
      id: payment!.id,
      count: 100001,
      unitsPerSlot: "unlimited",
    }),
  );
  expect(await f.store.context(f.graph).inventorySlots(buyer)).toBe(30);
  expect(await f.store.context(f.graph).inventorySlots(storage!.id)).toBe(150);
  const audit = (standard: boolean) =>
    auth.operations.execute(
      admin.id,
      randomUUID(),
      {
        operation: "worlds.graph",
        worldId: f.world,
        query: { kind: "inventory", minCount: 1000, standard },
      },
      { players: access.players },
    );
  expect(await audit(true)).toMatchObject({
    largeStacks: expect.arrayContaining([
      expect.objectContaining({ id: till.id, slots: 33334 }),
    ]),
  });
  expect(await audit(false)).toMatchObject({
    holders: expect.arrayContaining([
      expect.objectContaining({
        id: storage!.id,
        usedSlots: 150,
        freeSlots: 0,
        excessSlots: 0,
      }),
    ]),
    largeStacks: expect.arrayContaining([
      expect.objectContaining({ id: till.id, slots: 1, seriesId }),
    ]),
  });
  await f.move(2, f.place);
  const itemId = stock.changes.nodes.find((n) => n.text === "焼き菓子")!.id;
  const offerId = randomUUID();
  expect(
    await f.send(0, {
      command: "offer",
      requestId: offerId,
      storageId: storage!.id,
      itemId,
      count: 1,
      paymentSeriesId: seriesId,
      paymentLabel: "銅貨",
      paymentCount: 2,
      text: "広場の売店",
    }),
  ).toMatchObject({ state: "offered", offer: { id: offerId } });
  await f.send(0, { command: "finish" });
  expect(
    await f.send(1, { command: "search", query: { kind: "surroundings" } }),
  ).toMatchObject({
    exchangeOffers: [{ id: offerId, paymentSeriesId: seriesId }],
  });
  const exchange = (paymentItemId: string) => ({
    command: "exchange",
    offerId,
    paymentItemId,
    requestId: randomUUID(),
  });
  await expect(f.send(1, exchange(fake!.id))).rejects.toMatchObject({
    code: "EXCHANGE_PAYMENT",
  });
  await expect(f.send(1, exchange(payment!.id))).rejects.toMatchObject({
    code: "INVENTORY_CAPACITY_EXCEEDED",
    inventory: {
      capacity: { holderId: buyer, usedSlots: 30, projectedSlots: 31 },
    },
  });
  expect(await f.store.context(f.graph).node(till.id)).toMatchObject({
    count: 999999,
  });
  expect(await f.store.context(f.graph).node(payment!.id)).toMatchObject({
    count: 100001,
  });
  await f.apply([{ type: "remove", id: fake!.id }]);
  const orders = [exchange(payment!.id), exchange(otherPayment!.id)];
  const bought = await Promise.allSettled(
    orders.map((order, index) => f.send(index + 1, order)),
  );
  const winner = bought.findIndex((result) => result.status === "fulfilled");
  expect(winner).toBeGreaterThanOrEqual(0);
  expect(bought[1 - winner]).toMatchObject({
    status: "rejected",
    reason: { code: "EXCHANGE_STOCK" },
  });
  expect(await f.send(winner + 1, orders[winner]!)).toMatchObject({
    state: "accepted",
    commitId: orders[winner]!.requestId,
  });
  const winnerItems = (
    await readBelongings(f.store.context(f.graph), f.actors[winner + 1]!)
  ).items;
  expect(winnerItems).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: itemId, label: "焼き菓子" }),
      expect.objectContaining({
        id: orders[winner]!.paymentItemId,
        seriesId,
        count: winner === 0 ? 99999 : 99998,
      }),
    ]),
  );
  expect(
    (await readBelongings(f.store.context(f.graph), storage!.id)).items,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: "銅貨",
        seriesId,
        count: 1000001,
        unitsPerSlot: "unlimited",
      }),
    ]),
  );
  expect(
    await f.store.context(f.graph).node(orders[1 - winner]!.paymentItemId),
  ).toMatchObject({ count: winner === 0 ? 100000 : 100001, seriesId });
  expect(
    (await access.notices(f.people[0]!.id, f.world, seller)).notices,
  ).toHaveLength(1);
  await expect(
    f.send(winner + 1, {
      command: "update",
      text: "銅貨の個数を書き換える",
      dependencies: [],
      operations: [
        { type: "update", id: orders[winner]!.paymentItemId, count: 200000 },
      ],
    }),
  ).rejects.toMatchObject({ code: "UPDATE_REJECTED" });
  const change = await f.apply([
    {
      type: "move",
      item: till.id,
      from: storage!.id,
      to: f.far,
      count: 1,
      basis: "釣り銭の取り分け",
    },
  ]);
  expect(change.changes.nodes).toContainEqual(
    expect.objectContaining({
      kind: "existence",
      count: 1,
      seriesId,
      unitsPerSlot: "unlimited",
    }),
  );
  expect(f.calls).not.toHaveBeenCalled();
});

test("手番APIの15操作が受付結果を返し、確定内容と一致する", async () => {
  const f = await fixture();
  const checked = new Set<string>();
  const act = async (
    i: number,
    input: { command: string; [key: string]: unknown },
    message: string,
  ) => {
    const result = await f.send(i, input);
    expect(result.action).toMatchObject({
      command: input.command,
      message: expect.stringContaining(message),
    });
    checked.add(input.command);
    return result;
  };
  await act(0, { command: "start" }, "継続");
  const joined = await act(
    1,
    { command: "contact", targetId: f.actors[0] },
    "合流",
  );
  expect(joined).toMatchObject({
    actionable: false,
    actionMessage: "操作不要です（人物0の手番中）",
  });
  const same = await act(
    0,
    { command: "contact", targetId: f.actors[1] },
    "すでに",
  );
  expect(same).not.toHaveProperty("joined");
  expect(same).toMatchObject({
    actionable: true,
    actionMessage: "あなたの手番です",
  });
  expect(same.turnHolder).toMatchObject({ actorId: f.actors[0] });
  expect(
    await act(0, { command: "say", text: "記録に残す発言" }, "記録"),
  ).toHaveProperty("commitId");
  await act(0, { command: "comment", text: "別枠の記録" }, "受け付けました");
  const memo = await act(
    0,
    {
      command: "memo",
      text: "試験用メモ",
      participants: [f.actors[1]],
      dependencies: [],
    },
    "受領判断待ち",
  );
  expect(memo.memoIdState).toBe("pending");
  const done = await act(
    1,
    { command: "receive", applicationId: memo.applicationId, accept: true },
    "申請は確定",
  );
  expect(done.application).toMatchObject({
    state: "confirmed",
    applicationId: memo.applicationId,
  });
  expect(
    await f.store.context(f.graph).node(String(memo.memoId)),
  ).toMatchObject({ type: "memo" });
  await act(
    0,
    {
      command: "update",
      text: "別の場所へ移る",
      operations: [
        {
          type: "locate",
          subjectId: f.actors[0],
          text: "離れた場所",
          aboutIds: [f.far],
        },
      ],
      dependencies: [],
    },
    "確定",
  );
  const self = await act(
    0,
    { command: "search", query: { kind: "self" } },
    "検索が完了",
  );
  expect(JSON.stringify(self.material)).toContain(f.far);
  const script = randomUUID(),
    changes = { nodes: [], edges: [], endEdges: [], revisions: [] };
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  await act(
    0,
    {
      command: "create",
      text: "新しい性質を作る",
      dependencies: [],
      changes: {
        ...changes,
        nodes: [{ id: script, kind: "script", text: "冷静に歩く" }],
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
    },
    "確定",
  );
  expect(await f.store.context(f.graph).node(script)).toMatchObject({
    text: "冷静に歩く",
  });
  const failed = await act(
    0,
    { command: "oppose", text: "対象に作用する", dependencies: [], changes },
    "判定は失敗",
  );
  expect(failed.outcome).toMatchObject({ success: false });
  const ended = await act(0, { command: "end-turn" }, "手番を終了");
  expect(ended.action).toMatchObject({
    endedTurn: { number: 1, reason: "explicit" },
  });
  // 離れた場所へ移った人物は、手番を終えると別のセッションに分かれる。
  expect(ended.turnHolder).toMatchObject({ actorId: f.actors[0] });
  const shared = await f.status(1);
  expect(shared).toMatchObject({ actorId: f.actors[1] });
  expect(shared.sessionId).not.toBe(ended.sessionId);
  expect(JSON.stringify((await f.status(0)).entries)).toContain("別枠の記録");

  const source = randomUUID();
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  await act(
    1,
    {
      command: "say",
      requestId: source,
      text: "鳥が現れる",
      instantNpcs: ["鳥"],
    },
    "記録",
  );
  const npc = await act(
    1,
    {
      command: "npc-action",
      npcId: derivedId(source + ":manual:0"),
      text: "鳥が窓辺を見回した",
    },
    "NPCの行動を記録",
  );
  expect(npc.outcome).toMatchObject({ success: true });
  const promotion = await act(
    1,
    {
      command: "promote-npc",
      sourceRequestId: source,
      npcIndex: 0,
      description: "小屋に来た鳥",
    },
    "管理者の判断待ち",
  );
  expect(promotion.state).toBe("pending");
  const separated = await act(1, { command: "leave" }, "単独プレイを続けます");
  expect(separated.sessionId).not.toBe(shared.sessionId);
  const finished = await act(1, { command: "finish" }, "履歴を確定");
  expect(finished).toMatchObject({
    session: null,
    sceneId: expect.any(String),
  });
  await act(1, { command: "start" }, "単独プレイを開始");
  expect([...checked].sort()).toEqual([
    "comment",
    "contact",
    "create",
    "end-turn",
    "finish",
    "leave",
    "memo",
    "npc-action",
    "oppose",
    "promote-npc",
    "receive",
    "say",
    "search",
    "start",
    "update",
  ]);
});

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
  for (let i = 0; i < 7; i++) {
    const read = await f.send(1, {
      command: "search",
      query: { kind: "self" },
    });
    if (i === 6)
      expect(read.action).toMatchObject({ endedTurn: { reason: "limit" } });
  }
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

test("離席中の同席者を宛先にした同席受領は申請時に断り、戻れば受け付ける", async () => {
  const f = await fixture();
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
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const give = () =>
    f.send(0, {
      command: "update",
      text: "道具を渡す",
      operations: [
        {
          type: "move",
          item,
          from: f.actors[0],
          to: f.actors[1],
          basis: "手渡す",
        },
      ],
      dependencies: [],
    });
  const ready = (active: boolean) =>
    access.waiting(f.people[1]!.id, f.world, f.actors[1], undefined, active);
  await ready(false);
  const away = give();
  await expect(away).rejects.toMatchObject({ code: "RECIPIENT_AWAY" });
  await expect(away).rejects.toThrow(`人物1（${f.actors[1]}）は離席中`);
  expect((await f.status(0)).receiving).toBeNull();
  await ready(true);
  expect(await give()).toMatchObject({ state: "receiving" });
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
    await f.apply([
      { type: "create", label: "古い鍵", holder: f.actors[0], basis: "検証" },
    ]);
    const key = (await readBelongings(f.store.context(f.graph), f.actors[0]!))
      .items[0]!.id;
    expect(
      await cli.run(profile, "viewers", "--target", key, "--to", "self"),
    ).toMatchObject({ result: { viewers: [] } });
    expect(await f.store.context(f.graph).node(key)).toMatchObject({
      viewers: [],
    });
    expect(await cli.run(profile, "players")).toMatchObject({
      state: "error",
      code: "PLAYER_LIST_DISABLED",
    });
    await isolated.databases.postgres.query(
      "UPDATE world_construction SET player_list=true WHERE id=$1",
      [f.world],
    );
    const players = await cli.run(profile, "players");
    expect(players).toMatchObject({ state: "players", next: null });
    expect(players.items).toEqual([]);
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
    // 形が合わない申請には、合わない項目と理由を返す。
    const invalid = await app.inject({
      method: "POST",
      url: `/api/worlds/${f.world}/session?actorId=${f.actors[0]}`,
      headers: { cookie: f.people[0]!.cookie, "x-gestaloka-request": "1" },
      payload: {
        requestId: randomUUID(),
        command: "update",
        text: "古い形の申請",
        operations: [
          {
            type: "transfer",
            item: f.actors[1],
            to: f.actors[1],
            basis: "旧形式",
          },
        ],
        dependencies: [],
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("/command"),
    });
    expect(f.calls).not.toHaveBeenCalled();
  } finally {
    await cli.close();
    await app.close();
  }
});

test("同じVMのCLIをView別インスタンスで並列実行し、認可と要求の復旧を分離する", async () => {
  const f = await fixture(),
    app = await createApp(access, auth.identity, undefined, auth.operations),
    cli = await playerCli(app),
    ids = ["View / 甲", "View / 乙"];
  const run = (i: number, ...args: string[]) =>
    cli.run(undefined, ...args, "--instance", ids[i]!);
  try {
    await Promise.all([
      f.send(0, { command: "finish" }),
      f.send(1, { command: "finish" }),
    ]);
    const connections = await Promise.all(
      ids.map((_, i) =>
        run(
          i,
          "connect",
          "--full-ids",
          "--server",
          cli.base,
          "--world",
          f.world,
        ),
      ),
    );
    expect(connections[0].id).not.toBe(connections[1].id);
    const approvals = await Promise.all(
      connections.map((c, i) =>
        cli.approve(f.people[i]!.cookie, c.userCode, `actor:${f.actors[i]}`),
      ),
    );
    expect(approvals.map((a) => a.statusCode)).toEqual([302, 302]);
    const starts = await Promise.all(ids.map((_, i) => run(i, "start")));
    expect(starts[0].result.sessionId).not.toBe(starts[1].result.sessionId);
    cli.dropNextResponse("say");
    const [lost, other] = await Promise.all([
      run(0, "say", "--text", "自分のViewからの発言"),
      run(1, "search", "--kind", "self"),
    ]);
    expect(lost.state).toBe("error");
    expect(other.result.callsUsed).toBe(1);
    const recovered = await run(0, "recover");
    expect(recovered.requestId).toBe(lost.requestId);
    expect(recovered.result.callsUsed).toBe(1);
    expect((await run(1, "recover", "--request", lost.requestId)).code).toBe(
      "UNKNOWN_SHORT_ID",
    );
    const states = await Promise.all(
      ids.map((_, i) => run(i, "status", "--full-ids")),
    );
    expect(states.map((s) => s.viewerId)).toEqual(f.actors.slice(0, 2));
    expect(states.map((s) => s.callsUsed)).toEqual([1, 1]);
    const folders = await readdir(
      join(cli.directory, "gestaloka", "instances"),
    );
    expect(folders).toHaveLength(2);
    const profiles = await Promise.all(
      folders.map(async (folder) =>
        JSON.parse(
          await readFile(
            join(
              cli.directory,
              "gestaloka",
              "instances",
              folder,
              "profile.json",
            ),
            "utf8",
          ),
        ),
      ),
    );
    expect(profiles.map((p) => p.deviceId).sort()).toEqual(
      connections.map((c) => c.id).sort(),
    );
    expect(new Set(profiles.map((p) => p.secret)).size).toBe(2);
    const waiting = await Promise.all(
      ids.map((_, i) => run(i, "standby", "--resume")),
    );
    expect(waiting.map((w) => w.active)).toEqual([true, true]);
    expect((await run(0, "disconnect")).state).toBe("inactive");
    expect((await run(0, "standby")).state).toBe("inactive");
    expect((await run(1, "standby")).active).toBe(true);
    expect((await run(0, "standby", "--resume")).wakeKey).not.toBe(
      waiting[0].wakeKey,
    );
    const preserved = await Promise.all(
      folders.map(async (folder) =>
        JSON.parse(
          await readFile(
            join(
              cli.directory,
              "gestaloka",
              "instances",
              folder,
              "profile.json",
            ),
            "utf8",
          ),
        ),
      ),
    );
    expect(preserved.map((p) => p.lastRequestId).sort()).toEqual(
      profiles.map((p) => p.lastRequestId).sort(),
    );
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [resolve("packages/player-cli/dist/main.js"), "status", "--full-ids"],
      {
        env: {
          ...process.env,
          XDG_STATE_HOME: cli.directory,
          GESTALOKA_INSTANCE: ids[0],
        },
      },
    );
    expect(JSON.parse(stdout).viewerId).toBe(f.actors[0]);
    const legacy = join(cli.directory, "legacy.json");
    await cli.run(legacy, "connect", "--server", cli.base, "--world", f.world);
    expect(JSON.parse(await readFile(legacy, "utf8")).worldId).toBe(f.world);
    expect(
      (await cli.run(legacy, "status", "--instance", ids[0]!)).message,
    ).toContain("どちらか一方");
    const defaultConnection = await cli.run(
      undefined,
      "connect",
      "--full-ids",
      "--server",
      cli.base,
      "--world",
      f.world,
    );
    expect(
      JSON.parse(
        await readFile(
          join(cli.directory, "gestaloka", "default.json"),
          "utf8",
        ),
      ).deviceId,
    ).toBe(defaultConnection.id);
    expect(f.calls).not.toHaveBeenCalled();
    f.calls.mockImplementationOnce(async (id) => answer(id, sure));
    const appeared = await run(1, "say", "--text", "鳥が現れる", "--npc", "鳥");
    expect(appeared.result.instantNpcs).toEqual(["鳥"]);
  } finally {
    await cli.close();
    await app.close();
  }
});

test("シーン外で待機する本人を接触で起こし、待機の解除と1日を過ぎた在席切れでは接触できない", async () => {
  const f = await fixture(),
    user = f.people[1]!.id,
    actor = f.actors[1]!,
    connection = "muse-view";
  await f.send(1, { command: "finish" });
  await access.waiting(user, f.world, actor, undefined, false);
  const credit = (await access.reportStatus(user, f.world, actor)).turns;
  const idle = await access.waiting(user, f.world, actor, connection, true);
  expect(idle).toMatchObject({
    state: "standby",
    active: true,
    actionable: false,
  });
  expect((await f.status(1)).sessionId).toBeUndefined();
  const nearby = await f.send(0, {
    command: "search",
    query: { kind: "surroundings" },
  });
  expect(JSON.stringify(nearby.material)).toContain('"contactAvailable":true');
  await f.send(0, { command: "contact", targetId: actor });
  const awake = await access.waiting(user, f.world, actor, connection, true);
  expect(awake).toMatchObject({
    state: "turn",
    actionable: true,
    viewerId: actor,
  });
  expect(awake.wakeKey).toBeTruthy();
  expect(
    (await access.waiting(user, f.world, actor, connection, true)).wakeKey,
  ).toBe(awake.wakeKey);
  expect((await access.reportStatus(user, f.world, actor)).turns).toBe(credit);
  await access.waiting(user, f.world, actor, connection, false);
  await f.move(2, f.place);
  await expect(
    f.send(2, { command: "contact", targetId: actor }),
  ).rejects.toMatchObject({ code: "PARTNER_NOT_AVAILABLE" });
  expect(
    (await access.waiting(user, f.world, actor, connection, true)).wakeKey,
  ).not.toBe(awake.wakeKey);
  const now = new Date(Date.now() + 86401000);
  vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
  await expect(
    f.send(2, { command: "contact", targetId: actor }),
  ).rejects.toMatchObject({ code: "PARTNER_NOT_AVAILABLE" });
  await access.waiting(user, f.world, actor, connection, true);
  await f.send(2, { command: "contact", targetId: actor });
  expect((await f.status(2)).sessionId).toBe((await f.status(1)).sessionId);
  expect(f.calls).not.toHaveBeenCalled();
});

test("待受が止まった本人にも接触でき、戻ると不在の間の記録から再開する", async () => {
  const f = await fixture(),
    user = f.people[1]!.id,
    actor = f.actors[1]!,
    connection = "muse-view";
  await f.send(1, { command: "finish" });
  await access.waiting(user, f.world, actor, undefined, false);
  await access.waiting(user, f.world, actor, connection, true);
  // 実行環境の再起動で待受が止まり、在席期限を過ぎた。待機は解除していない。
  let now = new Date(Date.now() + 1800000);
  vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
  const nearby = await f.send(0, {
    command: "search",
    query: { kind: "surroundings" },
  });
  expect(JSON.stringify(nearby.material)).toContain('"contactAvailable":true');
  // 相手の手番は不在のためすぐスキップされ、接触した側が続けられる。
  const contacted = await f.send(0, { command: "contact", targetId: actor });
  expect(contacted).toMatchObject({
    actorId: f.actors[0],
    actionable: true,
    action: { message: expect.stringContaining("相手は離席中です") },
  });
  expect(JSON.stringify((await f.status(0)).entries)).toContain(
    "人物1が離席中のため手番をスキップします",
  );
  await f.send(0, { command: "say", text: "柵の修理を頼みに来た" });
  await f.send(0, { command: "end-turn" });
  expect((await f.status(0)).actorId).toBe(f.actors[0]);
  // 戻った本人は、接触した側の手番が終わると起き、不在の間の記録を読める。
  const back = await access.waiting(user, f.world, actor, connection, true);
  expect(back).toMatchObject({ state: "standby", actionable: false });
  await f.send(0, { command: "end-turn" });
  const woke = await access.waiting(user, f.world, actor, connection, true);
  expect(woke).toMatchObject({ state: "turn", actionable: true });
  expect(woke.wakeKey).toBeTruthy();
  expect(JSON.stringify((await f.status(1)).entries)).toContain(
    "柵の修理を頼みに来た",
  );
  // 接触した側が先に去っても、一人残ったセッションは本人が戻った時点で本人の手番になる。
  await f.send(1, { command: "end-turn" });
  now = new Date(now.getTime() + 1800000);
  await f.send(0, { command: "say", text: "明日また来る" });
  await f.send(0, { command: "finish" });
  expect(
    (await access.botPlay.sessions(f.world)).find(
      (s) => s.holder.actorId === actor,
    ),
  ).toMatchObject({ parked: true });
  const returned = await access.waiting(user, f.world, actor, connection, true);
  expect(returned).toMatchObject({ state: "turn", actionable: true });
  expect(returned.wakeKey).not.toBe(woke.wakeKey);
  expect(JSON.stringify((await f.status(1)).entries)).toContain("明日また来る");
  expect(f.calls).not.toHaveBeenCalled();
});

test("CLIでフレンド提案を受領すると遠くの人物と滞在先を調べられ、解除すると双方の公開が終わる", async () => {
  const f = await fixture();
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  const profile = (i: number) => join(cli.directory, `player-${i}.json`);
  const run = (i: number, ...args: string[]) => cli.run(profile(i), ...args);
  const [a, , b] = f.actors as [string, string, string];
  const empty = { items: [], next: null };
  try {
    for (const i of [0, 2]) {
      const entry = await run(
        i,
        "connect",
        "--server",
        cli.base,
        "--world",
        f.world,
      );
      expect(
        (
          await cli.approve(
            f.people[i]!.cookie,
            entry.userCode,
            `actor:${f.actors[i]}`,
          )
        ).statusCode,
      ).toBe(302);
    }
    await isolated.databases.postgres.query(
      "UPDATE world_construction SET player_list=true WHERE id=$1",
      [f.world],
    );
    const look = (target: string) =>
      run(2, "search", "--kind", "subject", "--target", target);
    const propose = async () => {
      const sent = await run(0, "friend", "propose", "--target", b);
      expect(sent.result).toMatchObject({ state: "pending" });
      const { notices } = await run(2, "notices");
      expect(notices[0]).toMatchObject({
        text: expect.stringContaining("人物0"),
        unread: true,
      });
      return {
        sent: sent.result.offerId as string,
        received: notices[0].id as string,
      };
    };
    const first = await propose();
    expect(
      await run(2, "friend", "decline", "--offer", first.received),
    ).toMatchObject({ result: { state: "declined" } });
    const second = await propose();
    expect(
      await run(0, "friend", "withdraw", "--offer", second.sent),
    ).toMatchObject({ result: { state: "withdrawn" } });
    expect(
      await run(2, "friend", "accept", "--offer", second.received),
    ).toMatchObject({ code: "FRIEND_NOT_AVAILABLE" });
    const offer = await propose();
    expect(await run(0, "players")).toMatchObject(empty);
    expect(await run(2, "players")).toMatchObject(empty);
    expect(await look(a)).toMatchObject({ code: "MATERIAL_NOT_AVAILABLE" });
    expect(await look(f.place)).toMatchObject({
      code: "MATERIAL_NOT_AVAILABLE",
    });
    expect(
      await run(2, "friend", "accept", "--offer", offer.received),
    ).toMatchObject({ result: { state: "accepted" } });
    expect(await run(0, "players")).toMatchObject({
      items: [{ name: "人物2", place: "離れた場所" }],
    });
    expect(await run(2, "players")).toMatchObject({
      items: [{ name: "人物0", place: "広場" }],
    });
    expect(await look(a)).toMatchObject({
      result: { material: { node: { text: "人物0" } } },
    });
    expect(await look(f.place)).toMatchObject({
      result: { material: { node: { text: "広場" } } },
    });
    expect(await run(2, "friend", "remove", "--target", a)).toMatchObject({
      result: { state: "removed" },
    });
    expect(await run(0, "players")).toMatchObject(empty);
    expect(await run(2, "players")).toMatchObject(empty);
    expect(await look(a)).toMatchObject({ code: "MATERIAL_NOT_AVAILABLE" });
    expect(await look(f.place)).toMatchObject({
      code: "MATERIAL_NOT_AVAILABLE",
    });
    expect(
      await run(2, "friend", "accept", "--offer", offer.received),
    ).toMatchObject({ code: "FRIEND_NOT_AVAILABLE" });
  } finally {
    await cli.close();
    await app.close();
  }
}, 120000);

test("プレイヤーの一覧は、待機中で接触を受けられるフレンドだけを所在地を問わず返す", async () => {
  const f = await fixture(),
    list = () => access.partners(f.people[2]!.id, f.world, f.actors[2]);
  await expect(list()).rejects.toMatchObject({ code: "PLAYER_LIST_DISABLED" });
  // 一覧が無効な世界では、離れた人物と滞在先を調べられない。
  const look = (targetId: string) =>
    f.send(2, { command: "search", query: { kind: "subject", targetId } });
  await expect(look(f.actors[0]!)).rejects.toMatchObject({
    code: "MATERIAL_NOT_AVAILABLE",
  });
  await isolated.databases.postgres.query(
    "UPDATE world_construction SET player_list=true WHERE id=$1",
    [f.world],
  );
  const propose = () =>
    f.friend(0, {
      requestId: randomUUID(),
      action: "propose",
      targetId: f.actors[2]!,
    });
  const offer = await propose();
  expect(
    await f.friend(2, {
      requestId: randomUUID(),
      action: "propose",
      targetId: f.actors[0]!,
    }),
  ).toEqual(offer);
  const accept = {
    requestId: randomUUID(),
    action: "accept" as const,
    offerId: offer.offerId,
  };
  await expect(f.friend(1, accept)).rejects.toMatchObject({
    code: "FRIEND_NOT_AVAILABLE",
  });
  await expect(f.friend(0, accept)).rejects.toMatchObject({
    code: "FRIEND_NOT_AVAILABLE",
  });
  expect(await list()).toEqual({ items: [], next: null });
  await expect(look(f.place)).rejects.toMatchObject({
    code: "MATERIAL_NOT_AVAILABLE",
  });
  const [one, two] = await Promise.all([
    f.friend(2, accept),
    f.friend(2, accept),
  ]);
  expect(one).toEqual(two);
  expect(one.state).toBe("accepted");
  // 開始した人物は待機中になる。本人と、NPCとして担当される人物は含めない。
  await isolated.databases.postgres.query(
    "INSERT INTO bot_npc(world_id,actor_id,controller,user_id,assignment_id) VALUES($1,$2,'bot',$3,$4)",
    [f.world, f.actors[1], f.people[1]!.id, randomUUID()],
  );
  expect(await list()).toEqual({
    items: [
      { actorId: f.actors[0], name: "人物0", placeId: f.place, place: "広場" },
    ],
    next: null,
  });
  // 一覧に載る人物とその滞在先は、行く前に調べられる。載らない人物は調べられない。
  await look(f.actors[0]!);
  await look(f.place);
  await expect(look(f.actors[1]!)).rejects.toMatchObject({
    code: "MATERIAL_NOT_AVAILABLE",
  });
  // 在席期限を過ぎても、最終更新から1日は接触を受けられるので一覧に残る。
  const lapse = (ms: number) =>
    isolated.databases.postgres.query(
      "UPDATE player_waiting SET last_seen=$3 WHERE world_id=$1 AND actor_id=$2",
      [f.world, f.actors[0], new Date(Date.now() - ms)],
    );
  await lapse(601000);
  expect((await list()).items).toHaveLength(1);
  await lapse(86401000);
  expect(await list()).toEqual({ items: [], next: null });
  await expect(look(f.place)).rejects.toMatchObject({
    code: "MATERIAL_NOT_AVAILABLE",
  });
  expect(f.calls).not.toHaveBeenCalled();
});

test("インスタントNPCは公開行動なしで手番を終え、その後も行動できる", async () => {
  const f = await fixture(1);
  const source = randomUUID();
  const npc = derivedId(source + ":manual:0");
  await f.send(0, {
    command: "say",
    requestId: source,
    text: "水盤に小鳥が降りる。",
    instantNpcs: ["小鳥"],
  });
  const next = await f.send(0, { command: "end-turn" });
  expect(next.actorId).toBe(npc);
  const request = derivedId(`instant:${next.sessionId}:${npc}:${next.turn}`);
  f.calls.mockImplementationOnce(
    async (id, role, _messages, _target, _effort, _attempt, validate) => {
      expect(role).toBe("world-server-npc");
      const choice = { command: "end-turn" };
      expect(() => validate!(JSON.stringify(choice))).not.toThrow();
      return answer(id, choice);
    },
  );
  await access.botPlay.tickNpcs(f.world);
  await access.botPlay.tickNpcs(f.world);
  const passed = await f.status(0);
  expect(passed).toMatchObject({
    actorId: f.actors[0],
    turn: Number(next.turn) + 1,
    characters: expect.arrayContaining([
      expect.objectContaining({ actorId: npc }),
    ]),
  });
  expect(passed.entries.at(-1)?.payload).toMatchObject({
    actorId: npc,
    entries: [],
    transition: {
      type: "turn-ended",
      publicActivity: false,
      message: expect.stringContaining("公開行動なし"),
    },
  });
  expect(await f.store.receipt(f.graph, request)).toBeUndefined();

  await f.send(0, { command: "end-turn" });
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { text: "小鳥が水盤から飛び去る。", departs: true }),
  );
  await access.botPlay.tickNpcs(f.world);
  const departed = await f.status(0);
  expect(
    departed.entries.flatMap(({ payload }) => payload.entries ?? []),
  ).toContainEqual(
    expect.objectContaining({
      actorId: npc,
      input: "小鳥が水盤から飛び去る。",
    }),
  );
  expect(departed.characters).not.toContainEqual(
    expect.objectContaining({ actorId: npc }),
  );
});

test("その場の存在へ渡す入力は直近に絞られ、手番中に同席者が増えても次の試行で手番が進む", async () => {
  const f = await fixture();
  await f.send(0, {
    command: "say",
    text: "鳥を見つける",
    instantNpcs: ["小鳥"],
  });
  await f.send(0, { command: "end-turn" });
  const bird = (await f.status(0)).actorId,
    ids: string[] = [],
    act = { text: "土をつつく" };
  // 長く続いた場でも、その場の存在へ渡す履歴と周囲の状態は直近の件数に絞られる。
  f.calls.mockImplementation(async (id) => answer(id, act));
  for (let i = 0; i < 26; i++) {
    await access.botPlay.tickNpcs(f.world);
    await f.send(0, { command: "end-turn" });
  }
  const crowd = Array.from({ length: 13 }, () => randomUUID());
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: crowd.map((id, i) => ({
          id,
          kind: "script" as const,
          text: `広場の様子${i}`,
        })),
        edges: crowd.map((id) => ({
          id: randomUUID(),
          kind: "status" as const,
          role: "content" as const,
          source: f.place,
          target: id,
          period: { from: 0 },
        })),
        revisions: [],
        endEdges: [],
      },
    },
  );
  // 行動を選んでいる間に別の人物が合流し、この試行は確定されない。
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    const prompt = JSON.parse(String(messages[1]!.content));
    expect(prompt.history.entries).toHaveLength(24);
    expect(prompt.history.omittedEntries).toBeGreaterThan(0);
    // 記録からは、行動の選択に使えない属性を外して渡す。発言と手番の移り変わりは残す。
    const records = JSON.stringify(prompt.history.entries);
    for (const key of ["commitId", "publicActivity", "at"])
      expect(records).not.toContain(`"${key}":`);
    expect(records).toContain(`"input":`);
    expect(records).toContain(`"transition":`);
    for (const record of prompt.history.entries)
      if (record.payload.transition)
        expect(record.payload).not.toHaveProperty("actorId");
    const place = prompt.nearby.find(
      (n: { node: { id: string } }) => n.node.id === f.place,
    );
    expect(place.states).toHaveLength(12);
    expect(place.omittedStates).toBe(1);
    // 状態は、置き換えの指定に使うIDと本文だけを渡す。
    expect(Object.keys(place.states[0])).toEqual(["id", "text"]);
    ids.push(id);
    await f.send(1, { command: "contact", targetId: f.actors[0] });
    return answer(id, act);
  });
  await access.botPlay.tickNpcs(f.world);
  expect((await f.status(0)).actorId).toBe(bird);
  // 入力が変わった再試行は別の呼び出しになり、手番が進む。
  f.calls.mockImplementationOnce(async (id) => {
    ids.push(id);
    return answer(id, act);
  });
  await access.botPlay.tickNpcs(f.world);
  expect(ids[1]).not.toBe(ids[0]);
  expect((await f.status(0)).actorId).not.toBe(bird);
});

test("受領判断から同じ元手番へ戻ったときにも、新しい起床キーを返す", async () => {
  const f = await fixture();
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const check = (i: number) =>
    access.waiting(f.people[i]!.id, f.world, f.actors[i], `view-${i}`, true);
  const before = await check(0),
    item = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [{ id: item, kind: "existence", text: "手渡す道具" }],
        revisions: [],
        endEdges: [],
        edges: [
          {
            id: randomUUID(),
            kind: "has",
            source: f.actors[0]!,
            target: item,
            period: { from: 0 },
          },
        ],
      },
    },
  );
  const proposal = await f.send(0, {
    command: "update",
    text: "道具を手渡す",
    operations: [
      {
        type: "move",
        item,
        from: f.actors[0],
        to: f.actors[1],
        basis: "手渡しの申請",
      },
    ],
    dependencies: [],
  });
  expect(await check(0)).toMatchObject({ state: "standby", actionable: false });
  expect(await check(1)).toMatchObject({
    state: "receiving",
    actionable: true,
    applicationId: proposal.applicationId,
  });
  await f.send(1, {
    command: "receive",
    applicationId: proposal.applicationId,
    accept: false,
  });
  const resumed = await check(0);
  expect(resumed).toMatchObject({ state: "turn", turn: before.turn });
  expect(resumed.wakeKey).not.toBe(before.wakeKey);
  await f.send(0, { command: "search", query: { kind: "self" } });
  expect((await check(0)).wakeKey).toBe(resumed.wakeKey);
  expect(f.calls).not.toHaveBeenCalled();
});

test("バックグラウンドのlistenが待機を維持し、後から来た接触でJSON通知を出す", async () => {
  const f = await fixture(),
    app = await createApp(access, auth.identity, undefined, auth.operations),
    cli = await playerCli(app),
    profile = join(cli.directory, "listener.json");
  let child: ReturnType<typeof spawn> | undefined;
  try {
    f.calls.mockImplementationOnce(async (id) => answer(id, sure));
    const ordered = await f.send(0, {
      command: "update",
      text: "薪を割って乾かす",
      operations: [
        { type: "create", label: "薪", holder: f.actors[0], basis: "割った" },
      ],
      waitMinutes: 1,
      dependencies: [],
    });
    f.calls.mockClear();
    await f.send(0, { command: "finish" });
    await access.waiting(
      f.people[0]!.id,
      f.world,
      f.actors[0],
      undefined,
      false,
    );
    const connection = await cli.run(
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
          connection.userCode,
          `actor:${f.actors[0]}`,
        )
      ).statusCode,
    ).toBe(302);
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const saved = JSON.parse(await readFile(profile, "utf8"));
    await writeFile(profile, JSON.stringify({ ...saved, server: address }));
    child = spawn(
      process.execPath,
      [
        resolve("packages/player-cli/dist/main.js"),
        "listen",
        "--resume",
        "--profile",
        profile,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const events: Record<string, unknown>[] = [];
    const reader = createInterface({ input: child.stdout! });
    reader.on("line", (line) => events.push(JSON.parse(line)));
    await vi.waitFor(
      () =>
        expect(events).toContainEqual(
          expect.objectContaining({
            state: "standby",
            actionMessage: "操作不要です",
          }),
        ),
      { timeout: 10000 },
    );
    // 届いた物品の通知は、セッションの外で待機している本人の待受にも出る。
    await new BotPlay(
      runtime,
      () =>
        new Date(Date.parse((ordered.arrival as { dueAt: string }).dueAt) + 1),
    ).deliverArrivals(f.world);
    await vi.waitFor(
      () =>
        expect(events).toContainEqual(
          expect.objectContaining({
            state: "standby",
            noticeKey: expect.any(String),
            noticeMessage: expect.stringContaining("notices"),
          }),
        ),
      { timeout: 4000 },
    );
    const noticed = await cli.run(profile, "listen", "--once");
    expect(noticed).toMatchObject({ state: "standby", actionable: false });
    expect((await cli.run(profile, "status")).unreadNotices).toBe(1);
    expect(await cli.run(profile, "notices", "--full-ids")).toMatchObject({
      state: "notices",
      notices: [{ id: noticed.noticeKey, unread: true }],
    });
    expect((await cli.run(profile, "standby")).noticeKey).toBeNull();
    await f.send(1, { command: "contact", targetId: f.actors[0] });
    await vi.waitFor(
      () =>
        expect(
          events.some((e) => e.state === "turn" && e.actionable === true),
        ).toBe(true),
      { timeout: 4000 },
    );
    expect(events.filter((e) => e.state === "turn")).toHaveLength(1);
    expect(f.calls).not.toHaveBeenCalled();
    const first = events.find((e) => e.state === "turn")!;
    const snapshots = vi.spyOn(access, "waiting");
    const once = cli.run(
      profile,
      "listen",
      "--once",
      "--after-wake",
      String(first.wakeKey),
    );
    await vi.waitFor(() =>
      expect(
        snapshots.mock.calls.some(
          (call) => call[4] === undefined && call[5] === true,
        ),
      ).toBe(true),
    );
    const memo = await f.send(0, {
      command: "memo",
      text: "共有するメモ",
      participants: [f.actors[1]],
      dependencies: [],
    });
    await f.send(1, {
      command: "receive",
      applicationId: memo.applicationId,
      accept: true,
    });
    const restored = await once;
    expect(restored).toMatchObject({
      state: "turn",
      actionable: true,
      actionMessage: "あなたの手番です",
      turn: first.turn,
      context: {
        actorId: restored.viewerId,
        name: "人物0",
        phase: "turn",
        recent: [{ transition: { type: "session-joined", name: "人物1" } }],
      },
    });
    expect(restored.wakeKey).not.toBe(first.wakeKey);
    await f.move(2, f.place);
    await f.send(2, { command: "contact", targetId: f.actors[0] });
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          actionable: true,
          actionMessage: "あなたの手番です",
          notificationMessage: "この通知への操作は不要です",
          progress: expect.objectContaining({
            updates: [
              expect.objectContaining({
                transition: expect.objectContaining({
                  type: "session-joined",
                  name: "人物2",
                }),
              }),
            ],
          }),
        }),
      ),
    );
    reader.close();
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child!.once("exit", resolve));
    }
    await cli.close();
    await app.close();
  }
}, 60000);

test("メモノードは自由な本文で作成し、共有と更新に関係者の受領を使う", async () => {
  const f = await fixture();
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const request = {
    command: "memo",
    text: "見つけた色や音を自由に並べる観察ノート",
    participants: [f.actors[1]],
    dependencies: [],
  };
  const declined = await f.send(0, request);
  expect((await f.status(1)).actorId).toBe(f.actors[1]);
  expect(
    await f.store.context(f.graph).node(declined.memoId as string),
  ).toBeUndefined();
  await f.send(1, {
    command: "receive",
    applicationId: declined.applicationId,
    accept: false,
  });
  expect(
    await f.store.context(f.graph).node(declined.memoId as string),
  ).toBeUndefined();
  await expect(
    f.send(0, { ...request, participants: [f.actors[2]] }),
  ).rejects.toMatchObject({ code: "REMOTE_RECEIVING" });
  const shared = await f.send(0, request);
  await f.send(1, {
    command: "receive",
    applicationId: shared.applicationId,
    accept: true,
  });
  const memo = await f.store.context(f.graph).node(shared.memoId as string);
  expect(memo).toMatchObject({
    kind: "script",
    type: "memo",
    text: request.text,
  });
  expect(
    JSON.stringify(
      (await f.send(0, { command: "search", query: { kind: "memos" } }))
        .material,
    ),
  ).toContain(request.text);
  expect(
    (await f.send(2, { command: "search", query: { kind: "memos" } })).material,
  ).toEqual([]);
  const revised = await f.send(0, {
    command: "update",
    text: "観察ノートへ追記する",
    changes: {
      nodes: [],
      revisions: [{ ...memo, text: "別の感じ方も並べて残す" }],
      edges: [],
      endEdges: [],
    },
    dependencies: [],
  });
  expect(
    (await f.store.context(f.graph).node(shared.memoId as string))?.text,
  ).toBe(request.text);
  await f.send(1, {
    command: "receive",
    applicationId: revised.applicationId,
    accept: true,
  });
  expect(
    (await f.store.context(f.graph).node(shared.memoId as string))?.text,
  ).toBe("別の感じ方も並べて残す");
  const own = await f.send(2, {
    command: "memo",
    text: "自分に関連付けた記録",
    dependencies: [],
  });
  expect(own.state).toBe("accepted");
  expect(f.calls).not.toHaveBeenCalled();
});

test("管理者のお知らせは操作中の人物全員か指定した人物に一度だけ届く", async () => {
  const f = await fixture(),
    admin = await auth.person(),
    send = (requestId: string, actorIds?: string[]) =>
      auth.operations.execute(
        admin.id,
        requestId,
        {
          operation: "notices.send",
          worldId: f.world,
          text: "全員へのお知らせ",
          ...(actorIds ? { actorIds } : {}),
          reason: "仕様変更の案内",
        },
        { players: access.players },
      );
  const requestId = randomUUID();
  expect(
    ((await send(requestId)) as { actorIds: string[] }).actorIds.sort(),
  ).toEqual([...f.actors].sort());
  await send(requestId);
  for (const [i, actor] of f.actors.entries())
    expect(
      (await access.notices(f.people[i]!.id, f.world, actor)).notices,
    ).toMatchObject([{ unread: true, text: "全員へのお知らせ" }]);
  await send(randomUUID(), [f.actors[1]!]);
  expect(
    (await access.notices(f.people[1]!.id, f.world, f.actors[1])).notices,
  ).toHaveLength(2);
  expect(
    (await access.notices(f.people[0]!.id, f.world, f.actors[0])).notices,
  ).toHaveLength(1);
  await expect(send(randomUUID(), [randomUUID()])).rejects.toMatchObject({
    code: "NOTICE_TARGET_NOT_FOUND",
  });
  // 応答の形に合わない通知があれば、返せなかった通知を既読にしない。
  await send(randomUUID(), [f.actors[2]!]);
  await isolated.databases.postgres.query(
    "INSERT INTO player_notice(id,world_id,actor_id,created_at,text) VALUES($1,$2,$3,now(),'形の合わない通知')",
    ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", f.world, f.actors[2]],
  );
  await expect(
    access.notices(f.people[2]!.id, f.world, f.actors[2]),
  ).rejects.toThrow();
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT count(*)::int AS count FROM player_notice WHERE world_id=$1 AND actor_id=$2 AND NOT read",
        [f.world, f.actors[2]],
      )
    ).rows[0].count,
  ).toBe(2);
});

test("受容したインスタントNPCだけを昇格申請し、管理者の許可後に一度だけ永続化する", async () => {
  const f = await fixture(),
    admin = await auth.person(),
    source = randomUUID();
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  await f.send(0, {
    requestId: source,
    command: "say",
    text: "小さな動物が二匹、木陰を横切る",
    instantNpcs: ["木陰の小さな動物", "別の小さな動物"],
  });
  expect(f.calls.mock.calls.map((call) => call[1])).toEqual([
    "world-creation-dice",
  ]);
  f.calls.mockClear();
  await f.send(0, { command: "end-turn" });
  f.calls.mockImplementation(async (id) =>
    answer(id, { text: "木陰で様子を見る" }),
  );
  await access.botPlay.tickNpcs();
  const pending = await f.send(1, {
    command: "promote-npc",
    sourceRequestId: source,
    npcIndex: 0,
    description: "人のそばで穏やかに過ごす小さな動物",
  });
  await f.send(1, { command: "end-turn" });
  await access.botPlay.tickNpcs();
  await access.botPlay.tickNpcs();
  const npc = derivedId(source + ":manual:0");
  expect(await f.store.context(f.graph).node(npc)).toBeUndefined();
  await expect(
    f.send(2, {
      command: "promote-npc",
      sourceRequestId: source,
      npcIndex: 0,
      description: "見ていない出現",
    }),
  ).rejects.toMatchObject({ code: "PROMOTION_SOURCE_NOT_AVAILABLE" });
  const approve = {
    operation: "npcs.decidePromotion" as const,
    worldId: f.world,
    promotionId: pending.promotionId as string,
    approve: true,
    reason: "継続する存在として許可",
  };
  await expect(
    auth.operations.execute(f.people[0]!.id, randomUUID(), approve, {
      players: access.players,
    }),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  const list = await auth.operations.execute(
    admin.id,
    randomUUID(),
    { operation: "npcs.promotions", worldId: f.world },
    { players: access.players },
  );
  expect(JSON.stringify(list)).toContain("木陰の小さな動物");
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, {
      description: "木陰で暮らす小さな動物",
      memory: "木陰で様子を見た",
    }),
  );
  const id = randomUUID(),
    accepted = await auth.operations.execute(admin.id, id, approve, {
      players: access.players,
    });
  expect(
    await auth.operations.execute(admin.id, id, approve, {
      players: access.players,
    }),
  ).toEqual(accepted);
  expect(await f.store.context(f.graph).node(npc)).toMatchObject({
    kind: "existence",
    text: "木陰の小さな動物",
  });
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT controller FROM bot_npc WHERE world_id=$1 AND actor_id=$2",
        [f.world, npc],
      )
    ).rows[0].controller,
  ).toBe("server");
  await expect(
    f.send(0, {
      command: "promote-npc",
      sourceRequestId: source,
      npcIndex: 0,
      description: "重ねた申請",
    }),
  ).rejects.toMatchObject({ code: "PROMOTION_EXISTS" });
  const rejected = await f.send(0, {
    command: "promote-npc",
    sourceRequestId: source,
    npcIndex: 1,
    description: "別の個体の申請",
  });
  await auth.operations.execute(
    admin.id,
    randomUUID(),
    { ...approve, promotionId: rejected.promotionId as string, approve: false },
    { players: access.players },
  );
  expect(
    await f.store.context(f.graph).node(derivedId(source + ":manual:1")),
  ).toBeUndefined();
  await auth.operations.execute(
    admin.id,
    randomUUID(),
    {
      operation: "npcs.put",
      worldId: f.world,
      actorId: npc,
      controller: "bot",
      userId: f.people[0]!.id,
      reason: "操作担当を個別に指定",
    },
    { players: access.players },
  );
  expect(
    (
      await access.botCommand(
        f.people[0]!.id,
        f.world,
        { requestId: randomUUID(), command: "start" },
        npc,
      )
    ).sessionId,
  ).toBeTruthy();
});

test("報告は当日の通常手番で枠を得て、文字数・再送・並列送信・本人認可を守る", async () => {
  const f = await fixture(),
    user = f.people[0]!.id;
  const quota = () => access.reportStatus(user, f.world, f.actors[0]);
  expect(await quota()).toMatchObject({
    dailyLimit: 10,
    turnsPerReport: 3,
    maxCharacters: 1200,
    turns: 0,
    allowance: 1,
    available: 1,
  });
  const input = { requestId: randomUUID(), text: "運営への感想" };
  for (let i = 0; i < 2; i++) await f.send(0, { command: "end-turn" });
  expect((await quota()).available).toBe(1);
  const third = { requestId: randomUUID(), command: "end-turn" };
  await f.send(0, third);
  await f.send(0, third);
  expect(await quota()).toMatchObject({ turns: 3, available: 1 });
  await f.send(0, { command: "search", query: { kind: "self" } });
  await f.send(0, { command: "comment", text: "別枠のコメント" });
  expect((await quota()).turns).toBe(3);
  await expect(
    access.report(
      user,
      f.world,
      { requestId: randomUUID(), text: "あ".repeat(1201) },
      f.actors[0],
    ),
  ).rejects.toMatchObject({ code: "REPORT_TOO_LONG" });
  const requests = [
    { requestId: randomUUID(), text: "あ".repeat(1200) },
    input,
  ];
  const attempts = await Promise.allSettled(
    requests.map((r) => access.report(user, f.world, r, f.actors[0])),
  );
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const accepted = attempts.findIndex((r) => r.status === "fulfilled");
  const replay = await access.report(
    user,
    f.world,
    requests[accepted]!,
    f.actors[0],
  );
  expect(replay.id).toBe(requests[accepted]!.requestId);
  expect(await quota()).toMatchObject({ sent: 1, available: 0 });
  expect(
    (await access.reportStatus(f.people[1]!.id, f.world, f.actors[1]))
      .available,
  ).toBe(1);
  await expect(
    access.report(
      user,
      f.world,
      { requestId: randomUUID(), text: "他人の人物" },
      f.actors[1],
    ),
  ).rejects.toMatchObject({ status: 404 });
  const admin = await auth.person();
  expect(
    JSON.stringify(
      await auth.operations.execute(
        admin.id,
        randomUUID(),
        { operation: "reports.list", worldId: f.world },
        { players: access.players },
      ),
    ),
  ).toContain(requests[accepted]!.text);
  await expect(
    auth.operations.execute(
      user,
      randomUUID(),
      { operation: "reports.list", worldId: f.world },
      { players: access.players },
    ),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  expect(f.calls).not.toHaveBeenCalled();
});

test("報告の日次枠は日本時間で切り替わり、管理者が3つの上限を即時に変えられる", async () => {
  const f = await fixture(),
    admin = await auth.person(),
    user = f.people[0]!.id;
  let now = new Date("2026-11-18T14:59:59Z");
  vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
  const quota = () => access.reportStatus(user, f.world, f.actors[0]);
  const complete = async (n: number) => {
    for (let i = 0; i < n; i++) await f.send(0, { command: "end-turn" });
  };
  const post = (text: string) =>
    access.report(
      user,
      f.world,
      { requestId: randomUUID(), text },
      f.actors[0],
    );
  await complete(3);
  const earlier = await post("日付切替前の報告を保持する");
  expect(await quota()).toMatchObject({
    date: "2026-11-18",
    turns: 3,
    sent: 1,
  });
  now = new Date("2026-11-18T15:00:00Z");
  expect(await quota()).toMatchObject({
    date: "2026-11-19",
    turns: 0,
    sent: 0,
    available: 1,
  });
  await post("今日はプレイを開始できない");
  await expect(post("未プレイ時の本日2件目")).rejects.toMatchObject({
    code: "REPORT_LIMIT",
  });
  await complete(30);
  for (let i = 0; i < 9; i++) await post(`本日分の報告 ${i}`);
  expect(await quota()).toMatchObject({
    turns: 30,
    allowance: 10,
    sent: 10,
    available: 0,
  });
  await expect(post("日次上限を超える送信")).rejects.toMatchObject({
    code: "REPORT_LIMIT",
  });
  const policy = async (
    dailyLimit: number,
    turnsPerReport: number,
    maxCharacters: number,
  ) => {
    const current = await auth.operations.execute(admin.id, randomUUID(), {
      operation: "reportPolicy.read",
    });
    return auth.operations.execute(admin.id, randomUUID(), {
      operation: "reportPolicy.put",
      dailyLimit,
      turnsPerReport,
      maxCharacters,
      expectedVersion: Number(current.version),
      reason: "運用中の上限変更",
    });
  };
  await policy(12, 2, 5);
  expect(await quota()).toMatchObject({
    allowance: 12,
    available: 2,
    maxCharacters: 5,
    turnsPerReport: 2,
  });
  await expect(post("あ".repeat(6))).rejects.toMatchObject({
    code: "REPORT_TOO_LONG",
  });
  await post("あ".repeat(5));
  await policy(12, 2, 8);
  await post("あ".repeat(8));
  await policy(1, 2, 8);
  expect(await quota()).toMatchObject({ sent: 12, available: 0 });
  const records = await auth.operations.execute(
    admin.id,
    randomUUID(),
    { operation: "reports.list", worldId: f.world },
    { players: access.players },
  );
  expect(JSON.stringify(records)).toContain(earlier.id);
  expect(JSON.stringify(records)).toContain("日付切替前の報告を保持する");
  expect(f.calls).not.toHaveBeenCalled();
});

test("通常手番を完了したアカウントを母数に、生成GMが0回の人を含む中央値と2日の再訪を読む", async () => {
  const f = await fixture(6),
    admin = await auth.person(),
    db = isolated.databases.postgres,
    [p0, p1, , p3, p4] = f.people.map((p) => p.id) as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
  let now = new Date("2026-11-17T03:00:00Z");
  vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
  // サーバー担当はプレイヤーの同席中だけ動くため、前日に人物2をp1へ合流させてから担当を切り替える。
  await f.move(2, f.place);
  await f.send(2, { command: "contact", targetId: f.actors[1] });
  await auth.operations.execute(
    admin.id,
    randomUUID(),
    {
      operation: "npcs.put",
      worldId: f.world,
      actorId: f.actors[2]!,
      controller: "server",
      reason: "隔離試験のサーバー担当",
    },
    { players: access.players },
  );
  f.calls.mockImplementation(async (id) => answer(id, { command: "end-turn" }));
  const turns = async (i: number, n: number) => {
    for (let k = 0; k < n; k++) {
      if ((await f.status(i)).actorId !== f.actors[i])
        await access.botPlay.tickNpcs(f.world);
      await f.send(i, { command: "end-turn" });
    }
  };
  now = new Date("2026-11-18T03:00:00Z");
  const budget = `activity-${randomUUID()}`;
  await db.query("INSERT INTO llm_budget(id,limit_nano) VALUES($1,NULL)", [
    budget,
  ]);
  const gm = async (
    user: string,
    at: string,
    n = 1,
    operation: string | null = null,
  ) => {
    for (let k = 0; k < n; k++)
      await db.query(
        `INSERT INTO llm_call(id,budget_id,hash,reserved_nano,request,state,created_at,world_id,user_id,operation_id)
        VALUES($1,$2,'h',0,$3,'complete',$4,$5,$6,$7)`,
        [
          randomUUID(),
          budget,
          { role: k % 2 ? "world-explore-dice" : "world-creation-dice" },
          at,
          f.graph,
          user,
          operation,
        ],
      );
  };
  // 11月18日（日本時間）: p0は2手番・生成3回、p1は1手番・生成0回、p4は1手番・生成1回。
  await turns(0, 2);
  await turns(1, 1);
  await turns(4, 1);
  await gm(p0, "2026-11-18T01:00:00Z", 2);
  await gm(p0, "2026-11-18T14:59:59Z");
  await gm(p4, "2026-11-18T05:00:00Z");
  // p3は報告だけで、手番を終えずに生成だけを使う。
  await access.report(
    p3,
    f.world,
    { requestId: randomUUID(), text: "報告だけを送る" },
    f.actors[3],
  );
  await gm(p3, "2026-11-18T06:00:00Z", 2);
  // サーバー担当の手番と申請による生成は、操作担当の管理者に付いても数えない。
  await access.botPlay.tickNpcs(f.world);
  expect(
    (
      await db.query(
        `SELECT 1 FROM bot_chat c JOIN bot_session s ON s.id=c.session_id
        WHERE s.world_id=$1 AND c.recorded_at>='2026-11-17T15:00:00Z' AND c.payload->'transition'->>'type'='turn-ended' AND c.payload->'transition'->>'actorId'=$2`,
        [f.world, f.actors[2]],
      )
    ).rowCount,
  ).toBeGreaterThan(0);
  const npcRequest = randomUUID();
  await db.query(
    "INSERT INTO bot_request(id,actor_id,world_id,hash) VALUES($1,$2,$3,'h')",
    [npcRequest, f.actors[2], f.world],
  );
  await gm(admin.id, "2026-11-18T07:00:00Z", 1, npcRequest);
  // 11月19日: p0・p1・p3・p5が1手番ずつ。生成はp1が5回、p3が2回。
  now = new Date("2026-11-19T10:00:00Z");
  for (const i of [0, 1, 3, 5]) await turns(i, 1);
  await gm(p1, "2026-11-18T15:00:00Z");
  await gm(p1, "2026-11-19T02:00:00Z", 4);
  await gm(p3, "2026-11-19T03:00:00Z", 2);
  const read = async (days: string[]) =>
    (await auth.operations.execute(
      admin.id,
      randomUUID(),
      { operation: "activity.read", worldId: f.world, days },
      { players: access.players },
    )) as { asOf: string; basis: string; days: unknown[] };
  const result = await read(["2026-11-18", "2026-11-19"]);
  expect(result).toMatchObject({
    granularity: "JST日",
    bothDays: 2,
    days: [
      {
        day: "2026-11-18",
        from: "2026-11-17T15:00:00.000Z",
        to: "2026-11-18T15:00:00.000Z",
        accounts: 3,
        turns: 4,
        generation: {
          zeroAccounts: 1,
          median: 1,
          usedAccounts: 2,
          usedMedian: 2,
          withoutTurns: { accounts: 1, calls: 2 },
        },
      },
      {
        day: "2026-11-19",
        from: "2026-11-18T15:00:00.000Z",
        to: "2026-11-19T15:00:00.000Z",
        accounts: 4,
        turns: 4,
        generation: {
          zeroAccounts: 2,
          median: 1,
          usedAccounts: 2,
          usedMedian: 3.5,
          withoutTurns: { accounts: 0, calls: 0 },
        },
      },
    ],
  });
  expect(result.basis).toContain("外部bot");
  // 当日は日の始まりから読取時点までの累計として範囲を示す。
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
    current = await read([today]);
  expect(current).not.toHaveProperty("bothDays");
  expect(current.days[0]).toMatchObject({
    from: new Date(`${today}T00:00:00+09:00`).toISOString(),
    to: current.asOf,
  });
});

test("報告枠は実際に手番を終えたユーザーと世界に属し、受領判断だけでは増えない", async () => {
  const f = await fixture(),
    g = await fixture(),
    user = f.people[0]!.id;
  f.calls.mockClear();
  await isolated.databases.postgres.query(
    "INSERT INTO world_access(subject_id,construction_id,role,actor_id) VALUES($1,$2,'player',$3)",
    [user, g.world, g.actors[0]],
  );
  for (let i = 0; i < 3; i++)
    await access.botCommand(
      user,
      g.world,
      { requestId: randomUUID(), command: "end-turn" },
      g.actors[0],
    );
  expect(await access.reportStatus(user, g.world, g.actors[0])).toMatchObject({
    turns: 3,
    available: 1,
  });
  expect(
    await access.reportStatus(g.people[0]!.id, g.world, g.actors[0]),
  ).toMatchObject({ turns: 0, available: 1 });
  expect(await access.reportStatus(user, f.world, f.actors[0])).toMatchObject({
    turns: 0,
    available: 1,
  });
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const before = await access.reportStatus(
    f.people[1]!.id,
    f.world,
    f.actors[1],
  );
  const item = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [{ id: item, kind: "existence", text: "手渡す道具" }],
        revisions: [],
        endEdges: [],
        edges: [
          {
            id: randomUUID(),
            kind: "has",
            source: f.actors[0]!,
            target: item,
            period: { from: 0 },
          },
        ],
      },
    },
  );
  const pending = await f.send(0, {
    command: "update",
    text: "道具を手渡す",
    operations: [
      {
        type: "move",
        item,
        from: f.actors[0],
        to: f.actors[1],
        basis: "受領の申請",
      },
    ],
    dependencies: [],
  });
  await f.send(1, {
    command: "receive",
    applicationId: pending.applicationId,
    accept: true,
  });
  expect(
    (await access.reportStatus(f.people[1]!.id, f.world, f.actors[1])).turns,
  ).toBe(before.turns);
  expect(f.calls).not.toHaveBeenCalled();
});

test("CLIの報告は専用枠で送り、失った返答を再送し、変更後の文字数上限も使う", async () => {
  const f = await fixture(),
    admin = await auth.person(),
    app = await createApp(access, auth.identity, undefined, auth.operations),
    cli = await playerCli(app),
    profile = join(cli.directory, "report.json");
  try {
    const connection = await cli.run(
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
          connection.userCode,
          `actor:${f.actors[0]}`,
        )
      ).statusCode,
    ).toBe(302);

    expect((await cli.run(profile, "report")).available).toBe(1);
    cli.dropNextResponse(`/api/worlds/${f.world}/reports`);
    const lost = await cli.run(
      profile,
      "report",
      "--text",
      "表示についての感想",
    );
    expect(lost.state).toBe("error");
    cli.dropNextResponse(`/api/worlds/${f.world}/session`);
    expect(await cli.run(profile, "recover")).toMatchObject({
      state: "report",
      result: { id: lost.requestId, sent: 1 },
    });
    expect((await cli.run(profile, "report")).sent).toBe(1);
    for (let i = 0; i < 5; i++) await f.send(0, { command: "end-turn" });
    expect((await cli.run(profile, "report")).available).toBe(0);
    await f.send(0, { command: "end-turn" });
    expect((await cli.run(profile, "report")).available).toBe(1);
    const policy = await auth.operations.execute(admin.id, randomUUID(), {
      operation: "reportPolicy.read",
    });
    await auth.operations.execute(admin.id, randomUUID(), {
      operation: "reportPolicy.put",
      dailyLimit: 10,
      turnsPerReport: 3,
      maxCharacters: 2400,
      expectedVersion: Number(policy.version),
      reason: "文字数上限を増やす",
    });
    const long = await cli.run(profile, "report", "--text", "あ".repeat(1201));
    expect(long.result.id).toBe(long.requestId);
    expect((await f.status(0)).callsUsed).toBe(0);
    const credentials = JSON.parse(await readFile(profile, "utf8"));
    expect(
      (await app.inject({ url: `/api/worlds/${f.world}/reports` })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: `/api/worlds/${randomUUID()}/reports`,
          headers: {
            authorization: `Bearer ${credentials.secret}`,
            ...cliVersionHeader,
          },
        })
      ).statusCode,
    ).toBe(403);
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
    answer(id, role === "world-server-npc" ? { command: "end-turn" } : sure),
  );
  await f.apply([
    { type: "locate", subjectId: npcs[2], text: "広場", aboutIds: [f.place] },
  ]);
  await access.botPlay.tickNpcs();
  expect(f.calls).not.toHaveBeenCalled();
  expect(await access.botPlay.current(f.world, npcs[2]!)).toBeUndefined();
  await f.send(0, { command: "contact", targetId: npcs[2] });
  await access.botPlay.tickNpcs();
  expect(f.calls.mock.calls.map((c) => c[1])).toEqual(["world-server-npc"]);
  expect(await access.botPlay.current(f.world, npcs[0]!)).toBeUndefined();
  await f.send(0, { command: "leave" });
  f.calls.mockClear();
  await access.botPlay.tickNpcs();
  expect(f.calls).not.toHaveBeenCalled();
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

test("作った物品は持つ人物の物になり、渡すと受け取った人物の物になる", async () => {
  const f = await fixture(),
    a = f.actors[0]!,
    b = f.actors[1]!;
  await f.send(1, { command: "contact", targetId: a });
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  const update = (text: string, operations: unknown[]) =>
    f.send(0, { command: "update", text, operations, dependencies: [] });
  const make = (label: string) => ({
    type: "create",
    label,
    holder: a,
    basis: "拾った",
  });
  const created = await update("二つの物を拾う", [
    make("木の札"),
    make("布袋"),
  ]);
  const [, bag] = created.items as { itemId: string }[];
  expect(created).toMatchObject({
    items: [
      { label: "木の札", holding: { fromId: null, toId: a } },
      { label: "布袋", holding: { fromId: null, toId: a } },
    ],
    action: {
      message: expect.stringContaining("「木の札」を手元に置きました。"),
    },
  });
  const given = await update("布袋を渡す", [
    { type: "move", item: bag!.itemId, from: a, to: b, basis: "渡す" },
  ]);
  expect(given).toMatchObject({ state: "receiving" });
  expect(
    await f.send(1, {
      command: "receive",
      applicationId: given.applicationId,
      accept: true,
    }),
  ).toMatchObject({
    items: [{ itemId: bag!.itemId, holding: { fromId: a, toId: b } }],
    action: {
      message: expect.stringContaining("「布袋」を手元に置きました。"),
    },
  });
  expect(
    await f.store
      .context(f.graph)
      .relations(bag!.itemId, "has", "in", Number.MAX_SAFE_INTEGER),
  ).toMatchObject([{ source: b }]);
  if ((await f.status(0)).actorId === a)
    await f.send(0, { command: "end-turn" });
  const entries = (await f.status(1)).entries.flatMap(
    (row: { payload: { entries?: { input: string; result: unknown }[] } }) =>
      row.payload.entries ?? [],
  );
  expect(
    entries.find(({ input }: { input: string }) => input === "二つの物を拾う")
      ?.result,
  ).toMatchObject({ items: created.items });
});

test("目撃した手渡しには対象と渡した先が残り、合流前の取得結果から参照は渡らない", async () => {
  const f = await fixture(),
    item = randomUUID(),
    bag = randomUUID(),
    key = randomUUID(),
    a = f.actors[0]!,
    b = f.actors[1]!;
  await f.store.commit(
    await f.store.claim(f.graph, key),
    f.store.context(f.graph),
    {
      commitId: key,
      at: 0,
      changes: {
        nodes: [
          { id: item, kind: "existence", text: "試験用の帯" },
          { id: bag, kind: "existence", text: "試験用の袋" },
        ],
        edges: [
          {
            id: randomUUID(),
            kind: "has",
            source: a,
            target: bag,
            period: { from: 0 },
          },
          {
            id: randomUUID(),
            kind: "has",
            source: bag,
            target: item,
            period: { from: 0 },
          },
        ],
        revisions: [],
        endEdges: [],
      },
    },
  );
  const update = (text: string, operations: unknown[]) =>
    f.send(0, { command: "update", text, dependencies: [], operations });
  const picked = await update("拾う", [
    { type: "move", from: bag, to: a, item, basis: "袋から出す" },
  ]);
  expect(picked.items).toMatchObject([
    { itemId: item, holding: { fromId: bag, toId: a } },
  ]);
  await f.send(1, { command: "contact", targetId: a });
  await f.move(2, f.place);
  await f.send(2, { command: "contact", targetId: a });
  const give = await update("渡す", [
    { type: "move", item, from: a, to: b, basis: "手渡し" },
  ]);
  expect(give.items).toBeUndefined();
  await f.send(1, {
    command: "receive",
    applicationId: give.applicationId,
    accept: true,
  });
  await f.send(0, { command: "end-turn" });
  const entries = (await f.status(2)).entries.flatMap(
    (r: { payload: { entries?: EntryRow[] } }) => r.payload.entries ?? [],
  );
  type EntryRow = { input: string; result: Record<string, unknown> };
  expect(
    entries.find((e: EntryRow) => e.input === "拾う")?.result.items,
  ).toBeUndefined();
  expect(
    entries.find((e: EntryRow) => e.input === "渡す")?.result.items,
  ).toEqual([
    {
      itemId: item,
      label: "試験用の帯",
      holding: { fromId: a, toId: b },
    },
  ]);
});
async function stealthRolls(request: string, rolls: Record<string, number>) {
  const db = isolated.databases.postgres;
  for (const [key, roll] of Object.entries(rolls))
    await db.query("INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,$3)", [
      derivedId(`${request}:stealth:${key}`),
      { sides: 6, successThrough: 3 },
      roll,
    ]);
}

function stealthGm(f: Awaited<ReturnType<typeof fixture>>) {
  f.calls.mockImplementation(async (id, role, messages) => {
    expect(role).toBe("world-stealth-dice");
    const request = JSON.parse(messages[1]!.content) as {
      checks: { key: string }[];
    };
    expect(JSON.stringify(request)).not.toContain("過去の非公開発言");
    return answer(
      id,
      Object.fromEntries(
        request.checks.map(({ key }) => [key, { sides: 6, successThrough: 3 }]),
      ),
    );
  });
}

test("非戦闘地域のスリは成否と目撃を別に判定し、未発見者と後からの合流者のログに痕跡を残さない", async () => {
  const f = await fixture();
  const [a, b, c] = f.actors as [string, string, string];
  await isolated.databases.postgres.query(
    "UPDATE world_construction SET non_combat_areas=$2 WHERE id=$1",
    [f.world, JSON.stringify([{ rootId: f.place, memberPlaceIds: [] }])],
  );
  await f.apply([
    { type: "create", holder: b, label: "銀貨", count: 3, basis: "財布の中身" },
  ]);
  const coin = (await readBelongings(f.store.context(f.graph), b)).items.find(
    (item) => item.label === "銀貨",
  )!.id;
  const held = async (actor: string) =>
    (await readBelongings(f.store.context(f.graph), actor)).items.find(
      (item) => item.label === "銀貨",
    )?.count ?? 0;
  await f.send(1, { command: "contact", targetId: a });
  await f.move(2, f.place);
  await f.send(0, { command: "say", text: "過去の非公開発言" });
  await f.send(0, { command: "end-turn" });
  await f.send(1, { command: "end-turn" });
  stealthGm(f);
  const before = (await f.status(1)).entries.length;
  const graphHistory = vi.spyOn(
    Object.getPrototypeOf(f.store.context(f.graph)) as ReturnType<
      typeof f.store.context
    >,
    "history",
  );
  const attempt = (requestId: string, text: string) =>
    f.send(0, {
      requestId,
      command: "apply",
      expectedSp: 1,
      dependencies: [],
      action: {
        type: "seize",
        text,
        stealth: true,
        operation: {
          type: "move",
          item: coin,
          from: b,
          to: a,
          count: 1,
          basis: text,
        },
      },
    });
  const successId = randomUUID(),
    failId = randomUUID();
  await stealthRolls(successId, {
    action: 1,
    ["attempt:" + b]: 6,
    ["attempt:" + c]: 1,
  });
  await stealthRolls(failId, {
    action: 6,
    ["attempt:" + b]: 6,
    ["attempt:" + c]: 1,
  });
  const success = await attempt(successId, "財布を抜く動機");
  expect(success.outcome).toEqual({ success: true });
  expect(JSON.stringify(success)).not.toContain("目撃");
  expect(await attempt(successId, "財布を抜く動機")).toEqual(success);
  expect((await attempt(failId, "失敗した試みの原文")).outcome).toEqual({
    success: false,
  });
  expect(f.calls).toHaveBeenCalledTimes(2);
  expect(graphHistory).not.toHaveBeenCalled();
  graphHistory.mockRestore();
  expect(await held(a)).toBe(1);
  expect(await held(b)).toBe(2);
  for (const person of [a, b])
    expect(
      JSON.stringify(await readBelongings(f.store.context(f.graph), person)),
    ).not.toContain("財布を抜く動機");
  expect((await f.status(1)).entries.slice(before)).toEqual([]);
  const reconnected = await access.botStatus(
    f.people[1]!.id,
    f.world,
    b,
    undefined,
    `human:reconnect:${randomUUID()}`,
  );
  expect(reconnected.entries.slice(before)).toEqual([]);
  // Cが自分の手番中に目撃し、確認せずに手番を終えても次の起床で読める。
  await f.send(2, { command: "end-turn" });
  const wake = await access.waiting(
    f.people[2]!.id,
    f.world,
    c,
    undefined,
    undefined,
    true,
    true,
  );
  expect(wake.context?.observations).toEqual([
    "人物0が人物1から銀貨1個を取った",
    "人物0が人物1の銀貨に手を伸ばした",
  ]);
  const seen = JSON.stringify((await f.status(2)).entries);
  for (const secret of [
    coin,
    successId,
    failId,
    "財布を抜く動機",
    "失敗した試みの原文",
    "successThrough",
  ])
    expect(seen).not.toContain(secret);
  await f.move(2, f.far);
  const unwitnessed = randomUUID();
  await stealthRolls(unwitnessed, { action: 6, ["attempt:" + b]: 6 });
  const beforeJoin = (await f.status(2)).entries.length;
  await attempt(unwitnessed, "誰にも見られなかった原文");
  await f.move(2, f.place);
  await f.send(2, { command: "contact", targetId: a });
  await f.send(0, { command: "end-turn" });
  const late = (await f.status(2)).entries.slice(beforeJoin);
  expect(
    late
      .flatMap((row) => row.payload.entries ?? [])
      .map((entry) => entry.input),
  ).toEqual(["人物0に接触する"]);
  expect(JSON.stringify(late)).not.toContain("誰にも見られなかった原文");
  const victim = (await f.status(1)).entries
    .slice(before)
    .filter(
      (row) => row.payload.turn !== undefined || row.payload.entries?.length,
    );
  expect(victim).toHaveLength(1);
  expect(victim[0]!.payload).toMatchObject({
    entries: [],
    transition: { publicActivity: false },
  });
  await f.send(1, { command: "end-turn" });
  await f.send(2, { command: "say", text: "人物0が銀貨を取るのを見たよ" });
  await f.send(2, { command: "end-turn" });
  expect(JSON.stringify((await f.status(1)).entries.slice(before))).toContain(
    "人物0が銀貨を取るのを見たよ",
  );
});

test("隠密中の対抗行動は所持・負傷・死亡を確定し、行為の目撃者だけに主体を伝える", async () => {
  const f = await fixture(4);
  const [actor, victim, witness, late] = f.actors as [
    string,
    string,
    string,
    string,
  ];
  await f.move(0, f.far);
  await f.move(2, f.place);
  await f.move(3, f.far);
  const coin = (
    await f.apply([
      {
        type: "create",
        holder: victim,
        label: "銀貨",
        count: 3,
        basis: "初期所持",
      },
    ])
  ).changes.nodes[0]!.id;
  const cause = (
    await f.apply([
      { type: "create", holder: actor, label: "霧トカゲ", basis: "初期所持" },
    ])
  ).changes.nodes[0]!.id;
  stealthGm(f);
  const arrival = randomUUID();
  await stealthRolls(arrival, {
    ["departure:" + late]: 6,
    ["arrival:" + victim]: 1,
    ["arrival:" + witness]: 6,
  });
  expect(
    await f.send(0, {
      requestId: arrival,
      command: "update",
      stealth: true,
      text: "隠密で広場へ行く",
      operations: [
        { type: "locate", subjectId: actor, text: "広場", aboutIds: [f.place] },
      ],
      dependencies: [],
    }),
  ).toMatchObject({ stealth: { placeId: f.place } });
  expect(JSON.stringify((await f.status(1)).entries)).toContain(
    "人物0が広場に着いた",
  );
  await f.send(1, { command: "contact", targetId: actor });

  const attempt = async (
    text: string,
    fields: Record<string, unknown>,
    publicState?: string,
    fatal = false,
  ) => {
    const requestId = randomUUID();
    const input = {
      requestId,
      command: "oppose",
      text,
      ...fields,
      dependencies: [],
    };
    await stealthRolls(requestId, {
      ["attempt:" + victim]: 6,
      ["attempt:" + witness]: 1,
    });
    // 相手に残る負傷はGMが返す。申請者が変更に書いた相手の状態は記録されない。
    const setting = {
      ...sure,
      ...(fatal ? { fatal: [victim] } : {}),
      ...(publicState ? { states: [{ id: victim, text: publicState }] } : {}),
    };
    await isolated.databases.postgres.query(
      "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,1)",
      [requestId, setting],
    );
    f.calls.mockImplementation(async (id, role, messages) => {
      if (role === "world-creation-dice") return answer(id, sure);
      expect(role).toBe("world-opposition-dice");
      const { perception } = JSON.parse(messages[1]!.content) as {
        perception: { states: string[]; about: string[]; observers: string[] };
      };
      expect(perception.observers).toEqual([victim, witness].sort());
      return answer(id, {
        ...setting,
        perception: {
          states: Object.fromEntries(
            perception.states.map((state) => [state, publicState!]),
          ),
          about: [],
          observation: text,
          witnesses: Object.fromEntries(
            perception.observers.map((viewer) => [
              viewer,
              { sides: 6, successThrough: 3 },
            ]),
          ),
        },
      });
    });
    if (fatal) {
      const commit = f.store.commit.bind(f.store);
      const interrupted = vi
        .spyOn(f.store, "commit")
        .mockImplementationOnce(async (...args) => {
          await commit(...args);
          throw new Error("世界の確定後に接続が切れた");
        });
      await expect(f.send(0, input)).rejects.toThrow(
        "世界の確定後に接続が切れた",
      );
      interrupted.mockRestore();
    }
    const result = await f.send(0, input);
    expect(result.outcome).toMatchObject({ success: true });
    expect(await f.send(0, input)).toEqual(result);
  };
  const before = (await f.status(1)).entries.length;
  const theft = "人物0が銀貨を取った";
  await attempt(theft, {
    operations: [
      {
        type: "move",
        item: coin,
        from: victim,
        to: actor,
        count: 1,
        basis: theft,
      },
    ],
  });
  const inventory = await access.botPlay.search(f.world, victim, {
    kind: "self",
  });
  expect(inventory.material).toMatchObject({
    belongings: { items: [{ id: coin, label: "銀貨", count: 2 }] },
  });
  expect(JSON.stringify(inventory.material)).not.toContain(theft);
  const stolen = await readBelongings(f.store.context(f.graph), actor);
  expect(stolen.items).toContainEqual(
    expect.objectContaining({ label: "銀貨", count: 1 }),
  );
  expect(JSON.stringify(stolen)).not.toContain(theft);

  const wound: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  const wounded = "霧トカゲが襲い、腕に深い傷がある";
  mark(wound, victim, wounded, [{ id: cause }, { id: actor }]);
  await attempt(wounded, { changes: wound }, "腕に深い傷がある");
  await f.send(0, { command: "end-turn" });
  const examine = async (i: number) =>
    JSON.stringify(
      (
        await f.send(i, {
          command: "search",
          query: {
            kind: i === 1 ? "self" : "subject",
            ...(i === 1 ? {} : { targetId: victim }),
          },
        })
      ).material,
    );
  expect(await examine(1)).toContain("腕に深い傷がある");
  await f.send(1, { command: "end-turn" });
  await f.move(3, f.place);
  const woundSeenLate = await examine(3);
  expect(woundSeenLate).toContain("腕に深い傷がある");
  for (const secret of ["霧トカゲ", cause, actor])
    expect(woundSeenLate).not.toContain(secret);
  await f.move(3, f.far);

  await isolated.databases.postgres.query(
    "UPDATE world_construction SET death_place_id=$2 WHERE id=$1",
    [f.world, f.far],
  );
  const killed = "霧トカゲが致命傷を負わせた";
  await attempt(
    killed,
    {
      operations: [
        {
          type: "move",
          item: coin,
          from: victim,
          to: actor,
          count: 1,
          basis: killed,
        },
      ],
    },
    "致命傷を負って死亡している",
    true,
  );
  expect((await f.status(1)).members?.map((member) => member.actorId)).toEqual([
    victim,
  ]);
  expect(await directPlaces(f.store.context(f.graph), victim)).toEqual([f.far]);
  // 死亡は復帰として扱い、判定で付いた負傷も死亡で付いた状態も現在の状態に残さない。
  const after = await examine(3);
  expect(after).not.toContain("腕に深い傷がある");
  expect(after).not.toContain("致命傷を負って死亡している");
  for (const secret of ["霧トカゲ", cause, actor])
    expect(after).not.toContain(secret);
  const victimHistory = JSON.stringify(
    (await f.status(1)).entries.slice(before),
  );
  const witnessHistory = JSON.stringify((await f.status(2)).entries);
  const lateHistory = JSON.stringify((await f.status(3)).entries);
  for (const action of [theft, wounded, killed]) {
    expect(victimHistory).not.toContain(action);
    expect(lateHistory).not.toContain(action);
    expect(witnessHistory.match(new RegExp(action, "g"))).toHaveLength(2); // 本文と目撃欄
  }
});

test("隠密対抗は非戦闘地域で抽選せず、保護外では確定結果を匿名で伝える", async () => {
  const f = await fixture();
  const [actor, target, witness] = f.actors as [string, string, string];
  const db = isolated.databases.postgres;
  await db.query(
    "UPDATE world_construction SET non_combat_areas=$2 WHERE id=$1",
    [f.world, JSON.stringify([{ rootId: f.place, memberPlaceIds: [] }])],
  );
  await f.move(0, f.far);
  await f.move(2, f.place);
  stealthGm(f);
  const arrival = randomUUID();
  await stealthRolls(arrival, {
    ["arrival:" + target]: 1,
    ["arrival:" + witness]: 6,
  });
  await f.send(0, {
    command: "apply",
    requestId: arrival,
    expectedSp: 0,
    dependencies: [],
    action: {
      type: "direct",
      text: "隠密で広場へ行く",
      stealth: true,
      operations: [
        { type: "locate", subjectId: actor, text: "広場", aboutIds: [f.place] },
      ],
    },
  });
  await f.send(1, { command: "contact", targetId: actor });
  await giveTurn(f, 0);

  const proposed = "人物0が左手を切り落とした";
  const alleged = "左手が床に落ちた";
  const damage = "左手を欠損している";
  const actual = "左腕に薄い擦り傷がある";
  const input = {
    command: "apply",
    requestId: randomUUID(),
    expectedSp: 1,
    dependencies: [],
    action: {
      type: "oppose",
      targetId: target,
      text: proposed,
      description: damage,
    },
  };
  f.calls.mockClear();
  const before = await f.status(0);
  await expect(f.send(0, input)).rejects.toMatchObject({
    code: "NON_COMBAT_AREA",
  });
  expect(f.calls).not.toHaveBeenCalled();
  expect((await f.status(0)).dailySp).toEqual(before.dailySp);
  expect(await f.store.receipt(f.graph, input.requestId)).toBeUndefined();
  expect(
    (await f.status(2)).entries.some((row) => row.payload.observation),
  ).toBe(false);
  await db.query(
    "UPDATE world_construction SET non_combat_areas='[]' WHERE id=$1",
    [f.world],
  );

  const requestId = randomUUID();
  const unprotected = { ...input, requestId };
  const setting = { sides: 6, successThrough: 3 };
  const injurySetting = {
    ...setting,
    states: [{ id: target, text: actual }],
  };
  await db.query("INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,1)", [
    requestId,
    injurySetting,
  ]);
  await stealthRolls(requestId, {
    ["attempt:" + target]: 6,
    ["attempt:" + witness]: 1,
  });
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-opposition-dice");
    const { affected, perception } = JSON.parse(messages[1]!.content) as {
      affected?: string[];
      perception: { states: string[]; observers: string[] };
    };
    expect(affected).toEqual([target]);
    expect(perception.observers).toContain(witness);
    return answer(id, {
      ...injurySetting,
      perception: {
        states: Object.fromEntries(
          perception.states.map((id) => [id, alleged]),
        ),
        about: [],
        observation: alleged,
        witnesses: Object.fromEntries(
          perception.observers.map((id) => [id, setting]),
        ),
      },
    });
  });

  const commit = f.store.commit.bind(f.store);
  const interrupted = vi
    .spyOn(f.store, "commit")
    .mockImplementationOnce(async (...args) => {
      await commit(...args);
      throw new Error("世界の確定後に接続が切れた");
    });
  await expect(f.send(0, unprotected)).rejects.toThrow(
    "世界の確定後に接続が切れた",
  );
  interrupted.mockRestore();
  const result = await f.send(0, unprotected);
  expect(result).toMatchObject({
    outcome: { success: true, roll: 1 },
    action: { message: expect.stringContaining(actual) },
  });
  expect(await f.send(0, unprotected)).toEqual(result);

  const records = (await f.status(2)).entries;
  const observed = records
    .flatMap((row) => row.payload.entries ?? [])
    .find((entry: { label?: string }) => entry.label === "目撃");
  expect(observed).toMatchObject({
    actorId: witness,
    input: expect.stringContaining(actual),
  });
  expect(observed?.input).toBeTruthy();
  expect(JSON.stringify(observed)).not.toContain(actor);
  expect(JSON.stringify(observed)).not.toContain("人物0");

  const receipt = await f.store.receipt(f.graph, requestId);
  expect(receipt?.changes.nodes).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "event" })]),
  );
  expect(receipt?.changes.edges).toContainEqual(
    expect.objectContaining({ kind: "status", source: target, text: "judged" }),
  );
  const views = JSON.stringify([
    result,
    receipt?.changes,
    records,
    (await f.status(0)).entries,
  ]);
  for (const falseResult of [proposed, alleged, damage])
    expect(views).not.toContain(falseResult);
});

test("対抗申請の応答と公開記録には成否に応じてGMが確定した状態だけが載る", async () => {
  const f = await fixture(2);
  const [actor, target] = f.actors as [string, string];
  await f.send(1, { command: "contact", targetId: actor });
  await giveTurn(f, 0);
  const proposed = "相手の右手を切り落とした";
  const description = "右手を欠損している";
  const strike = async (roll: number, state: string) => {
    const requestId = randomUUID();
    const setting = {
      sides: 6,
      successThrough: 3,
      states: [{ id: target, text: state }],
    };
    await isolated.databases.postgres.query(
      "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,$3)",
      [requestId, setting, roll],
    );
    f.calls.mockImplementationOnce(async (id, role) => {
      expect(role).toBe("world-opposition-dice");
      return answer(id, setting);
    });
    const result = await f.send(0, {
      command: "apply",
      requestId,
      expectedSp: 1,
      dependencies: [],
      action: { type: "oppose", targetId: target, text: proposed, description },
    });
    await giveTurn(f, 1);
    const entry = (await f.status(1)).entries
      .flatMap((row) => row.payload.entries ?? [])
      .find(
        (entry: { result?: { commitId?: string } }) =>
          entry.result?.commitId === requestId,
      );
    const receipt = await f.store.receipt(f.graph, requestId);
    expect(entry).toBeDefined();
    expect(receipt?.changes.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "event" })]),
    );
    const presentation = JSON.stringify([
      result.action,
      result.effectState,
      entry?.input,
      entry?.result.effectState,
      receipt?.changes.nodes,
    ]);
    expect(presentation).not.toContain(proposed);
    expect(presentation).not.toContain(description);
    return { result, entry, presentation, receipt };
  };

  const actual = "右手の甲に浅い擦り傷がある";
  const success = await strike(1, actual);
  expect(success.result).toMatchObject({
    outcome: { success: true, roll: 1 },
    action: { message: expect.stringContaining(actual) },
  });
  expect(
    JSON.stringify([success.entry?.input, success.entry?.result.effectState]),
  ).toContain(actual);
  expect(success.receipt?.changes.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "script", text: actual }),
    ]),
  );
  expect(success.receipt?.changes.nodes).toContainEqual(
    expect.objectContaining({
      kind: "event",
      text: expect.stringContaining(actual),
    }),
  );

  await giveTurn(f, 0);
  const conditional = "右手の指を動かせない";
  const failure = await strike(6, conditional);
  expect(failure.result).toMatchObject({
    outcome: { success: false, roll: 6 },
    action: { message: expect.stringContaining("失敗") },
  });
  expect(failure.presentation).not.toContain(conditional);
  expect(failure.receipt?.changes.edges).not.toContainEqual(
    expect.objectContaining({ kind: "status", source: target, text: "judged" }),
  );
});

test("隠密移動の現在地は今回の滞在を発見した相手だけが取得できる", async () => {
  const f = await fixture();
  const [a, b, c] = f.actors as [string, string, string];
  await f.send(1, { command: "contact", targetId: a });
  const db = isolated.databases.postgres;
  const warehouse = randomUUID();
  const setup = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, setup),
    f.store.context(f.graph),
    {
      commitId: setup,
      at: 0,
      changes: {
        nodes: [{ id: warehouse, kind: "existence", text: "倉庫" }],
        edges: [],
        revisions: [],
        endEdges: [],
      },
    },
  );
  await db.query("UPDATE world_construction SET player_list=true WHERE id=$1", [
    f.world,
  ]);
  const offer = await f.friend(0, {
    requestId: randomUUID(),
    action: "propose",
    targetId: c,
  });
  await f.friend(2, {
    requestId: randomUUID(),
    action: "accept",
    offerId: offer.offerId,
  });
  stealthGm(f);
  const move = async (place: string, roll: number, observer?: string) => {
    const requestId = randomUUID();
    if (observer)
      await stealthRolls(requestId, {
        ["departure:" + observer]: roll,
        ["arrival:" + observer]: roll,
      });
    return f.send(0, {
      requestId,
      command: "update",
      stealth: true,
      dependencies: [],
      text: "密かに移動する",
      operations: [
        { type: "locate", subjectId: a, text: "滞在先", aboutIds: [place] },
      ],
    });
  };
  const first = randomUUID();
  await stealthRolls(first, { ["departure:" + b]: 1, ["arrival:" + c]: 6 });
  const listed = async (viewer: string) =>
    (await access.botPlay.players(f.world, viewer)).items.find(
      (entry) => entry.actorId === a,
    );
  const firstMove = () =>
    f.send(0, {
      requestId: first,
      command: "update",
      stealth: true,
      dependencies: [],
      text: "移動を隠す原文",
      operations: [
        { type: "locate", subjectId: a, text: "滞在先", aboutIds: [f.far] },
      ],
    });
  const commit = f.store.commit.bind(f.store);
  const interrupted = vi
    .spyOn(f.store, "commit")
    .mockImplementationOnce(async (...args) => {
      await commit(...args);
      throw new Error("世界の確定直後に応答が途切れた");
    });
  await expect(firstMove()).rejects.toThrow("世界の確定直後に応答が途切れた");
  interrupted.mockRestore();
  expect(await listed(c)).toMatchObject({
    name: "人物0",
    placeId: null,
    place: null,
  });
  expect(await listed(b)).toBeUndefined();
  expect(await firstMove()).toMatchObject({ stealth: { placeId: f.far } });
  expect((await f.status(0)).stealth).toMatchObject({ placeId: f.far });
  const departure = JSON.stringify((await f.status(1)).entries);
  expect(departure).toContain("人物0が広場を出た");
  expect(departure).not.toContain(f.far);
  expect(departure).not.toContain("移動を隠す原文");
  expect(await listed(c)).toMatchObject({
    name: "人物0",
    placeId: null,
    place: null,
  });
  const subject = () =>
    f.send(2, { command: "search", query: { kind: "subject", targetId: a } });
  const surroundings = () =>
    f.send(2, { command: "search", query: { kind: "surroundings" } });
  const contact = () => f.send(2, { command: "contact", targetId: a });
  expect(JSON.stringify(await surroundings())).not.toContain(a);
  const hiddenMaterial = (await subject()).material;
  expect(hiddenMaterial).toMatchObject({ locations: [] });
  expect(JSON.stringify(hiddenMaterial)).not.toContain(f.far);
  await expect(contact()).rejects.toMatchObject({ code: "CONTACT_MISMATCH" });
  expect(f.calls).toHaveBeenCalledTimes(1);
  const seek = (requestId = randomUUID()) =>
    f.send(2, { requestId, command: "search", query: { kind: "seek" } });
  const status = await f.status(2);
  const session = status.sessionId!,
    turn = status.turn!;
  const stay = (
    await db.query("SELECT id FROM bot_stealth WHERE actor_id=$1", [a])
  ).rows[0].id;
  const setSeek = async (number: number, roll: number) => {
    await db.query("INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,$3)", [
      derivedId(`${session}:${number}:seek:${stay}`),
      { sides: 6, successThrough: 3 },
      roll,
    ]);
  };
  await setSeek(turn, 6);
  const request = randomUUID(),
    missed = await seek(request);
  expect(missed.found).toEqual([]);
  expect(await seek(request)).toEqual(missed);
  expect((await seek()).found).toEqual([]);
  expect(f.calls).toHaveBeenCalledTimes(2);
  await f.send(2, { command: "end-turn" });
  await setSeek(turn + 1, 1);
  expect((await seek()).found).toEqual([{ actorId: a, name: "人物0" }]);
  expect(await listed(c)).toMatchObject({ placeId: f.far });
  expect((await subject()).material).toMatchObject({
    locations: [{ directPlaceId: f.far }],
  });
  // A leaves and returns to the same place without being found on either arrival.
  expect(await move(warehouse, 6, c)).toMatchObject({
    stealth: { placeId: warehouse },
  });
  expect(await listed(c)).toMatchObject({ placeId: null });
  expect(JSON.stringify((await subject()).material)).not.toContain(warehouse);
  expect(await move(f.far, 6, c)).toMatchObject({
    stealth: { placeId: f.far },
  });
  expect(await listed(c)).toMatchObject({ placeId: null });
  await expect(contact()).rejects.toMatchObject({ code: "CONTACT_MISMATCH" });
  expect(await f.send(0, { command: "contact", targetId: c })).toMatchObject({
    contact: "joined",
  });
  expect(await listed(c)).toMatchObject({ placeId: f.far });
});

test("同じ場所のチームメンバーでも隠密移動を発見するまで自動合流しない", async () => {
  const f = await fixture();
  const [a, b, c] = f.actors as [string, string, string];
  await f.send(1, { command: "contact", targetId: a });
  const teamId = randomUUID();
  await f.send(0, { requestId: teamId, command: "team-invite", targetId: b });
  await f.send(1, { command: "team-join", teamId });
  stealthGm(f);
  const travel = (actor: string) => ({
    command: "update",
    text: "移動する",
    dependencies: [],
    operations: [
      {
        type: "locate",
        subjectId: actor,
        text: "離れた場所",
        aboutIds: [f.far],
      },
    ],
  });
  const request = randomUUID();
  await stealthRolls(request, { ["departure:" + b]: 6, ["arrival:" + c]: 6 });
  const hidden = await f.send(0, {
    ...travel(a),
    requestId: request,
    stealth: true,
  });
  const followed = await f.send(1, travel(b));
  expect(followed.sessionId).not.toBe(hidden.sessionId);
  expect(followed.teamArrival).toBeUndefined();
  const follower = await f.status(1);
  expect(JSON.stringify(follower.entries)).not.toContain("別の場所にいるため");
  expect(JSON.stringify(follower.entries)).not.toContain(hidden.sessionId);
  await expect(
    f.send(1, { command: "contact", targetId: a }),
  ).rejects.toMatchObject({ code: "CONTACT_MISMATCH" });
  const db = isolated.databases.postgres;
  const stay = (
    await db.query("SELECT id FROM bot_stealth WHERE actor_id=$1", [a])
  ).rows[0].id;
  await db.query("INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,1)", [
    derivedId(`${follower.sessionId}:${follower.turn}:seek:${stay}`),
    { sides: 6, successThrough: 3 },
  ]);
  expect(
    await f.send(1, { command: "search", query: { kind: "seek" } }),
  ).toMatchObject({
    found: [{ actorId: a, name: "人物0" }],
  });
  expect((await f.status(1)).sessionId).toBe((await f.status(0)).sessionId);
  expect(JSON.stringify((await f.status(1)).entries)).toContain(
    "離れた場所で人物0を見つけた",
  );
  expect(JSON.stringify((await f.status(0)).entries)).not.toContain(
    "離れた場所で人物0を見つけた",
  );
});

test("対抗と本人の状態変更は一度の判断で該当する関係だけを終了し、再送と失敗では重ねて変えない", async () => {
  const f = await fixture(2);
  const [actor, target] = f.actors as [string, string];
  const emptyChange = (): Change => ({
    nodes: [],
    edges: [],
    revisions: [],
    endEdges: [],
  });
  const seed = emptyChange();
  mark(seed, target, "袖に青い刺繍がある");
  mark(seed, target, "旗を掲げている", [{ id: f.place }]);
  const [profile, raised, about] = seed.edges.map((e) => e.id) as [
    string,
    string,
    string,
  ];
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: seed,
    },
  );
  await f.send(1, { command: "contact", targetId: actor });
  const active = async (edge: string) =>
    (await f.store.context(f.graph).edge(edge))?.period.until === undefined;
  const binding = emptyChange();
  mark(binding, target, "手首に旗の紐が絡んでいる", [{ id: f.place }]);
  binding.edges.push({
    id: randomUUID(),
    kind: "effect",
    source: actor,
    target,
    period: { from: 0 },
  });
  const bound = binding.edges[0]!.id;
  const bind = {
    command: "oppose",
    requestId: randomUUID(),
    text: "旗を引き下ろして相手の手首に紐を絡ませる",
    changes: binding,
    dependencies: [],
  };
  // 相手に残る状態はGMが返したものだけ。申請者が変更に書いた相手の状態は記録しない。
  const tied = "手首に旗の紐がきつく絡んでいる";
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-opposition-dice");
    expect(messages[0]!.content).toContain("死亡はfatalでだけ表す");
    expect(messages[1]!.content).toContain(raised);
    return answer(id, {
      ...sure,
      endEdges: [raised],
      states: [{ id: target, text: tied }],
    });
  });
  const applied = await f.send(0, bind);
  expect(applied.outcome).toMatchObject({ success: true });
  expect(await f.send(0, bind)).toEqual(applied);
  expect(await active(raised)).toBe(false);
  expect(await active(about)).toBe(false);
  expect(await f.store.context(f.graph).edge(bound)).toBeUndefined();
  expect(
    await f.store.context(f.graph).node(binding.nodes[0]!.id),
  ).toBeUndefined();
  const gmState = derivedId(`${bind.requestId}:state:${target}`),
    tiedEdge = derivedId(`${gmState}:content`);
  expect(await f.store.context(f.graph).node(gmState)).toMatchObject({
    text: tied,
  });
  expect(f.calls).toHaveBeenCalledTimes(1);
  await f.send(0, { command: "end-turn" });

  for (const roll of [6, 1]) {
    const changes = emptyChange(),
      requestId = randomUUID();
    mark(changes, target, "手首を自由に動かせる");
    // 申請者は誤って刺繍の関係を指定。GMには両方の本文と関係IDを渡す。
    changes.endEdges.push(profile);
    f.calls.mockImplementationOnce(
      async (id, role, messages, _target, _effort, _try, validate) => {
        expect(role).toBe("world-creation-dice");
        const input = JSON.parse(messages[1]!.content);
        expect(input.allowApply).toBe(true);
        expect(input.nodes[0].states).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              relationId: profile,
              node: expect.objectContaining({ text: "袖に青い刺繍がある" }),
            }),
            expect.objectContaining({
              relationId: tiedEdge,
              node: expect.objectContaining({ text: tied }),
            }),
          ]),
        );
        expect(() =>
          validate!(JSON.stringify({ apply: true, endEdges: [raised] })),
        ).toThrow();
        const setting = { sides: 6, successThrough: 3, endEdges: [tiedEdge] };
        await isolated.databases.postgres.query(
          "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,$3)",
          [derivedId(requestId + ":creation"), setting, roll],
        );
        return answer(id, setting);
      },
    );
    const update = {
      command: "update",
      requestId,
      text: "旗の紐をほどいて手首を自由にする",
      changes,
      dependencies: [],
    };
    const result = await f.send(1, update);
    const success = roll === 1;
    expect(result.outcome).toMatchObject({ success, roll });
    expect(result.spentSp).toBe(1);
    expect(await f.send(1, update)).toEqual(result);
    expect(await active(profile)).toBe(true);
    expect(await active(tiedEdge)).toBe(!success);
    if (success)
      expect(
        (await f.store.context(f.graph).edge(tiedEdge))?.period.until,
      ).toBe(
        (await f.store.context(f.graph).edge(changes.edges[0]!.id))?.period
          .from,
      );
    expect(!!(await f.store.context(f.graph).node(changes.nodes[0]!.id))).toBe(
      success,
    );
  }
  expect(f.calls).toHaveBeenCalledTimes(3);
});

test("成立済みの変化の反映は対象と成功記録を照合し、SP残量がなくても再抽選しない", async () => {
  const f = await fixture(1),
    actor = f.actors[0]!;
  await isolated.databases.postgres.query(
    "UPDATE world_construction SET state='finished' WHERE id=$1",
    [f.world],
  );
  const changes: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  mark(changes, actor, "足首に蔓が巻き付いている");
  const old = changes.edges[0]!.id;
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      at: 0,
      commitId: randomUUID(),
      changes,
    },
  );
  // 解除の結果だけが付与され、以前の状態も有効なままの保存記録。
  const resultState: Change = {
    nodes: [],
    revisions: [],
    edges: [],
    endEdges: [],
  };
  mark(resultState, actor, "蔓はほどけて足首が自由になった");
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  const freed = await f.send(0, {
    command: "update",
    text: "足首の蔓をほどいた",
    dependencies: [],
    changes: resultState,
  });
  expect(freed.outcome).toMatchObject({ success: true });
  const sp = await access.botPlay.dailySp(f.world, f.people[0]!.id);
  await isolated.databases.postgres.query(
    "INSERT INTO bot_request(id,actor_id,world_id,hash,sp_user,sp_reset) SELECT gen_random_uuid(),$1,$2,'state-review',$3,$4 FROM generate_series(1,$5::int)",
    [actor, f.world, f.people[0]!.id, sp.resetsAt, sp.remaining],
  );
  const update = {
    command: "update",
    requestId: randomUUID(),
    text: "足首に残った古い拘束の記録を終える",
    changes: { nodes: [], revisions: [], edges: [], endEdges: [old] },
    dependencies: [],
  };
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    // Responses API の JSON モードでは、入力に「JSON」がないとトークン計数で拒否される。
    expect(messages[0]!.content).toMatch(/json/i);
    const input = JSON.parse(messages[1]!.content);
    expect(input).toMatchObject({
      states: [{ relationId: old, text: "足首に蔓が巻き付いている" }],
      confirmed: { states: [{ text: "蔓はほどけて足首が自由になった" }] },
    });
    expect(input).not.toHaveProperty("nodes");
    return answer(id, { apply: true, endEdges: [old] });
  });
  const done = await f.send(0, update);
  expect(done).toMatchObject({
    outcome: { success: true, endEdges: [old] },
    spentSp: 0,
  });
  expect(done.outcome).not.toHaveProperty("roll");
  expect(await f.send(0, update)).toEqual(done);
  expect(
    (await f.store.context(f.graph).edge(old))?.period.until,
  ).toBeDefined();
  expect(f.calls).toHaveBeenCalledTimes(2);
});

test("状態の審査後に確定が中断したとき、別の状態になった対象に以前の判断を適用しない", async () => {
  const f = await fixture(1),
    actor = f.actors[0]!;
  const change: Change = { nodes: [], edges: [], revisions: [], endEdges: [] };
  mark(change, actor, "靴紐がほどけている");
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    { commitId: randomUUID(), at: 0, changes: change },
  );
  const edge = change.edges[0]!.id;
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { apply: true, endEdges: [edge] }),
  );
  const update = {
    command: "update",
    requestId: randomUUID(),
    text: "結び直したので古い状態を終える",
    dependencies: [],
    changes: { nodes: [], edges: [], revisions: [], endEdges: [edge] },
  };
  const stop = vi
    .spyOn(f.store, "commit")
    .mockRejectedValueOnce(new Error("状態の確定前に中断"));
  await expect(f.send(0, update)).rejects.toThrow("状態の確定前に中断");
  stop.mockRestore();
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 1,
      changes: {
        nodes: [],
        edges: [],
        revisions: [{ ...change.nodes[0]!, text: "靴紐が切れている" }],
        endEdges: [],
      },
    },
  );
  await expect(f.send(0, update)).rejects.toMatchObject({
    code: "WORLD_CHANGED",
  });
  expect(
    (await f.store.context(f.graph).edge(edge))?.period.until,
  ).toBeUndefined();
  expect(f.calls).toHaveBeenCalledTimes(1);
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
  const emptyOpposition = await f.send(0, {
    command: "oppose",
    text: "作用先のない試み",
    changes: { nodes: [], edges: [], revisions: [], endEdges: [] },
    dependencies: [],
  });
  expect(emptyOpposition.outcome).toMatchObject({ success: false });
  const missingRelation = await f.send(0, {
    command: "oppose",
    text: "存在しない使用権の取り消し",
    dependencies: [],
    operations: [{ type: "revoke", person: f.actors[0], storage: items[0] }],
  });
  expect(missingRelation.outcome).toMatchObject({ success: false });
  expect((await attempt(items[1]!, f.actors[2]!)).outcome).toMatchObject({
    success: false,
  });
  expect((await attempt(items[0]!, f.actors[0]!)).outcome).toMatchObject({
    success: true,
  });
  expect(f.calls).not.toHaveBeenCalled();
  for (const [since, text] of [
    [1, "両腕が蔓に絡まっている"],
    [2, "蔓がほどけて両腕を動かせる"],
  ] as const) {
    const changes: Change = {
      nodes: [],
      edges: [],
      revisions: [],
      endEdges: [],
    };
    mark(changes, f.actors[0]!, text);
    changes.edges[0]!.period.from = since;
    await f.store.commit(
      await f.store.claim(f.graph, randomUUID()),
      f.store.context(f.graph),
      {
        commitId: randomUUID(),
        at: since,
        changes,
      },
    );
  }
  f.calls.mockImplementation(async (id) =>
    answer(id, { sides: 6, successThrough: 3 }),
  );
  const requestId = randomUUID(),
    uncertain = await attempt(items[1]!, f.actors[1]!, requestId);
  const [, , messages] = f.calls.mock.calls[0]!;
  expect(messages[0]!.content).toContain("since）が新しい記述");
  expect(JSON.parse(messages[1]!.content).materials[0].states).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        since: 1,
        node: expect.objectContaining({ text: "両腕が蔓に絡まっている" }),
      }),
      expect.objectContaining({
        since: 2,
        node: expect.objectContaining({ text: "蔓がほどけて両腕を動かせる" }),
      }),
    ]),
  );
  expect((uncertain.outcome as { roll: number }).roll).toBeGreaterThan(0);
  expect(await attempt(items[1]!, f.actors[1]!, requestId)).toEqual(uncertain);
  expect(f.calls).toHaveBeenCalledTimes(1);
  const equipment = await f.store.context(f.graph).node(items[0]!);
  const damage = await f.send(0, {
    command: "oppose",
    text: "自分の道具を変形させる",
    dependencies: [],
    changes: {
      nodes: [],
      edges: [],
      endEdges: [],
      revisions: [{ ...equipment, text: "変形した道具" }],
    },
  });
  expect(damage.outcome).toHaveProperty("roll");
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT count(*)::int AS n FROM bot_dice WHERE id=$1",
        [requestId],
      )
    ).rows[0].n,
  ).toBe(1);
});
test("同じ地域の異なる直接滞在先では接触できず、直接の場所をそろえると合流する", async () => {
  const f = await fixture(),
    area = f.actors[2]!;
  const move = (i: number, ids: string[], directPlaceId?: string) =>
    f.send(i, {
      command: "update",
      text: "移動",
      dependencies: [],
      operations: [
        {
          type: "locate",
          subjectId: f.actors[i],
          text: "滞在中",
          aboutIds: ids,
          ...(directPlaceId ? { directPlaceId } : {}),
        },
      ],
    });
  await move(0, [area, f.place], f.place);
  await move(1, [area, f.far], f.far);
  await expect(
    f.send(0, { command: "contact", targetId: f.actors[1] }),
  ).rejects.toMatchObject({ code: "CONTACT_MISMATCH" });
  for (const kind of ["self", "surroundings"]) {
    const read = await f.send(0, { command: "search", query: { kind } });
    expect(read.material).toMatchObject({
      locations: [{ directPlaceId: f.place }],
    });
  }
  await move(1, [area, f.place]);
  await expect(
    f.send(0, { command: "contact", targetId: f.actors[1] }),
  ).rejects.toMatchObject({ code: "CONTACT_MISMATCH" });
  await move(1, [area, f.place], f.place);
  expect(
    (await f.send(0, { command: "contact", targetId: f.actors[1] })).contact,
  ).toBe("joined");
});
test("世界の事前条件をGMが照合し、明確な合致だけ同じ個体のまま承認する", async () => {
  const f = await fixture(),
    admin = await auth.person(),
    source = randomUUID();
  const configure = (condition: string) =>
    auth.operations.execute(
      admin.id,
      randomUUID(),
      {
        operation: "promotionPolicy.put",
        worldId: f.world,
        condition,
        reason: "試験条件を設定",
      },
      { players: access.players },
    );
  await configure("その場で鈴を鳴らした個体だけ");
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  await f.send(0, {
    command: "say",
    requestId: source,
    text: "小さな動物が現れた",
    instantNpcs: ["個体A", "個体B", "個体C", "個体D", "個体E"],
  });
  await f.send(0, { command: "end-turn" });
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { text: "鈴を鳴らす" }),
  );
  await access.botPlay.tickNpcs(f.world);
  const ask = (i: number, requestId = randomUUID()) =>
    f.send(0, {
      requestId,
      command: "promote-npc",
      sourceRequestId: source,
      npcIndex: i,
      description: "継続する個体",
    });
  const id = randomUUID();
  f.calls.mockImplementationOnce(async (call, role, messages) => {
    expect(role).toBe("world-npc-promotion");
    expect(messages[0]?.content).toContain("その場で鈴を鳴らした個体だけ");
    expect(messages[1]?.content).toContain("鈴を鳴らす");
    return answer(call, { match: "clear", reason: "行動の記録で確認" });
  });
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { description: "小屋に住む個体", memory: "鈴の音を聞いた。" }),
  );
  const accepted = await ask(0, id);
  const npc = derivedId(source + ":manual:0");
  expect(accepted).toMatchObject({ state: "approved", npcId: npc });
  expect(
    (await access.botPlay.current(f.world, npc))?.data.members.find(
      (m) => m.actorId === npc,
    )?.instant,
  ).toBeUndefined();
  expect(await ask(0, id)).toEqual(accepted);
  f.calls.mockImplementationOnce(async (call) =>
    answer(call, { match: "unmet", reason: "該当する記録なし" }),
  );
  expect((await ask(1)).state).toBe("pending");
  f.calls.mockRejectedValueOnce(new Error("判定不能"));
  expect((await ask(2)).state).toBe("pending");
  f.calls.mockImplementationOnce(async (call) => {
    await configure("");
    return answer(call, { match: "clear", reason: "審査開始時の条件には合致" });
  });
  expect((await ask(3)).state).toBe("pending");
  f.calls.mockClear();
  expect((await ask(4)).state).toBe("pending");
  expect(f.calls).not.toHaveBeenCalled();
});

test("要約中の昇格再送は最初の判定を待ち、保留で先に確定しない", async () => {
  const f = await fixture(),
    admin = await auth.person(),
    source = randomUUID(),
    requestId = randomUUID();
  await auth.operations.execute(
    admin.id,
    randomUUID(),
    {
      operation: "promotionPolicy.put",
      worldId: f.world,
      condition: "今回の個体を承認",
      reason: "再送の照合",
    },
    { players: access.players },
  );
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  await f.send(0, {
    command: "say",
    requestId: source,
    text: "鳥を見つける",
    instantNpcs: ["小鳥"],
  });
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let profiles = 0,
    reviews = 0;
  f.calls.mockImplementation(async (id, role) => {
    if (role === "world-npc-promotion") {
      reviews++;
      return answer(id, { match: "clear", reason: "該当" });
    }
    expect(role).toBe("world-npc-profile");
    profiles++;
    await gate;
    return answer(id, { description: "小屋の小鳥", memory: "" });
  });
  const apply = () =>
    f.send(0, {
      command: "promote-npc",
      requestId,
      sourceRequestId: source,
      npcIndex: 0,
      description: "小屋に住む鳥",
    });
  const first = apply();
  await vi.waitFor(() => expect(profiles).toBe(1));
  const query = vi.spyOn(isolated.databases.postgres, "query");
  const duplicate = apply();
  try {
    await vi.waitFor(() =>
      expect(query).toHaveBeenCalledWith(
        "SELECT result FROM bot_request WHERE id=$1",
        [requestId],
      ),
    );
    expect(reviews).toBe(1);
  } finally {
    release();
  }
  const [a, b] = await Promise.all([first, duplicate]);
  expect(a.state).toBe("approved");
  expect(a).toEqual(b);
  expect(reviews).toBe(1);
  expect(profiles).toBe(1);
});
test("型付きの正式改名は1 SPで審査し、技能の本文と習得根拠を維持する", async () => {
  const f = await fixture();
  const person = f.actors[0]!;
  await f.apply([
    {
      type: "learn",
      person,
      text: "周囲数歩を照らす",
      basis: "灯りを練習した",
    },
  ]);
  const skills = () =>
    readBelongings(f.store.context(f.graph), person).then((r) => r.skills);
  const [skill] = await skills();
  f.calls.mockImplementation(async (id, role) => {
    expect(role).toBe("world-rename-review");
    return answer(id, { success: true, reason: "習得済みの技能の呼び名" });
  });
  const command = PlayerPlayCommand.parse({
    requestId: randomUUID(),
    command: "apply",
    expectedSp: 1,
    action: { type: "rename", targetId: skill!.id, name: "宵灯" },
    dependencies: [],
  });
  const result = await access.botCommand(
    f.people[0]!.id,
    f.world,
    command,
    person,
  );
  expect(result).toMatchObject({ spentSp: 1, outcome: { success: true } });
  expect(await skills()).toEqual([{ ...skill, name: "宵灯" }]);
  await access.botCommand(f.people[0]!.id, f.world, command, person);
  expect(f.calls).toHaveBeenCalledTimes(1);
  expect((await f.status(0)).dailySp.remaining).toBe(99);
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { success: false, reason: "呼び名を変えるだけでは成立しない" }),
  );
  const refused = PlayerPlayCommand.parse({
    requestId: randomUUID(),
    command: "apply",
    expectedSp: 1,
    action: {
      type: "rename",
      targetId: skill!.id,
      name: "既に世界中を照らした灯り",
    },
    dependencies: [],
  });
  await expect(
    access.botCommand(f.people[0]!.id, f.world, refused, person),
  ).resolves.toMatchObject({ spentSp: 1, outcome: { success: false } });
  expect(await skills()).toEqual([{ ...skill, name: "宵灯" }]);
  expect((await f.status(0)).dailySp.remaining).toBe(98);
  const legacy = PlayCommand.parse({
    command: "update",
    requestId: randomUUID(),
    text: "技能の名前を変える",
    operations: [{ type: "update", id: skill!.id, text: "別の名前" }],
    dependencies: [],
  });
  expect(PlayerPlayCommand.safeParse(legacy).success).toBe(false);
});

test("発展で消費した元技能を根拠に既存の能力を0 SPで明文化する", async () => {
  const f = await fixture(1);
  const person = f.actors[0]!;
  const read = () => readBelongings(f.store.context(f.graph), person);
  await f.apply([
    { type: "learn", person, text: "手元を照らせる", basis: "灯りの練習" },
  ]);
  const origin = (await read()).skills[0]!;
  await f.apply([
    {
      type: "learn",
      person,
      text: "以前の灯りに加えて灯りの色を変えられる",
      basis: "色の練習",
      consumeSkillIds: [origin.id],
    },
  ]);
  const current = (await read()).skills[0]!;
  f.calls.mockImplementation(async (id, role, messages) => {
    expect(role).toBe("world-description-review");
    expect(JSON.parse(String(messages[1]!.content)).originSkills).toEqual([
      expect.objectContaining({ id: origin.id, text: origin.text }),
    ]);
    return answer(id, {
      success: true,
      reason: "元からある能力を明文化している",
    });
  });
  const text = "手元を照らせて、灯りの色を変えられる";
  await expect(
    f.send(0, {
      command: "apply",
      expectedSp: 0,
      dependencies: [],
      action: { type: "clarify", targetId: current.id, text },
    }),
  ).resolves.toMatchObject({ spentSp: 0 });
  expect((await read()).skills).toEqual([{ ...current, text }]);
});

test("独立した生成案は同じGM呼び出しでも、抽選した案ごとに1 SPを使う", async () => {
  const f = await fixture();
  f.calls.mockImplementation(async (id) =>
    answer(id, { settings: [sure, sure] }),
  );
  const command = PlayerPlayCommand.parse({
    requestId: randomUUID(),
    command: "apply",
    expectedSp: 2,
    action: {
      type: "generate",
      plans: ["紙の栞", "木の匙"].map((label) => ({
        text: `${label}を作る`,
        operation: {
          type: "create",
          label,
          holder: f.actors[0],
          basis: "手工作",
        },
      })),
    },
    dependencies: [],
  });
  await expect(
    access.botCommand(
      f.people[0]!.id,
      f.world,
      PlayerPlayCommand.parse({ ...command, expectedSp: 1 }),
      f.actors[0],
    ),
  ).rejects.toMatchObject({ code: "SP_QUOTE_CHANGED" });
  expect(f.calls).not.toHaveBeenCalled();
  await expect(
    access.botCommand(f.people[0]!.id, f.world, command, f.actors[0]),
  ).resolves.toMatchObject({ spentSp: 2, dailySp: { remaining: 98 } });
  expect(f.calls).toHaveBeenCalledTimes(1);
});

test("型付きの対人対抗は関係IDで状態を置き換え、期限と出目を保存する", async () => {
  const f = await fixture();
  await f.send(0, { command: "contact", targetId: f.actors[1] });
  const status = await f.status(0);
  const current = (status as { turnHolder?: { actorId: string } }).turnHolder
    ?.actorId;
  const attacker = current === f.actors[0] ? 0 : 1;
  const defender = 1 - attacker;
  const target = f.actors[defender]!;
  const prior: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  mark(prior, target, "足を踏み出している。");
  mark(prior, target, "帽子をかぶっている。");
  const [replaced, kept] = prior.edges;
  const context = () => f.store.context(f.graph);
  await f.store.commit(await f.store.claim(f.graph, randomUUID()), context(), {
    commitId: randomUUID(),
    at: 0,
    changes: prior,
  });
  const states = [{ id: target, text: "足を止めている。", minutes: 5 }];
  f.calls.mockImplementation(async (id, role, messages) => {
    expect(role).toBe("world-opposition-dice");
    const material = JSON.parse(String(messages[1]!.content)).materials[0];
    expect(material).toMatchObject({
      states: expect.arrayContaining([
        expect.objectContaining({ relationId: replaced!.id }),
      ]),
    });
    return answer(id, { ...sure, states, endEdges: [replaced!.id] });
  });
  const command = PlayerPlayCommand.parse({
    requestId: randomUUID(),
    command: "apply",
    expectedSp: 1,
    dependencies: [],
    action: {
      type: "oppose",
      text: "練習用の棒で相手を止めようとする",
      targetId: target,
      description: "立ち止まっている",
      replacesStateId: replaced!.id,
    },
  });
  const send = () =>
    access.botCommand(
      f.people[attacker]!.id,
      f.world,
      command,
      f.actors[attacker],
    );
  await expect(send()).resolves.toMatchObject({
    spentSp: 1,
    dailySp: { remaining: 99 },
    outcome: { success: true, setting: { states, endEdges: [replaced!.id] } },
  });
  expect((await context().edge(replaced!.id))?.period.until).toBeDefined();
  expect((await context().edge(kept!.id))?.period.until).toBeUndefined();
  const receipt = await f.store.receipt(f.graph, command.requestId);
  const received = receipt!.changes.edges.find(
    (edge) => edge.stateOrigin?.requestId === command.requestId,
  )!;
  expect(received.period.until).toBe(received.period.from + 5 * 60000);
  expect(
    await context().relations(target, "status", "out", received.period.until!),
  ).not.toContainEqual(expect.objectContaining({ id: received.id }));
  await send();
  expect((await f.status(attacker)).dailySp.remaining).toBe(99);
  expect(f.calls).toHaveBeenCalledTimes(1);
});

test("着脱の確定は付着した関係だけを終え、追加のGMとSPを使わない", async () => {
  const f = await fixture();
  const person = f.actors[0]!;
  const wearer = f.actors[1]!;
  await f.send(0, { command: "contact", targetId: wearer });
  await giveTurn(f, 0);
  await f.apply([
    { type: "create", label: "布の花飾り", holder: person, basis: "携行品" },
  ]);
  const context = () => f.store.context(f.graph);
  const item = (await readBelongings(context(), person)).items[0]!.id;
  const act = (action: unknown, expectedSp: number, id = randomUUID(), i = 0) =>
    access.botCommand(
      f.people[i]!.id,
      f.world,
      PlayerPlayCommand.parse({
        requestId: id,
        command: "apply",
        action,
        expectedSp,
        dependencies: [],
      }),
      f.actors[i],
    );
  const id = randomUUID();
  const offered = await act(
    {
      type: "state",
      targetId: wearer,
      text: "胸に花飾りを付ける",
      description: "花飾りが付いている",
      attachedItemId: item,
    },
    1,
    id,
  );
  expect(offered).toMatchObject({ state: "receiving", spentSp: 1 });
  await f.send(1, {
    command: "receive",
    applicationId: offered.applicationId,
    accept: true,
  });
  await giveTurn(f, 1);
  const stateId = derivedId(`${derivedId(`${id}:state`)}:content`);
  const edge = await context().edge(stateId);
  expect(edge?.stateOrigin).toEqual({
    requestId: id,
    actorId: person,
    attachedItemId: item,
  });
  f.calls.mockClear();
  await expect(
    act({ type: "detach", stateId }, 0, randomUUID(), 1),
  ).resolves.toMatchObject({
    spentSp: 0,
  });
  expect((await context().edge(stateId))?.period.until).toBeDefined();
  expect(f.calls).not.toHaveBeenCalled();
});

test.each([false, true])(
  "非戦闘地域でも治療の成功で指定した負傷を終了する（材料指定=%s）",
  async (withMaterials) => {
    const f = await fixture(1);
    await isolated.databases.postgres.query(
      "UPDATE world_construction SET non_combat_areas=$2 WHERE id=$1",
      [f.world, JSON.stringify([{ rootId: f.place, memberPlaceIds: [] }])],
    );
    const actor = f.actors[0]!;
    const apply = (action: unknown, requestId: string) =>
      access.botCommand(
        f.people[0]!.id,
        f.world,
        PlayerPlayCommand.parse({
          requestId,
          command: "apply",
          expectedSp: 1,
          action,
          dependencies: [],
        }),
        actor,
      );
    const injury = randomUUID();
    await apply(
      {
        type: "state",
        targetId: actor,
        text: "作業中に怪我をする",
        description: "指に浅い傷がある",
      },
      injury,
    );
    const wound = derivedId(`${derivedId(`${injury}:state`)}:content`);
    const treatment = randomUUID();
    const bandage = withMaterials
      ? (
          await f.apply([
            { type: "create", label: "包帯", holder: actor, basis: "検証" },
          ])
        ).changes.nodes[0]!.id
      : undefined;
    const action = {
      type: "state",
      targetId: actor,
      text: "傷を洗い包帯を巻く",
      description: "手当てされている",
      stateId: wound,
      ...(bandage ? { materials: [{ id: bandage }] } : {}),
    };
    f.calls.mockClear();
    f.calls.mockImplementation(async (id, role, messages) => {
      expect(role).toBe("world-creation-dice");
      expect(String(messages[0]!.content).includes("requiredMaterials")).toBe(
        withMaterials,
      );
      const review = JSON.parse(String(messages[1]!.content));
      expect(review.allowApply).toBe(false);
      expect(review).not.toHaveProperty("confirmed");
      return answer(id, { ...sure, endEdges: [wound] });
    });
    await expect(apply(action, treatment)).resolves.toMatchObject({
      spentSp: 1,
    });
    const receipt = await f.store.receipt(f.graph, treatment);
    expect(receipt?.changes.endEdges).toContain(wound);
    expect(
      receipt?.changes.edges.some(
        (edge) => edge.stateOrigin?.requestId === treatment,
      ),
    ).toBe(true);
    if (bandage)
      expect(
        (await readBelongings(f.store.context(f.graph), actor)).items,
      ).toEqual([]);
    await apply(action, treatment);
    expect(f.calls).toHaveBeenCalledTimes(1);
  },
);

test("CLIで複数の短縮IDを指定すると、その状態だけを新しい状態なしで終了する", async () => {
  const f = await fixture(1);
  const actor = f.actors[0]!;
  const { initial_prompt: premise } = await runtime.get(f.world);
  const changes: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  const ended = ["濡れた袖", "濡れた裾"];
  const kept = "袖に縫い跡がある";
  for (const state of [...ended, kept]) mark(changes, actor, state);
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    { commitId: randomUUID(), at: 0, changes },
  );
  await f.apply([
    { type: "create", holder: actor, label: "手持ちの針", basis: "裁縫道具" },
    { type: "learn", person: actor, text: "布を継ぐ", basis: "裁縫の練習" },
    { type: "grant", person: actor, storage: f.far, basis: "道具を預ける" },
    { type: "create", holder: f.far, label: "保管中の布", basis: "裁縫材料" },
  ]);
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  try {
    const profile = join(cli.directory, "state.json");
    const run = (...args: string[]) => cli.run(profile, ...args);
    const connection = await run(
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
          connection.userCode,
          `actor:${actor}`,
        )
      ).statusCode,
    ).toBe(302);
    const read = async () => {
      const { result } = await run("search", "--kind", "self");
      return result.material.states as {
        node: { text: string };
        relation: { id: string };
      }[];
    };
    const before = await read();
    const endStateIds = ended.map(
      (label) => before.find(({ node }) => node.text === label)!.relation.id,
    );
    for (const id of endStateIds) expect(id).toMatch(/^@/);
    const file = join(cli.directory, "end.json");
    const request = {
      command: "apply",
      action: {
        type: "state",
        operation: "end",
        targetId: actor,
        text: "服の水気を拭き取る",
        description: "袖と裾が乾いた",
        endStateIds,
      },
      dependencies: [],
    };
    await writeFile(file, JSON.stringify(request));
    const quote = await run("play", "--file", file, "--quote");
    expect(quote).toEqual({ expectedSp: 1 });
    expect(f.calls).not.toHaveBeenCalled();
    f.calls.mockImplementationOnce(async (id, role, messages) => {
      expect(role).toBe("world-creation-dice");
      expect(messages[0]!.content).toContain("JSON");
      expect(JSON.parse(messages[1]!.content)).toEqual({
        premise,
        targetId: actor,
        self: true,
        text: `${request.action.text}\n${request.action.description}`,
        states: ended.map((text, i) => ({
          relationId: changes.edges[i]!.id,
          since: changes.edges[i]!.period.from,
          text,
        })),
      });
      return answer(id, {
        ...sure,
        endEdges: [changes.edges[0]!.id, changes.edges[2]!.id],
      });
    });
    await writeFile(file, JSON.stringify({ ...request, ...quote }));
    const played = await run("play", "--file", file);
    expect(played.result).toMatchObject({
      state: "accepted",
      spentSp: 1,
      outcome: { success: true, setting: sure, roll: expect.any(Number) },
    });
    expect(
      (await run("recover", "--request", played.requestId)).result,
    ).toEqual(played.result);
    expect(f.calls).toHaveBeenCalledTimes(1);
    expect((await read()).map(({ relation }) => relation.id).sort()).toEqual(
      before
        .map(({ relation }) => relation.id)
        .filter((id) => !endStateIds.includes(id))
        .sort(),
    );
  } finally {
    await cli.close();
    await app.close();
  }
});

test("現在地の現行状態は説明なしで終了でき、異なる対象や終了済みの状態は指定できない", async () => {
  const f = await fixture(1);
  const changes: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  mark(changes, f.place, "広場に掲示がある", [{ id: f.far }]);
  mark(changes, f.actors[0]!, "袖に汚れがある");
  const [current, about, other] = changes.edges.map((edge) => edge.id);
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    { commitId: randomUUID(), at: 0, changes },
  );
  const requestId = randomUUID();
  const apply = (endStateIds: string[], id = randomUUID()) =>
    f.send(0, {
      command: "apply",
      requestId: id,
      expectedSp: 1,
      action: {
        type: "state",
        operation: "end",
        targetId: f.place,
        text: "掲示を外す",
        endStateIds,
      },
      dependencies: [],
    });
  await expect(apply([current!, other!])).rejects.toMatchObject({
    code: "STATE_TARGET_CHANGED",
  });
  expect(f.calls).not.toHaveBeenCalled();
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    expect(JSON.parse(messages[1]!.content)).toMatchObject({
      targetId: f.place,
      self: false,
      text: "掲示を外す",
      states: [{ relationId: current, text: "広場に掲示がある", since: 0 }],
    });
    return answer(id, sure);
  });
  const result = await apply([current!], requestId);
  expect(result).toMatchObject({ spentSp: 1, outcome: { success: true } });
  expect((await f.store.receipt(f.graph, requestId))?.changes).toEqual({
    nodes: [],
    revisions: [],
    edges: [],
    endEdges: [current, about],
  });
  await expect(apply([current!], requestId)).resolves.toEqual(result);
  await expect(apply([current!])).rejects.toMatchObject({
    code: "STATE_TARGET_CHANGED",
  });
  expect(f.calls).toHaveBeenCalledTimes(1);
});

test("場所への作用は1 SPで確定し、後続の移動は追加SPを使わず条件を判定する", async () => {
  const f = await fixture(6);
  const changes: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  linkRoute(
    changes,
    randomUUID(),
    0,
    [
      { id: f.place, text: "広場" },
      { id: f.far, text: "離れた場所" },
    ],
    "舗装された小道",
  );
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes,
    },
  );
  let movable = false;
  f.calls.mockImplementation(async (id, role, messages) => {
    if (role === "world-place-movement") {
      expect(messages[1]?.content).toContain("霧");
      return answer(id, {
        movable,
        reason: movable ? "道を見失わずに通れる" : "道標が見えない",
      });
    }
    return answer(id, sure);
  });
  const act = (action: unknown, expectedSp: number, i = 0) =>
    access.botCommand(
      f.people[i]!.id,
      f.world,
      PlayerPlayCommand.parse({
        requestId: randomUUID(),
        command: "apply",
        action,
        expectedSp,
        dependencies: [],
      }),
      f.actors[i],
    );
  const fog = (description: string) =>
    act(
      {
        type: "state",
        targetId: f.place,
        text: "霧を起こす",
        description,
        affectsMovement: true,
      },
      1,
    );
  const move = (i: number) =>
    act(
      {
        type: "direct",
        text: "小道を通る",
        operations: [
          {
            type: "locate",
            subjectId: f.actors[i],
            text: "離れた場所",
            aboutIds: [f.far],
          },
        ],
      },
      0,
      i,
    );
  for (let i = 1; i < f.actors.length; i++) await f.move(i, f.far);
  await expect(fog("広場に濃い霧がかかっている")).resolves.toMatchObject({
    spentSp: 1,
  });
  for (let i = 1; i < f.actors.length; i++) await f.move(i, f.place);
  f.calls.mockClear();
  await expect(move(1)).rejects.toMatchObject({ code: "MOVEMENT_BLOCKED" });
  await expect(move(1)).rejects.toMatchObject({ code: "MOVEMENT_BLOCKED" });
  const blocked = f.calls.mock.calls[0]![0];
  expect(f.calls.mock.calls.map(([id]) => id)).toEqual([blocked, blocked]);

  await expect(fog("風で霧が流れ、道標が見える")).resolves.toMatchObject({
    spentSp: 1,
  });
  movable = true;
  f.calls.mockClear();
  for (let i = 1; i < f.actors.length; i++)
    await expect(move(i)).resolves.toMatchObject({ spentSp: 0 });
  expect(f.calls.mock.calls[0]![0]).not.toBe(blocked);
  expect(f.calls.mock.calls.map((call) => call[1])).toEqual(
    Array(5).fill("world-place-movement"),
  );
  expect((await f.status(0)).dailySp.remaining).toBe(98);
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
  const invalid = randomUUID();
  await expect(
    make(
      [{ id: invalid, kind: "script", text: "不正な接続" }],
      [
        {
          id: randomUUID(),
          kind: "has",
          source: event,
          target: invalid,
          period: { from: 0 },
        },
      ],
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_REJECTED" });
  const interpretation = (id: string) => ({
    nodes: [{ id, kind: "script", text: "本人だけが持つ人物解釈" }],
    edges: [
      {
        id: randomUUID(),
        kind: "interpret",
        role: "content",
        source: f.actors[0],
        target: id,
        period: { from: 0 },
      },
      {
        id: randomUUID(),
        kind: "interpret",
        role: "about",
        source: id,
        target: f.actors[1],
        period: { from: 0 },
      },
    ],
  });
  const privateChange = interpretation(thought);
  await make(privateChange.nodes, privateChange.edges, "私的な解釈を保存する");
  await expect(
    f.send(0, {
      command: "update",
      text: "広場の名前と本人の解釈を更新する",
      changes: {
        ...interpretation(randomUUID()),
        revisions: [{ id: f.place, kind: "existence", text: "広場の別名" }],
        endEdges: [],
      },
      dependencies: [],
    }),
  ).rejects.toMatchObject({ code: "AUTHORITY_REQUIRED" });
  expect((await f.store.context(f.graph).node(f.place))?.text).toBe("広場");
  expect(f.calls).not.toHaveBeenCalled();
  await f.send(0, { command: "end-turn" });
  expect(JSON.stringify((await f.status(0)).entries)).not.toContain(
    "私的な解釈",
  );
  const admin = await auth.person(),
    policy = (input: Record<string, unknown>) =>
      auth.operations.execute(
        admin.id,
        randomUUID(),
        { worldId: f.world, ...input } as never,
        { players: access.players },
      ) as Promise<{
        criteria: string;
        defaultCriteria: string;
        fumbleCriteria: string;
        defaultFumbleCriteria: string;
        shown: boolean;
      }>;
  const unset = await policy({ operation: "creationPolicy.read" });
  expect(unset.criteria).toBe("");
  expect(unset.fumbleCriteria).toBe("");
  expect(unset.shown).toBe(false);
  const free = (id: string) =>
    make(
      [{ id, kind: "script", text: "新しい自由な性質" }],
      [
        {
          id: randomUUID(),
          kind: "status",
          role: "content",
          source: f.actors[0],
          target: id,
          period: { from: 0 },
        },
      ],
    );
  f.calls.mockImplementation(async (id, _role, messages) => {
    expect(messages[0]?.content).toContain(unset.defaultCriteria);
    expect(messages[0]?.content).toContain(unset.defaultFumbleCriteria);
    expect(messages[0]?.content).toContain("since）が新しい記述");
    const input = JSON.parse(String(messages[1]!.content));
    expect(Object.keys(input)).toEqual([
      "premise",
      "actor",
      "text",
      "changes",
      "allowApply",
      "nodes",
    ]);
    for (const node of input.nodes)
      for (const state of node.states)
        expect(Object.keys(state)).toEqual(["node", "since", "about"]);
    return answer(id, sure);
  });
  expect((await free(script)).outcome).toMatchObject({ success: true });
  expect(f.calls).toHaveBeenCalledTimes(1);
  expect(f.calls.mock.calls[0]![1]).toBe("world-creation-dice");
  // 基準の文は既定ではプレイヤーに見せない。表示を選ぶと、空欄の世界では既定の基準を見せる。
  expect(
    await policy({
      operation: "creationPolicy.put",
      criteria: "",
      shown: true,
      reason: "基準を表示",
    }),
  ).toMatchObject({ shown: true });
  expect((await f.status(0)).creationCriteria).toBe(unset.defaultCriteria);
  expect((await f.status(0)).fumbleCriteria).toBe(unset.defaultFumbleCriteria);
  expect(
    await policy({
      operation: "creationPolicy.put",
      criteria: "この世界だけの基準",
      fumbleCriteria: "この世界だけのファンブル基準",
      reason: "世界ごとの基準を設定",
    }),
  ).toMatchObject({ shown: true });
  expect((await f.status(0)).creationCriteria).toBe("この世界だけの基準");
  expect((await f.status(0)).fumbleCriteria).toBe(
    "この世界だけのファンブル基準",
  );
  // ファンブルの基準を省いた設定は、現在のファンブルの基準を保つ。
  await policy({
    operation: "creationPolicy.put",
    criteria: "この世界だけの基準",
    shown: false,
    reason: "基準を非表示",
  });
  expect((await f.status(0)).creationCriteria).toBeUndefined();
  f.calls.mockImplementation(async (id, _role, messages) => {
    expect(messages[0]?.content).toContain("この世界だけの基準");
    expect(messages[0]?.content).toContain("この世界だけのファンブル基準");
    return answer(id, { sides: 100, successThrough: 10 });
  });
  const failing = randomUUID(),
    rejected = randomUUID(),
    used = (await f.status(0)).callsUsed as number,
    seed = (request: string) =>
      isolated.databases.postgres.query(
        "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,50)",
        [derivedId(`${request}:creation`), { sides: 100, successThrough: 10 }],
      ),
    attempt = () =>
      f.send(0, {
        requestId: failing,
        command: "create",
        text: "成功しにくい作成",
        changes: {
          nodes: [{ id: rejected, kind: "existence", text: "ありえない物" }],
          revisions: [],
          edges: [],
          endEdges: [],
        },
        dependencies: [],
      });
  await seed(failing);
  const failed = await attempt();
  expect(failed.spentSp).toBe(0);
  expect(failed.outcome).toEqual({
    success: false,
    setting: { sides: 100, successThrough: 10 },
    roll: 50,
  });
  expect(await f.store.context(f.graph).node(rejected)).toBeUndefined();
  expect((await f.status(0)).callsUsed).toBe(used + 1);
  expect(await attempt()).toEqual(failed);
  const absent = randomUUID();
  await seed(absent);
  const spoken = await f.send(0, {
    requestId: absent,
    command: "say",
    text: "物陰で何かが動いた気がする",
    instantNpcs: ["物陰の何か"],
  });
  expect(spoken).toMatchObject({
    state: "accepted",
    instantNpcs: [],
    outcome: { success: false },
  });
  expect(spoken.appearances).toBeUndefined();
  expect((await f.status(0)).members).toHaveLength(1);
});

test("同じ手番で失敗した申請の出し直しは、判断モデルが同じ試みと認めたときだけ前回の結果を返す", async () => {
  const f = await fixture(),
    db = isolated.databases.postgres,
    model = runtime.agent.model,
    dice = { sides: 100, successThrough: 10 };
  let probability = 0.8,
    status = 200;
  vi.spyOn(model, "decision", "get").mockReturnValue(
    decisionSettings({ LLM_DECISION_MODEL: "fixture/decide" }),
  );
  vi.spyOn(model, "apiKey").mockResolvedValue("unused");
  const decisions = vi
    .spyOn(model, "transport")
    .mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      return Response.json(
        {
          id: "decision",
          model: body.model,
          answers: Object.fromEntries(
            Object.keys(body.questions).map((key) => [
              key,
              { type: "noul", noul: probability },
            ]),
          ),
          usage: { input_tokens: 100, output_tokens: 20, cost: 0.0000042 },
        },
        { status },
      );
    });
  f.calls.mockImplementation(async (id) => answer(id, dice));
  // 出目を指定すると、判定の前にダイスを保存して結果を固定する。
  const attempt = async (text: string, roll?: number) => {
    const requestId = randomUUID();
    if (roll)
      await db.query("INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,$3)", [
        derivedId(`${requestId}:creation`),
        dice,
        roll,
      ]);
    return (
      await f.send(0, {
        requestId,
        command: "create",
        text,
        changes: {
          nodes: [{ id: randomUUID(), kind: "existence", text }],
          revisions: [],
          edges: [],
          endEdges: [],
        },
        dependencies: [],
      })
    ).outcome;
  };
  // 手番に失敗がなければ、判断モデルを呼ばない。
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  expect(await attempt("最初の作成")).toMatchObject({ success: true });
  expect(decisions).not.toHaveBeenCalled();
  expect(await attempt("通らない作成", 50)).toEqual({
    success: false,
    setting: dice,
    roll: 50,
  });
  const judged = f.calls.mock.calls.length,
    used = (await f.status(0)).callsUsed as number;
  // 同じ試みと判定された出し直しは、GMを呼ばずに前回の設定と出目を返し、通常枠を1回使う。
  const repeated = randomUUID(),
    changes = {
      nodes: [{ id: randomUUID(), kind: "existence", text: "出し直し" }],
      revisions: [],
      edges: [],
      endEdges: [],
    },
    again = () =>
      f.send(0, {
        requestId: repeated,
        command: "create",
        text: "言い回しを変えた通らない作成",
        changes,
        dependencies: [],
      });
  const first = await again();
  expect(first.spentSp).toBe(0);
  expect(first.outcome).toEqual({
    success: false,
    setting: dice,
    roll: 50,
    repeated: true,
  });
  expect(f.calls).toHaveBeenCalledTimes(judged);
  expect((await f.status(0)).callsUsed).toBe(used + 1);
  expect(
    await f.store.context(f.graph).node(changes.nodes[0]!.id),
  ).toBeUndefined();
  expect(JSON.parse(String(decisions.mock.calls[0]![1]!.body)).state).toEqual({
    failed: ["通らない作成"],
    current: "言い回しを変えた通らない作成",
  });
  // 費用は判断APIが報告した額で台帳に載る。
  expect(
    (
      await db.query(
        "SELECT charged_nano::int AS charged,state FROM llm_call WHERE request->>'role'='world-creation-repeat'",
      )
    ).rows,
  ).toEqual([{ charged: 4200, state: "complete" }]);
  // 同じ要求の再送は、判定をやり直さずに同じ結果を返す。
  expect(await again()).toEqual(first);
  expect(decisions).toHaveBeenCalledTimes(1);
  // 確率が低いとき、判断APIが失敗したときは、通常どおりGMが設定する。
  probability = 0.79;
  expect(await attempt("別の作成")).not.toHaveProperty("repeated");
  expect(decisions).toHaveBeenCalledTimes(2);
  expect(f.calls).toHaveBeenCalledTimes(judged + 1);
  status = 500;
  expect(await attempt("さらに別の作成")).not.toHaveProperty("repeated");
  expect(decisions).toHaveBeenCalledTimes(3);
  expect(f.calls).toHaveBeenCalledTimes(judged + 2);
});

test("周囲の検索は、同じ場所にいる相手が手にしている物を返し、保管先の中身は返さない", async () => {
  const f = await fixture();
  await f.apply([
    { type: "create", label: "古い鍵", holder: f.actors[1], basis: "検証" },
  ]);
  const held = (await readBelongings(f.store.context(f.graph), f.actors[1]!))
    .items[0]!;
  const subjects = async () =>
    (
      (await f.send(0, { command: "search", query: { kind: "surroundings" } }))
        .material as { subjects: { id: string; held: unknown[] }[] }
    ).subjects;
  expect((await subjects()).find((s) => s.id === f.actors[1])?.held).toEqual([
    { id: held.id, label: "古い鍵" },
  ]);
  // 相手を保管先として使う関係ができると、その中身は外から見えない。
  await f.apply([
    { type: "grant", person: f.actors[0], storage: f.actors[1], basis: "検証" },
  ]);
  expect((await subjects()).find((s) => s.id === f.actors[1])?.held).toEqual(
    [],
  );
});

test("本人が決めた閲覧範囲に従って、ほかの参加者が読める物・保管先・技能・状態が変わる", async () => {
  const f = await fixture(),
    [chest, state] = [randomUUID(), randomUUID()];
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [
          { id: chest, kind: "existence", text: "木箱" },
          { id: state, kind: "script", text: "背中に古い傷がある" },
        ],
        edges: [
          {
            id: randomUUID(),
            kind: "status",
            role: "content",
            source: f.actors[1]!,
            target: state,
            period: { from: 0 },
          },
        ],
        revisions: [],
        endEdges: [],
      },
    },
  );
  await f.apply([
    { type: "create", label: "古い鍵", holder: f.actors[1], basis: "検証" },
    { type: "grant", person: f.actors[1], storage: chest, basis: "検証" },
    { type: "create", label: "銀貨", count: 3, holder: chest, basis: "検証" },
    { type: "learn", person: f.actors[1], text: "鍵開け", basis: "検証" },
  ]);
  const own = await readBelongings(f.store.context(f.graph), f.actors[1]!),
    key = own.items[0]!.id,
    skill = own.skills[0]!.id;
  // 人物iから見た人物1。手にしている物は周囲の検索、状態・保管先・技能は人物の検索に出る。
  const seen = async (i: number) => {
    const { subjects } = (
      await f.send(i, { command: "search", query: { kind: "surroundings" } })
    ).material as { subjects: { id: string; held: { id: string }[] }[] };
    const subject = (
      await f.send(i, {
        command: "search",
        query: { kind: "subject", targetId: f.actors[1] },
      })
    ).material as {
      states: { node: { id: string } }[];
      belongings?: {
        storages: { id: string; items: unknown[] }[];
        skills: unknown[];
      };
    };
    return {
      held: subjects.find((s) => s.id === f.actors[1])!.held.map((h) => h.id),
      states: subject.states.map((s) => s.node.id).includes(state),
      belongings: subject.belongings,
    };
  };
  // 設定しない間は、手にしている物と状態だけが読める。
  expect(await seen(0)).toEqual({ held: [key], states: true });
  // 他人の物には設定できない。
  await expect(f.view(0, key, [])).rejects.toMatchObject({
    code: "VIEW_TARGET_REQUIRED",
  });
  await f.view(1, key, []);
  await f.view(1, state, []);
  await f.view(1, chest, [f.actors[0]!]);
  expect(await f.view(1, skill, "all")).toEqual({
    targetId: skill,
    viewers: "all",
  });
  await f.move(2, f.place);
  const items = [{ id: expect.any(String), label: "銀貨", count: 3 }],
    skills = [{ id: skill, text: "鍵開け" }];
  // 指定された人物0は保管先の中身まで、指定されていない人物2は全員向けの技能だけを読める。
  expect(await seen(0)).toEqual({
    held: [],
    states: false,
    belongings: { storages: [{ id: chest, label: "木箱", items }], skills },
  });
  expect(await seen(2)).toEqual({
    held: [],
    states: false,
    belongings: { storages: [], skills },
  });
  // 本人は全部を読め、設定した範囲も確かめられる。
  const self = (await f.send(1, { command: "search", query: { kind: "self" } }))
    .material as {
    states: { node: { id: string } }[];
    belongings: {
      items: unknown[];
      storages: unknown[];
      skills: unknown[];
    };
  };
  expect(self.states.map((s) => s.node.id)).toContain(state);
  expect(self.belongings).toMatchObject({
    items: [{ id: key, viewers: [] }],
    storages: [{ id: chest, viewers: [f.actors[0]], items }],
    skills: [{ id: skill, viewers: "all" }],
  });
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
            role: "use",
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

test("登録した保管先と誰も登録していない場所には、その場にいるときだけ本人の判断で出し入れでき、拒否の理由に対象の名前が出る", async () => {
  const f = await fixture();
  const shared = randomUUID(),
    home = randomUUID(),
    others = randomUUID(),
    loose = randomUUID(),
    square = randomUUID(),
    route = randomUUID(),
    state = randomUUID();
  const has = (source: string, target: string) => ({
    id: randomUUID(),
    kind: "has" as const,
    role: "use" as const,
    source,
    target,
    period: { from: 0 },
  });
  const content = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [
          { id: shared, kind: "existence", text: "共同倉庫" },
          { id: home, kind: "existence", text: "自分の家" },
          { id: others, kind: "existence", text: "相手の家" },
          { id: loose, kind: "existence", text: "誰のものでもない箱" },
          { id: square, kind: "existence", text: "空き地" },
          { id: route, kind: "script", text: "空き地は広場とつながる" },
          { id: state, kind: "script", text: "背が高い" },
        ],
        edges: [
          has(f.actors[0]!, home),
          has(f.actors[2]!, others),
          {
            id: randomUUID(),
            kind: "status",
            role: "content",
            text: "route",
            source: square,
            target: route,
            period: { from: 0 },
          },
          {
            id: content,
            kind: "status",
            role: "content",
            source: f.actors[0]!,
            target: state,
            period: { from: 0 },
          },
        ],
        revisions: [],
        endEdges: [],
      },
    },
  );
  await f.apply([
    { type: "grant", person: f.actors[0], storage: shared, basis: "取り決め" },
    { type: "create", label: "斧", holder: f.actors[0], basis: "初期" },
    { type: "create", label: "鍬", holder: f.actors[0], basis: "初期" },
    { type: "create", label: "縄", holder: shared, basis: "備え付け" },
    { type: "create", label: "皿", holder: others, basis: "備え付け" },
  ]);
  const read = () => readBelongings(f.store.context(f.graph), f.actors[0]!);
  const before = await read(),
    axe = before.items.find((i) => i.label === "斧")!.id,
    hoe = before.items.find((i) => i.label === "鍬")!.id,
    rope = before.storages.find((s) => s.id === shared)!.items[0]!.id;
  const update = (body: Record<string, unknown>) =>
    f.send(0, { command: "update", text: "申請", dependencies: [], ...body });
  const move = (item: string, from: string, to: string) =>
    update({ operations: [{ type: "move", item, from, to, basis: "検証" }] });
  await expect(move(axe, f.actors[0]!, shared)).rejects.toMatchObject({
    code: "STORAGE_NOT_HERE",
    message: expect.stringContaining(`「共同倉庫」（ID: ${shared}）`),
  });
  await expect(move(rope, shared, f.actors[0]!)).rejects.toMatchObject({
    code: "STORAGE_NOT_HERE",
  });
  await expect(move(axe, f.actors[0]!, square)).rejects.toMatchObject({
    code: "STORAGE_NOT_HERE",
    message: expect.stringContaining(`「空き地」（ID: ${square}）`),
  });
  await expect(move(axe, f.actors[0]!, loose)).rejects.toMatchObject({
    code: "AUTHORITY_REQUIRED",
    message: expect.stringContaining(`「誰のものでもない箱」（ID: ${loose}）`),
  });
  await expect(move(axe, f.actors[0]!, others)).rejects.toMatchObject({
    code: "REMOTE_RECEIVING",
    message: expect.stringContaining(`「人物2」（ID: ${f.actors[2]}）`),
  });
  const dish = (await readBelongings(f.store.context(f.graph), others))
    .items[0]!.id;
  await expect(move(dish, others, f.actors[0]!)).rejects.toMatchObject({
    code: "STORAGE_NOT_REGISTERED",
    message: expect.stringContaining(`「相手の家」（ID: ${others}）`),
  });
  await expect(
    update({ operations: [{ type: "update", id: state, text: "改める" }] }),
  ).rejects.toMatchObject({
    code: "BELONGING_NOT_RECORDED",
    message: expect.stringContaining("changesのrevisions"),
  });
  // 保管先や場所にいれば、受領もダイスもなく確定する。
  for (const place of [shared, home, square]) {
    await update({
      operations: [
        {
          type: "locate",
          subjectId: f.actors[0],
          text: "保管先にいる",
          aboutIds: [place],
        },
      ],
    });
    if (place === shared) {
      await move(axe, f.actors[0]!, shared);
      await move(rope, shared, f.actors[0]!);
    } else if (place === home) await move(hoe, f.actors[0]!, home);
    else {
      await move(rope, f.actors[0]!, square);
      await move(rope, square, f.actors[0]!);
    }
  }
  const after = await read();
  expect(after.items.map((i) => i.label)).toEqual(["縄"]);
  expect(
    after.storages.map((s) => [s.label, s.items.map((i) => i.label)]),
  ).toEqual(
    expect.arrayContaining([
      ["共同倉庫", ["斧"]],
      ["自分の家", ["鍬"]],
    ]),
  );
  // 本人の状態の改訂と終了は、一申請につき一度のGM確認で確定できる。
  expect(f.calls).not.toHaveBeenCalled();
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    expect(JSON.parse(messages[1]!.content)).toMatchObject({
      allowApply: true,
    });
    // 材料を指定しない本人の状態だけの変更では、製作の材料を求めない。
    expect(messages[0]!.content).not.toContain("requiredMaterials");
    // 同じ指示にある他の出力の空配列が付いても、確定として読む。
    return answer(id, {
      apply: true,
      endEdges: [],
      consumes: [],
      requiredMaterials: [],
      decided: [],
      individuals: [],
    });
  });
  await update({
    changes: {
      nodes: [],
      revisions: [
        { id: state, kind: "script", text: "背がとても高い" },
        { id: f.actors[0], kind: "existence", text: "改めた名前" },
      ],
      edges: [],
      endEdges: [],
    },
  });
  for (const [id, text] of [
    [state, "背がとても高い"],
    [f.actors[0]!, "改めた名前"],
  ] as const)
    expect(await f.store.context(f.graph).node(id)).toMatchObject({ text });
  // 確定とダイス設定が混ざった応答は、問い直さずにダイスで判定する。
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { apply: true, endEdges: [], ...sure }),
  );
  const mixed = await update({
    changes: {
      nodes: [],
      revisions: [{ id: state, kind: "script", text: "背が少し縮んだ" }],
      edges: [],
      endEdges: [],
    },
  });
  expect(mixed.outcome).toMatchObject({ success: true, setting: sure });
  expect(await f.store.context(f.graph).node(state)).toMatchObject({
    text: "背が少し縮んだ",
  });
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { apply: true, endEdges: [content] }),
  );
  await update({
    changes: { nodes: [], revisions: [], edges: [], endEdges: [content] },
  });
  expect(
    (await f.store.context(f.graph).edge(content))?.period.until,
  ).toBeDefined();
  expect(f.calls).toHaveBeenCalledTimes(3);
  // 申請者が持たない物品への申請でも、その物品の成立時と現在の保持の経緯が判定に届く。
  await f.apply([
    { type: "create", label: "杭", holder: f.actors[0], basis: "削り出した" },
  ]);
  const stake = (await read()).items.find((i) => i.label === "杭")!.id;
  await move(stake, f.actors[0]!, square);
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    const facts = JSON.parse(messages[1]!.content).nodes as {
      node: { id: string };
      belongings?: { items: { id: string; basis?: string }[] };
    }[];
    expect(facts.find((fact) => fact.node.id === stake)).toMatchObject({
      origin: { basis: "削り出した" },
    });
    // 材料を消費しうる現在地も材料に入るので、現在の保持の経緯は持つ側の持ち物に出る。
    expect(
      facts.find((fact) => fact.node.id === square)?.belongings?.items,
    ).toContainEqual(expect.objectContaining({ id: stake, basis: "検証" }));
    // 状態を付ける対象そのものをGMが材料に挙げても、成功時に失わせない。
    return answer(id, {
      ...sure,
      requiredMaterials: [{ id: stake, count: 1 }],
    });
  });
  const waxed = randomUUID();
  expect(
    (
      await update({
        changes: {
          nodes: [{ id: waxed, kind: "script", text: "先を焼き締めてある" }],
          revisions: [],
          edges: [
            {
              id: randomUUID(),
              kind: "status",
              role: "content",
              source: stake,
              target: waxed,
              period: { from: 0 },
            },
          ],
          endEdges: [],
        },
      })
    ).outcome,
  ).toMatchObject({ success: true });
  expect(f.calls).toHaveBeenCalledTimes(4);
  await move(stake, square, f.actors[0]!);
  await f.apply([{ type: "remove", id: stake }]);
  // 誰も登録していない場所を保管先にする申請は、新しく得る申請としてダイスで判定する。
  f.calls.mockImplementationOnce(async (id, role) => {
    expect(role).toBe("world-creation-dice");
    return answer(id, {
      ...sure,
      storageLimits: [{ storageId: square, limitSlots: 83 }],
    });
  });
  await update({
    operations: [
      {
        type: "grant",
        person: f.actors[0],
        storage: square,
        basis: "店を構えた",
      },
    ],
  });
  expect((await read()).storages.map((s) => s.label)).toContain("空き地");
  expect(
    (await read()).storages.find((s) => s.id === square)?.capacity,
  ).toEqual({
    usedSlots: 0,
    limitSlots: 83,
  });
});

test("手持ちの容量と受入可能数をHTTPとCLIへ返す", async () => {
  const f = await fixture();
  const actor = f.actors[0]!;
  const create = (label: string, holder: string, count?: number) => ({
    type: "create",
    label,
    holder,
    count,
    basis: "検証",
  });
  const seed = await f.apply([
    { type: "grant", person: actor, storage: f.place, basis: "検証" },
    ...Array.from({ length: 29 }, (_, i) => create(`道具${i}`, actor)),
    create("薬草", actor, 27),
    create("薬草", f.place, 8),
    create("石", f.place),
  ]);
  const nodes = seed.changes.nodes.filter((n) => n.kind === "existence");
  const heldHerbs = nodes[29]!,
    herbs = nodes[30]!,
    stone = nodes[31]!;
  const admin = await auth.person();
  expect(
    await auth.operations.execute(
      admin.id,
      randomUUID(),
      {
        operation: "worlds.configure",
        worldId: f.world,
        title: "容量試験",
        description: "",
        reason: "隔離した世界で有効化する",
        published: false,
        accepting: false,
        inventoryCapacity: true,
      },
      { players: access.players },
    ),
  ).toMatchObject({ inventoryCapacity: true });
  const move = (item: string, count?: number) => ({
    command: "apply",
    requestId: randomUUID(),
    expectedSp: 0,
    dependencies: [],
    action: {
      type: "direct",
      text: "拾う",
      operations: [
        { type: "move", item, from: f.place, to: actor, count, basis: "検証" },
      ],
    },
  });
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/worlds/${f.world}/session?actorId=${actor}`,
      headers: { cookie: f.people[0]!.cookie, "x-gestaloka-request": "1" },
      payload: move(herbs.id, 4),
    });
    expect(response.statusCode, response.body).toBe(409);
    const expected = {
      code: "INVENTORY_CAPACITY_EXCEEDED",
      capacity: {
        holderId: actor,
        usedSlots: 30,
        limitSlots: 30,
        projectedSlots: 31,
      },
      item: { itemId: herbs.id, requestedCount: 4, maxAcceptableCount: 3 },
    };
    expect(response.json()).toMatchObject(expected);
    const profile = join(cli.directory, "inventory.json");
    const connection = await cli.run(
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
          connection.userCode,
          `actor:${actor}`,
        )
      ).statusCode,
    ).toBe(302);
    const file = join(cli.directory, "pickup.json");
    await writeFile(file, JSON.stringify(move(herbs.id, 4)));
    expect(
      await cli.run(profile, "play", "--file", file, "--full-ids"),
    ).toMatchObject(expected);
    await expect(f.send(0, move(stone.id))).rejects.toMatchObject({
      code: expected.code,
    });
    expect(f.calls).not.toHaveBeenCalled();
    expect((await f.status(0)).callsUsed).toBe(0);
    await f.send(0, move(herbs.id, 3));
    expect(await readBelongings(f.store.context(f.graph), actor)).toMatchObject(
      {
        capacity: { usedSlots: 30, limitSlots: 30 },
        items: expect.arrayContaining([
          expect.objectContaining({
            label: "薬草",
            count: 30,
            unitsPerSlot: 30,
            slots: 1,
          }),
        ]),
      },
    );
    await f.apply([
      { type: "remove", id: nodes[27]!.id },
      { type: "remove", id: nodes[28]!.id },
      { type: "update", id: heldHerbs.id, count: 90 },
    ]);
    await expect(
      f.send(0, {
        command: "update",
        text: "薬草を箱にまとめる",
        dependencies: [],
        operations: [
          {
            type: "move",
            item: heldHerbs.id,
            from: actor,
            to: nodes[0]!.id,
            count: 89,
            basis: "検証",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: expected.code,
      inventory: { item: { requestedCount: 89, maxAcceptableCount: 60 } },
    });
  } finally {
    await cli.close();
    await app.close();
  }
});

test("バンドルの枠、共同利用、取り出しを物品の同一性と同じ確定で扱う", async () => {
  const f = await fixture();
  const [actor, peer] = f.actors as [string, string];
  const create = (label: string, holder: string, count?: number) => ({
    type: "create",
    label,
    holder,
    count,
    basis: "検証",
  });
  const { changes } = await f.apply([
    ...[actor, peer].map((person) => ({
      type: "grant",
      storage: f.far,
      person,
      basis: "共用",
    })),
    create("杉材", f.far, 31),
    create("湿った杉材", f.far),
    create("空の箱", f.far),
    create("中身を入れる箱", f.far),
    create("資材", f.far, 420),
    create("杉材", actor, 31),
  ]);
  const [wood, wet, box, full, bulk, carried] = changes.nodes
    .filter((node) => node.kind === "existence")
    .map((node) => node.id) as [string, string, string, string, string, string];
  await f.apply([create("中身", full)]);
  const status: Change = { nodes: [], edges: [], revisions: [], endEdges: [] };
  mark(status, wood, "乾燥済み");
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    { commitId: randomUUID(), at: 0, changes: status },
  );
  await f.move(0, f.far);
  const context = () => f.store.context(f.graph);
  const edit = (i: number, body: object, requestId = randomUUID()) =>
    access.editInventoryBundle(
      f.people[i]!.id,
      f.world,
      InventoryBundleCommand.parse({ ...body, requestId, storageId: f.far }),
      f.actors[i],
    );
  const read = (i: number, id: string) =>
    access.inventoryContents(
      f.people[i]!.id,
      f.world,
      id,
      undefined,
      f.actors[i],
    );
  const capacity = () => context().inventorySlots(f.far);
  const original = await capacity();
  const calls = (await f.status(0)).callsUsed;
  expect((await context().inventoryLimits()).bundleSlots).toBe(15);
  const input = { action: "create", label: "木材", itemIds: [wood, wet] };
  await expect(edit(1, input)).rejects.toThrow("保管先へ移動");
  await expect(edit(2, input)).rejects.toThrow("登録した保管先");
  await expect(edit(0, { ...input, itemIds: [wood, bulk] })).rejects.toThrow(
    "15枠",
  );
  await expect(edit(0, { ...input, itemIds: [wood, full] })).rejects.toThrow(
    "中に品を持つ",
  );
  const request = randomUUID();
  const bundle = await edit(0, input, request);
  expect(bundle).toMatchObject({ itemCount: 2, normalSlots: 3 });
  expect(await edit(0, input, request)).toEqual(bundle);
  expect(await capacity()).toBe(original - 2);
  const bundleId = bundle.bundleId;
  await expect(
    edit(0, { action: "add", bundleId, itemIds: [bundleId] }),
  ).rejects.toThrow("直下にある品");
  expect((await read(1, bundleId)).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: wood, count: 31, states: ["乾燥済み"] }),
      expect.objectContaining({ id: wet }),
    ]),
  );
  await expect(read(2, bundleId)).rejects.toMatchObject({ status: 404 });
  await f.store.configureInventory(f.graph, true, { bundleSlots: 2 });
  await expect(
    edit(0, { action: "add", bundleId, itemIds: [box] }),
  ).rejects.toThrow("2枠");
  await f.store.configureInventory(f.graph, true, { bundleSlots: 4 });
  expect(
    await edit(0, { action: "add", bundleId, itemIds: [box] }),
  ).toMatchObject({ itemCount: 3, normalSlots: 4 });
  await expect(f.apply([create("追加の中身", box)])).rejects.toThrow(
    "物を入れられません",
  );
  expect((await f.status(0)).callsUsed).toBe(calls);
  const used = await capacity();
  await f.store.configureInventory(f.graph, true, {
    storageSlots: used,
    unitsPerSlot: 31,
  });
  expect((await context().inventoryBundles(f.far))[0]).toMatchObject({
    id: bundleId,
    itemCount: 3,
    normalSlots: 3,
  });
  await expect(
    edit(0, { action: "release", bundleId, itemId: wood }),
  ).rejects.toMatchObject({ code: "INVENTORY_CAPACITY_EXCEEDED" });
  await expect(edit(0, { action: "dissolve", bundleId })).rejects.toMatchObject(
    { code: "INVENTORY_CAPACITY_EXCEEDED" },
  );
  expect(await capacity()).toBe(used);
  const take = (item: string) =>
    f.send(0, {
      command: "update",
      text: "保管した品を手に取る",
      dependencies: [],
      operations: [
        { type: "move", item, from: f.far, to: actor, basis: "検証" },
      ],
    });
  await take(wood);
  expect(
    (await readBelongings(context(), actor)).items.map(({ id }) => id),
  ).toEqual(expect.arrayContaining([wood, carried]));
  expect(
    (
      await context().relations(wood, "status", "out", Number.MAX_SAFE_INTEGER)
    ).map(({ target }) => target),
  ).toContain(status.nodes[0]!.id);
  expect((await context().inventoryBundles(f.far))[0]?.itemCount).toBe(2);
  expect(await capacity()).toBe(used);
  await take(wet);
  expect((await context().inventoryBundles(f.far))[0]?.itemCount).toBe(1);
  await take(box);
  expect(await context().inventoryBundles(f.far)).toEqual([]);
  expect(await capacity()).toBe(used - 1);
  expect(f.calls).not.toHaveBeenCalled();
});

test("CLIのバンドル操作を再送し、照会と保管庫内の解除を行える", async () => {
  const f = await fixture(1);
  const actor = f.actors[0]!;
  const { changes } = await f.apply([
    { type: "grant", person: actor, storage: f.far, basis: "資料庫" },
    ...["板", "釘", "紐"].map((label) => ({
      type: "create",
      label,
      holder: f.far,
      basis: "検証",
    })),
  ]);
  await f.move(0, f.far);
  const [board, nail, cord] = changes.nodes.map(({ id }) => id) as [
    string,
    string,
    string,
  ];
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  try {
    const profile = join(cli.directory, "bundle-view.json");
    const connection = await cli.run(
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
          connection.userCode,
          `actor:${actor}`,
        )
      ).statusCode,
    ).toBe(302);
    const file = join(cli.directory, "bundle-request.json");
    const edit = async (body: object) => {
      await writeFile(file, JSON.stringify({ storageId: f.far, ...body }));
      return cli.run(profile, "bundle", "--file", file);
    };
    const created = await edit({
      action: "create",
      label: "小屋の建材",
      itemIds: [board, nail],
    });
    const bundleId = created.result.bundleId;
    expect(bundleId).toMatch(/^@/);
    expect(
      (await cli.run(profile, "recover", "--request", created.requestId))
        .result,
    ).toEqual(created.result);
    expect(
      (await edit({ action: "add", bundleId, itemIds: [cord] })).result
        .itemCount,
    ).toBe(3);
    const contents = (await cli.run(
      profile,
      "contents",
      "--target",
      bundleId,
    )) as { items: { id: string; label: string }[] };
    expect(contents.items.map((row) => row.label).sort()).toEqual(
      ["板", "紐", "釘"].sort(),
    );
    const nailId = contents.items.find((row) => row.label === "釘")!.id;
    expect(
      (await edit({ action: "release", bundleId, itemId: nailId })).result
        .itemCount,
    ).toBe(2);
    const read = () => readBelongings(f.store.context(f.graph), actor);
    expect((await read()).storages[0]?.capacity?.usedSlots).toBe(2);
    expect(
      (await edit({ action: "dissolve", bundleId })).result.itemCount,
    ).toBe(0);
    expect((await read()).storages[0]?.capacity?.usedSlots).toBe(3);
    expect((await f.status(0)).callsUsed).toBe(0);
  } finally {
    await cli.close();
    await app.close();
  }
});

test("本人は保管品と手持ちの使用枠を照合し、CLIで入れ子の中身をたどれる", async () => {
  const f = await fixture(2);
  const [actor, other] = f.actors as [string, string];
  const create = (label: string, holder: string, count?: number) => ({
    type: "create",
    label,
    holder,
    count,
    basis: "検証",
  });
  const { changes } = await f.apply([
    { type: "grant", person: actor, storage: f.far, basis: "検証" },
    create("外箱", f.far),
    create("独立した手持ち品", actor),
  ]);
  const outer = changes.nodes.find((node) => node.text === "外箱")!.id;
  const { changes: nested } = await f.apply([
    create("内箱", outer),
    ...Array.from({ length: 52 }, (_, index) =>
      create(`記録 ${index + 1}`, outer),
    ),
  ]);
  const inner = nested.nodes.find((node) => node.text === "内箱")!.id;
  await f.apply([create("針", inner, 31)]);

  // 既存世界では所持先の索引がまだない。確定済みの関係から再構築する。
  await f.store.driver.executeQuery(
    `MATCH (n:WorldNode {worldId:$world}) REMOVE n.inventoryHolder
     WITH count(n) AS cleared
     MATCH (g:WorldGuard {worldId:$world,key:'inventory'}) REMOVE g.inventoryHolderIndexed`,
    { world: f.graph },
  );
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  try {
    const profile = join(cli.directory, "contents.json");
    const connection = await cli.run(
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
          connection.userCode,
          `actor:${actor}`,
        )
      ).statusCode,
    ).toBe(302);
    const result = await cli.run(profile, "search", "--kind", "self");
    const storage = result.result.material.belongings.storages[0];
    expect(storage.items).toMatchObject([
      { label: "外箱", slots: 1, totalSlots: 56 },
    ]);
    expect(storage.items[0].totalSlots).toBe(storage.capacity.usedSlots);
    const read = (...args: string[]) => cli.run(profile, "contents", ...args);
    const target = ["--target", storage.items[0].id];
    const calls = (await f.status(0)).callsUsed;
    const first = await read(...target);
    expect(first.items).toHaveLength(50);
    const last = await read(...target, "--after", first.next);
    expect(last.items).toHaveLength(3);
    expect(last.next).toBeNull();
    const rows = [...first.items, ...last.items];
    expect(new Set(rows.map((row) => row.id)).size).toBe(53);
    expect(rows.reduce((sum, row) => sum + row.totalSlots, 0)).toBe(55);
    const child = rows.find((row) => row.label === "内箱");
    expect(child).toMatchObject({ slots: 1, totalSlots: 3 });
    expect(await read("--target", child.id)).toMatchObject({
      items: [{ label: "針", count: 31, slots: 2, totalSlots: 2 }],
      next: null,
    });
    expect((await f.status(0)).callsUsed).toBe(calls);
    const denied = await app.inject({
      url: `/api/worlds/${f.world}/inventory/contents?actorId=${other}&containerId=${inner}`,
      headers: { cookie: f.people[1]!.cookie },
    });
    expect(denied.statusCode).toBe(404);

    await f.apply([
      { type: "move", item: outer, from: f.far, to: actor, basis: "検証" },
    ]);
    const own = await readBelongings(f.store.context(f.graph), actor);
    expect(own.items.reduce((sum, row) => sum + (row.totalSlots ?? 0), 0)).toBe(
      own.capacity?.usedSlots,
    );
    expect(own.capacity?.usedSlots).toBe(57);
    expect(own.storages[0]?.capacity?.usedSlots).toBe(0);
    expect((await read(...target)).items).toEqual(first.items);
    expect(f.calls).not.toHaveBeenCalled();
  } finally {
    await cli.close();
    await app.close();
  }
});

test("箱による枠の節約を防ぎ、共同保管先の最後の1枠を原子的に確定する", async () => {
  const f = await fixture();
  const [a, b] = f.actors as [string, string];
  const create = (label: string, holder: string, count?: number) => ({
    type: "create",
    label,
    holder,
    count,
    basis: "検証",
  });
  const first = await f.apply([
    { type: "grant", person: a, storage: f.far, basis: "共同利用" },
    { type: "grant", person: b, storage: f.far, basis: "共同利用" },
    create("在庫", f.far, 4470),
    create("箱", a),
    create("工具", a),
    create("手持ち", a, 870),
    create("贈り物", b),
  ]);
  const [, box, tool, , gift] = first.changes.nodes.filter(
    (n) => n.kind === "existence",
  );
  const move = (item: string, from: string, to: string) => ({
    type: "move",
    item,
    from,
    to,
    basis: "検証",
  });
  await f.store.configureInventory(f.graph, true);
  await f.apply([move(tool!.id, a, box!.id)]);
  const ctx = () => f.store.context(f.graph);
  expect(await ctx().inventorySlots(a)).toBe(31);
  await expect(f.apply([create("新しい道具", a)])).rejects.toMatchObject({
    capacity: { usedSlots: 31, projectedSlots: 32, limitSlots: 30 },
  });
  await expect(f.apply([move(box!.id, a, f.far)])).rejects.toMatchObject({
    capacity: { usedSlots: 149, projectedSlots: 151, limitSlots: 150 },
  });
  expect(await ctx().inventorySlots(a)).toBe(31);
  await f.apply([{ type: "remove", id: tool!.id }]);
  expect(await ctx().inventorySlots(a)).toBe(30);
  const results = await Promise.allSettled([
    f.apply([move(box!.id, a, f.far)]),
    f.apply([move(gift!.id, b, f.far)]),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect(await ctx().inventorySlots(f.far)).toBe(150);
  expect(await ctx().inventorySlots(a)).toBe(
    results[0]!.status === "fulfilled" ? 29 : 30,
  );
  const stocked = await f.apply([create("採集品", f.actors[2]!, 897)]);
  const itemId = stocked.changes.nodes.find((n) => n.kind === "existence")!.id;
  await expect(
    f.send(2, {
      command: "update",
      text: "採集品を4個増やす",
      dependencies: [],
      operations: [{ type: "update", id: itemId, count: 901 }],
    }),
  ).rejects.toMatchObject({
    code: "INVENTORY_CAPACITY_EXCEEDED",
    inventory: { item: { itemId, requestedCount: 4, maxAcceptableCount: 3 } },
  });
  expect(f.calls).not.toHaveBeenCalled();
});

test("運営が世界ごとの容量を変更すると照会と既存在庫・合流の判定に反映される", async () => {
  const f = await fixture();
  const actor = f.actors[0]!,
    admin = await auth.person();
  const seeded = await f.apply([
    { type: "grant", person: actor, storage: f.place, basis: "保管庫" },
    { type: "create", holder: actor, label: "鉱石", count: 80, basis: "検証" },
    {
      type: "create",
      holder: f.place,
      label: "鉱石",
      count: 41,
      basis: "検証",
    },
  ]);
  const stock = seeded.changes.nodes.find(
    (node) => node.kind === "existence" && node.count === 41,
  )!;
  const old = f.store.context(f.graph);
  expect(await readBelongings(old, actor)).toMatchObject({
    capacity: { usedSlots: 3, limitSlots: 30 },
    storages: [{ id: f.place, capacity: { usedSlots: 2, limitSlots: 150 } }],
  });
  const configure = (
    inventoryLimits: {
      carrySlots?: number;
      storageSlots?: number;
      unitsPerSlot?: number;
    },
    inventoryCapacity?: boolean,
  ) =>
    auth.operations.execute(
      admin.id,
      randomUUID(),
      {
        operation: "worlds.configure",
        worldId: f.world,
        title: "容量の設定",
        description: "",
        reason: "隔離試験",
        published: false,
        accepting: false,
        ...(inventoryCapacity === undefined ? {} : { inventoryCapacity }),
        inventoryLimits,
      },
      { players: access.players },
    );
  await expect(
    configure({ carrySlots: 4, storageSlots: 2, unitsPerSlot: 20 }, true),
  ).resolves.toMatchObject({
    inventoryCapacity: true,
    inventoryLimits: { carrySlots: 4, storageSlots: 2, unitsPerSlot: 20 },
  });
  await expect(old.validate()).rejects.toThrow();
  const context = () => f.store.context(f.graph);
  expect(await readBelongings(context(), actor)).toMatchObject({
    capacity: { usedSlots: 4, limitSlots: 4 },
    storages: [{ id: f.place, capacity: { usedSlots: 3, limitSlots: 2 } }],
  });
  const take = () =>
    f.send(0, {
      command: "update",
      text: "鉱石を5個取り出す",
      dependencies: [],
      operations: [
        {
          type: "move",
          item: stock.id,
          from: f.place,
          to: actor,
          count: 5,
          basis: "検証",
        },
      ],
    });
  await expect(take()).rejects.toMatchObject({
    code: "INVENTORY_CAPACITY_EXCEEDED",
  });
  const carried = seeded.changes.nodes.find(
    (node) => node.kind === "existence" && node.count === 80,
  )!;
  await expect(
    f.send(0, {
      command: "update",
      text: "鉱石を20個預ける",
      dependencies: [],
      operations: [
        {
          type: "move",
          item: carried.id,
          from: actor,
          to: f.place,
          count: 20,
          basis: "検証",
        },
      ],
    }),
  ).rejects.toMatchObject({
    code: "INVENTORY_CAPACITY_EXCEEDED",
    inventory: {
      capacity: {
        holderId: f.place,
        usedSlots: 3,
        limitSlots: 2,
        projectedSlots: 4,
      },
    },
  });
  await expect(configure({ unitsPerSlot: 50 })).resolves.toMatchObject({
    inventoryCapacity: true,
    inventoryLimits: { carrySlots: 4, storageSlots: 2, unitsPerSlot: 50 },
  });
  await take();
  expect(await readBelongings(context(), actor)).toMatchObject({
    capacity: { usedSlots: 2, limitSlots: 4 },
    items: [{ label: "鉱石", count: 85, slots: 2, unitsPerSlot: 50 }],
    storages: [{ id: f.place, capacity: { usedSlots: 1, limitSlots: 2 } }],
  });
  const audit = await auth.operations.execute(
    admin.id,
    randomUUID(),
    {
      operation: "worlds.graph",
      worldId: f.world,
      query: { kind: "inventory", minCount: 1 },
    },
    { players: access.players },
  );
  expect(audit).toMatchObject({
    limits: { carrySlots: 4, storageSlots: 2, unitsPerSlot: 50 },
    holders: expect.arrayContaining([
      expect.objectContaining({ id: actor, usedSlots: 2, limitSlots: 4 }),
    ]),
  });
});

test("本人が手に持つ箱には、場所を問わず出し入れできる", async () => {
  const f = await fixture();
  const box = randomUUID(),
    shell = randomUUID(),
    actor = f.actors[0]!;
  const hold = (target: string) => ({
    id: randomUUID(),
    kind: "has" as const,
    source: actor,
    target,
    period: { from: 0 },
  });
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [
          { id: box, kind: "existence", text: "手提げの箱" },
          { id: shell, kind: "existence", text: "貝殻" },
        ],
        edges: [hold(box), hold(shell)],
        revisions: [],
        endEdges: [],
      },
    },
  );
  const move = (from: string, to: string) =>
    f.send(0, {
      command: "update",
      text: "箱に出し入れする",
      operations: [{ type: "move", item: shell, from, to, basis: "検証" }],
      dependencies: [],
    });
  const items = async (holder: string) =>
    (await readBelongings(f.store.context(f.graph), holder)).items.map(
      (i) => i.id,
    );
  await move(actor, box);
  expect(await items(box)).toEqual([shell]);
  expect(await items(actor)).toEqual([box]);
  await move(box, actor);
  expect(await items(actor)).toContain(shell);
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
    return answer(id, sure);
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
test("検索で発生した複数の物品は個数つきの1つの物品として現れ、同席者が観測し、後から来た人物が残りを拾う", async () => {
  const f = await fixture(),
    rule = randomUUID(),
    tool = randomUUID();
  const request = randomUUID(),
    world = f.graph,
    at = 0;
  await f.store.commit(
    await f.store.claim(world, request),
    f.store.context(world),
    {
      commitId: request,
      at,
      changes: {
        nodes: [
          {
            id: rule,
            kind: "script",
            text: "砂金の出現",
            spawn: {
              kind: "existence",
              species: "砂金",
              description: "小さな粒",
              probability: 1,
              count: 3,
            },
          },
          { id: tool, kind: "existence", text: "皿" },
        ],
        revisions: [],
        endEdges: [],
        edges: [
          {
            id: randomUUID(),
            kind: "status",
            role: "content",
            source: f.place,
            target: rule,
            period: { from: at },
          },
          {
            id: randomUUID(),
            kind: "status",
            role: "about",
            text: "spawn-hit",
            source: rule,
            target: f.place,
            period: { from: at },
          },
          {
            id: randomUUID(),
            kind: "status",
            role: "about",
            text: "spawn-at",
            source: rule,
            target: f.place,
            period: { from: at },
          },

          {
            id: randomUUID(),
            kind: "status",
            role: "about",
            text: "spawn-hold",
            source: rule,
            target: tool,
            period: { from: at },
          },
          {
            id: randomUUID(),
            kind: "has",
            source: f.actors[0]!,
            target: tool,
            period: { from: at },
          },
        ],
      },
    },
  );
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const query = { kind: "subject", targetId: f.place },
    body = { command: "search", query, requestId: randomUUID() };
  // The player still holds the required tool at the other site; a hit on it alone must not spawn anything there.
  await f.move(0, f.far);
  const depId = randomUUID(),
    dep = {
      id: randomUUID(),
      kind: "status" as const,
      role: "about" as const,
      text: "spawn-hit",
      source: rule,
      target: tool,
      period: { from: at },
    };
  await f.store.commit(
    await f.store.claim(world, depId),
    f.store.context(world),
    {
      commitId: depId,
      at,
      changes: { edges: [dep], nodes: [], revisions: [], endEdges: [] },
    },
  );
  expect(
    (await f.send(0, { command: "search", query: { kind: "self" } }))
      .appearances,
  ).toBeUndefined();
  await f.move(0, f.place);
  const found = await f.send(0, body);
  const items = found.appearances as { id: string }[];
  expect(found.appearanceText).toBeUndefined();
  expect((await f.status(1)).entries).toContainEqual(
    expect.objectContaining({
      payload: expect.objectContaining({
        entries: [
          expect.objectContaining({
            input: "出現",
            result: expect.objectContaining({
              sourceRequestId: body.requestId,
            }),
          }),
        ],
      }),
    }),
  );
  expect(items).toMatchObject([{ species: "砂金", count: 3 }]);
  expect(items).toHaveLength(1);
  // 出現を起こした検索が返した依存版のまま、現れた物の一部を拾える。残りはその場に残る。
  await f.send(0, {
    command: "update",
    text: "現れた物を拾う",
    dependencies: found.dependencies,
    operations: [
      {
        type: "move",
        from: null,
        to: f.actors[0],
        item: items[0]!.id,
        count: 1,
        basis: "拾う",
      },
    ],
  });
  expect(await f.send(0, body)).toEqual(found);
  // 次に現れた物品は、その場に残っている同じ物品へ足され、物品は増えない。状態が付いていても足される。
  // 落ちている数は、発生数3に同席するプレイヤー2人を掛けた6個を超えない。
  const state = randomUUID();
  await f.store.commit(
    await f.store.claim(world, state),
    f.store.context(world),
    {
      commitId: state,
      at,
      changes: {
        nodes: [{ id: state, kind: "script", text: "砂にまみれている" }],
        revisions: [],
        endEdges: [],
        edges: [
          {
            id: randomUUID(),
            kind: "status",
            role: "content",
            source: items[0]!.id,
            target: state,
            period: { from: at },
          },
        ],
      },
    },
  );
  const second = await f.send(0, { command: "search", query });
  expect(second.appearances).toMatchObject([{ id: items[0]!.id, count: 3 }]);
  expect(
    (await f.send(0, { command: "search", query })).appearances,
  ).toMatchObject([{ id: items[0]!.id, count: 1 }]);
  // 上限まで落ちている間は、検索しても現れない。
  const full = await f.send(0, { command: "search", query });
  expect(full.appearances).toBeUndefined();
  expect(JSON.stringify((await f.status(1)).entries)).toContain(items[0]!.id);
  expect(JSON.stringify((await f.status(2)).entries)).not.toContain(
    items[0]!.id,
  );
  // NPCとして担当される同席者は数えない。2個残して拾うと、上限3個まで1個だけ現れる。
  await isolated.databases.postgres.query(
    "INSERT INTO bot_npc(world_id,actor_id,controller,user_id,assignment_id) VALUES($1,$2,'bot',$3,$4)",
    [f.world, f.actors[1], f.people[1]!.id, randomUUID()],
  );
  await f.send(0, {
    command: "update",
    text: "4個拾う",
    dependencies: full.dependencies,
    operations: [
      {
        type: "move",
        from: null,
        to: f.actors[0],
        item: items[0]!.id,
        count: 4,
        basis: "拾う",
      },
    ],
  });
  expect(
    (await f.send(0, { command: "search", query })).appearances,
  ).toMatchObject([{ id: items[0]!.id, count: 1 }]);
  await f.send(0, { command: "finish" });
  await f.send(1, { command: "finish" });
  await f.move(2, f.place);
  const seen = await f.send(2, {
    command: "search",
    query: { kind: "surroundings" },
  });
  expect(seen.appearances).toBeUndefined();
  expect(JSON.stringify(seen.material)).toContain(items[0]!.id);
  const pickup = {
    command: "update",
    text: "拾う",
    dependencies: [],
    operations: [
      {
        type: "move",
        from: null,
        to: f.actors[2],
        item: items[0]!.id,
        basis: "拾う",
      },
    ],
  };
  await f.send(2, pickup);
  expect(
    (await readBelongings(f.store.context(world), f.actors[2]!)).items,
  ).toMatchObject([{ id: items[0]!.id, count: 3 }]);
  await expect(f.send(2, pickup)).rejects.toMatchObject({
    code: "HOLD_CHANGED",
  });
  expect(f.calls).not.toHaveBeenCalled();
});
test("発生用ノードごとの出現描写を検索結果と公開ログに返し、再送では確定済みの本文を使う", async () => {
  const f = await fixture();
  const groups = [
    {
      species: "羽のある番人",
      count: 2,
      texts: ["羽を広げて橋を覆う。", "斜面の脇に沿って並ぶ。"],
    },
    {
      species: "水辺の案内役",
      count: 1,
      texts: ["浅瀬の飛び石を順に指さす。"],
    },
  ].map(({ species, count, texts }) => ({
    rule: {
      id: randomUUID(),
      kind: "script" as const,
      text: species,
      spawn: {
        kind: "instant-npc" as const,
        species,
        description: species,
        count,
        probability: 1,
      },
    },
    candidates: texts.map((text) => ({
      id: randomUUID(),
      kind: "script" as const,
      text,
    })),
  }));
  const setup = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, setup),
    f.store.context(f.graph),
    {
      commitId: setup,
      at: 0,
      changes: {
        nodes: groups.flatMap(({ rule, candidates }) => [rule, ...candidates]),
        endEdges: [],
        edges: groups.flatMap(({ rule, candidates }) => [
          {
            id: randomUUID(),
            kind: "status",
            role: "content",
            source: f.place,
            target: rule.id,
            period: { from: 0 },
          },
          ...[
            { target: f.place, text: "spawn-hit" },
            ...candidates.map(({ id }) => ({
              target: id,
              text: "spawn-description",
            })),
          ].map(({ target, text }) => ({
            id: randomUUID(),
            kind: "status",
            role: "about",
            source: rule.id,
            target,
            text,
            period: { from: 0 },
          })),
        ]),
      },
    },
  );
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const body = {
    requestId: randomUUID(),
    command: "search",
    query: { kind: "subject", targetId: f.place },
  };
  const commit = f.store.commit.bind(f.store);
  vi.spyOn(f.store, "commit").mockImplementationOnce(async (...args) => {
    await commit(...args);
    throw new Error("検索結果の保存前に中断");
  });
  await expect(f.send(0, body)).rejects.toThrow("検索結果の保存前に中断");
  const event = await f.store
    .context(f.graph)
    .node(derivedId(body.requestId + ":appearance"));
  expect(event?.kind).toBe("event");
  const descriptions = event!.text.split("\n\n").slice(1);
  expect(descriptions).toHaveLength(groups.length);
  for (const { candidates } of groups)
    expect(
      descriptions.filter((text) =>
        candidates.some((candidate) => candidate.text === text),
      ),
    ).toHaveLength(1);

  const edit = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, edit),
    f.store.context(f.graph),
    {
      commitId: edit,
      at: 1,
      changes: {
        nodes: [],
        revisions: groups.flatMap(({ candidates }) =>
          candidates.map((candidate) => ({
            ...candidate,
            text: "編集後の候補",
          })),
        ),
        edges: [],
        endEdges: [],
      },
    },
  );
  const found = await f.send(0, body);
  expect(found.appearanceText).toBe(event!.text);
  expect(found.appearances).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ species: "羽のある番人", count: 2 }),
      expect.objectContaining({ species: "水辺の案内役", count: 1 }),
    ]),
  );
  expect(found.appearances).toHaveLength(2);
  expect(await f.send(0, body)).toEqual(found);
  const publicEntries = (await f.status(1)).entries.flatMap(
    ({ payload }) => payload.entries ?? [],
  );
  expect(
    publicEntries.filter(({ input }) => input === event!.text),
  ).toHaveLength(1);
  expect(
    (await f.status(2)).entries.flatMap(({ payload }) => payload.entries ?? []),
  ).not.toContainEqual(expect.objectContaining({ input: event!.text }));
  expect(f.calls).not.toHaveBeenCalled();
});

test("検索の外れは確定し、同じ場所と発生ルールの個体は再送しても一団に一度だけ加わる", async () => {
  const f = await fixture(),
    id = randomUUID(),
    rule = randomUUID(),
    hiddenLink = randomUUID();
  const node = {
    id: rule,
    kind: "script" as const,
    text: "水辺の動物",
    spawn: {
      kind: "instant-npc" as const,
      species: "鳥",
      description: "水辺で鳴く",
      minCount: 2,
      maxCount: 3,
      probability: 0,
    },
  };
  await f.store.commit(
    await f.store.claim(f.graph, id),
    f.store.context(f.graph),
    {
      at: 0,
      commitId: id,
      changes: {
        nodes: [node],
        revisions: [],
        endEdges: [],
        edges: [
          {
            id: randomUUID(),
            kind: "see",
            source: f.actors[0]!,
            target: rule,
            period: { from: 0 },
          },
          {
            id: randomUUID(),
            kind: "see",
            source: f.actors[0]!,
            target: f.place,
            period: { from: 0 },
            observation: {
              aspect: "桟橋の眺め",
              through: 0,
              sourceIds: [f.place, rule],
              pathIds: [],
            },
          },
          {
            id: hiddenLink,
            kind: "status",
            role: "content",
            source: f.place,
            target: rule,
            period: { from: 0 },
          },
          {
            id: randomUUID(),
            kind: "status",
            role: "about",
            text: "spawn-hit",
            source: rule,
            target: f.place,
            period: { from: 0 },
          },
        ],
      },
    },
  );
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const miss = {
    requestId: randomUUID(),
    command: "search",
    query: { kind: "subject", targetId: f.place },
  };
  const first = await f.send(0, miss);
  expect(first.appearances).toBeUndefined();
  // A recover request can replay a result stored before player projection existed.
  const oldResult = structuredClone(first) as {
    material: { states: unknown[] };
    dependencies: unknown[];
  };
  oldResult.material.states.push({
    node,
    relation: { id: randomUUID(), source: f.place, target: rule },
  });
  oldResult.dependencies.push(
    { key: "node:" + rule, version: 1 },
    { key: "edge:" + hiddenLink, version: 1 },
  );
  await isolated.databases.postgres.query(
    "UPDATE bot_request SET result=$2 WHERE id=$1",
    [miss.requestId, oldResult],
  );
  expect(await f.send(0, miss)).toEqual(first);
  const history = await f.send(0, {
    command: "search",
    query: { kind: "history" },
  });
  expect(JSON.stringify(history)).not.toContain(rule);
  expect(JSON.stringify(history)).not.toContain(hiddenLink);
  expect(
    (
      await f.send(0, {
        command: "search",
        query: { kind: "history", targetId: rule },
      })
    ).material,
  ).toEqual([]);
  const change = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, change),
    f.store.context(f.graph),
    {
      at: 1,
      commitId: change,
      changes: {
        nodes: [],
        edges: [],
        endEdges: [],
        revisions: [{ ...node, spawn: { ...node.spawn, probability: 1 } }],
      },
    },
  );
  expect(await f.send(0, miss)).toEqual(first);
  const uniform = vi.spyOn(Math, "random").mockReturnValue(0);
  const source = randomUUID(),
    hit = await f.send(0, { ...miss, requestId: source });
  expect(JSON.stringify(hit.material)).not.toContain(rule);
  expect(JSON.stringify(hit.dependencies)).not.toContain(rule);
  for (const targetId of [rule, randomUUID()]) {
    await expect(
      f.send(0, { command: "search", query: { kind: "subject", targetId } }),
    ).rejects.toMatchObject({
      code: "MATERIAL_NOT_AVAILABLE",
      message: "本人へ提供されている対象を指定してください",
    });
  }
  expect(hit.instantNpcs).toEqual(["鳥"]);
  expect(hit.appearances).toMatchObject([{ species: "鳥", count: 2 }]);
  const [group] = hit.appearances as { id: string }[];
  expect(await f.store.context(f.graph).node(group!.id)).toBeUndefined();
  await f.send(0, { command: "end-turn" });
  await f.send(1, { command: "end-turn" });
  expect((await f.status(1)).actorId).toBe(group!.id);
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    expect(JSON.parse(String(messages[1]!.content)).npc.count).toBe(2);
    return answer(id, { text: "岸に佇む" });
  });
  await access.botPlay.tickNpcs();
  await f.send(0, { command: "end-turn" });
  await expect(
    f.send(1, {
      command: "promote-npc",
      sourceRequestId: source,
      npcIndex: 0,
      description: "鳥を世話したい",
    }),
  ).rejects.toMatchObject({ code: "INSTANT_NPC_GROUP" });
  uniform.mockReturnValue(0.999);
  expect(await f.send(0, { ...miss, requestId: source })).toEqual(hit);
  const found = { ...miss, requestId: randomUUID() };
  const commit = f.store.commit.bind(f.store);
  vi.spyOn(f.store, "commit").mockImplementationOnce(async (...args) => {
    await commit(...args);
    throw new Error("同席の保存前に中断");
  });
  await expect(f.send(1, found)).rejects.toThrow("同席の保存前に中断");
  expect((await f.status(1)).characters).toContainEqual(
    expect.objectContaining({ actorId: group!.id, count: 2 }),
  );
  const three = await f.send(1, found);
  expect(three.appearances).toMatchObject([
    { id: group!.id, species: "鳥", count: 3 },
  ]);
  expect(await f.send(1, found)).toEqual(three);
  // その場に残る5羽と合わせて、発生数3に既定の倍率2を掛けた6羽を超えない。
  const topUp = { ...miss, requestId: randomUUID() };
  const sixth = await f.send(1, topUp);
  expect(sixth.appearances).toMatchObject([
    { id: group!.id, species: "鳥", count: 1 },
  ]);
  const full = await f.send(1, { ...miss, requestId: randomUUID() });
  expect(full.appearances).toBeUndefined();
  expect(
    (await f.status(1)).characters?.filter((p) => p.name === "鳥"),
  ).toMatchObject([{ actorId: group!.id, count: 6 }]);
  await expect(
    f.send(1, {
      command: "promote-npc",
      sourceRequestId: topUp.requestId,
      npcIndex: 0,
      description: "鳥を世話したい",
    }),
  ).rejects.toMatchObject({ code: "INSTANT_NPC_GROUP" });
  uniform.mockRestore();
  await f.send(1, { command: "end-turn" });
  expect((await f.status(1)).actorId).toBe(group!.id);
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { text: "岸に佇む" }),
  );
  await access.botPlay.tickNpcs();
  expect((await f.status(1)).actorId).toBe(f.actors[0]);
  expect(f.calls.mock.calls.map((c) => c[1])).toEqual([
    "world-server-npc",
    "world-server-npc",
  ]);
});
test("同名の別ルールと別の場所はそれぞれの一団を持ち、増加を見た同席者はその一団を指定できる", async () => {
  const f = await fixture(),
    setup = randomUUID();
  const rules = ["群れA", "群れB"].map((text) => ({
    id: randomUUID(),
    kind: "script" as const,
    text,
    spawn: {
      kind: "instant-npc" as const,
      species: "鳥",
      description: "木陰で鳴く",
      minCount: 1,
      maxCount: 4,
      probability: 1,
    },
  }));
  await f.store.commit(
    await f.store.claim(f.graph, setup),
    f.store.context(f.graph),
    {
      at: 0,
      commitId: setup,
      changes: {
        nodes: rules,
        revisions: [],
        endEdges: [],
        edges: rules.flatMap(({ id }) => [
          {
            id: randomUUID(),
            kind: "status",
            role: "content",
            source: f.place,
            target: id,
            period: { from: 0 },
          },
          ...[f.place, f.far].map((target) => ({
            id: randomUUID(),
            kind: "status",
            role: "about",
            text: "spawn-hit",
            source: id,
            target,
            period: { from: 0 },
          })),
        ]),
      },
    },
  );
  vi.spyOn(Math, "random").mockReturnValue(0);
  const find = async (actor: number, targetId: string) =>
    (
      await f.send(actor, {
        command: "search",
        query: { kind: "subject", targetId },
      })
    ).appearances as { id: string; count: number }[];
  const first = await find(0, f.place);
  expect(first).toHaveLength(2);
  expect(new Set(first.map((a) => a.id)).size).toBe(2);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  expect(await find(0, f.place)).toEqual(expect.arrayContaining(first));
  expect(
    (await f.status(1)).characters?.filter((p) => p.name === "鳥"),
  ).toMatchObject([{ count: 2 }, { count: 2 }]);
  await f.send(0, { command: "end-turn" });
  await expect(
    f.send(1, {
      command: "npc-action",
      npcId: first[0]!.id,
      text: "木陰で鳴く",
    }),
  ).resolves.toMatchObject({ outcome: { success: true } });
  const elsewhere = await find(2, f.far);
  expect(elsewhere).toMatchObject([{ count: 1 }, { count: 1 }]);
  expect(elsewhere.some((p) => first.some((a) => a.id === p.id))).toBe(false);
});
test("出現個体の発生用ノードへ結んだ取引は同席中だけ受領でき、代価を除いて品物を一度だけ作る", async () => {
  const f = await fixture(),
    buyer = f.actors[0]!,
    seriesId = randomUUID(),
    coin = randomUUID(),
    scrap = randomUUID();
  const script = (text: string, spawn: object) => ({
    id: randomUUID(),
    kind: "script" as const,
    text,
    spawn: { description: text, probability: 1, count: 1, ...spawn },
  });
  const seller = script("荷を背負った売り手", {
      kind: "instant-npc",
      species: "売り手",
    }),
    goods = script("籠から出して渡す", {
      kind: "existence",
      species: "干し果物",
      count: 3,
      price: { seriesId, label: "木札", count: 2 },
    });
  const setup = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, setup),
    f.store.context(f.graph),
    {
      commitId: setup,
      at: 0,
      changes: {
        nodes: [
          seller,
          goods,
          { id: coin, kind: "existence", text: "木札", count: 5, seriesId },
          { id: scrap, kind: "existence", text: "木札", count: 5 },
        ],
        revisions: [],
        endEdges: [],
        edges: [
          ...[coin, scrap].map((target) => ({ kind: "has", target })),
          { kind: "status", role: "content", target: seller.id },
          { kind: "status", role: "content", target: goods.id },
        ]
          .map((edge) => ({ source: buyer, ...edge }))
          .concat(
            [
              { source: seller.id, target: f.place, text: "spawn-hit" },
              { source: goods.id, target: seller.id, text: "spawn-trade" },
            ].map((edge) => ({ kind: "status", role: "about", ...edge })),
          )
          .map((edge) => ({
            ...edge,
            id: randomUUID(),
            period: { from: 0 },
          })) as never,
      },
      management: {
        editorId: (await auth.person()).id,
        reason: "代価の系列を指定",
        requestHash: "c".repeat(64),
      },
    },
  );
  await f.send(1, { command: "contact", targetId: buyer });
  const surroundings = { command: "search", query: { kind: "surroundings" } };
  // 個体が現れた検索の応答に、その個体の取引が並ぶ。
  const listed = await f.send(0, surroundings);
  const [npc] = listed.appearances as { id: string }[];
  expect(JSON.stringify(listed)).not.toContain(goods.id);
  expect(listed.exchangeOffers).toMatchObject([
    {
      sellerId: npc!.id,
      itemLabel: "干し果物：籠から出して渡す",
      count: 3,
      paymentSeriesId: seriesId,
      paymentLabel: "木札",
      paymentCount: 2,
    },
  ]);
  const offerId = (listed.exchangeOffers as { id: string }[])[0]!.id;
  const exchange = (paymentItemId: string) => ({
    command: "exchange",
    offerId,
    paymentItemId,
    requestId: randomUUID(),
  });
  await expect(f.send(0, exchange(scrap))).rejects.toMatchObject({
    code: "EXCHANGE_PAYMENT",
  });
  const order = exchange(coin),
    bought = await f.send(0, order);
  expect(bought).toMatchObject({ state: "accepted", offerId });
  expect(await f.send(0, order)).toEqual(bought);
  const items = (await readBelongings(f.store.context(f.graph), buyer)).items;
  expect(items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: coin, count: 3 }),
      expect.objectContaining({ id: scrap, count: 5 }),
      expect.objectContaining({
        label: "干し果物：籠から出して渡す",
        count: 3,
      }),
    ]),
  );
  expect(items).toHaveLength(3);
  await f.send(0, { command: "end-turn" });
  await f.send(1, { command: "end-turn" });
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    expect(JSON.parse(String(messages[1]!.content)).trades).toEqual([
      {
        itemLabel: "干し果物：籠から出して渡す",
        count: 3,
        paymentLabel: "木札",
        paymentCount: 2,
        text: "籠から出して渡す",
      },
    ]);
    return answer(id, { text: "荷をまとめて去る", departs: true });
  });
  await access.botPlay.tickNpcs();
  await expect(f.send(0, exchange(coin))).rejects.toMatchObject({
    code: "EXCHANGE_NOT_AVAILABLE",
  });
  expect(f.calls.mock.calls.map((c) => c[1])).toEqual(["world-server-npc"]);
});
test("別の場所へ移って手番を終えた人物は別のセッションになり、出現個体はその場所のセッションに残る", async () => {
  const f = await fixture(),
    source = randomUUID(),
    bird = derivedId(source + ":manual:0");
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  await f.send(0, {
    command: "say",
    requestId: source,
    text: "鳥が降りてきた",
    instantNpcs: ["鳥"],
  });
  const peck = async (i: number) => {
    f.calls.mockImplementationOnce(async (id) =>
      answer(id, { text: "地面をつつく" }),
    );
    await access.botPlay.tickNpcs();
    expect((await f.status(i)).actorId).toBe(f.actors[i]);
  };
  const ids = (status: { characters?: { actorId: string }[] }) =>
    status.characters!.map((c) => c.actorId);
  expect((await f.send(0, { command: "end-turn" })).actorId).toBe(f.actors[1]);
  await f.move(1, f.far);
  await f.send(1, { command: "end-turn" });
  const stay = await f.status(0),
    moved = await f.status(1);
  expect(moved.sessionId).not.toBe(stay.sessionId);
  expect(ids(moved)).toEqual([f.actors[1]]);
  expect(moved.actorId).toBe(f.actors[1]);
  expect(ids(stay)).toEqual([f.actors[0], bird]);
  expect(stay.actorId).toBe(f.actors[0]);
  expect((await f.send(0, { command: "end-turn" })).actorId).toBe(bird);
  await peck(0);
  await f.move(0, f.far);
  expect(ids(await f.send(0, { command: "end-turn" }))).toEqual([f.actors[0]]);
});
test("出現個体は同席者が一巡するごとに人数まで続きから動き、同じ対象への作用は前回の状態を置き換える", async () => {
  const f = await fixture(),
    source = randomUUID(),
    seed = randomUUID(),
    wheel = randomUUID(),
    intact = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, seed),
    f.store.context(f.graph),
    {
      at: 0,
      commitId: seed,
      changes: {
        nodes: [
          { id: wheel, kind: "existence", text: "水車" },
          { id: intact, kind: "script", text: "羽根は無傷" },
        ],
        edges: [
          {
            id: randomUUID(),
            kind: "status",
            role: "content",
            source: wheel,
            target: intact,
            period: { from: 0 },
          },
        ],
        revisions: [],
        endEdges: [],
      },
    },
  );
  await f.apply([
    { type: "locate", subjectId: wheel, text: "広場", aboutIds: [f.place] },
  ]);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  await f.send(0, {
    command: "say",
    requestId: source,
    text: "鳥たちが降りてきた",
    instantNpcs: ["鳥", "鴨", "鷺"],
  });
  const [bird, duck, heron] = [0, 1, 2].map((i) =>
    derivedId(`${source}:manual:${i}`),
  );
  const act = async (text: string, mark?: string) => {
    f.calls.mockImplementationOnce(async (id) =>
      answer(
        id,
        mark ? { text, effect: { targetId: wheel, state: mark } } : { text },
      ),
    );
    if (mark)
      f.calls.mockImplementationOnce(async (id) =>
        answer(id, { ...sure, observable: mark }),
      );
    await access.botPlay.tickNpcs();
    return (await f.status(0)).actorId;
  };
  // 2人が一巡すると、3体のうち2体までが動き、次の巡は続きの個体から動く。
  expect((await f.send(0, { command: "end-turn" })).actorId).toBe(f.actors[1]);
  expect((await f.send(1, { command: "end-turn" })).actorId).toBe(bird);
  expect(await act("羽根をつつく", "羽根につつき跡が一つある")).toBe(duck);
  expect(await act("水辺で休む")).toBe(f.actors[0]);
  expect((await f.send(0, { command: "end-turn" })).actorId).toBe(f.actors[1]);
  expect((await f.send(1, { command: "end-turn" })).actorId).toBe(heron);
  expect(await act("首を伸ばす")).toBe(bird);
  expect(await act("羽根をつつく", "羽根につつき跡が二つある")).toBe(
    f.actors[0],
  );
  const context = f.store.context(f.graph);
  const states = await Promise.all(
    (await context.relations(wheel, "status", "out", Number.MAX_SAFE_INTEGER))
      .filter((e) => e.text !== "location")
      .map(async (e) => (await context.node(e.target))?.text),
  );
  expect(states.sort()).toEqual(
    ["羽根につつき跡が二つある", "羽根は無傷"].sort(),
  );
});
test.each([false, true])(
  "出現場所の全員が移ると、確定直後に個体が外れて同じ手番が続く（同行者あり: %s）",
  async (withCompanion) => {
    const f = await fixture(),
      source = randomUUID(),
      bird = derivedId(source + ":manual:0");
    const travelers = withCompanion ? [0, 1] : [0];
    if (withCompanion)
      await f.send(1, { command: "contact", targetId: f.actors[0] });
    f.calls.mockImplementationOnce(async (id) => answer(id, sure));
    const before = await f.send(0, {
      command: "say",
      requestId: source,
      text: "鳥が降りてきた",
      instantNpcs: ["鳥"],
    });
    await f.send(0, {
      command: "npc-action",
      npcId: bird,
      text: "鳥が地面をつつく",
    });

    let moved = await f.send(0, {
      command: "update",
      text: "離れた場所へ行く",
      dependencies: [],
      operations: travelers.map((i) => ({
        type: "locate",
        subjectId: f.actors[i],
        text: "離れた場所",
        aboutIds: [f.far],
      })),
    });
    if (withCompanion) {
      expect(moved.state).toBe("receiving");
      expect((await f.status(0)).characters).toContainEqual(
        expect.objectContaining({ actorId: bird }),
      );
      moved = await f.send(1, {
        command: "receive",
        applicationId: moved.applicationId,
        accept: true,
      });
      expect(moved.application).toMatchObject({ state: "confirmed" });
    } else {
      expect(moved.state).toBe("accepted");
    }
    const ids = travelers.map((i) => f.actors[i]);
    expect(await f.store.context(f.graph).locationSubjects(f.far)).toEqual(
      expect.arrayContaining(ids),
    );
    expect(moved).toMatchObject({
      sessionId: before.sessionId,
      turn: before.turn,
      actorId: f.actors[0],
      characters: ids.map((actorId) => ({ actorId })),
    });
    for (const i of travelers)
      expect((await f.status(i)).characters!.map((c) => c.actorId)).toEqual(
        ids,
      );
    const { rows } = await isolated.databases.postgres.query(
      "SELECT closed FROM bot_scene WHERE id=$1",
      [bird],
    );
    expect(rows).toEqual([{ closed: true }]);

    await f.send(0, { command: "end-turn" });
    expect((await f.status(0)).entries).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ actorId: bird, label: "鳥" }),
          ]),
        }),
      }),
    );
  },
);
test("同行者の所在をまとめて申請すると承認した人だけが移り、出現個体は元の場所に残る", async () => {
  const f = await fixture();
  await f.move(2, f.place);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  await f.send(2, { command: "contact", targetId: f.actors[0] });
  const source = randomUUID(),
    bird = derivedId(source + ":manual:0");
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  await f.send(0, {
    command: "say",
    requestId: source,
    text: "鳥が降りてきた",
    instantNpcs: ["鳥"],
  });
  const go = (i: number) => ({
    type: "locate",
    subjectId: f.actors[i],
    text: "離れた場所",
    aboutIds: [f.far],
  });
  const asked = await f.send(0, {
    command: "update",
    text: "みんなで離れた場所へ行く",
    dependencies: [],
    operations: [go(0), go(1), go(2)],
  });
  expect(asked.state).toBe("receiving");
  await f.send(1, {
    command: "receive",
    applicationId: asked.applicationId,
    accept: true,
  });
  const declined = await f.send(2, {
    command: "receive",
    applicationId: asked.applicationId,
    accept: false,
  });
  expect(declined.application).toMatchObject({
    state: "confirmed",
    message: expect.stringContaining("承認した人だけ移動"),
  });
  expect(declined.action).toMatchObject({
    message: expect.stringContaining("あなたは移動しません"),
  });
  const there = await f.store.context(f.graph).locationSubjects(f.far);
  expect(there).toEqual(expect.arrayContaining([f.actors[0], f.actors[1]]));
  expect(there).not.toContain(f.actors[2]);
  const a = await f.status(0),
    b = await f.status(1),
    c = await f.status(2);
  expect(a.sessionId).toBe(b.sessionId);
  expect(c.sessionId).not.toBe(a.sessionId);
  expect(a.characters!.map((m) => m.actorId)).toEqual([
    f.actors[0],
    f.actors[1],
  ]);
  expect(c.characters!.map((m) => m.actorId)).toEqual([f.actors[2], bird]);
  expect(c.actorId).toBe(f.actors[2]);
});
test.each([
  { approvals: [2, 3], alone: false, legacy: false, moved: [0, 2, 3] },
  { approvals: [], alone: false, legacy: false, moved: [] },
  { approvals: [], alone: true, legacy: false, moved: [0] },
  { approvals: [1], alone: false, legacy: true, moved: [] },
])(
  "同席の出発申請をCLIで試遊する（$moved・旧形式 $legacy）",
  async ({ approvals, alone, legacy, moved }) => {
    const f = await fixture(5);
    await f.move(2, f.place);
    for (const i of [1, 2, 3, 4])
      await f.send(i, { command: "contact", targetId: f.actors[0] });
    const app = await createApp(
      access,
      auth.identity,
      undefined,
      auth.operations,
    );
    const cli = await playerCli(app);
    try {
      const profile = join(cli.directory, "sender.json");
      const connection = await cli.run(
        profile,
        "connect",
        "--server",
        cli.base,
        "--world",
        f.world,
      );
      await cli.approve(
        f.people[0]!.cookie,
        connection.userCode,
        "actor:" + f.actors[0],
      );
      const file = join(cli.directory, "departure.json");
      await writeFile(
        file,
        JSON.stringify({
          command: "apply",
          expectedSp: 0,
          action: {
            type: "direct",
            text: "一緒に離れた場所へ出発する",
            operations: f.actors.slice(0, 4).map((subjectId) => ({
              type: "locate",
              subjectId,
              text: "離れた場所",
              aboutIds: [f.far],
            })),
          },
          dependencies: [],
        }),
      );
      const submitted = await cli.run(
        profile,
        "play",
        "--full-ids",
        "--file",
        file,
        ...(alone ? ["--depart-alone-on-timeout"] : []),
      );
      const { applicationId } = submitted.result.receiving;
      const { deadline } = (await f.status(0)).receiving!;
      if (legacy)
        await isolated.databases.postgres.query(
          "UPDATE bot_session SET data=data #- '{receiving,parallel}' WHERE id=$1",
          [submitted.result.sessionId],
        );
      const watch = (i: number) =>
        access.waiting(
          f.people[i]!.id,
          f.world,
          f.actors[i],
          undefined,
          true,
          true,
          true,
        );
      const waiting = await watch(3);
      if (legacy) expect(waiting).toMatchObject({ actionable: false });
      else
        expect(waiting).toMatchObject({
          actionable: true,
          state: "receiving",
          context: {
            receiving: {
              applicationId,
              text: "一緒に離れた場所へ出発する",
              deadline,
            },
          },
        });
      expect(await watch(4)).toMatchObject({ actionable: false });
      expect((await watch(4)).context).not.toHaveProperty("receiving");
      await Promise.all(
        approvals.map((i) =>
          f.send(i, {
            command: "receive",
            applicationId,
            accept: true,
          }),
        ),
      );
      const { progress } = (await f.status(0)).receiving!;
      if (legacy) {
        expect(progress).toBeUndefined();
        expect(await watch(2)).toMatchObject({ actionable: true });
      } else {
        expect(progress).toEqual({
          approved: approvals.length,
          declined: 0,
          pending: 3 - approvals.length,
        });
        if (approvals.length)
          expect(await watch(2)).toMatchObject({ actionable: false });
      }

      vi.spyOn(access.botPlay, "now").mockReturnValue(new Date(deadline));
      const late = f.send(legacy ? 2 : 1, {
        command: "receive",
        applicationId,
        accept: true,
      });
      await Promise.all([
        expect(late).rejects.toMatchObject({ code: "RECEIVING_TURN_REQUIRED" }),
        access.botPlay.expire(f.world),
      ]);

      const context = f.store.context(f.graph);
      const there = await context.locationSubjects(f.far);
      const here = await context.locationSubjects(f.place);
      expect(f.actors.filter((id) => there.includes(id))).toEqual(
        moved.map((i) => f.actors[i]),
      );
      expect(f.actors.filter((id) => here.includes(id))).toEqual(
        f.actors.filter((_, i) => !moved.includes(i)),
      );
      const states = await Promise.all(f.actors.map((_, i) => f.status(i)));
      for (const state of states) expect(state.receiving).toBeNull();
      for (const i of moved)
        expect(states[i]!.sessionId).toBe(states[0]!.sessionId);
      if (moved.length)
        expect(states[1]!.sessionId).not.toBe(states[0]!.sessionId);
      for (const i of [0, 1, 2, 3]) {
        const results = states[i]!.entries.flatMap(({ payload }) =>
          payload.receiptResult?.applicationId === applicationId
            ? [payload.receiptResult]
            : [],
        );
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
          outcome: moved.length ? "accepted" : "expired",
        });
      }
    } finally {
      await cli.close();
      await app.close();
    }
  },
);

test("チームは別々に到着しても先着者の進行で続き、合流前の記録は本人にだけ残る", async () => {
  const f = await fixture();
  const [scout, follower, local] = f.actors as [string, string, string];
  await f.send(1, { command: "contact", targetId: scout });
  const requestId = randomUUID();
  await expect(
    f.send(2, { command: "team-join", teamId: requestId }),
  ).rejects.toMatchObject({ code: "TEAM_INVITE_REQUIRED" });
  const invite = { command: "team-invite", targetId: follower, requestId };
  const [invited, retried] = await Promise.all([
    f.send(0, invite),
    f.send(0, invite),
  ]);
  expect(retried.team).toEqual(invited.team);
  expect(
    (await f.send(1, { command: "team-status" })).invitations,
  ).toMatchObject([{ teamId: requestId, inviter: { actorId: scout } }]);
  await f.send(1, { command: "team-join", teamId: requestId });
  const move = (i: number) =>
    f.send(i, {
      command: "update",
      text: "橋の向こうへ渡る",
      dependencies: [],
      operations: [
        {
          type: "locate",
          subjectId: f.actors[i],
          text: "橋の向こう",
          aboutIds: [f.far],
        },
      ],
    });
  const followerBefore = await f.status(1);
  await move(0);
  await f.send(0, { command: "end-turn" });
  await f.send(0, { command: "contact", targetId: local });
  const anchor = await f.status(2);
  await f.send(2, { command: "say", text: "合流前の話" });
  await f.send(2, { command: "comment", text: "合流前のコメント" });
  const receipt = await f.send(2, {
    command: "memo",
    text: "合流前のメモ",
    participants: [scout],
    dependencies: [],
  });
  expect(await move(1)).toMatchObject({
    sessionId: anchor.sessionId,
    actorId: scout,
    turn: anchor.turn,
    teamArrival: { state: "joined", sessionId: anchor.sessionId },
  });
  expect((await f.status(1)).sceneId).toBe(followerBefore.sceneId);
  await f.send(0, {
    command: "receive",
    applicationId: receipt.applicationId,
    accept: true,
  });
  await f.send(2, { command: "say", text: "橋の板が一枚抜けている" });
  await f.send(2, { command: "end-turn" });
  const after = await f.status(1);
  expect(JSON.stringify(after.entries)).toContain("橋の板が一枚抜けている");
  expect(JSON.stringify(after.entries)).not.toContain("合流前の話");
  expect(JSON.stringify(after.entries)).not.toContain("合流前のコメント");
  expect(JSON.stringify(after.entries)).not.toContain("合流前のメモ");
  expect((await f.send(1, { command: "team-leave" })).team).toBeNull();
  expect((await f.status(1)).sessionId).toBe(anchor.sessionId);
  expect(f.calls).not.toHaveBeenCalled();
});

test("チーム合流は元の受領判断を待ち、残る人物の手番を続ける", async () => {
  const f = await fixture();
  const [anchor, member, local] = f.actors as [string, string, string];
  await f.move(2, f.place);
  await f.send(2, { command: "contact", targetId: member });
  const first = await f.status(0);
  const second = await f.status(1);
  const receipt = await f.send(1, {
    command: "memo",
    text: "橋の補修を手伝う",
    participants: [local],
    dependencies: [],
  });
  const teamId = randomUUID();
  await f.send(0, {
    command: "team-invite",
    targetId: member,
    requestId: teamId,
  });
  expect(await f.send(1, { command: "team-join", teamId })).toMatchObject({
    teamArrival: { state: "waiting", sessionId: first.sessionId },
  });
  expect((await f.status(1)).sessionId).toBe(second.sessionId);
  const accepted = await f.send(2, {
    command: "receive",
    applicationId: receipt.applicationId,
    accept: true,
  });
  expect(accepted).toMatchObject({
    sessionId: second.sessionId,
    actorId: local,
    application: { state: "confirmed" },
  });
  expect(await f.status(1)).toMatchObject({
    sessionId: first.sessionId,
    sceneId: second.sceneId,
    actorId: anchor,
  });
});

test("同じ地点でチームが別々のセッションにいたら先着側で続ける", async () => {
  const f = await fixture();
  const teamId = randomUUID();
  await f.send(0, {
    command: "team-invite",
    targetId: f.actors[1],
    requestId: teamId,
  });
  await f.send(1, { command: "team-join", teamId });
  const first = await f.status(0);
  const separated = await f.send(1, { command: "leave" });
  expect(separated.sessionId).not.toBe(first.sessionId);
  await f.send(0, { command: "team-invite", targetId: f.actors[2] });
  await f.send(2, { command: "team-join", teamId });
  const arrived = await f.send(2, {
    command: "update",
    text: "広場へ向かう",
    dependencies: [],
    operations: [
      {
        type: "locate",
        subjectId: f.actors[2],
        text: "広場",
        aboutIds: [f.place],
      },
    ],
  });
  expect(arrived.sessionId).toBe(first.sessionId);
  expect((await f.status(1)).sessionId).toBe(first.sessionId);
});

test("CLIは招待を受けた本人が短縮IDでチームに加入し、離脱できる", async () => {
  const f = await fixture();
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  const run = (i: number, ...args: string[]) =>
    cli.run(join(cli.directory, `team-${i}.json`), ...args);
  try {
    for (const i of [0, 1]) {
      const connection = await run(
        i,
        "connect",
        "--server",
        cli.base,
        "--world",
        f.world,
      );
      await cli.approve(
        f.people[i]!.cookie,
        connection.userCode,
        `actor:${f.actors[i]}`,
      );
    }
    expect(
      await run(0, "team", "invite", "--target", f.actors[1]!),
    ).toMatchObject({
      result: { team: { members: [{ name: "人物0" }] } },
    });
    const status = await run(1, "team", "status");
    const teamId = status.result.invitations[0].teamId;
    expect(teamId).toMatch(/^@[a-f0-9]+$/);
    expect(await run(1, "team", "join", "--team", teamId)).toMatchObject({
      result: {
        team: { teamId, members: [{ name: "人物0" }, { name: "人物1" }] },
        teamArrival: { state: "joined" },
      },
    });
    expect(await run(1, "team", "leave")).toMatchObject({
      result: { team: null },
    });
  } finally {
    await cli.close();
    await app.close();
  }
});

test("到着処理を待っている間も期限処理とNPC手番を進める", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const play = {
    deliverArrivals: vi.fn(() => pending),
    expire: vi.fn(async () => {}),
    tickNpcs: vi.fn(async () => {}),
  };
  const stop = await startPlayLoop(play);
  try {
    await vi.waitFor(
      () => expect(play.deliverArrivals).toHaveBeenCalledOnce(),
      {
        timeout: 5000,
      },
    );
    await vi.waitFor(() => expect(play.tickNpcs).toHaveBeenCalledTimes(2), {
      timeout: 5000,
    });
    expect(play.expire).toHaveBeenCalledTimes(2);
    expect(play.deliverArrivals).toHaveBeenCalledOnce();
  } finally {
    release();
    await stop();
  }
});

test.each([false, true])(
  "NPCの対抗判定中のワーカー交換（待機上限超過=%s）",
  async (timeout) => {
    const f = await fixture(),
      source = randomUUID();
    await f.send(1, { command: "contact", targetId: f.actors[0] });
    f.calls.mockImplementationOnce(async (id) => answer(id, sure));
    await f.send(0, {
      command: "say",
      requestId: source,
      text: "鳥が飛んできた",
      instantNpcs: ["鳥"],
    });
    await f.send(0, { command: "end-turn" });
    const { sessionId, turn } = await f.send(1, { command: "end-turn" });
    const bird = derivedId(source + ":manual:0");
    const request = derivedId(`instant:${sessionId}:${bird}:${turn}`);
    let release!: () => void,
      diceCalls = 0;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const db = isolated.databases.postgres;
    const model = new LlmClient(
      db,
      modelEnvironment(randomUUID()),
      approvedTransport(async () => {
        diceCalls++;
        await gate;
        return Response.json({
          id: randomUUID(),
          model: "gemini-3.8-flash",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({ ...sure, observable: null }),
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }),
    );
    await model.ledger.setup();
    f.calls.mockImplementation((...args) =>
      args[1] === "world-server-npc"
        ? Promise.resolve(
            answer(args[0], {
              text: "帽子に触れる",
              effect: { targetId: f.actors[0], state: "帽子が揺れる" },
            }),
          )
        : model.complete(...args),
    );
    const path = workerSocket(process.pid);
    let paused = () => false;
    const play = {
      deliverArrivals: () => access.botPlay.deliverArrivals(f.world),
      expire: () => access.botPlay.expire(f.world),
      tickNpcs: (_?: string, stopping = () => false) => {
        paused = stopping;
        return access.botPlay.tickNpcs(f.world, stopping);
      },
    };
    let stop = await startPlayLoop(play, path);
    let replaced = false;
    const ledger = () =>
      db.query(
        "SELECT state,response IS NOT NULL AS saved FROM llm_call WHERE response_id=$1 AND request->>'role'='world-opposition-dice'",
        [request],
      );
    try {
      await vi.waitFor(() => expect(diceCalls).toBe(1), { timeout: 10000 });
      expect((await ledger()).rows).toEqual([
        { state: "pending", saved: false },
      ]);
      const hold = spawn(process.execPath, [
        resolve("apps/worker/dist/deployment.js"),
        "hold",
        path,
      ]);
      const deployment = withDrainedWorker(
        hold,
        async () => {
          expect((await ledger()).rows).toEqual([
            { state: "complete", saved: true },
          ]);
          expect((await f.status(1)).actorId).toBe(f.actors[0]);
          await stop();
          stop = await startPlayLoop(play, path);
          replaced = true;
        },
        timeout ? 1200 : 10000,
      );
      const completed = timeout
        ? expect(deployment).rejects.toThrow("待ちが上限")
        : deployment;
      await vi.waitFor(() => expect(paused()).toBe(true));
      expect(replaced).toBe(false);
      if (timeout) {
        await completed;
        await vi.waitFor(() => expect(paused()).toBe(false));
        expect((await f.status(1)).actorId).toBe(bird);
      }
      release();
      await completed;
      await vi.waitFor(
        async () => expect((await f.status(1)).actorId).toBe(f.actors[0]),
        { timeout: 10000 },
      );
      await access.botPlay.tickNpcs(f.world);
      expect(replaced).toBe(!timeout);
      expect(diceCalls).toBe(1);
      expect((await ledger()).rows).toEqual([
        { state: "complete", saved: true },
      ]);
      expect(await f.store.receipt(f.graph, request)).toBeDefined();
      const status = await f.status(1);
      expect(status.turn).toBe(Number(turn) + 1);
      expect(
        status.entries.filter(
          ({ payload }) =>
            payload.transition?.turn === turn &&
            payload.transition.actorId === bird &&
            payload.transition.type === "turn-ended",
        ),
      ).toHaveLength(1);
    } finally {
      release();
      await stop();
    }
  },
);

test("出現個体の手番中は本人だけが動き、外界への作用と昇格前の経験を引き継ぐ", async () => {
  const f = await fixture(),
    admin = await auth.person(),
    source = randomUUID();
  const intact = randomUUID(),
    wheel = randomUUID(),
    seed = randomUUID(),
    bear = derivedId(source + ":manual:0");
  await f.store.commit(
    await f.store.claim(f.graph, seed),
    f.store.context(f.graph),
    {
      at: 0,
      commitId: seed,
      changes: {
        nodes: [
          { id: wheel, kind: "existence", text: "水車" },
          { id: intact, kind: "script", text: "羽根は無傷" },
        ],
        edges: [
          {
            id: randomUUID(),
            kind: "status",
            role: "content",
            source: wheel,
            target: intact,
            period: { from: 0 },
          },
          {
            id: randomUUID(),
            kind: "has",
            source: f.actors[2]!,
            target: wheel,
            period: { from: 0 },
          },
        ],
        revisions: [],
        endEdges: [],
      },
    },
  );
  await f.apply([
    { type: "locate", subjectId: wheel, text: "広場", aboutIds: [f.place] },
  ]);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  await f.send(0, { command: "say", text: "登場前の会話" });
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  const appeared = await f.send(0, {
    command: "say",
    requestId: source,
    text: "クマが足を止めた",
    instantNpcs: ["クマ", "別のクマ"],
  });
  expect(appeared.characters).toEqual(
    expect.arrayContaining([{ actorId: bear, name: "クマ", icon: null }]),
  );
  const unreachable = {
    command: "npc-action",
    requestId: randomUUID(),
    npcId: bear,
    text: "向こう岸を探る",
    effect: { targetId: f.far, state: "足跡が残る" },
  };
  const failed = await f.send(0, unreachable);
  expect(failed.outcome).toMatchObject({ success: false });
  expect(await f.send(0, unreachable)).toEqual(failed);
  await f.send(0, { command: "end-turn" });
  const next = await f.send(1, { command: "end-turn" });
  const request = derivedId(`instant:${next.sessionId}:${bear}:${next.turn}`);
  const peer = derivedId(source + ":manual:1");
  await isolated.databases.postgres.query(
    "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,1)",
    [request, { sides: 2, successThrough: 1 }],
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let choosing = false;
  f.calls
    .mockImplementationOnce(async (id, _role, messages) => {
      choosing = true;
      await gate;
      expect(JSON.stringify(messages)).not.toContain("登場前の会話");
      return answer(id, {
        text: "羽根に体当たりする",
        effect: {
          targetId: wheel,
          state: "クマが体当たりしたため、羽根が折れて回らない",
          replacesStateId: intact,
        },
      });
    })
    .mockImplementationOnce(
      async (id, _role, _messages, _target, _effort, _attempt, validate) => {
        const dice = { sides: 2, successThrough: 1 };
        expect(() =>
          validate!(JSON.stringify({ ...dice, observable: "羽根" })),
        ).toThrow();
        return answer(id, { ...dice, observable: "羽根が折れて回らない" });
      },
    );
  const ticking = access.botPlay.tickNpcs();
  try {
    await vi.waitFor(() => expect(choosing).toBe(true));
    for (const i of [0, 1]) {
      expect((await f.status(i)).actorId).toBe(bear);
      expect(
        await access.botPlay.waiting(
          f.world,
          f.actors[i]!,
          f.people[i]!.id,
          "human:" + f.people[i]!.id,
        ),
      ).toMatchObject({ actionable: false });
    }
  } finally {
    release();
    await ticking;
  }
  expect((await f.status(0)).actorId).toBe(peer);
  const receipt = await f.store.receipt(f.graph, request);
  expect(receipt?.changes.nodes).toContainEqual(
    expect.objectContaining({
      instantActor: { id: bear, sourceEventId: derivedId(source + ":speech") },
    }),
  );
  expect(await f.store.context(f.graph).node(bear)).toBeUndefined();
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { text: "草地へ去る", departs: true }),
  );
  await access.botPlay.tickNpcs();
  await f.send(0, { command: "end-turn" });
  const pending = await f.send(1, {
    command: "promote-npc",
    sourceRequestId: source,
    npcIndex: 0,
    description: "水辺のクマ",
  });
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-npc-profile");
    expect(JSON.stringify(messages)).toContain("羽根が折れて回らない");
    expect(JSON.stringify(messages)).not.toContain("登場前の会話");
    return answer(id, {
      description: "水辺を訪れるクマ",
      memory: "羽根が折れて回らないことを覚えている。",
    });
  });
  await auth.operations.execute(
    admin.id,
    randomUUID(),
    {
      operation: "npcs.decidePromotion",
      worldId: f.world,
      promotionId: String(pending.promotionId),
      approve: true,
      reason: "継続を許可",
    },
    { players: access.players },
  );
  expect((await f.send(1, { command: "end-turn" })).actorId).toBe(bear);
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    expect((await f.status(0)).actorId).toBe(bear);
    const content = JSON.stringify(messages);
    expect(content).toContain("羽根が折れて回らない");
    expect(content).not.toContain("登場前の会話");
    const prompt = JSON.parse(String(messages[1]!.content));
    expect(prompt.currentTurn.actions).toEqual([]);
    expect(
      prompt.history.entries.flatMap(
        (r: { payload: { entries?: unknown[] } }) => r.payload.entries ?? [],
      ),
    ).not.toContainEqual(
      expect.objectContaining({ input: "羽根に体当たりする" }),
    );
    return answer(id, { command: "say", text: "水音を聞いている" });
  });
  await access.botPlay.tickNpcs();
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    const prompt = JSON.parse(String(messages[1]!.content));
    expect(prompt.status.callsLimit).toBe(8);
    expect(prompt.history.omittedEntries).toBe(0);
    expect(prompt.sinceLastTurn).toBeUndefined();
    expect(prompt.currentTurn.actions).toMatchObject([
      {
        input: { command: "say", text: "水音を聞いている" },
        result: { state: "accepted" },
      },
    ]);
    return answer(id, { command: "end-turn" });
  });
  await access.botPlay.tickNpcs();
  await f.send(0, { command: "say", text: "ここの水音は聞こえますか" });
  await f.send(0, { command: "end-turn" });
  await f.send(1, { command: "search", query: { kind: "self" } });
  await f.send(1, { command: "comment", text: "川辺を見守る" });
  await f.send(1, { command: "end-turn" });
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    const prompt = JSON.parse(String(messages[1]!.content));
    expect(prompt.sinceLastTurn.previousTurn.actions).toMatchObject([
      { input: "水音を聞いている", result: { state: "accepted" } },
    ]);
    expect(prompt.sinceLastTurn.observed).toMatchObject([
      { entries: [{ input: "ここの水音は聞こえますか" }] },
      { entries: [], comment: "川辺を見守る" },
    ]);
    expect(prompt.sinceLastTurn.membership).toEqual({ joined: [], left: [] });
    expect(JSON.stringify(prompt.sinceLastTurn)).not.toContain('"material"');
    return answer(id, { command: "end-turn" });
  });
  await access.botPlay.tickNpcs();
  await f.send(0, { command: "finish" });
  // A name changed after departure is outside the NPC's observed roster.
  const rename = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, rename),
    f.store.context(f.graph),
    {
      commitId: rename,
      at: 1,
      changes: {
        nodes: [],
        revisions: [
          { kind: "existence", id: f.actors[0]!, text: "退出後の名前" },
        ],
        edges: [],
        endEdges: [],
      },
    },
  );
  await f.send(1, { command: "end-turn" });
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    const prompt = JSON.parse(String(messages[1]!.content));
    expect(prompt.sinceLastTurn.previousTurn.actions).toEqual([]);
    expect(prompt.sinceLastTurn.observed).toEqual([]);
    expect(prompt.sinceLastTurn.membership).toEqual({
      joined: [],
      left: [{ actorId: f.actors[0], name: "人物0" }],
    });
    expect(prompt.status.callsLimit).toBe(8);
    return answer(id, { command: "end-turn" });
  });
  await access.botPlay.tickNpcs();
  await f.send(1, { command: "finish" });
  await f.move(2, f.place);
  const inspected = await f.send(2, {
    command: "search",
    query: { kind: "subject", targetId: wheel },
  });
  expect(JSON.stringify(inspected.material)).toContain("羽根が折れて回らない");
  expect(JSON.stringify(inspected.material)).not.toContain("体当たり");
  expect(JSON.stringify(inspected.material)).not.toContain("羽根は無傷");
});
test("初回接続と状態照会のタイムアウトを復旧し、終了時に履歴を返す", async () => {
  const f = await fixture(),
    app = await createApp(access, auth.identity, undefined, auth.operations),
    cli = await playerCli(app);
  const profile = join(cli.directory, "cold.json");
  try {
    cli.timeoutNextResponse("/api/player-devices");
    const connected = await cli.run(
      profile,
      "connect",
      "--full-ids",
      "--server",
      cli.base,
      "--world",
      f.world,
    );
    expect(connected.state).toBe("authorization_pending");
    expect(
      (
        await isolated.databases.postgres.query(
          "select id from player_device where world_id=$1",
          [f.world],
        )
      ).rows,
    ).toEqual([{ id: connected.id }]);
    await cli.approve(
      f.people[0]!.cookie,
      connected.userCode,
      `actor:${f.actors[0]}`,
    );
    cli.timeoutNextResponse("/api/player-device");
    expect((await cli.run(profile, "status")).state).toBe("ready");
    await cli.run(profile, "say", "--text", "旅の手帳を閉じる");
    const end = await cli.run(profile, "finish");
    expect(end).toMatchObject({
      state: "finished",
      sceneId: end.result.sceneId,
    });
    expect(JSON.stringify(end.result.result.entries)).toContain(
      "旅の手帳を閉じる",
    );
  } finally {
    await cli.close();
    await app.close();
  }
}, 60000);
test("CLIの自己照会は本人が聞いた発言だけを添え、既読位置を進めない", async () => {
  const f = await fixture();
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  const profiles = [0, 2].map((i) => join(cli.directory, `player-${i}.json`));
  const run = (i: number, ...args: string[]) =>
    cli.run(profiles[i], ...args, "--full-ids");
  const read = (i: number) => run(i, "search", "--kind", "self");
  const older = "今朝は北門で公演するよ。";
  const change = "公演は中止だよ。桟橋で舟を待とう。";
  const shared = "舟は桟橋の西側に来るよ。";
  try {
    for (const [profile, index] of [0, 2].entries()) {
      const connection = await run(
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
            f.people[index]!.cookie,
            connection.userCode,
            `actor:${f.actors[index]}`,
          )
        ).statusCode,
      ).toBe(302);
    }
    await f.send(0, { command: "contact", targetId: f.actors[1] });
    await f.send(1, { command: "say", text: older });
    await f.send(1, { command: "end-turn" });
    await run(0, "status");
    await f.send(0, { command: "end-turn" });

    await f.send(1, { command: "say", text: change });
    await f.move(2, f.place);
    await f.send(2, { command: "contact", targetId: f.actors[1] });
    await f.send(1, { command: "say", text: shared });
    await f.send(1, { command: "end-turn" });

    const first = (await read(0)).result;
    expect(first.material.belongings).toBeDefined();
    const status = await run(0, "status");
    const record = status.entries.find(
      ({ payload }: { payload: { entries?: { input: string }[] } }) =>
        payload.entries?.some(({ input }) => input === change),
    );
    expect(record).toBeDefined();
    expect(first.recentSpeech).toEqual([
      expect.objectContaining({ text: older }),
      {
        recordId: record.id,
        turn: record.payload.turn,
        speaker: "人物1",
        text: change,
      },
      {
        recordId: record.id,
        turn: record.payload.turn,
        speaker: "人物1",
        text: shared,
      },
    ]);
    expect(
      JSON.stringify((await run(0, "status", "--after", "0")).entries),
    ).toContain(older);
    await f.send(0, { command: "end-turn" });
    await giveTurn(f, 2);
    const second = (await read(1)).result;
    const secondStatus = await run(1, "status");
    const secondRecord = secondStatus.entries.find(
      ({ payload }: { payload: { entries?: { input: string }[] } }) =>
        payload.entries?.some(({ input }) => input === shared),
    );
    expect(secondRecord).toBeDefined();
    expect(second.recentSpeech).toEqual([
      {
        recordId: secondRecord.id,
        turn: secondRecord.payload.turn,
        speaker: "人物1",
        text: shared,
      },
    ]);
  } finally {
    await cli.close();
    await app.close();
  }
}, 60000);

test("CLIは短縮IDを次の操作に使え、本人の未読手だけをアイコンなしで返す", async () => {
  const f = await fixture(),
    app = await createApp(access, auth.identity, undefined, auth.operations),
    cli = await playerCli(app);
  const profile = join(cli.directory, "incremental.json"),
    run = (...args: string[]) => cli.run(profile, ...args);
  try {
    const icon = "data:image/png;base64," + "A".repeat(6315);
    await isolated.databases.postgres.query(
      "INSERT INTO world_player_icon(player_id,construction_id,image) SELECT id,construction_id,$3 FROM world_access WHERE construction_id=$1 AND actor_id=$2 AND role='player'",
      [f.world, f.actors[1], icon],
    );
    const conn = await run("connect", "--server", cli.base, "--world", f.world);
    await cli.approve(
      f.people[0]!.cookie,
      conn.userCode,
      `actor:${f.actors[0]}`,
    );
    const nearby = await run("search", "--kind", "surroundings"),
      target = nearby.result.material.subjects.find(
        (s: { text: string }) => s.text === "人物1",
      ).id;
    expect(target).toMatch(/^@[0-9a-f]+$/);
    const contact = await run("contact", "--target", target);
    expect(contact.result).toMatchObject({
      previousTurn: { cause: "contact", turn: 1 },
      joined: { type: "session-joined", name: "人物0" },
      turnHolder: { actorId: target, name: "人物1" },
    });
    expect(JSON.stringify(contact)).not.toContain("base64");
    expect(
      contact.result.characters.find(
        (p: { actorId: string }) => p.actorId === target,
      ),
    ).not.toHaveProperty("icon");
    expect(JSON.stringify(await f.status(0))).toContain(icon);
    await f.move(2, f.place);
    const requestId = randomUUID();
    await f.send(2, { command: "say", text: "合流前のひとり言" });
    const joined = await f.send(2, {
      command: "contact",
      requestId,
      targetId: f.actors[1],
    });
    expect(
      await f.send(2, {
        command: "contact",
        requestId,
        targetId: f.actors[1],
      }),
    ).toStrictEqual(joined);
    const joins = await run("status", "--view", "joins");
    expect(joins).toMatchObject({
      turnHolder: { actorId: target, name: "人物1" },
      entries: [
        { transition: { cause: "contact", name: "人物0" } },
        { transition: { type: "session-joined", name: "人物0" } },
        { transition: { type: "session-joined", name: "人物2" } },
      ],
    });
    expect(joins).not.toHaveProperty("nextCursor");
    expect(JSON.stringify(joins)).not.toContain("ひとり言");
    let now = new Date();
    vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
    await access.waiting(
      f.people[1]!.id,
      f.world,
      f.actors[1],
      undefined,
      false,
    );
    const wait = await run("status", "--view", "wait");
    expect(wait).toMatchObject({
      waitingForReturn: { name: "人物1", remainingSeconds: 600 },
    });
    expect(wait).not.toHaveProperty("entries");
    now = new Date(now.getTime() + 5000);
    expect(await run("status", "--view", "wait")).toMatchObject({
      waitingForReturn: {
        remainingSeconds: 595,
        deadline: wait.waitingForReturn.deadline,
      },
    });
    const original = "発言中の" + f.actors[1] + "と" + target + "は本文";
    await f.send(1, { command: "say", text: original });
    await f.send(1, { command: "end-turn" });
    const first = await run("status");
    expect(JSON.stringify(first.entries)).toContain(original);
    expect(JSON.stringify(first.entries)).not.toContain("ひとり言");
    expect(
      first.entries.filter(
        (entry: { payload: { transition?: { type: string } } }) =>
          entry.payload.transition?.type === "session-joined",
      ),
    ).toHaveLength(2);
    expect(first.actorId).toEqual(first.viewerId);
    expect(first).not.toHaveProperty("legacy");
    const repeat = await run("status");
    expect(repeat.entries).toEqual([]);
    expect(repeat.nextCursor).toEqual(first.nextCursor);
    expect((await run("status", "--view", "joins")).entries).toEqual([]);
    expect(
      (await run("status", "--view", "joins", "--after", "0")).entries,
    ).toEqual(joins.entries);
    expect(await run("standby", "--resume")).toMatchObject({
      actionable: true,
      context: { actorId: first.viewerId, name: "人物0", phase: "turn" },
    });
    expect((await run("status", "--after", "0")).entries).toEqual(
      first.entries,
    );
    expect((await run("status", "--after", "0", "--full-ids")).viewerId).toBe(
      f.actors[0],
    );
    const file = join(cli.directory, "memo.json");
    const recipients = [
      target,
      first.characters.find(
        (character: { name: string }) => character.name === "人物2",
      ).actorId,
    ];
    await writeFile(
      file,
      JSON.stringify({
        command: "memo",
        text: original,
        participants: recipients,
        dependencies: nearby.result.dependencies
          .filter((d: { key: string }) => d.key.startsWith("node:"))
          .slice(0, 1),
      }),
    );
    const pending = await run("play", "--file", file);
    expect(pending.result.receiving.applicationId).toMatch(/^@/);
    expect(pending.result.receiving.text).toBe(original);
    expect((await run("status")).receiving).toMatchObject({
      sender: first.viewerId,
      recipients,
      text: original,
    });
  } finally {
    await cli.close();
    await app.close();
  }
});
test("SSEは受領者だけに判断を知らせ、切断中に戻った元手番を再購読で復元する", async () => {
  const f = await fixture(),
    app = await createApp(
      new WorldAccess(runtime),
      auth.identity,
      undefined,
      auth.operations,
    );
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const url = origin + "/api/worlds/" + f.world + "/waiting/events",
    readers: AbortController[] = [],
    sessions: Promise<void>[] = [];
  try {
    await f.move(2, f.place);
    await f.send(1, { command: "contact", targetId: f.actors[0] });
    await f.send(2, { command: "contact", targetId: f.actors[0] });
    const devices = await Promise.all(
      f.actors.map(async (actor, i) => {
        const secret = randomBytes(32).toString("hex"),
          device = await access.devices.begin(randomUUID(), f.world, secret);
        await access.devices.approve(f.people[i]!.id, device.userCode, {
          actorId: actor,
        });
        await access.waiting(f.people[i]!.id, f.world, actor, device.id, true);
        return { id: device.id, secret };
      }),
    );
    const subscribe = async (i: number, after?: string, context = false) => {
      const controller = new AbortController();
      readers.push(controller);
      const request = new URL(url);
      if (after !== undefined) request.searchParams.set("after", after);
      if (context) request.searchParams.set("context", "1");
      const res = await fetch(request, {
        signal: controller.signal,
        headers: {
          accept: "text/event-stream",
          authorization: "Bearer " + devices[i]!.secret,
          ...cliVersionHeader,
        },
      });
      expect(res.status).toBe(200);
      const frames: ReturnType<typeof WaitingEvent.parse>[] = [];
      const done = (async () => {
        let buf = "";
        try {
          for await (const chunk of res.body!.pipeThrough(
            new TextDecoderStream(),
          )) {
            buf += chunk;
            let end;
            while ((end = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, end);
              buf = buf.slice(end + 1);
              if (line.startsWith("data:"))
                frames.push(JSON.parse(line.slice(5)));
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        }
      })();
      sessions.push(done);
      await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
      return { frames, done, controller };
    };
    const [a, b, c] = await Promise.all([
      subscribe(0, undefined, true),
      subscribe(1, undefined, true),
      subscribe(2, "0"),
    ]);
    expect(a!.frames[0]!.state).toBe("turn");
    expect(
      a!.frames[0]!.context?.recent.map(({ transition }) => transition.type),
    ).toEqual(["session-joined", "session-joined"]);
    expect(
      c!.frames[0]!.progress?.updates.some(
        ({ transition }) => transition.type === "session-joined",
      ),
    ).toBe(false);
    expect(b!.frames[0]!.actionable).toBe(false);
    expect(c!.frames[0]!.actionable).toBe(false);
    const req = await f.send(0, {
      command: "memo",
      participants: [f.actors[1]],
      dependencies: [],
      text: "試験用の共有メモ",
    });
    await vi.waitFor(() => expect(b!.frames.at(-1)?.state).toBe("receiving"));
    expect(b!.frames.at(-1)?.context).toMatchObject({
      actorId: f.actors[1],
      phase: "receiving",
      name: "人物1",
      receiptRequest: { memoTexts: ["試験用の共有メモ"] },
    });
    await vi.waitFor(() => expect(a!.frames.at(-1)?.state).toBe("standby"));
    for (const observer of [a!, c!]) {
      expect(JSON.stringify(observer.frames)).not.toContain("試験用の共有メモ");
    }
    a!.controller.abort();
    await a!.done;
    await f.send(1, {
      command: "receive",
      applicationId: req.applicationId,
      accept: true,
    });
    const resumed = await subscribe(0, undefined, true),
      frame = resumed.frames[0]!;
    expect(frame).toMatchObject({
      state: "turn",
      turn: a!.frames[0]!.turn,
      viewerId: f.actors[0],
      context: {
        actorId: f.actors[0],
        phase: "turn",
        name: "人物0",
        receiptResult: {
          applicationId: req.applicationId,
          outcome: "accepted",
        },
      },
    });
    expect(frame.wakeKey).not.toBe(a!.frames[0]!.wakeKey);
    resumed.controller.abort();
    await resumed.done;
    const again = await subscribe(0);
    expect(again.frames[0]!.wakeKey).toBe(frame.wakeKey);
    const lastSeen = c!.frames.at(-1)!.progress!.cursor;
    await f.send(1, { command: "finish" });
    await vi.waitFor(() =>
      expect(c!.frames.at(-1)).toMatchObject({
        actionable: false,
        progress: {
          actorId: f.actors[0],
          updates: [
            { transition: { type: "session-left", actorId: f.actors[1] } },
          ],
        },
      }),
    );
    const reconnected = await subscribe(2, lastSeen);
    expect(reconnected.frames[0]!.progress!.updates).toMatchObject([
      { transition: { type: "session-left", actorId: f.actors[1] } },
    ]);
    expect(again.frames.filter((event) => event.actionable)).toHaveLength(1);
    await access.devices.revoke(f.people[0]!.id, devices[0]!.id);
    await again.done;
    expect(c!.frames.filter((x) => x.actionable)).toHaveLength(0);
    expect(b!.frames.filter((x) => x.actionable).map((x) => x.state)).toEqual([
      "receiving",
    ]);
  } finally {
    readers.forEach((c) => c.abort());
    await Promise.allSettled(sessions);
    await app.close();
  }
}, 20000);
test("メモ本文を未回答の宛先に渡し、申請者の復帰で承認・却下・期限切れを照合する", async () => {
  const f = await fixture();
  await f.move(2, f.place);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  await f.send(2, { command: "contact", targetId: f.actors[0] });
  const waiting = (i: number) =>
    access.waiting(
      f.people[i]!.id,
      f.world,
      f.actors[i],
      undefined,
      undefined,
      true,
      true,
    );
  const text = "現在の判断者だけに出す本文";
  const apply = (...recipients: number[]) =>
    f.send(0, {
      command: "memo",
      text,
      participants: recipients.map((i) => f.actors[i]),
      dependencies: [],
    });
  const first = await apply(1, 2);
  for (const i of [1, 2])
    expect(await f.status(i)).toMatchObject({
      viewerId: f.actors[i],
      actorId: f.actors[i],
      receiving: {
        recipients: [f.actors[1], f.actors[2]],
        text,
        changes: {
          nodes: expect.arrayContaining([expect.objectContaining({ text })]),
        },
      },
    });
  expect(await waiting(1)).toMatchObject({
    actionable: true,
    context: {
      receiptRequest: {
        applicationId: first.applicationId,
        senderId: f.actors[0],
        memoTexts: [text],
      },
    },
  });
  expect(JSON.stringify(await waiting(0))).not.toContain(text);
  const secondWake = await waiting(2);
  expect(secondWake).toMatchObject({
    actionable: true,
    context: { receiptRequest: { memoTexts: [text] } },
  });
  await expect(
    f.send(1, { command: "comment", text: "受領判断中のコメント" }),
  ).resolves.toMatchObject({
    action: { command: "comment", message: "コメントを受け付けました" },
  });
  const intermediate = {
    command: "receive",
    applicationId: first.applicationId,
    accept: true,
    requestId: randomUUID(),
  };
  const firstDecision = await f.send(1, intermediate);
  expect(firstDecision).toMatchObject({
    decision: { applicationId: first.applicationId, choice: "approve" },
    application: { state: "waiting", nextActorId: f.actors[2] },
  });
  expect((await waiting(0)).context).not.toHaveProperty("receiptResult");
  expect(JSON.stringify(await waiting(1))).not.toContain(text);
  expect((await waiting(2)).wakeKey).toBe(secondWake.wakeKey);

  const requestId = randomUUID();
  const decide = {
    command: "receive",
    applicationId: first.applicationId,
    accept: true,
    requestId,
  };
  const cursor = (await access.botPlay.turnFeed(f.world, f.actors[1]!, "0"))
    .cursor;
  const final = await f.send(2, decide);
  expect(final).toMatchObject({
    decision: { choice: "approve" },
    application: { state: "confirmed" },
  });
  expect(await f.send(2, decide)).toStrictEqual(final);
  expect(await f.send(1, intermediate)).toStrictEqual(firstDecision);
  const resumed = await waiting(0);
  expect(resumed).toMatchObject({
    actionable: true,
    turn: 1,
    context: {
      receiptResult: {
        applicationId: first.applicationId,
        outcome: "accepted",
      },
    },
  });
  const selectResults = (
    entries: { payload?: { receiptResult?: unknown } }[],
  ) =>
    entries.flatMap((entry) =>
      entry.payload?.receiptResult ? [entry.payload.receiptResult] : [],
    );
  expect(selectResults((await f.status(0)).entries)).toEqual([
    resumed.context!.receiptResult,
  ]);
  for (const i of [1, 2]) {
    expect((await waiting(i)).context).not.toHaveProperty("receiptResult");
    expect(selectResults((await f.status(i)).entries)).toEqual([
      resumed.context!.receiptResult,
    ]);
  }
  const replay = await access.botPlay.turnFeed(f.world, f.actors[1]!, cursor);
  expect(replay.receiptResults).toMatchObject([
    {
      receiptResult: {
        outcome: "accepted",
        applicationId: first.applicationId,
      },
    },
  ]);
  expect(
    await access.botPlay.turnFeed(f.world, f.actors[1]!, replay.cursor),
  ).not.toHaveProperty("receiptResults");

  const second = await apply(1, 2);
  await f.send(1, {
    command: "receive",
    applicationId: second.applicationId,
    accept: true,
  });
  const rejected = await f.send(2, {
    command: "receive",
    applicationId: second.applicationId,
    accept: false,
  });
  expect(rejected).toMatchObject({
    decision: { choice: "reject" },
    application: { state: "rejected" },
  });
  expect(rejected.application).not.toHaveProperty("rejectedBy");
  expect((await waiting(0)).context?.receiptResult).toMatchObject({
    applicationId: second.applicationId,
    outcome: "rejected",
    rejectedBy: { actorId: f.actors[2], name: "人物2" },
    message: "人物2が却下したため、メモは成立しませんでした",
  });
  const senderHistory = (
    await access.botPlay.turnFeed(f.world, f.actors[0]!, "0")
  ).receiptResults;
  const rejectionInHistory = senderHistory?.find(
    ({ receiptResult }) => receiptResult.applicationId === second.applicationId,
  );
  expect(rejectionInHistory?.receiptResult).toEqual(
    (await waiting(0)).context?.receiptResult,
  );
  expect((await waiting(0)).context?.receiptResult).toMatchObject({
    applicationId: second.applicationId,
    outcome: "rejected",
  });
  let now = new Date();
  vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
  const expired = await apply(1);
  const deadline = (await waiting(1)).deadline!;
  now = new Date(Date.parse(deadline) + 1);
  expect((await f.status(0)).actorId).toBe(f.actors[0]);
  expect((await waiting(0)).context?.receiptResult).toMatchObject({
    applicationId: expired.applicationId,
    outcome: "expired",
  });
  expect((await waiting(1)).context).not.toHaveProperty("receiptRequest");
  const thirdView = await access.botPlay.turnFeed(f.world, f.actors[2]!, "0");
  expect(
    thirdView.receiptResults?.map(
      ({ receiptResult }) => receiptResult.applicationId,
    ),
  ).toEqual([first.applicationId, second.applicationId]);
  expect(thirdView.receiptResults?.[1]?.receiptResult).not.toHaveProperty(
    "rejectedBy",
  );
  expect(
    (
      await access.botPlay.turnFeed(f.world, f.actors[1]!, "0")
    ).receiptResults?.map(({ receiptResult }) => receiptResult.outcome),
  ).toEqual(["accepted", "rejected", "expired"]);
});

test.each([
  ["expired", "期限切れ"],
  ["cancelled", "関係する参加者が退出"],
] as const)(
  "受領者が待受と受領拒否で %s の申請を確認できる",
  async (outcome, reason) => {
    const f = await fixture(),
      app = await createApp(access, auth.identity, undefined, auth.operations),
      cli = await playerCli(app),
      profile = join(cli.directory, "recipient.json");
    const run = (...args: string[]) => cli.run(profile, ...args, "--full-ids");
    try {
      const connection = await run(
        "connect",
        "--server",
        cli.base,
        "--world",
        f.world,
      );
      expect(
        (
          await cli.approve(
            f.people[1]!.cookie,
            connection.userCode,
            `actor:${f.actors[1]}`,
          )
        ).statusCode,
      ).toBe(302);
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      const saved = JSON.parse(await readFile(profile, "utf8"));
      await writeFile(profile, JSON.stringify({ ...saved, server: origin }));
      await f.move(2, f.place);
      await f.send(1, { command: "contact", targetId: f.actors[0] });
      await f.send(2, { command: "contact", targetId: f.actors[0] });
      let now = new Date();
      vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
      const text = "二人で離れた場所へ行く";
      const pending = await f.send(0, {
        command: "update",
        text,
        operations: f.actors.slice(0, 2).map((subjectId) => ({
          type: "locate",
          subjectId,
          text: "離れた場所",
          aboutIds: [f.far],
        })),
        dependencies: [],
      });
      const receiving = pending.receiving as {
        applicationId: string;
        deadline: string;
        changes: unknown;
      };
      const { applicationId, deadline, changes } = receiving;
      expect(changes).toBeDefined();
      const compact = await cli.run(profile, "status");
      expect(compact.viewerId).toMatch(/^@[0-9a-f]+$/);
      const sender = compact.characters.find(
        (character: { name: string }) => character.name === "人物0",
      ).actorId;
      expect(sender).toMatch(/^@[0-9a-f]+$/);
      expect(compact.receiving).toMatchObject({
        sender,
        recipients: [compact.viewerId],
        text,
      });
      expect(await run("status")).toMatchObject({
        viewerId: f.actors[1],
        receiving: {
          applicationId,
          sender: f.actors[0],
          recipients: [f.actors[1]],
          text,
          changes,
        },
      });
      expect((await f.status(2)).receiving).toEqual({
        applicationId,
        sender: f.actors[0],
        recipients: [f.actors[1]],
        deadline,
      });
      const receive = {
        command: "receive",
        requestId: randomUUID(),
        applicationId,
        accept: true,
      };
      const observer = await access.waiting(
        f.people[2]!.id,
        f.world,
        f.actors[2],
        undefined,
        true,
        true,
        true,
      );
      expect(observer.context).not.toHaveProperty("receiving");
      if (outcome === "cancelled") {
        const expected = {
          state: "receiving",
          context: {
            receiving: {
              applicationId,
              deadline: localTime("", deadline),
              changes,
              text,
              senderId: f.actors[0],
              senderName: "人物0",
            },
          },
        };
        expect(await run("listen", "--once", "--resume")).toMatchObject(
          expected,
        );
        expect(await run("standby", "--resume")).toMatchObject(expected);
        await f.send(0, { command: "leave" });
      } else {
        now = new Date(Date.parse(deadline) + 1);
        // Querying status or waiting here would settle first and hide a rollback in receive.
        await expect(f.send(1, receive)).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining(reason),
        });
        expect(
          (await access.botPlay.current(f.world, f.actors[1]!))?.data.receiving,
        ).toBeUndefined();
      }
      expect(await run("listen", "--once", "--resume")).toMatchObject({
        noticeKey: expect.any(String),
        noticeMessage: expect.stringContaining("notices"),
      });
      const rejected = await run(
        "receive",
        "--application",
        applicationId,
        "--accept",
      );
      expect(rejected).toMatchObject({
        state: "error",
        code: "RECEIVING_TURN_REQUIRED",
      });
      expect(rejected.message).toContain(applicationId);
      expect(rejected.message).toContain(reason);
      await expect(f.send(1, receive)).rejects.toMatchObject({
        status: 409,
        message: rejected.message,
      });
      const { notices } = await run("notices");
      expect(notices).toHaveLength(1);
      for (const detail of ["人物0", applicationId, text, reason])
        expect(notices[0].text).toContain(detail);
      expect(
        (await access.notices(f.people[2]!.id, f.world, f.actors[2])).notices,
      ).toEqual([]);
      await expect(
        f.send(2, { ...receive, requestId: randomUUID() }),
      ).rejects.toMatchObject({
        code: "RECEIVING_TURN_REQUIRED",
        message: "本人の受領判断を指定してください",
      });
      const history = await access.botPlay.turnFeed(f.world, f.actors[1]!, "0");
      expect(history.receiptResults).toEqual([
        expect.objectContaining({
          receiptResult: expect.objectContaining({ applicationId, outcome }),
        }),
      ]);
    } finally {
      await cli.close();
      await app.close();
    }
  },
  20000,
);

test("受領期限切れのCLI履歴で判断の手番だった本人と同席者にそれぞれの立場を伝える", async () => {
  const f = await fixture(5);
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  try {
    await f.move(2, f.place);
    for (const target of [1, 2, 3, 4])
      await f.send(target, { command: "contact", targetId: f.actors[0] });
    let now = new Date();
    vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
    const recipients = f.actors.slice(1, 4);
    const { applicationId, memoId } = await f.send(0, {
      command: "memo",
      text: "共同で調べる場所の候補",
      participants: recipients,
      dependencies: [],
    });
    await f.send(3, { command: "receive", applicationId, accept: true });
    const { deadline } = (await f.status(2)).receiving!;
    now = new Date(Date.parse(deadline) + 1);
    for (const [i, viewerMessage] of [
      [1, "あなたの判断待ちでした。"],
      [2, "あなたの判断待ちでした。"],
      [4, "あなたの返答は不要でした。"],
    ] as const) {
      const profile = join(cli.directory, `player-${i}.json`);
      const connection = await cli.run(
        profile,
        "connect",
        "--server",
        cli.base,
        "--world",
        f.world,
      );
      await cli.approve(
        f.people[i]!.cookie,
        connection.userCode,
        `actor:${f.actors[i]}`,
      );
      const compact = await cli.run(profile, "status");
      const entry = compact.entries.find(
        ({ payload }: { payload: { viewerMessage?: string } }) =>
          payload.viewerMessage === viewerMessage,
      );
      expect(entry?.payload).toMatchObject({
        reason: "受領判断の期限が切れました",
        applicationId: expect.stringMatching(/^@/),
      });
      const full = await cli.run(
        profile,
        "status",
        "--after",
        "0",
        "--full-ids",
      );
      expect(full.entries).toContainEqual({
        ...entry,
        payload: {
          applicationId,
          state: "failed",
          reason: "受領判断の期限が切れました",
          senderId: f.actors[0],
          recipientIds: recipients,
          decisionHolderId: f.actors[1],
          pendingRecipientIds: [f.actors[1], f.actors[2]],
          deadline: localTime("", deadline),
          viewerMessage,
        },
      });
    }
    for (const i of [0, 3]) {
      const entry = (await f.status(i)).entries.find(
        ({ payload }) => payload.applicationId === applicationId,
      );
      expect(entry?.payload).toMatchObject({ decisionHolderId: f.actors[1] });
      expect(entry!.payload).not.toHaveProperty("viewerMessage");
    }
    expect(
      await f.store.context(f.graph).node(memoId as string),
    ).toBeUndefined();
  } finally {
    await cli.close();
    await app.close();
  }
});

test("通常枠の最後の接触で、返答は次の手番の持ち主と操作不要を返す", async () => {
  const f = await fixture();
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  for (let n = 0; n < 7; n++)
    await f.send(0, { command: "search", query: { kind: "self" } });
  const input = {
    command: "contact",
    requestId: randomUUID(),
    targetId: f.actors[1],
  };
  const result = await f.send(0, input);
  expect(result).toMatchObject({
    actionable: false,
    actionMessage: "操作不要です（人物1の手番中）",
    turnHolder: { actorId: f.actors[1] },
    action: { endedTurn: { reason: "limit" } },
  });
  expect(await f.send(0, input)).toEqual(result);
});

test.each([
  ["期限切れ・枠が残る", "expired", false, 0],
  ["期限切れ・枠を使い切る", "expired", true, 1],
  ["受領者が終了・枠が残る", "recipient-finish", false, 0],
  ["受領者が分離・枠を使い切る", "recipient-leave", true, 2],
  ["申請者が終了", "sender-finish", false, 1],
  ["申請と関係のない人が終了", "observer-finish", false, 1],
] as const)(
  "%sの後に担当が決まる",
  async (_label, end, exhausted, expected) => {
    const f = await fixture();
    await f.move(2, f.place);
    await f.send(1, { command: "contact", targetId: f.actors[0] });
    await f.send(2, { command: "contact", targetId: f.actors[0] });
    let now = new Date();
    vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
    if (exhausted) {
      for (let n = 0; n < 7; n++)
        await f.send(0, { command: "search", query: { kind: "self" } });
    }
    const memo = await f.send(0, {
      command: "memo",
      text: "手番順の試験",
      participants: [f.actors[1]],
      dependencies: [],
    });
    const receipt = (await f.status(1)).receiving!;
    expect(receipt.applicationId).toBe(memo.applicationId);
    if (end === "expired") {
      now = new Date(Date.parse(receipt.deadline) - 1);
      for (const i of [0, 1, 2]) await f.status(i);
      now = new Date(now.getTime() + 2);
    } else if (end === "recipient-leave") {
      const solo = await f.send(1, { command: "leave" });
      expect(solo).toMatchObject({ actorId: f.actors[1], turn: 1 });
      expect(solo.sessionId).not.toBe(memo.sessionId);
    } else {
      await f.send(
        end === "sender-finish" ? 0 : end === "observer-finish" ? 2 : 1,
        { command: "finish" },
      );
    }
    const after = await f.status(end === "sender-finish" ? 2 : 0);
    expect(after.actorId).toBe(f.actors[expected]);
    if (end === "observer-finish")
      expect(after.receiving?.applicationId).toBe(memo.applicationId);
    else {
      expect(after.receiving).toBeNull();
      expect(after.turn).toBe(exhausted || end === "sender-finish" ? 2 : 1);
    }
  },
);

test("同席者に手番終了と退出を残し、離席の時点によって即時スキップと600秒待機を分ける", async () => {
  const f = await fixture();
  await f.move(2, f.place);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  await f.send(2, { command: "contact", targetId: f.actors[0] });
  let now = new Date();
  vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
  const ready = (i: number, active: boolean) =>
    access.waiting(f.people[i]!.id, f.world, f.actors[i], undefined, active);

  const cursor = (await access.botPlay.turnFeed(f.world, f.actors[0]!, "0"))
    .cursor;
  await ready(1, false);
  await f.send(0, { command: "end-turn" });
  expect(await f.status(0)).toMatchObject({ turn: 3, actorId: f.actors[2] });
  const updates = await access.botPlay.turnFeed(f.world, f.actors[0]!, cursor);
  expect(updates.updates.map((row) => row.transition)).toMatchObject([
    { type: "turn-ended", name: "人物0", turn: 1, publicActivity: false },
    {
      type: "turn-skipped",
      name: "人物1",
      turn: 2,
      message: "人物1が離席中のため手番をスキップします",
    },
  ]);
  await ready(2, false);
  const deadline = new Date(now.getTime() + 600000).toISOString();
  expect(await f.status(0)).toMatchObject({
    actorId: f.actors[2],
    turn: 3,
    waitingForReturn: { remainingSeconds: 600, deadline },
  });
  now = new Date(now.getTime() + 599000);
  expect(await f.status(0)).toMatchObject({
    actorId: f.actors[2],
    turn: 3,
    waitingForReturn: { remainingSeconds: 1, deadline },
  });
  expect(await ready(2, true)).toMatchObject({ actionable: true, turn: 3 });
  expect(await f.status(0)).not.toHaveProperty("waitingForReturn");
  const requestId = randomUUID();
  await f.send(1, { command: "finish", requestId });
  await f.send(1, { command: "finish", requestId });
  expect(
    await access.botPlay.turnFeed(f.world, f.actors[0]!, updates.cursor),
  ).toMatchObject({
    actorId: f.actors[2],
    updates: [
      {
        transition: {
          type: "session-left",
          reason: "finish",
          name: "人物1",
          turn: 3,
        },
      },
    ],
  });
  await ready(2, false);
  now = new Date(now.getTime() + 599000);
  await ready(0, true);
  expect(await f.status(0)).toMatchObject({ actorId: f.actors[2], turn: 3 });
  now = new Date(now.getTime() + 1000);
  await access.botPlay.expire(f.world);
  expect(await f.status(0)).toMatchObject({ actorId: f.actors[0], turn: 4 });
  const restored = await f.status(0);
  expect(restored).not.toHaveProperty("waitingForReturn");
  expect(restored).toStrictEqual(JSON.parse(JSON.stringify(restored)));
  await isolated.databases.postgres.query(
    "UPDATE player_waiting SET last_seen=$3 WHERE world_id=$1 AND actor_id=$2",
    [f.world, f.actors[0], new Date(now.getTime() - 601000)],
  );
  expect(await f.status(2)).toMatchObject({
    actorId: f.actors[0],
    turn: 4,
    waitingForReturn: { remainingSeconds: 599 },
  });
  expect(f.calls).not.toHaveBeenCalled();
});

test("在席中も最後の操作から10分で手番を一度だけ進め、成立済みの発言を残す", async () => {
  const start = Date.now();
  let elapsed = 0;
  const play = access.botPlay;
  vi.spyOn(play, "now").mockImplementation(() => new Date(start + elapsed));
  const f = await fixture();
  await f.move(2, f.place);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  await f.send(2, { command: "contact", targetId: f.actors[0] });
  const cursor = (await play.turnFeed(f.world, f.actors[1]!, "0")).cursor;
  elapsed = 300000;
  await f.send(0, { command: "say", text: "成立済みの発言" });
  elapsed = 600000;
  for (const i of [0, 1, 2]) await f.status(i);
  elapsed = 899999;
  expect(await f.status(0)).toMatchObject({ turn: 1, actorId: f.actors[0] });
  elapsed++;
  await Promise.all([play.expire(f.world), play.expire(f.world)]);
  expect(await f.status(1)).toMatchObject({ turn: 2, actorId: f.actors[1] });
  expect(
    (await play.turnFeed(f.world, f.actors[1]!, cursor)).updates.map(
      (row) => row.transition,
    ),
  ).toMatchObject([
    {
      type: "turn-skipped",
      turn: 1,
      publicActivity: true,
      message: expect.stringContaining("10分間"),
    },
  ]);
  const session = (await play.current(f.world, f.actors[1]!))!;
  const history = await play.history(
    f.world,
    f.actors[1]!,
    session.data.members[1]!.sceneId,
  );
  expect(JSON.stringify(history.entries)).toContain("成立済みの発言");
});

test("受領と離席から戻った手番には無操作の期限を数え直す", async () => {
  const start = Date.now();
  let elapsed = 0;
  const play = access.botPlay;
  vi.spyOn(play, "now").mockImplementation(() => new Date(start + elapsed));
  const f = await fixture();
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const memo = await f.send(0, {
    command: "memo",
    text: "受領判断の試験",
    participants: [f.actors[1]],
    dependencies: [],
  });
  elapsed = 599999;
  expect(await f.status(1)).toMatchObject({
    turn: 1,
    receiving: {
      applicationId: memo.applicationId,
      recipients: [f.actors[1]],
      text: "受領判断の試験",
    },
  });
  await f.send(1, {
    command: "receive",
    applicationId: memo.applicationId,
    accept: true,
  });
  elapsed = 600000;
  expect(await f.status(0)).toMatchObject({
    turn: 1,
    actorId: f.actors[0],
    receiving: null,
  });
  const ready = (active: boolean) =>
    access.waiting(f.people[0]!.id, f.world, f.actors[0], undefined, active);
  await ready(false);
  elapsed = 1199999;
  await f.status(1);
  expect(await ready(true)).toMatchObject({ turn: 1, actionable: true });
  elapsed++;
  expect(await f.status(1)).toMatchObject({ turn: 1, actorId: f.actors[0] });
  elapsed = 1799999;
  await expect(
    f.send(0, { command: "say", text: "期限後の操作" }),
  ).rejects.toMatchObject({
    code: "TURN_REQUIRED",
  });
  expect(await f.status(1)).toMatchObject({
    turn: 2,
    actorId: f.actors[1],
    callsUsed: 0,
  });
});

test("期限をまたいだ生成結果は同じ人物に手番が戻っても適用されない", async () => {
  const start = Date.now();
  let elapsed = 0;
  vi.spyOn(access.botPlay, "now").mockImplementation(
    () => new Date(start + elapsed),
  );
  const f = await fixture();
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  f.calls.mockImplementationOnce(async (id) => {
    elapsed = 600000;
    await access.botPlay.expire(f.world);
    await f.send(1, { command: "end-turn" });
    return answer(id, sure);
  });
  const input = {
    requestId: randomUUID(),
    command: "say",
    text: "期限をまたぐ発言",
    instantNpcs: ["小さな鳥"],
  };
  await expect(f.send(0, input)).rejects.toMatchObject({
    code: "TURN_REQUIRED",
  });
  expect(await f.status(0)).toMatchObject({
    turn: 3,
    actorId: f.actors[0],
    callsUsed: 0,
  });
  await expect(f.send(0, input)).rejects.toMatchObject({
    code: "TURN_REQUIRED",
  });
  expect(await f.store.receipt(f.graph, input.requestId)).toBeUndefined();
});

test("認可済み端末は人物生成前に一度報告でき、参加後も枠・再送結果を引き継ぐ", async () => {
  const f = await fixture(),
    user = await auth.person("user"),
    app = await createApp(access, auth.identity, undefined, auth.operations);
  const id = randomUUID(),
    secret = randomBytes(32).toString("hex"),
    body = { requestId: randomUUID(), text: "人物を作成できません" };
  const headers = {
      authorization: "Bearer " + secret,
      "x-gestaloka-request": "1",
      ...cliVersionHeader,
    },
    url = "/api/worlds/" + f.world + "/reports";
  const post = () =>
    app.inject({ method: "POST", url, headers, payload: body });
  try {
    await isolated.databases.postgres.query(
      "UPDATE world_construction SET published=true,accepting=true,state='finished' WHERE id=$1",
      [f.world],
    );
    const code = await access.devices.begin(
      id,
      f.world,
      secret,
      "旅の記録を集める人",
    );
    expect((await post()).statusCode).toBe(403);
    await access.devices.approve(user.id, code.userCode, { character: true });
    expect(
      (await app.inject({ url: url.replace(f.world, randomUUID()), headers }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: url + "?actorId=" + f.actors[0], headers }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: url.replace("/reports", "/session"), headers }))
        .statusCode,
    ).toBe(409);
    expect((await app.inject({ url, headers })).json()).toMatchObject({
      turns: 0,
      available: 1,
    });
    const sent = await post();
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({
      id: body.requestId,
      turns: 0,
      available: 0,
      sent: 1,
    });
    const row = await isolated.databases.postgres.query(
      "select actor_id,user_id from player_report where id=$1",
      [body.requestId],
    );
    expect(row.rows).toEqual([{ actor_id: null, user_id: user.id }]);
    const character = (await access.devices.read(headers.authorization))
      .character;
    const joined = await app.inject({
      method: "POST",
      url: "/api/operations",
      headers,
      payload: {
        requestId: id,
        command: { operation: "worlds.join", worldId: f.world, character },
      },
    });
    expect(joined.statusCode).toBe(200);
    await access.players.tick(id);
    expect(
      (await access.devices.read(headers.authorization)).actor_id,
    ).toBeTruthy();
    expect((await post()).json()).toEqual(sent.json());
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: { ...body, requestId: randomUUID() },
        })
      ).json().code,
    ).toBe("REPORT_LIMIT");
    await access.devices.revoke(user.id, id);
    expect((await post()).statusCode).toBe(403);
  } finally {
    await app.close();
  }
});

describe("現場材料", () => {
  // サーバーが組み立てた設定はそのまま使い、出目だけ2に固定する。
  const win = { sides: 100, successThrough: 70 },
    lose = { ...win, successThrough: 1 };
  beforeAll(async () => {
    await isolated.databases.postgres
      .query(`CREATE FUNCTION fixture_material_roll() RETURNS trigger AS $$
      BEGIN NEW.roll := 2; RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER fixture_material_roll BEFORE INSERT ON bot_dice FOR EACH ROW EXECUTE FUNCTION fixture_material_roll()`);
  });
  afterAll(async () => {
    await isolated.databases.postgres.query(
      "DROP FUNCTION fixture_material_roll() CASCADE",
    );
  });
  test("技能の判定中に同じ申請を再送すると確定を待ち、GMを一度だけ呼ぶ", async () => {
    const f = await fixture(1),
      actor = f.actors[0]!,
      db = isolated.databases.postgres;
    await db.query(
      "UPDATE world_construction SET state='finished' WHERE id=$1",
      [f.world],
    );
    let reached!: () => void, release!: () => void;
    const waiting = new Promise<void>((resolve) => {
        reached = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    f.calls.mockImplementation(async (id, role) => {
      expect(role).toBe("world-creation-dice");
      reached();
      await gate;
      return answer(id, { settings: [win, win, win] });
    });
    const names = ["研磨", "面取り", "目止め"];
    const input = {
      command: "update",
      requestId: randomUUID(),
      text: "木工の仕上げを三つ練習する",
      operations: names.map((text) => ({
        type: "learn",
        person: actor,
        text,
        basis: "端材で繰り返し練習した",
      })),
      dependencies: [],
    };
    const first = f.send(0, input);
    void first.catch(() => {});
    let retry: typeof first | undefined;
    try {
      await waiting;
      const query = vi.spyOn(db, "query");
      retry = f.send(0, input);
      void retry.catch(() => {});
      await vi.waitFor(
        () => {
          expect(query).toHaveBeenCalledWith(
            "SELECT result FROM bot_request WHERE id=$1",
            [input.requestId],
          );
        },
        { timeout: 3000 },
      );
      expect(f.calls).toHaveBeenCalledTimes(1);
      await expect(
        f.send(0, { ...input, requestId: randomUUID() }),
      ).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
    } finally {
      release();
      await Promise.allSettled([first, retry]);
    }

    const result = await first;
    expect(result).toMatchObject({ state: "accepted", spentSp: 1 });
    const saved = { commitId: result.commitId, outcome: result.outcome };
    expect(await retry).toMatchObject(saved);
    expect(await f.send(0, input)).toMatchObject(saved);
    expect(f.calls).toHaveBeenCalledTimes(1);
    const { skills } = await readBelongings(f.store.context(f.graph), actor);
    expect(skills.map(({ text }) => text).sort()).toEqual([...names].sort());
    expect(
      await access.botPlay.dailySp(f.world, f.people[0]!.id),
    ).toMatchObject({
      remaining: 99,
    });
  });
  test("技能の習得後も、生成判定に以前のキャッシュ境界と新しい技能の根拠が残る", async () => {
    const f = await fixture(1),
      actor = f.actors[0]!;
    await isolated.databases.postgres.query(
      "UPDATE world_construction SET state='finished' WHERE id=$1",
      [f.world],
    );
    await f.apply([
      ...Array.from({ length: 12 }, (_, i) => ({
        type: "learn",
        person: actor,
        text: `仕立ての手順${i + 1}。${"織物が波打たないように布の張りを確かめる。".repeat(25)}`,
        basis: `作業台を使う組合員と第${i + 1}の手順を練習した。`,
      })),
      {
        type: "create",
        holder: actor,
        label: "麻布",
        count: 9,
        basis: "厚手に織った",
      },
    ]);
    const read = () => readBelongings(f.store.context(f.graph), actor);
    const expected = (await read()).skills;
    const learnedText = "雨よけを作るため、継ぎ目を折り返して縫える。";
    const learnedBasis = "荷覆いの試作で折り返し幅を考えた。";
    const transport = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({
        id: randomUUID(),
        model: "gpt-6.1-terra",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(win) }],
          },
        ],
        usage: { input_tokens: 6000, output_tokens: 20 },
      }),
    );
    const model = createCountedClient(
      isolated.databases.postgres,
      {
        LLM_BUDGET_ID: randomUUID(),
        LLM_PROVIDER: "openai",
        LLM_API: "responses",
        LLM_MODEL: "gpt-6.1-terra",
        OPENAI_API_KEY: "test-key",
      },
      transport,
    );
    await model.ledger.setup();
    const decision = () =>
      f.calls.mockImplementationOnce((...args) => model.complete(...args));
    decision();
    const learn = await f.send(0, {
      command: "update",
      text: "折り返して縫う手順を練習する。",
      operations: [
        {
          type: "learn",
          person: actor,
          text: learnedText,
          basis: learnedBasis,
        },
      ],
      dependencies: [],
    });
    expect(learn.outcome).toMatchObject({ success: true, roll: 2 });
    const { items, skills } = await read();
    expect(skills.slice(0, -1)).toEqual(expected);
    expect(skills.at(-1)).toMatchObject({
      text: learnedText,
      basis: learnedBasis,
    });

    const cloth = items.find(({ label }) => label === "麻布")!.id;
    const craft = {
      command: "update",
      requestId: randomUUID(),
      text: "継ぎ目を折り返して縫い、麻布二枚の覆いを作る。",
      operations: [
        { type: "create", holder: actor, label: "雨よけ", basis: learnedText },
      ],
      materials: [{ id: cloth, count: 2 }],
      dependencies: [],
    };
    decision();
    const crafted = await f.send(0, craft);
    expect(crafted.outcome).toMatchObject({
      success: true,
      roll: 2,
      setting: { consumes: [{ id: cloth, count: 2 }] },
    });
    expect(await f.send(0, craft)).toEqual(crafted);
    expect((await read()).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: cloth, count: 7 }),
        expect.objectContaining({ label: "雨よけ" }),
      ]),
    );

    const sent = transport.mock.calls.map(([, options]) => {
      const { input } = JSON.parse(String(options?.body)) as {
        input: {
          role: string;
          content: { text: string; prompt_cache_breakpoint?: unknown }[];
        }[];
      };
      const user = input.find(({ role }) => role === "user")!;
      const [prefix] = user.content
        .map(({ text }) => text)
        .join("")
        .split("\n", 1);
      let text = "";
      const boundaries = input.flatMap(({ content }) =>
        content.flatMap((block) => {
          text += block.text;
          return block.prompt_cache_breakpoint ? [text] : [];
        }),
      );
      return { skills: JSON.parse(prefix!).actorSkills, boundaries };
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.skills).toEqual(expected);
    expect(sent[1]!.skills).toEqual(skills);
    expect(sent[0]!.boundaries.at(-1)).toBeDefined();
    expect(sent[1]!.boundaries).toContain(sent[0]!.boundaries.at(-1));
  });
  test("生成判定は現在地と明示した保管先の明細を残し、遠隔の明細は呼称と個数を渡す", async () => {
    const f = await fixture(1),
      actor = f.actors[0]!;
    const seed = await f.apply([
      { type: "grant", person: actor, storage: f.place, basis: "作業台" },
      { type: "grant", person: actor, storage: f.far, basis: "対岸の保管先" },
      {
        type: "create",
        holder: f.place,
        label: "織物",
        count: 9,
        basis: "荷覆い用に密に織った",
      },
      {
        type: "create",
        holder: f.far,
        label: "厚板",
        count: 3,
        basis: "対岸で程度をそろえて製材した",
      },
    ]);
    const cloth = seed.changes.nodes.find((n) => n.text === "織物")!.id,
      board = seed.changes.nodes.find((n) => n.text === "厚板")!.id;
    const remoteDetails = [
      f.far,
      "離れた場所",
      [[board, "厚板", null, expect.any(Number), 3]],
    ];
    const work = async (
      text: string,
      label: string,
      options: {
        materials?: { id: string; count: number }[];
        waitMinutes?: number;
      } = {},
    ) => {
      const result = await f.send(0, {
        command: "update",
        text,
        ...options,
        operations: [{ type: "create", label, holder: actor, basis: text }],
        dependencies: [],
      });
      const call = f.calls.mock.calls.findLast(
        ([, role]) => role === "world-creation-dice",
      )![0];
      const saved = (await runtime.agent.model.ledger.input(call)) as {
        request: { messages: { role: string; content: string }[] };
      };
      const sent = JSON.parse(
        saved.request.messages.find(({ role }) => role === "user")!.content,
      ) as {
        storageStockNote?: string;
        nodes: { node: { id: string }; belongings: { storages: unknown[] } }[];
      };
      return {
        result,
        storageStockNote: sent.storageStockNote,
        storages: sent.nodes.find(({ node }) => node.id === actor)!.belongings
          .storages,
      };
    };

    const first = await work("布を二つ切って作業台に敷く", "作業台の覆い", {
      materials: [{ id: cloth, count: 2 }],
    });
    expect(first.storages).toEqual(
      expect.arrayContaining([
        [
          f.place,
          "広場",
          [[cloth, "織物", "荷覆い用に密に織った", expect.any(Number), 9]],
        ],
        [f.far, "離れた場所", [[null, "厚板", null, null, 3]]],
      ]),
    );
    expect(first.storageStockNote).toContain("遠隔");
    expect(first.result.outcome).toMatchObject({
      success: true,
      setting: { consumes: [{ id: cloth, count: 2 }] },
    });
    const context = f.store.context(f.graph);
    expect(await context.node(cloth)).toMatchObject({ count: 7 });
    expect(await context.node(board)).toMatchObject({ count: 3 });

    const referenced = await work(
      "離れた場所の備えを考慮して標識を作る",
      "備えの標識",
    );
    expect(referenced.storages).toContainEqual(remoteDetails);
    const delivery = await work(
      "届くまで時間をかけて道具を取り寄せる",
      "取り寄せの道具",
      {
        waitMinutes: 30,
      },
    );
    expect(delivery.storages).toContainEqual(remoteDetails);

    await f.move(0, f.far);
    const afterMove = await work("作業の手順に使う目印を作る", "手順の目印");
    expect(afterMove.storages).toEqual(
      expect.arrayContaining([
        [f.place, "広場", [[null, "織物", null, null, 7]]],
        remoteDetails,
      ]),
    );
  });
  async function workshop(hulls: number) {
    const f = await fixture(2);
    const seed = await f.apply([
      ...Array.from({ length: hulls }, () => ({
        type: "create",
        label: "船体",
        holder: f.place,
        basis: "建造中",
      })),
      {
        type: "create",
        label: "板材",
        count: 2,
        holder: f.place,
        basis: "製材済み",
      },
      { type: "create", label: "滑車", holder: f.place, basis: "作業用" },
    ]);
    const ids = seed.changes.nodes
      .filter((n) => n.text === "船体")
      .map((n) => n.id);
    const board = seed.changes.nodes.find((n) => n.text === "板材")!.id;
    const plan = (i: number, material?: string, actor = 0) => ({
      text: `組み方${i}で現場の船体を仕上げる`,
      ...(material ? { materials: [{ id: material }] } : {}),
      operations: [
        {
          type: "create",
          holder: f.actors[actor],
          label: "交易船",
          basis: "滑車を使って組み上げた",
        },
      ],
    });
    async function inventory() {
      const holdings = await Promise.all(
        [f.place, ...f.actors].map((id) =>
          readBelongings(f.store.context(f.graph), id),
        ),
      );
      const items = holdings.flatMap((h) => h.items);
      const count = (label: string) =>
        items
          .filter((n) => n.label === label)
          .reduce((sum, n) => sum + (n.count ?? 1), 0);
      return {
        ships: count("交易船"),
        hulls: count("船体"),
        boards: count("板材"),
        tools: count("滑車"),
      };
    }
    return { f, ids, board, plan, inventory };
  }
  test.each([true, false])(
    "技能だけの申請では各出目を保存し、成功した技能だけGMの決定を反映する（成功あり %s）",
    async (learned) => {
      const f = await fixture(1),
        person = f.actors[0]!,
        requestId = randomUUID();
      f.calls.mockImplementationOnce(async (id, role, messages) => {
        expect(role).toBe("world-creation-dice");
        const { proposals } = JSON.parse(String(messages[1]!.content));
        expect(proposals.map((p: { text: string }) => p.text)).toEqual([
          "泉の精から授かる技能",
          "水鏡",
        ]);
        return answer(id, {
          settings: [
            {
              ...(learned ? win : lose),
              decided: [
                { id: proposals[0].changes.nodes[0].id, text: "伏流水を探る" },
              ],
            },
            lose,
          ],
        });
      });
      const request = {
        requestId,
        command: "update",
        text: "泉の精に教えを乞う",
        dependencies: [],
        operations: ["泉の精から授かる技能", "水鏡"].map((text) => ({
          type: "learn",
          person,
          text,
          basis: "泉で教わった",
        })),
      };
      const result = await f.send(0, request);
      expect(result).toMatchObject({
        spentSp: 1,
        outcome: {
          success: learned,
          proposals: [
            { person, roll: 2, success: learned },
            { person, roll: 2, success: false },
          ],
        },
      });
      expect(result.action).toMatchObject({
        message: expect.stringContaining("「水鏡」は出目2で失敗"),
      });
      expect(await f.send(0, request)).toEqual(result);
      const dice = [0, 1].map((i) =>
        derivedId(derivedId(requestId + ":proposal:" + i) + ":creation"),
      );
      expect(
        (
          await isolated.databases.postgres.query(
            "SELECT id FROM bot_dice WHERE id=ANY($1::uuid[])",
            [dice],
          )
        ).rowCount,
      ).toBe(2);
      expect(
        (await readBelongings(f.store.context(f.graph), person)).skills.map(
          (s) => s.text,
        ),
      ).toEqual(learned ? ["伏流水を探る"] : []);
    },
  );
  test.each([true, false])(
    "技能を個別に判定し、船体は製作が成功したときだけ消費する（製作成功 %s）",
    async (built) => {
      const { f, ids, plan, inventory } = await workshop(1);
      const person = f.actors[0]!;
      const craft = plan(1, ids[0]);
      const request = {
        ...craft,
        command: "update",
        requestId: randomUUID(),
        dependencies: [],
        operations: [
          {
            type: "learn",
            person,
            text: "帆を繕う",
            basis: "仕立てを練習した",
          },
          ...craft.operations,
          {
            type: "learn",
            person,
            text: "風を読む",
            basis: "風向きを観察した",
          },
        ],
      };
      f.calls.mockImplementationOnce(async (id, role, messages) => {
        expect(role).toBe("world-creation-dice");
        const { proposals } = JSON.parse(String(messages[1]!.content));
        expect(proposals).toHaveLength(3);
        expect(proposals[0].materials).toBeUndefined();
        expect(proposals[1].materials).toBeUndefined();
        expect(proposals[2].materials).toMatchObject([
          { id: ids[0], available: 1 },
        ]);
        return answer(id, { settings: [win, lose, built ? win : lose] });
      });
      const result = await f.send(0, request);
      expect(result).toMatchObject({
        spentSp: 1,
        outcome: {
          success: true,
          proposals: [
            { text: "帆を繕う", roll: 2, success: true },
            { text: "風を読む", roll: 2, success: false },
            { text: craft.text, roll: 2, success: built },
          ],
        },
      });
      expect(await f.send(0, request)).toEqual(result);
      expect((await f.status(0)).callsUsed).toBe(1);
      expect(
        (await readBelongings(f.store.context(f.graph), person)).skills.map(
          (s) => s.text,
        ),
      ).toEqual(["帆を繕う"]);
      expect(await inventory()).toEqual({
        ships: built ? 1 : 0,
        hulls: built ? 0 : 1,
        boards: 2,
        tools: 1,
      });
    },
  );
  test("すべての技能に失敗しても移動はダイスなしで成立する", async () => {
    const f = await fixture(1),
      person = f.actors[0]!;
    f.calls.mockResolvedValueOnce(
      answer(randomUUID(), { settings: [lose, lose] }),
    );
    const result = await f.send(0, {
      command: "update",
      text: "稽古をしながら移動する",
      dependencies: [],
      operations: [
        {
          type: "locate",
          subjectId: person,
          text: "離れた場所",
          aboutIds: [f.far],
          directPlaceId: f.far,
        },
        ...["足運び", "呼吸法"].map((text) => ({
          type: "learn",
          person,
          text,
          basis: "稽古した",
        })),
      ],
    });
    expect(result.outcome).toMatchObject({
      success: true,
      proposals: [
        { roll: 2, success: false },
        { roll: 2, success: false },
        { success: true },
      ],
    });
    expect(
      (result.outcome as { proposals: object[] }).proposals[2],
    ).not.toHaveProperty("roll");
    expect(await directPlaces(f.store.context(f.graph), person)).toEqual([
      f.far,
    ]);
    expect(
      (await readBelongings(f.store.context(f.graph), person)).skills,
    ).toHaveLength(0);
  });
  test("一括の各案で技能の成否と船体の残数を独立に扱う", async () => {
    const { f, ids, plan, inventory } = await workshop(1);
    const first = plan(1, ids[0]),
      second = plan(2, ids[0]);
    f.calls.mockResolvedValueOnce(
      answer(randomUUID(), { settings: [win, lose, win, win] }),
    );
    const result = await f.send(0, {
      command: "create-batch",
      dependencies: [],
      proposals: [
        {
          ...first,
          operations: [
            ...first.operations,
            ...["帆縫い", "操舵"].map((text) => ({
              type: "learn",
              person: f.actors[0],
              text,
              basis: "指導を受けた",
            })),
          ],
        },
        second,
      ],
    });
    expect(result.outcome).toMatchObject({
      proposals: [
        {
          text: first.text,
          success: true,
          proposals: [
            { roll: 2, success: true },
            { roll: 2, success: false },
            { roll: 2, success: true },
          ],
        },
        { text: second.text, success: false, reason: "MATERIAL_SHORTAGE" },
      ],
    });
    expect(await inventory()).toEqual({
      ships: 1,
      hulls: 0,
      boards: 2,
      tools: 1,
    });
  });
  test("単独の失敗は船体を残し、成功は現地の現物を一度消費して滑車を残す", async () => {
    const { f, ids, plan, inventory } = await workshop(1);
    f.calls.mockResolvedValueOnce(answer(randomUUID(), lose));
    await f.send(0, {
      command: "update",
      ...plan(1, ids[0]),
      dependencies: [],
    });
    expect(await inventory()).toEqual({
      ships: 0,
      hulls: 1,
      boards: 2,
      tools: 1,
    });
    // 呼称だけでも現在地で一意なら同じ現物を消費できる。
    f.calls.mockResolvedValueOnce(
      answer(randomUUID(), { ...win, requiredMaterials: [{ label: "船体" }] }),
    );
    await f.send(0, { command: "update", ...plan(2), dependencies: [] });
    expect(await inventory()).toEqual({
      ships: 1,
      hulls: 0,
      boards: 2,
      tools: 1,
    });
  });
  test("同じ船体の5案は失敗、成功、材料不足3件で交易船1隻", async () => {
    const { f, ids, plan, inventory } = await workshop(1);
    const requestId = randomUUID();
    f.calls.mockResolvedValueOnce(
      answer(randomUUID(), { settings: [lose, win, win, win, win] }),
    );
    const command = {
      command: "create-batch",
      requestId,
      dependencies: [],
      proposals: Array.from({ length: 5 }, (_, i) => plan(i, ids[0])),
    };
    const result = await f.send(0, command);
    expect(result).toMatchObject({
      outcome: {
        proposals: [
          { roll: 2, success: false },
          { roll: 2, success: true, setting: { consumes: [{ id: ids[0] }] } },
          ...Array(3).fill({ success: false, reason: "MATERIAL_SHORTAGE" }),
        ],
      },
    });
    const missing = [2, 3, 4].map((i) =>
      derivedId(derivedId(requestId + ":proposal:" + i) + ":creation"),
    );
    expect(
      (
        await isolated.databases.postgres.query(
          "SELECT id FROM bot_dice WHERE id=ANY($1::uuid[])",
          [missing],
        )
      ).rowCount,
    ).toBe(0);
    expect(await f.send(0, command)).toEqual(result);
    expect(await inventory()).toEqual({
      ships: 1,
      hulls: 0,
      boards: 2,
      tools: 1,
    });
  });
  test("申請の利用量を日・利用者・コマンド別に数え、旧記録は日単位で扱う", async () => {
    const { f, ids, plan } = await workshop(2);
    const db = isolated.databases.postgres,
      user = f.people[0]!.id,
      batchId = randomUUID(),
      updateId = randomUUID();
    const first = plan(1, ids[0]);
    // 技能ごとに分けた出目は3つでも、元案は2案。2案目は材料不足で振らない。
    const batch = {
      command: "create-batch",
      requestId: batchId,
      dependencies: [],
      proposals: [
        {
          ...first,
          operations: [
            ...first.operations,
            ...["帆縫い", "操舵"].map((text) => ({
              type: "learn",
              person: f.actors[0],
              text,
              basis: "指導を受けた",
            })),
          ],
        },
        plan(2, ids[0]),
      ],
    };
    f.calls.mockResolvedValueOnce(
      answer(randomUUID(), { settings: [win, lose, win, win] }),
    );
    await f.send(0, batch);
    await f.send(0, batch);
    f.calls.mockResolvedValueOnce(answer(randomUUID(), lose));
    await f.send(0, {
      command: "update",
      requestId: updateId,
      ...plan(3, ids[1]),
      dependencies: [],
    });
    // 抽選前の拒否はSPを使わず、出目もない。
    await expect(
      f.send(0, {
        command: "create-batch",
        dependencies: [],
        proposals: [plan(4), plan(4)],
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_PROPOSAL" });
    // 生成GMの呼出しは呼出しごとのoperation_idを持ち、元の要求IDはresponse_idに残る。
    await db.query(
      `INSERT INTO llm_call(id,budget_id,hash,reserved_nano,request,world_id,response_id,operation_id)
       SELECT $1,id,'fixture',0,'{}',$2,$3,$4 FROM llm_budget LIMIT 1`,
      [randomUUID(), f.graph, batchId, randomUUID()],
    );
    const { resetsAt } = await access.botPlay.dailySp(f.world, user);
    const day = {
      worldId: f.world,
      from: new Date(Date.parse(resetsAt) - 86400000).toISOString(),
      to: resetsAt,
    };
    const read = (query: typeof day) => readPlayUsage(db, f.store, query);
    const date = new Date(Date.parse(day.from) + 9 * 3600000)
      .toISOString()
      .slice(0, 10);
    const base = {
      date,
      userId: user,
      rolledIncomplete: 0,
      notRolled: 0,
      originalsUnknown: 0,
      batchSizes: {},
      results: { succeeded: 0, partial: 0, failed: 0 },
      gmCalls: 0,
    };
    const batchRow = {
      ...base,
      command: "create-batch",
      requests: 2,
      completed: 1,
      notRolled: 1,
      originals: 2,
      originalsUnknown: 1,
      batchSizes: { 2: 1 },
      rolls: { fresh: 3, reused: 0, unrolled: 1, succeeded: 2 },
      results: { ...base.results, partial: 1 },
      spentSp: 1,
      gmCalls: 1,
      changes: { receipts: 1, existences: 1, items: 1, skills: 1 },
    };
    const updateRow = {
      ...base,
      command: "update",
      requests: 1,
      completed: 1,
      originals: 1,
      rolls: { fresh: 1, reused: 0, unrolled: 0, succeeded: 0 },
      results: { ...base.results, failed: 1 },
      spentSp: 1,
    };
    expect(await read(day)).toMatchObject({
      rows: [batchRow, updateRow],
      missing: { timeOfDay: 0 },
    });
    // 受付時刻・利用者・コマンドのない旧記録は、SPの消費日と結果から同じ行へ戻す。
    await db.query(
      "UPDATE bot_request SET received_at=NULL,user_id=NULL,command=NULL WHERE id=$1",
      [updateId],
    );
    expect((await read(day)).rows).toMatchObject([batchRow, updateRow]);
    // 日の一部だけの期間では、時刻の分からない旧記録を欠測として数える。
    const hour = {
      ...day,
      to: new Date(
        Math.min(Date.now() + 3600000, Date.parse(resetsAt) - 1),
      ).toISOString(),
    };
    expect(await read(hour)).toMatchObject({
      rows: [batchRow],
      missing: { timeOfDay: 1 },
    });
  });
  test("船体2件は2隻まで、板材3個の指定は在庫2個のまま材料不足", async () => {
    const { f, ids, board, plan, inventory } = await workshop(2);
    f.calls.mockResolvedValueOnce(
      answer(randomUUID(), { settings: [win, win, win] }),
    );
    await f.send(0, {
      command: "create-batch",
      dependencies: [],
      proposals: [plan(1, ids[0]), plan(2, ids[1]), plan(3, ids[1])],
    });
    f.calls.mockResolvedValueOnce(
      answer(randomUUID(), { ...win, consumes: [{ id: board, count: 3 }] }),
    );
    const result = await f.send(0, {
      command: "update",
      ...plan(4),
      materials: [{ id: board, count: 3 }],
      dependencies: [],
    });
    expect(result).toMatchObject({
      outcome: { reason: "MATERIAL_SHORTAGE", success: false },
    });
    expect(await inventory()).toEqual({
      ships: 2,
      hulls: 0,
      boards: 2,
      tools: 1,
    });
  });
  test("二人が同じ現物から同時に作って再送しても1隻", async () => {
    const { f, ids, plan, inventory } = await workshop(1);
    const cmds = [0, 1].map((i) => ({
      command: "update",
      requestId: randomUUID(),
      ...plan(i, ids[0], i),
      dependencies: [],
    }));
    // 両者が同じ在庫を読んでから判定を返す。
    let enter = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.calls.mockImplementation(async (id) => {
      if (++enter === 2) release();
      await barrier;
      return answer(id, win);
    });
    const sent = await Promise.allSettled(cmds.map((cmd, i) => f.send(i, cmd)));
    expect(enter).toBe(2);
    const winner = sent.findIndex(
      (r) =>
        r.status === "fulfilled" &&
        (r.value.outcome as { success?: boolean })?.success,
    );
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(await f.send(winner, cmds[winner]!)).toEqual(
      (sent[winner] as PromiseFulfilledResult<unknown>).value,
    );
    const retry = await Promise.allSettled([
      f.send(1 - winner, cmds[1 - winner]!),
    ]);
    expect(retry[0]).not.toMatchObject({
      status: "fulfilled",
      value: { outcome: { success: true } },
    });
    expect(await inventory()).toEqual({
      ships: 1,
      hulls: 0,
      boards: 2,
      tools: 1,
    });
  });
  test("自由入力の現物が二つあると材料の指定を求め、振らずに現物を残す", async () => {
    const { f, plan, inventory } = await workshop(2);
    const requestId = randomUUID();
    f.calls.mockResolvedValueOnce(
      answer(randomUUID(), { ...win, requiredMaterials: [{ label: "船体" }] }),
    );
    expect(
      await f.send(0, {
        command: "update",
        requestId,
        ...plan(1),
        dependencies: [],
      }),
    ).toMatchObject({
      outcome: { success: false, reason: "MATERIAL_ID_REQUIRED" },
    });
    expect(
      (
        await isolated.databases.postgres.query(
          "SELECT id FROM bot_dice WHERE id=$1",
          [derivedId(requestId + ":creation")],
        )
      ).rowCount,
    ).toBe(0);
    expect(await inventory()).toEqual({
      ships: 0,
      hulls: 2,
      boards: 2,
      tools: 1,
    });
  });
});

test("探索と複数案の生成は日次SPを共有し、生成と素材消費は成功した案だけに一度適用する", async () => {
  const f = await fixture(),
    db = isolated.databases.postgres,
    holder = f.actors[0]!;
  const stock = await f.apply([
    { type: "create", label: "布", count: 4, holder, basis: "初期設定" },
  ]);
  const material = stock.changes.nodes[0]!.id;
  const setting = {
    sides: 6,
    successThrough: 3,
    consumes: [{ id: material, count: 1 }],
  };
  const explore = {
    command: "explore",
    text: "水場の先の道",
    label: "水場",
    fromId: f.place,
    dependencies: [],
  };
  await expect(f.send(0, { ...explore, fromId: f.far })).rejects.toMatchObject({
    code: "EXPLORE_SOURCE_REQUIRED",
  });
  expect((await f.status(0)).dailySp).toMatchObject({ remaining: 100 });
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { sides: 100, successThrough: 100, explored }),
  );
  expect(await f.send(0, explore)).toMatchObject({
    spentSp: 1,
    dailySp: { remaining: 99 },
  });
  const proposals = ["袋", "帽子", "敷物", "幕"].map((text) => ({
    text,
    operations: [{ type: "create", label: text, holder, basis: "製作" }],
  }));
  const requestId = randomUUID(),
    batch = { command: "create-batch", requestId, proposals, dependencies: [] };
  expect(
    PlayCommand.safeParse({ ...batch, proposals: [...proposals, ...proposals] })
      .success,
  ).toBe(false);
  await expect(
    f.send(0, {
      ...batch,
      requestId: randomUUID(),
      proposals: [
        proposals[0],
        {
          text: "歩く",
          operations: [
            {
              type: "locate",
              subjectId: holder,
              text: "元の場所",
              aboutIds: [f.place],
            },
          ],
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "CREATION_REQUIRED" });
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    expect(JSON.parse(String(messages[1]!.content)).proposals).toHaveLength(4);
    for (const [i, roll] of [1, 6, 2].entries())
      await db.query("INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,$3)", [
        derivedId(derivedId(`${requestId}:proposal:${i}`) + ":creation"),
        setting,
        roll,
      ]);
    return answer(id, {
      settings: [
        setting,
        setting,
        setting,
        { ...setting, consumes: [{ id: material, count: 3 }] },
      ],
    });
  });
  const created = await f.send(0, batch);
  expect(created).toMatchObject({
    spentSp: 3,
    dailySp: { remaining: 96 },
    outcome: {
      proposals: [
        { roll: 1, success: true },
        { roll: 6, success: false },
        { roll: 2, success: true },
        { success: false, reason: "MATERIAL_SHORTAGE" },
      ],
    },
  });
  expect(
    (
      await db.query("SELECT 1 FROM bot_dice WHERE id=$1", [
        derivedId(derivedId(`${requestId}:proposal:3`) + ":creation"),
      ])
    ).rowCount,
  ).toBe(0);
  expect(await f.send(0, batch)).toEqual(created);
  const items = (await readBelongings(f.store.context(f.graph), holder)).items;
  expect(items.map((i) => i.label).sort()).toEqual(["布", "敷物", "袋"].sort());
  expect(items.find((i) => i.id === material)?.count).toBe(2);
  expect(f.calls).toHaveBeenCalledTimes(2);
  const failure = randomUUID();
  f.calls.mockImplementationOnce(async (id) => {
    await db.query("INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,6)", [
      derivedId(failure + ":creation"),
      setting,
    ]);
    return answer(id, setting);
  });
  const missed = await f.send(0, {
    command: "update",
    requestId: failure,
    ...proposals[0],
    dependencies: [],
  });
  expect(missed).toMatchObject({
    spentSp: 1,
    dailySp: { remaining: 95 },
    outcome: { success: false },
  });
  expect(
    (await readBelongings(f.store.context(f.graph), holder)).items.find(
      (i) => i.id === material,
    )?.count,
  ).toBe(2);
});

test("世界別のSP上限を下げた当日も消費を引き継ぎ、翌日に新しい上限まで回復する", async () => {
  const f = await fixture();
  const other = await fixture();
  const db = isolated.databases.postgres;
  const user = f.people[0]!.id;
  const admin = await auth.person();
  const time = vi
    .spyOn(access.botPlay, "now")
    .mockReturnValue(new Date("2026-11-20T14:59:59Z"));
  const { resetsAt } = await access.botPlay.dailySp(f.world, user);
  try {
    await db.query(
      `INSERT INTO bot_request(id,actor_id,world_id,hash,sp_user,sp_reset)
       SELECT gen_random_uuid(),$1,$2,'fixture',$3,$4 FROM generate_series(1,51)`,
      [f.actors[0], f.world, user, resetsAt],
    );
    expect((await f.status(0)).dailySp).toMatchObject({
      limit: 100,
      remaining: 49,
    });
    const configure = {
      operation: "worlds.configure" as const,
      worldId: f.world,
      title: "日次SP試験",
      description: "",
      published: false,
      accepting: false,
      reason: "日次SP上限を確認する",
    };
    for (const input of [{ ...configure, dailySpLimit: 50 }, configure])
      expect(
        await auth.operations.execute(admin.id, randomUUID(), input, {
          players: access.players,
        }),
      ).toMatchObject({ dailySpLimit: 50 });
    expect((await f.status(0)).dailySp).toEqual({
      limit: 50,
      remaining: 0,
      resetsAt,
    });
    expect((await other.status(0)).dailySp).toMatchObject({
      limit: 100,
      remaining: 100,
    });
    await expect(
      f.send(0, {
        command: "explore",
        text: "水場へ通じる道を探す",
        label: "水場",
        fromId: f.place,
        dependencies: [],
      }),
    ).rejects.toMatchObject({ code: "DAILY_SP_EXHAUSTED" });
    time.mockReturnValue(new Date("2026-11-20T15:00:00Z"));
    expect((await f.status(0)).dailySp).toMatchObject({
      limit: 50,
      remaining: 50,
    });
  } finally {
    time.mockRestore();
  }
});

test("同じ利用者の残り1 SPを同時申請で共有し、使い切った後も移動・結果取得・日次回復ができる", async () => {
  const f = await fixture(),
    db = isolated.databases.postgres,
    user = f.people[0]!.id;
  const time = vi
    .spyOn(access.botPlay, "now")
    .mockReturnValue(new Date("2026-11-20T14:59:59Z"));
  const { resetsAt } = await access.botPlay.dailySp(f.world, user);
  expect(resetsAt).toBe("2026-11-20T15:00:00.000Z");
  await db.query(
    `INSERT INTO bot_request(id,actor_id,world_id,hash,sp_user,sp_reset) SELECT gen_random_uuid(),$1,$2,'fixture',$3,$4 FROM generate_series(1,99)`,
    [f.actors[0], f.world, user, resetsAt],
  );
  await db.query(
    "INSERT INTO world_access(subject_id,construction_id,role,actor_id) VALUES($1,$2,'player',$3)",
    [user, f.world, f.actors[1]],
  );
  const requests = [0, 1].map((i) =>
    PlayCommand.parse({
      requestId: randomUUID(),
      command: "create",
      text: "作成",
      changes: {
        nodes: [{ id: randomUUID(), kind: "existence", text: `道具${i}` }],
        edges: [],
        endEdges: [],
      },
      dependencies: [],
    }),
  );
  const send = (i: number) =>
    access.botCommand(user, f.world, requests[i]!, f.actors[i]);
  f.calls.mockImplementation(async (id, _role, messages) => {
    const changes = JSON.parse(String(messages[1]!.content)).changes;
    const i = Number(changes.nodes[0].text.slice(-1));
    const setting = { sides: 2, successThrough: 1 };
    await db.query("INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,2)", [
      derivedId(requests[i]!.requestId + ":creation"),
      setting,
    ]);
    return answer(id, setting);
  });
  const results = await Promise.allSettled([send(0), send(1)]);
  const winner = results.findIndex((r) => r.status === "fulfilled");
  expect(winner).toBeGreaterThanOrEqual(0);
  expect(results[1 - winner]).toMatchObject({
    status: "rejected",
    reason: { code: "DAILY_SP_EXHAUSTED" },
  });
  expect(f.calls).toHaveBeenCalledTimes(1);
  expect(await send(winner)).toMatchObject({
    spentSp: 1,
    dailySp: { remaining: 0 },
  });
  vi.spyOn(runtime.agent.model, "decision", "get").mockReturnValue(
    decisionSettings({ LLM_DECISION_MODEL: "fixture/decide" }),
  );
  vi.spyOn(runtime.agent.model, "decide").mockResolvedValue({ f0: 1 });
  const reused = await access.botCommand(
    user,
    f.world,
    { ...requests[winner]!, requestId: randomUUID() },
    f.actors[winner],
  );
  expect(reused).toMatchObject({
    spentSp: 0,
    dailySp: { remaining: 0 },
    outcome: { repeated: true, roll: 2 },
  });
  expect(f.calls).toHaveBeenCalledTimes(1);
  const moved = await f.send(0, {
    command: "update",
    text: "移動",
    operations: [
      {
        type: "locate",
        subjectId: f.actors[0],
        text: "離れた場所",
        aboutIds: [f.far],
      },
    ],
    dependencies: [],
  });
  expect(moved).toMatchObject({ spentSp: 0, dailySp: { remaining: 0 } });
  time.mockReturnValue(new Date(resetsAt));
  expect(await send(1 - winner)).toMatchObject({
    spentSp: 1,
    dailySp: { remaining: 99 },
  });
});

test("抽選器を審査し、別の人物が結果を受け取り、同席者の履歴に残す", async () => {
  const f = await fixture();
  const [creator, visitor] = f.actors;
  const shrine = (
    await f.apply([
      {
        type: "create",
        holder: visitor,
        label: "旅の祠",
        basis: "検証用の持ち物",
      },
    ])
  ).changes.nodes[0]!.id;
  const search = (i: number, targetId: string) =>
    f.send(i, {
      command: "search",
      query: { kind: "subject", targetId },
    });
  const configure = (targetId: string, description: string) =>
    f.send(0, { command: "draw-configure", targetId, description });
  const draw = (i: number, targetId: string) =>
    f.send(i, { command: "draw", targetId });
  expect(() => configure(f.place, "  ")).toThrow();
  expect(f.calls).not.toHaveBeenCalled();
  await f.send(1, { command: "contact", targetId: creator });
  await expect(draw(1, f.place)).rejects.toMatchObject({
    code: "TURN_REQUIRED",
  });
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { accepted: false, reason: "由来が不明です" }),
  );
  expect(await configure(f.place, "何でも出る")).toMatchObject({
    accepted: false,
    state: "rejected",
    reason: "由来が不明です",
    spentSp: 0,
  });
  expect((await search(0, f.place)).material).not.toHaveProperty("draw");
  vi.spyOn(runtime.agent.model, "decision", "get").mockReturnValue(
    decisionSettings({ LLM_DECISION_MODEL: "fixture/decide" }),
  );
  const jev = vi
    .spyOn(runtime.agent.model, "decide")
    .mockResolvedValueOnce({ f0: 1 });
  expect(await configure(f.place, "どんな物でも得られる")).toMatchObject({
    accepted: false,
    reason: "由来が不明です",
    repeated: true,
    spentSp: 0,
  });
  expect(jev).toHaveBeenCalledWith(
    expect.any(String),
    "world-draw-repeat",
    expect.any(Object),
    expect.any(Object),
  );
  expect(f.calls).toHaveBeenCalledTimes(1);
  jev.mockResolvedValueOnce({ f0: 0 });
  f.calls.mockImplementation(async (id, role, messages) => {
    if (role === "world-draw-review")
      return answer(id, { accepted: true, reason: "範囲が明確です" });
    expect(role).toBe("world-draw");
    const material = JSON.parse(String(messages[1]!.content));
    expect(JSON.stringify(messages)).not.toMatch(/幻の王冠|看板の下/);
    return answer(
      id,
      material.target === "旅の祠"
        ? {
            kind: "skill",
            text: "乾いた木材の空洞を、表面を叩いた音で聞き分けられる",
          }
        : { kind: "item", label: "片側だけの真鍮の蝶番" },
    );
  });
  const description = "ガラクタの中から道具の部品が一つ見つかる";
  expect(await configure(f.place, description)).toMatchObject({
    accepted: true,
    state: "confirmed",
    spentSp: 0,
  });
  const pending = await configure(
    shrine,
    "旅の祈りで木工に関わる小さな技能を授かる",
  );
  expect(pending).toMatchObject({
    accepted: true,
    state: "receiving",
    spentSp: 0,
  });
  await f.send(1, {
    command: "receive",
    applicationId: pending.applicationId,
    accept: true,
  });
  await f.send(0, { command: "say", text: "幻の王冠が出ますように" });
  await expect(draw(0, shrine)).rejects.toMatchObject({
    code: "DRAW_NOT_IN_REACH",
  });
  await f.send(0, { command: "end-turn" });
  const nearby = await f.send(1, {
    command: "search",
    query: { kind: "surroundings" },
  });
  expect(nearby.material).toMatchObject({
    subjects: expect.arrayContaining([
      expect.objectContaining({
        id: f.place,
        draw: expect.objectContaining({
          mode: "gm",
          description,
          spCost: 1,
          available: true,
        }),
      }),
    ]),
  });
  expect((await search(1, shrine)).material).toMatchObject({
    draw: { available: true, spCost: 1 },
  });
  expect(
    f.calls.mock.calls.filter(([, role]) => role === "world-draw"),
  ).toHaveLength(0);
  const request = {
    command: "draw",
    requestId: randomUUID(),
    targetId: f.place,
    text: "看板の下を探る。幻の王冠が欲しい",
  };
  const beforeDraw = (await f.status(1)).callsUsed;
  const commit = f.store.commit.bind(f.store);
  vi.spyOn(f.store, "commit").mockImplementationOnce(async (...args) => {
    await commit(...args);
    throw new Error("グラフ確定後に接続が切れた");
  });
  await expect(f.send(1, request)).rejects.toThrow(
    "グラフ確定後に接続が切れた",
  );
  const item = await f.send(1, request);
  expect(item).toMatchObject({
    reward: { kind: "item", label: "片側だけの真鍮の蝶番" },
    spentSp: 1,
    dailySp: { remaining: 99 },
  });
  expect(item.callsUsed).toBe(Number(beforeDraw) + 1);
  expect(await f.send(1, request)).toEqual(item);
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  const profile = join(cli.directory, "draw.json");
  let skill;
  try {
    const connected = await cli.run(
      profile,
      "connect",
      "--server",
      cli.base,
      "--world",
      f.world,
    );
    await cli.approve(
      f.people[1]!.cookie,
      connected.userCode,
      `actor:${visitor}`,
    );
    cli.dropNextResponse("draw");
    const lost = await cli.run(
      profile,
      "draw",
      "--target",
      shrine,
      "--full-ids",
    );
    expect(lost.state).toBe("error");
    const recovered = await cli.run(profile, "recover", "--full-ids");
    expect(recovered.requestId).toBe(lost.requestId);
    skill = recovered.result;
  } finally {
    await cli.close();
  }
  expect(skill).toMatchObject({
    reward: { kind: "skill" },
    spentSp: 1,
    dailySp: { remaining: 98 },
  });
  expect(
    await readBelongings(f.store.context(f.graph), visitor!),
  ).toMatchObject({
    items: expect.arrayContaining([
      expect.objectContaining({ id: (item.reward as { id: string }).id }),
    ]),
    skills: [
      expect.objectContaining({
        id: (skill.reward as { id: string }).id,
        text: expect.stringContaining("乾いた木材"),
      }),
    ],
  });
  await f.send(1, { command: "end-turn" });
  const witness = JSON.stringify((await f.status(0)).entries);
  expect(witness).toContain("看板の下を探る");
  expect(witness).toContain("片側だけの真鍮の蝶番");
  expect(witness).toContain("乾いた木材");
  expect(
    f.calls.mock.calls.filter(([, role]) => role === "world-draw"),
  ).toHaveLength(2);
});

test("技能枠が満杯でも元技能を本人が選んだときだけ作成判定し、成功時だけ入れ替える", async () => {
  const f = await fixture(2);
  const actor = f.actors[0]!,
    other = f.actors[1]!;
  const skill = (person: string, text: string, consumeSkillIds?: string[]) => ({
    type: "learn",
    person,
    text,
    basis: "星と潮の観測を続けた",
    ...(consumeSkillIds ? { consumeSkillIds } : {}),
  });
  await f.apply([
    skill(actor, "星位の測定"),
    skill(actor, "潮流の観測"),
    skill(other, "測量"),
  ]);
  await f.store.configureInventory(f.graph, false, { skillSlots: 2 });
  const list = (person: string) =>
    readBelongings(f.store.context(f.graph), person);
  const ids = (await list(actor)).skills.map((s) => s.id);
  const request = (op: ReturnType<typeof skill>, text = op.text) => ({
    requestId: randomUUID(),
    command: "update",
    text,
    operations: [op],
    dependencies: [],
  });
  await expect(
    f.send(0, request(skill(actor, "帆を縫う"))),
  ).rejects.toMatchObject({ code: "SKILL_CAPACITY_EXCEEDED" });
  await expect(
    f.send(
      0,
      request(skill(other, "測量の応用", [(await list(other)).skills[0]!.id])),
    ),
  ).rejects.toMatchObject({ code: "UPDATE_REJECTED" });
  await expect(
    f.send(
      0,
      request(skill(actor, "測量の応用", [(await list(other)).skills[0]!.id])),
    ),
  ).rejects.toMatchObject({ code: "UPDATE_REJECTED" });
  expect(() =>
    PlayCommand.parse(request(skill(actor, "重複", [ids[0]!, ids[0]!]))),
  ).toThrow();
  expect(f.calls).not.toHaveBeenCalled();
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    expect(
      JSON.parse(String(messages[1]!.content)).learning[0].consumeSkillIds,
    ).toEqual(ids);
    expect(JSON.stringify(messages)).toContain("潮流の観測");
    return answer(id, { sides: 2147483647, successThrough: 1 });
  });
  const lost = await f.send(0, request(skill(actor, "遠洋航海", ids)));
  expect(lost.outcome).toMatchObject({ success: false });
  expect((await list(actor)).skills.map((s) => s.id)).toEqual(ids);
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    const node = JSON.parse(String(messages[1]!.content)).changes.nodes[0];
    return answer(id, {
      ...sure,
      decided: [{ id: node.id, text: "星位と潮流から夜の沿岸航路を選べる" }],
    });
  });
  const next = request(
    skill(actor, "観測を合わせた沿岸技能を師匠に委ねる", ids),
  );
  const won = await f.send(0, next);
  expect(won.outcome).toMatchObject({ success: true });
  expect(await f.send(0, next)).toEqual(won);
  expect((await list(actor)).skills.map((s) => s.text)).toEqual([
    "星位と潮流から夜の沿岸航路を選べる",
  ]);
  expect((await list(actor)).skillCapacity).toEqual({
    usedSlots: 1,
    limitSlots: 2,
  });
});

async function fixedTableFixture() {
  const f = await fixture();
  const send = (
    command: string,
    fields: Record<string, unknown> = {},
    actor = 0,
  ) => f.send(actor, { command, targetId: f.place, ...fields });
  let revision = 0;
  const edit = async (fromPublished = false) => {
    const result = await send("draw-table-edit", { fromPublished });
    revision = Number(result.revision);
    return result;
  };
  const change = async (command: string, fields: Record<string, unknown>) => {
    const result = await send(command, { revision, ...fields });
    revision = Number(result.revision);
    return result;
  };
  const settings = (description: string, price: unknown = null) =>
    change("draw-table-settings", { description, price });
  const put = (result: unknown, fields: Record<string, unknown> = {}) =>
    change("draw-table-put", { result, ...fields });
  const publish = () => send("draw-table-publish", { revision });
  const approve = () =>
    f.calls.mockImplementationOnce(async (id, role) => {
      expect(role).toBe("world-draw-review");
      return answer(id, { accepted: true, reason: "候補と説明が対応する" });
    });
  await edit();
  return { ...f, send, edit, change, settings, put, publish, approve };
}

test("抽選の見積もりは公開版に従い、同意額を超える抽選は確定しない", async () => {
  const f = await fixedTableFixture();
  await f.settings("札を一枚引く");
  await f.put({ kind: "message", text: "白い札" });
  f.approve();
  const free = await f.publish();
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const path = `/api/worlds/${f.world}/session`;
  const requestId = randomUUID();
  const request = {
    method: "POST" as const,
    headers: { cookie: f.people[1]!.cookie, "x-gestaloka-request": "1" },
    payload: { command: "draw", targetId: f.place, requestId },
  };
  try {
    const initial = await app.inject({ ...request, url: `${path}/quote` });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({
      expectedSp: 0,
      chargeWhen: "never",
      versionId: free.versionId,
    });
    const stored = await isolated.databases.postgres.query(
      "SELECT 1 FROM bot_request WHERE id=$1",
      [requestId],
    );
    expect(stored.rowCount).toBe(0);
    expect(f.calls).toHaveBeenCalledTimes(1);

    await f.edit(true);
    await f.settings("札か潮を読む技を授ける");
    await f.put({ kind: "skill", text: "潮を読む" });
    f.approve();
    const paid = await f.publish();
    const revised = await app.inject({ ...request, url: `${path}/quote` });
    expect(revised.json()).toEqual({
      expectedSp: 1,
      chargeWhen: "draw-saved",
      versionId: paid.versionId,
    });

    const refused = await app.inject({
      ...request,
      url: `${path}?expectedSp=0`,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("SP_QUOTE_CHANGED");
    const missingVersion = await app.inject({
      ...request,
      url: `${path}?expectedSp=1`,
      payload: { ...request.payload, requestId: randomUUID() },
    });
    expect(missingVersion.statusCode).toBe(409);
    expect(missingVersion.json().code).toBe("DRAW_TABLE_CHANGED");
    expect((await f.status(1)).dailySp.remaining).toBe(100);

    const accepted = {
      ...request,
      url: `${path}?expectedSp=1`,
      payload: {
        ...request.payload,
        requestId: randomUUID(),
        versionId: paid.versionId,
      },
    };
    const result = await app.inject(accepted);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      spentSp: 1,
      versionId: paid.versionId,
    });
    expect((await app.inject(accepted)).json()).toEqual(result.json());
    expect((await f.status(1)).dailySp.remaining).toBe(99);
    expect(f.calls).toHaveBeenCalledTimes(2);
  } finally {
    await app.close();
  }
});

test("固定表の下書きで重み・候補・確率を確認し、審査の却下後も公開版で引ける", async () => {
  const f = await fixedTableFixture();
  await f.settings("札を一枚引く");
  await expect(f.publish()).rejects.toMatchObject({
    code: "DRAW_TABLE_INCOMPLETE",
  });
  const entry = (text: string) => ({ kind: "message", text });
  const first = await f.put(entry("吉"));
  const second = await f.put(entry("小吉"));
  const third = await f.put(entry("大吉"));
  expect(third.entries).toMatchObject([
    { probability: 1 / 3 },
    { probability: 1 / 3 },
    { probability: 1 / 3 },
  ]);
  expect(
    await f.put(entry("小吉"), {
      entryId: (second.entries as { entryId: string }[])[1]!.entryId,
      weight: 2,
    }),
  ).toMatchObject({
    totalWeight: 4,
    entries: [
      { probability: 0.25 },
      { probability: 0.5 },
      { probability: 0.25 },
    ],
  });
  const firstId = (first.entries as { entryId: string }[])[0]!.entryId;
  f.approve();
  const published = await f.publish();
  expect(published).toMatchObject({
    state: "confirmed",
    accepted: true,
    spentSp: 0,
  });
  await expect(f.send("draw-table-edit", {}, 1)).rejects.toMatchObject({
    code: "DRAW_TABLE_AUTHORITY",
  });
  await f.edit(true);
  await f.change("draw-table-remove", { entryId: firstId });
  expect(
    await f.send("draw-table-show", { view: "published" }, 1),
  ).toMatchObject({
    versionId: published.versionId,
    totalWeight: 4,
    entries: [{ weight: 1 }, { weight: 2 }, { weight: 1 }],
  });
  const requestId = randomUUID();
  const drawn = await f.send("draw", { requestId, text: "大吉を出す" }, 1);
  expect(drawn).toMatchObject({
    versionId: published.versionId,
    spentSp: 0,
    payment: null,
    result: { kind: "message" },
  });
  expect(f.calls).toHaveBeenCalledTimes(1);
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-draw-review");
    expect(JSON.parse(String(messages[1]!.content)).table.entries).toHaveLength(
      2,
    );
    return answer(id, { accepted: false, reason: "説明を補ってください" });
  });
  expect(await f.publish()).toMatchObject({ state: "rejected" });
  expect(await f.send("draw", {}, 1)).toMatchObject({
    versionId: published.versionId,
    spentSp: 0,
  });
  f.approve();
  await f.settings("二種類の札から一枚引く");
  const replacement = await f.publish();
  expect(replacement).toMatchObject({ state: "confirmed" });
  expect(await f.send("draw", { requestId, text: "大吉を出す" }, 1)).toEqual(
    drawn,
  );
  expect((await f.send("draw", {}, 1)).versionId).toBe(replacement.versionId);
});

test("固定表の有料福引は払出しと代価を一度だけ確定し、在庫が戻るまで止まる", async () => {
  const f = await fixedTableFixture();
  const [manager, visitor, otherVisitor] = f.actors;
  const coin = randomUUID(),
    otherCoin = randomUUID(),
    series = randomUUID();
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      management: {
        editorId: (await auth.person()).id,
        reason: "検証用の通貨系列",
        requestHash: "b".repeat(64),
      },
      changes: {
        nodes: [coin, otherCoin].map((id) => ({
          id,
          kind: "existence",
          text: "銅貨",
          seriesId: series,
          count: 2,
        })),
        edges: [
          [visitor!, coin],
          [otherVisitor!, otherCoin],
        ].map(([source, target]) => ({
          id: randomUUID(),
          kind: "has",
          source: source!,
          target: target!,
          period: { from: 0 },
        })),
        revisions: [],
        endEdges: [],
      },
    },
  );
  const prize = (
    await f.apply([
      {
        type: "grant",
        person: manager,
        storage: f.place,
        basis: "景品の保管先",
      },
      {
        type: "create",
        holder: f.place,
        label: "真鍮の鈴",
        basis: "福引の在庫",
      },
    ])
  ).changes.nodes[0]!.id;
  const price = {
    storageId: f.place,
    paymentSeriesId: series,
    paymentLabel: "銅貨",
    count: 1,
  };
  await f.settings("銅貨1枚で鈴を一つ受け取る", price);
  const prizeEntry = {
    kind: "stock",
    storageId: f.place,
    itemId: prize,
    count: 1,
  };
  const added = await f.put(prizeEntry);
  f.approve();
  const { versionId } = await f.publish();
  await expect(
    f.send("draw", { versionId: randomUUID(), paymentItemId: coin }, 1),
  ).rejects.toMatchObject({
    code: "DRAW_TABLE_CHANGED",
  });
  await expect(f.send("draw", { versionId }, 1)).rejects.toMatchObject({
    code: "DRAW_PAYMENT_REQUIRED",
  });
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  let oldRequest: string | undefined;
  try {
    const profile = join(cli.directory, "paid-draw.json");
    const connection = await cli.run(
      profile,
      "connect",
      "--server",
      cli.base,
      "--world",
      f.world,
    );
    await cli.approve(
      f.people[1]!.cookie,
      connection.userCode,
      `actor:${visitor}`,
    );
    const search = await cli.run(
      profile,
      "search",
      "--kind",
      "subject",
      "--target",
      f.place,
    );
    expect(search.result.material.draw).toMatchObject({
      mode: "table",
      available: true,
      price: { count: 1 },
      spCost: 0,
    });
    cli.dropNextResponse("draw");
    const lost = await cli.run(
      profile,
      "draw",
      "--target",
      f.place,
      "--table-version",
      search.result.material.draw.versionId,
      "--payment",
      coin,
      "--full-ids",
    );
    expect(lost.state).toBe("error");
    oldRequest = lost.requestId;
    const recovered = await cli.run(profile, "recover", "--full-ids");
    expect(recovered.result).toMatchObject({
      versionId,
      spentSp: 0,
      reward: { id: prize, label: "真鍮の鈴" },
      payment: { itemId: coin, count: 1 },
    });
    expect(await f.store.context(f.graph).node(coin)).toMatchObject({
      count: 1,
    });
  } finally {
    await cli.close();
    await app.close();
  }
  await expect(
    f.send("draw", { versionId, paymentItemId: coin }, 1),
  ).rejects.toMatchObject({ code: "DRAW_STOCK_UNAVAILABLE" });
  expect(await f.store.context(f.graph).node(coin)).toMatchObject({ count: 1 });
  await f.apply([
    {
      type: "move",
      item: prize,
      from: visitor,
      to: f.place,
      basis: "景品の補充",
    },
  ]);
  await f.edit(true);
  await f.put(prizeEntry, { entryId: added.entryId, weight: 2 });
  f.approve();
  const updated = await f.publish();
  expect(
    await f.send(
      "draw",
      { requestId: oldRequest, versionId, paymentItemId: coin },
      1,
    ),
  ).toMatchObject({
    versionId,
    reward: { id: prize },
    payment: { itemId: coin, count: 1 },
  });
  expect(await f.store.context(f.graph).node(coin)).toMatchObject({ count: 1 });
  await f.move(2, f.place);
  const attempts = await Promise.allSettled(
    [coin, otherCoin].map((paymentItemId, index) =>
      f.send(
        "draw",
        { versionId: updated.versionId, paymentItemId },
        index + 1,
      ),
    ),
  );
  expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  expect(attempts.find(({ status }) => status === "fulfilled")).toMatchObject({
    value: { versionId: updated.versionId, reward: { id: prize }, spentSp: 0 },
  });
  expect(["WORLD_CHANGED", "DRAW_STOCK_UNAVAILABLE"]).toContain(
    (
      attempts.find(
        ({ status }) => status === "rejected",
      ) as PromiseRejectedResult
    ).reason.code,
  );
  expect(f.calls).toHaveBeenCalledTimes(2);
});

test.each(["update", "create-batch"])(
  "技能枠が足りない %s では、先の判定結果を使って次に振れる技能を決める",
  async (commandName) => {
    const f = await fixture(1);
    const actor = f.actors[0]!;
    await f.store.configureInventory(f.graph, false, { skillSlots: 1 });
    const request = (texts: string[]) => {
      const proposals = texts.map((text) => ({
        text,
        operations: [{ type: "learn", person: actor, text, basis: "実習" }],
      }));
      return {
        command: commandName,
        requestId: randomUUID(),
        ...(commandName === "update"
          ? { text: "実習", operations: proposals.flatMap((p) => p.operations) }
          : { proposals }),
        dependencies: [],
      };
    };
    f.calls.mockImplementationOnce(async (id) =>
      answer(id, { settings: [sure, sure] }),
    );
    const command = request(["星を見る", "潮を読む"]);
    const result = await f.send(0, command);
    expect(result).toMatchObject({
      spentSp: 1,
      outcome: {
        proposals: [
          { success: true },
          { success: false, reason: "SKILL_CAPACITY_EXCEEDED" },
        ],
      },
    });
    expect(await f.send(0, command)).toEqual(result);
    // 習得済みの「星を見る」は枠を使わずまとまるため、未習得の技能だけで満杯を確かめる。
    await expect(
      f.send(0, request(["潮を読む", "波を聞く"])),
    ).rejects.toMatchObject({ code: "SKILL_CAPACITY_EXCEEDED" });
    expect(f.calls).toHaveBeenCalledTimes(1);
  },
);

test("技能枠が満杯なら混合表も抽選前に知らせ、技能を含まない表は引ける", async () => {
  const f = await fixedTableFixture();
  await f.store.configureInventory(f.graph, false, { skillSlots: 1 });
  await f.apply([
    { type: "learn", person: f.actors[1], text: "実習", basis: "習得済み" },
  ]);
  await f.settings("技能か札を授ける");
  await f.put({ kind: "message", text: "白い札" });
  const skillEntry = await f.put({ kind: "skill", text: "水位を読む" });
  f.approve();
  await f.publish();
  const before = await f.status(1);
  await expect(f.send("draw", {}, 1)).rejects.toMatchObject({
    code: "SKILL_CAPACITY_EXCEEDED",
    inventory: { capacity: { usedSlots: 1, limitSlots: 1 } },
  });
  expect((await f.status(1)).dailySp).toEqual(before.dailySp);
  await f.edit(true);
  await f.settings("札を授ける");
  await f.change("draw-table-remove", {
    entryId: (skillEntry.entries as { entryId: string }[])[1]!.entryId,
  });
  f.approve();
  await f.publish();
  expect(await f.send("draw", {}, 1)).toMatchObject({ spentSp: 0 });
});

test("固定表は新しい技能が一件でも含まれると1 SPを使い、再送で技能とSPを重ねない", async () => {
  const f = await fixedTableFixture();
  await f.settings("触れた木材の中の空洞を音で知る技を授ける");
  expect(
    await f.put({ kind: "skill", text: "木材の中の空洞を音で知る" }),
  ).toMatchObject({ spCost: 1 });
  f.approve();
  await f.publish();
  const requestId = randomUUID();
  const commit = f.store.commit.bind(f.store);
  vi.spyOn(f.store, "commit").mockImplementationOnce(async (...args) => {
    await commit(...args);
    throw new Error("グラフ確定後に接続が切れた");
  });
  await expect(f.send("draw", { requestId }, 1)).rejects.toThrow(
    "グラフ確定後に接続が切れた",
  );
  const drawn = await f.send("draw", { requestId }, 1);
  expect(drawn).toMatchObject({
    spentSp: 1,
    dailySp: { remaining: 99 },
    reward: { kind: "skill" },
  });
  expect(await f.send("draw", { requestId }, 1)).toEqual(drawn);
  expect(f.calls).toHaveBeenCalledTimes(1);
});

test("固定表の32件上限と不正な重みを審査前に検査する", async () => {
  const f = await fixedTableFixture();
  const input = { kind: "message", text: "はずれ" };
  for (const weight of [0, -1, 1.5])
    expect(() =>
      PlayCommand.parse({
        requestId: randomUUID(),
        targetId: f.place,
        command: "draw-table-put",
        revision: 1,
        result: input,
        weight,
      }),
    ).toThrow();
  for (let i = 0; i < 32; i++) await f.put(input);
  await expect(f.put(input)).rejects.toMatchObject({
    code: "DRAW_TABLE_LIMIT",
  });
  expect(await f.send("draw-table-show", { view: "draft" })).toMatchObject({
    totalWeight: 32,
  });
  expect(f.calls).not.toHaveBeenCalled();
});

test("現地に置かれた物品から引け、共有残量1 SPで競合しても一件だけ生成する", async () => {
  const f = await fixture();
  const user = f.people[0]!.id;
  const db = isolated.databases.postgres;
  const box = (
    await f.apply([
      {
        type: "create",
        holder: f.place,
        label: "福箱",
        basis: "広場に置かれた箱",
      },
    ])
  ).changes.nodes[0]!.id;
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { accepted: true, reason: "成立する" }),
  );
  expect(
    await f.send(0, {
      command: "draw-configure",
      targetId: box,
      description: "色のついた石が出る",
    }),
  ).toMatchObject({ state: "confirmed" });
  expect(
    (await f.send(0, { command: "search", query: { kind: "surroundings" } }))
      .material,
  ).toMatchObject({
    subjects: expect.arrayContaining([
      expect.objectContaining({
        id: f.place,
        held: expect.arrayContaining([
          expect.objectContaining({
            id: box,
            draw: expect.objectContaining({ available: true }),
          }),
        ]),
      }),
    ]),
  });
  await expect(
    f.send(2, { command: "draw", targetId: box }),
  ).rejects.toMatchObject({ code: "DRAW_NOT_IN_REACH" });
  const { resetsAt } = await access.botPlay.dailySp(f.world, user);
  await db.query(
    `INSERT INTO bot_request(id,actor_id,world_id,hash,sp_user,sp_reset) SELECT gen_random_uuid(),$1,$2,'fixture',$3,$4 FROM generate_series(1,99)`,
    [f.actors[0], f.world, user, resetsAt],
  );
  await db.query(
    "INSERT INTO world_access(subject_id,construction_id,role,actor_id) VALUES($1,$2,'player',$3)",
    [user, f.world, f.actors[1]],
  );
  const requests = [0, 1].map(() =>
    PlayCommand.parse({
      command: "draw",
      requestId: randomUUID(),
      targetId: box,
    }),
  );
  const send = (i: number) =>
    access.botCommand(user, f.world, requests[i]!, f.actors[i]);
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { kind: "item", label: "青い小石" }),
  );
  const results = await Promise.allSettled([send(0), send(1)]);
  const winner = results.findIndex(({ status }) => status === "fulfilled");
  expect(winner).toBeGreaterThanOrEqual(0);
  expect(results[1 - winner]).toMatchObject({
    status: "rejected",
    reason: { code: "DAILY_SP_EXHAUSTED" },
  });
  expect(results[winner]).toMatchObject({
    status: "fulfilled",
    value: { dailySp: { remaining: 0 }, spentSp: 1 },
  });
  expect({ status: "fulfilled", value: await send(winner) }).toEqual(
    results[winner],
  );
  expect(f.calls).toHaveBeenCalledTimes(2);
});

test("新しい場所は接続元を指定して申請し、ダイスの成否と行き来の手がかりを残す", async () => {
  const f = await fixture(),
    app = await createApp(access, auth.identity, undefined, auth.operations),
    cli = await playerCli(app);
  const profile = join(cli.directory, "explore.json"),
    run = (...args: string[]) => cli.run(profile, ...args);
  try {
    const conn = await run("connect", "--server", cli.base, "--world", f.world);
    await cli.approve(
      f.people[0]!.cookie,
      conn.userCode,
      `actor:${f.actors[0]}`,
    );
    await expect(
      f.send(0, {
        command: "explore",
        text: "離れた場所の裏手に出る",
        label: "裏手",
        fromId: f.far,
        dependencies: [],
      }),
    ).rejects.toMatchObject({ code: "EXPLORE_SOURCE_REQUIRED" });
    expect(f.calls).not.toHaveBeenCalled();
    const square = (
      await run("search", "--kind", "surroundings")
    ).result.material.subjects.find(
      (s: { text: string }) => s.text === "広場",
    ).id;
    // 接続元が多くの状態を持っていても、GMへ渡す状態は直近の件数に絞られる。
    const crowd = Array.from({ length: 13 }, () => randomUUID());
    await f.store.commit(
      await f.store.claim(f.graph, randomUUID()),
      f.store.context(f.graph),
      {
        commitId: randomUUID(),
        at: 0,
        changes: {
          nodes: crowd.map((id, i) => ({
            id,
            kind: "script" as const,
            text: `広場の様子${i}`,
          })),
          edges: crowd.map((id) => ({
            id: randomUUID(),
            kind: "status" as const,
            role: "content" as const,
            source: f.place,
            target: id,
            period: { from: 0 },
          })),
          revisions: [],
          endEdges: [],
        },
      },
    );
    f.calls.mockImplementation(async (id, role, messages) => {
      const prompt = JSON.parse(String(messages[1]!.content));
      if (prompt.text === "広場の裏手から細い小道が続いている。") {
        const material = prompt.nodes.find(
          (n: { node: { id: string } }) => n.node.id === f.place,
        );
        expect(material.states).toHaveLength(12);
        expect(material.omittedStates).toBeGreaterThan(0);
      }
      expect(role).toBe("world-explore-dice");
      expect(messages[0]?.content).toContain(
        "接続元ノードから見た妥当性によってダイスを1d100で振る。基準値100も可とする",
      );
      expect(messages[0]?.content).toContain("explored:");
      return answer(id, { sides: 100, successThrough: 100, explored });
    });
    const found = await run(
      "explore",
      "--from",
      square,
      "--label",
      "広場の裏の小道",
      "--text",
      "広場の裏手から細い小道が続いている。",
    );
    expect(found.result).toMatchObject({
      state: "accepted",
      outcome: { success: true, setting: { sides: 100, successThrough: 100 } },
    });
    expect(f.calls).toHaveBeenCalledTimes(1);
    // 行き来の記述は申請の文ではなく、GMが書いた道の記述になり、新しい場所に説明が付く。
    const route = (target: string) =>
      run("search", "--kind", "subject", "--target", target).then((r) =>
        r.result.material.states.find(
          (s: { node: { text: string } }) => s.node.text === explored.route,
        ),
      );
    const names = (state: { about: { text?: string }[] }) =>
      state.about.map((a) => a.text).sort();
    expect(names(await route(square))).toEqual(["広場", "広場の裏の小道"]);
    // 周囲の検索は、行き来の記述で結ばれた場所だけを移動先の手がかりとして返す。
    const routes = async () =>
      (
        (
          await access.botPlay.search(f.world, f.actors[0]!, {
            kind: "surroundings",
          })
        ).material as { routes: unknown[] }
      ).routes;
    const placed = (
      await f.store.driver.executeQuery(
        "MATCH (n:WorldNode {worldId:$w,kind:'existence'}) WHERE n.data CONTAINS '広場の裏の小道' RETURN n.id AS id",
        { w: f.graph },
      )
    ).records[0]!.get("id") as string;
    expect(await routes()).toEqual([{ id: placed, label: "広場の裏の小道" }]);
    const described = await Promise.all(
      (
        await f.store
          .context(f.graph)
          .relations(placed, "status", "out", Number.MAX_SAFE_INTEGER)
      ).map((e) => f.store.context(f.graph).node(e.target)),
    );
    expect(described.map((n) => n?.text)).toContain(explored.description);
    const path = found.result.placeId as string,
      me = (await run("status")).device.actorId as string,
      move = join(cli.directory, "move.json");
    await expect(
      f.store.context(f.graph).assertMovable(placed),
    ).rejects.toThrow("固定場所");
    await writeFile(
      move,
      JSON.stringify({
        command: "apply",
        expectedSp: 0,
        action: {
          type: "direct",
          text: "小道へ入る",
          operations: [
            {
              type: "locate",
              subjectId: me,
              text: "広場から小道へ歩いて入っていく",
              aboutIds: [path],
            },
          ],
        },
        dependencies: [],
      }),
    );
    // 行く前でも、いまいる場所の記述が参照している新しい場所を調べられる。
    expect(names(await route(path))).toEqual(["広場", "広場の裏の小道"]);
    expect((await run("play", "--file", move)).result.state).toBe("accepted");
    // 所在の本文は移動の申請の文ではなく、直接の滞在先の呼び名になる。
    expect(
      (await locationRecords(f.store.context(f.graph), f.actors[0]!)).map(
        (r) => r.text,
      ),
    ).toEqual(["広場の裏の小道"]);
    expect(names(await route(path))).toEqual(["広場", "広場の裏の小道"]);
    expect(await routes()).toEqual([{ id: f.place, label: "広場" }]);
    const failing = randomUUID(),
      used = (await f.status(0)).callsUsed as number;
    await isolated.databases.postgres.query(
      "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,90)",
      [derivedId(`${failing}:creation`), { sides: 100, successThrough: 20 }],
    );
    const missed = await f.send(0, {
      requestId: failing,
      command: "explore",
      text: "小道の先に城がある",
      label: "城",
      fromId: placed,
      dependencies: [],
    });
    expect(missed.outcome).toMatchObject({ success: false, roll: 90 });
    expect(missed.placeId).toBeUndefined();
    expect(
      await f.store.context(f.graph).node(derivedId(`${failing}:place`)),
    ).toBeUndefined();
    expect((await f.status(0)).callsUsed).toBe(used + 1);
    // 同じ呼び名の場所は申請できず、先にある場所のIDが返る。GMは呼ばれない。
    const asked = f.calls.mock.calls.length;
    await expect(
      f.send(0, {
        command: "explore",
        text: "小道の脇にもう一本の小道がある",
        label: "広場の裏の小道",
        fromId: placed,
        dependencies: [],
      }),
    ).rejects.toMatchObject({
      code: "EXPLORE_NAME_TAKEN",
      message: expect.stringContaining(placed),
    });
    expect(f.calls.mock.calls.length).toBe(asked);
    // 行き先は直接の滞在先だけから集める。参照しているだけの場所の行き来は返さない。
    await f.send(0, {
      command: "update",
      text: "離れた場所へ移る",
      operations: [
        {
          type: "locate",
          subjectId: f.actors[0]!,
          text: "離れた場所",
          aboutIds: [f.far, f.place],
          directPlaceId: f.far,
        },
      ],
      dependencies: [],
    });
    expect(await routes()).toEqual([]);
    // 接続元の一部として探索された場所は、接続元を材料にする判定へ一緒に渡る。
    f.calls.mockImplementationOnce(async (id) =>
      answer(id, {
        sides: 100,
        successThrough: 100,
        explored: { ...explored, partOf: true },
      }),
    );
    const part = (
      await f.send(0, {
        command: "explore",
        text: "離れた場所の片隅に古井戸がある",
        label: "離れた場所の古井戸",
        fromId: f.far,
        dependencies: [],
      })
    ).placeId as string;
    f.calls.mockImplementationOnce(async (id, _role, messages) => {
      const nodes = JSON.parse(String(messages[1]!.content)).nodes as {
        node: { id: string };
      }[];
      expect(nodes.map((n) => n.node.id)).toContain(part);
      return answer(id, { sides: 100, successThrough: 100, explored });
    });
    await f.send(0, {
      command: "explore",
      text: "離れた場所の先に丘がある",
      label: "離れた場所の先の丘",
      fromId: f.far,
      dependencies: [],
    });
  } finally {
    await cli.close();
    await app.close();
  }
}, 60000);

test("管理操作で止まったセッションを一覧から見つけ、保存状態から一度だけ進める", async () => {
  const f = await fixture(),
    admin = await auth.person();
  type Listed = {
    sessionId: string;
    turn: number;
    holder: { actorId: string; lastSeen: string | null; connected: boolean };
    progressedAt: string | null;
  };
  const run = (
      input: Record<string, unknown>,
      requestId: string = randomUUID(),
    ) =>
      auth.operations.execute(
        admin.id,
        requestId,
        input as Parameters<typeof auth.operations.execute>[2],
        { players: access.players },
      ),
    list = async () =>
      (await run({ operation: "playSessions.list", worldId: f.world }))
        .items as Listed[],
    advance = (sessionId: string, requestId?: string) =>
      run(
        {
          operation: "playSessions.advance",
          worldId: f.world,
          sessionId,
          reason: "止まった手番を進める",
        },
        requestId,
      );
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const memo = await f.send(0, {
    command: "memo",
    text: "期限切れの試験",
    participants: [f.actors[1]],
    dependencies: [],
  });
  const deadline = new Date(Date.now() - 1000).toISOString();
  await isolated.databases.postgres.query(
    "UPDATE bot_session SET data=jsonb_set(data,'{receiving,deadline}',to_jsonb($2::text)) WHERE id=$1",
    [memo.sessionId, deadline],
  );
  expect(
    (await list()).find((s) => s.sessionId === memo.sessionId),
  ).toMatchObject({
    turn: 1,
    holder: { actorId: f.actors[1], controller: "player", connected: true },
    receiving: { applicationId: memo.applicationId, deadline },
  });
  expect((await advance(memo.sessionId as string)).session).toMatchObject({
    turn: 1,
    holder: { actorId: f.actors[0] },
    receiving: null,
  });

  const lastSeen = new Date(Date.now() - 1201000);
  await isolated.databases.postgres.query(
    "UPDATE player_waiting SET last_seen=$3 WHERE world_id=$1 AND actor_id=$2",
    [f.world, f.actors[0], lastSeen],
  );
  const listed = await list(),
    stalled = listed.find((s) => s.sessionId === memo.sessionId)!,
    solo = listed.find((s) => s.holder.actorId === f.actors[2])!;
  expect(stalled).toMatchObject({
    turn: 1,
    holder: {
      actorId: f.actors[0],
      lastSeen: lastSeen.toISOString(),
      connected: false,
    },
    receiving: null,
  });
  await expect(advance(solo.sessionId)).rejects.toMatchObject({
    code: "SESSION_NOT_STALLED",
  });
  const requestId = randomUUID(),
    advanced = await advance(stalled.sessionId, requestId);
  expect(advanced.session).toMatchObject({
    turn: 2,
    holder: { actorId: f.actors[1], connected: true },
    progressedAt: expect.any(String),
  });
  expect((advanced.session as Listed).progressedAt).not.toBe(
    stalled.progressedAt,
  );
  expect(await advance(stalled.sessionId, requestId)).toEqual(advanced);
  await expect(advance(stalled.sessionId)).rejects.toMatchObject({
    code: "SESSION_NOT_STALLED",
  });

  await f.status(0);
  const db = isolated.databases.postgres;
  await db.query(
    "UPDATE bot_session SET data=data-'turnActivityAt' WHERE id=$1",
    [stalled.sessionId],
  );
  await access.botPlay.setup();
  await expect(advance(stalled.sessionId)).rejects.toMatchObject({
    code: "SESSION_NOT_STALLED",
  });
  await db.query(
    "UPDATE bot_session SET data=jsonb_set(data,'{turnActivityAt}',to_jsonb($2::text)) WHERE id=ANY($1::uuid[])",
    [
      [stalled.sessionId, solo.sessionId],
      new Date(Date.now() - 601000).toISOString(),
    ],
  );
  await expect(advance(solo.sessionId)).rejects.toMatchObject({
    code: "SESSION_NOT_STALLED",
  });
  expect((await advance(stalled.sessionId)).session).toMatchObject({
    turn: 3,
    holder: { actorId: f.actors[0], connected: true },
  });
  expect(f.calls).not.toHaveBeenCalled();
});
test("非戦闘地域では子区画の車内も保護し、経路と親区画には保護を広げない", async () => {
  const f = await fixture(2),
    [actor, target] = f.actors as [string, string],
    [root, middle, condition] = [randomUUID(), randomUUID(), randomUUID()],
    config = [{ rootId: root, memberPlaceIds: [] }],
    db = isolated.databases.postgres;
  const changes: Change = {
    nodes: [
      { id: root, kind: "existence", text: "守られる集落" },
      { id: middle, kind: "existence", text: "集落内の敷地" },
      { id: condition, kind: "script", text: "左手に以前の擦り傷がある。" },
    ],
    edges: [
      {
        id: randomUUID(),
        kind: "status",
        role: "content",
        source: target,
        target: condition,
        period: { from: 0 },
      },
    ],
    endEdges: [],
    revisions: [],
  };
  mark(changes, f.place, "敷地の一部", [{ id: middle, text: "part-of" }]);
  mark(changes, middle, "集落の一部", [{ id: root, text: "part-of" }]);
  mark(changes, root, "周辺一帯の一部", [{ id: f.far, text: "part-of" }]);
  linkRoute(
    changes,
    randomUUID(),
    0,
    [
      { id: root, text: "集落" },
      { id: f.far, text: "周辺" },
    ],
    "外へ続く道",
  );
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes,
    },
  );
  await db.query(
    "UPDATE world_construction SET non_combat_areas=$2 WHERE id=$1",
    [f.world, JSON.stringify(config)],
  );
  const vehicle = await vehicleFixture(f);
  await f.move(0, vehicle);
  await f.move(1, vehicle);
  await f.send(1, { command: "contact", targetId: actor });
  await giveTurn(f, 0);
  const made = await f.apply([
    { type: "create", label: "手袋", holder: target, basis: "試験用" },
  ]);
  const item = made.changes.nodes[0]!.id;
  const setting = {
    sides: 2,
    successThrough: 1,
    fatal: [target],
    states: [{ id: target, text: "新しいけがをした。" }],
    endEdges: [changes.edges[0]!.id],
    fumble: { through: 1, text: "本人がけがをした。" },
  };
  const saveRoll = (id: string, roll: number) =>
    db.query("INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,$3)", [
      id,
      setting,
      roll,
    ]);
  const opposeInside = async (
    id: string,
    _role: string,
    messages: { content: unknown }[],
  ) => {
    const sent = JSON.parse(String(messages[1]!.content));
    expect(sent).not.toHaveProperty("mortal");
    expect(sent).not.toHaveProperty("affected");
    expect(String(messages[0]!.content)).not.toContain("fumble:{through");
    return answer(id, setting);
  };
  const first = randomUUID();
  await saveRoll(first, 1);
  f.calls.mockImplementationOnce(opposeInside);
  const seize = {
    command: "apply",
    requestId: first,
    expectedSp: 1,
    dependencies: [],
    action: {
      type: "seize",
      text: "相手の手袋を取る",
      operation: {
        type: "move",
        item,
        from: target,
        to: actor,
        basis: "手袋を取る",
      },
    },
  };
  const protectedSuccess = await f.send(0, seize);
  expect(protectedSuccess).toMatchObject({
    spentSp: 1,
    outcome: { success: true, setting: { endEdges: [] } },
  });
  expect(protectedSuccess.outcome).not.toHaveProperty("setting.fatal");
  expect(protectedSuccess.outcome).not.toHaveProperty("setting.states");
  expect(await f.store.context(f.graph).holding(item)).toMatchObject({
    source: actor,
  });
  expect(await f.send(0, seize)).toEqual(protectedSuccess);

  const attack = (requestId: string) => ({
    command: "apply",
    requestId,
    expectedSp: 1,
    dependencies: [],
    action: {
      type: "oppose",
      text: "相手を傷つけようとする",
      targetId: target,
      description: "新しいけがをした。",
      replacesStateId: condition,
    },
  });
  const second = randomUUID();
  f.calls.mockClear();
  await expect(f.send(0, attack(second))).rejects.toMatchObject({
    code: "NON_COMBAT_AREA",
  });
  expect(f.calls).not.toHaveBeenCalled();
  expect((await f.status(0)).dailySp.remaining).toBe(99);
  expect(
    await f.store.context(f.graph).edge(changes.edges[0]!.id),
  ).not.toHaveProperty("period.until");

  await f.move(0, f.far);
  await f.move(1, f.far);
  const third = randomUUID();
  await saveRoll(third, 1);
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    const sent = JSON.parse(String(messages[1]!.content));
    expect(sent.mortal).toEqual([target]);
    expect(sent.affected).toEqual([target]);
    return answer(id, setting);
  });
  expect(await f.send(0, attack(third))).toMatchObject({
    spentSp: 1,
    outcome: {
      success: true,
      setting: { fatal: [target], states: setting.states },
    },
  });
});

test("一団へのダイスが分離と死亡を確定し、分けた個体を昇格できる", async () => {
  const f = await fixture(),
    admin = await auth.person(),
    rule = randomUUID(),
    drop = randomUUID(),
    id = randomUUID();
  const edge = (source: string, target: string, text?: string) => ({
    id: randomUUID(),
    kind: "status" as const,
    role: text ? ("about" as const) : ("content" as const),
    ...(text ? { text } : {}),
    source,
    target,
    period: { from: 0 },
  });
  await f.store.commit(
    await f.store.claim(f.graph, id),
    f.store.context(f.graph),
    {
      at: 0,
      commitId: id,
      changes: {
        nodes: [
          {
            id: rule,
            kind: "script",
            text: "広場の鳥",
            spawn: {
              kind: "instant-npc",
              species: "鳥",
              description: "地面をつつく",
              count: 4,
              probability: 1,
            },
          },
          {
            id: drop,
            kind: "script",
            text: "鳥の落とし物",
            spawn: {
              kind: "existence",
              species: "羽根",
              description: "抜け落ちた羽根",
              count: 3,
              probability: 1,
            },
          },
        ],
        revisions: [],
        endEdges: [],
        edges: [
          edge(f.place, rule),
          edge(rule, f.place, "spawn-hit"),
          edge(f.place, drop),
          edge(drop, rule, "spawn-death"),
        ],
      },
    },
  );
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  const source = randomUUID(),
    found = await f.send(0, {
      requestId: source,
      command: "search",
      query: { kind: "subject", targetId: f.place },
    });
  const [group] = found.appearances as { id: string }[];
  expect(found.appearances).toMatchObject([{ id: group!.id, count: 4 }]);
  expect(found.appearances).toHaveLength(1);
  const present = async () => (await f.status(1)).characters!;
  const count = async () =>
    (await present()).find(({ actorId }) => actorId === group!.id)?.count;
  const attempt = (text: string, state: string) => ({
    command: "oppose",
    requestId: randomUUID(),
    text,
    dependencies: [],
    effect: { targetId: group!.id, state },
  });
  const db = isolated.databases.postgres;
  await db.query(
    "UPDATE world_construction SET non_combat_areas=$2 WHERE id=$1",
    [f.world, JSON.stringify([{ rootId: f.place, memberPlaceIds: [] }])],
  );
  const safeHit = attempt("鳥に対抗する", "鳥が攻撃を受けた");
  f.calls.mockClear();
  await expect(f.send(0, safeHit)).rejects.toMatchObject({
    code: "NON_COMBAT_AREA",
  });
  expect(f.calls).not.toHaveBeenCalled();
  expect(await count()).toBe(4);

  for (const victim of [f.actors[1]!, f.place]) {
    const effect = { targetId: victim, state: "つつかれた跡がある。" };
    f.calls.mockImplementationOnce(async (id, _role, messages) => {
      expect(JSON.parse(String(messages[1]!.content))).not.toHaveProperty(
        "mortal",
      );
      expect(String(messages[0]!.content)).not.toContain(
        "さらにobservableを返す",
      );
      return answer(id, { ...sure, fatal: [victim], observable: effect.state });
    });
    const sheltered = await f.send(0, {
      command: "npc-action",
      npcId: group!.id,
      text: "鳥が目の前をつつく",
      effect,
    });
    expect(sheltered.outcome).toMatchObject({ success: true });
    expect(sheltered.outcome).not.toHaveProperty("setting.fatal");
    expect(sheltered.effectState).toBeUndefined();
    expect(
      await f.store.context(f.graph).marked(victim, "status", "judged"),
    ).toHaveLength(0);
  }
  await db.query(
    "UPDATE world_construction SET non_combat_areas='[]' WHERE id=$1",
    [f.world],
  );

  const split = { kind: "separation", count: 1, stays: true };
  const missed = attempt("そっと手を伸ばす", "手の届くところにいる");
  const miss = {
    sides: 2,
    successThrough: 1,
    instantReduction: split,
    fumble: { through: 1, text: "指先をつつかれて血がにじんでいる。" },
  };
  await isolated.databases.postgres.query(
    "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,2),($3,$4,1)",
    [
      missed.requestId,
      miss,
      derivedId(`${missed.requestId}:fumble`),
      { sides: 2, successThrough: 1 },
    ],
  );
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    expect(messages[0]!.content).toContain("fumble:{through");
    return answer(id, miss);
  });
  const failed = await f.send(0, missed);
  expect(failed.outcome).toMatchObject({
    success: false,
    fumble: { roll: 1, success: true },
  });
  expect(
    (
      await f.store
        .context(f.graph)
        .node(derivedId(`${missed.requestId}:fumble`))
    )?.text,
  ).toBe(miss.fumble.text);
  expect(failed.instantReduction).toBeUndefined();
  expect(failed.appearances).toBeUndefined();
  expect(await f.send(0, missed)).toEqual(failed);
  expect(await count()).toBe(4);

  const caught = attempt("餌をかごの中に置いて入り口に寄る", "羽音がしている");
  const pet = derivedId(caught.requestId + ":separation");
  f.calls.mockImplementationOnce(
    async (id, role, messages, _target, _effort, _try, validate) => {
      expect(role).toBe("world-opposition-dice");
      expect(JSON.parse(String(messages[1]!.content))).toMatchObject({
        action: caught.text,
        group: { count: 4, allowSeparation: true },
      });
      expect(() =>
        validate!(
          JSON.stringify({ ...sure, instantReduction: { ...split, count: 5 } }),
        ),
      ).toThrow();
      return answer(id, { ...sure, instantReduction: split });
    },
  );
  const commit = f.store.commit.bind(f.store);
  vi.spyOn(f.store, "commit").mockImplementationOnce(async (...args) => {
    await commit(...args);
    throw new Error("同席の保存前に中断");
  });
  await expect(f.send(0, caught)).rejects.toThrow("同席の保存前に中断");
  expect(await count()).toBe(4);
  const separated = await f.send(0, caught);
  expect(separated.instantReduction).toEqual({
    targetId: group!.id,
    kind: "separation",
    count: 1,
    remaining: 3,
    separatedId: pet,
  });
  expect(separated.appearances).toMatchObject([
    { id: pet, kind: "instant-npc", count: 1 },
  ]);
  expect(await f.send(0, caught)).toEqual(separated);
  expect(await count()).toBe(3);
  expect(
    (await present()).filter(({ actorId }) => actorId === pet),
  ).toHaveLength(1);

  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { ...sure, instantReduction: { kind: "death", count: 2 } }),
  );
  const hit = attempt("鳥に対抗する", "鳥が攻撃を受けた");
  const killed = await f.send(0, hit);
  expect(killed.instantReduction).toMatchObject({
    remaining: 1,
    kind: "death",
    count: 2,
  });
  const drops = killed.appearances as { id: string; species: string }[];
  expect(drops).toMatchObject([{ species: "羽根", count: 6 }]);
  expect(drops).toHaveLength(1);
  expect(await f.send(0, hit)).toEqual(killed);
  expect(await count()).toBe(1);
  expect(
    (await f.store.receipt(f.graph, hit.requestId))?.changes.nodes,
  ).toContainEqual(
    expect.objectContaining({
      instantTarget: {
        id: group!.id,
        sourceEventId: derivedId(source + ":appearance"),
      },
      instantReduction: killed.instantReduction,
    }),
  );

  await f.send(0, { command: "end-turn" });
  const next = await f.send(1, { command: "end-turn" });
  expect(next.actorId).toBe(group!.id);
  f.calls
    .mockImplementationOnce(async (id, _role, messages) => {
      expect(JSON.stringify(messages)).toContain(pet);
      return answer(id, {
        text: "隣の鳥をつつく",
        effect: { targetId: pet, state: "羽が乱れる" },
      });
    })
    .mockImplementationOnce(async (id) => answer(id, sure))
    .mockImplementationOnce(async (id) => answer(id, { text: "羽を整える" }));
  await access.botPlay.tickNpcs();
  await access.botPlay.tickNpcs();
  await f.send(0, { command: "end-turn" });
  const pending = await f.send(1, {
    command: "promote-npc",
    sourceRequestId: caught.requestId,
    npcIndex: 0,
    description: "分かれた鳥",
  });
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { description: "分かれた鳥", memory: "一団から分かれた。" }),
  );
  const approved = await auth.operations.execute(
    admin.id,
    randomUUID(),
    {
      operation: "npcs.decidePromotion",
      worldId: f.world,
      promotionId: String(pending.promotionId),
      approve: true,
      reason: "継続を許可",
    },
    { players: access.players },
  );
  expect(approved).toMatchObject({ state: "approved", npcId: pet });
  expect(await count()).toBe(1);

  f.calls.mockImplementationOnce(async (id) =>
    answer(id, {
      ...sure,
      instantReduction: { kind: "separation", count: 1, stays: false },
    }),
  );
  const leave = attempt("距離を取って出口を空ける", "出口への道が開いている");
  const left = await f.send(1, leave);
  expect(left.instantReduction).toEqual({
    targetId: group!.id,
    kind: "separation",
    count: 1,
    remaining: 0,
  });
  expect(left.appearances).toBeUndefined();
  expect((await present()).some(({ actorId }) => actorId === group!.id)).toBe(
    false,
  );
  // 目撃していない人物も、後から来てその場に残った物を見つけて拾える。
  await f.send(1, { command: "end-turn" });
  await f.move(2, f.place);
  const seen = await f.send(2, {
    command: "search",
    query: { kind: "surroundings" },
  });
  expect(JSON.stringify(seen.material)).toContain(drops[0]!.id);
  const pick = (count?: number) =>
    f.send(2, {
      command: "update",
      text: "拾う",
      dependencies: [],
      operations: [
        {
          type: "move",
          from: null,
          to: f.actors[2],
          item: drops[0]!.id,
          ...(count ? { count } : {}),
          basis: "拾う",
        },
      ],
    });
  const carried = async () =>
    (await readBelongings(f.store.context(f.graph), f.actors[2]!)).items.map(
      (item) => item.count,
    );
  // 一部だけ拾うと残りはその場に残り、後から残りを拾うと手持ちの同じ物品に足される。
  expect((await pick(1)).items).toMatchObject([
    { itemId: drops[0]!.id, count: 1 },
  ]);
  expect(await carried()).toEqual([1]);
  expect((await pick()).items).toMatchObject([{ itemId: drops[0]!.id }]);
  expect(await carried()).toEqual([6]);
});
test("人物への対抗行動で死亡と判定されると、対象はセッションから外れて設定された場所か最初の所在地へ移り、判定で付いた状態・期限のある状態・死亡で付いた状態が現在の状態から外れる", async () => {
  const f = await fixture(),
    items = [randomUUID(), randomUUID(), randomUUID()],
    grave = randomUUID(),
    // 人物1の、判定によらない状態と、印のない期限つきの状態。
    [cloak, fever] = [randomUUID(), randomUUID()];
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [
          ...items.map((id) => ({
            id,
            kind: "existence" as const,
            text: "道具",
          })),
          { id: grave, kind: "existence", text: "墓地" },
          { id: cloak, kind: "script", text: "赤い外套を着ている。" },
          { id: fever, kind: "script", text: "熱がある。" },
        ],
        edges: [
          ...items.map((target, i) => ({
            id: randomUUID(),
            kind: "has" as const,
            source: f.actors[i === 2 ? 2 : 1]!,
            target,
            period: { from: 0 },
          })),
          ...[cloak, fever].map((target) => ({
            id: randomUUID(),
            kind: "status" as const,
            role: "content" as const,
            source: f.actors[1]!,
            target,
            period: target === fever ? { from: 0, until: 9e15 } : { from: 0 },
          })),
        ],
        revisions: [],
        endEdges: [],
      },
    },
  );
  // 人物2の最初の所在地は離れた場所。
  await f.move(2, f.place);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  await f.send(2, { command: "contact", targetId: f.actors[0] });
  const configure = (setting: string, value: unknown) =>
    isolated.databases.postgres.query(
      `UPDATE world_construction SET ${setting}=$2 WHERE id=$1`,
      [f.world, value],
    );
  const attack = (i: number) => ({
    requestId: randomUUID(),
    command: "oppose",
    text: "斬りかかって道具を奪う",
    operations: [
      {
        type: "move",
        item: items[i],
        from: f.actors[i === 2 ? 2 : 1],
        to: f.actors[0],
        basis: "奪う",
      },
    ],
    dependencies: [],
  });
  const fatalDice = (
    victim: string,
    expected: string,
    states: { id: string; text: string }[] = [],
  ) =>
    f.calls.mockImplementationOnce(async (id, _role, messages) => {
      expect(JSON.stringify(messages)).toContain(expected);
      return answer(id, { ...sure, fatal: [victim], states });
    });
  const present = async (i: number) =>
    (await f.status(i)).characters!.map((c) => c.actorId);
  const whereabouts = async (i: number) =>
    (
      (await f.send(i, { command: "search", query: { kind: "self" } }))
        .material as { locations: { directPlaceId: string }[] }
    ).locations.map((l) => l.directPlaceId);
  // 死亡判定が無効な世界では、候補を渡さず、成功しても同席は変わらない。
  // GMが返した状態は、同席している対象の人物にだけ残る。
  await configure("death_judgment", false);
  const wound = { id: f.actors[1]!, text: "肩に切り傷がある。" };
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    const sent = JSON.parse(String(messages[1]!.content));
    expect(sent.affected).toEqual([f.actors[1]]);
    expect(sent).not.toHaveProperty("mortal");
    return answer(id, {
      ...sure,
      fatal: [f.actors[1]],
      states: [wound, { id: f.actors[2], text: "無関係" }],
    });
  });
  const spared = await f.send(0, attack(0));
  expect(spared.outcome).toMatchObject({
    success: true,
    setting: { states: [wound] },
  });
  expect(spared.outcome).not.toHaveProperty("setting.fatal");
  expect(await present(0)).toEqual(f.actors);
  const states = async (i: number) =>
    (
      await Promise.all(
        (
          await f.store
            .context(f.graph)
            .relations(f.actors[i]!, "status", "out", Date.now())
        ).map((e) => f.store.context(f.graph).node(e.target)),
      )
    ).map((n) => n?.text);
  expect(await states(1)).toEqual(
    expect.arrayContaining([wound.text, "熱がある。"]),
  );
  expect(await states(2)).not.toContain("無関係");
  // 設定された場所へ移り、セッションから外れる。
  vi.stubEnv("DEATH_SP_LOCK_SECONDS", undefined);
  await configure("death_judgment", true);
  await configure("death_criteria", "致命傷で死亡する");
  await configure("death_place_id", grave);
  const crushed = { id: f.actors[1]!, text: "頭部が砕けている。" };
  fatalDice(f.actors[1]!, "致命傷で死亡する", [crushed]);
  const first = attack(1),
    killed = await f.send(0, first);
  expect(killed.outcome).toMatchObject({
    success: true,
    setting: { fatal: [f.actors[1]] },
  });
  expect(await f.send(0, first)).toEqual(killed);
  expect(await present(0)).toEqual([f.actors[0], f.actors[2]]);
  expect(await present(1)).toEqual([f.actors[1]]);
  expect(await whereabouts(1)).toEqual([grave]);
  const after = await states(1);
  expect(after).toContain("赤い外套を着ている。");
  expect(after).not.toContain(wound.text);
  expect(after).not.toContain("熱がある。");
  // 死亡で付いた状態は、終わった関係として記録され、現在の状態には出ない。
  expect(after).not.toContain(crushed.text);
  expect(
    await f.store
      .context(f.graph)
      .node(derivedId(`${first.requestId}:state:${f.actors[1]}`)),
  ).toMatchObject({ text: crushed.text });
  const penalty = async (i: number) => {
    const edges = (
      await f.store
        .context(f.graph)
        .relations(f.actors[i]!, "status", "out", Date.now())
    ).filter((edge) => edge.text === "system:sp-use-prohibited");
    expect(edges).toHaveLength(1);
    return edges[0]!;
  };
  const lock = await penalty(1);
  const until = lock.period.until!;
  expect(until - lock.period.from).toBe(43_200_000);
  // 場所が未設定なら、本人の最初の所在地へ移る。
  vi.stubEnv("DEATH_SP_LOCK_SECONDS", "7200");
  await configure("death_place_id", null);
  fatalDice(f.actors[2]!, "mortal");
  await f.send(0, attack(2));
  expect(await present(0)).toEqual([f.actors[0]]);
  expect(await whereabouts(2)).toEqual([f.far]);
  expect(await whereabouts(0)).toEqual([f.place]);
  const configuredLock = await penalty(2);
  expect(configuredLock.period.until! - configuredLock.period.from).toBe(
    7_200_000,
  );

  const clock = vi
    .spyOn(access.botPlay, "now")
    .mockReturnValue(new Date(until - 1));
  const self = () => f.send(1, { command: "search", query: { kind: "self" } });
  const explore = {
    requestId: randomUUID(),
    command: "explore",
    text: "墓地から水場へ通じる道を探す",
    label: "水場",
    fromId: grave,
    dependencies: [],
  };
  const penaltyState = {
    states: expect.arrayContaining([
      expect.objectContaining({
        relation: expect.objectContaining({ id: lock.id }),
        node: expect.objectContaining({ text: "SP使用禁止" }),
      }),
    ]),
  };
  expect(await self()).toMatchObject({
    spentSp: 0,
    material: penaltyState,
  });
  const before = (await f.status(1)).dailySp;
  const calls = f.calls.mock.calls.length;
  await expect(f.send(1, explore)).rejects.toMatchObject({
    code: "SP_USE_PROHIBITED",
  });
  expect(f.calls.mock.calls.length).toBe(calls);
  expect((await f.status(1)).dailySp).toEqual(before);

  clock.mockReturnValue(new Date(until));
  expect((await self()).material).not.toMatchObject(penaltyState);
  const remaining = (await f.status(1)).dailySp.remaining;
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { sides: 100, successThrough: 100, explored }),
  );
  const resumed = await f.send(1, explore);
  expect(resumed).toMatchObject({
    spentSp: 1,
    dailySp: { remaining: remaining - 1 },
  });
  expect(await f.send(1, explore)).toEqual(resumed);
  expect((await f.status(1)).dailySp).toEqual(resumed.dailySp);
});

test("現在地をHomeに設定すると、手番とSPを消費せず、死亡時は世界指定よりHomeを優先する", async () => {
  const f = await fixture(2);
  const target = f.actors[1]!;
  const item = (
    await f.apply([
      { type: "create", label: "道具", holder: target, basis: "試験" },
    ])
  ).changes.nodes.find((node) => node.kind === "existence")!;
  await isolated.databases.postgres.query(
    "UPDATE world_construction SET death_place_id=$2 WHERE id=$1",
    [f.world, f.place],
  );
  const whereabouts = async () =>
    (
      (await f.send(1, { command: "search", query: { kind: "self" } }))
        .material as { locations: { directPlaceId: string }[] }
    ).locations.map((location) => location.directPlaceId);

  await f.move(1, f.far);
  const before = await f.status(1);
  await f.send(1, { command: "home-set" });
  expect(await f.status(1)).toMatchObject({
    home: { placeId: f.far, name: "離れた場所" },
    sessionId: before.sessionId,
    turn: before.turn,
    callsUsed: before.callsUsed,
    dailySp: before.dailySp,
  });
  expect(await whereabouts()).toEqual([f.far]);
  expect(f.calls).not.toHaveBeenCalled();

  await f.move(1, f.place);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { ...sure, fatal: [target] }),
  );
  const result = await f.send(0, {
    command: "oppose",
    text: "斬りかかって道具を奪う",
    operations: [
      {
        type: "move",
        item: item.id,
        from: target,
        to: f.actors[0],
        basis: "奪う",
      },
    ],
    dependencies: [],
  });
  expect(result.outcome).toMatchObject({
    success: true,
    setting: { fatal: [target] },
  });
  expect(await whereabouts()).toEqual([f.far]);
  expect((await f.status(1)).home).toEqual({
    placeId: f.far,
    name: "離れた場所",
  });
});

test("リスポーンが有効な世界でも、作成時に無効を選んだ人物は死亡時に戻らない", async () => {
  const f = await fixture();
  await isolated.databases.postgres.query(
    "UPDATE world_construction SET published=true,accepting=true,state='finished',death_place_id=$2 WHERE id=$1",
    [f.world, f.far],
  );
  for (const i of [1, 2]) {
    const owner = f.people[i]!.id;
    const join = randomUUID();
    await auth.operations.execute(
      owner,
      join,
      {
        operation: "worlds.join",
        worldId: f.world,
        name: `新規の人物${i}`,
        character: "新しく参加する人物",
        ...(i === 1 && { disableRespawn: true }),
      },
      { players: access.players },
    );
    await access.players.tick(join);
    const player = (await access.players.list(owner, f.world, undefined, join))
      .items[0]!;
    expect(player.state).toBe("ready");
    f.actors[i] = player.actorId!;
    await f.move(i, f.place);
    await f.send(i, { command: "start" });
    await f.send(i, { command: "contact", targetId: f.actors[0] });
  }
  for (const targetId of f.actors.slice(1)) {
    f.calls.mockImplementationOnce(async (id) =>
      answer(id, { ...sure, fatal: [targetId] }),
    );
    const result = await f.send(0, {
      command: "apply",
      expectedSp: 1,
      dependencies: [],
      action: {
        type: "oppose",
        targetId,
        text: "致命的な結果となる対抗をする",
        description: "相手が死亡する。",
      },
    });
    expect(result.outcome).toMatchObject({
      success: true,
      setting: { fatal: [targetId] },
    });
  }
  await expect(f.send(1, { command: "start" })).rejects.toMatchObject({
    code: "ACTOR_DEAD",
  });
  expect(await f.status(1)).toMatchObject({ session: null });
  expect(await directPlaces(f.store.context(f.graph), f.actors[1]!)).toEqual([
    f.place,
  ]);
  expect((await f.status(2)).characters?.map((c) => c.actorId)).toEqual([
    f.actors[2],
  ]);
  expect(await directPlaces(f.store.context(f.graph), f.actors[2]!)).toEqual([
    f.far,
  ]);
});

test("管理者が既存の人物のリスポーンを無効にすると次の死亡で戻らない", async () => {
  const f = await fixture();
  const [actor, disabled, normal] = f.actors as [string, string, string];
  const db = isolated.databases.postgres;
  const admin = await auth.person();
  await db.query(
    "UPDATE world_construction SET death_place_id=$2 WHERE id=$1",
    [f.world, f.far],
  );
  expect(
    (await db.query("SELECT 1 FROM world_join WHERE actor_id=$1", [disabled]))
      .rowCount,
  ).toBe(0);
  await auth.operations.execute(
    admin.id,
    randomUUID(),
    {
      operation: "worlds.disableActorRespawn",
      worldId: f.world,
      actorId: disabled,
      reason: "死亡後に復帰しない人物として遊ぶため",
    },
    { players: access.players },
  );

  await f.move(2, f.place);
  await f.send(1, { command: "contact", targetId: actor });
  await f.send(2, { command: "contact", targetId: actor });
  for (const targetId of [disabled, normal]) {
    f.calls.mockImplementationOnce(async (id) =>
      answer(id, { ...sure, fatal: [targetId] }),
    );
    const result = await f.send(0, {
      command: "apply",
      expectedSp: 1,
      dependencies: [],
      action: {
        type: "oppose",
        targetId,
        text: "致命的な結果となる対抗をする",
        description: "相手が死亡する。",
      },
    });
    expect(result.outcome).toMatchObject({
      success: true,
      setting: { fatal: [targetId] },
    });
  }
  await expect(f.send(1, { command: "start" })).rejects.toMatchObject({
    code: "ACTOR_DEAD",
  });
  expect(await directPlaces(f.store.context(f.graph), disabled)).toEqual([
    f.place,
  ]);
  expect(await directPlaces(f.store.context(f.graph), normal)).toEqual([f.far]);
  expect((await f.status(2)).characters?.map((c) => c.actorId)).toEqual([
    normal,
  ]);
});

test("リスポーン無効時は死亡した人物の履歴を保持して操作を止め、同じ利用者が新しい人物で参加できる", async () => {
  vi.stubEnv("DEATH_SP_LOCK_SECONDS", "0");
  const f = await fixture(2);
  const [actor, victim] = f.actors as [string, string];
  const previous = await f.status(1);
  const sceneId = previous.members!.find((m) => m.actorId === victim)!.sceneId;
  const previousRequest = { command: "start", requestId: randomUUID() };
  const previousResult = await f.send(1, previousRequest);
  await f.send(1, { command: "contact", targetId: actor });
  const db = isolated.databases.postgres;
  const { changes } = await f.apply([
    { type: "create", label: "検証用の品", holder: victim, basis: "初期設定" },
  ]);
  const item = changes.nodes[0]!.id;
  await db.query(
    "UPDATE world_construction SET respawn_enabled=false,death_place_id=$2 WHERE id=$1",
    [f.world, f.far],
  );
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { ...sure, fatal: [victim] }),
  );
  const attack = {
    requestId: randomUUID(),
    command: "oppose",
    text: "致命的な力で相手を押さえ、手に持つ品を奪う",
    operations: [
      { type: "move", item, from: victim, to: actor, basis: "奪う" },
    ],
    dependencies: [],
  };
  const result = await f.send(0, attack);
  expect(result.outcome).toMatchObject({
    success: true,
    setting: { fatal: [victim] },
  });
  expect(await f.send(0, attack)).toEqual(result);
  expect(await f.send(1, previousRequest)).toEqual(previousResult);
  expect(await f.status(1)).toMatchObject({ session: null });
  expect(
    await f.store.context(f.graph).spUseProhibitedUntil(victim, Date.now()),
  ).toBeUndefined();
  expect(await directPlaces(f.store.context(f.graph), victim)).toEqual([
    f.place,
  ]);
  expect(await access.botPlay.history(f.world, victim, sceneId)).toMatchObject({
    sceneId,
    result: { entries: expect.any(Array) },
  });
  const owner = f.people[1]!.id;
  await expect(f.send(1, { command: "start" })).rejects.toMatchObject({
    code: "ACTOR_DEAD",
  });
  await expect(f.view(1, item, "all")).rejects.toMatchObject({
    code: "ACTOR_DEAD",
  });
  await expect(
    access.waiting(owner, f.world, victim, `human:${owner}`, true),
  ).rejects.toMatchObject({ code: "ACTOR_DEAD" });
  // 設定を戻しても確定済みの死亡は変化せず、同じアカウントの新しい人物は操作できる。
  await db.query(
    "UPDATE world_construction SET respawn_enabled=true,published=true,accepting=true,state='finished' WHERE id=$1",
    [f.world],
  );
  await expect(f.send(1, { command: "start" })).rejects.toMatchObject({
    code: "ACTOR_DEAD",
  });
  const join = randomUUID();
  await auth.operations.execute(
    owner,
    join,
    {
      operation: "worlds.join",
      worldId: f.world,
      character: "新しく参加する人物",
    },
    { players: access.players },
  );
  await access.players.tick(join);
  const replacement = (
    await access.players.list(owner, f.world, undefined, join)
  ).items[0]!.actorId;
  expect(replacement).toBeTruthy();
  expect(replacement).not.toBe(victim);
  await expect(
    access.botCommand(
      owner,
      f.world,
      { command: "start", requestId: randomUUID() },
      replacement!,
    ),
  ).resolves.toBeDefined();
});

test("持ち物は本人検索で個数つきで読め、ダイスが成功したときだけGMの選んだ手持ちの物品が減る", async () => {
  const f = await fixture();
  const made = await f.apply([
    {
      type: "create",
      label: "矢",
      count: 5,
      holder: f.actors[0],
      basis: "初期設定",
    },
    { type: "create", label: "砥石", holder: f.actors[0], basis: "初期設定" },
    { type: "create", label: "盾", holder: f.actors[1], basis: "初期設定" },
  ]);
  const [arrows, stone, shield] = made.changes.nodes.map((n) => n.id) as [
    string,
    string,
    string,
  ];
  const held = async (i: number) =>
    (await readBelongings(f.store.context(f.graph), f.actors[i]!)).items.map(
      ({ id, label, count }) => ({ id, label, count }),
    );
  const count = async (i: number, id: string) =>
    (await held(i)).find((item) => item.id === id)?.count;
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  // 本人検索が持ち物を返す。旧い検索の種類は本人検索へ誘導し、通常枠を使わない。
  const self = await f.send(0, { command: "search", query: { kind: "self" } });
  expect(
    (self.material as { belongings: { items: unknown[] } }).belongings.items,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: arrows, label: "矢", count: 5 }),
      expect.objectContaining({ id: stone, label: "砥石" }),
    ]),
  );
  await expect(
    f.send(0, { command: "search", query: { kind: "belongings" } }),
  ).rejects.toMatchObject({ code: "SEARCH_KIND_MOVED" });
  expect((await f.status(0)).callsUsed).toBe(1);
  // 新規作成のダイス。候補は申請者が手に持つ物品で、候補にないIDは減らない。
  const candidates = (messages: { content: unknown }[]) =>
    (
      JSON.parse(String(messages[1]!.content)) as {
        consumable?: { id: string }[];
      }
    ).consumable?.map((c) => c.id);
  const craft = (requestId = randomUUID()) => ({
    requestId,
    command: "update",
    text: "矢を使って的を作る",
    operations: [
      { type: "create", label: "的", holder: f.actors[0], basis: "作った" },
    ],
    dependencies: [],
  });
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    expect(candidates(messages)?.sort()).toEqual([arrows, stone].sort());
    return answer(id, {
      ...sure,
      consumes: [{ id: arrows, count: 2 }, { id: shield }],
    });
  });
  const first = craft(),
    crafted = await f.send(0, first);
  expect(crafted.outcome).toMatchObject({
    success: true,
    setting: { consumes: [{ id: arrows, label: "矢", count: 2 }] },
  });
  expect(await f.send(0, first)).toEqual(crafted);
  expect(await held(0)).toHaveLength(3);
  expect(await count(0, arrows)).toBe(3);
  expect(await held(1)).toMatchObject([{ id: shield }]);
  // 失敗では減らない。
  const failing = craft(),
    lost = { sides: 100, successThrough: 10 };
  await isolated.databases.postgres.query(
    "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,50)",
    [
      derivedId(`${failing.requestId}:creation`),
      { ...lost, consumes: [{ id: arrows, label: "矢", count: 1 }] },
    ],
  );
  expect((await f.send(0, failing)).outcome).toMatchObject({ success: false });
  expect(await count(0, arrows)).toBe(3);
  // 個数を増やす更新はダイスに進む。申請が操作する物品は候補から外れる。減らす更新はダイスを通らない。
  const recount = (count: number) =>
    f.send(0, {
      command: "update",
      text: "矢の数を改める",
      operations: [{ type: "update", id: arrows, count }],
      dependencies: [],
    });
  f.calls.mockClear();
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    expect(candidates(messages)).not.toContain(arrows);
    return answer(id, sure);
  });
  expect((await recount(8)).outcome).toMatchObject({ success: true });
  expect(await count(0, arrows)).toBe(8);
  expect((await recount(6)).outcome).toBeUndefined();
  expect(f.calls).toHaveBeenCalledTimes(1);
  // 一部の贈与は受領を経て確定し、受け取った側に個数つきの物品ができる。
  const giving = await f.send(0, {
    command: "update",
    text: "矢を2本贈る",
    operations: [
      {
        type: "move",
        item: arrows,
        from: f.actors[0],
        to: f.actors[1],
        count: 2,
        basis: "贈った",
      },
    ],
    dependencies: [],
  });
  await f.send(1, {
    command: "receive",
    applicationId: giving.applicationId,
    accept: true,
  });
  expect(await count(0, arrows)).toBe(4);
  expect(await held(1)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: shield }),
      expect.objectContaining({ label: "矢", count: 2 }),
    ]),
  );
  // 対抗行動のダイスでも同じ判定で減る。個数のない物品はまるごと失う。
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-opposition-dice");
    expect(candidates(messages)).toContain(stone);
    return answer(id, { ...sure, consumes: [{ id: stone, count: 3 }] });
  });
  const seized = await f.send(0, {
    command: "oppose",
    text: "砥石を投げつけて盾を奪う",
    operations: [
      {
        type: "move",
        item: shield,
        from: f.actors[1],
        to: f.actors[0],
        basis: "奪う",
      },
    ],
    dependencies: [],
  });
  expect(seized.outcome).toMatchObject({
    success: true,
    setting: { consumes: [{ id: stone, label: "砥石" }] },
  });
  expect((await held(0)).map((i) => i.id)).not.toContain(stone);
  expect((await held(0)).map((i) => i.id)).toContain(shield);
  // 申請者が中身を決めていない技能と物品は、成功時の本文をGMが決める。申請が作らないノードは変わらない。
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    expect(messages[0]?.content).toContain("decided:[{id,text}]");
    const { changes } = JSON.parse(String(messages[1]!.content)) as {
      changes: { nodes: { id: string; kind: string }[] };
    };
    return answer(id, {
      ...sure,
      decided: [
        ...changes.nodes.map((n) => ({
          id: n.id,
          text:
            n.kind === "script"
              ? "水呼び: 近くの水の在り処が分かる"
              : "祠の小石",
        })),
        { id: shield, text: "別の物" },
      ],
    });
  });
  const prayer = {
      requestId: randomUUID(),
      command: "update",
      text: "祠に祈り、授かりを委ねる",
      operations: [
        {
          type: "learn",
          person: f.actors[0],
          text: "祠が決める技能を1つ",
          basis: "祈った",
        },
        {
          type: "create",
          label: "祠が決める何か",
          holder: f.actors[0],
          basis: "祈った",
        },
      ],
      dependencies: [],
    },
    granted = await f.send(0, prayer);
  expect(
    (
      granted.outcome as { setting: { decided: { text: string }[] } }
    ).setting.decided.map((d) => d.text),
  ).toEqual(["水呼び: 近くの水の在り処が分かる", "祠の小石"]);
  expect(granted.items).toMatchObject([{ label: "祠の小石" }]);
  expect(await f.send(0, prayer)).toEqual(granted);
  const own = await readBelongings(f.store.context(f.graph), f.actors[0]!);
  expect(own.skills.map((s) => s.text)).toEqual([
    "水呼び: 近くの水の在り処が分かる",
  ]);
  expect(own.items.map((i) => i.label)).toEqual(
    expect.arrayContaining(["祠の小石", "盾"]),
  );
});

test.each(["確定", "失敗"])(
  "作成の判定中は本人の別の操作を拒否し、判定の%s後は再送を受け付ける",
  async (decision) => {
    const f = await fixture();
    const before = await f.status(0);
    let enter!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const paused = new Promise<void>((resolve) => (resume = resolve));
    const providerError = new Error("判定サービスのエラー");
    f.calls.mockImplementationOnce(async (id, role) => {
      expect(role).toBe("world-creation-dice");
      enter();
      await paused;
      if (decision === "失敗") throw providerError;
      return answer(id, sure);
    });
    const update = {
      command: "update",
      text: "木箱を作る",
      operations: [
        {
          type: "create",
          label: "木箱",
          holder: f.actors[0],
          basis: "板を組む",
        },
      ],
      dependencies: [],
    };
    const adjudicated = f.send(0, update);
    const connection = new WorldAccess(runtime);
    const finish = { command: "finish", requestId: randomUUID() };
    const submit = (input: Record<string, unknown>) =>
      connection.botCommand(
        f.people[0]!.id,
        f.world,
        PlayCommand.parse({ requestId: randomUUID(), ...input }),
        f.actors[0],
        "second-connection",
      );
    try {
      await Promise.race([
        entered,
        adjudicated.then(() => {
          throw new Error("作成の判定が呼ばれませんでした");
        }),
      ]);
      for (const input of [
        finish,
        { command: "leave" },
        { command: "say", text: "判定中の発言" },
        { command: "search", query: { kind: "self" } },
        update,
      ]) {
        await expect(submit(input)).rejects.toMatchObject({
          status: 409,
          code: "REQUEST_IN_PROGRESS",
        });
      }
      expect(await f.status(0)).toMatchObject({
        sessionId: before.sessionId,
        callsUsed: 0,
      });
      await expect(
        f.send(1, { command: "say", text: "別の人の発言" }),
      ).resolves.toMatchObject({
        callsUsed: 1,
      });
    } finally {
      resume();
      await adjudicated.catch(() => undefined);
    }
    if (decision === "失敗")
      await expect(adjudicated).rejects.toBe(providerError);
    else
      await expect(adjudicated).resolves.toMatchObject({
        sessionId: before.sessionId,
        outcome: { success: true },
      });
    await expect(submit(finish)).resolves.toMatchObject({
      session: null,
      action: { command: "finish" },
    });
  },
);

test("観戦画面の読み取り中に人物が移動すると、新しい現在地を返す", async () => {
  const f = await fixture(1);
  await f.send(0, { command: "finish" });
  const validate = WorldContext.prototype.validate;
  vi.spyOn(WorldContext.prototype, "validate").mockImplementationOnce(
    async function (this: WorldContext) {
      await f.move(0, f.far);
      await validate.call(this);
    },
  );
  const expire = vi.spyOn(access.botPlay, "expire");
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/worlds/${f.world}/session?view=screen&actorId=${f.actors[0]}`,
      headers: { cookie: f.people[0]!.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().screen.place).toBe("離れた場所");
    expect(expire).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

test("観戦は公開した人物の進行中の記録だけを本人の視点で読める", async () => {
  const f = await fixture(2);
  const [owner, participant] = f.people;
  const [actor, other] = f.actors;
  const viewer = await auth.person("user");
  const db = isolated.databases.postgres;
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const url = (actorId = actor) =>
    `/api/worlds/${f.world}/spectate?actorId=${actorId}`;
  const observe = (query = url(), cookie = viewer!.cookie) =>
    app.inject({ method: "GET", url: query, headers: { cookie } });
  const records = async (
    target: string,
    payload: Record<string, unknown>,
    count = 1,
  ) => {
    await db.query(
      `WITH scene AS (
         SELECT id,session_id FROM bot_scene WHERE world_id=$1 AND actor_id=$2 AND NOT closed
       ), chat AS (
         INSERT INTO bot_chat(session_id,payload,recorded_at)
         SELECT session_id,$3::jsonb,now() FROM scene CROSS JOIN generate_series(1,$4::int)
         RETURNING id
       )
       INSERT INTO bot_record(scene_id,actor_id,chat_id)
       SELECT scene.id,$2,chat.id FROM scene CROSS JOIN chat`,
      [f.world, target, payload, count],
    );
  };
  try {
    expect((await observe(url(), "")).statusCode).toBe(401);
    expect((await observe()).statusCode).toBe(404);
    await auth.operations.spectating(owner!.id, true);
    expect((await observe()).statusCode).toBe(404);
    expect((await observe(url(), participant!.cookie)).statusCode).toBe(200);
    await db.query("UPDATE world_construction SET published=true WHERE id=$1", [
      f.world,
    ]);
    expect((await observe(url(other))).statusCode).toBe(404);

    await records(actor!, { comment: "前のシーンだけに残る発言" });
    await f.send(0, { command: "finish" });
    expect(SpectatingView.parse((await observe()).json()).scene).toBeNull();
    await f.send(0, { command: "start" });
    await records(actor!, {
      entries: [
        {
          label: "話し手",
          input: "観戦対象だけに聞こえた発言",
          result: {
            outcome: { success: true },
            effectState: "扉が開いた",
            items: [{ label: "秘密の持ち物" }],
          },
        },
      ],
      receiptResult: { outcome: "rejected", message: "非表示の内訳" },
    });
    await records(other!, { comment: "別の人物だけに聞こえた発言" });
    await records(actor!, { comment: "現在のシーンで見た発言" }, 50);
    const keepAlive = vi.spyOn(access.botPlay, "keepAlive");
    const expire = vi.spyOn(access.botPlay, "expire");

    const response = await observe();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-gestaloka-subject"]).toBe(viewer.id);
    const { name, scene } = SpectatingView.parse(response.json());
    expect(name).toBe("人物0");
    expect(scene?.entries).toHaveLength(50);
    expect(scene?.before).toBeTruthy();
    const older = await observe(`${url()}&before=${scene!.before}`);
    expect(SpectatingView.parse(older.json()).scene!.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lines: [
            { speaker: "話し手", text: "観戦対象だけに聞こえた発言" },
            { text: "結果：扉が開いた" },
            { text: "受領が拒否されました" },
          ],
        }),
      ]),
    );
    const text = response.body + older.body;
    for (const hidden of [
      "前のシーンだけに残る発言",
      "別の人物だけに聞こえた発言",
      "秘密の持ち物",
      "非表示の内訳",
    ])
      expect(text).not.toContain(hidden);
    expect(keepAlive).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
    expect(
      (
        await observe(
          `/api/worlds/${f.world}/session?view=screen&actorId=${actor}`,
        )
      ).statusCode,
    ).toBe(404);
    await auth.operations.spectating(owner!.id, false);
    expect((await observe()).statusCode).toBe(404);
    expect((await observe(`${url()}&before=${scene!.before}`)).statusCode).toBe(
      404,
    );
  } finally {
    await app.close();
  }
});

test("時間をかける物品の作成は、届く時刻を過ぎてから成立し、本人あての通知になる", async () => {
  const f = await fixture();
  const coins = (
    await f.apply([
      {
        type: "create",
        label: "銀貨",
        count: 5,
        holder: f.actors[0],
        basis: "初期設定",
      },
    ])
  ).changes.nodes[0]!.id;
  const held = async () =>
    (await readBelongings(f.store.context(f.graph), f.actors[0]!)).items.map(
      ({ label, count }) => ({ label, count }),
    );
  const arriving = async () =>
    (await f.send(0, { command: "search", query: { kind: "self" } })).arriving;
  const order = (operations: unknown[]) => ({
    requestId: randomUUID(),
    command: "update",
    text: "ミルクを取り寄せる",
    operations,
    waitMinutes: 90,
    dependencies: [],
  });
  const milk = (holder = f.actors[0]) => ({
    type: "create",
    label: "ミルク",
    count: 10,
    holder,
    basis: "取り寄せた",
  });
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  // 物品のcreate以外を含む申請と、受領が必要な申請には指定できない。
  for (const operations of [
    [milk(), { type: "update", id: coins, count: 9 }],
    [milk(f.actors[1])],
  ])
    await expect(f.send(0, order(operations))).rejects.toMatchObject({
      code: "WAIT_NOT_APPLICABLE",
    });
  expect(f.calls).not.toHaveBeenCalled();
  expect((await f.status(0)).callsUsed).toBe(0);
  // かける時間がGMへ渡る。成功すると代価だけが減り、物品はまだ成立しない。
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    expect(String(messages[0]!.content)).toContain("waitMinutes");
    expect(JSON.parse(String(messages[1]!.content)).waitMinutes).toBe(90);
    return answer(id, { ...sure, consumes: [{ id: coins, count: 2 }] });
  });
  const first = order([milk()]),
    placed = await f.send(0, first),
    arrival = placed.arrival as { dueAt: string };
  expect(placed.outcome).toMatchObject({
    success: true,
    setting: { consumes: [{ id: coins, count: 2 }] },
  });
  const dueAt = Date.parse(arrival.dueAt);
  expect(dueAt).toBeGreaterThan(Date.now() + 89 * 60000);
  expect(await f.send(0, first)).toEqual(placed);
  expect(await held()).toEqual([{ label: "銀貨", count: 3 }]);
  expect(await arriving()).toEqual([
    {
      text: "ミルクを取り寄せる",
      items: [{ label: "ミルク", count: 10 }],
      dueAt: arrival.dueAt,
    },
  ]);
  // 失敗では何も減らず、予定もできない。
  const failing = order([milk()]),
    lost = { sides: 100, successThrough: 10 };
  await isolated.databases.postgres.query(
    "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,50)",
    [
      derivedId(`${failing.requestId}:creation`),
      { ...lost, consumes: [{ id: coins, label: "銀貨", count: 1 }] },
    ],
  );
  const failed = await f.send(0, failing);
  expect(failed.outcome).toMatchObject({ success: false });
  expect(failed.arrival).toBeUndefined();
  expect(await held()).toEqual([{ label: "銀貨", count: 3 }]);
  // 届く時刻の前の定期処理では何も変わらない。
  const user = f.people[0]!.id,
    waiting = () => access.waiting(user, f.world, f.actors[0], "view", true);
  await new BotPlay(runtime, () => new Date(dueAt - 1)).deliverArrivals(
    f.world,
  );
  expect(await held()).toHaveLength(1);
  expect((await f.status(0)).unreadNotices).toBeUndefined();
  expect((await waiting()).noticeKey).toBeNull();
  // 過ぎた後の定期処理で成立する。繰り返しても物品と通知は増えない。
  const later = new BotPlay(runtime, () => new Date(dueAt + 1));
  const filler = await f.apply([
    {
      type: "create",
      label: "道具",
      count: 870,
      holder: f.actors[0],
      basis: "手持ちを埋める",
    },
  ]);
  await f.store.configureInventory(f.graph, true);
  const claim = vi.spyOn(f.store, "claim"),
    commit = derivedId(first.requestId + ":arrival");
  await later.deliverArrivals(f.world);
  expect(claim).not.toHaveBeenCalledWith(f.graph, commit);
  expect(await held()).not.toContainEqual({ label: "ミルク", count: 10 });
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT due FROM bot_arrival WHERE id=$1",
        [first.requestId],
      )
    ).rows,
  ).toMatchObject([{ due: new Date(dueAt) }]);
  await f.apply([
    {
      type: "remove",
      id: filler.changes.nodes.find((n) => n.kind === "existence")!.id,
    },
  ]);
  await Promise.all([
    later.deliverArrivals(f.world),
    later.deliverArrivals(f.world),
  ]);
  expect(claim.mock.calls.filter(([, id]) => id === commit)).toHaveLength(1);
  expect(await held()).toEqual(
    expect.arrayContaining([
      { label: "銀貨", count: 3 },
      { label: "ミルク", count: 10 },
    ]),
  );
  expect(await held()).toHaveLength(2);
  expect(await arriving()).toBeUndefined();
  // 未読は手番の状態と待受の状態に出て、読むと消える。
  expect(await f.status(0)).toMatchObject({
    unreadNotices: 1,
    noticeMessage: expect.stringContaining("notices"),
  });
  const key = (await waiting()).noticeKey;
  const read = await access.notices(user, f.world, f.actors[0]);
  expect(read.notices).toEqual([
    {
      id: key,
      at: new Date(dueAt + 1).toISOString(),
      text: expect.stringContaining("ミルク（10個）"),
      unread: true,
    },
  ]);
  expect(
    (await access.notices(user, f.world, f.actors[0])).notices,
  ).toMatchObject([{ id: key, unread: false }]);
  expect((await f.status(0)).unreadNotices).toBeUndefined();
  expect((await waiting()).noticeKey).toBeNull();
});

test("到着予定の内容が変わった申請だけを取りやめ、後続の物品を届ける", async () => {
  const f = await fixture(1);
  const actor = f.actors[0]!;
  f.calls.mockImplementation(async (id) => answer(id, sure));
  const order = async (label: string) => {
    const requestId = randomUUID();
    await expect(
      f.send(0, {
        requestId,
        command: "update",
        text: `${label}を取り寄せる`,
        operations: [
          { type: "create", label, holder: actor, basis: "取り寄せ" },
        ],
        waitMinutes: 1,
        dependencies: [],
      }),
    ).resolves.toMatchObject({ arrival: { dueAt: expect.any(String) } });
    return requestId;
  };
  const changed = await order("布"),
    accepted = await order("木材");
  const edited = await isolated.databases.postgres.query(
    `UPDATE bot_arrival SET due=due-interval '1 minute',
       operations=jsonb_set(operations,'{0,label}',to_jsonb($2::text),false)
     WHERE id=$1 AND direct_scope IS NOT NULL`,
    [changed, "申請にない品"],
  );
  expect(edited.rowCount).toBe(1);
  const later = new BotPlay(runtime, () => new Date(Date.now() + 120_000));
  await later.deliverArrivals(f.world);
  expect(
    await f.store.receipt(f.graph, derivedId(changed + ":arrival")),
  ).toBeUndefined();
  expect(
    await f.store.receipt(f.graph, derivedId(accepted + ":arrival")),
  ).toBeDefined();
  expect(
    (await access.notices(f.people[0]!.id, f.world, actor)).notices,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        text: expect.stringContaining("取りやめました"),
      }),
      expect.objectContaining({
        text: expect.stringContaining("木材が届きました"),
      }),
    ]),
  );
});

test("GMが同行を認めたユニークNPCは、本人の移動に付いてきて、待機・移動・帰還・解除を本人が選べる", async () => {
  const f = await fixture(),
    db = isolated.databases.postgres,
    model = runtime.agent.model,
    [player, npc, other] = f.actors as [string, string, string],
    ctx = () => f.store.context(f.graph),
    judged = () =>
      f.calls.mock.calls.filter((c) => c[1] === "world-companion").length;
  // GMが判断するのはサーバー担当のNPC。試験では管理者が手番を代行する。
  await setNpc(f, 1, "server");
  await db.query("UPDATE app_user SET role='admin' WHERE id=$1", [
    f.people[1]!.id,
  ]);
  const request = (text: string) =>
    f.send(0, { command: "companion-request", targetId: npc, text });
  const locate = (subjectId: string, to: string) =>
    f.send(0, {
      command: "update",
      text: "移動する",
      dependencies: [],
      operations: [{ type: "locate", subjectId, text: "移動", aboutIds: [to] }],
    });
  const pass = async () => {
    await f.send(0, { command: "end-turn" });
    await f.send(1, { command: "end-turn" });
  };
  // 別のセッションにいる相手、他人のcompanion、4体目は、GMを呼ばずに拒否する。
  await expect(request("一緒に来て")).rejects.toMatchObject({
    code: "COMPANION_TARGET_UNAVAILABLE",
  });
  await f.send(1, { command: "contact", targetId: player });
  expect((await f.status(0)).actorId).toBe(player);
  await db.query(
    "INSERT INTO bot_companion(world_id,npc_id,actor_id) VALUES($1,$2,$3)",
    [f.world, npc, other],
  );
  await expect(request("一緒に来て")).rejects.toMatchObject({
    code: "COMPANION_TAKEN",
  });
  await db.query("DELETE FROM bot_companion WHERE world_id=$1", [f.world]);
  for (let i = 0; i < 3; i++)
    await db.query(
      "INSERT INTO bot_companion(world_id,npc_id,actor_id) VALUES($1,$2,$3)",
      [f.world, randomUUID(), player],
    );
  await expect(request("一緒に来て")).rejects.toMatchObject({
    code: "COMPANION_LIMIT",
  });
  await db.query("DELETE FROM bot_companion WHERE world_id=$1", [f.world]);
  expect(judged()).toBe(0);

  // 却下された同じ手番の出し直しは、判断モデルが同じ試みと認めれば前回の却下を返し、SPを使わない。
  vi.spyOn(model, "decision", "get").mockReturnValue(
    decisionSettings({ LLM_DECISION_MODEL: "fixture/decide" }),
  );
  const decide = vi.spyOn(model, "decide").mockResolvedValue({ f0: 0.95 });
  f.calls.mockImplementation(async (id) =>
    answer(id, { accepted: false, reason: "まだ信頼していない" }),
  );
  expect(await request("一緒に来て")).toMatchObject({
    outcome: { accepted: false, reason: "まだ信頼していない" },
    spentSp: 1,
    dailySp: { remaining: 99 },
    companions: [],
  });
  expect(decide).not.toHaveBeenCalled();
  expect(await request("頼むから一緒に来てほしい")).toMatchObject({
    outcome: { accepted: false, repeated: true },
    spentSp: 0,
    dailySp: { remaining: 99 },
  });
  expect(decide).toHaveBeenCalledTimes(1);
  expect(judged()).toBe(1);

  // 次の手番には新しい申請としてGMが判断する。成立すると関係がグラフに残り、追従で一覧に出る。
  await pass();
  f.calls.mockImplementation(async (id) =>
    answer(id, { accepted: true, reason: "助けられた恩がある" }),
  );
  const formed = await request("一緒に来て");
  expect(formed).toMatchObject({
    outcome: { accepted: true },
    spentSp: 1,
    dailySp: { remaining: 98 },
    companions: [
      { targetId: npc, name: "人物1", mode: "follow", placeId: f.place },
    ],
  });
  expect(decide).toHaveBeenCalledTimes(1);
  expect(await ctx().marked(npc, "status", "companion")).toHaveLength(1);

  // 追従中は本人の移動と同じ確定で移り、手番の後も同じセッションに残る。
  await locate(player, f.far);
  expect(await directPlaces(ctx(), npc)).toEqual([f.far]);
  await f.send(0, { command: "end-turn" });
  expect((await f.status(1)).sessionId).toBe((await f.status(0)).sessionId);
  await f.send(1, { command: "end-turn" });

  // 待機中は移らない。帰る場所と指定の場所へは、受領判断なしに向かわせる。
  await f.send(0, { command: "companion-wait", targetId: npc });
  await locate(player, f.place);
  expect(await directPlaces(ctx(), npc)).toEqual([f.far]);
  await expect(
    f.send(0, { command: "companion-return", targetId: npc }),
  ).rejects.toMatchObject({ code: "COMPANION_HOME_REQUIRED" });
  expect(
    (
      await f.send(0, {
        command: "companion-home",
        targetId: npc,
        placeId: f.place,
      })
    ).companions,
  ).toMatchObject([{ mode: "wait", homeId: f.place, placeId: f.far }]);
  expect(
    await f.send(0, { command: "companion-return", targetId: npc }),
  ).toMatchObject({ state: "accepted" });
  expect(await directPlaces(ctx(), npc)).toEqual([f.place]);
  await f.send(0, {
    command: "companion-move",
    targetId: npc,
    placeId: f.far,
  });
  expect(await directPlaces(ctx(), npc)).toEqual([f.far]);

  // 解除すると一覧とグラフの関係が終わり、移動させられなくなる。
  expect(
    (await f.send(0, { command: "companion-dismiss", targetId: npc }))
      .companions,
  ).toEqual([]);
  expect(await ctx().marked(npc, "status", "companion")).toEqual([]);
  await expect(
    f.send(0, { command: "companion-move", targetId: npc, placeId: f.place }),
  ).rejects.toMatchObject({ code: "COMPANION_REQUIRED" });

  // 出現個体は、先に昇格させる必要がある。
  const source = randomUUID();
  f.calls.mockImplementation(async (id) => answer(id, sure));
  await f.send(0, {
    requestId: source,
    command: "say",
    text: "小鳥が現れる",
    instantNpcs: ["小鳥"],
  });
  await expect(
    f.send(0, {
      command: "companion-request",
      targetId: derivedId(source + ":manual:0"),
      text: "ついてきて",
    }),
  ).rejects.toMatchObject({ code: "COMPANION_PROMOTION_REQUIRED" });
  expect(judged()).toBe(2);
});

test("外部botが担当するNPCへの同行申請は本人の受領で決まり、成立後は本人から終えられる", async () => {
  const f = await fixture(),
    [player, npc] = f.actors as [string, string],
    ctx = () => f.store.context(f.graph),
    owned = async () =>
      (await f.send(0, { command: "companion-status" })).companions;
  await setNpc(f, 1, "bot");
  await f.send(1, { command: "contact", targetId: player });
  await giveTurn(f, 0);
  // 却下すれば成立しない。GMは呼ばず、SPも使わない。
  expect(await accompany(f, npc, "一緒に来て", false)).toMatchObject({
    state: "receiving",
    spentSp: 0,
  });
  expect(await owned()).toEqual([]);
  expect(await ctx().marked(npc, "status", "companion")).toEqual([]);
  // 同行していないNPCは、関係を終える操作を使えない。
  const leave = () =>
    f.send(1, { command: "companion-dismiss", targetId: npc });
  await expect(leave()).rejects.toMatchObject({ code: "COMPANION_REQUIRED" });
  // 承認すれば、関係がグラフに残り、追従で一覧に出る。
  await accompany(f, npc, "一緒に来て");
  expect(await owned()).toMatchObject([{ targetId: npc, mode: "follow" }]);
  expect(await ctx().marked(npc, "status", "companion")).toHaveLength(1);
  expect(f.calls).not.toHaveBeenCalled();
  // NPC本人が関係を終えると、一覧とグラフから消える。
  await leave();
  expect(await owned()).toEqual([]);
  expect(await ctx().marked(npc, "status", "companion")).toEqual([]);
});

test("CLIのcompanionは操作ごとに対象と場所を送り、一覧を返す", async () => {
  const f = await fixture(),
    db = isolated.databases.postgres,
    npc = f.actors[1]!;
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  const cli = await playerCli(app);
  const run = (...args: string[]) =>
    cli.run(join(cli.directory, "companion.json"), ...args);
  try {
    const connection = await run(
      "connect",
      "--server",
      cli.base,
      "--world",
      f.world,
    );
    await cli.approve(
      f.people[0]!.cookie,
      connection.userCode,
      `actor:${f.actors[0]}`,
    );
    await db.query(
      "INSERT INTO bot_npc(world_id,actor_id,controller,user_id,assignment_id) VALUES($1,$2,'bot',$3,$4)",
      [f.world, npc, f.people[1]!.id, randomUUID()],
    );
    await db.query(
      "INSERT INTO bot_companion(world_id,npc_id,actor_id) VALUES($1,$2,$3)",
      [f.world, npc, f.actors[0]],
    );
    expect(await run("companion", "status")).toMatchObject({
      result: { companions: [{ name: "人物1", mode: "follow" }] },
    });
    await run("companion", "wait", "--target", npc);
    expect(
      await run("companion", "home", "--target", npc, "--place", f.place),
    ).toMatchObject({
      result: {
        companions: [
          {
            name: "人物1",
            mode: "wait",
            homeId: expect.stringMatching(/^@[a-f0-9]+$/),
          },
        ],
      },
    });
  } finally {
    await cli.close();
    await app.close();
  }
});

type PlayFixture = Awaited<ReturnType<typeof fixture>>;

async function companionFixture() {
  const f = await fixture();
  const [owner, npc, friend] = f.actors as [string, string, string];
  await setNpc(f, 1, "bot");
  await f.send(1, { command: "contact", targetId: owner });
  const request = (targetId: string) => accompany(f, targetId, "一緒に歩こう");
  await request(npc);
  const mode = (command: "follow" | "wait") =>
    f.send(0, { command: "companion-" + command, targetId: npc });
  const status = () => f.send(0, { command: "companion-status" });
  const at = (who: string) => directPlaces(f.store.context(f.graph), who);
  const session = async (i: number) => (await f.status(i)).sessionId;
  return { f, owner, npc, friend, request, mode, status, at, session };
}

async function heard(
  f: PlayFixture,
  speaker: number,
  text: string,
  listeners: number[],
) {
  const requestId = randomUUID();
  const speech = { command: "say", requestId, text };
  const result = await f.send(speaker, speech);
  expect(await f.send(speaker, speech)).toEqual(result);
  const edges = await f.store
    .context(f.graph)
    .relations(
      derivedId(requestId + ":speech"),
      "see",
      "in",
      Number.MAX_SAFE_INTEGER,
    );
  expect(edges.map((edge) => edge.source).sort()).toEqual(
    listeners.map((i) => f.actors[i]).sort(),
  );
}

async function recorded(f: PlayFixture, text: string, listeners: number[]) {
  for (const i of [0, 1, 2]) {
    const entries = (await f.status(i)).entries.flatMap(
      (row: { payload: { entries?: { input: string }[] } }) =>
        row.payload.entries ?? [],
    );
    expect(
      entries.filter((entry: { input: string }) => entry.input === text),
    ).toHaveLength(listeners.includes(i) ? 1 : 0);
  }
}

test.each(["接触", "チーム到着"])(
  "追従したまま%sし、合流後の発言だけを観測し記録する",
  async (how) => {
    const { f, owner, npc, friend, at, session } = await companionFixture();
    if (how === "接触") await f.move(2, f.place);
    await heard(f, 2, "旗が青に変わった", [2]);
    if (how === "接触") {
      await f.send(0, { command: "contact", targetId: friend });
    } else {
      const teamId = randomUUID();
      await f.send(2, {
        command: "team-invite",
        requestId: teamId,
        targetId: owner,
      });
      await f.send(0, { command: "team-join", teamId });
      await f.send(0, locate(owner, f.far));
    }
    expect(await session(1)).toBe(await session(2));
    expect(await session(0)).toBe(await session(2));
    await heard(f, 2, "次の船が来た", [0, 1, 2]);
    await f.send(2, { command: "end-turn" });
    await recorded(f, "旗が青に変わった", [2]);
    await recorded(f, "次の船が来た", [0, 1, 2]);
    await giveTurn(f, 0);
    const destination = how === "接触" ? f.far : f.place;
    await f.send(0, locate(owner, destination));
    expect(await at(npc)).toEqual([destination]);
    expect(await session(0)).toBe(await session(1));
  },
);

test.each(["本人の提案", "仲間の提案", "承認前に待機", "本人が却下"])(
  "一括移動の確定時に承認と追従を照合する（%s）",
  async (how) => {
    const { f, owner, npc, friend, mode, at, session } =
      await companionFixture();
    await f.move(2, f.place);
    await f.send(2, { command: "contact", targetId: owner });
    const proposer = how === "仲間の提案" || how === "本人が却下" ? 2 : 0;
    await giveTurn(f, proposer);
    const move = await f.send(proposer, {
      command: "update",
      text: "一緒に出発",
      dependencies: [],
      operations: [owner, friend].flatMap(
        (actor) => locate(actor, f.far).operations,
      ),
    });
    expect(move.state).toBe("receiving");
    if (how === "承認前に待機") await mode("wait");
    const receipt = {
      command: "receive",
      requestId: randomUUID(),
      applicationId: move.applicationId,
      accept: how !== "本人が却下",
    };
    const result = await f.send(2 - proposer, receipt);
    expect(result.application).toMatchObject({ state: "confirmed" });
    expect(await f.send(2 - proposer, receipt)).toEqual(result);
    const accompanied = how !== "承認前に待機";
    expect(await at(owner)).toEqual([how === "本人が却下" ? f.place : f.far]);
    expect(await at(npc)).toEqual([
      accompanied && how !== "本人が却下" ? f.far : f.place,
    ]);
    expect((await session(1)) === (await session(0))).toBe(accompanied);
  },
);

test("帰還・呼び戻し・追従再開で、その時に聞けた発言だけが各人の履歴に一度ずつ残る", async () => {
  const { f, owner, npc, friend, mode, status, at, session } =
    await companionFixture();
  await heard(f, 0, "出発前の相談", [0, 1]);
  // 更新前から続く手番でも、退出者の聞いた発言はグラフから復元できる。
  await isolated.databases.postgres.query(
    "UPDATE bot_session SET data=data #- '{entries,0,speechWitnesses}' WHERE id=$1",
    [await session(0)],
  );
  await f.send(0, { command: "companion-home", targetId: npc, placeId: f.far });
  await f.send(0, { command: "companion-return", targetId: npc });
  expect(await session(1)).not.toBe(await session(0));
  expect(await status()).toMatchObject({
    companions: [{ mode: "wait", placeId: f.far }],
  });
  await expect(mode("follow")).rejects.toMatchObject({
    code: "COMPANION_NOT_HERE",
  });
  await heard(f, 0, "帰還後の相談", [0]);
  await f.send(0, { command: "end-turn" });
  await recorded(f, "出発前の相談", [0, 1]);
  await recorded(f, "帰還後の相談", [0]);
  await f.send(2, { command: "contact", targetId: npc });
  await giveTurn(f, 2);
  await heard(f, 2, "呼び戻し前の知らせ", [1, 2]);
  await f.send(0, {
    command: "companion-move",
    targetId: npc,
    placeId: f.place,
  });
  await heard(f, 2, "呼び戻し後の知らせ", [2]);
  await f.send(2, { command: "end-turn" });
  await recorded(f, "呼び戻し前の知らせ", [1, 2]);
  await recorded(f, "呼び戻し後の知らせ", [2]);
  expect(await at(friend)).toEqual([f.far]);
  await mode("follow");
  expect(await session(1)).toBe(await session(0));
  await heard(f, 0, "ふたりで出発", [0, 1]);
  await f.send(0, locate(owner, f.far));
  expect(await at(npc)).toEqual([f.far]);
  await f.send(0, { command: "end-turn" });
  await recorded(f, "ふたりで出発", [0, 1]);
});

test("二人目を迎えた後も、待受の再接続とシーンの終了・再開を経て全員で同行する", async () => {
  const { f, owner, npc, friend, request, at, session } =
    await companionFixture();
  await setNpc(f, 2, "bot");
  await f.move(2, f.place);
  await f.send(0, { command: "contact", targetId: friend });
  await giveTurn(f, 0);
  await request(friend);
  const user = f.people[0]!.id;
  for (const active of [false, true])
    await access.waiting(user, f.world, owner, "human:" + user, active);
  expect(await session(0)).toBe(await session(1));
  expect(await session(0)).toBe(await session(2));
  const oldScene = (await f.status(1)).sceneId;
  await f.send(0, { command: "finish" });
  await f.send(0, { command: "start" });
  expect((await f.status(1)).sceneId).toBe(oldScene);
  await giveTurn(f, 0);
  await f.send(0, locate(owner, f.far));
  for (const i of [1, 2]) expect(await session(i)).toBe(await session(0));
  expect(await at(npc)).toEqual([f.far]);
  expect(await at(friend)).toEqual([f.far]);
});

test.each(["普通の乗り物", "乗り物のNPC", "乗客が残るNPC"])(
  "乗降と運行の後の所在・同席・モードを照合する（%s）",
  async (kind) => {
    const { f, owner, npc, status, at, session } = await companionFixture();
    const vehicleId =
      kind === "普通の乗り物"
        ? await vehicleFixture(f)
        : await vehicleFixture(f, { npcId: npc });
    if (vehicleId !== npc)
      await f.send(0, { command: "vehicle-request-control", vehicleId });
    await f.send(0, { command: "vehicle-board", vehicleId });
    if (kind === "乗客が残るNPC") {
      await f.move(2, f.place);
      await f.send(2, { command: "vehicle-board", vehicleId });
      await f.send(2, { command: "contact", targetId: owner });
    }
    if (vehicleId === npc)
      await f.send(0, {
        command: "companion-move",
        targetId: npc,
        placeId: f.far,
      });
    else
      await f.send(0, {
        command: "vehicle-travel",
        vehicleId,
        destinationId: f.far,
      });
    expect(await at(vehicleId)).toEqual([f.far]);
    expect(await session(0)).toBe(await session(1));
    expect(await status()).toMatchObject({ companions: [{ mode: "follow" }] });
    await f.send(0, { command: "vehicle-leave", vehicleId });
    expect(await status()).toMatchObject({ companions: [{ mode: "follow" }] });
    expect(await session(0)).toBe(await session(1));
    await giveTurn(f, 0);
    await f.send(0, locate(owner, f.place));
    expect(await at(npc)).toEqual([f.place]);
  },
);

test("待機をNPC自身が読み、現地で話せるが自分からは出発しない", async () => {
  const { f, owner, npc, at, mode } = await companionFixture();
  await f.move(2, f.place);
  await f.send(2, { command: "contact", targetId: owner });
  await mode("wait");
  await f.send(0, locate(owner, f.far));
  await giveTurn(f, 1);
  await giveTurn(f, 2);
  const invited = await f.send(2, locate(npc, f.far));
  await expect(
    f.send(1, {
      command: "receive",
      applicationId: invited.applicationId,
      accept: true,
    }),
  ).rejects.toMatchObject({ code: "COMPANION_WAITING" });
  await f.send(1, {
    command: "receive",
    applicationId: invited.applicationId,
    accept: false,
  });
  await giveTurn(f, 1);
  const self = await f.send(1, { command: "search", query: { kind: "self" } });
  expect(self.material).toMatchObject({
    companion: { ownerId: owner, mode: "wait" },
  });
  await heard(f, 1, "ここで待つよ", [1, 2]);
  await expect(f.send(1, locate(npc, f.far))).rejects.toMatchObject({
    code: "COMPANION_WAITING",
  });
  await auth.operations.execute(
    (await auth.person()).id,
    randomUUID(),
    {
      operation: "npcs.put",
      worldId: f.world,
      actorId: npc,
      controller: "server",
      reason: "隔離試験の担当を切り替える",
    },
    { players: access.players },
  );
  f.calls.mockImplementation(async (id, role, messages) => {
    expect(role).toBe("world-server-npc");
    expect(
      JSON.parse(String(messages[1]!.content)).self.material.companion.mode,
    ).toBe("wait");
    const { text, operations, dependencies } = locate(npc, f.far);
    return answer(id, {
      command: "apply",
      expectedSp: 0,
      action: { type: "direct", text, operations },
      dependencies,
    });
  });
  await access.botPlay.tickNpcs(f.world);
  expect(await at(npc)).toEqual([f.place]);
  expect((await f.status(2)).actorId).toBe(f.actors[2]);
  await recorded(f, "ここで待つよ", [1, 2]);
});

test.each(["本人の移動", "同席者の提案を承認"])(
  "通常プレイヤーの到着直後の発言は出発地へ届かない（%s）",
  async (how) => {
    const f = await fixture();
    const traveler = f.actors[0]!;
    await f.send(1, { command: "contact", targetId: traveler });
    if (how === "本人の移動") {
      await f.send(0, locate(traveler, f.far));
    } else {
      await giveTurn(f, 1);
      const move = await f.send(1, locate(traveler, f.far));
      await f.send(0, {
        command: "receive",
        applicationId: move.applicationId,
        accept: true,
      });
    }
    expect((await f.status(0)).sessionId).not.toBe(
      (await f.status(1)).sessionId,
    );
    await heard(f, 0, "次の渡しは東岸から出る", [0]);
    await f.send(0, { command: "end-turn" });
    await recorded(f, "次の渡しは東岸から出る", [0]);
  },
);

test.each(["接触", "チーム加入"])(
  "通常プレイヤーの途中参加では発言時の観測と履歴が一致する（%s）",
  async (how) => {
    const f = await fixture();
    await heard(f, 0, "旗が青に変わった", [0]);
    if (how === "接触")
      await f.send(1, { command: "contact", targetId: f.actors[0] });
    else {
      const teamId = randomUUID();
      await f.send(0, {
        command: "team-invite",
        targetId: f.actors[1],
        requestId: teamId,
      });
      await f.send(1, { command: "team-join", teamId });
    }
    await heard(f, 0, "鐘が二つ鳴った", [0, 1]);
    await f.send(0, { command: "end-turn" });
    await recorded(f, "旗が青に変わった", [0]);
    await recorded(f, "鐘が二つ鳴った", [0, 1]);
  },
);

test("同行判断に同じ手番ですでに相手が聞いた発言を渡す", async () => {
  const f = await fixture();
  const [owner, npc] = f.actors as [string, string, string];
  await setNpc(f, 1, "bot");
  await heard(f, 0, "会う前のひとり言", [0]);
  await f.send(1, { command: "contact", targetId: owner });
  await heard(f, 0, "橋で荷札を渡します", [0, 1]);
  f.calls.mockImplementation(async (id, role, messages) => {
    expect(role).toBe("world-companion");
    const material = JSON.parse(String(messages[1]!.content));
    expect(material.currentSpeech).toEqual([
      { actorId: owner, text: "橋で荷札を渡します" },
    ]);
    return answer(id, { accepted: true, reason: "渡し場へ同行する" });
  });
  await f.send(0, {
    command: "companion-request",
    targetId: npc,
    text: "一緒に来て",
  });
});

test("旧版で別の会話に残った追従は現地で再合流し、遠方なら待機になる", async () => {
  const f = await fixture();
  const [owner, near, far] = f.actors as [string, string, string];
  for (const i of [1, 2]) await setNpc(f, i, "bot");
  await isolated.databases.postgres.query(
    "INSERT INTO bot_companion(world_id,npc_id,actor_id) VALUES ($1,$2,$4),($1,$3,$4)",
    [f.world, near, far, owner],
  );
  await heard(f, 0, "船が着いたよ", [0, 1]);
  const result = await f.send(0, { command: "companion-status" });
  expect(result.companions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ targetId: near, mode: "follow" }),
      expect.objectContaining({ targetId: far, mode: "wait" }),
    ]),
  );
  await f.send(0, { command: "end-turn" });
  await recorded(f, "船が着いたよ", [0, 1]);
});

test("追従の再開・シーンの再開で同席者の受領判断を取り消さない", async () => {
  const { f, owner, npc, mode, session } = await companionFixture();
  await mode("wait");
  await f.move(2, f.place);
  await f.send(2, { command: "contact", targetId: owner });
  await f.send(0, { command: "leave" });
  await giveTurn(f, 2);
  const propose = () =>
    f.send(2, {
      command: "memo",
      text: "港で会おう",
      participants: [npc],
      dependencies: [],
    });
  const pending = await propose();
  await expect(mode("follow")).rejects.toMatchObject({
    code: "COMPANION_RECEIVING",
  });
  expect((await f.status(1)).receiving?.applicationId).toBe(
    pending.applicationId,
  );
  await f.send(1, {
    command: "receive",
    applicationId: pending.applicationId,
    accept: true,
  });
  await mode("follow");
  expect(await session(0)).toBe(await session(1));
  await giveTurn(f, 2);
  await f.send(2, { command: "contact", targetId: owner });
  await f.send(0, { command: "finish" });
  await giveTurn(f, 2);
  const ongoing = await propose();
  const anchor = await session(2);
  await f.send(0, { command: "start" });
  expect(await session(0)).toBe(anchor);
  expect((await f.status(1)).receiving?.applicationId).toBe(
    ongoing.applicationId,
  );
  await f.send(1, {
    command: "receive",
    applicationId: ongoing.applicationId,
    accept: true,
  });
});

test("サーバー担当NPCは断られた選択を問い直さず、受領判断中は返答と一度のコメントだけを選べる", async () => {
  const f = await fixture();
  const npc = f.actors[1]!;
  await f.send(0, { command: "contact", targetId: npc });
  await giveTurn(f, 1);
  await auth.operations.execute(
    (await auth.person()).id,
    randomUUID(),
    {
      operation: "npcs.put",
      worldId: f.world,
      actorId: npc,
      controller: "server",
      reason: "隔離試験の担当を切り替える",
    },
    { players: access.players },
  );
  const offered: string[][] = [];
  const choose = (...choices: object[]) =>
    f.calls.mockImplementation(async (id, _role, messages) => {
      const schema = JSON.parse(String(messages[1]!.content)).commandSchema;
      offered.push(
        schema.anyOf.map(
          (o: { properties: { command: { const: string } } }) =>
            o.properties.command.const,
        ),
      );
      return answer(id, choices[offered.length - 1]);
    });
  choose({ command: "vehicle-board", vehicleId: randomUUID() });
  await access.botPlay.tickNpcs(f.world);
  await access.botPlay.tickNpcs(f.world);
  expect(offered).toHaveLength(1);
  expect((await f.status(0)).actorId).not.toBe(npc);

  await giveTurn(f, 0);
  const invited = await f.send(0, locate(npc, f.far));
  offered.length = 0;
  choose(
    { command: "comment", text: "少し考える" },
    { command: "receive", applicationId: invited.applicationId, accept: true },
  );
  await access.botPlay.tickNpcs(f.world);
  await access.botPlay.tickNpcs(f.world);
  expect(offered).toEqual([["receive", "comment"], ["receive"]]);
  expect(await directPlaces(f.store.context(f.graph), npc)).toEqual([f.far]);
});

test("失敗した判定はファンブルを一度だけ振り、本人に残った状態は期限まで続いて早めに終えられる", async () => {
  const f = await fixture(2);
  const [actor, target] = f.actors as [string, string];
  const most = sure.successThrough;
  // 生成を終えた世界では、記録の時点が現実の時刻になる。
  await isolated.databases.postgres.query(
    "UPDATE world_construction SET state='finished' WHERE id=$1",
    [f.world],
  );
  const states = async (i: number) => {
    const context = f.store.context(f.graph);
    return Promise.all(
      (
        await context.relations(
          f.actors[i]!,
          "status",
          "out",
          Date.now(),
          Number.MAX_SAFE_INTEGER,
        )
      )
        .filter((e) => e.role === "content" && e.text !== "location")
        .map(async (e) => ({
          id: e.id,
          period: e.period,
          text: (await context.node(e.target))?.text,
        })),
    );
  };
  const self = async () =>
    (
      (await f.send(0, { command: "search", query: { kind: "self" } }))
        .material as { states: { relation: { id: string } }[] }
    ).states.map((s) => s.relation.id);
  const craft = () => ({
    requestId: randomUUID(),
    command: "update",
    text: "刃こぼれした鉈で薪を急いで割る",
    operations: [
      { type: "create", label: "薪", holder: actor, basis: "割った" },
    ],
    dependencies: [],
  });
  const cut = { through: 30, text: "右手に浅い切り傷がある。", minutes: 60 };
  // GMが返したファンブルは、成功ダイスが失敗したときだけ振る。出目が範囲内なら本人の状態になる。
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    expect(messages[0]!.content).toContain("fumble:{through");
    return answer(id, {
      sides: sure.sides,
      successThrough: 1,
      fumble: { ...cut, through: most },
    });
  });
  const first = craft(),
    slipped = await f.send(0, first);
  expect(slipped.outcome).toMatchObject({
    success: false,
    fumble: { success: true },
    setting: { fumble: { text: cut.text, minutes: 60 } },
  });
  expect(await f.send(0, first)).toEqual(slipped);
  const [wound] = await states(0);
  expect(await states(0)).toHaveLength(1);
  expect(wound).toMatchObject({ text: cut.text });
  expect(wound!.period.until! - wound!.period.from).toBe(3600000);
  // 2回目の出目が範囲を超えれば残らない。成功した判定では2回目を振らない。
  const missed = craft(),
    die = derivedId(`${missed.requestId}:creation`);
  await isolated.databases.postgres.query(
    "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,50),($3,$4,31)",
    [
      die,
      { sides: 100, successThrough: 10, fumble: cut },
      derivedId(`${die}:fumble`),
      { sides: 100, successThrough: 30 },
    ],
  );
  expect((await f.send(0, missed)).outcome).toMatchObject({
    success: false,
    roll: 50,
    fumble: { roll: 31, success: false },
  });
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { ...sure, fumble: { ...cut, through: most } }),
  );
  const made = await f.send(0, craft());
  expect(made.outcome).toMatchObject({ success: true });
  expect(made.outcome).not.toHaveProperty("fumble");
  // 振らなかったファンブルの設定は、起きたように読めないよう結果に載せない。
  expect(made.outcome).not.toHaveProperty("setting.fumble");
  expect(await states(0)).toHaveLength(1);
  // 期限の前は本人の状態として読め、期限を過ぎると現在の状態から外れる。
  let now = new Date(wound!.period.until! - 1);
  const clock = vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
  expect(await self()).toContain(wound!.id);
  now = new Date(wound!.period.until!);
  expect(await self()).not.toContain(wound!.id);
  clock.mockRestore();
  // 期限の前に、本人が終了を申請できる。
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    expect(messages[1]!.content).toContain(wound!.id);
    return answer(id, { ...sure, endEdges: [wound!.id] });
  });
  const healed = await f.send(0, {
    command: "update",
    text: "傷口を洗って布で縛り、手当てを終える",
    changes: { nodes: [], revisions: [], edges: [], endEdges: [wound!.id] },
    dependencies: [],
  });
  expect(healed.outcome).toMatchObject({ success: true });
  expect(await states(0)).toEqual([]);
  expect(
    (await f.store.context(f.graph).edge(wound!.id))?.period.until,
  ).toBeLessThan(wound!.period.until!);
  // 対抗の判定でも、失敗した本人にだけ残る。成功時に相手へ残る状態には期限を付けられる。
  await f.send(1, { command: "contact", targetId: actor });
  const shove = () => ({
    requestId: randomUUID(),
    command: "oppose",
    text: "相手に体当たりして突き飛ばす",
    changes: {
      nodes: [],
      revisions: [],
      endEdges: [],
      edges: [
        {
          id: randomUUID(),
          kind: "effect",
          source: actor,
          target,
          period: { from: 0 },
        },
      ],
    },
    dependencies: [],
  });
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-opposition-dice");
    expect(messages[0]!.content).toContain("fumble:{through");
    return answer(id, {
      sides: sure.sides,
      successThrough: 1,
      fumble: { through: most, text: "足首をひねっている。" },
    });
  });
  expect((await f.send(0, shove())).outcome).toMatchObject({
    success: false,
    fumble: { success: true },
  });
  const [sprain] = await states(0);
  expect(sprain).toMatchObject({ text: "足首をひねっている。" });
  expect(sprain!.period.until).toBeUndefined();
  expect(await states(1)).toEqual([]);
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, {
      ...sure,
      fumble: { through: most, text: "足首をひねっている。" },
      states: [{ id: target, text: "尻もちをついている。", minutes: 5 }],
    }),
  );
  const pushed = (await f.send(0, shove())).outcome;
  expect(pushed).toMatchObject({ success: true });
  expect(pushed).not.toHaveProperty("setting.fumble");
  const [down] = await states(1);
  expect(down).toMatchObject({ text: "尻もちをついている。" });
  expect(down!.period.until! - down!.period.from).toBe(300000);
});

test("登録済みの人物に起きることを名指しする作成は、本人を参照しない限り判定の後で断る", async () => {
  const f = await fixture();
  const [actor, present] = f.actors as [string, string, string];
  const items = async (id: string) =>
    (await readBelongings(f.store.context(f.graph), id)).items;
  const named = (individuals: string[], basis?: string) =>
    f.calls.mockImplementationOnce(async (id, role, messages) => {
      expect(role).toBe("world-creation-dice");
      expect(messages[0]!.content).toContain("individuals:[");
      if (basis) {
        expect(messages[0]!.content).toContain("申請の根拠");
        expect(messages[0]!.content).toContain(
          "本人の身体に由来しない別の装備",
        );
        expect(
          JSON.parse(String(messages[1]!.content)).changes.edges,
        ).toContainEqual(expect.objectContaining({ kind: "has", text: basis }));
      }
      return answer(id, { ...sure, individuals });
    });
  const create = (
    label: string,
    basis = "検証",
    text = `${label}を手に入れる`,
  ) => ({
    requestId: randomUUID(),
    command: "apply",
    expectedSp: 1,
    action: {
      type: "generate",
      plans: [
        { text, operation: { type: "create", label, holder: actor, basis } },
      ],
    },
    dependencies: [],
  });
  const refused = { code: "PERSON_REFERENCE_REQUIRED" };
  const remaining = (await f.status(0)).dailySp.remaining;
  // 離れた場所にいる人物を呼称の一部で名指しすると、ダイスを振らず、何も作らず、通常枠も使わない。
  const corpse = create("倒れた人物2");
  named(["物2"]);
  await expect(f.send(0, corpse)).rejects.toMatchObject({
    ...refused,
    message: expect.stringMatching(/「人物2」.+applyのoppose/),
  });
  // 同じ要求の再送は同じ呼び出しになり、同じ結果を返す。
  named(["物2"]);
  await expect(f.send(0, corpse)).rejects.toMatchObject(refused);
  expect(f.calls.mock.calls[1]![0]).toBe(f.calls.mock.calls[0]![0]);
  // 物品名や行為に人物名がなくても、根拠が本人の身体に付いた義手を指す場合は断る。
  const arm = "銀色の義手";
  const attachedBasis = "人物2の腕として装着されていた義手を外したもの";
  const attached = create(arm, attachedBasis);
  named(["物2"], attachedBasis);
  await expect(f.send(0, attached)).rejects.toMatchObject(refused);
  expect(await items(actor)).toEqual([]);
  expect(await f.status(0)).toMatchObject({
    callsUsed: 0,
    dailySp: { remaining },
  });
  expect(
    (
      await isolated.databases.postgres.query(
        "SELECT 1 FROM bot_dice WHERE id=ANY($1::uuid[])",
        [
          [corpse, attached].map(({ requestId }) =>
            derivedId(`${requestId}:creation`),
          ),
        ],
      )
    ).rowCount,
  ).toBe(0);
  // 人物と同じ名前の個体を登場させる発言は、GMが名指しと判断しなくても断る。
  named([]);
  await expect(
    f.send(0, {
      command: "say",
      text: "人物2が現れる",
      instantNpcs: ["人物2"],
    }),
  ).rejects.toMatchObject(refused);
  // 人物の呼称に一致しない名前と申請者本人は、これまでどおりダイスへ進む。
  named(["森の主", "人物0"]);
  const made = await f.send(0, create("森の主の牙"));
  expect(made.outcome).toMatchObject({ success: true });
  expect(JSON.stringify(made.outcome)).not.toContain("individuals");
  expect((await items(actor)).map((i) => i.label)).toEqual(["森の主の牙"]);
  const equipmentBasis = "人物2の義手に似せて、工房で別に作った予備の装備";
  for (const label of [arm, "人物2"]) {
    named([], equipmentBasis);
    await expect(
      f.send(0, create(label, equipmentBasis)),
    ).resolves.toMatchObject({ outcome: { success: true } });
  }
  expect((await items(actor)).map((i) => i.label)).toEqual(
    expect.arrayContaining([arm, "人物2"]),
  );
  // 申請が参照している同席者は、名指しされても断らない。
  await f.send(1, { command: "contact", targetId: actor });
  await f.apply([
    { type: "create", label: "硬貨", holder: present, basis: "検証" },
  ]);
  const coin = (await items(present))[0]!.id;
  f.calls.mockImplementation(async (id, role) =>
    answer(
      id,
      role === "world-creation-dice"
        ? { ...sure, individuals: ["人物1"] }
        : sure,
    ),
  );
  expect(
    (
      await f.send(0, {
        command: "oppose",
        text: "人物1を突き飛ばして硬貨を奪い、落ちた切れ端を拾う",
        dependencies: [],
        operations: [
          { type: "move", item: coin, from: present, to: actor, basis: "奪う" },
          { type: "create", label: "切れ端", holder: actor, basis: "拾う" },
        ],
      })
    ).outcome,
  ).toMatchObject({ success: true });
});

test("場所の物が判定で外れると、GMが選んだ場所の説明を終えて物の無い説明に置き換える", async () => {
  const f = await fixture(1),
    actor = f.actors[0]!;
  const seed: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  const [anvil, tongs] = [randomUUID(), randomUUID()];
  for (const [id, text] of [
    [anvil, "古い金床"],
    [tongs, "古い火ばさみ"],
  ] as const) {
    seed.nodes.push({ id, kind: "existence", text });
    seed.edges.push({
      id: randomUUID(),
      kind: "has",
      source: f.place,
      target: id,
      period: { from: 0 },
    });
  }
  mark(seed, f.place, "石積みの炉と古い金床と火ばさみがある");
  const first = seed.edges[2]!.id;
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    { commitId: randomUUID(), at: 0, changes: seed },
  );
  const texts = async () => {
    const context = f.store.context(f.graph);
    return (
      await Promise.all(
        (
          await context.relations(
            f.place,
            "status",
            "out",
            Number.MAX_SAFE_INTEGER,
          )
        ).map((e) => context.node(e.target)),
      )
    ).map((n) => n?.text);
  };
  // 作成の判定で場所の物を材料に使い切ると、GMが選んだ説明を置き換える。
  const second = "石積みの炉と古い火ばさみがある。";
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-creation-dice");
    expect(messages[0]!.content).toContain("placeStates");
    expect(messages[1]!.content).toContain(first);
    return answer(id, {
      ...sure,
      requiredMaterials: [{ id: anvil }],
      placeStates: [{ relationId: first, text: second }],
    });
  });
  const melted = await f.send(0, {
    command: "apply",
    expectedSp: 1,
    action: {
      type: "generate",
      plans: [
        {
          text: "古い金床を溶かして鉄の延べ棒にする",
          operation: {
            type: "create",
            label: "鉄の延べ棒",
            holder: actor,
            basis: "金床を溶かした",
          },
        },
      ],
    },
    dependencies: [],
  });
  expect(melted.outcome).toMatchObject({ success: true });
  expect(await texts()).toContain(second);
  expect(await texts()).not.toContain("石積みの炉と古い金床と火ばさみがある");
  // 対抗行動で場所の物を取り除いたときも、同じく置き換える。
  const context = f.store.context(f.graph);
  let replaced = "";
  for (const e of await context.relations(
    f.place,
    "status",
    "out",
    Number.MAX_SAFE_INTEGER,
  ))
    if ((await context.node(e.target))?.text === second) replaced = e.id;
  const rest = "石積みの炉が残っている。";
  const removal = (placeId = f.place) => ({
    requestId: randomUUID(),
    command: "apply",
    expectedSp: 0,
    action: {
      type: "remove-place-item",
      text: "古い火ばさみを踏み砕く",
      placeId,
      itemId: tongs,
    },
    dependencies: [],
  });
  const registration = { person: actor, storage: f.place };
  await expect(f.send(0, removal(f.far))).rejects.toMatchObject({
    code: "PLACE_ITEM_REQUIRED",
  });
  await f.apply([{ type: "grant", ...registration, basis: "保管先" }]);
  await expect(f.send(0, removal())).rejects.toMatchObject({
    code: "PLACE_ITEM_REQUIRED",
  });
  await f.apply([{ type: "revoke", ...registration }]);
  expect(f.calls).toHaveBeenCalledTimes(1);

  f.calls.mockImplementation(async (id, role, messages) => {
    expect(role).toBe("world-opposition-dice");
    expect(messages[0]!.content).toContain("placeStates");
    expect(messages[1]!.content).toContain(replaced);
    return answer(id, {
      ...sure,
      placeStates: [{ relationId: replaced, text: rest }],
    });
  });
  const failed = removal();
  await isolated.databases.postgres.query(
    "INSERT INTO bot_dice(id,setting,roll) VALUES($1,$2,100)",
    [
      failed.requestId,
      {
        sides: 100,
        successThrough: 50,
        placeStates: [{ relationId: replaced, text: rest }],
      },
    ],
  );
  expect(await f.send(0, failed)).toMatchObject({
    outcome: { success: false },
    spentSp: 0,
  });
  expect(await f.store.context(f.graph).holding(tongs)).toMatchObject({
    source: f.place,
  });
  expect(await texts()).toContain(second);
  expect(await texts()).not.toContain(rest);

  const request = removal();
  const smash = await f.send(0, request);
  expect(smash).toMatchObject({
    outcome: { success: true },
    spentSp: 0,
  });
  expect(await f.store.context(f.graph).holding(tongs)).toBeUndefined();
  expect(await texts()).toContain(rest);
  expect(await texts()).not.toContain(second);
  expect(await f.send(0, request)).toEqual(smash);
  expect(f.calls).toHaveBeenCalledTimes(3);
});

test("判定で付いた損傷のある乗り物は、GMが動けないと判断すれば運行できず、同行でも付いてこない", async () => {
  const f = await fixture();
  const [vehicleId, rider] = f.actors as [string, string];
  await vehicleFixture(f, { npcId: vehicleId });
  const at = (id: string) => directPlaces(f.store.context(f.graph), id);
  // 損傷のない乗り物の移動では、GMに尋ねない。
  await f.send(0, locate(vehicleId, f.far));
  await f.send(0, locate(vehicleId, f.place));
  expect(f.calls).not.toHaveBeenCalled();
  const damage: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  const broken = randomUUID();
  damage.nodes.push({ id: broken, kind: "script", text: "車輪が砕けている。" });
  damage.edges.push({
    id: randomUUID(),
    kind: "status",
    role: "content",
    text: "judged",
    source: vehicleId,
    target: broken,
    period: { from: 0 },
  });
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    { commitId: randomUUID(), at: 0, changes: damage },
  );
  let movable = false;
  f.calls.mockImplementation(async (id, role, messages) => {
    if (role !== "world-vehicle-condition") return answer(id, sure);
    expect(String(messages[1]!.content)).toContain("車輪が砕けている。");
    return answer(id, { movable, reason: "車輪が砕けている" });
  });
  await expect(f.send(0, locate(vehicleId, f.far))).rejects.toMatchObject({
    code: "VEHICLE_DISABLED",
  });
  expect(await at(vehicleId)).toEqual([f.place]);
  // 同行している乗り物（サーバー担当のNPC）は、動けると判断されれば追従し、動けなければその場に残る。
  await setNpc(f, 0, "server");
  await isolated.databases.postgres.query(
    "UPDATE app_user SET role='admin' WHERE id=$1",
    [f.people[0]!.id],
  );
  await f.send(0, { command: "contact", targetId: rider });
  await isolated.databases.postgres.query(
    "INSERT INTO bot_companion(world_id,npc_id,actor_id) VALUES($1,$2,$3)",
    [f.world, vehicleId, rider],
  );
  movable = true;
  await f.send(1, locate(rider, f.far));
  expect(await at(vehicleId)).toEqual([f.far]);
  movable = false;
  await f.send(1, locate(rider, f.place));
  expect(await at(rider)).toEqual([f.place]);
  expect(await at(vehicleId)).toEqual([f.far]);
});

test("探索は接続元からつながる既知の場所を判定に渡し、同じ場所なら作らず、つながる場所へは行き来も作る", async () => {
  const f = await fixture(1);
  const explore = (label: string, requestId = randomUUID()) => ({
    requestId,
    command: "explore",
    text: `${label}へ続く道がある`,
    label,
    fromId: f.place,
    dependencies: [],
  });
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { sides: 100, successThrough: 100, explored }),
  );
  const yard = (await f.send(0, explore("広場の裏庭"))).placeId as string;
  // 既知の隣の場所と同じなら、ダイスを振らず、場所を作らずに先にある場所のIDを返す。
  const same = explore("広場の裏の空き地");
  f.calls.mockImplementationOnce(async (id, _role, messages) => {
    const input = JSON.parse(String(messages[1]!.content));
    expect(input.neighbors).toContainEqual({ id: yard, label: "広場の裏庭" });
    expect(messages[0]!.content).toContain("sameAs");
    return answer(id, {
      sides: 100,
      successThrough: 100,
      explored: { ...explored, sameAs: yard },
    });
  });
  const used = (await f.status(0)).callsUsed;
  await expect(f.send(0, same)).rejects.toMatchObject({
    code: "EXPLORE_SAME_PLACE",
    message: expect.stringContaining(yard),
  });
  expect(
    await f.store.context(f.graph).node(derivedId(`${same.requestId}:place`)),
  ).toBeUndefined();
  expect((await f.status(0)).callsUsed).toBe(used);
  // 別の場所なら作り、GMが選んだ既知の場所へも行き来を張る。
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, {
      sides: 100,
      successThrough: 100,
      explored: {
        ...explored,
        sameAs: null,
        // 同じ場所を重ねて返しても、行き来は一つだけ作る。
        connects: [
          { id: yard, route: "物置の脇の戸を抜けると、裏庭に出る。" },
          { id: yard, route: "物置の裏から裏庭へ回れる。" },
        ],
      },
    }),
  );
  const shed = (await f.send(0, explore("広場の物置"))).placeId as string;
  expect(await f.store.context(f.graph).routesBetween(shed, yard)).toHaveLength(
    1,
  );
  expect(
    await f.store.context(f.graph).routesBetween(shed, f.place),
  ).toHaveLength(1);
});

test("発声制限は原因の状態を返し、無声の行動と状態終了後の発言を受け付ける", async () => {
  const f = await fixture(1);
  const actor = f.actors[0]!;
  const requestId = randomUUID();
  const stateId = derivedId(`${derivedId(`${requestId}:state`)}:content`);
  const description = "発声器と歩行用の脚が故障している。";
  const route: Change = { nodes: [], revisions: [], edges: [], endEdges: [] };
  linkRoute(
    route,
    randomUUID(),
    0,
    [
      { id: f.place, text: "広場" },
      { id: f.far, text: "離れた場所" },
    ],
    "舗装された小道",
  );
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: route,
    },
  );
  f.calls.mockImplementationOnce(async (id) => answer(id, sure));
  await f.send(0, {
    requestId,
    command: "apply",
    expectedSp: 1,
    dependencies: [],
    action: {
      type: "state",
      targetId: actor,
      text: "発声器を使えない状態になる",
      description,
      commandRestrictions: ["say", "move"],
    },
  });
  const context = f.store.context(f.graph);
  expect(await context.edge(stateId)).toMatchObject({
    commandRestrictions: ["say", "move"],
  });
  const status = await f.status(0);
  const app = await createApp(
    access,
    auth.identity,
    undefined,
    auth.operations,
  );
  try {
    const rejected = await app.inject({
      method: "POST",
      url: `/api/worlds/${f.world}/session`,
      headers: { cookie: f.people[0]!.cookie, "x-gestaloka-request": "1" },
      payload: {
        command: "say",
        requestId: randomUUID(),
        text: "助けを呼ぶ",
        instantNpcs: ["通りがかった職人"],
      },
    });
    expect(rejected.statusCode).toBe(409);
    const body = rejected.json();
    expect(body).toMatchObject({
      code: "VOICE_RESTRICTED",
      message: expect.stringContaining(description),
      blockingStates: [
        {
          stateId,
          shortId: expect.stringMatching(/^@[0-9a-f]{8}$/),
          text: description,
        },
      ],
    });
    expect(body.message).toContain(body.blockingStates[0].shortId);

    const move = await app.inject({
      method: "POST",
      url: `/api/worlds/${f.world}/session`,
      headers: { cookie: f.people[0]!.cookie, "x-gestaloka-request": "1" },
      payload: {
        command: "apply",
        requestId: randomUUID(),
        expectedSp: 0,
        dependencies: [],
        action: {
          type: "direct",
          text: "小道へ進む",
          operations: [
            {
              type: "locate",
              subjectId: actor,
              text: "離れた場所",
              aboutIds: [f.far],
            },
          ],
        },
      },
    });
    expect(move.statusCode).toBe(409);
    expect(move.json()).toMatchObject({
      code: "MOVEMENT_BLOCKED",
      blockingStates: body.blockingStates,
    });
  } finally {
    await app.close();
  }
  expect(await f.status(0)).toMatchObject({
    callsUsed: status.callsUsed,
    dailySp: status.dailySp,
  });
  expect(f.calls).toHaveBeenCalledTimes(1);

  const gesture = randomUUID();
  await expect(
    f.send(0, {
      command: "say",
      requestId: gesture,
      mode: "nonverbal",
      text: "札に『助けて』と書いて見せる",
    }),
  ).resolves.toMatchObject({
    state: "accepted",
    mode: "nonverbal",
    spentSp: 0,
  });
  expect(
    await f.store
      .context(f.graph)
      .relations(
        derivedId(`${gesture}:speech`),
        "see",
        "in",
        Number.MAX_SAFE_INTEGER,
      ),
  ).toContainEqual(
    expect.objectContaining({
      observation: expect.objectContaining({ aspect: "身振り・筆談" }),
    }),
  );

  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: Date.now(),
      changes: { nodes: [], revisions: [], edges: [], endEdges: [stateId] },
    },
  );
  await expect(
    f.send(0, { command: "say", text: "声を出す" }),
  ).resolves.toMatchObject({ state: "accepted" });
  expect(f.calls).toHaveBeenCalledTimes(1);
});

test("運行を制限する状態は乗車時に示し、運行時にはGMを呼ばずに扱う", async () => {
  const f = await fixture(2);
  const vehicleId = await vehicleFixture(f, {
    npcId: f.actors[0]!,
    route: true,
  });
  const state = randomUUID(),
    stateId = randomUUID(),
    other = randomUUID();
  const description = "固定用の留め具で台車が止められている。";
  const until = Date.now() + 3600000;
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: 0,
      changes: {
        nodes: [
          { id: state, kind: "script", text: description, viewers: [] },
          { id: other, kind: "script", text: "台車は緑色に塗装されている。" },
        ],
        revisions: [],
        endEdges: [],
        edges: [
          {
            id: stateId,
            kind: "status",
            role: "content",
            text: "judged",
            source: vehicleId,
            target: state,
            period: { from: 0, until },
            commandRestrictions: ["vehicle-travel"],
          },
          {
            id: randomUUID(),
            kind: "status",
            role: "content",
            text: "judged",
            source: vehicleId,
            target: other,
            period: { from: 0 },
            commandRestrictions: [],
          },
        ],
      },
    },
  );
  await expect(
    f.send(1, { command: "vehicle-board", vehicleId }),
  ).resolves.toMatchObject({
    departure: "blocked",
    departureCauses: [],
  });
  const travel = { command: "vehicle-travel", vehicleId, destinationId: f.far };
  for (let i = 0; i < 2; i++) {
    await expect(f.send(0, travel)).rejects.toMatchObject({
      code: "VEHICLE_DISABLED",
      blockingStates: [{ stateId, text: description, until }],
    });
  }
  expect(
    await f.store
      .context(f.graph)
      .commandRestriction(vehicleId, "vehicle-travel", until),
  ).toBeUndefined();
  await f.store.commit(
    await f.store.claim(f.graph, randomUUID()),
    f.store.context(f.graph),
    {
      commitId: randomUUID(),
      at: Date.now(),
      changes: { nodes: [], revisions: [], edges: [], endEdges: [stateId] },
    },
  );
  await expect(f.send(0, travel)).resolves.toMatchObject({
    state: "accepted",
    spentSp: 0,
  });
  expect(f.calls).not.toHaveBeenCalled();
});
