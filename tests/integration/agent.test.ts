import { WORLD_DAY_MS } from "@gestaloka/contracts";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import {
  modelEnvironment,
  approvedTransport,
  fixtureBody,
} from "../support/model.js";
import { WorldBudget } from "../../packages/server/src/llm/world-budget.js";
import {
  WorldStore,
  type Change,
  type WorldNode,
  type WorldEdge,
} from "@gestaloka/server/world";
import {
  WorldAgent,
  OperationPaused,
  SupersededWorker,
  type WorldProposal,
} from "@gestaloka/server/agent";

const databases = connectDatabases(),
  store = new WorldStore(databases.graph);
const worlds: string[] = [],
  operations: string[] = [],
  budgets: string[] = [];
const node = (kind: "existence" | "script", text: string): WorldNode => ({
  id: randomUUID(),
  kind,
  text,
});
const edge = (
  kind: WorldEdge["kind"],
  source: WorldNode,
  target: WorldNode,
  text?: string,
  role?: "content" | "about",
): WorldEdge => ({
  id: randomUUID(),
  kind,
  source: source.id,
  target: target.id,
  period: { from: 0 },
  ...(text === undefined ? {} : { text }),
  ...(role === undefined ? {} : { role }),
});
const changes = (nodes: WorldNode[] = [], edges: WorldEdge[] = []): Change => ({
  nodes,
  edges,
  revisions: [],
  endEdges: [],
});
const proposal = (
  delta: Change,
  extra: Partial<WorldProposal> = {},
): WorldProposal => ({
  type: "propose",
  changes: delta,
  summary: "管理者向けの処理記録",
  resolvedUntil: 1000,
  wakeups: [],
  ...extra,
});
const response = (content: unknown) =>
  new Response(
    JSON.stringify({
      id: randomUUID(),
      model: "deepseek-flash",
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(content) },
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 1,
      },
    }),
  );
async function fixture() {
  const worldId = randomUUID();
  worlds.push(worldId);
  await WorldBudget.setup(databases.postgres);
  await WorldBudget.create(databases.postgres, worldId, 100);
  const actor = node("existence", "SELF_PRIVATE"),
    place = node("existence", "ROOT_PRIVATE"),
    object = node("existence", "TARGET_PRIVATE"),
    secret = node("script", "SECRET_FACT");
  const lease = await store.claim(worldId, randomUUID());
  await store.commit(lease, store.context(worldId), {
    commitId: randomUUID(),
    at: 0,
    changes: changes(
      [actor, place, object, secret],
      [
        {
          ...edge("see", actor, object),
          text: "箱の表面が見える。外側に浅い傷がある。",
          observation: {
            aspect: "箱の表面が見える",
            through: 0,
            sourceIds: [object.id],
            pathIds: [],
          },
        },
        edge("status", object, secret, undefined, "content"),
      ],
    ),
  });
  return { worldId, actor, place, object, secret };
}
async function agent(
  transport: typeof fetch,
  overrides: Record<string, string> = {},
) {
  const budgetId = randomUUID();
  budgets.push(budgetId);
  const model = new LlmClient(
    databases.postgres,
    { ...modelEnvironment(budgetId), ...overrides },
    approvedTransport(transport),
  );
  const runtime = new WorldAgent(
    databases.postgres,
    databases.graph,
    databases.checkpointer,
    model,
  );
  await runtime.setup();
  return runtime;
}
test.each(
  ["separate", "combined"].flatMap((judgment) =>
    ["openai", "deepseek"].map((provider) => ({ judgment, provider })),
  ),
)(
  "$provider / $judgmentの判断方式を操作に保存し、形式の修正と再実行でも二重適用しない",
  async ({ judgment, provider }) => {
    const scene = await fixture();
    const accepted = edge("see", scene.actor, scene.object, "今回受容した側面");
    let attempts = 0;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      attempts++;
      expect(
        await store.context(scene.worldId).edge(accepted.id),
      ).toBeUndefined();
      return response(
        proposal(
          attempts === 1 ? changes([scene.actor]) : changes([], [accepted]),
          {
            settledIntentions: [
              { actorId: scene.actor.id, reason: "本人が選んだ受容を記録した" },
            ],
          },
        ),
      );
    });
    const runtime = await agent(transport, {
      LLM_RESOLUTION_MODEL:
        provider === "deepseek" ? "deepseek-flash" : "gpt-6-luna",
      LLM_RESOLUTION_PROVIDER: provider,
      OPENAI_API_KEY: "unused",
      DEEPSEEK_API_KEY: "unused",
      LLM_RESOLUTION_JUDGMENT: judgment,
    });
    const calls = vi.spyOn(runtime.model, "complete");
    const id = await runtime.create({
      worldId: scene.worldId,
      phase: "interaction",
      at: 0,
      until: 1000,
      rootIds: [scene.actor.id],
      actionText: "",
      intentions: [
        {
          actorId: scene.actor.id,
          actionText: "届いた側面を受け取る",
          continuing: false,
        },
      ],
    });
    operations.push(id);
    runtime.model.environment.LLM_RESOLUTION_JUDGMENT =
      judgment === "combined" ? "separate" : "combined";
    expect((await runtime.run(id)).changes.edges).toEqual([accepted]);
    expect(attempts).toBe(2);
    expect(
      calls.mock.calls.filter((call) => call[1] === "world-commit"),
    ).toHaveLength(judgment === "combined" ? 0 : 1);
    const row = (
      await databases.postgres.query(
        "SELECT approved,combined_judgment,system_prompt FROM world_operation WHERE id=$1",
        [id],
      )
    ).rows[0];
    expect(row).toMatchObject({
      approved: true,
      combined_judgment: judgment === "combined",
    });
    if (judgment === "combined")
      expect(row.system_prompt).toContain("未解決の意図と継続を保持");
    const count = calls.mock.calls.length;
    await runtime.run(id);
    expect(calls).toHaveBeenCalledTimes(count);
    expect(await runtime.model.ledger.summary()).toMatchObject({
      calls: judgment === "combined" ? 2 : 3,
      unsettled: 0,
    });
  },
);

