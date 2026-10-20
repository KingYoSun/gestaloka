import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { modelEnvironment } from "../support/model.js";

const db = connectDatabases(),
  budgets: string[] = [],
  scopes: string[] = [];
const messages = [{ role: "user" as const, content: "あ".repeat(100) }];
async function fixture(
  limits: Record<string, number>,
  transport?: typeof fetch,
  budgetUsd = "40",
) {
  const budget = randomUUID(),
    key = randomUUID();
  budgets.push(budget);
  const scope = createHash("sha256")
    .update(`gemini:gemini-3.8-flash:${key}`)
    .digest("hex");
  scopes.push(scope);
  const environment = {
    ...modelEnvironment(budget),
    GEMINI_API_KEY: key,
    LLM_BUDGET_USD: budgetUsd,
    LLM_MAX_OUTPUT_TOKENS: "10",
    LLM_MODEL_LIMITS: JSON.stringify({ "gemini:gemini-3.8-flash": limits }),
  };
  const fetcher =
    transport ??
    (async () =>
      new Response(
        JSON.stringify({
          id: randomUUID(),
          model: "gemini-3.8-flash",
          choices: [{ finish_reason: "stop", message: { content: "{}" } }],
          usage: {
            prompt_tokens: 400,
            completion_tokens: 1,
            total_tokens: 401,
          },
        }),
      ));
  const model = new LlmClient(db.postgres, environment, fetcher);
  await model.ledger.setup();
  return {
    model,
    scope,
    another: new LlmClient(db.postgres, environment, fetcher),
  };
}
beforeAll(() => db.verify());
afterAll(async () => {
  await db.postgres.query("DELETE FROM llm_model_use WHERE scope=ANY($1)", [
    scopes,
  ]);
  await db.postgres.query("DELETE FROM llm_call WHERE budget_id=ANY($1)", [
    budgets,
  ]);
  await db.postgres.query("DELETE FROM llm_budget WHERE id=ANY($1)", [budgets]);
  await db.close();
});

test("モデル枠を接続間で共有し、枠待ち中は費用・操作枠を予約せず、保存済み結果は待たない", async () => {
  let release!: () => void,
    sent = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport: typeof fetch = async () => {
    if (++sent === 1) await gate;
    return new Response(
      JSON.stringify({
        id: randomUUID(),
        model: "gemini-3.8-flash",
        choices: [{ finish_reason: "stop", message: { content: "{}" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  };
  const { model, another, scope } = await fixture(
    { concurrency: 1, requestsPerMinute: 2 },
    transport,
  );
  const firstId = randomUUID(),
    first = model.complete(firstId, "test", messages);
  await vi.waitFor(() => expect(sent).toBe(1));
  const second = another.complete(randomUUID(), "test", messages);
  await delay(300);
  expect(sent).toBe(1);
  expect((await model.ledger.summary()).calls).toBe(1);
  release();
  const original = await first;
  await second;
  expect(sent).toBe(2);
  expect(await another.complete(firstId, "test", messages)).toEqual(original);
  const third = another.complete(randomUUID(), "test", messages);
  await delay(300);
  expect(sent).toBe(2);
  await db.postgres.query(
    "UPDATE llm_model_use SET created_at=clock_timestamp()-interval '61 seconds' WHERE scope=$1",
    [scope],
  );
  await third;
  expect(sent).toBe(3);
});

test("トークン予約は要求ごとに行い、実績へ精算し、直近1分の枠が空くまで次を待つ", async () => {
  const { model, another, scope } = await fixture({ tokensPerMinute: 800 });
  await model.complete(randomUUID(), "test", messages);
  expect(
    (
      await db.postgres.query(
        "SELECT tokens::int,active_until FROM llm_model_use WHERE scope=$1",
        [scope],
      )
    ).rows,
  ).toEqual([{ tokens: 401, active_until: null }]);
  const next = another.complete(randomUUID(), "test", messages);
  await delay(300);
  expect((await model.ledger.summary()).calls).toBe(1);
  await db.postgres.query(
    "UPDATE llm_model_use SET created_at=clock_timestamp()-interval '61 seconds' WHERE scope=$1",
    [scope],
  );
  await next;
  expect((await model.ledger.summary()).calls).toBe(2);
});

test("1回分も入らない設定と費用不足は送信前に停止し、モデル枠を消費しない", async () => {
  const tooSmall = await fixture({ tokensPerMinute: 1 });
  await expect(
    tooSmall.model.complete(randomUUID(), "test", messages),
  ).rejects.toThrow("1要求のトークン予約");
  const noMoney = await fixture({ concurrency: 1 }, undefined, "0.01");
  await expect(
    noMoney.model.complete(randomUUID(), "test", messages),
  ).rejects.toThrow("費用上限");
  expect(
    (
      await db.postgres.query(
        "SELECT 1 FROM llm_model_use WHERE scope=ANY($1)",
        [[tooSmall.scope, noMoney.scope]],
      )
    ).rowCount,
  ).toBe(0);
});
