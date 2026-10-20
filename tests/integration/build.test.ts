import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { BudgetUnavailable, LlmClient } from "@gestaloka/server/llm";
import { WorldBuilder } from "@gestaloka/server/build";
import { approvedTransport } from "../support/model.js";

const databases = connectDatabases();
const budgetId = randomUUID();
const sessions: string[] = [];
const proposal = () => {
  const actor = { id: randomUUID(), kind: "existence", text: "試験用の存在" };
  const state = { id: randomUUID(), kind: "script", text: "ここにいる" };
  return {
    changes: {
      nodes: [actor, state],
      revisions: [],
      edges: [
        {
          id: randomUUID(),
          kind: "status",
          role: "content",
          source: actor.id,
          target: state.id,
          period: { from: 0 },
        },
      ],
      endEdges: [],
    },
    playerId: actor.id,
    rootIds: [actor.id],
    report: "接続を確認した候補",
  };
};
const reply = (content: unknown) =>
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
beforeAll(() => databases.verify());
afterAll(async () => {
  for (const runId of sessions) {
    const record = await databases.postgres.query<{ world_id: string }>(
      "DELETE FROM world_build WHERE run_id = $1 RETURNING world_id",
      [runId],
    );
    await databases.postgres.query(
      "DELETE FROM world_budget WHERE world_id=$1",
      [record.rows[0]!.world_id],
    );
    await databases.graph.executeQuery(
      "MATCH (n) WHERE n.worldId = $worldId DETACH DELETE n",
      { worldId: record.rows[0]!.world_id },
    );
  }
  await databases.postgres.query("DELETE FROM llm_call WHERE budget_id = $1", [
    budgetId,
  ]);
  await databases.postgres.query("DELETE FROM llm_budget WHERE id = $1", [
    budgetId,
  ]);
  await databases.close();
});

test("参照先が不正な候補を修正し、確定後の再開・進捗保存喪失でも二重生成しない", async () => {
  const invalid = proposal();
  invalid.changes.edges[0]!.target = randomUUID();
  const valid = proposal();
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(reply(invalid))
    .mockResolvedValueOnce(reply(valid));
  const model = new LlmClient(
    databases.postgres,
    { DEEPSEEK_API_KEY: "unused", LLM_BUDGET_ID: budgetId },
    approvedTransport(transport),
  );
  const builder = new WorldBuilder(
    databases.postgres,
    databases.graph,
    databases.checkpointer,
    model,
  );
  await builder.setup();
  const runId = await builder.create("存在を一つ初期生成する", 100);
  sessions.push(runId);
  const created = await builder.generate(runId);
  expect(created.state).toBe("ready");
  expect(created.result?.playerId).toBe(valid.playerId);
  expect(transport).toHaveBeenCalledTimes(2);
  expect((await builder.generate(runId)).result).toEqual(created.result);
  expect(transport).toHaveBeenCalledTimes(2);
  await databases.postgres.query(
    "UPDATE world_build SET state = 'creating', result = NULL WHERE run_id = $1",
    [runId],
  );
  const restored = await builder.generate(runId);
  expect(restored.result).toEqual(created.result);
  expect(transport).toHaveBeenCalledTimes(2);
  const nodes = await databases.graph.executeQuery(
    "MATCH (n:WorldNode {worldId: $worldId}) RETURN count(n) AS count",
    { worldId: created.world_id },
  );
  expect(Number(nodes.records[0]!.get("count"))).toBe(2);
});

test("予算不足は構築の保留として保存し、モデル送信も世界の作成も行わない", async () => {
  const limitedBudget = randomUUID();
  const transport = vi.fn<typeof fetch>();
  const model = new LlmClient(
    databases.postgres,
    {
      DEEPSEEK_API_KEY: "unused",
      LLM_BUDGET_ID: limitedBudget,
      LLM_BUDGET_USD: "0.01",
    },
    transport,
  );
  const builder = new WorldBuilder(
    databases.postgres,
    databases.graph,
    databases.checkpointer,
    model,
  );
  await builder.setup();
  const runId = await builder.create("試験用の初期入力", 100);
  sessions.push(runId);
  try {
    await expect(builder.generate(runId)).rejects.toBeInstanceOf(
      BudgetUnavailable,
    );
    expect(transport).not.toHaveBeenCalled();
    const record = await databases.postgres.query<{
      state: string;
      world_id: string;
    }>("SELECT state, world_id FROM world_build WHERE run_id = $1", [runId]);
    expect(record.rows[0]?.state).toBe("paused");
    const nodes = await databases.graph.executeQuery(
      "MATCH (n:WorldNode {worldId: $worldId}) RETURN count(n) AS count",
      { worldId: record.rows[0]!.world_id },
    );
    expect(Number(nodes.records[0]!.get("count"))).toBe(0);
  } finally {
    await databases.postgres.query("DELETE FROM llm_budget WHERE id = $1", [
      limitedBudget,
    ]);
  }
});