beforeAll(async () => {
  await databases.verify();
  await store.setup();
});
afterAll(async () => {
  await databases.postgres.query(
    "DELETE FROM world_budget WHERE world_id=ANY($1)",
    [worlds],
  );
  await databases.postgres.query(
    "DELETE FROM world_intent WHERE world_id=ANY($1::uuid[])",
    [worlds],
  );
  await databases.postgres.query(
    "DELETE FROM world_operation WHERE id=ANY($1)",
    [operations],
  );
  await databases.postgres.query(
    "DELETE FROM llm_call WHERE budget_id=ANY($1)",
    [budgets],
  );
  await databases.postgres.query("DELETE FROM llm_budget WHERE id=ANY($1)", [
    budgets,
  ]);
  for (const worldId of worlds)
    await databases.graph.executeQuery(
      "MATCH(n) WHERE n.worldId=$worldId DETACH DELETE n",
      { worldId },
    );
  await databases.close();
});

test("意図形成へ観測の側面を渡し、対象全体・未観測の秘密・管理文脈を渡さない", async () => {
  const scene = await fixture();
  let sent = "";
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, options) => {
      sent = String(options?.body);
      return response({ actionText: "箱の表面を調べる" });
    });
  const runtime = await agent(transport);
  const intentId = randomUUID();
  expect(await runtime.intent(scene.worldId, scene.actor.id, 0, intentId)).toBe(
    "箱の表面を調べる",
  );
  expect(sent).toContain("箱の表面が見える");
  expect(sent).toContain("外側に浅い傷がある。");
  await store.commit(
    await store.claim(scene.worldId, randomUUID()),
    store.context(scene.worldId),
    {
      commitId: randomUUID(),
      at: 0,
      changes: changes(
        [],
        [edge("see", scene.actor, scene.object, "後から受容した別の側面")],
      ),
    },
  );
  expect(await runtime.intent(scene.worldId, scene.actor.id, 0, intentId)).toBe(
    "箱の表面を調べる",
  );
  expect(transport).toHaveBeenCalledTimes(1);
  for (const privateText of [
    "SELF_PRIVATE",
    "ROOT_PRIVATE",
    "TARGET_PRIVATE",
    "SECRET_FACT",
  ])
    expect(sent).not.toContain(privateText);
  expect(
    (await runtime.view(scene.worldId, scene.actor.id, 0)).observations,
  ).toHaveLength(2);
});

