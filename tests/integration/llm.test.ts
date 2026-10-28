import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { connectDatabases } from "@gestaloka/server";
import { BudgetUnavailable, llmApiKey } from "@gestaloka/server/llm";
import { createCountedClient } from "../support/token-counting.js";

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

test.each([
  "scene-result",
  "scene-intent",
  "scene-background",
  "scene-resolve",
  "initial-generation",
])(
  "%sの構造化出力と参照を復元し、設定変更・再開でも凍結した入力と料金を再利用する",
  async (role) => {
    const actor = randomUUID();
    const schema = z
      .object({
        decisions: z.record(z.uuid(), z.enum(["pending", "finished"])),
      })
      .strict();
    const config = {
      ...environment(),
      LLM_MODEL: "claude-sonnet-5-5",
      ANTHROPIC_API_KEY: "unused",
      LLM_CONTEXT_TOKENS: "1000000",
      LLM_INPUT_USD_PER_MILLION: "2",
      LLM_CACHED_INPUT_USD_PER_MILLION: "0.1",
      LLM_OUTPUT_USD_PER_MILLION: "10",
    };
    const transport = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: "structured",
            model: "claude-sonnet-5-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text:
                  role === "initial-generation"
                    ? "```json\n" +
                      JSON.stringify({ decisions: { [actor]: "pending" } }) +
                      "\n```"
                    : JSON.stringify({ decisions: { [actor]: "pending" } }),
              },
            ],
            usage: {
              input_tokens: 10,
              cache_creation_input_tokens: 20,
              cache_read_input_tokens: 30,
              output_tokens: 5,
            },
          }),
        ),
    );
    const client = createCountedClient(databases.postgres, config, transport);
    await client.ledger.setup();
    const messages = [
      { role: "system" as const, content: "固定の指示" },
      {
        role: "user" as const,
        content: JSON.stringify({
          background: { synopsis: "背景" },
          sceneHistory: [],
          request: {
            at: 1,
            actorId: actor,
            intentions: [
              { actorId: actor, actionText: "返答を待つ", continuing: true },
            ],
          },
          responseSchema: z.toJSONSchema(schema, { io: "input" }),
        }),
      },
    ];
    const id = randomUUID(),
      result = await client.complete(id, role, messages);
    expect(schema.parse(JSON.parse(result.content))).toEqual({
      decisions: { [actor]: "pending" },
    });
    const request = JSON.parse(String(transport.mock.calls[0]![1]!.body));
    expect(await client.ledger.input(id)).toMatchObject({
      sourceMessages: messages,
    });
    if (
      ["scene-background", "scene-intent", "initial-generation"].includes(role)
    )
      expect(request.output_config.format).toBeUndefined();
    else
      expect(
        request.output_config.format.schema.properties.decisions.type,
      ).toBe("object");
    expect(request.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(
      request.messages[0].content.find((b: { text: string }) =>
        b.text.includes("background"),
      ).cache_control,
    ).toBeDefined();
    expect(request.messages[0].content.at(-1).cache_control).toBeUndefined();
    const reopened = createCountedClient(
      databases.postgres,
      { ...config, LLM_MODEL: "claude-haiku-5-5" },
      transport,
    );
    expect(await reopened.complete(id, role, messages)).toEqual(result);
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(
      reopened.complete(id, role, [{ role: "user", content: "別の入力" }]),
    ).rejects.toThrow("異なる要求");
    const summary = await client.ledger.summary();
    expect(summary.upperCostUsd).toBeCloseTo(0.000123, 9);
    const pending = createCountedClient(
      databases.postgres,
      config,
      vi.fn<typeof fetch>().mockRejectedValue(new Error("response lost")),
    );
    const pendingId = randomUUID();
    await expect(pending.complete(pendingId, role, messages)).rejects.toThrow(
      "response lost",
    );
    await expect(reopened.complete(pendingId, role, messages)).rejects.toThrow(
      "自動では再送",
    );
    expect(transport).toHaveBeenCalledTimes(1);
  },
);
beforeAll(() => databases.verify());

