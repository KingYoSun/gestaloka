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
