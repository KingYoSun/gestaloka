import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { playerCli } from "../support/player-cli.js";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { WorldAccess } from "@gestaloka/server/access";
import type { WorldProposal } from "@gestaloka/server/agent";
import {
  changeBelongings,
  type BelongingOp,
} from "@gestaloka/server/belongings";
import { createApp } from "../../apps/api/src/app.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import type {
  SceneBackground,
  SceneStep,
  CompletedScene,
} from "../../packages/server/src/runtime/scene-data.js";
import type { z } from "zod";

const scope = `players-${randomUUID()}`,
  people: string[] = [];
let mark = "確定した合図",
  exchange = false;
const replyMark = "相手の確定した返答";
let world: string,
  graph: string,
  a: string,
  b: string,
  admin: string,
  one: string,
  two: string,
  oneCookie: string,
  twoCookie: string,
  presetId: string;
let forceOther = false,
  seen = false;
type Input = {
  request?: {
    phase?: string;
    actorId?: string;
    controlledActorId?: string;
    rootIds: string[];
    until?: number;
    completedScene?: CompletedScene;
  };
  background?: SceneBackground;
  initialContext?: unknown;
};
const setup = await fixtureRuntime(scope, (content, raw) => {
  const input = raw as Input;
  if (input.request?.phase === "participant") {
    const proposal = content as WorldProposal;
    return {
      ...proposal,
      changes: {
        ...proposal.changes,
        edges: proposal.changes.edges.filter(
          (e) => e.kind !== "see" || !e.text?.startsWith("過去の観測"),
        ),
      },
    };
  }
  const controlled = input.request?.controlledActorId;
  if (
    input.background &&
    (controlled === a || (exchange && controlled === b))
  ) {
    const step = content as Extract<
      z.infer<typeof SceneStep>,
      { type: "scene" }
    >;
    return {
      ...step,
      events: [
        {
          actorId: controlled,
          text: controlled === a ? mark : replyMark,
          receipts: [
            {
              observerId: controlled,
              text: controlled === a ? mark : replyMark,
            },
          ],
        },
      ],
      elapsedMs: 1000,
    };
  }
  if ((content as { type?: string }).type === "background") {
    const background = content as SceneBackground;
    if (forceOther && input.request?.actorId === a) {
      forceOther = false;
      return { ...background, participants: [a, b] };
    }
    if (
      input.request?.actorId === b &&
      JSON.stringify(input.initialContext).includes(mark)
    ) {
      seen = true;
      return {
        ...background,
        synopsis: mark,
        perceptions: [
          {
            observerId: b,
            text: mark,
            sourceIds: input.request.rootIds.filter((id) => id !== b),
          },
        ],
      };
    }
    if (
      exchange &&
      input.request?.actorId === a &&
      JSON.stringify(input.initialContext).includes(replyMark)
    ) {
      return {
        ...background,
        synopsis: replyMark,
        perceptions: [
          {
            observerId: a,
            text: replyMark,
            sourceIds: input.request.rootIds.filter((id) => id !== a),
          },
        ],
      };
    }
  }
  if (
    input.request?.completedScene?.events.length &&
    (controlled === a || (exchange && controlled === b))
  ) {
    const proposal = content as WorldProposal;
    return {
      ...proposal,
      changes: {
        ...proposal.changes,
        edges: [
          ...proposal.changes.edges,
          {
            id: randomUUID(),
            kind: "effect",
            source: input.request.completedScene.events[0]!.id,
            target: input.request.rootIds.find((id) => id !== controlled)!,
            period: { from: input.request.until! },
          },
        ],
      },
    };
  }
  return content;
});
const { databases: db, runtime } = setup,
  access = new WorldAccess(runtime);
