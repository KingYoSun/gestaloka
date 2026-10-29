import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LlmClient } from "@gestaloka/server/llm";
import { readCosts } from "../../packages/server/src/llm/costs.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { createCountedClient } from "../support/token-counting.js";

let isolated: ReturnType<typeof isolatedDatabases>;
const messages = (action: string) => [
  { role: "system" as const, content: "JSONで答える" },
  {
    role: "user" as const,
    content: JSON.stringify({
      background: { text: "固定背景".repeat(5000) },
      sceneHistory: [],
      request: { action },
      responseSchema: { type: "object" },
    }),
  },
];
const environment = (overrides = {}) => ({
  LLM_MODEL: "gemini-3.8-flash",
  GEMINI_API_KEY: "private-key",
  LLM_BUDGET_ID: randomUUID(),
  LLM_BUDGET_USD: "3",
  ...overrides,
});
beforeEach(async () => {
  isolated = isolatedDatabases();
  await isolated.setup();
});
afterEach(async () => {
  await isolated.close();
});

test("Geminiの明示キャッシュをプロセス間で再利用し、期限切れと資格情報の変更を分離して保管料を明細へ含める", async () => {
  let creates = 0,
    generations = 0;
  const transport: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith(":countTokens"))
      return Response.json({ totalTokens: 5000 });
    if (String(url).endsWith("/cachedContents")) {
      creates++;
      expect(body.ttl).toBe("300s");
      expect(JSON.stringify(body)).not.toContain("最初の問い");
      const now = Date.now();
      return Response.json({
        name: `cachedContents/cache-${creates}`,
        createTime: new Date(now).toISOString(),
        expireTime: new Date(now + 300000).toISOString(),
        usageMetadata: { totalTokenCount: 5000 },
      });
    }
    generations++;
    expect(body.extra_body.google.cached_content).toMatch(
      /^cachedContents\/cache-/,
    );
    expect(JSON.stringify(body.messages)).not.toContain("固定背景");
    return Response.json({
      id: randomUUID(),
      model: "gemini-3.8-flash",
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
      usage: {
        prompt_tokens: 6000,
        completion_tokens: 20,
        total_tokens: 6020,
        prompt_tokens_details: { cached_tokens: 5000 },
      },
    });
  };
  const env = environment(),
    pool = isolated.databases.postgres,
    client = new LlmClient(pool, env, transport);
  await client.ledger.setup();
  const id = randomUUID();
  await client.complete(id, "scene-resolve", messages("最初の問い"));
  await new LlmClient(pool, env, transport).complete(
    randomUUID(),
    "scene-resolve",
    messages("次の問い"),
  );
  await client.complete(id, "scene-resolve", messages("最初の問い"));
  expect({ creates, generations }).toEqual({ creates: 1, generations: 2 });
  await pool.query(
    "UPDATE llm_prompt_cache SET expires_at=clock_timestamp()-interval '1 second'",
  );
  await client.complete(
    randomUUID(),
    "scene-resolve",
    messages("期限後の問い"),
  );
  await new LlmClient(
    pool,
    { ...env, GEMINI_API_KEY: "other-key" },
    transport,
  ).complete(randomUUID(), "scene-resolve", messages("別資格情報の問い"));
  expect(creates).toBe(3);
  await pool.query(
    "CREATE TABLE world_build(run_id uuid PRIMARY KEY,world_id uuid UNIQUE NOT NULL)",
  );
  const result = await readCosts(pool, {
    from: "2026-01-01T00:00:00Z",
    to: "2030-01-01T00:00:00Z",
    view: "calls",
    interval: "day",
  });
  const storage = result.calls!.filter((c) => c.task === "prompt-cache");
  expect(storage).toHaveLength(3);
  for (const c of storage) {
    expect(c.cacheStorage).toEqual({
      tokenSeconds: 1500000,
      nanoUsdPerTokenSecond: 500 / 3600,
    });
    expect(c.calculatedNanoUsd).toBe("208334");
  }
  expect(JSON.stringify(result)).not.toMatch(/private-key|other-key|固定背景/);
  const reservations = (
    await pool.query(
      "SELECT reservation_basis FROM llm_call WHERE request->>'role'='scene-resolve'",
    )
  ).rows;
  expect(
    reservations.every(
      (r) =>
        r.reservation_basis.source === "gemini-count-tokens" &&
        r.reservation_basis.inputTokens === 5000,
    ),
  ).toBe(true);
});