test.each([
  "complete",
  "disconnect",
  "error",
  "missing-usage",
  "malformed-usage",
])(
  "Anthropicストリームの%sを区別し、実使用量だけ精算して再送しない",
  async (ending) => {
    const frame = (event: unknown) => `data: ${JSON.stringify(event)}\r\n\r\n`;
    const start = {
      type: "message_start",
      message: {
        id: "msg_stream",
        model: "claude-sonnet-5-5",
        content: [],
        stop_reason: null,
        usage: {
          input_tokens: 10,
          output_tokens: 1,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 20,
          ...(ending === "malformed-usage"
            ? { output_tokens: "PRIVATE_THINKING" }
            : {}),
        },
      },
    };
    const wire = [
      start,
      { type: "ping" },
      { type: "future_event" },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "PRIVATE_THINKING" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "PRIVATE_THINKING" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: '{"挨拶":"こんにちは"}' },
      },
      { type: "content_block_stop", index: 1 },
      ...(ending === "disconnect"
        ? []
        : ending === "error"
          ? [{ type: "error", error: { type: "overloaded_error" } }]
          : [
              {
                type: "message_delta",
                delta: { stop_reason: "end_turn" },
                ...(ending === "missing-usage"
                  ? {}
                  : { usage: { output_tokens: 5 } }),
              },
              { type: "message_stop" },
            ]),
    ]
      .map(frame)
      .join("");
    const bytes = new TextEncoder().encode(wire);
    const transport = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < bytes.length; i += 7)
                controller.enqueue(bytes.slice(i, i + 7));
              controller.close();
            },
          }),
          {
            headers: {
              "content-type": "text/event-stream",
              "request-id": "req_stream",
            },
          },
        ),
    );
    const client = createCountedClient(
      databases.postgres,
      {
        ...environment(),
        LLM_MODEL: "claude-sonnet-5-5",
        ANTHROPIC_API_KEY: "unused",
        LLM_CONTEXT_TOKENS: "1000000",
        LLM_INPUT_USD_PER_MILLION: "2",
        LLM_CACHED_INPUT_USD_PER_MILLION: "0.1",
        LLM_OUTPUT_USD_PER_MILLION: "10",
      },
      transport,
    );
    await client.ledger.setup();
    const id = randomUUID(),
      messages = [{ role: "user" as const, content: "挨拶" }];
    if (ending === "complete") {
      const result = await client.complete(id, "stream-test", messages);
      expect(result).toMatchObject({
        content: '{"挨拶":"こんにちは"}',
        finishReason: "stop",
        usage: {
          prompt_tokens: 60,
          completion_tokens: 5,
          prompt_cache_hit_tokens: 30,
          prompt_cache_miss_tokens: 30,
        },
      });
      expect(await client.complete(id, "stream-test", messages)).toEqual(
        result,
      );
      expect((await client.ledger.summary()).upperCostUsd).toBeCloseTo(
        0.000123,
        9,
      );
    } else {
      await expect(
        client.complete(id, "stream-test", messages),
      ).rejects.toThrow("予約枠");
      await expect(
        client.complete(id, "stream-test", messages),
      ).rejects.toThrow("自動では再送");
      expect((await client.ledger.summary()).unsettled).toBe(1);
    }
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(transport.mock.calls[0]![1]!.body)).stream).toBe(
      true,
    );
    const saved = await databases.postgres.query(
      "SELECT response FROM llm_call WHERE id=$1",
      [id],
    );
    expect(JSON.stringify(saved.rows)).not.toContain("PRIVATE_THINKING");
    if (ending === "malformed-usage")
      expect(saved.rows[0].response).toMatchObject({
        diagnostic: {
          requestId: "req_stream",
          errorName: "ZodError",
          issues: [
            {
              code: "invalid_type",
              path: ["message", "usage", "output_tokens"],
            },
          ],
        },
      });
  },
);

