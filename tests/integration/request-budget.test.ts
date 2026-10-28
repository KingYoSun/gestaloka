import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { ExecutionBudget } from "@gestaloka/server";
import { BudgetLedger, LlmClient } from "@gestaloka/server/llm";
import { WorldBudget } from "../../packages/server/src/llm/world-budget.js";
import { isolatedDatabases } from "../support/isolated-db.js";

const isolated = isolatedDatabases(),
  pool = isolated.databases.postgres;
beforeAll(() => isolated.setup());
afterAll(() => isolated.close());
const env = () => ({
  LLM_BUDGET_ID: randomUUID(),
  LLM_BUDGET_USD: "0.70",
  LLM_PROVIDER: "anthropic",
  LLM_API: "messages",
  LLM_MODEL: "test-claude",
  ANTHROPIC_API_KEY: "private-key",
  LLM_CONTEXT_TOKENS: "1000000",
  LLM_MAX_OUTPUT_TOKENS: "65536",
  LLM_INPUT_USD_PER_MILLION: "2",
  LLM_CACHED_INPUT_USD_PER_MILLION: "0.1",
  LLM_OUTPUT_USD_PER_MILLION: "10",
});
const messages = [
  {
    role: "user" as const,
    content: JSON.stringify({
      responseSchema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    }),
  },
];
const completion = {
  id: "upstream",
  model: "test-claude",
  content: "{}",
  finishReason: "stop",
  usage: {
    prompt_tokens: 20,
    completion_tokens: 5,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 20,
  },
};
const reply = () =>
  Response.json({
    id: "upstream",
    model: "test-claude",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "{}" }],
    usage: { input_tokens: 20, output_tokens: 5 },
  });
const quote = 1234 * 4000 + 65536 * 10000;

test.each(["complete", "unknown"])(
  "%s: 最大入力長の費用を持たない残額でも実入力で予約し、保存済み要求を再計数・再送しない",
  async (ending) => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith("/count_tokens"))
        return Response.json({ input_tokens: 1234 });
      expect((await client.ledger.summary()).upperCostUsd).toBe(quote / 1e9);
      if (ending === "unknown") throw new Error("通信結果不明");
      return reply();
    });
    const client = new LlmClient(pool, env(), transport);
    await client.ledger.setup();
    const id = randomUUID();
    if (ending === "complete")
      await client.complete(id, "scene-result", messages);
    else
      await expect(
        client.complete(id, "scene-result", messages),
      ).rejects.toThrow("通信結果不明");
    const [counted, generated] = transport.mock.calls.map((c) =>
      JSON.parse(String(c[1]?.body)),
    );
    const { max_tokens, stream, ...input } = generated;
    expect(max_tokens).toBe(65536);
    expect(stream).toBe(true);
    expect(counted).toEqual(input);
    expect(counted.output_config.format).toBeDefined();
    const row = (
      await pool.query(
        "SELECT state,reserved_nano::text,reservation_basis,request FROM llm_call WHERE id=$1",
        [id],
      )
    ).rows[0];
    expect(row.reserved_nano).toBe(String(quote));
    expect(row.reservation_basis).toEqual({
      version: 1,
      source: "anthropic-count-tokens",
      inputTokens: 1234,
    });
    expect(JSON.stringify(row)).not.toContain("private-key");
    if (ending === "complete") {
      await client.complete(id, "scene-result", messages);
      expect((await client.ledger.summary()).upperCostUsd).toBe(0.00009);
    } else {
      await expect(
        client.complete(id, "scene-result", messages),
      ).rejects.toThrow("自動では再送");
      expect(await client.ledger.summary()).toMatchObject({
        upperCostUsd: quote / 1e9,
        unsettled: 1,
      });
    }
    expect(transport).toHaveBeenCalledTimes(2);
  },
);

test.each(["HTTP", "shape", "network"])(
  "事前計数の%s失敗では生成を送信せず予約を作らない",
  async (failure) => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (failure === "network") throw new Error("count unavailable");
      return failure === "HTTP"
        ? new Response(null, { status: 503 })
        : Response.json({ input_tokens: "invalid" });
    });
    const client = new LlmClient(pool, env(), transport);
    await client.ledger.setup();
    await expect(
      client.complete(randomUUID(), "test", messages),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]![0])).toContain(
      "/messages/count_tokens",
    );
    expect(await client.ledger.summary()).toMatchObject({
      upperCostUsd: 0,
      calls: 0,
      unsettled: 0,
    });
  },
);

