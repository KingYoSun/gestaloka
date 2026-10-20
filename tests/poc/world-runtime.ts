import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { cpus, totalmem } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { connectDatabases } from "@gestaloka/server";
import {
  WorldStore,
  WorldConflict,
  type Change,
} from "@gestaloka/server/world";
import { WorldAgent } from "@gestaloka/server/agent";
import { LlmClient } from "@gestaloka/server/llm";
import { modelEnvironment } from "../support/model.js";

// Explicit PoC only: isolated worlds/queue/budget, no external model requests.
const db = connectDatabases(),
  worlds: string[] = [],
  budget = randomUUID(),
  queue = `poc-${randomUUID()}`;
type Session = ReturnType<typeof db.graph.session>;
type Tx = Parameters<Parameters<Session["executeRead"]>[0]>[0];
type Work = (tx: Tx) => Promise<unknown>;
let tag = randomUUID(),
  metrics = {
    statements: 0,
    readTransactions: 0,
    writeAttempts: 0,
    retries: 0,
    lockMs: [] as number[],
  };
const graph = new Proxy(db.graph, {
  get(target, key) {
    if (key === "session")
      return (...args: Parameters<typeof target.session>) =>
        new Proxy(target.session(...args), {
          get(session, method) {
            if (method === "executeRead" || method === "executeWrite")
              return (
                work: Work,
                config?: Parameters<Session["executeRead"]>[1],
              ) => {
                let attempts = 0;
                return session[method](
                  async (tx) => {
                    if (method === "executeRead") metrics.readTransactions++;
                    else {
                      metrics.writeAttempts++;
                      if (attempts++) metrics.retries++;
                    }
                    return work(
                      new Proxy(tx, {
                        get(transaction, field) {
                          if (field === "run")
                            return async (...args: Parameters<Tx["run"]>) => {
                              const started = performance.now();
                              metrics.statements++;
                              try {
                                return await transaction.run(...args);
                              } finally {
                                if (String(args[0]).includes("._lock"))
                                  metrics.lockMs.push(
                                    performance.now() - started,
                                  );
                              }
                            };
                          const value = Reflect.get(transaction, field);
                          return typeof value === "function"
                            ? value.bind(transaction)
                            : value;
                        },
                      }),
                    );
                  },
                  {
                    ...config,
                    metadata: { ...config?.metadata, gestalokaPoc: tag },
                  },
                );
              };
            const value = Reflect.get(session, method);
            return typeof value === "function" ? value.bind(session) : value;
          },
        });
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const store = new WorldStore(graph);
const delta = (parts: Partial<Change> = {}): Change => ({
  nodes: [],
  edges: [],
  revisions: [],
  endEdges: [],
  ...parts,
});
const existence = (text: string) => ({
  id: randomUUID(),
  kind: "existence" as const,
  text,
});
const effect = (source: string, target: string) => ({
  id: randomUUID(),
  kind: "effect" as const,
  source,
  target,
  period: { from: 0 },
});
const percentile = (values: number[], p: number) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]!
    : 0;
const latency = (values: number[]) => ({
  count: values.length,
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  maxMs: Math.max(0, ...values),
});
const report: Record<string, unknown> = {};

async function measure(
  name: string,
  work: () => Promise<unknown>,
  observe = false,
) {
  console.log(`開始: ${name}`);
  metrics = {
    statements: 0,
    readTransactions: 0,
    writeAttempts: 0,
    retries: 0,
    lockMs: [],
  };
  tag = randomUUID();
  let observing = observe;
  const waits = new Map<string, number>();
  const sampler = (async () => {
    while (observing) {
      const rows = await db.graph.executeQuery(
        "SHOW TRANSACTIONS YIELD transactionId,metaData,waitTime WHERE metaData.gestalokaPoc=$tag RETURN transactionId,waitTime",
        { tag },
      );
      for (const row of rows.records) {
        const time = row.get("waitTime");
        const ms = Number(time.seconds) * 1000 + Number(time.nanoseconds) / 1e6;
        waits.set(
          row.get("transactionId"),
          Math.max(ms, waits.get(row.get("transactionId")) ?? 0),
        );
      }
      await delay(25);
    }
  })();
  const started = performance.now();
  try {
    const result = await work();
    report[name] = {
      elapsedMs: performance.now() - started,
      ...metrics,
      lockMs: latency(metrics.lockMs),
      sampledWait: {
        transactions: waits.size,
        totalMs: [...waits.values()].reduce((a, b) => a + b, 0),
        maxMs: Math.max(0, ...waits.values()),
      },
      result,
    };
    console.log(`完了: ${name}`);
  } finally {
    observing = false;
    await sampler;
  }
}

async function seed(nodes: Change["nodes"], edges: Change["edges"] = []) {
  const world = randomUUID();
  worlds.push(world);
  const lease = await store.claim(world, randomUUID());
  await store.commit(lease, store.context(world), {
    commitId: randomUUID(),
    at: 0,
    changes: delta({ nodes, edges }),
  });
  return world;
}

async function graphUpdates(hotspot: boolean) {
  const nodes = Array.from({ length: 8 }, (_, i) => existence(`PoC ${i}`)),
    world = await seed(nodes);
  await measure(
    hotspot ? "hotspot" : "independent",
    async () => {
      const pending = await Promise.all(
        nodes.map(async (_, i) => {
          const node = nodes[hotspot ? 0 : i]!,
            context = store.context(world);
          await context.node(node.id);
          await context.relations(node.id, "status", "out", 1);
          return {
            context,
            lease: await store.claim(world, randomUUID()),
            input: {
              commitId: randomUUID(),
              at: 1,
              changes: delta({ revisions: [{ ...node, text: `更新 ${i}` }] }),
            },
          };
        }),
      );
      let conflicts = 0;
      const durations: number[] = [],
        retry: typeof pending = [];
      await Promise.all(
        pending.map(async (p) => {
          const started = performance.now();
          try {
            await store.commit(p.lease, p.context, p.input);
          } catch (error) {
            if (!(error instanceof WorldConflict)) throw error;
            conflicts++;
            retry.push(p);
          } finally {
            durations.push(performance.now() - started);
          }
        }),
      );
      assert.equal(conflicts, hotspot ? 7 : 0);
      for (const p of retry) {
        const fresh = store.context(world);
        await fresh.node(nodes[0]!.id);
        await store.commit(p.lease, fresh, p.input);
      }
      const counts = await db.graph.executeQuery(
        "MATCH(r:WorldReceipt {worldId:$world}) RETURN count(r) AS count",
        { world },
      );
      assert.equal(Number(counts.records[0]!.get("count")), 9);
      return {
        runs: 8,
        conflicts,
        reevaluations: retry.length,
        committed: 8,
        commitLatency: latency(durations),
        dependencies: pending.map((p) => p.context.dependencies.length),
      };
    },
    true,
  );
}

async function denseEffects(size: number, noise: number) {
  const root = existence("作用の受け手"),
    sources = Array.from({ length: size }, (_, i) => existence(`作用元 ${i}`)),
    unrelated = Array.from({ length: noise }, () => existence("無関係な領域"));
  const world = await seed(
    [root, ...sources, ...unrelated],
    sources.flatMap((n, i) => [
      effect(n.id, root.id),
      effect(n.id, sources[(i + 1) % size]!.id),
    ]),
  );
  await measure(`effects-${size}-noise-${noise}`, async () => {
    const times: number[] = [],
      counts: number[] = [],
      lookupStatements: number[] = [];
    for (let i = 0; i < 3; i++) {
      const context = store.context(world),
        started = performance.now(),
        statements = metrics.statements;
      const found = await context.effects(root.id, 0, 1);
      lookupStatements.push(metrics.statements - statements);
      times.push(performance.now() - started);
      counts.push(context.dependencies.length);
      assert.equal(found.length, size + 1);
      assert.equal(found.flatMap((n) => n.incoming).length, size * 2);
      if (unrelated[0]) {
        const lease = await store.claim(world, randomUUID());
        await store.commit(lease, store.context(world), {
          commitId: randomUUID(),
          at: 1,
          changes: delta({
            revisions: [{ ...unrelated[0], text: `無関係な更新 ${i}` }],
          }),
        });
        await context.validate();
      }
    }
    return {
      nodes: 1 + size + noise,
      edges: 2 * size,
      reached: size + 1,
      dependencies: counts,
      lookupStatements,
      queryLatency: latency(times),
    };
  });
}

async function recovery() {
  const node = existence("復旧の対象"),
    world = await seed([node]),
    lease = await store.claim(world, randomUUID()),
    input = {
      commitId: randomUUID(),
      at: 1,
      changes: delta({ revisions: [{ ...node, text: "成立済みの更新" }] }),
    };
  await measure("recovery", async () => {
    const committed = await store.commit(lease, store.context(world), input);
    const another = connectDatabases();
    try {
      const restored = new WorldStore(another.graph);
      assert.deepEqual(
        await restored.commit(lease, restored.context(world), input),
        committed,
      );
    } finally {
      await another.close();
    }
    await store.claim(world, lease.runId);
    await assert.rejects(
      store.commit(lease, store.context(world), {
        ...input,
        commitId: randomUUID(),
      }),
      WorldConflict,
    );
    return { receiptRestored: true, staleWorkerRejected: true };
  });
}

let modelCalls = 0;
const model = new LlmClient(
  db.postgres,
  { ...modelEnvironment(budget), LLM_RESOLUTION_JUDGMENT: "combined" },
  async (_url, options) => {
    modelCalls++;
    await delay(100);
    const body = JSON.parse(String(options?.body)),
      user = JSON.parse(
        body.messages.find((m: { role: string }) => m.role === "user").content,
      );
    const script = randomUUID();
    return new Response(
      JSON.stringify({
        id: randomUUID(),
        model: "gemini-3.8-flash",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                type: "propose",
                changes: delta({
                  nodes: [{ id: script, kind: "script", text: "計測用の状態" }],
                  edges: [
                    {
                      id: randomUUID(),
                      kind: "status",
                      role: "content",
                      source: user.request.rootIds[0],
                      target: script,
                      period: { from: 0 },
                    },
                  ],
                }),
                summary: "PoC",
                resolvedUntil: 1,
                wakeups: [],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  },
);
const agent = new WorldAgent(db.postgres, graph, db.checkpointer, model);
async function pgStats() {
  await db.postgres.query("SELECT pg_stat_clear_snapshot()");
  return (
    await db.postgres.query(
      "SELECT xact_commit::float8,xact_rollback::float8,blks_read::float8,blks_hit::float8,temp_bytes::float8,deadlocks::float8 FROM pg_stat_database WHERE datname=current_database()",
    )
  ).rows[0] as Record<string, number>;
}
async function queued(concurrency: number) {
  const nodes = Array.from({ length: 8 }, () => existence("独立した主体")),
    world = await seed(nodes);
  await measure(
    `queue-${concurrency}`,
    async () => {
      const before = await pgStats(),
        waits: number[] = [],
        times: number[] = [],
        acceptance: number[] = [];
      const callsBefore = modelCalls;
      let active = 0,
        peak = 0,
        completed = 0,
        finish!: () => void,
        fail!: (error: unknown) => void;
      let maxConnections = 0,
        maxActive = 0,
        maxWaiting = 0;
      const completion = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const timer = setTimeout(
        () => fail(new Error("PoCのキュー実行が60秒で完了しませんでした")),
        60000,
      );
      const sampling = setInterval(() => {
        maxConnections = Math.max(maxConnections, db.postgres.totalCount);
        maxActive = Math.max(
          maxActive,
          db.postgres.totalCount - db.postgres.idleCount,
        );
        maxWaiting = Math.max(maxWaiting, db.postgres.waitingCount);
      }, 25);
      const worker = await db.queue.work<{
        operation: string;
        accepted: number;
      }>(
        queue,
        { localConcurrency: concurrency, pollingIntervalSeconds: 0.5 },
        async (jobs) => {
          for (const job of jobs) {
            waits.push(Date.now() - job.data.accepted);
            const started = performance.now();
            peak = Math.max(peak, ++active);
            try {
              await agent.run(job.data.operation);
            } catch (error) {
              fail(error);
            } finally {
              active--;
              times.push(performance.now() - started);
              if (++completed === 8) finish();
            }
          }
        },
      );
      try {
        for (const n of nodes) {
          const started = performance.now(),
            client = await db.postgres.connect();
          try {
            await client.query("BEGIN");
            const operation = await agent.create(
              {
                worldId: world,
                phase: "resolution",
                rootIds: [n.id],
                at: 0,
                until: 1,
                actionText: "",
              },
              randomUUID(),
              client,
            );
            await db.queue.send(
              queue,
              { operation, accepted: Date.now() },
              {
                db: {
                  executeSql: (text, values) => client.query(text, values),
                },
              },
            );
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
          acceptance.push(performance.now() - started);
        }
        await completion;
        assert.equal(modelCalls - callsBefore, 8);
        const after = await pgStats();
        const checkpoints = await db.postgres.query(
          "SELECT count(*)::int AS count FROM checkpoints WHERE split_part(thread_id,':',1) IN (SELECT id::text FROM world_operation WHERE request->>'worldId'=$1)",
          [world],
        );
        return {
          runs: completed,
          concurrency,
          peak,
          acceptance: latency(acceptance),
          queueWait: latency(waits),
          run: latency(times),
          modelCalls: modelCalls - callsBefore,
          simulatedModelLatencyMs: 100,
          connections: { maxConnections, maxActive, maxWaiting },
          checkpoints: checkpoints.rows[0]!.count,
          databaseDelta: Object.fromEntries(
            Object.entries(after).map(([key, value]) => [
              key,
              value - before[key]!,
            ]),
          ),
        };
      } finally {
        clearTimeout(timer);
        clearInterval(sampling);
        await db.queue.offWork(queue, { id: worker, wait: true });
      }
    },
    true,
  );
}

try {
  await db.verify();
  db.queue.on("error", console.error);
  await db.queue.start();
  await db.queue.createQueue(queue, { retryLimit: 0 });
  await agent.setup();
  report.environment = {
    startedAt: new Date().toISOString(),
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    node: process.version,
    cpu: cpus()[0]?.model,
    memoryGiB: totalmem() / 2 ** 30,
    neo4j: (
      await db.graph.executeQuery(
        "CALL dbms.components() YIELD versions,edition RETURN versions,edition",
      )
    ).records.map((r) => r.toObject()),
    postgres: (await db.postgres.query("SHOW server_version")).rows[0]!
      .server_version,
  };
  await graphUpdates(false);
  await graphUpdates(true);
  for (const [size, noise] of [
    [8, 0],
    [8, 512],
    [64, 0],
  ])
    await denseEffects(size!, noise!);
  await recovery();
  await queued(1);
  await queued(4);
  const output =
    process.argv[2] ?? "artifacts/evaluations/world-runtime-poc.json";
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`記録: ${output}`);
} finally {
  await db.queue.deleteQueue(queue);
  const threads = await db.postgres.query<{ thread_id: string }>(
    "SELECT DISTINCT thread_id FROM checkpoints WHERE split_part(thread_id,':',1) IN (SELECT id::text FROM world_operation WHERE request->>'worldId'=ANY($1::text[]))",
    [worlds],
  );
  for (const { thread_id } of threads.rows)
    await db.checkpointer.deleteThread(thread_id);
  await db.postgres.query(
    "DELETE FROM execution_budget WHERE id IN (SELECT id FROM world_operation WHERE request->>'worldId'=ANY($1::text[]))",
    [worlds],
  );
  await db.postgres.query("DELETE FROM llm_call WHERE budget_id=$1", [budget]);
  await db.postgres.query("DELETE FROM llm_budget WHERE id=$1", [budget]);
  await db.postgres.query(
    "DELETE FROM world_operation WHERE request->>'worldId'=ANY($1::text[])",
    [worlds],
  );
  await db.graph.executeQuery(
    "MATCH(n) WHERE n.worldId IN $worlds DETACH DELETE n",
    { worlds },
  );
  await db.queue.stop();
  await db.close();
}
