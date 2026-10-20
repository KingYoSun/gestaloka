import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { z } from "zod";
import { ModelConfiguration } from "@gestaloka/contracts";
import { ExecutionBudget } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { Operations } from "@gestaloka/server/operations";
import { WorldAgent } from "@gestaloka/server/agent";
import { ModelSettings } from "../../packages/server/src/llm/settings.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureAuth } from "../support/auth.js";

const master = "2".repeat(64),
  messages = [{ role: "user" as const, content: "設定版の確認" }];
const base = {
  provider: "openai" as const,
  model: "base-model",
  baseUrl: "https://model.invalid/v1",
  api: "chat-completions" as const,
  effort: "low" as const,
  initialEffort: "high" as const,
  contextTokens: 100,
  maxOutputTokens: 10,
  inputUsdPerMillion: 1,
  cachedInputUsdPerMillion: 0,
  outputUsdPerMillion: 1,
  pricingDate: "2026-10-21",
};
const configuration: z.infer<typeof ModelConfiguration> = {
  default: base,
  resolution: { ...base, model: "upper-model" },
  judgment: "separate",
};
let isolated: ReturnType<typeof isolatedDatabases>,
  auth: Awaited<ReturnType<typeof fixtureAuth>>,
  ops: Operations,
  model: LlmClient,
  admin: string,
  user: string;
let requests: { model: string; path: string; key: string | null }[],
  probeFailure: boolean,
  probeGate: Promise<void> | undefined,
  probes: number;
