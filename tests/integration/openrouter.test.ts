import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { LlmClient } from "@gestaloka/server/llm";
import { SceneStep } from "../../packages/server/src/runtime/scene-data.js";
import { ModelSettings } from "../../packages/server/src/llm/settings.js";
import { isolatedDatabases } from "../support/isolated-db.js";

const isolated = isolatedDatabases();
beforeAll(() => isolated.setup());
afterAll(() => isolated.close());

test("OpenRouterのシーン要求はlowと現行スキーマを送り、独立単価で精算し旧設定版を保持する", async () => {
  const pool = isolated.databases.postgres;
  await ModelSettings.setup(pool);
  const store = new ModelSettings(pool, "7".repeat(64));
  const flash = {
    provider: "gemini" as const,
    model: "gemini-3.8-flash",
    api: "chat-completions" as const,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    effort: "low" as const,
    initialEffort: "low" as const,
    contextTokens: 1048576,
    maxOutputTokens: 16384,
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 3.75,
    pricingDate: "2026-10-29",
  };
  const ember = {
    ...flash,
    provider: "openrouter" as const,
    model: "meta/muse-ember",
    baseUrl: "https://openrouter.ai/api/v1",
    inputUsdPerMillion: 0.1,
    cachedInputUsdPerMillion: 0.004,
    outputUsdPerMillion: 0.5,
    pricingDate: "2026-11-17",
  };
  const configuration = {
    default: flash,
    resolution: {
      ...flash,
      provider: "openai" as const,
      model: "gpt-6.1-terra",
      api: "responses" as const,
      baseUrl: "https://api.openai.com/v1",
      effort: "medium" as const,
      initialEffort: "medium" as const,
      contextTokens: 1050000,
      inputUsdPerMillion: 1,
      cachedInputUsdPerMillion: 0.05,
      outputUsdPerMillion: 5,
    },
    judgment: "combined" as const,
  };
  await store.put(pool, configuration, 0, null);
  await store.putSecret(pool, "gemini", "flash-secret", 0, null);
  await store.putSecret(pool, "openrouter", "ember-secret", 0, null);
  await store.putSecret(pool, "openai", "terra-secret", 0, null);
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith(":countTokens"))
      return Response.json({ totalTokens: 30 });
    if (String(url).endsWith("/responses/input_tokens"))
      return Response.json({ input_tokens: 30 });
    const body = JSON.parse(String(init?.body));
    requests.push({ url: String(url), body });
    expect(new Headers(init?.headers).get("authorization")).toBe(
      body.model === ember.model
        ? "Bearer ember-secret"
        : body.model === configuration.resolution.model
          ? "Bearer terra-secret"
          : "Bearer flash-secret",
    );
    const content = JSON.stringify({
      type: "scene",
      events: [
        {
          eventId: randomUUID(),
          receipts: [{ observerId: randomUUID(), text: "問いかけが聞こえた" }],
        },
      ],
      decisions: {},
      elapsedMs: 0,
    });
    if (String(url).endsWith("/responses"))
      return Response.json({
        id: randomUUID(),
        model: body.model,
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: content }],
          },
        ],
        usage: {
          input_tokens: 30,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 10 },
          output_tokens_details: { reasoning_tokens: 5 },
        },
      });
    return Response.json({
      id: randomUUID(),
      model: body.model,
      choices: [
        {
          finish_reason: "stop",
          message: {
            reasoning: "推論はJSON本文でも、世界内の観測でもありません",
            reasoning_details: [{ type: "reasoning.text", text: "推論専用" }],
            content: String(init?.body).includes("reasoning-only")
              ? null
              : String(init?.body).includes("force-format-repair")
                ? '{"text":"台詞  は残す"' +
                  " \t\r\n".repeat(10000) +
                  " INVALID JSON"
                : body.response_format?.json_schema?.schema.properties?.response
                  ? JSON.stringify({
                      response: {
                        ...JSON.parse(content),
                        departures: [],
                        concluded: null,
                        belongings: null,
                        events: JSON.parse(content).events.map(
                          (event: Record<string, unknown>) => ({
                            ...event,
                            receipts: (
                              event.receipts as Record<string, unknown>[]
                            ).map((receipt) => ({
                              ...receipt,
                              at: null,
                              information: [],
                            })),
                          }),
                        ),
                      },
                    })
                  : content,
          },
        },
      ],
      usage: {
        prompt_tokens: 30,
        completion_tokens: 20,
        total_tokens: 50,
        prompt_tokens_details: { cached_tokens: 10 },
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    });
  });
  const env = {
    OPERATIONS_TOKEN_SECRET: "7".repeat(64),
    LLM_BUDGET_ID: randomUUID(),
    LLM_BUDGET_USD: "10",
  };
  const client = await LlmClient.create(pool, env, transport);
  await client.ledger.setup();
  const messages = [
    {
      role: "user" as const,
      content: JSON.stringify({
        request: { intentions: [] },
        sceneHistory: [],
        responseSchema: z.toJSONSchema(SceneStep, { io: "output" }),
      }),
    },
  ];
  const responseId = randomUUID(),
    callId = randomUUID();
  await client.run(responseId, () =>
    client.complete(callId, "scene-resolve", messages),
  );
  await store.put(pool, { ...configuration, default: ember }, 1, null);
  const restarted = await LlmClient.create(pool, env, transport);
  // The old response's next call must still use its captured Flash settings.
  await restarted.run(responseId, () =>
    restarted.complete(randomUUID(), "scene-resolve", messages),
  );
  const fresh = randomUUID();
  const completed = await restarted.run(fresh, () =>
    restarted.complete(randomUUID(), "scene-resolve", messages),
  );
  expect(SceneStep.parse(JSON.parse(completed.content)).type).toBe("scene");
  await restarted.run(fresh, () =>
    restarted.complete(
      randomUUID(),
      "scene-intent",
      [{ role: "user", content: "JSON" }],
      "resolution",
    ),
  );
  expect(requests.map(({ body }) => body.model)).toEqual([
    flash.model,
    flash.model,
    ember.model,
    configuration.resolution.model,
  ]);
  expect(requests[3]).toMatchObject({
    url: "https://api.openai.com/v1/responses",
    body: { reasoning: { effort: "medium" } },
  });
  expect(requests[2]).toMatchObject({
    url: "https://openrouter.ai/api/v1/chat/completions",
    body: {
      reasoning: { effort: "low", exclude: true },
      provider: { require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: {
          strict: true,
          schema: {
            type: "object",
            properties: {
              response: {
                anyOf: [{ type: "object", additionalProperties: false }],
              },
            },
          },
        },
      },
      max_tokens: 16384,
    },
  });
  expect(requests[2]!.body).not.toHaveProperty("reasoning_effort");
  expect(requests[2]!.body).not.toHaveProperty("service_tier");
  expect(JSON.stringify(requests[2]!.body.messages)).not.toContain(
    "responseSchema",
  );
  expect(completed.usage).toMatchObject({
    prompt_cache_miss_tokens: 20,
    prompt_cache_hit_tokens: 10,
    completion_tokens: 20,
    reasoning_tokens: 5,
  });
  expect(completed.content).not.toContain("推論");
  const rows = (
    await pool.query(
      "SELECT request,charged_nano::int AS charge FROM llm_call ORDER BY created_at,id",
    )
  ).rows;
  expect(rows.map((r) => r.request.configurationVersion)).toEqual([1, 1, 2, 2]);
  expect(rows.map((r) => r.charge)).toEqual([90750, 90750, 12040, 120500]);
  expect(rows[2].request.connection).toMatchObject({
    inputMiss: 100,
    inputHit: 4,
    output: 500,
  });
  expect(rows[2].request.sourceMessages).toEqual(messages);
  const before = transport.mock.calls.length;
  await restarted.run(responseId, () =>
    restarted.complete(callId, "scene-resolve", messages),
  );
  expect(transport).toHaveBeenCalledTimes(before);
  await restarted.complete(
    randomUUID(),
    "scene-background",
    messages,
    "default",
    "resolution",
  );
  expect(requests.at(-1)).toMatchObject({
    body: { model: ember.model, reasoning: { effort: "medium" } },
  });
  const repaired = await restarted.complete(randomUUID(), "scene-resolve", [
    { role: "user", content: "force-format-repair" },
  ]);
  expect(requests.slice(-4).map(({ body }) => body.model)).toEqual([
    ember.model,
    ember.model,
    ember.model,
    configuration.resolution.model,
  ]);
  expect(repaired).toMatchObject({ upperModel: true, formatAttempts: 3 });
  const retryMessages = requests.at(-1)!.body.input as {
    role: string;
    content: string;
  }[];
  expect(JSON.stringify(retryMessages)).not.toContain("\\t\\r\\n");
  expect(JSON.stringify(retryMessages)).toContain("台詞  は残す");
  const rawRetry = (
    await pool.query(
      "SELECT request,response FROM llm_call WHERE response->>'content' LIKE '%INVALID JSON%' LIMIT 1",
    )
  ).rows[0];
  expect(rawRetry.response.content).toContain(" \t\r\n".repeat(10000));
  const missing = await restarted.complete(randomUUID(), "scene-resolve", [
    { role: "user", content: "reasoning-only" },
  ]);
  expect(requests.slice(-2).map(({ body }) => body.model)).toEqual([
    ember.model,
    configuration.resolution.model,
  ]);
  expect(missing).toMatchObject({ upperModel: true });
  expect(missing.content).not.toContain("推論");
});

test("EmberのプロファイルはFlashの単価を継承せず、専用キーを選ぶ", () => {
  const model = new LlmClient(isolated.databases.postgres, {
    OPENROUTER_API_KEY: "ember-secret",
    GEMINI_API_KEY: "flash-secret",
    LLM_MODEL: "meta/muse-ember",
    LLM_RESOLUTION_MODEL: "gemini-3.8-flash",
  });
  expect(model.settings).toMatchObject({
    provider: "openrouter",
    apiKey: "ember-secret",
    inputMiss: 100,
    inputHit: 4,
    output: 500,
    effort: "low",
  });
  expect(model.settingsFor("resolution")).toMatchObject({
    provider: "gemini",
    apiKey: "flash-secret",
    inputMiss: 750,
    inputHit: 75,
    output: 3750,
  });
});
