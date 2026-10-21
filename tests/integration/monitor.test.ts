import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RuntimeMonitor, RuntimeControl } from "@gestaloka/server";
import { RuntimeSettings } from "@gestaloka/contracts";
import { isolatedDatabases } from "../support/isolated-db.js";
import { fixtureRuntime } from "../support/provider.js";
import { fixtureAuth } from "../support/auth.js";
import type { z } from "zod";

let isolated: ReturnType<typeof isolatedDatabases>,
  runtime: Awaited<ReturnType<typeof fixtureRuntime>>["runtime"],
  auth: Awaited<ReturnType<typeof fixtureAuth>>,
  monitor: RuntimeMonitor,
  admin: string,
  user: string,
  scope: string,
  graphFailure: boolean;
const destination = "https://hook.invalid/private-token";
const transport = vi.fn<typeof fetch>(
  async () => new Response(null, { status: 204 }),
);
const configuration = async (
  thresholds: z.infer<typeof RuntimeSettings>["thresholds"],
) => {
  const r = await RuntimeControl.read(isolated.databases.postgres);
  return auth.operations.execute(admin, randomUUID(), {
    operation: "runtime.put",
    configuration: { ...r.configuration, thresholds },
    expectedVersion: r.version,
    reason: "監視条件の試験",
  });
};
const webhook = () =>
  auth.operations.execute(admin, randomUUID(), {
    operation: "monitorWebhook.put",
    url: destination,
    expectedVersion: 0,
    reason: "模擬通知先",
  });
const page = async (
  operation: "monitor.samples" | "monitor.notifications",
  before?: string,
) =>
  auth.operations.execute(admin, randomUUID(), {
    operation,
    query: before ? { before } : {},
  }) as Promise<{ items: Record<string, unknown>[]; next: string | null }>;
beforeEach(async () => {
  isolated = isolatedDatabases();
  await isolated.setup();
  scope = `monitor-${randomUUID()}`;
  ({ runtime } = await fixtureRuntime(scope, undefined, isolated.databases));
  auth = await fixtureAuth(isolated.databases.postgres);
  admin = (await auth.person()).id;
  user = (await auth.person("user")).id;
  // The worker normally starts after all three logical job tables are ready.
  const { WorldAccess } = await import("@gestaloka/server/access");
  await new WorldAccess(runtime).setup();
  graphFailure = false;
  transport.mockReset();
  transport.mockImplementation(async () => new Response(null, { status: 204 }));
  monitor = new RuntimeMonitor(
    isolated.databases.postgres,
    {
      verifyConnectivity: async () => {
        if (graphFailure) throw new Error("private graph failure");
      },
    },
    "2".repeat(64),
    transport,
  );
});
afterEach(async () => {
  await monitor.stop();
  for (const suffix of ["", "-play", "-scenes", "-joins"])
    await isolated.databases.queue.deleteQueue(`e2e-${scope}${suffix}`);
  await isolated.databases.queue.stop();
  await isolated.close();
});

test("初期設定は60秒・30日・通知停止で、DBの状態を実値で採取する", async () => {
  const r = await RuntimeControl.read(isolated.databases.postgres);
  expect(r).toMatchObject({
    webhookConfigured: false,
    configuration: {
      sampleIntervalSeconds: 60,
      retentionDays: 30,
      thresholds: {},
    },
  });
  const sample = await monitor.sample(true);
  expect(sample.sampled).toBe(true);
  expect(sample.metrics).toMatchObject({
    postgresUnavailable: 0,
    graphUnavailable: 0,
    calculatedUsd: 0,
    unsettledUsd: 0,
    errorPercent: null,
    latencyMs: null,
  });
  expect(RuntimeSettings.safeParse({ paused: true }).success).toBe(false);
  expect(sample.metrics!.postgresBytes).toBeGreaterThan(0);
  expect(transport).not.toHaveBeenCalled();
  expect((await page("monitor.samples")).items).toHaveLength(1);
  expect((await monitor.sample()).sampled).toBe(false);
});

