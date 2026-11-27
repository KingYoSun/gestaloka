import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { JudgmentExcerptWorker, WorldBudget } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldStore } from "@gestaloka/server/world";
import { isolatedDatabases } from "../support/isolated-db.js";
import { modelEnvironment } from "../support/model.js";
import { startPlayLoop } from "../../apps/worker/src/play-loop.js";

const isolated = isolatedDatabases();
const world = randomUUID();
const store = new WorldStore(isolated.databases.graph);

beforeAll(async () => {
  await isolated.setup();
  await store.setup();
});
afterAll(async () => {
  await isolated.databases.graph.executeQuery(
    "MATCH(n {worldId:$world}) DETACH DELETE n",
    { world },
  );
  await isolated.close();
});

test("バックグラウンドでJevの確定済み失敗を再試行し、原文を変えず抜粋を保存する", async () => {
  const core = "布を固定するには、作業台を使う。";
  const tail = "記録棚の最後の仕切り。";
  const text = core + "識別番号は管理台帳の左端に載せる。".repeat(30) + tail;
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockImplementation(async (_url, options) => {
      const input = JSON.parse(String(options?.body)) as {
        questions: Record<string, { instructions: string }>;
      };
      const answers = Object.fromEntries(
        Object.entries(input.questions).map(([id, { instructions }]) => [
          id,
          { noul: instructions.includes(core) ? 1 : 0 },
        ]),
      );
      return Response.json({
        id: randomUUID(),
        model: "fixture-decision",
        answers,
        usage: { input_tokens: 10, output_tokens: 1, cost: 0.00002 },
      });
    });
  const db = isolated.databases.postgres;
  const model = new LlmClient(
    db,
    {
      ...modelEnvironment(`judgment-excerpt-${world}`),
      LLM_DECISION_MODEL: "fixture-decision",
      OPENROUTER_API_KEY: "fixture-key",
    },
    transport,
  );
  await model.ledger.setup();
  await WorldBudget.create(db, world, 1);
  const actor = randomUUID();
  const skills = [randomUUID(), randomUUID()];
  const commitId = randomUUID();
  const worker = new JudgmentExcerptWorker(store, model);
  await store.commit(await store.claim(world, commitId), store.context(world), {
    commitId,
    at: 0,
    changes: {
      nodes: [
        { id: actor, kind: "existence", text: "織り手" },
        ...skills.map((id) => ({ id, kind: "script" as const, text })),
      ],
      edges: skills.map((id) => ({
        id: randomUUID(),
        kind: "has",
        role: "skill",
        source: actor,
        target: id,
        period: { from: 0 },
      })),
      revisions: [],
      endEdges: [],
    },
  });
  expect(transport).not.toHaveBeenCalled();

  await worker.tick(world);
  await worker.tick(world);
  await worker.tick(world);

  expect(transport).toHaveBeenCalledTimes(2);
  const context = store.context(world);
  const previews = await context.nodes(skills, true);
  for (const skill of skills) {
    expect((await context.node(skill))?.text).toBe(text);
    expect(previews.get(skill)?.text).toContain(core);
    expect(previews.get(skill)?.text).not.toContain(tail);
  }
  expect(
    (
      await db.query(
        "SELECT charged_nano,world_id FROM llm_call WHERE request->>'role'='world-judgment-excerpt' ORDER BY created_at",
      )
    ).rows,
  ).toEqual([
    { charged_nano: "0", world_id: world },
    { charged_nano: "20000", world_id: world },
  ]);
});

