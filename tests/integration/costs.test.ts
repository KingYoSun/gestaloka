import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CostQuery, CostReport } from "@gestaloka/contracts";
import { ExecutionBudget } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { ModelSettings } from "../../packages/server/src/llm/settings.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureAuth } from "../support/auth.js";
import { createApp } from "../../apps/api/src/app.js";
import type { z } from "zod";

let isolated: ReturnType<typeof isolatedDatabases>,
  auth: Awaited<ReturnType<typeof fixtureAuth>>,
  admin: string,
  user: string,
  model: LlmClient;
const messages = [{ role: "user" as const, content: "private prompt" }],
  query = {
    from: "2026-01-01T00:00:00Z",
    to: "2027-01-01T00:00:00Z",
    interval: "day" as const,
  };
const env = (budget: string) => ({
  LLM_BUDGET_ID: budget,
  LLM_PROVIDER: "anthropic",
  LLM_MODEL: "test-claude",
  ANTHROPIC_API_KEY: "private-key",
  LLM_CONTEXT_TOKENS: "10000",
  LLM_MAX_OUTPUT_TOKENS: "1000",
  LLM_INPUT_USD_PER_MILLION: "2",
  LLM_CACHED_INPUT_USD_PER_MILLION: "0.2",
  LLM_OUTPUT_USD_PER_MILLION: "10",
});
const response = () =>
  Response.json({
    id: "upstream-id",
    model: "reported-claude",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "private response" }],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 70,
      cache_creation: {
        ephemeral_5m_input_tokens: 40,
        ephemeral_1h_input_tokens: 30,
      },
    },
  });
const read = async (input: z.input<typeof CostQuery>) =>
  CostReport.parse(
    await auth.operations.execute(admin, randomUUID(), {
      operation: "costs.read",
      query: CostQuery.parse(input),
    }),
  );
beforeEach(async () => {
  isolated = isolatedDatabases();
  await isolated.setup();
  auth = await fixtureAuth(isolated.databases.postgres);
  admin = (await auth.person()).id;
  user = (await auth.person("user")).id;
  model = new LlmClient(
    isolated.databases.postgres,
    env(randomUUID()),
    async () => response(),
  );
  await model.ledger.setup();
  await isolated.databases.postgres.query(
    "CREATE TABLE world_build(run_id uuid PRIMARY KEY,world_id uuid UNIQUE NOT NULL)",
  );
});
afterEach(async () => {
  await isolated.close();
});

test("キャッシュの読取・5分作成・1時間作成を分け、標準倍率と上書き単価を保存する", async () => {
  const id = randomUUID(),
    root = randomUUID(),
    operation = randomUUID(),
    pool = isolated.databases.postgres;
  await ExecutionBudget.run(
    pool,
    root,
    () =>
      model.run(operation, () => model.complete(id, "scene-resolve", messages)),
    undefined,
    user,
  );
  // (100*2 + 200*0.2 + 40*2.5 + 30*4 + 50*10) / 1e6 = .00096
  const calls = (await read({ ...query, view: "calls" })).calls!;
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    id,
    responseId: root,
    operationId: operation,
    userId: user,
    task: "scene-resolve",
    provider: "anthropic",
    requestedModel: "test-claude",
    responseModel: "reported-claude",
    status: "calculated",
    calculatedNanoUsd: "960000",
    usage: {
      input: 370,
      cachedInput: 200,
      cacheMissInput: 170,
      output: 50,
      cacheWrite5m: 40,
      cacheWrite1h: 30,
      reasoning: null,
    },
    ratesNanoUsdPerToken: {
      input: 2000,
      cachedInput: 200,
      cacheWrite5m: 2500,
      cacheWrite1h: 4000,
      output: 10000,
    },
  });
  expect(JSON.stringify(calls)).not.toMatch(
    /private prompt|private response|private-key/,
  );
  const override = new LlmClient(
    pool,
    {
      ...env(model.ledger.budgetId),
      LLM_CACHE_WRITE_5M_USD_PER_MILLION: "3",
      LLM_CACHE_WRITE_1H_USD_PER_MILLION: "5",
    },
    async () => response(),
  );
  await override.complete(randomUUID(), "override", messages);
  expect(
    (await read({ ...query, task: "override", view: "summary" })).totals!
      .calculatedNanoUsd,
  ).toBe("1010000");
  await model.complete(id, "scene-resolve", messages);
  expect(
    (await read({ ...query, task: "scene-resolve", view: "summary" })).totals,
  ).toMatchObject({ calls: 1, calculatedNanoUsd: "960000", unknownCalls: 0 });
});