test("本人の性質と認知条件を意図だけへ分離して渡し、知識や他者の秘密へ広げない", async () => {
  const scene = await fixture(),
    disposition = node("script", "SELF_DISPOSITION"),
    cognition = node("script", "SELF_COGNITION"),
    belief = node("script", "SELF_BELIEF");
  await store.commit(
    await store.claim(scene.worldId, randomUUID()),
    store.context(scene.worldId),
    {
      commitId: randomUUID(),
      at: 0,
      changes: changes(
        [disposition, cognition, belief],
        [
          edge("status", scene.actor, disposition, undefined, "content"),
          edge("status", disposition, scene.actor, undefined, "about"),
          edge("status", scene.actor, cognition, undefined, "content"),
          edge("status", cognition, scene.actor, undefined, "about"),
          edge("interpret", scene.actor, belief, undefined, "content"),
          edge("interpret", belief, scene.actor, undefined, "about"),
        ],
      ),
    },
  );
  let sent: Record<string, unknown> | undefined;
  const runtime = await agent(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    sent = JSON.parse(
      body.messages.find((m: { role: string }) => m.role === "user").content,
    );
    return response({ actionText: "本人が次の行為を選ぶ" });
  });
  const knowledge = await runtime.view(scene.worldId, scene.actor.id, 0),
    intentView = await runtime.intentView(scene.worldId, scene.actor.id, 0),
    { conditions, ...intentKnowledge } = intentView;
  expect(intentKnowledge).toEqual(knowledge);
  expect(conditions).toHaveLength(2);
  expect(conditions).toEqual(
    expect.arrayContaining([
      { text: disposition.text, about: [scene.actor.id] },
      { text: cognition.text, about: [scene.actor.id] },
    ]),
  );
  expect(knowledge.interpretations).toContainEqual({
    text: belief.text,
    about: [scene.actor.id],
  });
  expect(knowledge).not.toHaveProperty("conditions");
  expect(JSON.stringify(knowledge)).not.toMatch(
    /SELF_DISPOSITION|SELF_COGNITION|SECRET_FACT/,
  );
  expect(JSON.stringify(intentView)).not.toContain("SECRET_FACT");
  await runtime.intent(scene.worldId, scene.actor.id, 0, randomUUID());
  expect(sent).toMatchObject({
    observerId: scene.actor.id,
    conditions: expect.arrayContaining(conditions),
  });
  expect(sent?.conditions).toHaveLength(conditions.length);
  expect(sent?.observations).toEqual(knowledge.observations);
  expect(sent?.interpretations).toEqual(knowledge.interpretations);
  expect(JSON.stringify(sent)).not.toContain("SECRET_FACT");
  expect(await runtime.view(scene.worldId, scene.actor.id, 0)).toEqual(
    knowledge,
  );
});

test("照会・再評価・確定を共有し、進捗保存を失っても確定済みの過去を再生成しない", async () => {
  const scene = await fixture();
  const state = node("script", "観測した表面の変化");
  const delta = changes(
    [state],
    [
      edge("status", scene.object, state, undefined, "content"),
      {
        ...edge("see", scene.actor, state, "表面の模様が変わった"),
        period: { from: 1000 },
      },
    ],
  );
  let call = 0;
  const inputs: string[] = [];
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, options) => {
      inputs.push(String(options?.body));
      call++;
      if (call === 1 || call === 3)
        return response({
          type: "query",
          requests: [{ kind: "node", id: scene.secret.id }],
        });
      if (call === 2) {
        const lease = await store.claim(scene.worldId, randomUUID());
        await store.commit(lease, store.context(scene.worldId), {
          commitId: randomUUID(),
          at: 0,
          changes: {
            ...changes(),
            revisions: [{ ...scene.secret, text: "CHANGED_PRIVATE" }],
          },
        });
      }
      return response(proposal(delta));
    });
  const runtime = await agent(transport);
  const id = await runtime.create({
    worldId: scene.worldId,
    phase: "interaction",
    at: 0,
    until: 1000,
    rootIds: [scene.actor.id, scene.place.id],
    actorId: scene.actor.id,
    actionText: "箱の表面を調べる",
  });
  operations.push(id);
  const result = await runtime.run(id);
  expect(result.resolvedUntil).toBe(1000);
  expect(call).toBe(4);
  expect(inputs[3]).toContain("CHANGED_PRIVATE");
  expect(inputs[0]).toContain(scene.object.id);
  expect(inputs[0]).toContain("TARGET_PRIVATE");
  const seed = JSON.parse(
    JSON.parse(inputs[0]!).messages[1].content,
  ).initialContext;
  expect(seed[0]).toMatchObject({
    request: { kind: "node", id: scene.actor.id },
    result: { node: { id: scene.actor.id } },
  });
  const view = await runtime.view(scene.worldId, scene.actor.id, 1000);
  expect(JSON.stringify(view)).not.toContain("CHANGED_PRIVATE");
  expect(view.observations).toHaveLength(2);
  await databases.postgres.query(
    "UPDATE world_operation SET state='paused',result=NULL WHERE id=$1",
    [id],
  );
  expect(await runtime.run(id)).toEqual(result);
  expect(call).toBe(4);
  expect(
    (await runtime.view(scene.worldId, scene.actor.id, 1000)).observations,
  ).toHaveLength(2);
});