let auth: Awaited<ReturnType<typeof fixtureAuth>>,
  app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  auth = await fixtureAuth(db.postgres);
  await access.setup();
  app = await createApp(access, auth.identity, undefined, auth.operations);
  const operator = await auth.person(),
    p1 = await auth.person("user"),
    p2 = await auth.person("user");
  admin = operator.id;
  one = p1.id;
  two = p2.id;
  oneCookie = p1.cookie;
  twoCookie = p2.cookie;
  people.push(admin, one, two);
  world = (
    await access.create(admin, {
      budgetUsd: 100,
      requestId: randomUUID(),
      prompt: "参加者の共有とシーン分離を確かめるための世界",
    })
  ).id;
  await runtime.tick(world);
  graph = (await runtime.get(world)).world_id!;
  await access.command(admin, world, {
    requestId: randomUUID(),
    command: "finish",
  });
  await auth.operations.execute(admin, randomUUID(), {
    operation: "worlds.configure",
    worldId: world,
    title: "共有世界",
    description: "参加用",
    published: true,
    accepting: true,
    reason: "検証",
  });
  presetId = randomUUID();
  await auth.operations.execute(admin, randomUUID(), {
    operation: "presets.put",
    presetId,
    title: "世界の一員",
    description: "この地で暮らす",
    settings: "世界と両立する役割と知識を持つ。",
    expectedVersion: 0,
    reason: "検証",
  });
  for (const user of [one, two]) {
    const id = randomUUID();
    await auth.operations.execute(
      user,
      id,
      { operation: "worlds.join", worldId: world, presetId, presetVersion: 1 },
      { players: access.players },
    );
    await access.players.tick(id);
  }
  a = (await access.players.list(one, world)).items[0]!.actorId!;
  b = (await access.players.list(two, world)).items[0]!.actorId!;
});
afterAll(async () => {
  await db.postgres.query("DELETE FROM runtime_execution WHERE world_id=$1", [
    graph,
  ]);
  await setup.databases.postgres.query(
    "DELETE FROM world_budget WHERE world_id=$1",
    [graph],
  );
  await app?.close();
  for (const suffix of [
    "",
    "-play",
    "-scenes",
    "-joins",
    "-shared-scenes",
    "-scene-deadlines",
  ])
    await db.queue.deleteQueue(`e2e-${scope}${suffix}`);
  await db.postgres.query("DELETE FROM world_event WHERE construction_id=$1", [
    world,
  ]);
  await db.postgres.query("DELETE FROM world_access WHERE construction_id=$1", [
    world,
  ]);
  await db.postgres.query("DELETE FROM api_request WHERE subject_id=ANY($1)", [
    people,
  ]);
  await db.postgres.query("DELETE FROM world_subject WHERE id=ANY($1)", [
    people,
  ]);
  await db.postgres.query(
    "DELETE FROM construction_log WHERE construction_id=$1",
    [world],
  );
  await db.postgres.query("DELETE FROM world_construction WHERE id=$1", [
    world,
  ]);
  await db.postgres.query("DELETE FROM world_build WHERE run_id=$1", [world]);
  await db.postgres.query(
    "DELETE FROM world_operation WHERE request->>'worldId'=$1",
    [graph],
  );
  await db.postgres.query("DELETE FROM world_intent WHERE world_id=$1", [
    graph,
  ]);
  await db.postgres.query(
    "DELETE FROM world_controlled_actor WHERE world_id=$1",
    [graph],
  );
  await db.postgres.query("DELETE FROM llm_call WHERE budget_id=$1", [
    `e2e-${scope}`,
  ]);
  await db.postgres.query("DELETE FROM llm_budget WHERE id=$1", [
    `e2e-${scope}`,
  ]);
  await auth?.cleanup();
  await db.graph.executeQuery(
    "MATCH(n) WHERE n.worldId=$worldId DETACH DELETE n",
    { worldId: graph },
  );
  await db.queue.stop();
  await db.close();
});