test("旧応答の算定を保持し、次の応答から新しい区分単価を使う", async () => {
  const pool = isolated.databases.postgres,
    store = new ModelSettings(pool, "2".repeat(64)),
    old = randomUUID();
  await ModelSettings.setup(pool);
  const base = {
    provider: "anthropic" as const,
    model: "test-claude",
    baseUrl: "https://model.invalid",
    api: "messages" as const,
    effort: "low" as const,
    initialEffort: "high" as const,
    contextTokens: 10000,
    maxOutputTokens: 1000,
    inputUsdPerMillion: 2,
    cachedInputUsdPerMillion: 0.2,
    outputUsdPerMillion: 10,
    pricingDate: "2026-10-21",
  };
  await store.put(
    pool,
    { default: base, resolution: base, judgment: "separate" },
    0,
    null,
  );
  await store.putSecret(pool, "anthropic", "private-key", 0, null);
  await pool.query(
    "INSERT INTO llm_response_settings(id,version) VALUES($1,1)",
    [old],
  );
  const managed = await LlmClient.create(
    pool,
    {
      LLM_BUDGET_ID: model.ledger.budgetId,
      OPERATIONS_TOKEN_SECRET: "2".repeat(64),
    },
    async () => response(),
  );
  await managed.run(old, () => managed.complete(randomUUID(), "old", messages));
  expect(
    (await read({ ...query, view: "calls", task: "old" })).calls![0],
  ).toMatchObject({
    configurationVersion: 1,
    calculatedNanoUsd: "880000",
    ratesNanoUsdPerToken: { cacheWrite5m: null, cacheWrite1h: null },
  });
  await managed.run(randomUUID(), async () => {
    await managed.complete(randomUUID(), "new", messages);
    await store.put(
      pool,
      {
        default: { ...base, inputUsdPerMillion: 4 },
        resolution: base,
        judgment: "separate",
      },
      1,
      null,
    );
    await managed.complete(randomUUID(), "same-response", messages);
  });
  const held = (await read({ ...query, view: "calls", task: "same-response" }))
    .calls![0]!;
  expect(held).toMatchObject({
    configurationVersion: 1,
    calculatedNanoUsd: "960000",
  });
  await managed.run(randomUUID(), () =>
    managed.complete(randomUUID(), "next-response", messages),
  );
  expect(
    (await read({ ...query, view: "calls", task: "next-response" })).calls![0],
  ).toMatchObject({
    configurationVersion: 2,
    calculatedNanoUsd: "1380000",
    ratesNanoUsdPerToken: {
      input: 4000,
      cacheWrite5m: 5000,
      cacheWrite1h: 8000,
    },
  });
  await store.put(
    pool,
    {
      default: {
        ...base,
        inputUsdPerMillion: 4,
        cacheWrite5mUsdPerMillion: 3,
        cacheWrite1hUsdPerMillion: 5,
      },
      resolution: base,
      judgment: "separate",
    },
    2,
    admin,
  );
  await managed.run(randomUUID(), () =>
    managed.complete(randomUUID(), "admin-override", messages),
  );
  expect(
    (await read({ ...query, view: "calls", task: "admin-override" })).calls![0],
  ).toMatchObject({
    configurationVersion: 3,
    calculatedNanoUsd: "1210000",
    ratesNanoUsdPerToken: { cacheWrite5m: 3000, cacheWrite1h: 5000 },
  });
});