test("未記録の同じ住人を同時に具体化すると、競合側は読み直して共有された同一性を使う", async () => {
  const scene = await fixture();
  let release!: () => void,
    arrived = 0;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const candidates = [node("existence", "住人"), node("existence", "住人")];
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, options) => {
      const input = JSON.parse(
        JSON.parse(String(options?.body)).messages[1].content,
      );
      const house = input.initialContext.find(
        (p: { request: { kind: string; id: string } }) =>
          p.request.kind === "node" && p.request.id === scene.object.id,
      ).result;
      if (house.stateSubjects.length) return response(proposal(changes()));
      const resident = candidates[arrived++]!,
        state = node("script", "この家に暮らしている");
      if (arrived === 2) release();
      await barrier;
      return response(
        proposal(
          changes(
            [resident, state],
            [
              edge("status", resident, state, undefined, "content"),
              edge("status", state, scene.object, undefined, "about"),
            ],
          ),
        ),
      );
    });
  const first = await agent(transport),
    second = await agent(transport);
  const request = {
    worldId: scene.worldId,
    phase: "resolution" as const,
    at: 0,
    until: 1000,
    rootIds: [scene.object.id],
    actionText: "以前から一人だけ暮らす住人の同一性を記録する",
  };
  const ids = await Promise.all([
    first.create(request),
    second.create(request),
  ]);
  operations.push(...ids);
  const results = await Promise.all([first.run(ids[0]!), second.run(ids[1]!)]);
  expect(results.filter((r) => r.changes.nodes.length > 0)).toHaveLength(1);
  expect(transport).toHaveBeenCalledTimes(3);
  expect(
    await store
      .context(scene.worldId)
      .relations(scene.object.id, "status", "in", 1000),
  ).toHaveLength(1);
  for (const [i, id] of ids.entries())
    expect(await (i ? second : first).run(id)).toEqual(results[i]);
  const later = await first.create(request);
  operations.push(later);
  expect((await first.run(later)).changes.nodes).toEqual([]);
  expect(transport).toHaveBeenCalledTimes(4);
});

test("人間用には別の村民を生成し、試遊村民とその観測を保持したまま分離する", async () => {
  const scene = await fixture();
  const newcomer = node("existence", "新しい村民"),
    membership = node("script", "この村の村民である");
  const candidate = proposal(
    changes(
      [newcomer, membership],
      [
        edge("status", newcomer, membership, undefined, "content"),
        edge("status", membership, scene.place, undefined, "about"),
        edge("see", newcomer, scene.place, "広場が見える"),
      ],
    ),
    { newParticipantId: newcomer.id },
  );
  const runtime = await agent(
    vi.fn<typeof fetch>().mockImplementation(async () => response(candidate)),
  );
  const id = await runtime.create({
    worldId: scene.worldId,
    phase: "participant",
    at: 0,
    until: 1000,
    rootIds: [scene.place.id],
    actionText: "別の村民として参加する",
  });
  operations.push(id);
  expect((await runtime.run(id)).newParticipantId).toBe(newcomer.id);
  const view = await runtime.view(scene.worldId, newcomer.id, 1000);
  expect(view.observations).toHaveLength(1);
  expect(view.observations[0]?.text).toBe("広場が見える");
  expect(await store.context(scene.worldId).node(scene.actor.id)).toEqual(
    scene.actor,
  );
  expect(
    (await runtime.view(scene.worldId, scene.actor.id, 1000)).observations,
  ).toHaveLength(1);
});

