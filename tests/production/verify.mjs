import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { get } from "node:https";
import { initializeDeployment } from "../../infra/production/config.mjs";
import { command } from "../../infra/production/engine.mjs";

const suffix = randomUUID().slice(0, 8),
  root = resolve(`.deployments/recovery-${suffix}`),
  deployments = [];
await mkdir(root, { recursive: true });
const runNode = async (service, code, ...args) =>
  command([
    "exec",
    service,
    "node",
    "--input-type=module",
    "-e",
    code,
    ...args,
  ]);
const rpc = async (name, action, body) =>
  JSON.parse(
    (
      await runNode(
        `${name}-controller-1`,
        "const [action,input]=process.argv.slice(1);const response=await fetch('http://127.0.0.1:3100/'+action,{method:'POST',headers:{authorization:'Bearer '+process.env.CONTROL_TOKEN,'content-type':'application/json'},body:input});if(!response.ok)throw Error('Controller rejected request');console.log(await response.text());",
        action,
        JSON.stringify(body),
      )
    ).toString(),
  );
const ops = async (name, input, id = randomUUID()) =>
  JSON.parse(
    (
      await command([
        "exec",
        `${name}-api-1`,
        "node",
        "--import",
        "tsx",
        "tests/production/mcp.mjs",
        JSON.stringify({ ...input, requestId: id }),
      ])
    ).toString(),
  );
const wait = async (name, id) => {
  for (let i = 0; i < 900; i++) {
    const { job } = await rpc(name, "job", { id });
    if (job.state === "complete") return job;
    assert.notEqual(job.state, "failed", `復旧ジョブの失敗: ${job.phase}`);
    await delay(1000);
  }
  throw new Error("復旧ジョブの待ち時間を超過しました");
};
const compose = (d, ...args) =>
  command([
    "compose",
    "--project-name",
    d.config.name,
    "--env-file",
    join(d.root, "deployment.env"),
    "-f",
    resolve("infra/production/compose.yaml"),
    ...args,
  ]);
const cli = (action, d, ...args) =>
  new Promise((resolvePromise, reject) => {
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(
        process.execPath,
        ["scripts/production.mjs", action, d.root, ...args],
        { stdio: "inherit" },
      );
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolvePromise()
          : reject(Error(`Deployment ${action} failed`)),
      );
    });
  });
