import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { BackupConfiguration, Operation } from "@gestaloka/contracts";
import { seal, unseal } from "../../packages/server/dist/secrets.js";
import { keyNames, renderDeployment } from "./config.mjs";

const require = createRequire(
  new URL("../../packages/server/package.json", import.meta.url),
);
const { Pool } = require("pg");
const RESTIC =
  "restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510";
const TAR =
  "node:24.22.1-bookworm-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d";
const digest = (s) => createHash("sha256").update(s).digest("hex");
export function command(args, input, environment = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", args, {
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (data) => chunks.push(data));
    // CLI errors may contain credentials or recovered world content. Keep them private.
    child.stderr.resume();
    child.on("error", () => reject(new Error("CONTAINER_COMMAND_FAILED")));
    child.on("close", (code) =>
      code === 0
        ? resolvePromise(Buffer.concat(chunks))
        : reject(new Error("CONTAINER_COMMAND_FAILED")),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export class BackupEngine {
  constructor(root = "/state", run = command) {
    this.root = resolve(root);
    this.run = run;
    this.busy = false;
    this.activation = Promise.resolve();
  }
  async initialize(recoverInterrupted = false) {
    this.env = parseEnv(
      await readFile(join(this.root, "deployment.env"), "utf8"),
    );
    this.project = this.env.STACK_NAME;
    if (
      !/^[a-z][a-z0-9-]{2,62}$/.test(this.project) ||
      this.project === "gestaloka-v3"
    )
      throw new Error("INVALID_DEPLOYMENT");
    this.env.CONFIG_ENV_FILE = join(this.root, "deployment.env");
    await mkdir(join(this.root, "jobs"), { recursive: true, mode: 0o700 });
    this.pool = new Pool({
      connectionString: `postgres://gestaloka:${this.env.POSTGRES_PASSWORD}@postgres:5432/gestaloka`,
    });
    this.pool.on("error", () => {});
    for (const name of await readdir(join(this.root, "jobs"))) {
      if (!name.endsWith(".json")) continue;
      const job = await this.load(`jobs/${name}`, null);
      if (recoverInterrupted && job.state === "running") {
        job.state = "failed";
        job.error = "CONTROLLER_INTERRUPTED";
        await this.save(`jobs/${name}`, job);
      }
    }
  }
  compose(...args) {
    return this.run(
      [
        "compose",
        "--project-name",
        this.project,
        "--env-file",
        join(this.root, "deployment.env"),
        "-f",
        "/app/infra/production/compose.yaml",
        ...args,
      ],
      undefined,
      { ...process.env, ...this.env },
    );
  }
  async save(name, value) {
    const file = join(this.root, name),
      temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, file);
  }
  async load(name, fallback) {
    try {
      return JSON.parse(await readFile(join(this.root, name), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  }
  encrypt(value) {
    return seal(
      this.env.CONTROL_TOKEN,
      "gestaloka.backups.v1",
      "settings",
      JSON.stringify(value),
    );
  }
  decrypt(value) {
    return JSON.parse(
      unseal(this.env.CONTROL_TOKEN, "gestaloka.backups.v1", "settings", value),
    );
  }
  async settings() {
    const row = await this.load("settings.json", null);
    return row
      ? { ...row, configuration: this.decrypt(row.cipher) }
      : { version: 0, configuration: null };
  }
  async read() {
    const { version, configuration } = await this.settings();
    return {
      version,
      configured: !!configuration,
      configuration: configuration
        ? {
            enabled: configuration.enabled,
            intervalHours: configuration.intervalHours,
            retentionDays: configuration.retentionDays,
            repository: configuration.repository,
            region: configuration.region,
          }
        : { enabled: false, intervalHours: 24, retentionDays: 30 },
      busy: this.busy,
    };
  }
  async job(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("INVALID_JOB");
    const job = await this.load(`jobs/${id}.json`, null);
    if (!job) throw new Error("JOB_NOT_FOUND");
    const publicJob = { ...job };
    delete publicJob.cipher;
    delete publicJob.hash;
    return { job: publicJob };
  }
  async jobs(before) {
    const items = [];
    for (const file of await readdir(join(this.root, "jobs"))) {
      if (!file.endsWith(".json")) continue;
      const { job } = await this.job(file.slice(0, -5));
      if (!before || `${job.createdAt}|${job.id}` < before) items.push(job);
    }
    items.sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
    const page = items.slice(0, 50),
      last = page.at(-1);
    return {
      items: page,
      next: items.length > 50 ? `${last.createdAt}|${last.id}` : null,
    };
  }
  async prepare({ id, actor, input, permission = null }, local = false) {
    input = Operation.parse(input);
    if (
      !/^backups\.(configure|create|restore)$/.test(input.operation) ||
      !/^[a-f0-9-]{36}$/.test(id)
    )
      throw new Error("INVALID_REQUEST");
    const hash = digest(JSON.stringify({ actor, input })),
      saved = await this.load(`jobs/${id}.json`, null);
    if (saved) {
      if (saved.hash !== hash) throw new Error("REQUEST_CONFLICT");
      if (saved.state === "prepared") {
        saved.permission = permission;
        await this.save(`jobs/${id}.json`, saved);
      }
      return { id };
    }
    const current = await this.settings();
    if (input.operation === "backups.configure") {
      if (input.expectedVersion !== current.version)
        throw new Error("SETTINGS_CHANGED");
      const c = BackupConfiguration.parse(input.configuration);
      if (
        this.env.DEPLOYMENT_MODE !== "testing" &&
        !c.repository.startsWith("s3:https://")
      )
        throw new Error("HTTPS_REQUIRED");
    } else if (!current.configuration)
      throw new Error("BACKUPS_NOT_CONFIGURED");
    await this.save(`jobs/${id}.json`, {
      id,
      actor,
      operation: input.operation,
      reason: input.reason,
      hash,
      cipher: this.encrypt(input),
      state: "prepared",
      phase: "受付",
      createdAt: new Date().toISOString(),
      local,
      permission,
    });
    return { id };
  }
  activate(id) {
    const activated = this.activation.then(() => this.#activate(id));
    this.activation = activated.catch(() => {});
    return activated;
  }
  async #activate(id) {
    const job = await this.load(`jobs/${id}.json`, null);
    if (!job) throw new Error("JOB_NOT_FOUND");
    if (job.state !== "prepared") return;
    if (!job.local) {
      const row = (
        await this.pool.query(
          "SELECT actor_id,result,error FROM operation_request WHERE id=$1 AND operation=$2",
          [id, job.operation],
        )
      ).rows[0];
      if (
        !row ||
        row.error ||
        row.result?.id !== id ||
        row.actor_id !== job.actor
      )
        return;
    }
    job.state = "queued";
    await this.save(`jobs/${id}.json`, job);
  }
  async restic(configuration, args) {
    const env = {
      ...process.env,
      RESTIC_REPOSITORY: configuration.repository,
      RESTIC_PASSWORD: configuration.password,
      AWS_ACCESS_KEY_ID: configuration.accessKey,
      AWS_SECRET_ACCESS_KEY: configuration.secretKey,
      AWS_DEFAULT_REGION: configuration.region,
    };
    return this.run(
      [
        "run",
        "--rm",
        "--network",
        `${this.project}_egress`,
        "--mount",
        `type=volume,source=${this.project}_controller-state,target=/state`,
        ...[
          "RESTIC_REPOSITORY",
          "RESTIC_PASSWORD",
          "AWS_ACCESS_KEY_ID",
          "AWS_SECRET_ACCESS_KEY",
          "AWS_DEFAULT_REGION",
        ].flatMap((v) => ["-e", v]),
        RESTIC,
        ...args,
      ],
      undefined,
      env,
    );
  }
  async snapshots(before) {
    const { configuration } = await this.settings();
    if (!configuration) throw new Error("BACKUPS_NOT_CONFIGURED");
    const items = JSON.parse(
      (
        await this.restic(configuration, [
          "snapshots",
          "--json",
          "--tag",
          "gestaloka",
        ])
      ).toString(),
    )
      .map((r) => ({ id: r.id, at: r.time, tags: r.tags }))
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    const remaining = before
      ? items.filter((r) => `${r.at}|${r.id}` < before)
      : items;
    const page = remaining.slice(0, 50),
      last = page.at(-1);
    return {
      items: page,
      next: remaining.length > 50 ? `${last.at}|${last.id}` : null,
    };
  }
  async step(job, phase) {
    job.phase = phase;
    await this.save(`jobs/${job.id}.json`, job);
  }
  async freeze(job) {
    await this.step(job, "実行中の応答を保存");
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const row = (
        await db.query(
          "SELECT configuration FROM runtime_control WHERE singleton FOR UPDATE",
        )
      ).rows[0];
      job.paused = row.configuration.paused;
      job.executions = (
        await db.query(
          "SELECT kind,id FROM runtime_execution WHERE state IN ('running','waiting')",
        )
      ).rows;
      await db.query(
        "UPDATE runtime_control SET configuration=jsonb_set(configuration,'{paused}','true'),version=version+1 WHERE singleton",
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    // Persist the previous state before stopping the API; the controller does not depend on it.
    job.quiesced = true;
    await this.step(job, "新規接続を停止");
    await this.compose("stop", "caddy", "api");
    await this.authorize(job);
    for (;;) {
      const { n } = (
        await this.pool
          .query(`SELECT count(*)::int AS n FROM runtime_execution r WHERE state IN ('running','waiting')
        AND (job_id IS NULL OR EXISTS(SELECT 1 FROM pgboss.job j WHERE j.id=r.job_id AND j.state='active'))`)
      ).rows[0];
      if (!n) break;
      await delay(1000);
    }
    await this.compose("stop", "worker", "kratos", "hydra", "neo4j");
    await this.step(job, "永続データを停止済み");
  }
  async archive(volume, file, restore = false) {
    const base = [
      "run",
      "--rm",
      "--network",
      "none",
      "--mount",
      `type=volume,source=${this.project}_${volume},target=/volume`,
      "--mount",
      `type=volume,source=${this.project}_controller-state,target=/state`,
      TAR,
    ];
    if (restore)
      await this.run([
        ...base,
        "sh",
        "-c",
        "find /volume -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xpf /state/staging/" +
          file +
          " -C /volume",
      ]);
    else
      await this.run([
        ...base,
        "tar",
        "cpf",
        `/state/staging/${file}`,
        "-C",
        "/volume",
        ".",
      ]);
  }
  async dump(service, user, database, file, restore = false) {
    const base = ["exec", "-T", service];
    if (restore) {
      await this.compose(
        ...base,
        "dropdb",
        "-U",
        user,
        "--if-exists",
        "--force",
        database,
      );
      await this.compose(...base, "createdb", "-U", user, database);
      const args = [
        "compose",
        "--project-name",
        this.project,
        "--env-file",
        join(this.root, "deployment.env"),
        "-f",
        "/app/infra/production/compose.yaml",
        ...base,
        "pg_restore",
        "-U",
        user,
        "--no-owner",
        "-d",
        database,
      ];
      await this.run(args, await readFile(join(this.root, "staging", file)), {
        ...process.env,
        ...this.env,
      });
    } else
      await writeFile(
        join(this.root, "staging", file),
        await this.compose(...base, "pg_dump", "-U", user, "-Fc", database),
        { mode: 0o600 },
      );
  }
  async capture(job) {
    await this.freeze(job);
    await mkdir(join(this.root, "staging"), { recursive: true, mode: 0o700 });
    for (const [service, user, database, file] of [
      ["postgres", "gestaloka", "gestaloka", "app.dump"],
      ["identity-postgres", "ory", "kratos", "kratos.dump"],
      ["identity-postgres", "ory", "hydra", "hydra.dump"],
    ])
      await this.dump(service, user, database, file);
    for (const volume of [
      "graph-data",
      "runtime-data",
      "caddy-data",
      "caddy-config",
    ])
      await this.archive(volume, `${volume}.tar`);
    await writeFile(
      join(this.root, "staging", "keys.json"),
      JSON.stringify(
        Object.fromEntries(
          [...keyNames, "NEO4J_PASSWORD"].map((k) => [k, this.env[k]]),
        ),
      ),
      { mode: 0o600 },
    );
    const files = {};
    for (const file of await readdir(join(this.root, "staging")))
      if (file !== "manifest.json")
        files[file] = digest(await readFile(join(this.root, "staging", file)));
    await writeFile(
      join(this.root, "staging", "manifest.json"),
      JSON.stringify({
        format: 1,
        id: job.id,
        stack: this.project,
        domain: this.env.ORY_KRATOS_PUBLIC_URL,
        at: new Date().toISOString(),
        paused: job.paused,
        executions: job.executions,
        files,
      }),
      { mode: 0o600 },
    );
  }
  async thaw(job, manifest = job) {
    await this.step(job, "サービスを再起動");
    // Recreated processes read restored encryption keys; networking and controller credentials stay local.
    await this.compose(
      "up",
      "-d",
      "--no-build",
      "--wait",
      "postgres",
      "identity-postgres",
      "neo4j",
      "kratos",
      "hydra",
      "api",
    );
    await this.pool.query(
      "UPDATE runtime_control SET configuration=jsonb_set(configuration,'{paused}',$1::jsonb),version=version+1 WHERE singleton",
      [JSON.stringify(manifest.paused ?? true)],
    );
    await this.compose("up", "-d", "--no-build", "worker", "caddy");
    if (!manifest.paused && manifest.executions?.length)
      await this.compose(
        "exec",
        "-T",
        "api",
        "node",
        "infra/production/resume.mjs",
        JSON.stringify(manifest.executions),
      );
    job.quiesced = false;
    await this.step(job, "サービスを再開済み");
  }
  async restore(job, configuration, snapshot) {
    await this.step(job, "暗号化データを取得・検証");
    await this.restic(configuration, [
      "restore",
      snapshot,
      "--target",
      "/state/restore",
      "--verify",
    ]);
    const recovered = join(this.root, "restore/state/staging");
    const manifest = JSON.parse(
      await readFile(join(recovered, "manifest.json"), "utf8"),
    );
    const expected = [
      "app.dump",
      "kratos.dump",
      "hydra.dump",
      "graph-data.tar",
      "runtime-data.tar",
      "caddy-data.tar",
      "caddy-config.tar",
      "keys.json",
    ];
    if (
      manifest.format !== 1 ||
      Object.keys(manifest.files).sort().join() !== expected.sort().join()
    )
      throw new Error("INVALID_BACKUP");
    for (const file of expected)
      if (
        digest(await readFile(join(recovered, file))) !== manifest.files[file]
      )
        throw new Error("BACKUP_CHECKSUM_FAILED");
    await this.freeze(job);
    await this.pool.end();
    await rm(join(this.root, "staging"), { recursive: true, force: true });
    await rename(recovered, join(this.root, "staging"));
    for (const [service, user, database, file] of [
      ["postgres", "gestaloka", "gestaloka", "app.dump"],
      ["identity-postgres", "ory", "kratos", "kratos.dump"],
      ["identity-postgres", "ory", "hydra", "hydra.dump"],
    ])
      await this.dump(service, user, database, file, true);
    for (const volume of ["graph-data", "runtime-data"])
      await this.archive(volume, `${volume}.tar`, true);
    if (manifest.domain === this.env.ORY_KRATOS_PUBLIC_URL)
      for (const volume of ["caddy-data", "caddy-config"])
        await this.archive(volume, `${volume}.tar`, true);
    const keys = JSON.parse(
      await readFile(join(this.root, "staging/keys.json"), "utf8"),
    );
    for (const key of [...keyNames, "NEO4J_PASSWORD"]) {
      if (!/^[a-f0-9]{32,64}$/.test(keys[key] ?? ""))
        throw new Error("INVALID_BACKUP_KEYS");
      this.env[key] = keys[key];
    }
    await writeFile(
      join(this.root, "deployment.env"),
      Object.entries(this.env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    await renderDeployment(this.root);
    await this.run([
      "cp",
      `${this.root}/configuration/.`,
      `${await this.container("controller")}:/configuration`,
    ]);
    await this.compose(
      "run",
      "--rm",
      "--no-deps",
      "--entrypoint",
      "sh",
      "controller",
      "-c",
      "chown -R 1000:1000 /configuration/ory && chmod -R go-rwx /configuration/ory && chmod 755 /configuration/init && chmod 644 /configuration/init/*",
    );
    this.pool = new Pool({
      connectionString: `postgres://gestaloka:${this.env.POSTGRES_PASSWORD}@postgres:5432/gestaloka`,
    });
    this.pool.on("error", () => {});
    await this.thaw(job, manifest);
    await rm(join(this.root, "restore"), { recursive: true, force: true });
    await rm(join(this.root, "staging"), { recursive: true, force: true });
    for (const file of await readdir(join(this.root, "jobs"))) {
      if (!file.endsWith(".json")) continue;
      const older = await this.load(`jobs/${file}`, null);
      if (older.state === "failed" && older.quiesced) {
        older.quiesced = false;
        older.recoveredBy = job.id;
        await this.save(`jobs/${file}`, older);
      }
    }
  }
  async container(service) {
    return (await this.compose("ps", "-aq", service)).toString().trim();
  }
  async authorize(job) {
    if (!job.local) {
      const actor = (
        await this.pool.query("SELECT role,banned FROM app_user WHERE id=$1", [
          job.actor,
        ])
      ).rows[0];
      if (!actor || actor.role !== "admin" || actor.banned)
        throw new Error("ADMIN_REQUIRED");
      if (job.permission) {
        const g = (
          await this.pool.query(
            `SELECT g.scopes,g.world_ids,g.revoked,c.configuration FROM mcp_grant g JOIN mcp_client c ON c.id=g.client_id WHERE g.id=$1 AND g.user_id=$2`,
            [job.permission.grantId, job.actor],
          )
        ).rows[0];
        if (
          !g ||
          g.revoked ||
          !g.configuration.enabled ||
          !g.scopes.includes(job.operation) ||
          !g.configuration.scopes.includes(job.operation) ||
          g.world_ids !== null ||
          g.configuration.worldIds !== null
        )
          throw new Error("MCP_AUTH_REVOKED");
      }
    }
  }
  async process(job) {
    await this.authorize(job);
    const input = this.decrypt(job.cipher);
    if (input.operation === "backups.configure") {
      const current = await this.settings();
      if (input.expectedVersion !== current.version)
        throw new Error("SETTINGS_CHANGED");
      await this.save("settings.json", {
        version: current.version + 1,
        cipher: this.encrypt(input.configuration),
        lastAt: current.lastAt ?? null,
        lastScheduledAt: current.lastScheduledAt ?? null,
      });
      return;
    }
    const settings = await this.settings(),
      configuration = settings.configuration;
    if (input.operation === "backups.restore")
      return this.restore(job, configuration, input.snapshot);
    try {
      await this.restic(configuration, ["snapshots", "--json"]);
    } catch {
      await this.restic(configuration, ["init"]);
    }
    const existing = JSON.parse(
      (
        await this.restic(configuration, [
          "snapshots",
          "--json",
          "--tag",
          `operation:${job.id}`,
        ])
      ).toString(),
    );
    if (!existing.length) {
      await this.capture(job);
      await this.thaw(job);
      await this.step(job, "暗号化して送信");
      await this.restic(configuration, [
        "backup",
        "/state/staging",
        "--host",
        this.project,
        "--tag",
        "gestaloka",
        "--tag",
        `operation:${job.id}`,
      ]);
    }
    await this.step(job, "保持期間を適用・保管データを検証");
    await this.restic(configuration, [
      "forget",
      "--prune",
      "--tag",
      "gestaloka",
      "--host",
      this.project,
      "--group-by",
      "host,paths",
      "--keep-within",
      `${configuration.retentionDays}d`,
    ]);
    await this.restic(configuration, ["check"]);
    await this.save("settings.json", {
      version: settings.version,
      cipher: settings.cipher,
      lastAt: new Date().toISOString(),
      lastScheduledAt: settings.lastScheduledAt ?? null,
    });
    await rm(join(this.root, "staging"), { recursive: true, force: true });
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const settings = await this.settings();
      let blocked = false;
      for (const name of await readdir(join(this.root, "jobs"))) {
        if (!name.endsWith(".json")) continue;
        const j = await this.load(`jobs/${name}`, null);
        if (j.quiesced && j.state === "failed") blocked = true;
      }
      if (
        !blocked &&
        settings.configuration?.enabled &&
        (!settings.lastScheduledAt ||
          Date.now() - Date.parse(settings.lastScheduledAt) >=
            settings.configuration.intervalHours * 3600000)
      ) {
        const jobs = await readdir(join(this.root, "jobs"));
        let scheduled = false;
        for (const name of jobs.filter((f) => f.endsWith(".json"))) {
          const j = await this.load(`jobs/${name}`, null);
          if (j.local && ["queued", "running"].includes(j.state))
            scheduled = true;
        }
        if (!scheduled) {
          const id = randomUUID();
          await this.prepare(
            {
              id,
              actor: null,
              input: { operation: "backups.create", reason: "定期取得" },
            },
            true,
          );
          await this.activate(id);
          await this.save("settings.json", {
            version: settings.version,
            cipher: settings.cipher,
            lastAt: settings.lastAt ?? null,
            lastScheduledAt: new Date().toISOString(),
          });
        }
      }
      for (const file of (await readdir(join(this.root, "jobs")))
        .filter((f) => f.endsWith(".json"))
        .sort()) {
        const job = await this.load(`jobs/${file}`, null);
        if (job.state === "prepared") await this.activate(job.id);
        const current = await this.load(`jobs/${file}`, null);
        if (current.state !== "queued") continue;
        if (
          blocked &&
          !["backups.restore", "backups.configure"].includes(current.operation)
        )
          continue;
        current.state = "running";
        await this.step(current, "開始");
        try {
          await this.process(current);
          current.state = "complete";
          current.phase = "完了";
        } catch {
          current.state = "failed";
          current.error = "BACKUP_OPERATION_FAILED";
          current.phase = "復旧手順を確認してください";
        }
        current.finishedAt = new Date().toISOString();
        await this.save(`jobs/${file}`, current);
      }
    } finally {
      this.busy = false;
    }
  }
}
