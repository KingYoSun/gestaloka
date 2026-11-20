import { randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { beforeAll, afterAll, afterEach, expect, test, vi } from "vitest";
import { PlayCommand, WaitingEvent } from "@gestaloka/contracts";
import { WorldAccess } from "@gestaloka/server/access";
import { decisionSettings } from "../../packages/server/src/llm/config.js";
import { changeBelongings, readBelongings } from "@gestaloka/server/belongings";
import { derivedId } from "@gestaloka/server/world";
import { BotPlay } from "@gestaloka/server/play";
import { createApp } from "../../apps/api/src/app.js";
import { playerCli } from "../support/player-cli.js";
import { join, resolve } from "node:path";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";

const isolated = isolatedDatabases();
let runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  access: WorldAccess,
  auth: Awaited<ReturnType<typeof fixtureAuth>>;
const graphs: string[] = [];
// 成功範囲が面数未満という制約の中で、実質的に必ず成功するダイス設定。
const sure = { sides: 2147483647, successThrough: 2147483646 };
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
    view: (i: number, targetId: string, viewers: "all" | string[]) =>
      access.setViewers(
        people[i]!.id,
        world,
        { requestId: randomUUID(), targetId, viewers },
        actors[i],
      ),
  };
}

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

test("時間差の物品受け渡しは両側の変更を受領後に確定する", async () => {
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
        owner: seller,
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
      { type: "transfer", item, to: buyer, count: 1, basis: "受け渡し" },
    ],
  });
  expect(
    (await readBelongings(f.store.context(f.graph), seller)).items,
  ).toMatchObject([{ id: item, count: 3 }]);
  expect(
    await f.send(2, { command: "receive", applicationId, accept: true }),
  ).toMatchObject({ state: "accepted" });
  expect(
    (await readBelongings(f.store.context(f.graph), seller)).items,
  ).toMatchObject([{ id: item, count: 2 }]);
  expect(
    (await readBelongings(f.store.context(f.graph), buyer)).items,
  ).toMatchObject([{ label: "結び紐", count: 1, owners: [{ id: buyer }] }]);
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
      owner: seller,
      basis: "試験用",
    },
    {
      type: "create",
      label: "銅貨",
      count: 5,
      holder: buyer,
      owner: buyer,
      basis: "試験用",
    },
    {
      type: "create",
      label: "銅貨",
      count: 5,
      holder: other,
      owner: other,
      basis: "試験用",
    },
    {
      type: "create",
      label: "銅貨",
      count: 8,
      holder: buyer,
      owner: buyer,
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
      owner: seller,
      basis: "販売する在庫",
    },
  ]);
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
        count: 3,
      }),
    ]),
  );
  expect(
    (await readBelongings(f.store.context(f.graph), storage!.id)).items,
  ).toMatchObject([
    { label: "銅貨", seriesId, count: 2, owners: [{ id: seller }] },
  ]);
  expect(
    await f.store.context(f.graph).node(orders[1 - winner]!.paymentItemId),
  ).toMatchObject({ count: 5, seriesId });
  expect(
    (await access.notices(f.people[0]!.id, f.world, seller)).notices,
  ).toHaveLength(1);
  await expect(
    f.send(winner + 1, {
      command: "update",
      text: "銅貨の個数を書き換える",
      dependencies: [],
      operations: [
        { type: "update", id: orders[winner]!.paymentItemId, count: 10 },
      ],
    }),
  ).rejects.toMatchObject({ code: "UPDATE_REJECTED" });
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
    expect(players.items).toContainEqual(
      expect.objectContaining({ name: "人物2", place: "離れた場所" }),
    );
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
  } finally {
    await cli.close();
    await app.close();
  }
});

