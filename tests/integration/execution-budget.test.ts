import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  connectDatabases,
  ExecutionBudget,
  ExecutionLimit,
} from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldStore } from "@gestaloka/server/world";
import { modelEnvironment } from "../support/model.js";

const db = connectDatabases(),
  store = new WorldStore(db.graph),
  world = randomUUID(),
  actor = randomUUID(),
  feeBudget = randomUUID(),
  scopes: string[] = [];
let sent = 0;
const model = new LlmClient(
  db.postgres,
  modelEnvironment(feeBudget),
  async () => {
    sent++;
    return new Response(
      JSON.stringify({
        id: randomUUID(),
        model: "gemini-3.8-flash",
        choices: [{ finish_reason: "stop", message: { content: "{}" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  },
);
const messages = [{ role: "user" as const, content: "処理上限の試験" }];
async function usage(id: string) {
  return (
    await db.postgres.query("SELECT * FROM execution_budget WHERE id=$1", [id])
  ).rows[0]!;
}
beforeAll(async () => {
  await db.verify();
  await model.ledger.setup();
  await store.setup();
  const lease = await store.claim(world, randomUUID());
  await store.commit(lease, store.context(world), {
    commitId: randomUUID(),
    at: 0,
    changes: {
      nodes: [{ id: actor, kind: "existence", text: "共有世界の存在" }],
      edges: [],
      endEdges: [],
    },
  });
});
afterAll(async () => {
  await db.postgres.query("DELETE FROM llm_call WHERE budget_id=$1", [
    feeBudget,
  ]);
  await db.postgres.query("DELETE FROM llm_budget WHERE id=$1", [feeBudget]);
  await db.postgres.query(
    "DELETE FROM execution_budget WHERE id=ANY($1::uuid[])",
    [scopes],
  );
  await db.graph.executeQuery(
    "MATCH(n) WHERE n.worldId=$world DETACH DELETE n",
    { world },
  );
  await db.close();
});

test("親子で通算し、並行するモデル要求を上限内に受付し、再利用・引継ぎで枠を戻さない", async () => {
  const parent = randomUUID(),
    child = randomUUID();
  scopes.push(parent, child);
  await ExecutionBudget.run(db.postgres, parent, async () => {});
  await db.postgres.query(
    "UPDATE execution_budget SET llm_used=63 WHERE id=$1",
    [parent],
  );
  const calls = [randomUUID(), randomUUID()],
    before = sent;
  const results = await ExecutionBudget.run(db.postgres, parent, () =>
    Promise.allSettled(
      calls.map((id) =>
        ExecutionBudget.run(db.postgres, child, () =>
          model.complete(id, "limit-test", messages),
        ),
      ),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    results.filter(
      (r) => r.status === "rejected" && r.reason instanceof ExecutionLimit,
    ),
  ).toHaveLength(1);
  expect(sent - before).toBe(1);
  expect(await usage(child)).toBeUndefined();
  expect(await usage(parent)).toMatchObject({ llm_used: 64, llm_limit: 64 });
  const accepted = results.findIndex((r) => r.status === "fulfilled");
  const cached = await ExecutionBudget.run(db.postgres, parent, () =>
    model.complete(calls[accepted]!, "limit-test", messages),
  );
  assert(results[accepted]!.status === "fulfilled");
  expect(cached).toEqual(results[accepted]!.value);
  expect(sent - before).toBe(1);
  await expect(
    ExecutionBudget.run(db.postgres, parent, () =>
      model.complete(randomUUID(), "limit-test", messages),
    ),
  ).rejects.toBeInstanceOf(ExecutionLimit);
  expect((await model.ledger.summary()).calls).toBe(1);
  expect(await ExecutionBudget.extend(parent, db.postgres)).toBe(true);
  expect(await usage(parent)).toMatchObject({
    llm_used: 64,
    llm_limit: 128,
    graph_limit: 8192,
  });
  await ExecutionBudget.run(db.postgres, parent, () =>
    model.complete(randomUUID(), "limit-test", messages),
  );
  expect(await usage(parent)).toMatchObject({ llm_used: 65, llm_limit: 128 });
  expect(await ExecutionBudget.extend(parent, db.postgres)).toBe(false);
});

test("グラフ照会を原子的に通算し、接続を作り直しても上限を保ち、公開済み情報の再表示では消費しない", async () => {
  const parent = randomUUID(),
    children = Array.from({ length: 4 }, () => randomUUID());
  scopes.push(parent, ...children);
  await ExecutionBudget.run(db.postgres, parent, async () => {});
  await db.postgres.query(
    "UPDATE execution_budget SET graph_used=4094 WHERE id=$1",
    [parent],
  );
  const results = await ExecutionBudget.run(db.postgres, parent, () =>
    Promise.allSettled(
      children.map((id) =>
        ExecutionBudget.run(db.postgres, id, () =>
          store.context(world).node(actor),
        ),
      ),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  expect(
    results.filter(
      (r) => r.status === "rejected" && r.reason instanceof ExecutionLimit,
    ),
  ).toHaveLength(2);
  expect(await usage(parent)).toMatchObject({
    graph_used: 4096,
    graph_limit: 4096,
  });
  expect((await store.context(world).node(actor))?.text).toBe("共有世界の存在");
  expect((await usage(parent)).graph_used).toBe(4096);
  const another = connectDatabases();
  try {
    await expect(
      ExecutionBudget.run(another.postgres, parent, () =>
        store.context(world).node(actor),
      ),
    ).rejects.toBeInstanceOf(ExecutionLimit);
    expect(await ExecutionBudget.extend(parent, another.postgres)).toBe(true);
    await ExecutionBudget.run(another.postgres, parent, () =>
      store.context(world).node(actor),
    );
  } finally {
    await another.close();
  }
  expect(await usage(parent)).toMatchObject({
    graph_used: 4097,
    graph_limit: 8192,
  });
});