test("通知先を暗号化し、異常と回復だけを通知する。本文や秘密値を出力しない", async () => {
  await webhook();
  await configuration({ graphUnavailable: 0.5 });
  graphFailure = true;
  await monitor.sample(true);
  await monitor.sample(true);
  expect(transport).toHaveBeenCalledTimes(1);
  graphFailure = false;
  await monitor.sample(true);
  expect(transport).toHaveBeenCalledTimes(2);
  const bodies = transport.mock.calls.map((c) =>
    JSON.parse(String(c[1]?.body)),
  );
  expect(bodies.map((b) => b.type)).toEqual(["alert", "recovery"]);
  expect(bodies[0]).toMatchObject({
    metric: "graphUnavailable",
    value: 1,
    threshold: 0.5,
  });
  const notifications = await page("monitor.notifications");
  expect(notifications.items).toHaveLength(2);
  expect(
    notifications.items.every(
      (n) => n.status === "delivered" && n.attempts === 1,
    ),
  ).toBe(true);
  const db = isolated.databases.postgres;
  const cipher = (await db.query("SELECT webhook_cipher FROM runtime_control"))
    .rows[0].webhook_cipher;
  expect(cipher).not.toContain(destination);
  expect(
    JSON.stringify([
      notifications,
      await RuntimeControl.read(db),
      (await db.query("SELECT details FROM operation_audit")).rows,
      bodies,
    ]),
  ).not.toMatch(
    /private-token|private graph failure|PRIVATE_REASONING|PRIVATE_PLACE/,
  );
  expect(
    (
      await db.query(
        "SELECT details FROM operation_audit WHERE operation IN ('monitor.samples','monitor.notifications')",
      )
    ).rows.every((r) => JSON.stringify(r.details) === "{}"),
  ).toBe(true);
  await expect(
    auth.operations.execute(user, randomUUID(), {
      operation: "monitor.notifications",
      query: {},
    }),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
});

test("配送失敗は成功にせず、同じ通知IDで再試行する", async () => {
  await webhook();
  await configuration({ graphUnavailable: 0.5 });
  graphFailure = true;
  transport.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await monitor.sample(true);
  let rows = (await page("monitor.notifications")).items;
  expect(rows[0]).toMatchObject({
    status: "pending",
    attempts: 1,
    errorCode: "HTTP_503",
    deliveredAt: null,
  });
  await monitor.sample(true);
  expect(transport).toHaveBeenCalledTimes(1);
  await isolated.databases.postgres.query(
    "UPDATE monitor_notification SET next_at=now()-interval '1 second'",
  );
  await monitor.sample();
  expect(transport).toHaveBeenCalledTimes(2);
  rows = (await page("monitor.notifications")).items;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    status: "delivered",
    attempts: 2,
    errorCode: null,
  });
  expect(
    new Headers(transport.mock.calls[0]![1]!.headers).get(
      "x-gestaloka-notification-id",
    ),
  ).toBe(
    new Headers(transport.mock.calls[1]![1]!.headers).get(
      "x-gestaloka-notification-id",
    ),
  );
});

test("通知先の削除後は旧版の未送信通知を配送しない", async () => {
  await webhook();
  await configuration({ graphUnavailable: 0.5 });
  graphFailure = true;
  transport.mockResolvedValue(new Response(null, { status: 503 }));
  await monitor.sample(true);
  expect(transport).toHaveBeenCalledTimes(1);
  await auth.operations.execute(admin, randomUUID(), {
    operation: "monitorWebhook.put",
    url: null,
    expectedVersion: 1,
    reason: "通知先を解除",
  });
  await monitor.sample(true);
  expect(transport).toHaveBeenCalledTimes(1);
  expect((await page("monitor.notifications")).items[0]).toMatchObject({
    status: "superseded",
    deliveredAt: null,
  });
  expect(await RuntimeControl.read(isolated.databases.postgres)).toMatchObject({
    webhookVersion: 2,
    webhookConfigured: false,
  });
});