test("シーン外で待機する本人を接触で起こし、在席切れと再開を区別する", async () => {
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
  const now = new Date(Date.now() + 601000);
  vi.spyOn(access.botPlay, "now").mockImplementation(() => now);
  await expect(
    f.send(2, { command: "contact", targetId: actor }),
  ).rejects.toMatchObject({ code: "PARTNER_NOT_AVAILABLE" });
  await access.waiting(user, f.world, actor, connection, true);
  await f.send(2, { command: "contact", targetId: actor });
  expect((await f.status(2)).sessionId).toBe((await f.status(1)).sessionId);
  expect(f.calls).not.toHaveBeenCalled();
});

test("プレイヤーの一覧は、待機中で接触を受けられるプレイヤーだけを所在地を問わず返す", async () => {
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
  await isolated.databases.postgres.query(
    "UPDATE player_waiting SET last_seen=$3 WHERE world_id=$1 AND actor_id=$2",
    [f.world, f.actors[0], new Date(Date.now() - 601000)],
  );
  expect(await list()).toEqual({ items: [], next: null });
  await expect(look(f.place)).rejects.toMatchObject({
    code: "MATERIAL_NOT_AVAILABLE",
  });
  expect(f.calls).not.toHaveBeenCalled();
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
            role: "hold",
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
    ).expire(f.world);
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
    ownerId: f.actors[1],
  });
  await f.send(1, { command: "end-turn" });
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
      await f.store
        .context(f.graph)
        .relations(npc, "has", "in", Number.MAX_SAFE_INTEGER)
    ).some((e) => e.source === f.actors[1] && !e.role),
  ).toBe(true);
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
            role: "hold",
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
          headers: { authorization: `Bearer ${credentials.secret}` },
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