test("既存の状態記述へ不完全な解釈だけを結びつけて新しい存在を確定できない", async () => {
  const scene = await fixture(),
    duplicate = node("existence", "追加候補");
  let call = 0;
  const invalid = proposal(
    changes(
      [duplicate],
      [edge("interpret", duplicate, scene.secret, undefined, "content")],
    ),
  );
  const inputs: string[] = [];
  const runtime = await agent(
    vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      inputs.push(String(options?.body));
      return response(++call === 1 ? invalid : proposal(changes()));
    }),
  );
  const id = await runtime.create({
    worldId: scene.worldId,
    phase: "interaction",
    at: 0,
    until: 1000,
    rootIds: [scene.actor.id],
    actorId: scene.actor.id,
    actionText: "見えている対象を確かめる",
  });
  operations.push(id);
  await runtime.run(id);
  expect(call).toBe(2);
  expect(inputs[1]).toContain("主体・内容・対象");
  expect(await store.context(scene.worldId).node(duplicate.id)).toBeUndefined();
});

test("観測期間終了後も受容した情報を保持し、再表示で観測を追加しない", async () => {
  const scene = await fixture();
  const observation = {
    ...edge("see", scene.actor, scene.place, "一時的に窓から見えた景色"),
    period: { from: 100, until: 200 },
  };
  await store.commit(
    await store.claim(scene.worldId, randomUUID()),
    store.context(scene.worldId),
    { commitId: randomUUID(), at: 200, changes: changes([], [observation]) },
  );
  const runtime = await agent(vi.fn<typeof fetch>());
  const first = await runtime.view(scene.worldId, scene.actor.id, 1000);
  expect(
    first.observations.some((record) => record.id === observation.id),
  ).toBe(true);
  expect(await runtime.view(scene.worldId, scene.actor.id, 1000)).toEqual(
    first,
  );
});

test("保留後に明示的に再開でき、保留を世界内の失敗へ変換しない", async () => {
  const scene = await fixture();
  let call = 0;
  const runtime = await agent(
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response(
          ++call === 1
            ? { type: "pause", reason: "追加の確認が必要" }
            : proposal(changes()),
        ),
      ),
  );
  const id = await runtime.create({
    worldId: scene.worldId,
    phase: "interaction",
    at: 0,
    until: 1000,
    rootIds: [scene.actor.id],
    actorId: scene.actor.id,
    actionText: "周囲を確かめる",
  });
  operations.push(id);
  await expect(runtime.run(id)).rejects.toBeInstanceOf(OperationPaused);
  expect(
    (await runtime.view(scene.worldId, scene.actor.id, 0)).observations,
  ).toHaveLength(1);
  expect((await runtime.run(id, "確認できた範囲で続ける")).resolvedUntil).toBe(
    1000,
  );
});

test("引継ぎ後の古いワーカーは進捗を保存できず、同じモデル要求を二重送信しない", async () => {
  const scene = await fixture();
  let release!: (value: Response) => void, started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
    started();
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  const runtime = await agent(transport);
  const id = await runtime.create({
    worldId: scene.worldId,
    phase: "interaction",
    at: 0,
    until: 1000,
    rootIds: [scene.actor.id],
    actorId: scene.actor.id,
    actionText: "周囲を見る",
  });
  operations.push(id);
  const old = runtime.run(id).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await entered;
  await expect(runtime.run(id)).rejects.toThrow("未確定");
  release(response(proposal(changes())));
  const abandoned = await old;
  expect(
    "error" in abandoned && abandoned.error instanceof SupersededWorker,
  ).toBe(true);
  expect(transport).toHaveBeenCalledTimes(1);
  const saved = await databases.postgres.query<{ state: string }>(
    "SELECT state FROM world_operation WHERE id=$1",
    [id],
  );
  expect(saved.rows[0]?.state).toBe("paused");
  expect((await runtime.run(id)).resolvedUntil).toBe(1000);
  expect(transport).toHaveBeenCalledTimes(1);
});