test("未完了出力はJSONとして補完せず、使用量だけ精算し再開時も自動再送しない", async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      id: "truncated",
      model: "claude-sonnet-5-5",
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"text":"未完了' }],
      usage: { input_tokens: 20, output_tokens: 4 },
    }),
  );
  const client = createCountedClient(
    databases.postgres,
    {
      ...environment(),
      LLM_MODEL: "claude-sonnet-5-5",
      ANTHROPIC_API_KEY: "unused",
      LLM_CONTEXT_TOKENS: "10000",
      LLM_MAX_OUTPUT_TOKENS: "4",
      LLM_INPUT_USD_PER_MILLION: "2",
      LLM_CACHED_INPUT_USD_PER_MILLION: "0.1",
      LLM_OUTPUT_USD_PER_MILLION: "10",
    },
    transport,
  );
  await client.ledger.setup();
  const id = randomUUID(),
    messages = [
      {
        role: "user" as const,
        content: JSON.stringify({
          confirmed: { observations: [] },
          responseSchema: z.toJSONSchema(
            z.object({ text: z.string().min(1) }).strict(),
          ),
        }),
      },
    ];
  const first = await client.complete(id, "scene-result", messages);
  expect(first.finishReason).toBe("max_tokens");
  expect(first.content).toBe('{"text":"未完了');
  expect(await client.complete(id, "scene-result", messages)).toEqual(first);
  expect(transport).toHaveBeenCalledTimes(1);
  expect((await client.ledger.summary()).unsettled).toBe(0);
});
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
  const model = createCountedClient(databases.postgres, {
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
  const client = createCountedClient(databases.postgres, config, transport);
  await client.ledger.setup();
  const id = randomUUID();
  const messages = [{ role: "user" as const, content: "JSON" }];
  const first = await client.complete(id, "probe", messages);
  const another = createCountedClient(databases.postgres, config, transport);
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
  const a = createCountedClient(databases.postgres, config, transport);
  const b = createCountedClient(databases.postgres, config, transport);
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
  const client = createCountedClient(databases.postgres, config, transport);
  await client.ledger.setup();
  const id = randomUUID();
  await expect(client.complete(id, "probe", [])).rejects.toThrow(
    "response lost",
  );
  const reopened = createCountedClient(databases.postgres, config, transport);
  await expect(reopened.complete(id, "probe", [])).rejects.toBeInstanceOf(
    BudgetUnavailable,
  );
  expect(transport).toHaveBeenCalledTimes(1);
  expect((await client.ledger.summary()).upperCostUsd).toBeGreaterThan(0);
  const raised = createCountedClient(
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

test.each([
  {
    name: "タイムアウト",
    reply: () => {
      throw new DOMException("timeout", "TimeoutError");
    },
  },
  {
    name: "HTTP 400の本文喪失",
    reply: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("body lost"));
          },
        }),
        { status: 400 },
      ),
  },
  {
    name: "HTTP 400の不正なJSON",
    reply: () => new Response("not JSON", { status: 400 }),
  },
  {
    name: "HTTP 400の未確認の拒否形式",
    reply: () => Response.json({ error: "Bad Request" }, { status: 400 }),
  },
  {
    name: "HTTP 500",
    reply: () =>
      Response.json(
        {
          type: "error",
          error: { type: "invalid_request_error", message: "failure" },
          request_id: "failed",
        },
        { status: 500 },
      ),
  },
  {
    name: "DeepSeekの非課金を確認できないHTTP 400",
    model: "deepseek-flash",
    reply: () =>
      Response.json(
        {
          error: {
            type: "invalid_request_error",
            message: "failure",
            param: null,
            code: "invalid_request_error",
          },
        },
        { status: 400 },
      ),
  },
  ...["chat-completions", "responses"].map((api) => ({
    name: `OpenAI ${api}の非課金を確認できないHTTP 400`,
    model: "gpt-6-luna",
    api,
    reply: () =>
      Response.json(
        {
          error: {
            type: "invalid_request_error",
            message: "failure",
            param: "input",
            code: "invalid_value",
          },
        },
        { status: 400 },
      ),
  })),
  {
    name: "Geminiの本文を確認できないHTTP 400",
    model: "gemini-3.8-flash",
    reply: () => new Response("not JSON", { status: 400 }),
  },
  {
    name: "Geminiの不整合な拒否形式",
    model: "gemini-3.8-flash",
    reply: () =>
      Response.json(
        [{ error: { code: 500, message: "failure", status: "INTERNAL" } }],
        { status: 400 },
      ),
  },
])("$name: 予約を保持し、同じ呼出しを再送しない", async (failure) => {
  const { model, reply } = failure;
  const config = {
    ...environment(),
    LLM_MODEL: model ?? "claude-sonnet-5-5",
    LLM_API: "api" in failure ? failure.api : undefined,
    ANTHROPIC_API_KEY: "unused",
    OPENAI_API_KEY: "unused",
    GEMINI_API_KEY: "unused",
    LLM_CONTEXT_TOKENS: "10000",
    LLM_MAX_OUTPUT_TOKENS: "1000",
    LLM_INPUT_USD_PER_MILLION: "2",
    LLM_CACHED_INPUT_USD_PER_MILLION: "0.1",
    LLM_OUTPUT_USD_PER_MILLION: "10",
  };
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => reply());
  const client = createCountedClient(databases.postgres, config, transport);
  await client.ledger.setup();
  const id = randomUUID();
  await expect(client.complete(id, "probe", [])).rejects.toThrow();
  const before = await client.ledger.summary();
  expect(before.unsettled).toBe(1);
  expect(before.upperCostUsd).toBeGreaterThan(0);
  expect(
    (
      await databases.postgres.query(
        "SELECT state,delivery,charged_nano,response FROM llm_call WHERE id=$1",
        [id],
      )
    ).rows[0],
  ).toEqual({
    state: "pending",
    delivery: "unknown",
    charged_nano: null,
    response: null,
  });
  const reopened = createCountedClient(databases.postgres, config, transport);
  await expect(reopened.complete(id, "probe", [])).rejects.toBeInstanceOf(
    BudgetUnavailable,
  );
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await client.ledger.summary()).toEqual(before);
});

