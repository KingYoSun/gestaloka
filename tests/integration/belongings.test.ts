import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { WorldStore, type WorldNode } from "@gestaloka/server/world";
import {
  changeBelongings,
  readBelongings,
  type BelongingOp,
} from "@gestaloka/server/belongings";

const databases = connectDatabases();
const store = new WorldStore(databases.graph);
const worlds: string[] = [];

// 人物と保管先だけがある世界を作る。物品・技能は内部関数で成立させる。
async function world(...labels: string[]) {
  const worldId = randomUUID();
  worlds.push(worldId);
  const nodes = labels.map((text): WorldNode => ({
    id: randomUUID(),
    kind: "existence",
    text,
  }));
  await store.commit(
    await store.claim(worldId, randomUUID()),
    store.context(worldId),
    {
      commitId: randomUUID(),
      at: 0,
      changes: { nodes, revisions: [], edges: [], endEdges: [] },
    },
  );
  const apply = async (
    at: number,
    ops: BelongingOp[],
    commitId: string = randomUUID(),
  ) =>
    changeBelongings(store, await store.claim(worldId, randomUUID()), {
      commitId,
      at,
      ops,
    });
  return {
    worldId,
    ids: nodes.map((node) => node.id),
    apply,
    read: (subject: string, at?: number) =>
      readBelongings(store.context(worldId), subject, at),
  };
}
const summaries = async (worldId: string) =>
  (
    await databases.graph.executeQuery(
      `MATCH(s:WorldNode {worldId:$worldId})-[r:has {role:'summary'}]->(n:WorldNode)
       RETURN s.id AS subject,n.data AS data`,
      { worldId },
    )
  ).records
    .map((row) => ({
      subject: row.get("subject") as string,
      text: (JSON.parse(row.get("data")) as WorldNode).text,
    }))
    .sort((a, b) => (a.text < b.text ? -1 : 1));

beforeAll(async () => {
  await databases.verify();
  await store.setup();
});
afterAll(async () => {
  for (const worldId of worlds)
    await databases.graph.executeQuery(
      "MATCH (n) WHERE n.worldId = $worldId DETACH DELETE n",
      { worldId },
    );
  await databases.close();
});

test("借りた工具を倉庫へ預けても所有者を保ち、携行と保管に二重計上しない", async () => {
  const { worldId, ids, apply, read } = await world("A", "B", "共同倉庫");
  const [a, b, storage] = ids as [string, string, string];
  const created = await apply(1, [
    { type: "create", label: "工具", holder: a, owner: a, basis: "初期設定" },
    { type: "grant", person: a, storage, basis: "村の取り決め" },
    { type: "grant", person: b, storage, basis: "村の取り決め" },
  ]);
  const tool = created.changes.nodes[0]!.id;
  await apply(2, [
    { type: "move", item: tool, from: a, to: b, basis: "AがBに貸した" },
  ]);
  await apply(3, [
    { type: "move", item: tool, from: b, to: storage, basis: "Bが預けた" },
  ]);

  const stock = [{ id: tool, label: "工具", owners: [{ id: a, label: "A" }] }];
  expect((await read(a)).items).toEqual([]);
  expect((await read(b)).items).toEqual([]);
  // 利用者はそれぞれの要約に在庫を写さず、倉庫の同じ確定在庫を読む。
  expect((await read(a)).storages).toMatchObject([
    { id: storage, items: stock },
  ]);
  expect((await read(b)).storages).toMatchObject([
    { id: storage, items: stock },
  ]);
  expect((await read(b, 2)).items).toMatchObject(stock);
  const texts = await summaries(worldId);
  expect(texts.filter((s) => s.text.includes(tool))).toMatchObject([
    { subject: storage },
  ]);
  expect(texts.filter((s) => s.subject === b)).toMatchObject([
    { text: "保持している物品\n(なし)" },
    { text: `利用できる保管先\n- 共同倉庫〔${storage}〕` },
  ]);

  // 所在は一つだけ。古い所在を指定した移動も、別経路の二重登録も成立しない。
  await expect(
    apply(4, [{ type: "move", item: tool, from: a, to: b, basis: "古い前提" }]),
  ).rejects.toThrow("現在の所在");
  await expect(
    store.commit(
      await store.claim(worldId, randomUUID()),
      store.context(worldId),
      {
        commitId: randomUUID(),
        at: 4,
        changes: {
          nodes: [],
          revisions: [],
          edges: [
            {
              id: randomUUID(),
              kind: "has",
              role: "hold",
              source: a,
              target: tool,
              period: { from: 4 },
            },
          ],
          endEdges: [],
        },
      },
    ),
  ).rejects.toThrow("所在を同時に複数");
  expect((await read(a)).items).toEqual([]);
});