let generationGate: Promise<void> | undefined;
let malformedProbe = false;
let env: NodeJS.ProcessEnv;
const transport: typeof fetch = async (url, init) => {
  const path = new URL(String(url)).pathname,
    headers = new Headers(init?.headers);
  if (path.endsWith("/models")) {
    probes++;
    await probeGate;
    if (probeFailure) return new Response(null, { status: 503 });
    if (malformedProbe) return new Response("first-secret");
    return Response.json({
      data: ["base-model", "upper-model", "changed-model", "upper-claude"].map(
        (id) => ({ id }),
      ),
    });
  }
  const body = JSON.parse(String(init?.body));
  requests.push({
    model: body.model,
    path,
    key: headers.get("authorization") ?? headers.get("x-api-key"),
  });
  if (requests.length === 1) await generationGate;
  if (path.endsWith("/responses"))
    return Response.json({
      id: randomUUID(),
      model: body.model,
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: "{}" }] },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  if (path.endsWith("/messages"))
    return Response.json({
      id: randomUUID(),
      model: body.model,
      stop_reason: "end_turn",
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  return Response.json({
    id: randomUUID(),
    model: body.model,
    choices: [{ finish_reason: "stop", message: { content: "{}" } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
};
beforeEach(async () => {
  isolated = isolatedDatabases();
  await isolated.setup();
  requests = [];
  probeFailure = false;
  probeGate = undefined;
  probes = 0;
  generationGate = undefined;
  malformedProbe = false;
  const pool = isolated.databases.postgres;
  auth = await fixtureAuth(pool);
  admin = (await auth.person()).id;
  user = (await auth.person("user")).id;
  ops = new Operations(pool, master, transport);
  env = {
    ...ModelSettings.environment(configuration),
    OPENAI_API_KEY: "first-secret",
    OPERATIONS_TOKEN_SECRET: master,
    LLM_BUDGET_ID: randomUUID(),
  };
  model = await LlmClient.create(pool, env, transport);
  await model.ledger.setup();
});
afterEach(() => isolated.close());
const execute = (
  command: Parameters<Operations["execute"]>[2],
  requestId = randomUUID(),
) => ops.execute(admin, requestId, command);

test("APIキーを差し替えても共有枠を戻さず、待機中の要求は取得時の新しいキーを使う", async () => {
  await execute({
    operation: "modelLimits.put",
    name: "openai:base-model",
    limits: { concurrency: 1 },
    expectedVersion: 0,
    reason: "並行枠の確認",
  });
  let release!: () => void;
  generationGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = model.run(randomUUID(), () =>
    model.complete(randomUUID(), "test", messages),
  );
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const second = model.run(randomUUID(), () =>
    model.complete(randomUUID(), "test", messages),
  );
  try {
    await delay(300);
    expect(requests).toHaveLength(1);
    await execute({
      operation: "credentials.put",
      provider: "openai",
      value: "replacement-key",
      expectedVersion: 1,
      reason: "待機中に差替え",
    });
    await delay(300);
    expect(requests).toHaveLength(1);
    release();
    await first;
    await second;
    expect(requests.map((r) => r.key)).toEqual([
      "Bearer first-secret",
      "Bearer replacement-key",
    ]);
  } finally {
    release();
    await Promise.allSettled([first, second]);
  }
});

test("応答中と再開・再接続はモデル・API形式・単価の版を保持し、次の応答だけ新設定を使う", async () => {
  const responseId = randomUUID(),
    first = randomUUID();
  const changed = {
    ...configuration,
    resolution: {
      ...configuration.resolution,
      model: "changed-model",
      api: "responses" as const,
      inputUsdPerMillion: 2.5,
      outputUsdPerMillion: 3,
    },
  };
  await model.run(responseId, async () => {
    await model.complete(first, "world-update", messages, "resolution");
    await execute({
      operation: "models.put",
      configuration: changed,
      expectedVersion: 1,
      reason: "次の応答から変更",
    });
    await model.complete(randomUUID(), "world-update", messages, "resolution");
  });
  const restarted = await LlmClient.create(
    isolated.databases.postgres,
    { OPERATIONS_TOKEN_SECRET: master, LLM_BUDGET_ID: env.LLM_BUDGET_ID },
    transport,
  );
  await restarted.run(responseId, () =>
    restarted.complete(randomUUID(), "world-update", messages, "resolution"),
  );
  await restarted.run(randomUUID(), () =>
    restarted.complete(randomUUID(), "world-update", messages, "resolution"),
  );
  expect(requests.map((r) => [r.model, r.path])).toEqual([
    ["upper-model", "/v1/chat/completions"],
    ["upper-model", "/v1/chat/completions"],
    ["upper-model", "/v1/chat/completions"],
    ["changed-model", "/v1/responses"],
  ]);
  const before = requests.length;
  await restarted.run(responseId, () =>
    restarted.complete(first, "world-update", messages, "resolution"),
  );
  expect(requests).toHaveLength(before);
  const calls = (
    await isolated.databases.postgres.query(
      "SELECT request,charged_nano::int FROM llm_call ORDER BY created_at",
    )
  ).rows;
  expect(calls.map((c) => c.request.configurationVersion)).toEqual([
    1, 1, 1, 2,
  ]);
  expect(calls.map((c) => c.charged_nano)).toEqual([2000, 2000, 2000, 5500]);
  expect(calls.every((c) => c.request.pricingDate === "2026-10-21")).toBe(true);
  expect((await execute({ operation: "models.read" })).updatedBy).toBe(admin);
});

test("APIキーは暗号化し、読取・監査・要求・再送へ原文を保存せず、差替えを次の送信で使う", async () => {
  const id = randomUUID(),
    responseId = randomUUID();
  await model.run(responseId, () =>
    model.complete(randomUUID(), "test", messages),
  );
  const command = {
    operation: "credentials.put" as const,
    provider: "openai" as const,
    value: "second-secret",
    expectedVersion: 1,
    reason: "資格情報の差替え",
  };
  await expect(ops.execute(user, id, command)).rejects.toMatchObject({
    code: "ADMIN_REQUIRED",
  });
  const saved = await execute(command);
  const retry = randomUUID();
  expect(
    await execute(
      { ...command, value: "third-secret", expectedVersion: 2 },
      retry,
    ),
  ).toEqual({ provider: "openai", version: 3 });
  expect(
    await execute(
      { ...command, value: "third-secret", expectedVersion: 2 },
      retry,
    ),
  ).toEqual({ provider: "openai", version: 3 });
  expect(saved).toEqual({ provider: "openai", version: 2 });
  await model.run(responseId, () =>
    model.complete(randomUUID(), "test", messages),
  );
  expect(requests.map((r) => r.key)).toEqual([
    "Bearer first-secret",
    "Bearer third-secret",
  ]);
  const read = await execute({ operation: "models.read" });
  expect(read.credentials).toEqual([
    expect.objectContaining({
      provider: "openai",
      version: 3,
      updatedBy: admin,
    }),
  ]);
  const db = isolated.databases.postgres;
  const stored = JSON.stringify([
    read,
    (await db.query("SELECT * FROM llm_credential")).rows,
    (await db.query("SELECT * FROM operation_request")).rows,
    (await db.query("SELECT * FROM operation_audit")).rows,
    (await db.query("SELECT * FROM llm_call")).rows,
  ]);
  for (const value of ["first-secret", "second-secret", "third-secret"])
    expect(stored).not.toContain(value);
  await expect(
    new ModelSettings(db, "4".repeat(64)).secret("openai"),
  ).rejects.toThrow();
  const restarted = await LlmClient.create(db, env, transport);
  expect(await restarted.apiKey("openai")).toBe("third-secret");
});

test("モデルの接続確認中にDBの運用ロックを持たず、接続失敗と権限不足は設定を変えない", async () => {
  const command = {
    operation: "models.put" as const,
    configuration,
    expectedVersion: 1,
    reason: "接続確認",
  };
  await expect(ops.execute(user, randomUUID(), command)).rejects.toMatchObject({
    code: "ADMIN_REQUIRED",
  });
  expect(probes).toBe(0);
  await expect(
    ops.execute(user, randomUUID(), { operation: "models.read" }),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  await expect(
    execute({
      ...command,
      configuration: {
        ...configuration,
        resolution: { ...configuration.resolution, provider: "anthropic" },
      },
    }),
  ).rejects.toMatchObject({ code: "MODEL_CHECK_FAILED" });
  probeFailure = true;
  await expect(execute(command)).rejects.toMatchObject({
    code: "MODEL_CHECK_FAILED",
  });
  expect((await ops.models.latest())?.version).toBe(1);
  malformedProbe = true;
  const malformed = await execute(command).catch((error) => error);
  expect(malformed).toMatchObject({ code: "MODEL_CHECK_FAILED" });
  expect(malformed.message).not.toContain("first-secret");
  expect(
    JSON.stringify(
      (
        await isolated.databases.postgres.query(
          "SELECT error FROM operation_request",
        )
      ).rows,
    ),
  ).not.toContain("first-secret");
  malformedProbe = false;
  probeFailure = false;
  let release!: () => void;
  probeGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const count = probes,
    pending = execute(command);
  try {
    await vi.waitFor(() => expect(probes).toBeGreaterThan(count));
    let read = false;
    const other = execute({ operation: "settings.read" }).then(() => {
      read = true;
    });
    await vi.waitFor(() => expect(read).toBe(true));
    await other;
  } finally {
    release();
    await pending;
    probeGate = undefined;
  }
  await expect(execute(command)).rejects.toMatchObject({
    code: "SETTINGS_CHANGED",
  });
  expect((await ops.models.latest())?.version).toBe(2);
});

test("提案前に作成した操作の担当と審査方式を、親のcall管理や再開でも差し替えない", async () => {
  const db = isolated.databases,
    agent = new WorldAgent(db.postgres, db.graph, db.checkpointer, model);
  await agent.setup();
  const input = {
    worldId: randomUUID(),
    rootIds: [randomUUID()],
    phase: "interaction" as const,
    at: 0,
    until: 0,
    intentions: [],
    actionText: "",
  };
  const first = await agent.create(input);
  await execute({
    operation: "credentials.put",
    provider: "anthropic",
    value: "anthropic-secret",
    expectedVersion: 0,
    reason: "追加",
  });
  await execute({
    operation: "models.put",
    configuration: {
      ...configuration,
      judgment: "combined",
      resolution: {
        ...configuration.resolution,
        provider: "anthropic",
        model: "upper-claude",
        api: "messages",
        baseUrl: "https://anthropic.invalid/v1",
      },
    },
    expectedVersion: 1,
    reason: "上位担当の変更",
  });
  await ExecutionBudget.run(db.postgres, randomUUID(), () =>
    model.run(first, async () => {
      expect(model.settingsFor("resolution").provider).toBe("openai");
    }),
  );
  const next = await agent.create(input);
  expect(
    (
      await db.postgres.query(
        "SELECT combined_judgment FROM world_operation WHERE id=$1",
        [first],
      )
    ).rows[0].combined_judgment,
  ).toBe(false);
  expect(
    (
      await db.postgres.query(
        "SELECT combined_judgment FROM world_operation WHERE id=$1",
        [next],
      )
    ).rows[0].combined_judgment,
  ).toBe(true);
  await model.run(next, () =>
    model.complete(randomUUID(), "world-commit", messages, "resolution"),
  );
  expect(requests.at(-1)).toMatchObject({
    model: "upper-claude",
    path: "/v1/messages",
    key: "anthropic-secret",
  });
});

test.each(["models", "credentials"] as const)(
  "%sの接続確認中に変更された依存設定を検出して保存を拒否する",
  async (kind) => {
    let release!: () => void;
    probeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = {
      ...configuration,
      resolution: { ...configuration.resolution, model: "changed-model" },
    };
    const change = {
      operation: "credentials.put" as const,
      provider: "openai" as const,
      value: "concurrent-key",
      expectedVersion: 1,
      reason: "同時の設定変更",
    };
    const pending = execute(
      kind === "models"
        ? {
            operation: "models.put",
            configuration: next,
            expectedVersion: 1,
            reason: "上位担当の変更",
          }
        : change,
    );
    try {
      await vi.waitFor(() => expect(probes).toBeGreaterThan(0));
      probeGate = undefined;
      await execute(
        kind === "models"
          ? change
          : {
              operation: "models.put",
              configuration: next,
              expectedVersion: 1,
              reason: "同時のモデル変更",
            },
      );
      release();
      await expect(pending).rejects.toMatchObject({ code: "SETTINGS_CHANGED" });
      expect((await ops.models.latest())?.version).toBe(
        kind === "models" ? 1 : 2,
      );
      expect(await model.apiKey("openai")).toBe(
        kind === "models" ? "concurrent-key" : "first-secret",
      );
    } finally {
      release();
      probeGate = undefined;
      await pending.catch(() => {});
    }
  },
);

test("キーだけを運用登録した初期状態を環境変数で上書きせず、モデルの有効化を待つ", async () => {
  await execute({
    operation: "credentials.put",
    provider: "openai",
    value: "operator-key",
    expectedVersion: 1,
    reason: "初期のキー登録",
  });
  const db = isolated.databases.postgres;
  await db.query("DELETE FROM llm_settings");
  const restarted = await LlmClient.create(db, env, transport),
    id = randomUUID();
  expect(await ops.models.latest()).toBeUndefined();
  expect(await restarted.apiKey("openai")).toBe("operator-key");
  await expect(
    restarted.run(id, () => restarted.complete(randomUUID(), "test", messages)),
  ).rejects.toThrow("モデルの運用設定");
  expect(requests).toHaveLength(0);
  await execute({
    operation: "models.put",
    configuration,
    expectedVersion: 0,
    reason: "初期設定の有効化",
  });
  await restarted.run(id, () =>
    restarted.complete(randomUUID(), "test", messages),
  );
  expect(requests.at(-1)?.key).toBe("Bearer operator-key");
});
