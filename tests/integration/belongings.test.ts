import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { WorldStore, type WorldNode } from "@gestaloka/server/world";
import {
  changeBelongings,
  readBelongings,
  type BelongingOp,
} from "@gestaloka/server/belongings";
import { locationRecords } from "../../packages/server/src/world/locations.js";

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
test("所在地は古いシーン時刻を補正し、旧所在地と参照を閉じて再送でも増やさない", async () => {
  const { worldId, ids, apply } = await world("人物", "室内", "門前"),
    [person, inside, gate] = ids as [string, string, string];
  await apply(100, [
    { type: "locate", subjectId: person, text: "室内", aboutIds: [inside] },
  ]);
  const commit = randomUUID(),
    moved = await apply(
      10,
      [{ type: "locate", subjectId: person, text: "門前", aboutIds: [gate] }],
      commit,
    );
  expect(moved.at).toBe(100);
  expect(
    (await locationRecords(store.context(worldId), person)).map((r) => r.text),
  ).toEqual(["門前"]);
  // 終わった所在記録は集計にだけ使い、有効な記録だけを読み出す。
  expect(await store.context(worldId).locations(person)).toMatchObject({
    latest: 100,
    last: 100,
    active: [{ target: expect.any(String), period: { from: 100 } }],
  });
  expect(
    await apply(
      10,
      [{ type: "locate", subjectId: person, text: "門前", aboutIds: [gate] }],
      commit,
    ),
  ).toEqual(moved);
  const history = (
    await store
      .context(worldId)
      .history(person, "status", "out", Number.MAX_SAFE_INTEGER)
  ).filter((e) => e.text === "location");
  expect(history).toHaveLength(2);
  const old = history.find((e) => e.period.until !== undefined)!;
  expect(
    (
      await store
        .context(worldId)
        .history(old.target, "status", "out", Number.MAX_SAFE_INTEGER)
    ).every((e) => e.period.until === 100),
  ).toBe(true);
  expect(await locationRecords(store.context(worldId), person)).toMatchObject([
    { text: "門前", at: 100, aboutIds: [gate] },
  ]);
});
test("同じ所在地の版からの同時更新は一方だけを確定する", async () => {
  // 所在の本文は滞在先の呼び名になるので、別々の場所への移動で競合させる。
  const { worldId, ids, apply } = await world("人物", "場所", "窓際", "奥"),
    [person, place, ...targets] = ids as [string, string, string, string];
  await apply(100, [
    { type: "locate", subjectId: person, text: "入口", aboutIds: [place] },
  ]);
  const context = store.context(worldId);
  await locationRecords(context, person);
  const results = await Promise.allSettled(
    targets.map(async (target) =>
      changeBelongings(store, await store.claim(worldId, randomUUID()), {
        commitId: randomUUID(),
        at: 20,
        dependencies: context.dependencies,
        ops: [
          {
            type: "locate",
            subjectId: person,
            text: "移動する",
            aboutIds: [target],
          },
        ],
      }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect(await locationRecords(store.context(worldId), person)).toHaveLength(1);
});
afterAll(async () => {
  for (const worldId of worlds)
    await databases.graph.executeQuery(
      "MATCH (n) WHERE n.worldId = $worldId DETACH DELETE n",
      { worldId },
    );
  await databases.close();
});

test("工具を倉庫へ預けると倉庫が持ち、携行と保管に二重計上しない", async () => {
  const { worldId, ids, apply, read } = await world("A", "B", "共同倉庫");
  const [a, b, storage] = ids as [string, string, string];
  const created = await apply(1, [
    { type: "create", label: "工具", holder: a, basis: "初期設定" },
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

  const stock = [{ id: tool, label: "工具" }];
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

test("技能枠は管理編集・同時取得にも適用し、超過中の発展・統合、履歴と再送を保つ", async () => {
  const { worldId, ids, apply, read } = await world("船乗り", "同行者");
  const [person, other] = ids as [string, string];
  const learn = (text: string, consumeSkillIds?: string[]): BelongingOp => ({
    type: "learn",
    person,
    text,
    basis: "航行の実習",
    ...(consumeSkillIds ? { consumeSkillIds } : {}),
  });
  await apply(
    1,
    Array.from({ length: 49 }, (_, i) => learn(`実習${i}`)),
  );
  const compete = (ops: BelongingOp[][], at: number) =>
    Promise.allSettled(ops.map((list) => apply(at, list)));
  const last = await compete([[learn("星を読む")], [learn("雲を読む")]], 2);
  expect(last.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const full = await read(person);
  expect(full.skillCapacity).toEqual({ usedSlots: 50, limitSlots: 50 });
  await expect(apply(3, [learn("波を読む")])).rejects.toMatchObject({
    code: "SKILL_CAPACITY_EXCEEDED",
  });
  const target = randomUUID();
  await expect(
    store.commit(
      await store.claim(worldId, randomUUID()),
      store.context(worldId),
      {
        commitId: randomUUID(),
        at: 3,
        management: {
          editorId: randomUUID(),
          reason: "検証",
          requestHash: "0".repeat(64),
        },
        changes: {
          nodes: [{ id: target, kind: "script", text: "潮を読む" }],
          revisions: [],
          edges: [
            {
              id: randomUUID(),
              kind: "has",
              role: "skill",
              source: person,
              target,
              period: { from: 3 },
            },
          ],
          endEdges: [],
        },
      },
    ),
  ).rejects.toMatchObject({ code: "SKILL_CAPACITY_EXCEEDED" });
  const [first, second] = full.skills.map((s) => s.id) as [string, string];
  await store.configureInventory(worldId, false, { skillSlots: 48 });
  // 旧版の要約は有効な技能関係から件数を引き継ぐ。
  await databases.graph.executeQuery(
    "MATCH (:WorldNode {worldId:$worldId,id:$person})-[:has {role:'summary'}]->(s) REMOVE s.skillSlots",
    { worldId, person },
  );
  await expect(apply(3, [learn("波を読む")])).rejects.toMatchObject({
    capacity: { usedSlots: 50, limitSlots: 48 },
  });
  // 同じ記述を別の人物が習得している場合も、その人物の関係は保持する。
  await store.commit(
    await store.claim(worldId, randomUUID()),
    store.context(worldId),
    {
      commitId: randomUUID(),
      at: 3,
      management: {
        editorId: randomUUID(),
        reason: "指導",
        requestHash: "1".repeat(64),
      },
      changes: {
        nodes: [],
        revisions: [],
        endEdges: [],
        edges: [
          {
            id: randomUUID(),
            kind: "has",
            role: "skill",
            source: other,
            target: first,
            period: { from: 3 },
          },
        ],
      },
    },
  );
  const evolved = await compete(
    [[learn("星の動きを読む", [first])], [learn("星座を読む", [first])]],
    4,
  );
  expect(evolved.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const current = await read(person);
  expect(current.skillCapacity).toEqual({ usedSlots: 50, limitSlots: 48 });
  expect((await read(other)).skills.map((s) => s.id)).toEqual([first]);
  await expect(apply(5, [learn("重なる発展", [first])])).rejects.toThrow(
    "本人が現在",
  );
  const combine = [
    learn("星と潮から夜の進路を選ぶ", [current.skills.at(-1)!.id, second]),
  ];
  const request = randomUUID(),
    done = await apply(5, combine, request);
  expect(await apply(5, combine, request)).toEqual(done);
  expect((await read(person)).skillCapacity).toEqual({
    usedSlots: 49,
    limitSlots: 48,
  });
  expect((await read(person, 3)).skills.map((s) => s.id)).toContain(first);
}, 90000);

test("技能の習得・範囲変更・除去の前後で、当時の一覧と根拠を参照できる", async () => {
  const { worldId, ids, apply, read } = await world("A");
  const [a] = ids as [string];
  const learned = await apply(10, [
    { type: "learn", person: a, text: "刃物を研げる", basis: "初期設定" },
  ]);
  const skill = learned.changes.nodes[0]!.id;
  // 習得済みと同じ本文の習得は、技能を増やさず既存の技能として扱う。
  await apply(15, [
    { type: "learn", person: a, text: "刃物を研げる", basis: "再び研いだ" },
  ]);
  expect((await read(a)).skills).toMatchObject([
    { id: skill, basis: "初期設定" },
  ]);
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

test("旧版が役割holdで記録した関係を、起動時に役割なしのhasへ書き換える", async () => {
  const { worldId, ids, read } = await world("A", "Aの古い帽子");
  const [a, hat] = ids as [string, string];
  const id = randomUUID();
  const legacy = {
    id,
    kind: "has",
    source: a,
    target: hat,
    role: "hold",
    period: { from: 1 },
  };
  await databases.graph.executeQuery(
    `MATCH (s:WorldNode {worldId:$worldId,id:$a}),(t:WorldNode {worldId:$worldId,id:$hat})
     CREATE (s)-[:has {worldId:$worldId,id:$id,data:$data,validFrom:1,role:'hold'}]->(t)`,
    { worldId, a, hat, id, data: JSON.stringify(legacy) },
  );
  await store.setup();
  const { role, ...current } = legacy;
  expect(role).toBe("hold");
  expect(await store.context(worldId).edge(id)).toEqual(current);
  expect((await read(a)).items).toMatchObject([{ id: hat }]);
});

test("事実を追加登録し直しても、事実と要約が重複しない", async () => {
  const { worldId, ids, read } = await world("A", "Aの家", "Aの写真機");
  const [a, home, camera] = ids as [string, string, string];
  const has = (source: string, target: string, role?: "use") => ({
    id: randomUUID(),
    kind: "has" as const,
    source,
    target,
    ...(role ? { role } : {}),
    text: "既存の確定記述から",
    period: { from: 5 },
  });
  // 管理編集と同じく、要求IDを実行と確定の識別に使う。
  const commit = async (commitId: string, edges: ReturnType<typeof has>[]) =>
    store.commit(await store.claim(worldId, commitId), store.context(worldId), {
      commitId,
      at: 5,
      changes: { nodes: [], revisions: [], edges, endEdges: [] },
    });
  const takeover = { id: randomUUID(), edges: [has(a, camera)] };
  const receipt = await commit(takeover.id, takeover.edges);
  expect(await commit(takeover.id, takeover.edges)).toEqual(receipt);
  await commit(randomUUID(), [has(a, home, "use")]);

  expect(await read(a)).toMatchObject({
    items: [{ id: camera }],
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
  ).toHaveLength(4);

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

test("個数つきの物品は一部を渡すと分かれ、渡した先の同じ物品へ足され、使い切ると持ち物から消える", async () => {
  const { worldId, ids, apply, read } = await world("A", "B");
  const [a, b] = ids as [string, string];
  const created = await apply(0, [
    { type: "create", label: "矢", count: 10, holder: a, basis: "初期設定" },
  ]);
  // 同じ時点の物品は並びが決まらないので、成立の時点を分ける。
  const arrows = created.changes.nodes[0]!.id,
    bag = (
      await apply(1, [
        { type: "create", label: "水袋", holder: a, basis: "初期設定" },
      ])
    ).changes.nodes[0]!.id;
  const give = (at: number, count?: number) =>
    apply(at, [
      {
        type: "move",
        item: arrows,
        from: a,
        to: b,
        ...(count ? { count } : {}),
        basis: "渡した",
      },
    ]);
  // 渡した3本はBのもとで別の物品になる。
  await give(2, 3);
  expect((await read(a)).items).toMatchObject([
    { id: arrows, label: "矢", count: 7 },
    { id: bag, label: "水袋" },
  ]);
  const given = (await read(b)).items[0]!;
  expect(given).toMatchObject({ label: "矢", count: 3 });
  expect(given.id).not.toBe(arrows);
  // 呼称が同じ物品へは足して、物品を増やさない。全部を渡すと元の物品は持ち物から消える。
  await give(3, 2);
  expect((await read(a)).items[0]).toMatchObject({ id: arrows, count: 5 });
  expect((await read(b)).items).toMatchObject([{ id: given.id, count: 5 }]);
  await give(4);
  expect((await read(a)).items).toMatchObject([{ id: bag }]);
  expect((await read(b)).items).toMatchObject([{ id: given.id, count: 10 }]);
  expect(
    (await summaries(worldId)).find((s) => s.subject === b)?.text,
  ).toContain(`- 矢 ×10〔${given.id}〕`);
  // 個数のない物品と、持っている数を超える個数は拒否する。
  await expect(
    apply(5, [{ type: "remove", id: bag, count: 1 }]),
  ).rejects.toThrow("個数");
  await expect(
    apply(5, [
      {
        type: "move",
        item: given.id,
        from: b,
        to: a,
        count: 11,
        basis: "返す",
      },
    ]),
  ).rejects.toThrow("個数");
  // 個数を指定した消費は個数を減らし、0になれば持ち物から消える。
  await apply(6, [{ type: "remove", id: given.id, count: 9 }]);
  expect((await read(b)).items).toMatchObject([{ id: given.id, count: 1 }]);
  await apply(7, [{ type: "remove", id: given.id, count: 1 }]);
  expect((await read(b)).items).toEqual([]);
  await apply(9, [{ type: "update", id: bag, count: 2 }]);
  expect((await read(a)).items).toMatchObject([
    { id: bag, label: "水袋", count: 2 },
  ]);
});