test("独立したシーンを保ちながら確定した作用を後続の参照へ引き継ぐ", async () => {
  const prepare = async (user: string, actor: string) =>
    (
      await access.sceneCommand(
        user,
        world,
        { requestId: randomUUID(), command: "prepare", purpose: mark },
        false,
        actor,
      )
    ).scene!;
  const x = await prepare(one, a),
    y = await prepare(two, b);
  await access.scenes.tick(x.id);
  await access.scenes.tick(y.id);
  await access.sceneCommand(
    one,
    world,
    { requestId: randomUUID(), command: "start" },
    false,
    a,
  );
  await access.sceneCommand(
    two,
    world,
    { requestId: randomUUID(), command: "start" },
    false,
    b,
  );
  const before = await access.scene(two, world, false, b);
  await access.sceneCommand(
    one,
    world,
    { requestId: randomUUID(), command: "act", actionText: mark },
    false,
    a,
  );
  await access.scenes.tick(x.id);
  await access.sceneCommand(
    one,
    world,
    { requestId: randomUUID(), command: "finish" },
    false,
    a,
  );
  await access.scenes.tick(x.id);
  expect((await access.scene(one, world, false, a)).scene!.state).toBe(
    "result",
  );
  expect(await access.scene(two, world, false, b)).toEqual(before);
  expect(
    JSON.stringify(
      await access.knowledge(two, world, undefined, undefined, undefined, b),
    ),
  ).not.toContain(mark);
  await access.sceneCommand(
    two,
    world,
    { requestId: randomUUID(), command: "finish" },
    false,
    b,
  );
  await access.scenes.tick(y.id);
  const next = await prepare(two, b);
  await access.scenes.tick(next.id);
  expect(seen).toBe(true);
  const state = (await access.scene(two, world, false, b)).scene!;
  expect(state.state).toBe("ready");
  expect(state.synopsis).toBe(mark);
  expect((await runtime.get(world)).at).toBeGreaterThanOrEqual(1000);
  expect(await runtime.agent.controlledActors(graph, [a, b])).toEqual(
    new Set([a, b]),
  );
  for (const [responseId, owner] of [
    [world, admin],
    [x.id, one],
    [y.id, two],
  ]) {
    const rows = (
      await db.postgres.query(
        "SELECT DISTINCT user_id,world_id FROM llm_call WHERE budget_id=$1 AND response_id=$2",
        [`e2e-${scope}`, responseId],
      )
    ).rows;
    expect(rows).toEqual([{ user_id: owner, world_id: graph }]);
  }
  const joins = (
    await db.postgres.query(
      "SELECT DISTINCT c.user_id,j.subject_id FROM llm_call c JOIN world_join j ON j.id=c.response_id WHERE j.construction_id=$1 ORDER BY j.subject_id",
      [world],
    )
  ).rows;
  expect(joins).toHaveLength(2);
  expect(joins.every((r) => r.user_id === r.subject_id)).toBe(true);
});