test("推論は出力の内数とし、Chat/Responsesで重複加算せず、使用量不明を未確定にする", async () => {
  const pool = isolated.databases.postgres,
    transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "chat",
        model: "reported-openai",
        choices: [{ finish_reason: "stop", message: { content: "{}" } }],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 20,
          total_tokens: 50,
          prompt_tokens_details: { cached_tokens: 10 },
          completion_tokens_details: { reasoning_tokens: 15 },
        },
      }),
    );
  const settings = {
    ...env(model.ledger.budgetId),
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "private-key",
    LLM_MODEL: "test-openai",
  };
  const chat = new LlmClient(pool, settings, transport);
  await chat.complete(randomUUID(), "chat", messages);
  expect(
    (await read({ ...query, task: "chat", view: "calls" })).calls![0],
  ).toMatchObject({
    calculatedNanoUsd: "242000",
    usage: { output: 20, reasoning: 15 },
  });
  const responses = new LlmClient(
    pool,
    { ...settings, LLM_API: "responses" },
    async () =>
      Response.json({
        id: "resp",
        model: "reported-openai",
        status: "completed",
        output: [],
        usage: {
          input_tokens: 30,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 10 },
          output_tokens_details: { reasoning_tokens: 15 },
        },
      }),
  );
  await responses.complete(randomUUID(), "responses", messages);
  expect(
    (await read({ ...query, task: "responses", view: "calls" })).calls![0],
  ).toMatchObject({
    calculatedNanoUsd: "242000",
    usage: { output: 20, reasoning: 15 },
  });
  transport.mockResolvedValue(Response.json({ id: "missing-usage" }));
  const id = randomUUID();
  await expect(chat.complete(id, "unknown", messages)).rejects.toThrow();
  await expect(chat.complete(id, "unknown", messages)).rejects.toThrow(
    "未確定",
  );
  expect(transport).toHaveBeenCalledTimes(2);
  expect(
    (await read({ ...query, task: "unknown", view: "calls" })).calls![0],
  ).toMatchObject({ status: "unknown", calculatedNanoUsd: null, usage: null });
});

test("送信中の予約と通信失敗後の未確定額を区別し、精算を二重適用しない", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    pool = isolated.databases.postgres;
  const waiting = new LlmClient(pool, env(model.ledger.budgetId), async () => {
      await gate;
      return response();
    }),
    id = randomUUID();
  const running = waiting.complete(id, "running", messages);
  try {
    await vi.waitFor(async () =>
      expect(
        (await read({ ...query, task: "running", view: "summary" })).totals!
          .reservedCalls,
      ).toBe(1),
    );
    expect(
      (await read({ ...query, task: "running", view: "calls" })).calls![0],
    ).toMatchObject({ status: "reserved", calculatedNanoUsd: null });
  } finally {
    release();
    await running;
  }
  await waiting.ledger.settle(
    id,
    960000,
    await waiting.complete(id, "running", messages),
    1,
  );
  const failed = new LlmClient(pool, env(model.ledger.budgetId), async () => {
    throw new Error("connection lost");
  });
  await expect(
    failed.complete(randomUUID(), "failed", messages),
  ).rejects.toThrow("connection lost");
  const totals = (await read({ ...query, view: "summary" })).totals!;
  expect(totals).toMatchObject({
    calls: 2,
    calculatedNanoUsd: "960000",
    reservedCalls: 0,
    unknownCalls: 1,
    unknownNanoUsd: "50000000",
  });
  expect((await model.ledger.summary()).upperCostUsd).toBe(
    (Number(totals.calculatedNanoUsd) + Number(totals.unknownNanoUsd)) / 1e9,
  );
});

