import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { BudgetUnavailable, LlmClient, llmApiKey } from "@gestaloka/server/llm";

const databases = connectDatabases();
const budgets: string[] = [];
const environment = () => {
  const id = randomUUID();
  budgets.push(id);
  return {
    DEEPSEEK_API_KEY: "unused",
    LLM_BUDGET_ID: id,
    LLM_BUDGET_USD: "40",
  };
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

test("開発用の100ドルを製品の固定上限にせず、管理者のAPI費用枠を独立に設定できる", () => {
  const model = new LlmClient(databases.postgres, {
    ...environment(),
    LLM_BUDGET_USD: "1000",
  });
  expect(model.settings.budgetUsd).toBe(1000);
});

test("使用量をピーク料金で精算し、再接続後も保存済み応答を再送なしで再利用する", async () => {
  const config = environment();
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => response());
  const client = new LlmClient(databases.postgres, config, transport);
  await client.ledger.setup();
  const id = randomUUID();
  const messages = [{ role: "user" as const, content: "JSON" }];
  const first = await client.complete(id, "probe", messages);
  const another = new LlmClient(databases.postgres, config, transport);
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
  const a = new LlmClient(databases.postgres, config, transport);
  const b = new LlmClient(databases.postgres, config, transport);
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
  const client = new LlmClient(databases.postgres, config, transport);
  await client.ledger.setup();
  const id = randomUUID();
  await expect(client.complete(id, "probe", [])).rejects.toThrow(
    "response lost",
  );
  const reopened = new LlmClient(databases.postgres, config, transport);
  await expect(reopened.complete(id, "probe", [])).rejects.toBeInstanceOf(
    BudgetUnavailable,
  );
  expect(transport).toHaveBeenCalledTimes(1);
  expect((await client.ledger.summary()).upperCostUsd).toBeGreaterThan(0);
  const raised = new LlmClient(
    databases.postgres,
    { ...config, LLM_BUDGET_USD: "100" },
    transport,
  );
  await expect(raised.ledger.setup()).rejects.toBeInstanceOf(BudgetUnavailable);
  const before = await client.ledger.summary();
  expect(before.limitUsd).toBe(40);
  await databases.postgres.query(
    "UPDATE llm_budget SET limit_nano=100000000000 WHERE id=$1",
    [config.LLM_BUDGET_ID],
  );
  await raised.ledger.setup();
  expect(await raised.ledger.summary()).toEqual({ ...before, limitUsd: 100 });
  await expect(raised.complete(id, "probe", [])).rejects.toBeInstanceOf(
    BudgetUnavailable,
  );
  expect(transport).toHaveBeenCalledTimes(1);
});

test("推論量の設定を変更しても保存済み呼出しを再送せず、新しい呼出しだけへ適用する", async () => {
  const config = environment(),
    transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response());
  const high = new LlmClient(databases.postgres, config, transport);
  await high.ledger.setup();
  const id = randomUUID(),
    messages = [{ role: "user" as const, content: "JSONで返す" }];
  const saved = await high.complete(id, "probe", messages);
  const low = new LlmClient(
    databases.postgres,
    { ...config, LLM_REASONING_EFFORT: "none" },
    transport,
  );
  expect(await low.complete(id, "probe", messages)).toEqual(saved);
  expect(transport).toHaveBeenCalledTimes(1);
  await low.complete(randomUUID(), "probe", messages);
  expect(
    JSON.parse(String(transport.mock.calls[1]![1]!.body)).reasoning_effort,
  ).toBe("none");
  await low.complete(randomUUID(), "initial-generation", messages);
  expect(
    JSON.parse(String(transport.mock.calls[2]![1]!.body)).reasoning_effort,
  ).toBe("high");
  expect(
    ((await low.ledger.input(id)) as { request: { reasoning_effort: string } })
      .request.reasoning_effort,
  ).toBe("high");
});

