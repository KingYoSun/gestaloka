import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { z } from "zod";
import { WorldAccess } from "@gestaloka/server/access";
import type { WorldProposal } from "@gestaloka/server/agent";
import { readBelongings, type BelongingOp } from "@gestaloka/server/belongings";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import type { SceneStep } from "../../packages/server/src/runtime/scene-data.js";

type Step = Extract<z.infer<typeof SceneStep>, { type: "scene" }>;
type Known = Awaited<ReturnType<typeof readBelongings>>;
type Input = {
  request?: {
    phase?: string;
    actionText?: string;
    controlledActorId?: string;
    completedScene?: unknown;
  };
  background?: unknown;
  belongings?: Record<string, Known>;
};
const scope = `belongings-${randomUUID()}`,
  home = randomUUID(),
  people: string[] = [];
let world: string, graph: string, admin: string, user: string, a: string;
let scene: string;
// 次の行動解決で代役モデルが返す操作。配列の先頭から一応答ずつ使う。
let replies: BelongingOp[][] = [];
const resolved: {
    belongings: Record<string, Known> | undefined;
    errors: string[];
  }[] = [],
  joins: { text: string; system: string; errors: string[] }[] = [];
let snapshot: { state: string; data: unknown } | undefined;

const setup = await fixtureRuntime(scope, async (content, raw, messages) => {
  const input = raw as Input,
    errors = messages
      .filter(
        (m) => m.role === "user" && m.content.includes("validationErrors"),
      )
      .map((m) => m.content);
  if (input.request?.phase === "participant") {
    const proposal = content as WorldProposal,
      actor = proposal.newParticipantId!;
    joins.push({
      text: input.request.actionText!,
      system: messages[0]!.content,
      errors,
    });
    const tool: BelongingOp = {
      type: "create",
      label: "工具",
      holder: actor,
      owner: actor,
      basis: "初期設定",
    };
    return {
      ...proposal,
      changes: {
        ...proposal.changes,
        nodes: [
          ...proposal.changes.nodes,
          { id: home, kind: "existence", text: "新しい住人の家" },
        ],
        edges: [
          ...proposal.changes.edges.filter(
            (e) => e.kind !== "see" || !e.text?.startsWith("過去の観測"),
          ),
          {
            id: randomUUID(),
            kind: "has",
            source: actor,
            target: home,
            period: { from: proposal.resolvedUntil },
          },
        ],
      },
      belongings: (
        [
          tool,
          { type: "grant", person: actor, storage: home, basis: "初期設定" },
          {
            type: "learn",
            person: actor,
            text: "刃物を研げる",
            basis: "初期設定",
          },
          // 最初の応答は、参加時に認めない操作を混ぜる。
          ...(errors.length
            ? []
            : [{ type: "remove" as const, id: proposal.changes.nodes[0]!.id }]),
        ] as BelongingOp[]
      ).map((op) => JSON.stringify(op)),
    };
  }
  if (input.background && input.request?.controlledActorId === a) {
    resolved.push({ belongings: input.belongings, errors });
    snapshot = (
      await setup.databases.postgres.query<{ state: string; data: unknown }>(
        "SELECT state,data FROM world_scene WHERE id=$1",
        [scene],
      )
    ).rows[0];
    // モデルは操作を1件ずつJSON文字列で返す。
    return {
      ...(content as Step),
      belongings: (replies.shift() ?? []).map((op) => JSON.stringify(op)),
    };
  }
  return content;
});
const { databases: db, runtime } = setup,
  access = new WorldAccess(runtime);
let auth: Awaited<ReturnType<typeof fixtureAuth>>;
const calls = async () => (await runtime.agent.model.ledger.summary()).calls;
const known = () => readBelongings(runtime.agent.store.context(graph), a);
const command = (input: Record<string, unknown>) =>
  access.sceneCommand(
    user,
    world,
    { requestId: randomUUID(), ...input } as Parameters<
      WorldAccess["sceneCommand"]
    >[2],
    false,
    a,
  );