test("入力計数の推定を上回る実使用量も精算し、以後の要求は実額で予算判定する", async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    String(url).endsWith("/count_tokens")
      ? Response.json({ input_tokens: 1 })
      : Response.json({
          id: "upstream",
          model: "test-claude",
          stop_reason: "max_tokens",
          content: [{ type: "text", text: "{}" }],
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 2,
            cache_creation: {
              ephemeral_5m_input_tokens: 0,
              ephemeral_1h_input_tokens: 2,
            },
            output_tokens: 65536,
          },
        }),
  );
  const client = new LlmClient(
    pool,
    { ...env(), LLM_BUDGET_USD: "0.655364" },
    transport,
  );
  await client.ledger.setup();
  await client.complete(randomUUID(), "test", messages);
  expect(await client.ledger.summary()).toMatchObject({
    upperCostUsd: 0.655368,
    unsettled: 0,
  });
  await expect(client.complete(randomUUID(), "test", messages)).rejects.toThrow(
    "費用上限",
  );
  expect(
    transport.mock.calls.filter((c) => String(c[0]).endsWith("/messages")),
  ).toHaveLength(1);
});

test("同時要求でも実入力と最大出力の合計が残額を超える生成を送信しない", async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith("/count_tokens"))
      return Response.json({ input_tokens: 1234 });
    throw new Error("通信結果不明");
  });
  const client = new LlmClient(pool, env(), transport);
  await client.ledger.setup();
  await Promise.allSettled([
    client.complete(randomUUID(), "test", messages),
    client.complete(randomUUID(), "test", messages),
  ]);
  expect(
    transport.mock.calls.filter((c) => String(c[0]).endsWith("/messages")),
  ).toHaveLength(1);
  expect(await client.ledger.summary()).toMatchObject({
    upperCostUsd: quote / 1e9,
    calls: 1,
    unsettled: 1,
  });
});

test.each([false, true])(
  "旧予約の改定は元要求と世界予算を保持し、重複と精算競合で二重解放しない（競合=%s）",
  async (race) => {
    const ledger = new BudgetLedger(pool, randomUUID(), 10_000_000_000);
    await ledger.setup();
    const id = randomUUID(),
      world = randomUUID(),
      hash = "original-hash",
      request = { model: "frozen-request" };
    await WorldBudget.create(pool, world, 10);
    await ExecutionBudget.run(
      pool,
      randomUUID(),
      () => ledger.reserve(id, hash, 4_655_360_000, request),
      world,
    );
    await expect(
      ledger.reviseReservation(id, "wrong-hash", quote, 1234),
    ).rejects.toThrow("一致しません");
    if (race) {
      await Promise.all([
        ledger.reviseReservation(id, hash, quote, 1234),
        ledger.settle(id, 90_000, completion, 1),
      ]);
    } else {
      expect(
        (
          await Promise.all([
            ledger.reviseReservation(id, hash, quote, 1234),
            ledger.reviseReservation(id, hash, quote, 1234),
          ])
        ).sort(),
      ).toEqual([false, true]);
      expect(await ledger.summary()).toMatchObject({
        upperCostUsd: quote / 1e9,
        unsettled: 1,
      });
      expect((await WorldBudget.read(pool, world))?.upperCostUsd).toBe(
        quote / 1e9,
      );
      const row = (
        await pool.query(
          "SELECT state,delivery,request,hash,charged_nano,reservation_basis FROM llm_call WHERE id=$1",
          [id],
        )
      ).rows[0];
      expect(row).toMatchObject({
        state: "pending",
        delivery: "reserved",
        request,
        hash,
        charged_nano: null,
        reservation_basis: {
          inputTokens: 1234,
          previousNanoUsd: "4655360000",
          requestHash: hash,
        },
      });
      await ledger.settle(id, 90_000, completion, 1);
    }
    expect(await ledger.reviseReservation(id, hash, quote, 1234)).toBe(false);
    expect((await ledger.summary()).upperCostUsd).toBe(0.00009);
    expect((await WorldBudget.read(pool, world))?.upperCostUsd).toBe(0.00009);
  },
);