test("2つのCLIが認可・新規参加・応答喪失からの復帰と相互の確定履歴を引き継ぐ", async () => {
  const fixture = await playerCli(app);
  const { directory, base, run: cli } = fixture;
  const profiles = [join(directory, "one.json"), join(directory, "two.json")];
  const permit = (
    cookie: string,
    code: string,
    choice = `preset:${presetId}:1`,
  ) => fixture.approve(cookie, code, choice);
  try {
    fixture.dropNextResponse("/api/player-devices");
    const lostConnect = await cli(
      profiles[0]!,
      "connect",
      "--server",
      base,
      "--world",
      `${base}/worlds/${world}`,
    );
    expect(lostConnect.state).toBe("error");
    const oldRequestPath = join(
      `${profiles[0]}.requests`,
      `${lostConnect.requestId}.json`,
    );
    const oldRequest = JSON.parse(await readFile(oldRequestPath, "utf8"));
    delete oldRequest.method;
    await writeFile(oldRequestPath, JSON.stringify(oldRequest));
    const connection = await cli(profiles[0]!, "recover");
    expect(connection.requestId).toBe(lostConnect.requestId);
    expect(connection.state).toBe("authorization_pending");
    const second = await cli(
      profiles[1]!,
      "connect",
      "--server",
      base,
      "--world",
      world,
    );
    expect((await cli(profiles[0]!, "status")).state).toBe(
      "authorization_pending",
    );
    expect(
      (await permit(oneCookie, connection.userCode, `actor:${b}`)).statusCode,
    ).toBe(403);
    expect((await permit(oneCookie, connection.userCode)).statusCode).toBe(302);
    expect((await permit(twoCookie, second.userCode)).statusCode).toBe(302);
    fixture.dropNextResponse("worlds.join");
    const lostJoin = await cli(profiles[0]!, "join");
    expect(lostJoin.state).toBe("error");
    expect((await cli(profiles[0]!, "recover")).state).toBe("joining");
    expect((await cli(profiles[1]!, "join")).state).toBe("joining");
    await access.players.tick(connection.id);
    await access.players.tick(second.id);
    const firstStatus = await cli(profiles[0]!, "status"),
      secondStatus = await cli(profiles[1]!, "status");
    const oldActor = a;
    a = firstStatus.device.actorId;
    b = secondStatus.device.actorId;
    expect(a).not.toBe(b);
    expect(firstStatus.state).toBe("no_scene");
    expect(
      (await cli(profiles[0]!, "connect", "--server", base, "--world", world))
        .device.actorId,
    ).toBe(a);
    expect(
      (
        await db.postgres.query("SELECT id FROM world_join WHERE id=ANY($1)", [
          [connection.id, second.id],
        ])
      ).rowCount,
    ).toBe(2);
    mark = "CLIから確定した新しい合図";
    seen = false;
    exchange = true;
    const x = await cli(
        profiles[0]!,
        "prepare",
        "--purpose",
        "相手に働きかける",
      ),
      y = await cli(profiles[1]!, "prepare", "--purpose", "周囲を確かめる");
    await access.scenes.tick(x.scene.id);
    await access.scenes.tick(y.scene.id);
    expect((await cli(profiles[0]!, "start")).state).toBe("waiting_input");
    expect((await cli(profiles[1]!, "start")).state).toBe("waiting_input");
    fixture.dropNextResponse("act");
    const lostAction = await cli(
      profiles[0]!,
      "act",
      "--text",
      "橋の修理を持ちかける",
    );
    expect(lostAction.state).toBe("error");
    const recovering = await cli(profiles[0]!, "recover");
    expect(recovering.requestId).toBe(lostAction.requestId);
    await access.scenes.tick(x.scene.id);
    const afterAct = await cli(profiles[0]!, "status");
    expect(afterAct.scene.actions).toHaveLength(1);
    expect(afterAct.state).toBe("waiting_input");
    const known = await cli(profiles[0]!, "knowledge");
    fixture.dropNextResponse("finish");
    expect((await cli(profiles[0]!, "finish")).state).toBe("error");
    const finishedRequest = await cli(profiles[0]!, "recover");
    await access.scenes.tick(x.scene.id);
    expect((await cli(profiles[0]!, "result")).state).toBe("finished");
    const newlyKnown = await cli(
      profiles[0]!,
      "knowledge",
      "--since",
      known.checkpoint,
    );
    expect(JSON.stringify(newlyKnown.items)).toContain(mark);
    expect(
      newlyKnown.items.some((item: { id: string }) =>
        known.items.some((old: { id: string }) => old.id === item.id),
      ),
    ).toBe(false);
    expect(
      (await cli(profiles[0]!, "knowledge", "--since", newlyKnown.checkpoint))
        .items,
    ).toEqual([]);
    expect(
      (
        await cli(
          profiles[0]!,
          "recover",
          "--request",
          finishedRequest.requestId,
        )
      ).scene.state,
    ).toBe("result");
    expect(JSON.stringify(await cli(profiles[1]!, "knowledge"))).not.toContain(
      mark,
    );
    await cli(profiles[1]!, "finish");
    await access.scenes.tick(y.scene.id);
    const next = await cli(
      profiles[1]!,
      "prepare",
      "--purpose",
      "相手の働きかけを確かめる",
    );
    await access.scenes.tick(next.scene.id);
    expect(seen).toBe(true);
    expect((await cli(profiles[1]!, "status")).scene.synopsis).toBe(mark);
    await cli(profiles[1]!, "start");
    await cli(profiles[1]!, "act", "--text", "自分の見聞から返答する");
    await access.scenes.tick(next.scene.id);
    await cli(profiles[1]!, "finish");
    await access.scenes.tick(next.scene.id);
    const again = await cli(
      profiles[0]!,
      "prepare",
      "--purpose",
      "返答を受けて続きを考える",
    );
    await access.scenes.tick(again.scene.id);
    expect((await cli(profiles[0]!, "status")).scene.synopsis).toBe(replyMark);
    expect(
      (
        await cli(
          profiles[0]!,
          "history",
          "--scene",
          x.scene.id,
          "--kind",
          "actions",
        )
      ).items,
    ).toHaveLength(1);
    // 持ち物・保管先・技能は、WebとCLIが同じ本人向けAPIから読む。
    const store = runtime.agent.store,
      place = (text: string) => ({
        id: randomUUID(),
        kind: "existence" as const,
        text,
      }),
      shed = place("共同倉庫"),
      den = place("相手の私室"),
      now = async () => Number((await runtime.get(world)).at);
    await store.commit(
      await store.claim(graph, randomUUID()),
      store.context(graph),
      {
        commitId: randomUUID(),
        at: await now(),
        changes: { nodes: [shed, den], revisions: [], edges: [], endEdges: [] },
      },
    );
    const change = async (ops: BelongingOp[]) =>
      changeBelongings(store, await store.claim(graph, randomUUID()), {
        commitId: randomUUID(),
        at: await now(),
        ops,
      });
    const nail: BelongingOp = {
      type: "create",
      label: "釘",
      holder: a,
      owner: a,
      basis: "初期設定",
    };
    const rope = (
      await change([
        { ...nail, label: "縄", holder: shed.id, basis: "備え付け" },
        nail,
        nail,
        { ...nail, label: "日記", holder: den.id, owner: b },
        ...[a, b, oldActor].map((person): BelongingOp => ({
          type: "grant",
          person,
          storage: shed.id,
          basis: "村の取り決め",
        })),
        { type: "grant", person: b, storage: den.id, basis: "初期設定" },
        { type: "learn", person: a, text: "縄を結べる", basis: "初期設定" },
      ])
    ).changes.nodes[0]!.id;
    const web = async (actor: string) =>
      (
        await app.inject({
          url: `/api/worlds/${world}/belongings?actorId=${actor}`,
          headers: { cookie: oneCookie },
        })
      ).json();
    const stock = (known: { storages: { id: string; items: unknown[] }[] }) =>
      known.storages.find((storage) => storage.id === shed.id)!.items;
    const observed = async () =>
      (await store.context(graph).history(a, "see", "out", await now())).length;
    const state = await access.scene(one, world, false, a),
      at = (await runtime.get(world)).at,
      sights = await observed();
    const calls = vi.spyOn(runtime.agent.model, "complete");
    await cli(profiles[0]!, "status");
    await cli(profiles[0]!, "knowledge");
    const inventory = await cli(profiles[0]!, "inventory"),
      storage = await cli(profiles[0]!, "storage"),
      skills = await cli(profiles[0]!, "skills"),
      shown = await web(a),
      others = await cli(profiles[1]!, "storage");
    expect(await access.scene(one, world, false, a)).toEqual(state);
    expect((await runtime.get(world)).at).toBe(at);
    expect(await observed()).toBe(sights);
    expect(calls).not.toHaveBeenCalled();
    calls.mockRestore();
    expect([inventory.items, storage.storages, skills.skills]).toEqual([
      shown.items,
      shown.storages,
      shown.skills,
    ]);
    expect(shown).toMatchObject({
      viewerId: a,
      items: [{ label: "釘", quantity: 2, mine: true }],
      storages: [
        {
          id: shed.id,
          label: "共同倉庫",
          items: [{ label: "縄", quantity: 1, mine: true }],
        },
      ],
      skills: [{ text: "縄を結べる" }],
    });
    // 利用権のない保管先と、他人の持ち物・技能は返さない。
    expect(JSON.stringify(shown)).not.toContain("日記");
    expect(others.storages).toHaveLength(2);
    expect(stock(others)).toEqual([{ label: "縄", quantity: 1, mine: false }]);
    expect((await cli(profiles[1]!, "skills")).skills).toEqual([]);
    expect(
      (
        await app.inject({
          url: `/api/worlds/${world}/belongings?actorId=${b}`,
          headers: { cookie: oneCookie },
        })
      ).statusCode,
    ).toBe(404);
    // 最後の一品が持ち出された直後は、閲覧済みの人物、初めて読む人物、持ち出した本人が同じ在庫を読む。
    await change([
      { type: "move", item: rope, from: shed.id, to: a, basis: "持ち出した" },
    ]);
    expect(stock(await cli(profiles[1]!, "storage"))).toEqual([]);
    expect(stock(await web(oldActor))).toEqual([]);
    expect(stock(await web(a))).toEqual([]);
    expect((await cli(profiles[0]!, "inventory")).items).toContainEqual({
      label: "縄",
      quantity: 1,
      mine: true,
    });
    const saved = JSON.parse(await readFile(profiles[0]!, "utf8"));
    const headers = {
      authorization: `Bearer ${saved.secret}`,
      "x-gestaloka-request": "1",
    };
    for (const url of [
      `/api/worlds/${world}/knowledge?actorId=${b}`,
      `/api/worlds/${world}/knowledge?actorId=${oldActor}`,
      `/api/worlds/${world}/belongings?actorId=${b}`,
      `/api/worlds/${world}/belongings?actorId=${oldActor}`,
      `/api/worlds/${randomUUID()}/scene`,
      `/api/worlds/${world}/records`,
      "/api/account",
    ]) {
      expect((await app.inject({ url, headers })).statusCode, url).toBe(403);
    }
    expect(
      (
        await app.inject({
          url: `/api/worlds/${world}/scene/records?sceneId=${next.scene.id}&kind=events`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/operations",
          headers,
          payload: {
            requestId: randomUUID(),
            command: {
              operation: "worlds.join",
              worldId: world,
              presetId,
              presetVersion: 1,
            },
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/operations",
          headers,
          payload: {
            requestId: randomUUID(),
            command: { operation: "users.list" },
          },
        })
      ).statusCode,
    ).toBe(403);
    await db.postgres.query("UPDATE app_user SET banned=true WHERE id=$1", [
      one,
    ]);
    expect((await cli(profiles[0]!, "status")).code).toBe("USER_BANNED");
    await db.postgres.query("UPDATE app_user SET banned=false WHERE id=$1", [
      one,
    ]);
    const extra = join(directory, "existing.json"),
      connected = await cli(
        extra,
        "connect",
        "--server",
        base,
        "--world",
        world,
      );
    expect(
      (await permit(oneCookie, connected.userCode, `actor:${a}`)).statusCode,
    ).toBe(302);
    expect((await cli(extra, "status")).device.actorId).toBe(a);
    await cli(extra, "start");
    await cli(extra, "finish");
    await access.scenes.tick(again.scene.id);
    const page = await app.inject({
      url: "/auth/player",
      headers: { cookie: oneCookie },
    });
    const csrf = page.body.match(/name="csrf" value="([a-f0-9]+)"/)![1]!;
    const revoke = (cookie: string) =>
      app.inject({
        method: "POST",
        url: "/auth/player",
        headers: {
          cookie: `${cookie}; gestaloka_player_form=${csrf}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: new URLSearchParams({
          csrf,
          revoke: connection.id,
        }).toString(),
      });
    expect((await revoke(twoCookie)).statusCode).toBe(403);
    expect((await revoke(oneCookie)).statusCode).toBe(302);
    expect((await cli(profiles[0]!, "status")).code).toBe(
      "PLAYER_DEVICE_DENIED",
    );
    expect((await cli(profiles[0]!, "inventory")).code).toBe(
      "PLAYER_DEVICE_DENIED",
    );
    expect(
      (await cli(profiles[0]!, "recover", "--request", lostAction.requestId))
        .code,
    ).toBe("PLAYER_DEVICE_DENIED");
    expect((await cli(extra, "status")).device.actorId).toBe(a);
  } finally {
    exchange = false;
    await fixture.close();
  }
}, 120000);

test("他プレイヤーをNPCの登場主体にせず新たな意図を代行しない", async () => {
  forceOther = true;
  const scene = (
    await access.sceneCommand(
      one,
      world,
      {
        requestId: randomUUID(),
        command: "prepare",
        purpose: "周囲を確かめる",
      },
      false,
      a,
    )
  ).scene!;
  const calls = vi.spyOn(runtime.agent.model, "complete");
  try {
    await access.scenes.tick(scene.id);
    expect((await access.scene(one, world, false, a)).scene!.state).toBe(
      "ready",
    );
    expect(
      (await access.scenes.latest(world, undefined, false, a))!.data.background!
        .participants,
    ).not.toContain(b);
    const backgrounds = calls.mock.calls.filter(
      (call) => call[1] === "scene-background",
    );
    expect(backgrounds).toHaveLength(2);
    expect(JSON.stringify(backgrounds[1]![2])).toContain("他プレイヤーをNPC");
    expect(
      calls.mock.calls.filter((call) => call[1] === "scene-intent"),
    ).toHaveLength(0);
    await expect(
      runtime.agent.intent(graph, b, 1000, randomUUID()),
    ).rejects.toThrow("本人の入力");
  } finally {
    calls.mockRestore();
  }
});