test("倉庫の最後の一品の同時取り出しは一回だけ成立し、再送と再起動でも在庫が一致する", async () => {
  const { worldId, ids, apply, read } = await world("A", "B", "共同倉庫");
  const [a, b, storage] = ids as [string, string, string];
  const created = await apply(1, [
    { type: "create", label: "縄", holder: storage, basis: "備え付け" },
    { type: "grant", person: a, storage, basis: "村の取り決め" },
    { type: "grant", person: b, storage, basis: "村の取り決め" },
  ]);
  const rope = created.changes.nodes[0]!.id;
  const take = (to: string): BelongingOp[] => [
    { type: "move", item: rope, from: storage, to, basis: "持ち出した" },
  ];
  const commits = [randomUUID(), randomUUID()];
  const results = await Promise.allSettled([
    apply(2, take(a), commits[0]),
    apply(2, take(b), commits[1]),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([
    "fulfilled",
    "rejected",
  ]);
  const won = results.findIndex((r) => r.status === "fulfilled"),
    winner = [a, b][won]!,
    loser = [a, b][1 - won]!;
  const receipt = (results[won] as PromiseFulfilledResult<unknown>).value;

  // 応答を失った再送も、別プロセスからの再開も、保存済みの結果を返して再適用しない。
  expect(await apply(2, take(winner), commits[won])).toEqual(receipt);
  const restarted = new WorldStore(databases.graph);
  expect(
    await changeBelongings(
      restarted,
      await restarted.claim(worldId, randomUUID()),
      { commitId: commits[won]!, at: 2, ops: take(winner) },
    ),
  ).toEqual(receipt);

  expect((await read(winner)).items).toMatchObject([{ id: rope }]);
  expect((await read(loser)).items).toEqual([]);
  // 遠隔の利用者も、閲覧回数によらず同じ空の在庫を読む。
  for (const person of [a, b, a])
    expect((await read(person)).storages).toMatchObject([
      { id: storage, items: [] },
    ]);
  expect(
    (await summaries(worldId)).filter((s) => s.text.includes(rope)),
  ).toMatchObject([{ subject: winner }]);
});

test("技能の習得・範囲変更・除去の前後で、当時の一覧と根拠を参照できる", async () => {
  const { worldId, ids, apply, read } = await world("A");
  const [a] = ids as [string];
  const learned = await apply(10, [
    { type: "learn", person: a, text: "刃物を研げる", basis: "初期設定" },
  ]);
  const skill = learned.changes.nodes[0]!.id;
  await apply(20, [
    {
      type: "update",
      id: skill,
      text: "刃物を研ぎ、欠けた刃を打ち直せる",
      basis: "鍛冶場で打ち直しを仕上げた",
    },
  ]);
  expect(await read(a)).toMatchObject({
    skills: [
      {
        id: skill,
        text: "刃物を研ぎ、欠けた刃を打ち直せる",
        basis: "鍛冶場で打ち直しを仕上げた",
      },
    ],
  });
  await apply(30, [{ type: "remove", id: skill }]);

  expect((await read(a)).skills).toEqual([]);
  expect((await read(a, 25)).skills).toMatchObject([
    { text: "刃物を研ぎ、欠けた刃を打ち直せる", since: 20 },
  ]);
  expect((await read(a, 15)).skills).toMatchObject([
    { id: skill, text: "刃物を研げる", basis: "初期設定", since: 10 },
  ]);
  // 除去後も記述と過去の関係は残り、過去の出来事から参照できる。
  expect((await store.context(worldId).node(skill))?.text).toBe(
    "刃物を研ぎ、欠けた刃を打ち直せる",
  );
  expect(
    (
      await store
        .context(worldId)
        .history(a, "has", "out", Number.MAX_SAFE_INTEGER)
    )
      .filter((edge) => edge.role === "skill")
      .map((edge) => [edge.text, edge.period]),
  ).toEqual([
    ["初期設定", { from: 10, until: 20 }],
    ["鍛冶場で打ち直しを仕上げた", { from: 20, until: 30 }],
  ]);
  expect((await summaries(worldId))[0]?.text).toBe("技能\n(なし)");
});

test("既存世界へ事実を追加登録し直しても、事実と要約が重複しない", async () => {
  const { worldId, ids, read } = await world("A", "Aの家", "Aの写真機");
  const [a, home, camera] = ids as [string, string, string];
  const has = (source: string, target: string, role?: "hold" | "use") => ({
    id: randomUUID(),
    kind: "has" as const,
    source,
    target,
    ...(role ? { role, text: "既存の確定記述から" } : {}),
    period: { from: role ? 5 : 0 },
  });
  // 管理編集と同じく、要求IDを実行と確定の識別に使う。
  const commit = async (commitId: string, edges: ReturnType<typeof has>[]) =>
    store.commit(await store.claim(worldId, commitId), store.context(worldId), {
      commitId,
      at: 5,
      changes: { nodes: [], revisions: [], edges, endEdges: [] },
    });
  // 役割導入前から成立している所有は、そのまま所有として読む。
  await commit(randomUUID(), [has(a, home), has(a, camera)]);
  expect(await summaries(worldId)).toEqual([]);

  const takeover = { id: randomUUID(), edges: [has(a, camera, "hold")] };
  const receipt = await commit(takeover.id, takeover.edges);
  expect(await commit(takeover.id, takeover.edges)).toEqual(receipt);
  await commit(randomUUID(), [has(a, home, "use")]);

  expect(await read(a)).toMatchObject({
    items: [{ id: camera, owners: [{ id: a }] }],
    storages: [{ id: home, items: [] }],
  });
  expect(await summaries(worldId)).toEqual([
    { subject: a, text: `保持している物品\n- Aの写真機〔${camera}〕` },
    { subject: a, text: `利用できる保管先\n- Aの家〔${home}〕` },
  ]);
  expect(
    await store
      .context(worldId)
      .history(a, "has", "out", Number.MAX_SAFE_INTEGER),
  ).toHaveLength(6);

  // 物品の呼称が変わると、保持者の要約も同じ確定で追従する。
  const context = store.context(worldId);
  const node = (await context.node(camera))!;
  await store.commit(await store.claim(worldId, randomUUID()), context, {
    commitId: randomUUID(),
    at: 6,
    changes: {
      nodes: [],
      revisions: [{ ...node, text: "折り畳み脚つきの写真機" }],
      edges: [],
      endEdges: [],
    },
  });
  expect(
    (await summaries(worldId)).filter((s) => s.text.includes(camera)),
  ).toEqual([
    {
      subject: a,
      text: `保持している物品\n- 折り畳み脚つきの写真機〔${camera}〕`,
    },
  ]);
});