test("抜粋を待っている間もプレイ手番を進め、停止時には抜粋の確定を待つ", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const excerpt = vi.fn(() => pending);
  const play = {
    deliverArrivals: vi.fn(async () => {}),
    expire: vi.fn(async () => {}),
    tickNpcs: vi.fn(async () => {}),
  };
  const stop = await startPlayLoop(play, undefined, excerpt);
  let stopping: Promise<void> | undefined;
  try {
    await vi.waitFor(() => expect(play.tickNpcs).toHaveBeenCalledTimes(2), {
      timeout: 3500,
    });
    expect(excerpt).toHaveBeenCalledTimes(1);
    const stopped = vi.fn(() => {});
    stopping = stop().then(stopped);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(stopped).not.toHaveBeenCalled();
    release();
    await stopping;
    expect(stopped).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await (stopping ?? stop());
  }
});
test("本人の旧経験を背景で索引化し、別人や未来の経験を返さない", async () => {
  vi.stubEnv("JUDGMENT_EMBEDDING_URL", "http://127.0.0.1:1234/embed");
  vi.stubEnv("JUDGMENT_EMBEDDING_REVISION", "fixture-v1");
  const encode = vi.fn<typeof fetch>().mockImplementation(async (_url, opt) => {
    const { inputs } = JSON.parse(String(opt?.body)) as { inputs: string[] };
    return Response.json(
      inputs.map(() => Array.from({ length: 384 }, (_, i) => Number(i === 0))),
    );
  });
  vi.stubGlobal("fetch", encode);
  try {
    await store.setup();
    const actors = [randomUUID(), randomUUID()],
      ids = [randomUUID(), randomUUID(), randomUUID()];
    const commit = randomUUID();
    await store.commit(await store.claim(world, commit), store.context(world), {
      commitId: commit,
      at: 1,
      changes: {
        nodes: [
          ...actors.map((id) => ({
            id,
            kind: "existence" as const,
            text: "技師",
          })),
          ...ids.map((id, i) => ({
            id,
            kind: "event" as const,
            text: "耳殻が振動を遮った。" + i,
            period: { from: i + 1 },
          })),
        ],
        edges: ids.map((id, i) => ({
          id: randomUUID(),
          kind: "happen",
          text: "action-experience",
          source: actors[i === 1 ? 1 : 0]!,
          target: id,
          period: { from: i + 1 },
        })),
        endEdges: [],
        revisions: [],
      },
    });
    await isolated.databases.graph.executeQuery(
      "MATCH ()-[r:happen {worldId:$world}]->() REMOVE r.semanticDue",
      { world },
    );
    for (let i = 0; i < 3; i++) await store.indexJudgmentExperience(world);
    const issued = vi.spyOn(isolated.databases.graph, "executeQuery");
    const ctx = store.context(world);
    expect(
      await ctx.supplementalExperiences(actors[0]!, 2, [["鐘を鳴らす"]]),
    ).toEqual([[ids[0]]]);
    expect(
      await ctx.supplementalExperiences(actors[1]!, 5, [["鐘を鳴らす"]]),
    ).toEqual([[ids[1]]]);
    expect(
      await ctx.supplementalExperiences(actors[0]!, 0, [["鐘を鳴らす"]]),
    ).toEqual([[]]);
    const lookup = issued.mock.calls.find(
      ([cypher]) =>
        typeof cypher === "string" && cypher.startsWith("UNWIND $qs AS q"),
    );
    expect(lookup).toBeDefined();
    const explained = await isolated.databases.graph.executeQuery(
      "EXPLAIN " + lookup![0],
      lookup![1],
    );
    const plan = explained.summary.plan;
    if (!plan) throw new Error("索引の実行計画がありません");
    const countLimitedSeeks = (p: Exclude<typeof plan, false>): number =>
      (p.operatorType.startsWith("Limit") &&
      p.children.some(
        (child) =>
          child.operatorType.includes("IndexSeek") ||
          child.children.some((n) => n.operatorType.includes("IndexSeek")),
      )
        ? 1
        : 0) + p.children.reduce((n, child) => n + countLimitedSeeks(child), 0);
    expect(countLimitedSeeks(plan)).toBe(24);
    issued.mockRestore();
    const revised = randomUUID();
    await store.commit(
      await store.claim(world, revised),
      store.context(world),
      {
        commitId: revised,
        at: 10,
        changes: {
          nodes: [],
          edges: [],
          endEdges: [],
          revisions: [
            {
              id: ids[0]!,
              kind: "event",
              text: "改訂済みの経験。",
              period: { from: 1 },
            },
          ],
        },
      },
    );
    expect(
      (
        await store
          .context(world)
          .supplementalExperiences(actors[0]!, 20, [["鐘を鳴らす"]])
      )[0],
    ).not.toContain(ids[0]);
    await store.indexJudgmentExperience(world);
    expect(
      (
        await store
          .context(world)
          .supplementalExperiences(actors[0]!, 20, [["鐘を鳴らす"]])
      )[0],
    ).toContain(ids[0]);
    expect(encode).toHaveBeenCalled();
    encode.mockRejectedValueOnce(new Error("local encoder unavailable"));
    expect(
      await ctx.supplementalExperiences(actors[0]!, 5, [["鐘を鳴らす"]]),
    ).toEqual([[]]);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("判定資料を起点の現行関係に絞り、旧い状態と索引待ちを区別する", async () => {
  vi.stubEnv("JUDGMENT_EMBEDDING_URL", "http://127.0.0.1:1234/embed");
  vi.stubEnv("JUDGMENT_EMBEDDING_REVISION", "scoped-fixture");
  const encode = vi.fn<typeof fetch>().mockImplementation(async (_url, opt) => {
    const { inputs } = JSON.parse(String(opt?.body)) as { inputs: string[] };
    return Response.json(
      inputs.map((input) =>
        Array.from({ length: 384 }, (_, i) =>
          Number(i === (/解除できない|扉を開ける/u.test(input) ? 0 : 1)),
        ),
      ),
    );
  });
  vi.stubGlobal("fetch", encode);
  try {
    await store.setup();
    const actor = randomUUID(),
      other = randomUUID(),
      at = Date.now();
    const expires = at + 60_000;
    const states = [
      "封印は解除できない",
      "掲示板の札",
      "解除できない前回の記録",
      ...Array.from({ length: 19 }, (_, i) => `記録 ${i}`),
    ].map((text) => ({ id: randomUUID(), kind: "script" as const, text }));
    const outside = {
      id: randomUUID(),
      kind: "script" as const,
      text: states[0]!.text,
    };
    const links = [...states, outside].map((node, index) => ({
      id: randomUUID(),
      kind: "status" as const,
      role: "content" as const,
      source: node === outside ? other : actor,
      target: node.id,
      period: { from: at, ...(index === 2 ? { until: expires } : {}) },
    }));
    const initial = randomUUID();
    await store.commit(
      await store.claim(world, initial),
      store.context(world),
      {
        commitId: initial,
        at,
        changes: {
          nodes: [
            { id: actor, kind: "existence", text: "申請者" },
            { id: other, kind: "existence", text: "別の人物" },
            ...states,
            outside,
          ],
          edges: links,
          revisions: [],
          endEdges: [],
        },
      },
    );
    const query = (time: number) =>
      store
        .context(world)
        .scopedJudgmentEdges([actor], "status", ["扉を開ける"], time, [
          states[1]!.id,
          outside.id,
        ]);
    expect(await query(at)).toBeUndefined();
    for (let i = 0; i < links.length; i++)
      await store.indexScopedJudgmentEdges(world);
    const result = await query(at);
    expect(result?.ranked).toBe(true);
    expect(result?.similarities?.get(links[0]!.id)).toBeCloseTo(1);
    expect(result?.similarities?.has(links.at(-1)!.id)).toBe(false);
    expect(result?.edges.get(actor)?.map(({ id }) => id)).toEqual(
      expect.arrayContaining([links[0]!.id, links[1]!.id]),
    );
    expect(result?.edges.get(actor)?.map(({ source }) => source)).not.toContain(
      other,
    );
    expect(result?.similarities?.has(links[2]!.id)).toBe(true);
    expect(await query(expires)).toBeUndefined();
    const clock = vi.spyOn(Date, "now").mockReturnValue(expires);
    try {
      await store.indexScopedJudgmentEdges(world);
    } finally {
      clock.mockRestore();
    }
    const afterExpiry = await query(expires);
    expect(afterExpiry?.similarities?.has(links[0]!.id)).toBe(true);
    expect(afterExpiry?.edges.get(actor)?.map(({ id }) => id)).not.toContain(
      links[2]!.id,
    );
    const updated = randomUUID();
    await store.commit(
      await store.claim(world, updated),
      store.context(world),
      {
        commitId: updated,
        at: expires + 1,
        changes: {
          nodes: [],
          edges: [],
          revisions: [{ ...states[0]!, text: "封印は解除できる" }],
          endEdges: [links[1]!.id],
        },
      },
    );
    expect(await query(expires + 1)).toBeUndefined();
    await store.indexScopedJudgmentEdges(world);
    expect(
      (await query(expires + 1))?.edges.get(actor)?.map(({ id }) => id),
    ).not.toContain(links[1]!.id);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