async function verifyLocalRecovery(deployment) {
  const name = deployment.config.name;
  const services = async () =>
    (await compose(deployment, "ps", "-q", "api", "worker"))
      .toString()
      .split(/\s+/)
      .filter(Boolean)
      .sort();
  const runJob = async (request) => wait(name, (await ops(name, request)).id);
  const runHostJob = async (request) => {
    const requestId = randomUUID();
    const file = join(deployment.root, "local-backup-test.json");
    await writeFile(file, JSON.stringify({ ...request, requestId }), {
      mode: 0o600,
    });
    await cli("controller", deployment, file);
    await wait(name, requestId);
  };
  const running = await services();
  assert.equal(running.length, 2);
  await cli("backup-controller", deployment);
  assert.deepEqual(await services(), running);

  const previous = await ops(name, { operation: "backups.read" });
  await runHostJob({
    operation: "backups.configure",
    configuration: {
      enabled: false,
      intervalHours: 24,
      retentionDays: 30,
      repository: "local",
      password: "test-password-for-local-recovery-only",
    },
    expectedVersion: previous.version,
    reason: "ホスト内の隔離復元試験",
  });
  assert.equal(
    (await ops(name, { operation: "backups.read" })).configuration.repository,
    "local",
  );
  const before = await ops(name, { operation: "runtime.read" });
  const editUntil = () => new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await ops(name, {
    operation: "runtime.put",
    configuration: {
      ...before.configuration,
      paused: true,
      worldEditsUntil: editUntil(),
    },
    expectedVersion: before.version,
    reason: "管理確認期間の取得前検証",
  });
  await compose(deployment, "stop", "worker", "caddy");
  await runHostJob({
    operation: "backups.create",
    reason: "メンテナンス中のホスト内バックアップ",
  });
  const stillStopped = await compose(
    deployment,
    "ps",
    "--status",
    "running",
    "-q",
    "worker",
    "caddy",
  );
  assert.equal(stillStopped.toString().trim(), "");
  await cli("up", deployment);
  const snapshots = await ops(name, { operation: "backups.list" });
  assert.equal(snapshots.items.length, 1);
  const afterBackup = await ops(name, { operation: "runtime.read" });
  assert.equal(afterBackup.configuration.paused, true);
  assert.equal(afterBackup.configuration.worldEditsUntil, undefined);

  await ops(name, {
    operation: "runtime.put",
    configuration: {
      ...afterBackup.configuration,
      retentionDays: afterBackup.configuration.retentionDays + 1,
      worldEditsUntil: editUntil(),
    },
    expectedVersion: afterBackup.version,
    reason: "取得後に管理修正する隔離試験",
  });
  const {
    items: [{ id: worldId }],
  } = await ops(name, { operation: "worlds.list" });
  const itemId = randomUUID();
  const item = () =>
    ops(name, {
      operation: "worlds.graph",
      worldId,
      query: { kind: "node", id: itemId },
    });
  await ops(name, {
    operation: "worlds.edit",
    worldId,
    at: Date.now(),
    dependencies: [],
    changes: {
      nodes: [{ id: itemId, kind: "existence", text: "取得後の試験物品" }],
      edges: [],
      endEdges: [],
    },
    reason: "ローカル復元で消えることを確認する試験物品",
  });
  assert.equal((await item()).node.id, itemId);
  await runJob({
    operation: "backups.restore",
    snapshot: snapshots.items[0].id,
    reason: "メンテナンス中のホスト内復元",
  });
  const restored = await ops(name, { operation: "runtime.read" });
  assert.deepEqual(restored.configuration, {
    ...before.configuration,
    paused: true,
  });
  assert.equal((await item()).node, null);
}
const storage = `gestaloka-recovery-s3-${suffix}`;
const https = async (d, subdomain, path, method = "GET") =>
  new Promise((resolvePromise, reject) => {
    const host = `${subdomain}.${d.config.domain}`;
    const request = get(
      {
        hostname: "127.0.0.1",
        servername: host,
        port: d.config.httpsPort,
        path,
        method,
        headers: { host: `${host}:${d.config.httpsPort}` },
        rejectUnauthorized: false,
      },
      (response) => {
        let text = "";
        response.on("data", (c) => {
          text += c;
        });
        response.on("end", () =>
          resolvePromise({ status: response.statusCode, text }),
        );
      },
    );
    request.setTimeout(5000, () => request.destroy(Error("HTTPS_TIMEOUT")));
    request.on("error", reject);
  });
