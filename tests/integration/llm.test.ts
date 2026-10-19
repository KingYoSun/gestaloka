import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import {
  BudgetLedger,
  BudgetUnavailable,
  DeepSeekClient,
} from "@gestaloka/server/llm";

const databases = connectDatabases();
const budgets: string[] = [];
const environment = () => {
  const id = randomUUID();
  budgets.push(id);
  return { DEEPSEEK_API_KEY: "unused", LLM_BUDGET_ID: id };
};
const response = () =>
  new Response(
    JSON.stringify({
      id: randomUUID(),
      model: "deepseek-flash",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: '{"connected":true}',
            reasoning_content: "not persisted",
          },
        },
      ],
      usage: {
        prompt_tokens: 30,
        completion_tokens: 20,
        prompt_cache_hit_tokens: 10,
        prompt_cache_miss_tokens: 20,
      },
    }),
  );
beforeAll(() => databases.verify());
afterAll(async () => {
  await databases.postgres.query(
    "DELETE FROM llm_call WHERE budget_id = ANY($1)",
    [budgets],
  );
  await databases.postgres.query("DELETE FROM llm_budget WHERE id = ANY($1)", [
    budgets,
  ]);
  await databases.close();
});

test("使用量をピーク料金で精算し、再接続後も保存済み応答を再送なしで再利用する", async () => {
  const config = environment();
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => response());
  const client = new DeepSeekClient(databases.postgres, config, transport);
  await client.ledger.setup();
  const id = randomUUID();
  const messages = [{ role: "user" as const, content: "JSON" }];
  const first = await client.complete(id, "probe", messages);
  const another = new DeepSeekClient(databases.postgres, config, transport);
  expect(await another.complete(id, "probe", messages)).toEqual(first);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveProperty("reasoning_content");
  expect(await client.ledger.summary()).toMatchObject({
    limitUsd: 40,
    calls: 1,
    unsettled: 0,
    upperCostUsd: 0.00003006,
  });
  const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({
    model: "deepseek-flash",
    max_tokens: 16384,
    response_format: { type: "json_object" },
  });
  await expect(
    client.complete(id, "probe", [{ role: "user", content: "different JSON" }]),
  ).rejects.toThrow("異なる要求");
});

test("複数呼出しの予約が競合しても、費用上限を超えて送信しない", async () => {
  const config = { ...environment(), LLM_BUDGET_USD: "0.34" };
  const transport = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("connection lost"));
  const a = new DeepSeekClient(databases.postgres, config, transport);
  const b = new DeepSeekClient(databases.postgres, config, transport);
  await a.ledger.setup();
  const results = await Promise.allSettled([
    a.complete(randomUUID(), "probe", []),
    b.complete(randomUUID(), "probe", []),
  ]);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(
    results.some(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof BudgetUnavailable,
    ),
  ).toBe(true);
  const saved = await a.ledger.summary();
  expect(saved.upperCostUsd).toBeLessThanOrEqual(0.34);
  expect(saved.unsettled).toBe(1);
});

test("応答喪失後は予約を維持し、同じ呼出しを自動再送しない", async () => {
  const config = environment();
  const transport = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("response lost"));
  const client = new DeepSeekClient(databases.postgres, config, transport);
  await client.ledger.setup();
  const id = randomUUID();
  await expect(client.complete(id, "probe", [])).rejects.toThrow(
    "response lost",
  );
  const reopened = new DeepSeekClient(databases.postgres, config, transport);
  await expect(reopened.complete(id, "probe", [])).rejects.toBeInstanceOf(
    BudgetUnavailable,
  );
  expect(transport).toHaveBeenCalledTimes(1);
  expect((await client.ledger.summary()).upperCostUsd).toBeGreaterThan(0);
  await expect(
    new BudgetLedger(
      databases.postgres,
      config.LLM_BUDGET_ID,
      41_000_000_000,
    ).setup(),
  ).rejects.toBeInstanceOf(BudgetUnavailable);
});

test("推論量の設定を変更しても保存済み呼出しを再送せず、新しい呼出しだけへ適用する", async () => {
  const config = environment(),
    transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response());
  const high = new DeepSeekClient(databases.postgres, config, transport);
  await high.ledger.setup();
  const id = randomUUID(),
    messages = [{ role: "user" as const, content: "JSONで返す" }];
  const saved = await high.complete(id, "probe", messages);
  const low = new DeepSeekClient(
    databases.postgres,
    { ...config, LLM_REASONING_EFFORT: "low" },
    transport,
  );
  expect(await low.complete(id, "probe", messages)).toEqual(saved);
  expect(transport).toHaveBeenCalledTimes(1);
  await low.complete(randomUUID(), "probe", messages);
  expect(
    JSON.parse(String(transport.mock.calls[1]![1]!.body)).reasoning_effort,
  ).toBe("low");
  expect(
    ((await low.ledger.input(id)) as { request: { reasoning_effort: string } })
      .request.reasoning_effort,
  ).toBe("high");
});
