import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import {
  WorldStore,
  WorldConflict,
  type Change,
  type WorldNode,
  type WorldEdge,
} from "@gestaloka/server/world";

const databases = connectDatabases();
const store = new WorldStore(databases.graph);
const worlds: string[] = [];
const node = (kind: "existence" | "script", text: string): WorldNode => ({
  id: randomUUID(),
  kind,
  text,
});
const edge = (
  kind: WorldEdge["kind"],
  source: WorldNode,
  target: WorldNode,
  role?: "content" | "about",
): WorldEdge => ({
  id: randomUUID(),
  kind,
  source: source.id,
  target: target.id,
  period: { from: 0 },
  ...(role === undefined ? {} : { role }),
});
const changes = (
  nodes: WorldNode[] = [],
  edges: WorldEdge[] = [],
  endEdges: string[] = [],
): Change => ({ nodes, revisions: [], edges, endEdges });

async function world() {
  const worldId = randomUUID();
  worlds.push(worldId);
  return {
    worldId,
    lease: await store.claim(worldId, randomUUID()),
    context: store.context(worldId),
  };
}
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

test("statusの対象接続で場所・所属を表し、所有・現実・解釈を独立して保存する", async () => {
  const { worldId, lease, context } = await world();
  const actor = node("existence", "村民A"),
    village = node("existence", "村B"),
    sword = node("existence", "剣");
  const location = node("script", "この村にいる"),
    belonging = node("script", "この村の村民である");
  const broken = node("script", "刃が折れている"),
    sacred = node("script", "聖なる剣である");
  const connections = [
    edge("status", actor, location, "content"),
    edge("status", location, village, "about"),
    edge("status", actor, belonging, "content"),
    edge("status", belonging, village, "about"),
    edge("has", actor, sword),
    edge("status", sword, broken, "content"),
    edge("interpret", actor, sacred, "content"),
    edge("interpret", sacred, sword, "about"),
  ];
  await store.commit(lease, context, {
    commitId: randomUUID(),
    at: 0,
    changes: changes(
      [actor, village, sword, location, belonging, broken, sacred],
      connections,
    ),
  });
  const read = store.context(worldId);
  expect(await read.relations(actor.id, "has", "out", 0)).toHaveLength(1);
  expect(await read.relations(actor.id, "status", "out", 0)).toHaveLength(2);
  expect(await read.relations(location.id, "status", "out", 0)).toMatchObject([
    { target: village.id, role: "about" },
  ]);
  expect(await read.relations(sword.id, "status", "out", 0)).toMatchObject([
    { target: broken.id },
  ]);
  expect(await read.relations(sacred.id, "interpret", "out", 0)).toMatchObject([
    { target: sword.id },
  ]);
});

test("発生・多段の作用・循環を保存でき、内部の読取は観測を追加しない", async () => {
  const { worldId, lease, context } = await world();
  const river = node("existence", "川"),
    bridge = node("existence", "橋");
  const flood: WorldNode = {
    id: randomUUID(),
    kind: "event",
    text: "増水した",
    period: { from: 1 },
  };
  const connections = [
    edge("happen", river, flood),
    edge("effect", flood, river),
    edge("effect", river, bridge),
    edge("effect", bridge, river),
  ];
  await store.commit(lease, context, {
    commitId: randomUUID(),
    at: 1,
    changes: changes([river, bridge, flood], connections),
  });
  const read = store.context(worldId);
  expect(await read.node(flood.id)).toEqual(flood);
  expect(await read.relations(bridge.id, "effect", "in", 1)).toMatchObject([
    { source: river.id },
  ]);
  expect(await read.relations(river.id, "effect", "in", 1)).toHaveLength(2);
  expect(await read.relations(river.id, "see", "out", 1)).toEqual([]);
  const observation = edge("see", bridge, flood);
  await store.commit(lease, read, {
    commitId: randomUUID(),
    at: 1,
    changes: changes([], [observation]),
  });
  expect(
    await store.context(worldId).relations(bridge.id, "see", "out", 1),
  ).toMatchObject([observation]);
});

