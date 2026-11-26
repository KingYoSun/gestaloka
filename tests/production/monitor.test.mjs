import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

test("未登録の参加要求は同じジョブの停止履歴で判定し、開始後の障害だけを再開・通知する", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "gestaloka-monitor-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = join(dir, "monitor.mjs");
  await copyFile(
    new URL("../../infra/production/monitor/monitor.mjs", import.meta.url),
    script,
  );
  const startedAt = "2030-01-02T00:00:00Z",
    before = "2030-01-01T00:00:00Z",
    after = "2030-01-03T00:00:00Z";
  const worldId = randomUUID(),
    userId = randomUUID();
  const paused = (finishedAt) => ({
    id: randomUUID(),
    kind: "join",
    worldId,
    userId,
    state: "paused",
    executionState: "paused",
    at: Date.parse(before),
    startedAt: before,
    finishedAt,
  });
  const resumed = paused(after),
    observed = paused(after),
    prior = paused(before),
    fresh = paused(after);
  const ready = {
    ...paused(after),
    at: Date.parse(after),
    state: "ready",
    executionState: "finished",
  };

  // 同じ利用者・世界の要求を、使い捨てのDBで本番と同じpsql経路に通す。
  const container = execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--network",
      "none",
      "--tmpfs",
      "/var/lib/postgresql/data",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_DB=monitor",
      "-e",
      "POSTGRES_USER=monitor",
      "postgres:17",
    ],
    { encoding: "utf8" },
  ).trim();
  t.after(() => execFileSync("docker", ["rm", "-f", container]));
  execFileSync(
    "docker",
    [
      "exec",
      container,
      "sh",
      "-ec",
      "until pg_isready -q -h 127.0.0.1 -U monitor -d monitor; do sleep 0.2; done",
    ],
    { timeout: 60000 },
  );
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "monitor",
      "-d",
      "monitor",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `
      CREATE TABLE world_operation (id uuid, created_at timestamptz);
      CREATE TABLE world_join (id uuid, operation_id uuid);
      CREATE TABLE operation_audit (request_id int, operation text, outcome text, created_at timestamptz, details jsonb);
      CREATE TABLE operation_request (id int, result jsonb);
      INSERT INTO world_operation VALUES ${[resumed, observed, prior, fresh].map((j) => `('${j.id}', '${before}')`).join(",")};
      INSERT INTO world_join SELECT id,id FROM world_operation;
      INSERT INTO operation_audit VALUES
        (1,'worlds.resumeJoin','accepted','${before}','{"id":"${resumed.id}"}'),
        (2,'jobs.list','accepted','${after}','{}'),
        (3,'jobs.resume','denied','${before}','{"id":"${fresh.id}","kind":"join"}'),
        (4,'jobs.resume','accepted','${startedAt}','{"id":"${fresh.id}","kind":"join"}');
      INSERT INTO operation_request VALUES
        (2,'${JSON.stringify({ items: [{ ...observed, finishedAt: before }] })}');
    `,
    },
  );

  for (const name of ["keys", "state"]) await mkdir(join(dir, name));
  const json = (name, value) =>
    writeFile(join(dir, name), JSON.stringify(value));
  await writeFile(join(dir, "client-id"), "test");
  await writeFile(join(dir, "keys/webhook"), "test");
  await json("keys/mcp-access.json", {
    token: "test",
    exp: Date.now() + 3600000,
  });
  await json("config.json", { url: "https://monitor.invalid/webhook" });
  await json("join-monitoring.json", { startedAt, previousStops: {} });

  const resumes = [],
    notifications = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const message = JSON.parse(options.body);
    if (url === "https://monitor.invalid/webhook") {
      notifications.push(message);
      return new Response(null, { status: 204 });
    }
    const reply = (result) =>
      Response.json({ id: message.id, jsonrpc: "2.0", result });
    if (message.method === "initialize")
      return reply({ protocolVersion: message.params.protocolVersion });
    if (message.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    const { name, arguments: args } = message.params;
    let result;
    switch (name) {
      case "worlds_list":
        result = { items: [{ id: worldId }] };
        break;
      case "playSessions_list":
        result = { items: [] };
        break;
      case "jobs_list":
        if (args.query.kind !== "join") result = { items: [] };
        else if (args.query.before === "next")
          result = { items: [fresh, ready] };
        else result = { items: [resumed, observed, prior], next: "next" };
        // 誤った場所にカーソルを送る実装では、無限に同じページを返さない。
        assert.equal(args.before, undefined);
        break;
      case "jobs_resume":
        resumes.push(args.id);
        result = {};
        break;
      default:
        throw new Error(`予期しない監視操作: ${name}`);
    }
    return reply({ structuredContent: result });
  });
  const previousPG = process.env.MONITOR_PG;
  process.env.MONITOR_PG = container;
  t.after(() => {
    if (previousPG === undefined) delete process.env.MONITOR_PG;
    else process.env.MONITOR_PG = previousPG;
  });
  const previousArgs = process.argv;
  process.argv = [process.execPath, script, "play"];
  t.after(() => {
    process.argv = previousArgs;
  });
  for (let scan = 0; scan < 4; scan++) {
    await import(`${pathToFileURL(script).href}?scan=${scan}`);
    prior.finishedAt = after;
  }
  assert.deepEqual(resumes, [fresh.id, fresh.id]);
  assert.deepEqual(
    notifications.map((n) => [n.kind, n.details.jobId]),
    [["job", fresh.id]],
  );
  const baseline = JSON.parse(
    await readFile(join(dir, "join-monitoring.json"), "utf8"),
  );
  assert.deepEqual(
    Object.keys(baseline.previousStops).sort(),
    [resumed.id, observed.id, prior.id].sort(),
  );
  assert.equal(baseline.previousStops[resumed.id].source, "worlds.resumeJoin");
  assert.equal(baseline.previousStops[observed.id].source, "job-observation");
});