test("Geminiの作成結果が未確定でも予約を保持し、同じ作成を再送しない", async () => {
  let creates = 0;
  const transport: typeof fetch = async (url) => {
    if (String(url).endsWith(":countTokens"))
      return Response.json({ totalTokens: 5000 });
    if (String(url).endsWith("/cachedContents")) {
      creates++;
      throw new TypeError("connection lost");
    }
    return Response.json({
      id: randomUUID(),
      model: "gemini-3.8-flash",
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 5000, completion_tokens: 1, total_tokens: 5001 },
    });
  };
  const client = new LlmClient(
    isolated.databases.postgres,
    environment(),
    transport,
  );
  await client.ledger.setup();
  const id = randomUUID();
  await expect(
    client.complete(id, "scene-resolve", messages("問い")),
  ).rejects.toThrow("connection lost");
  await client.complete(id, "scene-resolve", messages("問い"));
  expect(creates).toBe(1);
  expect(await client.ledger.summary()).toMatchObject({ unsettled: 1 });
  const pending = (
    await isolated.databases.postgres.query(
      "SELECT reserved_nano::text,delivery FROM llm_call WHERE state='pending'",
    )
  ).rows;
  expect(pending).toEqual([{ reserved_nano: "208334", delivery: "unknown" }]);
});

test("Geminiの指示だけのprefixも内容を計数し、空のcontentsで計数APIへ送らない", async () => {
  let created = 0;
  const transport: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith(":countTokens")) {
      expect(
        body.generateContentRequest?.contents?.length ?? body.contents?.length,
      ).toBeGreaterThan(0);
      return Response.json({ totalTokens: 5000 });
    }
    if (String(url).endsWith("/cachedContents")) {
      created++;
      const now = Date.now();
      return Response.json({
        name: "cachedContents/instructions",
        createTime: new Date(now).toISOString(),
        expireTime: new Date(now + 300000).toISOString(),
        usageMetadata: { totalTokenCount: 5000 },
      });
    }
    expect(body.extra_body.google.cached_content).toBe(
      "cachedContents/instructions",
    );
    return Response.json({
      id: randomUUID(),
      model: "gemini-3.8-flash",
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
      usage: {
        prompt_tokens: 5001,
        completion_tokens: 1,
        total_tokens: 5002,
        prompt_tokens_details: { cached_tokens: 5000 },
      },
    });
  };
  const client = new LlmClient(
    isolated.databases.postgres,
    environment(),
    transport,
  );
  await client.ledger.setup();
  await client.complete(randomUUID(), "narrative-inspection", [
    { role: "system", content: "JSONの共通指示".repeat(1000) },
    { role: "user", content: "今回の依頼" },
  ]);
  expect(created).toBe(1);
});

test("OpenAIのChat・Responsesへ明示境界を送信し、旧要求の再利用では再送しない", async () => {
  for (const api of ["responses", "chat-completions"] as const) {
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.prompt_cache_options).toEqual({
        mode: "explicit",
        ttl: "30m",
      });
      expect(JSON.stringify(body)).toContain("prompt_cache_breakpoint");
      return api === "responses"
        ? Response.json({
            id: randomUUID(),
            model: "gpt-6.1-terra",
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: '{"ok":true}' }],
              },
            ],
            usage: {
              input_tokens: 6000,
              output_tokens: 20,
              input_tokens_details: {
                cached_tokens: 5000,
                cache_write_tokens: 1000,
              },
            },
          })
        : Response.json({
            id: randomUUID(),
            model: "gpt-6.1-terra",
            choices: [
              { finish_reason: "stop", message: { content: '{"ok":true}' } },
            ],
            usage: {
              prompt_tokens: 6000,
              completion_tokens: 20,
              total_tokens: 6020,
              prompt_tokens_details: {
                cached_tokens: 5000,
                cache_write_tokens: 1000,
              },
            },
          });
    });
    const client = createCountedClient(
      isolated.databases.postgres,
      environment({
        LLM_MODEL: "gpt-6.1-terra",
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "private-key",
        OPENAI_API: api,
      }),
      transport,
    );
    await client.ledger.setup();
    const id = randomUUID();
    await client.complete(id, "scene-resolve", messages("問い"));
    await client.complete(id, "scene-resolve", messages("問い"));
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await client.ledger.summary()).upperCostUsd).toBe(0.0016);
  }
});