test("推論量の設定を変更しても保存済み呼出しを再送せず、新しい呼出しだけへ適用する", async () => {
  const config = environment(),
    transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response());
  const high = createCountedClient(databases.postgres, config, transport);
  await high.ledger.setup();
  const id = randomUUID(),
    messages = [{ role: "user" as const, content: "JSONで返す" }];
  const saved = await high.complete(id, "probe", messages);
  const low = createCountedClient(
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
    const client = createCountedClient(databases.postgres, config, transport);
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
    const reopened = createCountedClient(
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
  const client = createCountedClient(
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
  const switched = createCountedClient(
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
    const client = createCountedClient(
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
    const client = createCountedClient(databases.postgres, config, transport);
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
      ...(api === "messages"
        ? { cache_write_5m_tokens: 4, cache_write_1h_tokens: 0 }
        : {}),
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
    const switched = createCountedClient(databases.postgres, base, transport);
    expect(
      await switched.complete(id, "world-update", messages, "resolution"),
    ).toEqual(result);
    expect(transport).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(await client.ledger.input(id))).not.toMatch(
      /upper-secret|PRIVATE_THINKING/,
    );
    expect((await client.ledger.summary()).upperCostUsd).toBeCloseTo(
      api === "messages" ? 0.00101406 : 0.00097406,
      9,
    );
  },
);

test("未登録モデルの料金・文脈上限が未設定なら送信前に拒否する", () => {
  expect(() =>
    createCountedClient(databases.postgres, {
      ...environment(),
      LLM_MODEL: "claude-upper-for-test",
      ANTHROPIC_API_KEY: "unused",
    }),
  ).toThrow("CONTEXT_TOKENS");
  expect(() =>
    createCountedClient(databases.postgres, {
      ...environment(),
      LLM_MODEL: "claude-upper-for-test",
      ANTHROPIC_API_KEY: "unused",
      LLM_CONTEXT_TOKENS: "100000",
    }),
  ).toThrow("料金が未設定");
});