test("作用の受け手は同時点で判断へ進め、因果のない同時点再起動は拒否する", async () => {
  const scene = await fixture();
  const incoming = edge("effect", scene.actor, scene.object);
  const reception = edge(
    "see",
    scene.object,
    scene.actor,
    "届いた作用を受容した",
  );
  let call = 0;
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
    call++;
    if (call === 1)
      return response(
        proposal(changes([], [incoming, reception]), {
          resolvedUntil: 0,
          wakeups: [{ actorId: scene.object.id, at: 0, mode: "intent" }],
        }),
      );
    if (call <= 3)
      return response(
        proposal(changes(), {
          resolvedUntil: 0,
          wakeups: [{ actorId: scene.object.id, at: 0, mode: "intent" }],
        }),
      );
    return response(proposal(changes(), { resolvedUntil: 1 }));
  });
  const runtime = await agent(transport);
  const request = {
    worldId: scene.worldId,
    phase: "interaction" as const,
    at: 0,
    until: 1000,
    rootIds: [scene.actor.id],
    actorId: scene.actor.id,
    actionText: "相手へ働きかける",
  };
  const sent = await runtime.create(request);
  operations.push(sent);
  expect((await runtime.run(sent)).wakeups[0]?.at).toBe(0);
  const received = await runtime.create({
    ...request,
    phase: "resolution",
    rootIds: [scene.object.id],
    actorId: scene.object.id,
    actionText: "",
    triggerEdgeIds: [incoming.id, reception.id],
  });
  operations.push(received);
  expect((await runtime.run(received)).wakeups[0]?.at).toBe(0);
  expect(transport).toHaveBeenCalledTimes(2);
  const uncaused = await runtime.create({
    ...request,
    actionText: "同じ時点の再起動を要求する",
  });
  operations.push(uncaused);
  expect((await runtime.run(uncaused)).resolvedUntil).toBe(1);
  expect(transport).toHaveBeenCalledTimes(4);
});

test("意図の省略・重複終了・継続との二重指定を確定せず、全主体の処遇を保存する", async () => {
  const scene = await fixture();
  const discarded = edge("effect", scene.actor, scene.object);
  const settled = {
    actorId: scene.actor.id,
    reason: "本人の意図の処理が終了した",
  };
  const valid = proposal(changes(), {
    settledIntentions: [settled],
    deferredIntentions: [scene.object.id],
    wakeups: [{ actorId: scene.place.id, at: 2000, mode: "resolve" }],
  });
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(proposal(changes([], [discarded]))))
    .mockResolvedValueOnce(
      response({ ...valid, settledIntentions: [settled, settled] }),
    )
    .mockResolvedValueOnce(
      response({
        ...valid,
        settledIntentions: [
          ...valid.settledIntentions!,
          { actorId: scene.object.id, reason: "重複" },
        ],
      }),
    )
    .mockResolvedValueOnce(
      response({
        ...valid,
        wakeups: [{ actorId: scene.object.id, at: 2000, mode: "resolve" }],
      }),
    )
    .mockResolvedValueOnce(response({ ...valid, wakeups: [] }))
    .mockResolvedValueOnce(response(valid));
  const runtime = await agent(transport);
  const id = await runtime.create({
    worldId: scene.worldId,
    phase: "interaction",
    at: 0,
    rootIds: [scene.actor.id, scene.object.id],
    actionText: "",
    intentions: [scene.actor, scene.object].map((actor) => ({
      actorId: actor.id,
      actionText: "本人が形成した意図",
      continuing: false,
    })),
  });
  operations.push(id);
  expect(await runtime.run(id)).toEqual(valid);
  expect(transport).toHaveBeenCalledTimes(6);
  expect(
    await runtime.store.context(scene.worldId).edge(discarded.id),
  ).toBeUndefined();
  expect(await runtime.run(id)).toEqual(valid);
  expect(transport).toHaveBeenCalledTimes(6);
});

