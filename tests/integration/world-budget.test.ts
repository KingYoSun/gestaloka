import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { ExecutionBudget } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldBudget } from "../../packages/server/src/llm/world-budget.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { modelEnvironment } from "../support/model.js";

const isolated = isolatedDatabases(),
  db = isolated.databases;
const messages = [{ role: "user" as const, content: "予算の検証" }];
async function model(transport: typeof fetch, env: NodeJS.ProcessEnv = {}) {
  const llm = new LlmClient(
    db.postgres,
    {
      ...modelEnvironment(randomUUID()),
      LLM_BUDGET_USD: undefined,
      LLM_CONTEXT_TOKENS: "100",
      LLM_MAX_OUTPUT_TOKENS: "10",
      LLM_INPUT_USD_PER_MILLION: "1",
      LLM_CACHED_INPUT_USD_PER_MILLION: "0",
      LLM_OUTPUT_USD_PER_MILLION: "1",
      ...env,
    },
    transport,
  );
  await llm.ledger.setup();
  return llm;
}
const reply = () =>
  Response.json({
    id: randomUUID(),
    model: "gemini-3.8-flash",
    choices: [{ finish_reason: "stop", message: { content: "{}" } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
beforeAll(() => isolated.setup());
afterAll(() => isolated.close());

test("生成要求の初回接続拒否だけを0ドルで精算し、同じIDで再送しない", async () => {
  const attempts: string[] = [];
  let mode = "success";
  const server = createServer((req, res) => {
    attempts.push(mode);
    if (mode === "disconnect") return req.socket.destroy();
    if (mode === "redirect") {
      // The first POST arrived; only the redirect destination refuses to connect.
      server.close();
      res
        .writeHead(307, { location: "/redirected", connection: "close" })
        .end();
    } else if (mode === "http") res.writeHead(503).end();
    else
      void reply()
        .text()
        .then((body) => res.end(body));
  });
  const listen = (port: number) =>
    new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  await listen(0);
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const llm = await model(fetch, {
    LLM_MODEL: "meta/muse-ember",
    OPENROUTER_API_KEY: "unused",
    LLM_BASE_URL: `http://127.0.0.1:${port}`,
  });
  const world = randomUUID(),
    first = randomUUID();
  await WorldBudget.create(db.postgres, world, 1);
  const complete = (id: string) =>
    ExecutionBudget.run(
      db.postgres,
      id,
      () => llm.complete(id, "world-server-npc", messages),
      world,
    );
  const row = async (id: string) =>
    (
      await db.postgres.query(
        "SELECT state,delivery,charged_nano,response,elapsed_ms FROM llm_call WHERE id=$1",
        [id],
      )
    ).rows[0];
  await expect(complete(first)).rejects.toThrow("ECONNREFUSED");
  expect(await row(first)).toMatchObject({
    state: "complete",
    charged_nano: "0",
    elapsed_ms: expect.any(Number),
    response: { rejection: { type: "unsent", code: "ECONNREFUSED" } },
  });
  expect(await llm.ledger.summary()).toMatchObject({
    upperCostUsd: 0,
    unsettled: 0,
  });
  expect(await WorldBudget.read(db.postgres, world)).toMatchObject({
    upperCostUsd: 0,
  });

  await listen(port);
  try {
    await expect(complete(first)).rejects.toThrow("ECONNREFUSED");
    await complete(randomUUID());
    expect(attempts).toEqual(["success"]);
    expect(await llm.ledger.summary()).toMatchObject({
      upperCostUsd: 0.000002,
      calls: 2,
    });
    expect(await WorldBudget.read(db.postgres, world)).toMatchObject({
      upperCostUsd: 0.000002,
    });
    for (mode of ["disconnect", "http", "redirect"]) {
      const id = randomUUID();
      await expect(complete(id)).rejects.toThrow();
      expect(await row(id)).toMatchObject({
        state: "pending",
        delivery: "unknown",
        charged_nano: null,
      });
    }
    expect(attempts).toEqual(["success", "disconnect", "http", "redirect"]);
    expect(await llm.ledger.summary()).toMatchObject({
      unsettled: 3,
      upperCostUsd: 0.000332,
    });
    expect(await WorldBudget.read(db.postgres, world)).toMatchObject({
      upperCostUsd: 0.000332,
    });
  } finally {
    if (server.listening) await server[Symbol.asyncDispose]();
  }
});

test("別の費用記録系統でも世界予算を通算し、未確定予約・精算・再利用・増額を二重計上しない", async () => {
  let release!: () => void,
    sent = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const one = await model(async () => {
      sent++;
      await gate;
      return reply();
    }),
    two = await model(async () => {
      sent++;
      return reply();
    });
  const world = randomUUID(),
    firstId = randomUUID(),
    secondId = randomUUID();
  await WorldBudget.create(db.postgres, world, 0.00011);
  const first = ExecutionBudget.run(
    db.postgres,
    randomUUID(),
    () => one.complete(firstId, "test", messages),
    world,
  );
  await vi.waitFor(() => expect(sent).toBe(1));
  try {
    await expect(
      ExecutionBudget.run(
        db.postgres,
        secondId,
        () => two.complete(secondId, "test", messages),
        world,
      ),
    ).rejects.toThrow("世界の予算上限");
    expect(sent).toBe(1);
    expect(await WorldBudget.read(db.postgres, world)).toMatchObject({
      upperCostUsd: 0.00011,
      historyScope: "all",
    });
  } finally {
    release();
    await first;
  }
  expect(await WorldBudget.read(db.postgres, world)).toMatchObject({
    upperCostUsd: 0.000002,
  });
  await ExecutionBudget.run(
    db.postgres,
    randomUUID(),
    () => one.complete(firstId, "test", messages),
    world,
  );
  expect(sent).toBe(1);
  await db.postgres.query(
    "UPDATE world_budget SET limit_nano=112000 WHERE world_id=$1",
    [world],
  );
  await ExecutionBudget.run(
    db.postgres,
    secondId,
    () => two.complete(secondId, "test", messages),
    world,
  );
  expect(sent).toBe(2);
  expect(await WorldBudget.read(db.postgres, world)).toMatchObject({
    upperCostUsd: 0.000004,
  });
  expect((await one.ledger.summary()).limitUsd).toBeNull();
});

test("通信結果不明の予約を保持し、他世界の費用や世界未対応の過去記録を混ぜない", async () => {
  const one = await model(async () => {
      throw new Error("通信結果不明");
    }),
    two = await model(async () => reply());
  const world = randomUUID(),
    other = randomUUID();
  await WorldBudget.create(db.postgres, world, 0.00011);
  await expect(
    ExecutionBudget.run(
      db.postgres,
      randomUUID(),
      () => one.complete(randomUUID(), "test", messages),
      world,
    ),
  ).rejects.toThrow("通信結果不明");
  expect(await WorldBudget.read(db.postgres, world)).toMatchObject({
    upperCostUsd: 0.00011,
  });
  await two.complete(randomUUID(), "legacy", messages);
  await WorldBudget.create(db.postgres, other, 0.00011);
  await ExecutionBudget.run(
    db.postgres,
    randomUUID(),
    () => two.complete(randomUUID(), "test", messages),
    other,
  );
  expect(await WorldBudget.read(db.postgres, other)).toMatchObject({
    upperCostUsd: 0.000002,
  });
  expect(await WorldBudget.read(db.postgres, world)).toMatchObject({
    upperCostUsd: 0.00011,
  });
  const saved = (
    await db.postgres.query(
      "SELECT count(*)::int AS count FROM llm_call WHERE world_id IS NULL",
    )
  ).rows[0].count;
  expect(saved).toBe(1);
});