test("エラー率・遅延・キュー・計算額を測り、監視データだけを指定期間で削除する", async () => {
  const db = isolated.databases.postgres,
    budget = runtime.agent.model.ledger.budgetId;
  await db.query(
    "INSERT INTO runtime_metric(at,completed,failed,latency_ms) VALUES(now(),4,2,1234),(now()-interval '40 days',1,1,10)",
  );
  await db.query(
    "INSERT INTO llm_call(id,budget_id,hash,reserved_nano,charged_nano,request,state) VALUES($1,$2,'fee',10,7,'{}','complete'),($3,$2,'fee',13,NULL,'{}','pending')",
    [randomUUID(), budget, randomUUID()],
  );
  const world = await runtime.create("キュー確認", 100);
  await db.query(
    "UPDATE pgboss.job SET created_on=now()-interval '5 minutes' WHERE name=$1 AND data->>'id'=$2",
    [`e2e-${scope}`, world],
  );
  await db.query(
    "INSERT INTO monitor_sample(sample_id,at,configuration_version,metrics) VALUES($1,now()-interval '40 days',1,'{}')",
    [randomUUID()],
  );
  await db.query(
    "INSERT INTO monitor_notification(event_id,at,payload,webhook_version,status) VALUES($1,now()-interval '40 days','{}',0,'pending')",
    [randomUUID()],
  );
  const result = await monitor.sample(true);
  expect(result.metrics).toMatchObject({
    errorPercent: 50,
    latencyMs: 1234,
    calculatedUsd: 7e-9,
    unsettledUsd: 13e-9,
  });
  expect(result.metrics!.queueAgeSeconds).toBeGreaterThanOrEqual(300);
  expect((await page("monitor.samples")).items).toHaveLength(1);
  expect((await page("monitor.notifications")).items).toHaveLength(0);
  expect(
    (await db.query("SELECT count(*)::int AS n FROM runtime_metric")).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n,sum(charged_nano)::text AS fee FROM llm_call",
      )
    ).rows[0],
  ).toMatchObject({ n: 2, fee: "7" });
  expect(
    (await db.query("SELECT count(*)::int AS n FROM world_build")).rows[0].n,
  ).toBe(1);
});

test("標本と通知履歴をページ取得し、総件数を切り捨てない", async () => {
  const db = isolated.databases.postgres;
  await db.query(
    "INSERT INTO monitor_sample(sample_id,at,configuration_version,metrics) SELECT gen_random_uuid(),now(),1,'{}' FROM generate_series(1,102)",
  );
  await db.query(
    "INSERT INTO monitor_notification(event_id,at,payload,webhook_version,status) SELECT gen_random_uuid(),now(),'{}',0,'delivered' FROM generate_series(1,102)",
  );
  for (const operation of [
    "monitor.samples",
    "monitor.notifications",
  ] as const) {
    const first = await page(operation),
      second = await page(operation, first.next!),
      last = await page(operation, second.next!);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(50);
    expect(last.items).toHaveLength(2);
    expect(last.next).toBeNull();
    expect(
      new Set([...first.items, ...second.items, ...last.items].map((r) => r.id))
        .size,
    ).toBe(102);
  }
});

test("DB停止を保存済みの通知設定で通知し、復旧後に標本・通知履歴を保存する", async () => {
  await webhook();
  await configuration({ postgresUnavailable: 0.5 });
  await monitor.sample(true);
  const spy = vi
    .spyOn(isolated.databases.postgres, "query")
    .mockRejectedValue(new Error("private database failure"));
  try {
    expect((await monitor.sample(true)).metrics).toMatchObject({
      postgresUnavailable: 1,
    });
    await monitor.sample(true);
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
  await monitor.sample(true);
  expect(transport).toHaveBeenCalledTimes(2);
  const notifications = (await page("monitor.notifications")).items;
  expect(notifications).toHaveLength(2);
  expect(notifications.every((r) => r.status === "delivered")).toBe(true);
  expect((await page("monitor.samples")).items).toHaveLength(4);
  expect(
    transport.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).type),
  ).toEqual(["alert", "recovery"]);
});