test("イベント期間の改訂でも同一性と過去の内容を保ち、古い読取からは確定できない", async () => {
  const { worldId, lease } = await world();
  const ongoing: WorldNode = {
    id: randomUUID(),
    kind: "event",
    text: "増水",
    period: { from: 1 },
  };
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 2,
    changes: changes([ongoing]),
  });
  const stale = store.context(worldId);
  await stale.node(ongoing.id);
  const finished: WorldNode = { ...ongoing, period: { from: 1, until: 10 } };
  const input = {
    commitId: randomUUID(),
    at: 10,
    changes: { ...changes(), revisions: [finished] },
  };
  const receipt = await store.commit(lease, store.context(worldId), input);
  expect(await store.commit(lease, store.context(worldId), input)).toEqual(
    receipt,
  );
  expect(await store.context(worldId).node(ongoing.id)).toEqual(finished);
  expect(await store.context(worldId).node(ongoing.id, 9)).toEqual(ongoing);
  expect(await store.context(worldId).node(ongoing.id, 1)).toBeUndefined();
  await expect(
    store.commit(lease, stale, {
      commitId: randomUUID(),
      at: 10,
      changes: changes(),
    }),
  ).rejects.toBeInstanceOf(WorldConflict);
});

test("区間途中だけの作用と循環を取得し、保存した依存から上流の変化を検出する", async () => {
  const { worldId, lease } = await world();
  const upstream = node("existence", "上流"),
    middle = node("existence", "途中"),
    target = node("existence", "対象");
  const transient = {
    ...edge("effect", upstream, middle),
    period: { from: 100, until: 200 },
  };
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 0,
    changes: changes(
      [upstream, middle, target],
      [
        transient,
        edge("effect", middle, target),
        edge("effect", target, middle),
      ],
    ),
  });
  const context = store.context(worldId);
  const paths = await context.effects(target.id, 0, 1000);
  expect(paths).toHaveLength(3);
  expect(
    paths
      .flatMap((part) => part.incoming)
      .some((relation) => relation.id === transient.id),
  ).toBe(true);
  const restored = store.context(worldId, context.dependencies);
  await restored.validate();
  const state = node("script", "上流の状態が変わった");
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 500,
    changes: changes([state], [edge("status", upstream, state, "content")]),
  });
  await expect(restored.validate()).rejects.toBeInstanceOf(WorldConflict);
});

test("解釈の三項接続と成立期間を一括検証し、不完全な確定をロールバックする", async () => {
  const { worldId, lease } = await world();
  const actor = node("existence", "主体"),
    target = node("existence", "対象"),
    content = node("script", "意味づけ");
  const owned = edge("interpret", actor, content, "content"),
    about = edge("interpret", content, target, "about");
  await expect(
    store.commit(lease, store.context(worldId), {
      commitId: randomUUID(),
      at: 0,
      changes: changes([actor, target, content], [owned]),
    }),
  ).rejects.toThrow("主体・内容・対象");
  expect(await store.context(worldId).node(actor.id)).toBeUndefined();
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 0,
    changes: changes([actor, target, content], [owned, about]),
  });
  await expect(
    store.commit(lease, store.context(worldId), {
      commitId: randomUUID(),
      at: 10,
      changes: changes([], [], [about.id]),
    }),
  ).rejects.toThrow("期間");
  expect(
    (await store.context(worldId).edge(about.id))?.period.until,
  ).toBeUndefined();
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 10,
    changes: changes([], [], [owned.id, about.id]),
  });
  expect(
    await store.context(worldId).relations(actor.id, "interpret", "out", 1000),
  ).toEqual([]);
  expect(
    await store.context(worldId).history(actor.id, "interpret", "out", 1000),
  ).toHaveLength(1);
});

