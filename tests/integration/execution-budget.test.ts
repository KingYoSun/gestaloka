import { isolatedDatabases } from "../support/isolated-db.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ExecutionBudget, ExecutionLimit } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldStore } from "@gestaloka/server/world";
import { modelEnvironment } from "../support/model.js";

const isolated = isolatedDatabases();
const db = isolated.databases,
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
  await isolated.setup();
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
  await isolated.close();
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
  expect(await ExecutionBudget.exhausted(parent, db.postgres)).toBe(true);
  await db.postgres.query(
    "UPDATE response_call_policy SET calls=128 WHERE singleton",
  );
  expect(await usage(parent)).toMatchObject({
    llm_used: 64,
    llm_limit: 64,
  });
  await ExecutionBudget.run(db.postgres, parent, () =>
    model.complete(randomUUID(), "limit-test", messages),
  );
  expect(await usage(parent)).toMatchObject({ llm_used: 65, llm_limit: 128 });
  expect(await ExecutionBudget.exhausted(parent, db.postgres)).toBe(false);
  await db.postgres.query(
    "UPDATE response_call_policy SET calls=64 WHERE singleton",
  );
});

test("グラフ照会に件数上限を置かず、別の応答は独立したcall回数を持つ", async () => {
  const parent = randomUUID();
  scopes.push(parent);
  const result = await ExecutionBudget.run(db.postgres, parent, () =>
    Promise.all(
      Array.from({ length: 5 }, () => store.context(world).node(actor)),
    ),
  );
  expect(result.every((node) => node?.text === "共有世界の存在")).toBe(true);
  expect((await usage(parent)).llm_used).toBe(0);
  await db.postgres.query(
    "UPDATE response_call_policy SET calls=1 WHERE singleton",
  );
  try {
    for (let index = 0; index < 3; index++) {
      const id = randomUUID();
      scopes.push(id);
      await ExecutionBudget.run(db.postgres, id, () =>
        model.complete(randomUUID(), "response", messages),
      );
      await expect(
        ExecutionBudget.run(db.postgres, id, () =>
          model.complete(randomUUID(), "response", messages),
        ),
      ).rejects.toBeInstanceOf(ExecutionLimit);
      expect((await usage(id)).llm_used).toBe(1);
    }
  } finally {
    await db.postgres.query(
      "UPDATE response_call_policy SET calls=64 WHERE singleton",
    );
  }
});
