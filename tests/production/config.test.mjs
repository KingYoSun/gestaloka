import { test } from "node:test";
import assert from "node:assert/strict";
import { fstatSync, ftruncateSync, readSync, writeSync } from "node:fs";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeDeployment,
  renderDeployment,
  keyNames,
} from "../../infra/production/config.mjs";
import { BackupEngine } from "../../infra/production/engine.mjs";
import { createHash, randomUUID } from "node:crypto";
test("環境ごとに鍵を生成し、再描画では保持し、公開面と内部接続を分離する", async () => {
  const root = await mkdtemp(join(tmpdir(), "gestaloka-deploy-"));
  try {
    const config = {
      name: "deployment-test",
      domain: "example.test",
      mode: "testing",
      httpPort: 18080,
      httpsPort: 18443,
      accessCidrs: "127.0.0.1/32",
    };
    const a = await initializeDeployment(join(root, "a"), config),
      b = await initializeDeployment(join(root, "b"), config),
      again = await renderDeployment(a.root);
    for (const key of keyNames) {
      assert.notEqual(a.env[key], b.env[key]);
      assert.equal(a.env[key], again.env[key]);
    }
    assert.equal(a.env.ISOLATED_NETWORK, "true");
    assert.equal(a.env.ORY_KRATOS_PUBLIC_URL, "https://api.example.test:18443");
    const caddy = await readFile(
        join(a.root, "configuration/public/Caddyfile"),
        "utf8",
      ),
      ory = JSON.parse(
        await readFile(join(a.root, "configuration/ory/kratos.json"), "utf8"),
      );
    assert.match(caddy, /tls internal/);
    assert.match(caddy, /remote_ip 127.0.0.1\/32/);
    assert.equal(ory.session.cookie.domain, "example.test");
    assert.equal(ory.selfservice.methods.oidc.enabled, false);
    assert(!JSON.stringify(ory).includes(a.env.KRATOS_COOKIE_SECRET));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("本番の公開URLを保ってCaddyの待受と証明書の発行元を選べる", async () => {
  const root = await mkdtemp(join(tmpdir(), "gestaloka-ingress-"));
  try {
    const { env } = await initializeDeployment(root, {
      name: "deployment-test",
      domain: "example.test",
      mode: "production",
      httpPort: 80,
      httpsPort: 443,
      accessCidrs: "0.0.0.0/0",
    });
    const caddyfile = join(root, "configuration/public/Caddyfile");
    const original = await readFile(caddyfile, "utf8");
    assert.deepEqual(
      [env.BIND_ADDRESS, env.HTTP_PORT, env.HTTPS_PORT],
      ["0.0.0.0", "80", "443"],
    );
    assert.doesNotMatch(original, /tls internal/);
    await appendFile(
      join(root, "deployment.env"),
      "CADDY_BIND_ADDRESS=127.0.0.1\nCADDY_HTTP_PORT=28080\nCADDY_HTTPS_PORT=28443\nCADDY_TLS_MODE=internal\n",
    );
    const updated = await renderDeployment(root);
    assert.deepEqual(
      [updated.env.BIND_ADDRESS, updated.env.HTTP_PORT, updated.env.HTTPS_PORT],
      ["127.0.0.1", "28080", "28443"],
    );
    assert.equal(updated.env.ORY_KRATOS_PUBLIC_URL, "https://api.example.test");
    const internal = await readFile(caddyfile, "utf8");
    assert.equal(internal.match(/tls internal/g)?.length, 3);
    assert.equal(internal.replaceAll("tls internal", ""), original);
    assert.deepEqual((await renderDeployment(root)).env, updated.env);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("独立した制御台帳は秘密値を暗号化し、アプリ側の受付確定まで開始しない", async () => {
  const root = await mkdtemp(join(tmpdir(), "gestaloka-backup-"));
  try {
    await initializeDeployment(root, {
      name: "backup-test",
      domain: "example.test",
      mode: "testing",
      httpPort: 18080,
      httpsPort: 18443,
      accessCidrs: "127.0.0.1/32",
    });
    const engine = new BackupEngine(root);
    await engine.initialize();
    const id = randomUUID(),
      actor = randomUUID(),
      configuration = {
        enabled: false,
        intervalHours: 24,
        retentionDays: 30,
        repository: "s3:http://storage:5000/backup",
        accessKey: "SECRET-ACCESS",
        secretKey: "SECRET-KEY",
        password: "SECRET-PASSWORD-LONG",
        region: "local",
      },
      input = {
        operation: "backups.configure",
        configuration,
        expectedVersion: 0,
        reason: "試験",
      };
    try {
      let committed = false;
      engine.pool.query = async (sql) =>
        sql.startsWith("SELECT role")
          ? { rows: [{ role: "admin", banned: false }] }
          : {
              rows: committed
                ? [{ actor_id: actor, result: { id }, error: null }]
                : [],
            };
      await engine.prepare({ id, actor, input });
      await engine.activate(id);
      assert.equal((await engine.job(id)).job.state, "prepared");
      const saved = await readFile(join(root, "jobs", `${id}.json`), "utf8");
      assert(!saved.includes("SECRET-"));
      await engine.prepare({ id, actor, input });
      await assert.rejects(
        engine.prepare({ id, actor, input: { ...input, reason: "変更" } }),
        /REQUEST_CONFLICT/,
      );
      committed = true;
      await engine.activate(id);
      await engine.tick();
      assert.equal((await engine.job(id)).job.state, "complete");
      const publicData = JSON.stringify(await engine.read());
      assert(!publicData.includes("SECRET-"));
      assert(!JSON.stringify(await engine.job(id)).includes("cipher"));
      assert(!JSON.stringify(await engine.jobs()).includes("SECRET-"));
      const settings = await readFile(join(root, "settings.json"), "utf8");
      assert(!settings.includes("SECRET-"));
    } finally {
      await engine.pool.end();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("送信済み応答の保存を待ってからワーカーとグラフを停止する", async () => {
  const root = await mkdtemp(join(tmpdir(), "gestaloka-drain-"));
  let engine;
  try {
    await initializeDeployment(root, {
      name: "drain-test",
      domain: "example.test",
      mode: "testing",
      httpPort: 18080,
      httpsPort: 18443,
      accessCidrs: "127.0.0.1/32",
    });
    engine = new BackupEngine(root);
    await engine.initialize();
    const calls = [];
    engine.compose = async (...args) => {
      calls.push(args.join(" "));
      return Buffer.from(args[0] === "ps" ? "worker\ncaddy\n" : "");
    };
    engine.pool.connect = async () => ({
      release() {},
      query: async (sql) => ({
        rows: sql.startsWith("SELECT configuration")
          ? [{ configuration: { paused: false } }]
          : sql.startsWith("SELECT kind")
            ? [{ kind: "scene", id: randomUUID() }]
            : [],
      }),
    });
    let saved, arrived;
    const responseSaved = new Promise((r) => {
        saved = r;
      }),
      draining = new Promise((r) => {
        arrived = r;
      });
    engine.pool.query = async () => {
      arrived();
      await responseSaved;
      return { rows: [{ n: 0 }] };
    };
    const job = { id: randomUUID(), local: true },
      pending = engine.freeze(job);
    await draining;
    assert.deepEqual(calls, [
      "ps --status running --services worker caddy",
      "stop caddy api",
    ]);
    saved();
    await pending;
    assert.deepEqual(calls, [
      "ps --status running --services worker caddy",
      "stop caddy api",
      "stop worker kratos hydra neo4j",
    ]);
    assert.equal(job.paused, false);
    assert.deepEqual(job.resumeServices, ["worker", "caddy"]);
    assert.equal(job.executions.length, 1);
    assert.equal(job.quiesced, true);
  } finally {
    await engine?.pool.end();
    await rm(root, { recursive: true, force: true });
  }
});
test("受付後にMCPの許可を取り消したバックアップは外部送信・停止を始めない", async () => {
  const engine = new BackupEngine();
  let sent = false;
  engine.pool = {
    query: async (sql) => ({
      rows: sql.startsWith("SELECT role")
        ? [{ role: "admin", banned: false }]
        : [
            {
              revoked: true,
              scopes: ["backups.create"],
              world_ids: null,
              configuration: {
                enabled: true,
                scopes: ["backups.create"],
                worldIds: null,
              },
            },
          ],
    }),
  };
  engine.run = async () => {
    sent = true;
    throw Error("unexpected container call");
  };
  await assert.rejects(
    engine.process({
      id: randomUUID(),
      actor: randomUUID(),
      local: false,
      operation: "backups.create",
      permission: { grantId: randomUUID(), scope: "backups.create" },
    }),
    /MCP_AUTH_REVOKED/,
  );
  assert.equal(sent, false);
});
test("メンテナンス中に通常稼働時のバックアップを復元しても進行を再開しない", async () => {
  const engine = new BackupEngine();
  const calls = [];
  engine.step = async () => {};
  engine.compose = async (...args) => calls.push(args[0]);
  engine.pool = {
    query: async (statement, parameters) => {
      assert.match(statement, /configuration - 'worldEditsUntil'/);
      assert.deepEqual(parameters, ["true"]);
    },
  };
  await engine.thaw(
    { paused: true },
    { paused: false, executions: [{ kind: "scene", id: randomUUID() }] },
  );
  assert.deepEqual(calls, ["up", "up"]);
});
test("2 GiBを超えるダンプをファイル記述子で渡し、取得と復元でハッシュを確認する", async () => {
  const root = await mkdtemp(join(tmpdir(), "gestaloka-large-backup-"));
  const payload = Buffer.from("database-dump");
  const size = 2 ** 31 + payload.length;
  try {
    const commands = [];
    const engine = new BackupEngine(root, async (args, input, _env, stdio) => {
      assert.equal(input, undefined);
      if (args.includes("pg_dump")) {
        assert.equal(typeof stdio.stdoutFd, "number");
        if (args.at(-1) === "gestaloka") ftruncateSync(stdio.stdoutFd, size);
        writeSync(stdio.stdoutFd, payload);
      } else if (args.includes("pg_restore")) {
        assert.equal(typeof stdio.stdinFd, "number");
        assert.equal(fstatSync(stdio.stdinFd).size, size);
        const read = Buffer.alloc(payload.length);
        assert.equal(readSync(stdio.stdinFd, read), payload.length);
        assert.deepEqual(read, payload);
      }
      commands.push(args[args.indexOf("-T") + 2]);
      return Buffer.alloc(0);
    });
    engine.env = {};
    engine.project = "backup-test";
    engine.freeze = async () => {};
    engine.archive = async (_volume, file) =>
      writeFile(join(root, "staging", file), payload);
    await engine.capture({ id: randomUUID() });
    const manifest = JSON.parse(
      await readFile(join(root, "staging/manifest.json"), "utf8"),
    );
    const hash = createHash("sha256").update(payload),
      zeros = Buffer.alloc(2 ** 20);
    for (let i = 0; i < 2048; i++) hash.update(zeros);
    assert.equal(manifest.files["app.dump"], hash.digest("hex"));
    await engine.dump("postgres", "gestaloka", "gestaloka", "app.dump", true);
    assert.deepEqual(commands, [
      "pg_dump",
      "pg_dump",
      "pg_dump",
      "dropdb",
      "createdb",
      "pg_restore",
    ]);

    const restored = join(root, "restore/state");
    engine.restic = async () => {
      await mkdir(restored, { recursive: true });
      await rename(join(root, "staging"), join(restored, "staging"));
    };
    engine.step = async () => {};
    const verified = new Error("復元前の検証を通過");
    engine.freeze = async () => {
      throw verified;
    };
    await assert.rejects(engine.restore({}, {}, "snapshot"), {
      message: verified.message,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