test("受容した範囲と版をサーバーで記録し、照会や他者の観測だけを新しい作用にしない", async () => {
  const { worldId, lease } = await world();
  const observer = node("existence", "観測者"),
    object = node("existence", "対象"),
    state = node("script", "表面の状態");
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 0,
    changes: changes(
      [observer, object, state],
      [edge("status", object, state, "content")],
    ),
  });
  const sight = {
    ...edge("see", observer, object),
    text: "表面を見た",
    observation: {
      aspect: "表面",
      through: 0,
      sourceIds: [object.id],
      pathIds: [],
      versions: { forged: 999 },
    },
  };
  const input = {
    commitId: randomUUID(),
    at: 0,
    changes: changes([], [sight]),
  };
  const receipt = await store.commit(lease, store.context(worldId), input);
  const recorded = receipt.changes.edges[0]!.observation!;
  expect(recorded.versions).not.toHaveProperty("forged");
  expect(
    await store.commit(lease, store.context(worldId), {
      ...input,
      changes: receipt.changes,
    }),
  ).toEqual(receipt);
  expect(
    (await store.context(worldId).observations(observer.id, 0))[0],
  ).toMatchObject({ sourceChanged: false, timeAdvanced: false });
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 0,
    changes: changes(
      [],
      [{ ...edge("see", object, observer), text: "受容した" }],
    ),
  });
  expect(
    (await store.context(worldId).observations(observer.id, 0))[0]
      ?.sourceChanged,
  ).toBe(false);
  expect(
    (await store.context(worldId).observations(observer.id, 1))[0],
  ).toMatchObject({ sourceChanged: false, timeAdvanced: true });
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 1,
    changes: {
      ...changes(),
      revisions: [{ ...state, text: "表面の状態が変わった" }],
    },
  });
  expect(
    (await store.context(worldId).observations(observer.id, 1))[0]
      ?.sourceChanged,
  ).toBe(true);
  const unchanged = await store.context(worldId).node(object.id);
  expect(unchanged).toEqual(object);
});

test("空の関係取得後の追加を検出し、古い文脈による確定を拒否する", async () => {
  const { worldId, lease, context } = await world();
  const actor = node("existence", "人");
  await store.commit(lease, context, {
    commitId: randomUUID(),
    at: 0,
    changes: changes([actor]),
  });
  const stale = store.context(worldId);
  expect(await stale.relations(actor.id, "status", "out", 1)).toEqual([]);
  const state = node("script", "濡れている");
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 1,
    changes: changes([state], [edge("status", actor, state, "content")]),
  });
  const invented = node("script", "未確定の候補");
  const commitId = randomUUID();
  await expect(
    store.commit(lease, stale, {
      commitId,
      at: 1,
      changes: changes([invented]),
    }),
  ).rejects.toBeInstanceOf(WorldConflict);
  expect(await store.context(worldId).node(invented.id)).toBeUndefined();
  expect(await store.receipt(worldId, commitId)).toBeUndefined();
});

test("見つからなかったノードの追加と、同一文脈の異なる版の混在を検出する", async () => {
  const { worldId, lease } = await world();
  const missing = node("existence", "未記録だった人");
  const stale = store.context(worldId);
  expect(await stale.node(missing.id)).toBeUndefined();
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 0,
    changes: changes([missing]),
  });
  await expect(stale.node(missing.id)).rejects.toBeInstanceOf(WorldConflict);
  await expect(
    store.commit(lease, stale, {
      commitId: randomUUID(),
      at: 0,
      changes: changes(),
    }),
  ).rejects.toBeInstanceOf(WorldConflict);
});