test.each([
  { model: "gemini-3.8-flash", prefix: "GEMINI", output: 27, cost: 0.0002475 },
  { model: "gpt-6-luna", prefix: "OPENAI", output: 20, cost: 0.0000225 },
])(
  "$modelを専用キーとendpointで接続し、lowと使用量を扱う",
  async ({ model, prefix, output, cost }) => {
    const config = {
      ...environment(),
      DEEPSEEK_API_KEY: undefined,
      LLM_MODEL: model,
      LLM_REASONING_EFFORT: "high",
      LLM_INITIAL_REASONING_EFFORT: "high",
      [`${prefix}_API_KEY`]: "provider-key",
      [`${prefix}_BASE_URL`]: "https://provider.example/v1/",
      [`${prefix}_REASONING_EFFORT`]: "low",
      [`${prefix}_INITIAL_REASONING_EFFORT`]: "low",
    };
    const transport = vi.fn<typeof fetch>().mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith("/models")
              ? {
                  data: [
                    { id: prefix === "GEMINI" ? `models/${model}` : model },
                  ],
                }
              : {
                  id: randomUUID(),
                  model,
                  choices: [
                    {
                      finish_reason: "stop",
                      message: { content: '{"connected":true}' },
                    },
                  ],
                  usage: {
                    prompt_tokens: 30,
                    completion_tokens: 20,
                    total_tokens: 30 + output,
                    ...(prefix === "OPENAI"
                      ? { prompt_tokens_details: { cached_tokens: 10 } }
                      : {}),
                  },
                },
          ),
        ),
    );
    expect(llmApiKey(config)).toBe("provider-key");
    expect(
      llmApiKey({ ...config, [`${prefix}_API_KEY`]: undefined }),
    ).toBeUndefined();
    const client = new LlmClient(databases.postgres, config, transport);
    await client.ledger.setup();
    expect((await client.verifyModel()).apiModel).toBe(model);
    const id = randomUUID(),
      messages = [{ role: "user" as const, content: "JSON" }];
    const completed = await client.complete(id, "probe", messages);
    expect(completed.usage.completion_tokens).toBe(output);
    expect((await client.ledger.summary()).upperCostUsd).toBe(cost);
    const [url, init] = transport.mock.calls[1]!;
    expect(String(url)).toBe("https://provider.example/v1/chat/completions");
    expect(init!.headers).toMatchObject({
      Authorization: "Bearer provider-key",
    });
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({
      model,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    });
    expect(
      body[prefix === "OPENAI" ? "max_completion_tokens" : "max_tokens"],
    ).toBe(16384);
    expect(body).not.toHaveProperty(
      prefix === "OPENAI" ? "max_tokens" : "max_completion_tokens",
    );
    if (prefix === "OPENAI") expect(body.service_tier).toBe("default");
    const reopened = new LlmClient(
      databases.postgres,
      {
        ...config,
        LLM_MODEL: "deepseek-flash",
        DEEPSEEK_API_KEY: "other-provider-key",
      },
      transport,
    );
    expect(await reopened.complete(id, "probe", messages)).toEqual(completed);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(await client.ledger.input(id))).not.toContain(
      "provider-key",
    );
    await client.complete(randomUUID(), "initial-generation", messages);
    expect(
      JSON.parse(String(transport.mock.calls[2]![1]!.body)).reasoning_effort,
    ).toBe("low");
  },
);

test("旧DeepSeek形式の保存済み要求はモデル切替後も同じハッシュで再利用する", async () => {
  const config = environment();
  const client = new LlmClient(
    databases.postgres,
    config,
    vi.fn<typeof fetch>(),
  );
  await client.ledger.setup();
  const id = randomUUID(),
    messages = [{ role: "user" as const, content: "JSON" }];
  const legacy = {
    role: "probe",
    requestedVersion: "DeepSeek-V4.1-Flash-1017",
    pricingDate: "2026-10-19",
    request: {
      model: "deepseek-flash",
      messages,
      response_format: { type: "json_object" },
      reasoning_effort: "high",
      max_tokens: 16384,
      stream: false,
    },
  };
  await client.ledger.reserve(
    id,
    createHash("sha256").update(JSON.stringify(legacy)).digest("hex"),
    400000000,
    legacy,
  );
  const saved = {
    id: "saved",
    model: "deepseek-flash",
    content: '{"connected":true}',
    finishReason: "stop",
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 1,
    },
  };
  await client.ledger.settle(id, 1500, saved, 1);
  const transport = vi.fn<typeof fetch>();
  const switched = new LlmClient(
    databases.postgres,
    {
      ...config,
      DEEPSEEK_API_KEY: undefined,
      LLM_MODEL: "gpt-6-luna",
      OPENAI_API_KEY: "unused",
    },
    transport,
  );
  expect(await switched.complete(id, "probe", messages)).toEqual(saved);
  expect(transport).not.toHaveBeenCalled();
});

test.each(["gemini-3.8-flash", "gpt-6-luna"])(
  "%sも共通の費用上限を超えて送信しない",
  async (model) => {
    const transport = vi.fn<typeof fetch>();
    const client = new LlmClient(
      databases.postgres,
      {
        ...environment(),
        LLM_MODEL: model,
        GEMINI_API_KEY: "unused",
        OPENAI_API_KEY: "unused",
        LLM_BUDGET_USD: "0.01",
      },
      transport,
    );
    await client.ledger.setup();
    await expect(
      client.complete(randomUUID(), "probe", []),
    ).rejects.toBeInstanceOf(BudgetUnavailable);
    expect(transport).not.toHaveBeenCalled();
    expect((await client.ledger.summary()).upperCostUsd).toBe(0);
  },
);