const saved = async () =>
  (
    await db.postgres.query<{ state: string; events: unknown[] }>(
      "SELECT state,data->'events' AS events FROM world_scene WHERE id=$1",
      [scene],
    )
  ).rows[0]!;
const act = async (actionText: string, ops: BelongingOp[][] = []) => {
  replies = ops;
  await command({ command: "act", actionText });
  await access.scenes.tick(scene);
};

beforeAll(async () => {
  auth = await fixtureAuth(db.postgres);
  await access.setup();
  admin = (await auth.person()).id;
  user = (await auth.person("user")).id;
  people.push(admin, user);
  world = (
    await access.create(admin, {
      budgetUsd: 100,
      requestId: randomUUID(),
      prompt: "物品と技能の確定を確かめるための世界",
      playerSettings: "新しく来た住人。家があり、工具を一つ持つ。",
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
    title: "物品の世界",
    description: "参加用",
    published: true,
    accepting: true,
    reason: "検証",
  });
});
afterAll(async () => {
  for (const table of ["runtime_execution", "world_budget"])
    await db.postgres.query(`DELETE FROM ${table} WHERE world_id=$1`, [graph]);
  for (const suffix of [
    "",
    "-play",
    "-scenes",
    "-joins",
    "-shared-scenes",
    "-scene-deadlines",
  ])
    await db.queue.deleteQueue(`e2e-${scope}${suffix}`);
  for (const table of ["world_event", "world_access", "construction_log"])
    await db.postgres.query(`DELETE FROM ${table} WHERE construction_id=$1`, [
      world,
    ]);
  await db.postgres.query("DELETE FROM api_request WHERE subject_id=ANY($1)", [
    people,
  ]);
  await db.postgres.query("DELETE FROM world_subject WHERE id=ANY($1)", [
    people,
  ]);
  await db.postgres.query("DELETE FROM world_construction WHERE id=$1", [
    world,
  ]);
  await db.postgres.query("DELETE FROM world_build WHERE run_id=$1", [world]);
  await db.postgres.query(
    "DELETE FROM world_operation WHERE request->>'worldId'=$1",
    [graph],
  );
  for (const table of ["world_intent", "world_controlled_actor"])
    await db.postgres.query(`DELETE FROM ${table} WHERE world_id=$1`, [graph]);
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

test("参加時は基本設定と個別設定を照合する材料を渡し、採用した品・技能だけを同じ確定で登録する", async () => {
  const id = randomUUID();
  await auth.operations.execute(
    user,
    id,
    {
      operation: "worlds.join",
      worldId: world,
      name: "研ぎ師",
      character: "伝説の名剣を持ち込んだ旅の剣豪。",
    },
    { players: access.players },
  );
  await access.players.tick(id);
  a = (await access.players.list(user, world)).items[0]!.actorId!;

  // 個別設定は基本設定と区別して渡し、書かれているだけでは所有物にしない。
  expect(joins[0]!.text).toBe(
    "参加者の基本設定\n新しく来た住人。家があり、工具を一つ持つ。\n\n人物の個別設定\n伝説の名剣を持ち込んだ旅の剣豪。",
  );
  expect(joins[0]!.system).toContain("矛盾する箇所は基本設定を採用します");
  expect(joins[0]!.system).toContain(
    "発言・自称・希望や、入力文に書かれているだけ",
  );
  expect(joins).toHaveLength(2);
  expect(joins[1]!.errors.join()).toContain("参加時は");

  expect(await known()).toMatchObject({
    items: [{ label: "工具", owners: [{ id: a }], basis: "初期設定" }],
    storages: [{ id: home, items: [] }],
    skills: [{ text: "刃物を研げる", basis: "初期設定" }],
  });
  expect(JSON.stringify(await known())).not.toContain("名剣");
});

test("シーンの行動で成立した変更をターンごとに確定し、追加のモデル呼び出しや二重適用を起こさない", async () => {
  scene = (await command({ command: "prepare", purpose: "家で道具を整える" }))
    .scene!.id;
  await access.scenes.tick(scene);
  await command({ command: "start" });
  const tool = (await known()).items[0]!.id;

  // 操作のない入力と、操作を返す入力のモデル呼び出しは同じ回数になる。
  let before = await calls();
  await act("家の中を見回す");
  const plain = (await calls()) - before;
  expect(resolved.at(-1)!.belongings![a]).toMatchObject({
    items: [{ id: tool }],
    storages: [{ id: home, items: [] }],
  });
  before = await calls();
  await act("工具を家の棚に置く", [
    [{ type: "move", item: tool, from: a, to: home, basis: "棚に置いた" }],
  ]);
  expect((await calls()) - before).toBe(plain);
  expect(await known()).toMatchObject({
    items: [],
    storages: [{ id: home, items: [{ id: tool, owners: [{ id: a }] }] }],
  });

  // 確定後・保存前に止まった状態へ戻して再開しても、保存済みの応答と確定記録を使う。
  const committed = snapshot!,
    relations = async () =>
      (
        await runtime.agent.store
          .context(graph)
          .history(tool, "has", "in", Number.MAX_SAFE_INTEGER)
      ).length,
    count = await relations();
  const { events } = await saved();
  await db.postgres.query(
    "UPDATE world_scene SET state=$2,data=$3 WHERE id=$1",
    [scene, committed.state, JSON.stringify(committed.data)],
  );
  before = await calls();
  await access.scenes.tick(scene);
  expect(await calls()).toBe(before);
  expect(await relations()).toBe(count);
  expect((await saved()).events).toEqual(events);

  // 遠隔で在庫を知っていても、手元の携行品としては渡さない。古い所在からの移動は確定しない。
  const length = events.length;
  await act("出先で鞄から工具を取り出す", [
    [{ type: "move", item: tool, from: a, to: a, basis: "取り出した" }],
    [],
  ]);
  expect(resolved.at(-2)!.belongings![a]).toMatchObject({
    items: [],
    storages: [{ id: home, items: [{ id: tool }] }],
  });
  expect(resolved.at(-1)!.errors.join()).toContain(
    "物品の現在の所在が指定と異なります",
  );
  expect((await known()).storages[0]!.items).toMatchObject([{ id: tool }]);
  expect((await saved()).events).toHaveLength(length + 1);

  // 自称だけの入力では技能が増えず、根拠つきで習得した技能は次の判定へ渡る。
  await act("自分は鍛冶の達人だと名乗る");
  expect((await known()).skills).toHaveLength(1);
  const lesson: BelongingOp = {
    type: "learn",
    person: a,
    text: "欠けた刃を研ぎ直せる",
    basis: "教わりながら三度研ぎ直しを仕上げた",
  };
  await act("研ぎ直しを教わりながら繰り返す", [[lesson]]);
  // 確定後に同じ入力を解決し直しても同じ確定として扱い、後の応答の操作を重ねない。
  const { work: _work, ...unresolved } = snapshot!.data as { work: unknown };
  void _work;
  await db.postgres.query(
    "UPDATE world_scene SET state=$2,data=$3 WHERE id=$1",
    [scene, snapshot!.state, JSON.stringify(unresolved)],
  );
  replies = [[lesson]];
  before = await calls();
  await access.scenes.tick(scene);
  expect(await calls()).toBeGreaterThan(before);
  expect((await known()).skills).toHaveLength(2);
  await act("もう一度刃を確かめる");
  // 同じ時点に成立した技能の並びは関係のIDで決まるため、順序は確かめない。
  const passed = resolved.at(-1)!.belongings![a]!.skills;
  expect(passed).toHaveLength(2);
  expect(passed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: "刃物を研げる" }),
      expect.objectContaining({
        text: "欠けた刃を研ぎ直せる",
        basis: "教わりながら三度研ぎ直しを仕上げた",
      }),
    ]),
  );

  // シーン終了の反映は、進行中に確定した記録をそのまま引き継ぐ。
  const settled = await known();
  await command({ command: "finish" });
  await access.scenes.tick(scene);
  expect((await saved()).state).toBe("result");
  expect(await known()).toEqual(settled);
  expect(await relations()).toBe(count);
});