test("独立した局所文脈は並行確定でき、同じ依存を変更する候補は一つだけが確定する", async () => {
  const { worldId, lease, context } = await world();
  const a = node("existence", "A"),
    b = node("existence", "B");
  await store.commit(lease, context, {
    commitId: randomUUID(),
    at: 0,
    changes: changes([a, b]),
  });
  const append = async (
    target: WorldNode,
    read: ReturnType<typeof store.context>,
  ) => {
    const state = node("script", randomUUID());
    const otherLease = await store.claim(worldId, randomUUID());
    return store.commit(otherLease, read, {
      commitId: randomUUID(),
      at: 1,
      changes: changes([state], [edge("status", target, state, "content")]),
    });
  };
  const ca = store.context(worldId),
    cb = store.context(worldId);
  await ca.relations(a.id, "status", "out", 1);
  await cb.relations(b.id, "status", "out", 1);
  expect(await Promise.all([append(a, ca), append(b, cb)])).toHaveLength(2);
  const c1 = store.context(worldId),
    c2 = store.context(worldId);
  await c1.relations(a.id, "status", "out", 1);
  await c2.relations(a.id, "status", "out", 1);
  const results = await Promise.allSettled([append(a, c1), append(a, c2)]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const failure = results.find((result) => result.status === "rejected");
  expect(
    failure?.status === "rejected" && failure.reason instanceof WorldConflict,
  ).toBe(true);
});

test("新しい試行を有効にした後は古いワーカーから確定できない", async () => {
  const { worldId, lease, context } = await world();
  const next = await store.claim(worldId, lease.runId);
  expect(next.generation).toBeGreaterThan(lease.generation);
  await expect(
    store.commit(lease, context, {
      commitId: randomUUID(),
      at: 0,
      changes: changes([node("existence", "古い候補")]),
    }),
  ).rejects.toBeInstanceOf(WorldConflict);
  await store.commit(next, store.context(worldId), {
    commitId: randomUUID(),
    at: 0,
    changes: changes([node("existence", "新しい候補")]),
  });
});

test("同じ確定の同時再送・接続後の復旧でreceiptを再利用し、異なる内容は拒否する", async () => {
  const { worldId, lease } = await world();
  const data = changes([node("existence", "人")]);
  const input = { commitId: randomUUID(), at: 0, changes: data };
  const [first, replay] = await Promise.all([
    store.commit(lease, store.context(worldId), input),
    store.commit(lease, store.context(worldId), input),
  ]);
  expect(replay).toEqual(first);
  const another = connectDatabases();
  try {
    expect(
      await new WorldStore(another.graph).receipt(worldId, input.commitId),
    ).toEqual(first);
  } finally {
    await another.close();
  }
  await expect(
    store.commit(lease, store.context(worldId), { ...input, at: 1 }),
  ).rejects.toBeInstanceOf(WorldConflict);
});

test("関係の終了後も過去の状態を参照でき、終了を含む確定も再送できる", async () => {
  const { worldId, lease } = await world();
  const actor = node("existence", "人"),
    before = node("script", "濡れている"),
    after = node("script", "乾いている");
  const old = edge("status", actor, before, "content");
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 0,
    changes: changes([actor, before], [old]),
  });
  const replacement = {
    ...edge("status", actor, after, "content"),
    period: { from: 10 },
  };
  const input = {
    commitId: randomUUID(),
    at: 10,
    changes: changes([after], [replacement], [old.id]),
  };
  const first = await store.commit(lease, store.context(worldId), input);
  expect(await store.commit(lease, store.context(worldId), input)).toEqual(
    first,
  );
  expect(
    await store.context(worldId).relations(actor.id, "status", "out", 9),
  ).toMatchObject([{ target: before.id }]);
  expect(
    await store.context(worldId).relations(actor.id, "status", "out", 10),
  ).toMatchObject([{ target: after.id }]);
  expect(await store.context(worldId).node(before.id)).toEqual(before);
});

test("異なる世界への参照と不正な関係形式は全差分をロールバックする", async () => {
  const first = await world(),
    second = await world();
  const elsewhere = node("existence", "別の名前空間");
  await store.commit(first.lease, first.context, {
    commitId: randomUUID(),
    at: 0,
    changes: changes([elsewhere]),
  });
  const actor = node("existence", "人"),
    state = node("script", "状態");
  for (const invalid of [
    edge("effect", actor, elsewhere),
    edge("effect", actor, state),
  ]) {
    const commitId = randomUUID();
    await expect(
      store.commit(second.lease, store.context(second.worldId), {
        commitId,
        at: 0,
        changes: changes([actor, state], [invalid]),
      }),
    ).rejects.toThrow();
    expect(await store.context(second.worldId).node(actor.id)).toBeUndefined();
    expect(await store.receipt(second.worldId, commitId)).toBeUndefined();
  }
});