try {
  for (const [role, httpPort, httpsPort] of [
    ["source", 24880, 24843],
    ["target", 24980, 24943],
  ]) {
    const d = await initializeDeployment(join(root, role), {
      name: `gestaloka-recovery-${suffix}-${role}`,
      domain: `${role}.recovery.test`,
      mode: "testing",
      httpPort,
      httpsPort,
      accessCidrs: "0.0.0.0/0 ::/0",
    });
    deployments.push(d);
    await cli("build", d);
    for (const role of ["api", "worker", "controller"]) {
      const image = `${d.config.name}-${role === "controller" ? role : "server"}`;
      console.log(
        JSON.stringify({
          role,
          image,
          imageId: (
            await command(["image", "inspect", "--format", "{{.Id}}", image])
          )
            .toString()
            .trim(),
          tls: JSON.parse(
            await command([
              "run",
              "--rm",
              image,
              "node",
              "tests/production/tls.mjs",
            ]),
          ),
        }),
      );
    }
    await cli("up", d);
    const [api] = JSON.parse(
      await command(["inspect", `${d.config.name}-api-1`]),
    );
    assert.equal(api.Config.StopTimeout, 240);
    for (const host of ["play", "admin", "api"]) {
      let page;
      for (let i = 0; ; i++) {
        try {
          page = await https(d, host, host === "api" ? "/api/health" : "/");
          break;
        } catch (error) {
          if (i === 30) throw error;
          await delay(1000);
        }
      }
      assert.equal(page.status, 200);
    }
    const discovery = JSON.parse(
      (await https(d, "api", "/.well-known/openid-configuration")).text,
    );
    assert.equal(discovery.issuer, d.env.ORY_HYDRA_PUBLIC_URL);
    assert.equal((await https(d, "api", "/admin/identities")).status, 404);
    assert.equal((await https(d, "api", "/internal/auth/attempt")).status, 404);
    for (let i = 0; i < 30; i++)
      assert.notEqual(
        (await https(d, "api", "/self-service/login", "POST")).status,
        429,
      );
    assert.equal(
      (await https(d, "api", "/self-service/login", "POST")).status,
      429,
    );
    const containers = JSON.parse(
      (
        await command([
          "inspect",
          ...(await compose(d, "ps", "-q")).toString().trim().split(/\s+/),
        ])
      ).toString(),
    );
    for (const c of containers)
      if (!c.Name.includes("-caddy-"))
        assert(
          !Object.values(c.NetworkSettings.Ports ?? {}).some((v) => v?.length),
          "内部サービスのポートを公開しない",
        );
    const publicTest = await command([
      "exec",
      `${d.config.name}-caddy-1`,
      "wget",
      "-qO-",
      "http://api:3000/api/health",
    ]);
    assert.equal(JSON.parse(publicTest).status, "ok");
  }
  const [source, target] = deployments;
  await command([
    "run",
    "-d",
    "--name",
    storage,
    "--network",
    `${source.config.name}_egress`,
    "--network-alias",
    "storage",
    "motoserver/moto:5.2.4@sha256:120b1589c6df7e35d2092935f6ff724486bb2c4189d0e36ce795baba1400ffd2",
  ]);
  await command([
    "network",
    "connect",
    "--alias",
    "storage",
    `${target.config.name}_egress`,
    storage,
  ]);
  for (let i = 0; ; i++) {
    try {
      await runNode(
        `${source.config.name}-controller-1`,
        "const r=await fetch('http://storage:5000/backups',{method:'PUT'});if(!r.ok)throw Error('S3 not ready');",
      );
      break;
    } catch (error) {
      if (i === 30) throw error;
      await delay(1000);
    }
  }
  await command([
    "exec",
    `${source.config.name}-api-1`,
    "node",
    "--import",
    "tsx",
    "tests/production/data.mjs",
    "seed",
  ]);
  const configuration = {
    enabled: false,
    intervalHours: 24,
    retentionDays: 30,
    repository: "s3:http://storage:5000/backups/recovery",
    accessKey: "test-access",
    secretKey: "test-secret",
    password: "test-password-for-recovery-only",
    region: "us-east-1",
  };
  await wait(
    source.config.name,
    (
      await ops(source.config.name, {
        operation: "backups.configure",
        configuration,
        expectedVersion: 0,
        reason: "隔離試験",
      })
    ).id,
  );
  const id = randomUUID(),
    request = { operation: "backups.create", reason: "隔離復元試験" };
  await ops(source.config.name, request, id);
  await wait(source.config.name, id);
  await ops(source.config.name, request, id);
  const snapshots = await ops(source.config.name, {
    operation: "backups.list",
  });
  assert.equal(snapshots.items.length, 1);
  const snapshot = snapshots.items[0].id;
  const configureId = randomUUID();
  await ops(
    target.config.name,
    {
      operation: "backups.configure",
      configuration,
      expectedVersion: 0,
      reason: "隔離復元の事前設定",
    },
    configureId,
  );
  await wait(target.config.name, configureId);
  const restoreId = randomUUID();
  await ops(
    target.config.name,
    {
      operation: "backups.restore",
      snapshot,
      reason: "空の隔離環境へ復元",
    },
    restoreId,
  );
  await wait(target.config.name, restoreId);
  await cli("sync", target);
  const result = JSON.parse(
    (
      await command([
        "exec",
        `${target.config.name}-api-1`,
        "node",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "process.argv[2]='verify';try{await import('./tests/production/data.mjs')}catch(error){console.log(JSON.stringify({failure:error.name,code:error.code,location:error.stack?.split('\\n').find(line=>line.includes('tests/production/data.mjs'))}));}",
      ])
    ).toString(),
  );
  assert(result.noDuplicateCharge, JSON.stringify(result));
  await verifyLocalRecovery(source);
  await writeFile(
    join(root, "result.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        snapshot,
        localRecoveryWhilePaused: true,
        ...result,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(result));
} finally {
  await command(["rm", "-f", storage]).catch(() => {});
  for (const d of deployments.reverse())
    await compose(d, "down", "-v", "--remove-orphans").catch(() => {});
}