test("期間境界、絞込み、同日時の明細と長期間の時系列をページ取得し合計を一致させる", async () => {
  const pool = isolated.databases.postgres,
    world = randomUUID(),
    graph = randomUUID();
  await pool.query("INSERT INTO world_build VALUES($1,$2)", [world, graph]);
  const request = {
      role: "fixture",
      request: { model: "requested" },
      connection: { provider: "openai", inputMiss: 1, inputHit: 0, output: 1 },
      configurationVersion: 2,
      pricingDate: "2026-10-21",
    },
    completion = {
      id: "response",
      model: "actual",
      content: "private response",
      finishReason: "stop",
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 1,
      },
    };
  await pool.query(
    `INSERT INTO llm_call(id,budget_id,hash,reserved_nano,charged_nano,request,response,state,created_at,world_id,user_id)
    SELECT gen_random_uuid(),$1,'fixture',100,2,$2,$3,'complete','2026-01-01'::timestamptz + n * interval '1 day',$4,$5 FROM generate_series(0,59) n`,
    [model.ledger.budgetId, request, completion, graph, user],
  );
  // More than one page at the exact same timestamp.
  await pool.query(
    `INSERT INTO llm_call(id,budget_id,hash,reserved_nano,charged_nano,request,response,state,created_at,world_id,user_id)
    SELECT gen_random_uuid(),$1,'fixture',100,2,$2,$3,'complete','2026-01-01T00:00:00.123456Z'::timestamptz,$4,$5 FROM generate_series(1,60) n`,
    [model.ledger.budgetId, request, completion, graph, user],
  );
  const filters = {
    ...query,
    provider: "openai" as const,
    model: "actual",
    worldId: world,
    userId: user,
    task: "fixture",
  };
  const summary = (await read({ ...filters, view: "summary" })).totals!;
  expect(summary).toMatchObject({ calls: 120, calculatedNanoUsd: "240" });
  let after: string | undefined;
  const all: z.infer<typeof CostReport>["calls"] = [];
  do {
    const p = await read({
      ...filters,
      view: "calls",
      ...(after ? { after } : {}),
    });
    all.push(...p.calls!);
    after = p.next ?? undefined;
  } while (after);
  expect(new Set(all.map((c) => c.id)).size).toBe(120);
  expect(
    all.reduce((sum, c) => sum + BigInt(c.calculatedNanoUsd!), 0n).toString(),
  ).toBe(summary.calculatedNanoUsd);
  const p1 = await read({ ...filters, view: "timeline" }),
    p2 = await read({ ...filters, view: "timeline", after: p1.next! });
  expect(p1.timeline).toHaveLength(50);
  expect(p2.timeline).toHaveLength(10);
  expect(p2.next).toBeNull();
  expect(
    [...p1.timeline!, ...p2.timeline!]
      .reduce((n, p) => n + BigInt(p.calculatedNanoUsd), 0n)
      .toString(),
  ).toBe("240");
  expect(
    (
      await read({
        ...filters,
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-02T00:00:00Z",
        view: "summary",
      })
    ).totals!.calls,
  ).toBe(61);
  expect(
    (
      await read({
        ...filters,
        from: "2026-01-02T09:00:00+09:00",
        to: "2026-01-03T09:00:00+09:00",
        view: "summary",
      })
    ).totals!.calls,
  ).toBe(1);
  await expect(
    read({ ...filters, task: "changed", view: "timeline", after: p1.next! }),
  ).rejects.toMatchObject({ code: "CURSOR_INVALID" });
});

test("既存の金額・未確定額・欠けた対応を保持し、管理者だけが共通契約で取得できる", async () => {
  const pool = isolated.databases.postgres;
  await pool.query(
    "INSERT INTO llm_call(id,budget_id,hash,reserved_nano,charged_nano,request,state) VALUES($1,$2,'legacy',10,7,'{}','complete'),($3,$2,'legacy',13,NULL,'{}','pending')",
    [randomUUID(), model.ledger.budgetId, randomUUID()],
  );
  const before = await read({ ...query, view: "summary" });
  await model.ledger.setup();
  expect(await read({ ...query, view: "summary" })).toEqual(before);
  expect(before.totals).toMatchObject({
    calculatedNanoUsd: "7",
    unknownNanoUsd: "13",
    unknownCalls: 1,
  });
  const calls = (
    await read({
      ...query,
      userId: null,
      worldId: null,
      provider: null,
      view: "calls",
    })
  ).calls!;
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({
    userId: null,
    worldId: null,
    provider: null,
    usage: null,
    ratesNanoUsdPerToken: null,
  });
  await expect(
    auth.operations.execute(user, randomUUID(), {
      operation: "costs.read",
      query: CostQuery.parse({ ...query, view: "summary" }),
    }),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  const person = await auth.person(),
    app = await createApp(undefined, auth.identity, undefined, auth.operations);
  try {
    const reply = await app.inject({
      method: "POST",
      url: "/api/operations",
      headers: { cookie: person.cookie, "x-gestaloka-request": "1" },
      payload: {
        requestId: randomUUID(),
        command: {
          operation: "costs.read",
          query: { ...query, view: "summary" },
        },
      },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().result).toEqual(before);
    expect(JSON.stringify(reply.json())).not.toMatch(
      /private|request:|content:/,
    );
  } finally {
    await app.close();
  }
});