test("期間は計画の指定として本人の知識と分離し、再開では保存済み方針を再利用する", async () => {
  const scene = await fixture();
  let input: { planningPeriod: { from: number; until: number } } | undefined;
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      input = JSON.parse(body.messages[1].content);
      expect(String(options?.body)).not.toContain("SECRET_FACT");
      expect(String(options?.body)).not.toContain("TARGET_PRIVATE");
      return response({ actionText: "観測した範囲の活動方針" });
    });
  const runtime = await agent(transport),
    id = randomUUID();
  const plan = await runtime.intent(
    scene.worldId,
    scene.actor.id,
    0,
    id,
    [],
    WORLD_DAY_MS,
  );
  expect(input?.planningPeriod).toEqual({ from: 0, until: WORLD_DAY_MS });
  expect(
    await runtime.intent(
      scene.worldId,
      scene.actor.id,
      0,
      id,
      [],
      WORLD_DAY_MS * 2,
    ),
  ).toBe(plan);
  expect(transport).toHaveBeenCalledTimes(1);
  const saved = (
    await databases.postgres.query(
      "SELECT view FROM world_intent WHERE id=$1",
      [id],
    )
  ).rows[0].view;
  expect(saved.planningPeriod.until).toBe(WORLD_DAY_MS);
});

test.each(["observation", "interaction", "resolution"] as const)(
  "%sの確定は上位モデルへ渡し、修正要求を戻して承認前には世界を書き換えない",
  async (phase) => {
    const scene = await fixture(),
      budgetId = randomUUID();
    budgets.push(budgetId);
    const rejected = edge("effect", scene.actor, scene.object),
      accepted = edge("see", scene.actor, scene.object, "今回受容した側面");
    let proposed = 0,
      reviewed = 0;
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, options) => {
        const body = fixtureBody(options),
          input = JSON.parse(body.messages[1].content);
        if (input.commitReview) {
          expect(body.model).toBe("gpt-6-luna");
          expect(input.commitReview.execution).toEqual({
            phase,
            callerHandlesNextDecisionFor:
              phase === "observation" ? scene.actor.id : null,
            formedIntentions:
              phase === "observation"
                ? []
                : [
                    {
                      actorId: scene.actor.id,
                      continuing: phase === "resolution",
                      disposition: "resolve",
                    },
                  ],
          });
          reviewed++;
          expect(
            await store.context(scene.worldId).edge(rejected.id),
          ).toBeUndefined();
          expect(
            await store.context(scene.worldId).edge(accepted.id),
          ).toBeUndefined();
          return response({
            type: reviewed === 1 ? "revise" : "commit",
            reason:
              reviewed === 1
                ? "本人の意図と作用が対応していない"
                : "受容の根拠が対応している",
          });
        }
        expect(body.model).toBe(
          phase === "observation" ? "gemini-3.8-flash" : "gpt-6-luna",
        );
        proposed++;
        return response(
          proposal(
            changes([], proposed === 1 ? [rejected] : [accepted]),
            phase === "observation"
              ? {}
              : {
                  wakeups: [
                    { actorId: scene.actor.id, at: 2000, mode: "resolve" },
                  ],
                },
          ),
        );
      });
    const normalized: typeof fetch = async (url, options) => {
      if (String(url).endsWith(":countTokens"))
        return Response.json({ totalTokens: 370 });
      const result = await transport(url, options),
        data = await result.json();
      data.usage.total_tokens = 2;
      return new Response(JSON.stringify(data));
    };
    const runtime = new WorldAgent(
      databases.postgres,
      databases.graph,
      databases.checkpointer,
      new LlmClient(
        databases.postgres,
        {
          ...modelEnvironment(budgetId),
          LLM_RESOLUTION_MODEL: "gpt-6-luna",
          OPENAI_API_KEY: "unused",
        },
        normalized,
      ),
    );
    await runtime.setup();
    const id = await runtime.create({
      worldId: scene.worldId,
      phase,
      ...(phase === "observation"
        ? { actorId: scene.actor.id }
        : {
            intentions: [
              {
                actorId: scene.actor.id,
                actionText: "本人が選んだ継続中の行動",
                continuing: phase === "resolution",
              },
            ],
          }),
      at: 0,
      until: 1000,
      rootIds: [scene.actor.id],
      actionText: "",
    });
    operations.push(id);
    expect((await runtime.run(id)).changes.edges).toEqual([accepted]);
    expect(reviewed).toBe(2);
    expect(proposed).toBe(2);
    expect(
      await store.context(scene.worldId).edge(rejected.id),
    ).toBeUndefined();
    expect(await store.context(scene.worldId).edge(accepted.id)).toBeDefined();
    const calls = transport.mock.calls.length;
    await runtime.run(id);
    expect(transport).toHaveBeenCalledTimes(calls);
  },
);