test.each(["messages", "responses"] as const)(
  "上位モデルを%sで提案・確定へ配分し、利用量と保存済み要求を維持する",
  async (api) => {
    const base = environment(),
      modelName =
        api === "messages" ? "claude-upper-for-test" : "custom-upper-for-test";
    const config = {
      ...base,
      LLM_RESOLUTION_PROVIDER: api === "messages" ? "anthropic" : "openai",
      LLM_RESOLUTION_MODEL: modelName,
      LLM_RESOLUTION_API: api,
      LLM_RESOLUTION_REASONING_EFFORT: "high",
      LLM_RESOLUTION_CONTEXT_TOKENS: "10000",
      LLM_RESOLUTION_MAX_OUTPUT_TOKENS: "1000",
      LLM_RESOLUTION_INPUT_USD_PER_MILLION: "20",
      LLM_RESOLUTION_CACHED_INPUT_USD_PER_MILLION: "2",
      LLM_RESOLUTION_OUTPUT_USD_PER_MILLION: "60",
      ANTHROPIC_API_KEY: "upper-secret",
      OPENAI_API_KEY: "upper-secret",
    };
    const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith("/models"))
        return new Response(JSON.stringify({ data: [{ id: modelName }] }));
      if (String(url).endsWith("/chat/completions")) return response();
      return new Response(
        JSON.stringify(
          api === "messages"
            ? {
                id: randomUUID(),
                model: modelName,
                stop_reason: "end_turn",
                content: [
                  { type: "thinking", thinking: "PRIVATE_THINKING" },
                  { type: "text", text: '{"connected":true}' },
                ],
                usage: {
                  input_tokens: 10,
                  cache_creation_input_tokens: 4,
                  cache_read_input_tokens: 6,
                  output_tokens: 3,
                },
              }
            : {
                id: randomUUID(),
                model: modelName,
                status: "completed",
                output: [
                  {
                    type: "reasoning",
                    content: [
                      { type: "summary_text", text: "PRIVATE_THINKING" },
                    ],
                  },
                  {
                    type: "message",
                    content: [
                      { type: "output_text", text: '{"connected":true}' },
                    ],
                  },
                ],
                usage: {
                  input_tokens: 20,
                  input_tokens_details: { cached_tokens: 6 },
                  output_tokens: 3,
                },
              },
        ),
      );
    });
    const client = new LlmClient(databases.postgres, config, transport);
    await client.ledger.setup();
    expect((await client.verifyModel("resolution")).apiModel).toBe(modelName);
    const messages = [
      { role: "system" as const, content: "JSON" },
      { role: "user" as const, content: "JSON" },
    ];
    await client.complete(randomUUID(), "observation", messages);
    const id = randomUUID(),
      result = await client.complete(
        id,
        "world-update",
        messages,
        "resolution",
      );
    await client.complete(randomUUID(), "world-commit", messages, "resolution");
    expect(result.content).toBe('{"connected":true}');
    expect(result.usage).toEqual({
      prompt_tokens: 20,
      completion_tokens: 3,
      prompt_cache_hit_tokens: 6,
      prompt_cache_miss_tokens: 14,
    });
    const requests = transport.mock.calls
      .slice(2)
      .map((c) => JSON.parse(String(c[1]?.body)));
    expect(requests.every((r) => r.model === modelName)).toBe(true);
    if (api === "messages") {
      expect(requests[0]).toMatchObject({
        system: "JSON",
        messages: [{ role: "user", content: "JSON" }],
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      });
      expect(transport.mock.calls[2]![1]!.headers).toMatchObject({
        "x-api-key": "upper-secret",
        "anthropic-version": "2023-06-01",
      });
    } else
      expect(requests[0]).toMatchObject({
        input: messages,
        reasoning: { effort: "high" },
        max_output_tokens: 1000,
        store: false,
      });
    const switched = new LlmClient(databases.postgres, base, transport);
    expect(
      await switched.complete(id, "world-update", messages, "resolution"),
    ).toEqual(result);
    expect(transport).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(await client.ledger.input(id))).not.toMatch(
      /upper-secret|PRIVATE_THINKING/,
    );
    expect((await client.ledger.summary()).upperCostUsd).toBeCloseTo(
      0.00097406,
      9,
    );
  },
);

test("未登録モデルの料金・文脈上限が未設定なら送信前に拒否する", () => {
  expect(
    () =>
      new LlmClient(databases.postgres, {
        ...environment(),
        LLM_MODEL: "claude-upper-for-test",
        ANTHROPIC_API_KEY: "unused",
      }),
  ).toThrow("CONTEXT_TOKENS");
  expect(
    () =>
      new LlmClient(databases.postgres, {
        ...environment(),
        LLM_MODEL: "claude-upper-for-test",
        ANTHROPIC_API_KEY: "unused",
        LLM_CONTEXT_TOKENS: "100000",
      }),
  ).toThrow("料金が未設定");
});