test("目撃した手渡しには対象・所有・保持が残り、合流前の取得結果から参照は渡らない", async () => {
  const f = await fixture(),
    item = randomUUID(),
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
        nodes: [{ id: item, kind: "existence", text: "試験用の帯" }],
        edges: [
          {
            id: randomUUID(),
            kind: "has",
            source: a,
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
    { type: "move", from: null, to: a, item, basis: "取得" },
  ]);
  expect(picked.items).toMatchObject([
    { itemId: item, holding: { fromId: null, toId: a } },
  ]);
  await f.send(1, { command: "contact", targetId: a });
  await f.move(2, f.place);
  await f.send(2, { command: "contact", targetId: a });
  const give = await update("渡す", [
    { type: "transfer", item, to: b, basis: "譲渡" },
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
      ownership: { fromIds: [a], toId: b },
      holding: { fromId: a, toId: b },
    },
  ]);
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
  f.calls.mockImplementation(async (id) =>
    answer(id, { sides: 6, successThrough: 3 }),
  );
  const requestId = randomUUID(),
    uncertain = await attempt(items[1]!, f.actors[1]!, requestId);
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
  const duplicate = apply();
  try {
    await vi.waitFor(() => expect(reviews).toBe(2));
  } finally {
    release();
  }
  const [a, b] = await Promise.all([first, duplicate]);
  expect(a.state).toBe("approved");
  expect(a).toEqual(b);
  expect(profiles).toBe(1);
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
        shown: boolean;
      }>;
  const unset = await policy({ operation: "creationPolicy.read" });
  expect(unset.criteria).toBe("");
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
    // 材料は、状態の本文とそれが何についての記述かに絞る。依存版と関係の属性は渡さない。
    const input = JSON.parse(String(messages[1]!.content));
    expect(Object.keys(input)).toEqual([
      "premise",
      "actor",
      "text",
      "changes",
      "nodes",
    ]);
    for (const node of input.nodes)
      for (const state of node.states)
        expect(Object.keys(state)).toEqual(["node", "about"]);
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
  expect(
    await policy({
      operation: "creationPolicy.put",
      criteria: "この世界だけの基準",
      reason: "世界ごとの基準を設定",
    }),
  ).toMatchObject({ shown: true });
  expect((await f.status(0)).creationCriteria).toBe("この世界だけの基準");
  await policy({
    operation: "creationPolicy.put",
    criteria: "この世界だけの基準",
    shown: false,
    reason: "基準を非表示",
  });
  expect((await f.status(0)).creationCriteria).toBeUndefined();
  f.calls.mockImplementation(async (id, _role, messages) => {
    expect(messages[0]?.content).toContain("この世界だけの基準");
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

test("利用・所有する保管先には、その場にいるときだけ本人の判断で出し入れでき、拒否の理由に対象の名前が出る", async () => {
  const f = await fixture();
  const shared = randomUUID(),
    home = randomUUID(),
    others = randomUUID(),
    loose = randomUUID(),
    state = randomUUID();
  const has = (source: string, target: string) => ({
    id: randomUUID(),
    kind: "has" as const,
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
          { id: state, kind: "script", text: "背が高い" },
        ],
        edges: [
          has(f.actors[0]!, home),
          has(f.actors[2]!, others),
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
  ]);
  const read = () => readBelongings(f.store.context(f.graph), f.actors[0]!);
  const before = await read(),
    axe = before.items.find((i) => i.label === "斧")!.id,
    hoe = before.items.find((i) => i.label === "鍬")!.id,
    rope = before.storages[0]!.items[0]!.id;
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
  await expect(move(axe, f.actors[0]!, loose)).rejects.toMatchObject({
    code: "AUTHORITY_REQUIRED",
    message: expect.stringContaining(`「誰のものでもない箱」（ID: ${loose}）`),
  });
  await expect(move(axe, f.actors[0]!, others)).rejects.toMatchObject({
    code: "REMOTE_RECEIVING",
    message: expect.stringContaining(`「人物2」（ID: ${f.actors[2]}）`),
  });
  await expect(
    update({ operations: [{ type: "update", id: state, text: "改める" }] }),
  ).rejects.toMatchObject({
    code: "BELONGING_NOT_RECORDED",
    message: expect.stringContaining("changesのrevisions"),
  });
  // 保管先のある場所にいれば、受領もダイスもなく確定する。
  for (const place of [shared, home]) {
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
    } else await move(hoe, f.actors[0]!, home);
  }
  const after = await read();
  expect(after.items.map((i) => i.label)).toEqual(["縄"]);
  expect(
    after.storages.map((s) => [s.label, s.items.map((i) => i.label)]),
  ).toEqual([
    ["共同倉庫", ["斧"]],
    ["自分の家", ["鍬"]],
  ]);
  // 本人の状態は、changesで本文を改め、関係を終えられる。
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
  await update({
    changes: { nodes: [], revisions: [], edges: [], endEdges: [content] },
  });
  expect(
    (await f.store.context(f.graph).edge(content))?.period.until,
  ).toBeDefined();
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
            role: "hold",
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
  expect(JSON.stringify((await f.status(1)).entries)).toContain(items[0]!.id);
  expect(JSON.stringify((await f.status(2)).entries)).not.toContain(
    items[0]!.id,
  );
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
  ).toMatchObject([{ id: items[0]!.id, count: 5 }]);
  await expect(f.send(2, pickup)).rejects.toMatchObject({
    code: "HOLD_CHANGED",
  });
  expect(f.calls).not.toHaveBeenCalled();
});
test("同じ検索の外れは確定し、新しい検索で当たった2匹を同じ出現から区別して昇格申請できる", async () => {
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
  expect(hit.instantNpcs).toEqual(["鳥", "鳥"]);
  const animals = hit.appearances as { id: string }[];
  expect(animals[0]!.id).not.toEqual(animals[1]!.id);
  for (const a of animals)
    expect(await f.store.context(f.graph).node(a.id)).toBeUndefined();
  await f.send(0, { command: "end-turn" });
  expect((await f.status(1)).actorId).toBe(animals[0]!.id);
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { text: "岸に佇む" }),
  );
  await access.botPlay.tickNpcs();
  const requested = await f.send(1, {
    command: "promote-npc",
    sourceRequestId: source,
    npcIndex: 1,
    description: "二羽目を世話したい",
  });
  expect(requested.promotionId).toBeTruthy();
  uniform.mockReturnValue(0.999);
  expect(await f.send(0, { ...miss, requestId: source })).toEqual(hit);
  const three = await f.send(1, { ...miss, requestId: randomUUID() });
  expect(three.instantNpcs).toHaveLength(3);
  // その場に残る5羽と合わせて、発生数3に既定の倍率2を掛けた6羽を超えない。
  const sixth = await f.send(1, { ...miss, requestId: randomUUID() });
  expect(sixth.instantNpcs).toEqual(["鳥"]);
  const full = await f.send(1, { ...miss, requestId: randomUUID() });
  expect(full.appearances).toBeUndefined();
  uniform.mockRestore();
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
  expect((await f.send(0, { command: "end-turn" })).actorId).toBe(bird);
  await peck(1);
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
test("同行者の所在をまとめて申請すると承認した人だけが移り、移動した時点でセッションが分かれる", async () => {
  const f = await fixture();
  await f.move(2, f.place);
  await f.send(1, { command: "contact", targetId: f.actors[0] });
  await f.send(2, { command: "contact", targetId: f.actors[0] });
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
  expect(c.characters!.map((m) => m.actorId)).toEqual([f.actors[2]]);
  expect(c.actorId).toBe(f.actors[2]);
});
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
  const next = await f.send(0, { command: "end-turn" });
  const request = derivedId(`instant:${next.sessionId}:${bear}:${next.turn}`);
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
  expect((await f.status(0)).actorId).toBe(f.actors[1]);
  const receipt = await f.store.receipt(f.graph, request);
  expect(receipt?.changes.nodes).toContainEqual(
    expect.objectContaining({
      instantActor: { id: bear, sourceEventId: derivedId(source + ":speech") },
    }),
  );
  expect(await f.store.context(f.graph).node(bear)).toBeUndefined();
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
  const peer = derivedId(source + ":manual:1");
  expect((await f.send(1, { command: "end-turn" })).actorId).toBe(peer);
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { text: "草地へ去る", departs: true }),
  );
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
    await writeFile(
      file,
      JSON.stringify({
        command: "memo",
        text: original,
        participants: [target],
        dependencies: nearby.result.dependencies
          .filter((d: { key: string }) => d.key.startsWith("node:"))
          .slice(0, 1),
      }),
    );
    const pending = await run("play", "--file", file);
    expect(pending.result.receiving.applicationId).toMatch(/^@/);
    expect(pending.result.receiving.text).toBe(original);
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
test("メモ本文を判断中の本人だけへ渡し、申請者の復帰で承認・却下・期限切れを照合する", async () => {
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
  for (const i of [0, 2])
    expect(JSON.stringify(await waiting(i))).not.toContain(text);
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
  expect((await waiting(2)).context?.receiptRequest?.memoTexts).toEqual([text]);

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
              deadline,
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
    receiving: { applicationId: memo.applicationId },
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
      return answer(id, { sides: 100, successThrough: 100 });
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
    const route = (target: string) =>
      run("search", "--kind", "subject", "--target", target).then((r) =>
        r.result.material.states.find(
          (s: { node: { text: string } }) =>
            s.node.text === "広場の裏手から細い小道が続いている。",
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
    const path = found.result.placeId as string,
      me = (await run("status")).device.actorId as string,
      move = join(cli.directory, "move.json");
    await writeFile(
      move,
      JSON.stringify({
        command: "update",
        text: "小道へ入る",
        operations: [
          {
            type: "locate",
            subjectId: me,
            text: "広場の裏の小道",
            aboutIds: [path],
          },
        ],
        dependencies: [],
      }),
    );
    // 行く前でも、いまいる場所の記述が参照している新しい場所を調べられる。
    expect(names(await route(path))).toEqual(["広場", "広場の裏の小道"]);
    expect((await run("play", "--file", move)).result.state).toBe("accepted");
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
test("同席している出現個体への対抗行動はダイスに進み、死亡と判定された個体は同席から外れてドロップを残す", async () => {
  const f = await fixture(),
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
              count: 3,
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
  const birds = (found.appearances as { id: string }[]).map((a) => a.id);
  expect(birds).toHaveLength(3);
  const present = async (i = 0) =>
    (await f.status(i)).characters!.map((c) => c.actorId);
  const strike = (targetId: string) => ({
    command: "oppose",
    requestId: randomUUID(),
    text: "石を投げる",
    dependencies: [],
    effect: { targetId, state: "石が当たる" },
  });
  // 候補にないIDは死亡の対象にならない。
  f.calls.mockImplementationOnce(async (id, role, messages) => {
    expect(role).toBe("world-opposition-dice");
    expect(JSON.stringify(messages)).toContain("地面をつつく");
    return answer(id, {
      sides: sure.sides,
      successThrough: 1,
      fatal: [birds[1], f.actors[1]],
    });
  });
  const missed = strike(birds[1]!),
    failed = await f.send(0, missed);
  expect(failed.outcome).toMatchObject({
    success: false,
    setting: { fatal: [birds[1]] },
  });
  expect(failed.appearances).toBeUndefined();
  expect(await f.send(0, missed)).toEqual(failed);
  expect(await present()).toEqual(expect.arrayContaining(birds));
  f.calls.mockImplementationOnce(async (id) =>
    answer(id, { ...sure, fatal: [birds[0]] }),
  );
  const hit = strike(birds[0]!),
    killed = await f.send(0, hit);
  expect(killed.outcome).toMatchObject({ success: true });
  const drops = killed.appearances as { id: string; species: string }[];
  // 物品のドロップは、発生数を個数に持つ1つの物品として残る。
  expect(drops).toMatchObject([{ species: "羽根", count: 3 }]);
  expect(drops).toHaveLength(1);
  expect(await f.send(0, hit)).toEqual(killed);
  expect(await present(1)).toEqual([
    ...f.actors.slice(0, 2),
    ...birds.slice(1),
  ]);
  expect(
    (await f.store.receipt(f.graph, hit.requestId))?.changes.nodes,
  ).toContainEqual(
    expect.objectContaining({
      instantTarget: {
        id: birds[0],
        sourceEventId: derivedId(source + ":appearance"),
      },
    }),
  );
  // 個体も同席している他の個体へ作用できる。死亡と判定されなければ相手は残る。
  const next = await f.send(0, { command: "end-turn" });
  expect(next.actorId).toBe(birds[1]);
  f.calls
    .mockImplementationOnce(async (id, _role, messages) => {
      expect(JSON.stringify(messages)).toContain(birds[2]);
      return answer(id, {
        text: "隣の鳥をつつく",
        effect: { targetId: birds[2], state: "羽が乱れる" },
      });
    })
    .mockImplementationOnce(async (id) => answer(id, { ...sure, fatal: [] }));
  await access.botPlay.tickNpcs();
  expect(await present(1)).toEqual([
    ...f.actors.slice(0, 2),
    ...birds.slice(1),
  ]);
  expect(
    (
      await f.store.receipt(
        f.graph,
        derivedId(`instant:${next.sessionId}:${birds[1]}:${next.turn}`),
      )
    )?.changes.nodes,
  ).toContainEqual(
    expect.objectContaining({
      instantActor: expect.objectContaining({ id: birds[1] }),
      instantTarget: expect.objectContaining({ id: birds[2] }),
    }),
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
  expect(await carried()).toEqual([3]);
});
test("人物への対抗行動で死亡と判定されると、対象はセッションから外れて設定された場所か最初の所在地へ移る", async () => {
  const f = await fixture(),
    items = [randomUUID(), randomUUID(), randomUUID()],
    grave = randomUUID();
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
        ],
        edges: items.map((target, i) => ({
          id: randomUUID(),
          kind: "has",
          role: "hold",
          source: f.actors[i === 2 ? 2 : 1]!,
          target,
          period: { from: 0 },
        })),
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
  const fatalDice = (victim: string, expected: string, absent = "\u0000") =>
    f.calls.mockImplementationOnce(async (id, _role, messages) => {
      const sent = JSON.stringify(messages);
      expect(sent).toContain(expected);
      expect(sent).not.toContain(absent);
      return answer(id, { ...sure, fatal: [victim] });
    });
  const present = async (i: number) =>
    (await f.status(i)).characters!.map((c) => c.actorId);
  const whereabouts = async (i: number) =>
    (
      (await f.send(i, { command: "search", query: { kind: "self" } }))
        .material as { locations: { directPlaceId: string }[] }
    ).locations.map((l) => l.directPlaceId);
  // 死亡判定が無効な世界では、候補を渡さず、成功しても同席は変わらない。
  await configure("death_judgment", false);
  fatalDice(f.actors[1]!, "道具", "mortal");
  const spared = await f.send(0, attack(0));
  expect(spared.outcome).toMatchObject({ success: true });
  expect(spared.outcome).not.toHaveProperty("setting.fatal");
  expect(await present(0)).toEqual(f.actors);
  // 設定された場所へ移り、セッションから外れる。
  await configure("death_judgment", true);
  await configure("death_criteria", "致命傷で死亡する");
  await configure("death_place_id", grave);
  fatalDice(f.actors[1]!, "致命傷で死亡する");
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
  // 場所が未設定なら、本人の最初の所在地へ移る。
  await configure("death_place_id", null);
  fatalDice(f.actors[2]!, "mortal");
  await f.send(0, attack(2));
  expect(await present(0)).toEqual([f.actors[0]]);
  expect(await whereabouts(2)).toEqual([f.far]);
  expect(await whereabouts(0)).toEqual([f.place]);
});

test("持ち物は本人検索で個数つきで読め、ダイスが成功したときだけGMの選んだ手持ちの物品が減る", async () => {
  const f = await fixture();
  const made = await f.apply([
    {
      type: "create",
      label: "矢",
      count: 5,
      holder: f.actors[0],
      owner: f.actors[0],
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
  f.calls.mockImplementationOnce(async (id) => answer(id, lost));
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
    operations: ["transfer", "move"].map((type) => ({
      type,
      item: arrows,
      ...(type === "move" ? { from: f.actors[0] } : {}),
      to: f.actors[1],
      count: 2,
      basis: "贈った",
    })),
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

test("時間をかける物品の作成は、届く時刻を過ぎてから成立し、本人あての通知になる", async () => {
  const f = await fixture();
  const coins = (
    await f.apply([
      {
        type: "create",
        label: "銀貨",
        count: 5,
        holder: f.actors[0],
        owner: f.actors[0],
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
  f.calls.mockImplementationOnce(async (id) => answer(id, lost));
  const failed = await f.send(0, failing);
  expect(failed.outcome).toMatchObject({ success: false });
  expect(failed.arrival).toBeUndefined();
  expect(await held()).toEqual([{ label: "銀貨", count: 3 }]);
  // 届く時刻の前の定期処理では何も変わらない。
  const user = f.people[0]!.id,
    waiting = () => access.waiting(user, f.world, f.actors[0], "view", true);
  await new BotPlay(runtime, () => new Date(dueAt - 1)).expire(f.world);
  expect(await held()).toHaveLength(1);
  expect((await f.status(0)).unreadNotices).toBeUndefined();
  expect((await waiting()).noticeKey).toBeNull();
  // 過ぎた後の定期処理で成立する。繰り返しても物品と通知は増えない。
  const later = new BotPlay(runtime, () => new Date(dueAt + 1));
  await later.expire(f.world);
  await later.expire(f.world);
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