test("保存済みの確定要求は指示の更新後も元の入力と応答で再開する", async () => {
  const scene = await fixture(),
    budgetId = randomUUID();
  budgets.push(budgetId);
  const model = new LlmClient(
    databases.postgres,
    modelEnvironment(budgetId),
    approvedTransport(
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () => response(proposal(changes()))),
    ),
  );
  const complete = model.complete.bind(model);
  let previousVersion = true;
  model.complete = async (...args) => {
    if (args[1] === "world-commit" && previousVersion) {
      previousVersion = false;
      const legacy = structuredClone(args[2]);
      legacy[0]!.content = "旧版の確定担当";
      const payload = JSON.parse(legacy[1]!.content);
      delete payload.commitReview.execution;
      legacy[1]!.content = JSON.stringify(payload);
      await complete(args[0], args[1], legacy, args[3]);
      throw new Error("旧版の応答保存後に中断した");
    }
    return complete(...args);
  };
  const runtime = new WorldAgent(
    databases.postgres,
    databases.graph,
    databases.checkpointer,
    model,
  );
  await runtime.setup();
  const id = await runtime.create({
    worldId: scene.worldId,
    phase: "observation",
    actorId: scene.actor.id,
    at: 0,
    until: 1000,
    rootIds: [scene.actor.id],
    actionText: "",
  });
  operations.push(id);
  await expect(runtime.run(id)).rejects.toThrow("旧版の応答保存後");
  // Simulate a new worker after the previous process lost its final state write.
  await databases.postgres.query(
    "UPDATE world_operation SET state='queued' WHERE id=$1",
    [id],
  );
  expect((await runtime.run(id)).resolvedUntil).toBe(1000);
  expect(await model.ledger.summary()).toMatchObject({
    calls: 2,
    unsettled: 0,
  });
});

test("確定済みの出力上限終了は再開で新しい呼出しに進み、旧出力と費用を保持する", async () => {
  const scene = await fixture(),
    transport = vi.fn<typeof fetch>();
  transport.mockImplementation(async () => {
    if (transport.mock.calls.length === 1)
      return Response.json({
        id: randomUUID(),
        model: "gemini-3.8-flash",
        choices: [
          { finish_reason: "length", message: { content: '{"type":' } },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    return response(proposal(changes()));
  });
  const runtime = await agent(transport),
    id = await runtime.create({
      worldId: scene.worldId,
      phase: "observation",
      actorId: scene.actor.id,
      at: 0,
      until: 1000,
      rootIds: [scene.actor.id],
      actionText: "",
    });
  operations.push(id);
  const commitId = (
    await databases.postgres.query(
      "SELECT commit_id FROM world_operation WHERE id=$1",
      [id],
    )
  ).rows[0].commit_id;
  await expect(runtime.run(id)).rejects.toThrow("未完了");
  expect(await store.receipt(scene.worldId, commitId)).toBeUndefined();
  await runtime.run(id);
  expect(await store.receipt(scene.worldId, commitId)).toBeDefined();
  const calls = transport.mock.calls.length;
  await runtime.run(id);
  expect(transport).toHaveBeenCalledTimes(calls);
  const saved = (
    await databases.postgres.query(
      "SELECT state,charged_nano::text,response->>'finishReason' AS finish FROM llm_call WHERE budget_id=$1 ORDER BY created_at,id",
      [runtime.model.ledger.budgetId],
    )
  ).rows;
  expect(
    saved.some(
      (c) =>
        c.state === "complete" &&
        c.finish === "length" &&
        BigInt(c.charged_nano) > 0n,
    ),
  ).toBe(true);
});
