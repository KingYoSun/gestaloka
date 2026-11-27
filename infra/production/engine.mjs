import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import {
  mkdir,
  open,
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
import { configuredApi, keyNames, renderDeployment } from "./config.mjs";
import { Withdrawals } from "./withdrawal.mjs";

const require = createRequire(
  new URL("../../packages/server/package.json", import.meta.url),
);
const { Pool } = require("pg");
const RESTIC =
  "restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510";
const TAR =
  "node:24.22.1-bookworm-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d";
const resumableServices = ["worker", "caddy"];
const digest = (s) => createHash("sha256").update(s).digest("hex");
async function fileDigest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export function command(
  args,
  input,
  environment = process.env,
  { stdinFd, stdoutFd } = {},
) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", args, {
      env: environment,
      stdio: [stdinFd ?? "pipe", stdoutFd ?? "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout?.on("data", (data) => chunks.push(data));
    // CLI errors may contain credentials or recovered world content. Keep them private.
    child.stderr.resume();
    child.on("error", () => reject(new Error("CONTAINER_COMMAND_FAILED")));
    child.on("close", (code) =>
      code === 0
        ? resolvePromise(Buffer.concat(chunks))
        : reject(new Error("CONTAINER_COMMAND_FAILED")),
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}
export async function deploymentLock(file, seconds = 0) {
  const lock = await open(file, "r");
  let acquired;
  try {
    // flock uses the inherited file description, which stays open in Node.
    acquired = await new Promise((resolvePromise, reject) => {
      const child = spawn("flock", ["-w", String(seconds), "-E", "75", "3"], {
        stdio: ["ignore", "ignore", "ignore", lock.fd],
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0 || code === 75) resolvePromise(code === 0);
        else reject(new Error("DEPLOYMENT_LOCK_FAILED"));
      });
    });
    if (acquired) return lock;
  } finally {
    if (!acquired) await lock.close();
  }
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
    this.withdrawals = new Withdrawals(this);
    for (const name of await readdir(join(this.root, "jobs"))) {
      if (!name.endsWith(".json")) continue;
      const job = await this.load(`jobs/${name}`, null);
      if (recoverInterrupted && job.state === "running") {
        job.state = "failed";
        job.error = "CONTROLLER_INTERRUPTED";
        await this.save(`jobs/${name}`, job);
      }
      if (
        job.operation === "backups.configure" &&
        job.cipher &&
        ["complete", "failed"].includes(job.state)
      ) {
        delete job.cipher;
        await this.save(`jobs/${name}`, job);
      }
    }
  }
  compose(...args) {
    return this.#compose(args);
  }
  #compose(args, stdio) {
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
      stdio,
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
        c.repository !== "local" &&
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
    const local = configuration.repository === "local";
    const settings = {
      RESTIC_REPOSITORY: local ? "/state/repository" : configuration.repository,
      RESTIC_PASSWORD: configuration.password,
      ...(local
        ? {}
        : {
            AWS_ACCESS_KEY_ID: configuration.accessKey,
            AWS_SECRET_ACCESS_KEY: configuration.secretKey,
            AWS_DEFAULT_REGION: configuration.region,
          }),
    };
    return this.run(
      [
        "run",
        "--rm",
        "--network",
        local ? "none" : `${this.project}_egress`,
        "--mount",
        `type=volume,source=${this.project}_controller-state,target=/state`,
        ...Object.keys(settings).flatMap((v) => ["-e", v]),
        RESTIC,
        ...args,
      ],
      undefined,
      { ...process.env, ...settings },
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
  async expireSnapshots(configuration, now = Date.now(), authority) {
    const snapshots = JSON.parse(
      (
        await this.restic(configuration, [
          "snapshots",
          "--json",
          "--host",
          this.project,
          "--tag",
          "gestaloka",
        ])
      ).toString(),
    );
    const deadlines = authority
      ? await this.withdrawals.deadlines(
          authority,
          snapshots.map((s) => s.time),
        )
      : [];
    const lifetime = configuration.retentionDays * 86400000;
    let oldest = Infinity,
      next = now + 3600000;
    const expired = snapshots.filter((s, i) => {
      const acquired = Date.parse(s.time);
      const deadline = Math.min(
        acquired + lifetime,
        deadlines[i] ? Date.parse(deadlines[i]) : Infinity,
      );
      if (deadline <= now) return true;
      oldest = Math.min(oldest, acquired);
      next = Math.min(next, deadline);
      return false;
    });
    const marker = "expiry-" + digest(configuration.repository) + ".json";
    if (expired.length) {
      // If interrupted between forget and prune, finish removing unreachable data.
      await this.save(marker, true);
      for (let i = 0; i < expired.length; i += 100)
        await this.restic(configuration, [
          "forget",
          ...expired.slice(i, i + 100).map((s) => s.id),
        ]);
    }
    if (await this.load(marker, false)) {
      await this.restic(configuration, ["prune"]);
      await rm(join(this.root, marker));
    }
    return { oldest, next };
  }
  async enforceRetention(configuration, authority) {
    const previous = await this.load("previous-repositories.json", {});
    const activeKey = configuration && digest(configuration.repository);
    if (activeKey && Object.hasOwn(previous, activeKey)) {
      delete previous[activeKey];
      await this.save("previous-repositories.json", previous);
    }
    let oldest = Infinity,
      next = Date.now() + 3600000,
      unavailable = false;
    const repositories = Object.entries(previous).map(([key, cipher]) => [
      key,
      this.decrypt(cipher),
    ]);
    if (configuration) repositories.push([null, configuration]);
    for (const [key, repo] of repositories) {
      try {
        const result = await this.expireSnapshots(repo, Date.now(), authority);
        oldest = Math.min(oldest, result.oldest);
        next = Math.min(next, result.next);
        if (key && result.oldest === Infinity) {
          delete previous[key];
          await this.save("previous-repositories.json", previous);
        }
      } catch {
        unavailable = true;
      }
    }
    if (unavailable) throw new Error("RETENTION_STORAGE_UNAVAILABLE");
    await this.withdrawals.finish(
      authority,
      Number.isFinite(oldest) ? new Date(oldest) : null,
    );
    return next;
  }
  async step(job, phase) {
    job.phase = phase;
    await this.save(`jobs/${job.id}.json`, job);
  }
  async freeze(job) {
    const running = (
      await this.compose(
        "ps",
        "--status",
        "running",
        "--services",
        ...resumableServices,
      )
    )
      .toString()
      .split(/\s+/);
    job.resumeServices = resumableServices.filter((service) =>
      running.includes(service),
    );
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
        "UPDATE runtime_control SET configuration=jsonb_set(configuration - 'worldEditsUntil','{paused}','true'),version=version+1 WHERE singleton",
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
    await this.compose(
      "--profile",
      "api-handoff",
      "stop",
      "caddy",
      "api",
      "api-next",
    );
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
    const data = await open(
      join(this.root, "staging", file),
      restore ? "r" : "w",
      0o600,
    );
    try {
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
        await this.#compose(
          [...base, "pg_restore", "-U", user, "--no-owner", "-d", database],
          { stdinFd: data.fd },
        );
      } else
        await this.#compose([...base, "pg_dump", "-U", user, "-Fc", database], {
          stdoutFd: data.fd,
        });
    } finally {
      await data.close();
    }
  }
  async capture(job) {
    const withdrawalAuthority = await this.withdrawals.authority(
      this.env.OPERATIONS_TOKEN_SECRET,
      true,
    );
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
        files[file] = await fileDigest(join(this.root, "staging", file));
    await writeFile(
      join(this.root, "staging", "manifest.json"),
      JSON.stringify({
        format: 1,
        withdrawalAuthority,
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
  async activeApi() {
    return configuredApi(
      await readFile("/configuration/public/Caddyfile", "utf8"),
      (file) => readFile(join("/configuration/public", file), "utf8"),
    );
  }
  async thaw(job, manifest = job, checkedAuthority) {
    if (job.operation === "backups.restore" && !checkedAuthority)
      return this.withdrawals.checkRestore(
        this.env.OPERATIONS_TOKEN_SECRET,
        manifest,
        (authority) => this.thaw(job, manifest, authority),
      );
    const paused = job.paused || (manifest.paused ?? true);
    const api = await this.activeApi();
    await this.step(job, "サービスを再起動");
    // Recreated processes read restored encryption keys; networking and controller credentials stay local.
    await this.compose(
      "--profile",
      "api-handoff",
      "up",
      "-d",
      "--no-build",
      "--wait",
      "postgres",
      "identity-postgres",
      "neo4j",
      "kratos",
      "hydra",
      api,
    );
    if (checkedAuthority) {
      await this.step(job, "公開前に退会台帳を再適用");
      await this.withdrawals.apply(checkedAuthority, true);
      await rm(join(this.root, "withdrawal-restore-pending.json"), {
        force: true,
      });
    }
    await this.pool.query(
      "UPDATE runtime_control SET configuration=jsonb_set(configuration - 'worldEditsUntil','{paused}',$1::jsonb),version=version+1 WHERE singleton",
      [JSON.stringify(paused)],
    );
    const services = job.resumeServices ?? resumableServices;
    if (services.length)
      await this.compose("up", "-d", "--no-build", ...services);
    if (!paused && services.includes("worker") && manifest.executions?.length)
      await this.compose(
        "--profile",
        "api-handoff",
        "exec",
        "-T",
        api,
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
      if ((await fileDigest(join(recovered, file))) !== manifest.files[file])
        throw new Error("BACKUP_CHECKSUM_FAILED");
    const keys = JSON.parse(
      await readFile(join(recovered, "keys.json"), "utf8"),
    );
    try {
      await this.withdrawals.checkRestore(
        keys.OPERATIONS_TOKEN_SECRET,
        manifest,
      );
    } catch (error) {
      await rm(join(this.root, "restore"), { recursive: true, force: true });
      throw error;
    }
    await this.freeze(job);
    await this.pool.end();
    await this.save("withdrawal-restore-pending.json", { job: job.id });
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
      if (
        current.configuration?.repository !== input.configuration.repository
      ) {
        const previous = await this.load("previous-repositories.json", {});
        if (current.configuration)
          previous[digest(current.configuration.repository)] = current.cipher;
        // Persist the previous credentials before replacing the active configuration.
        await this.save("previous-repositories.json", previous);
      }
      await this.save("settings.json", {
        version: current.version + 1,
        cipher: this.encrypt(input.configuration),
        lastAt: current.lastAt ?? null,
        lastScheduledAt: current.lastScheduledAt ?? null,
      });
      this.nextExpiry = 0;
      const previous = await this.load("previous-repositories.json", {});
      delete previous[digest(input.configuration.repository)];
      await this.save("previous-repositories.json", previous);
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
    await this.step(job, "保管データを検証");
    await this.restic(configuration, ["check"]);
    await this.save("settings.json", {
      version: settings.version,
      cipher: settings.cipher,
      lastAt: new Date().toISOString(),
      lastScheduledAt: settings.lastScheduledAt ?? null,
    });
    await rm(join(this.root, "staging"), { recursive: true, force: true });
  }
  async maintain() {
    if (
      Date.now() >= Math.min(this.nextExpiry ?? 0, this.nextWithdrawal ?? 0)
    ) {
      const lock = await deploymentLock("/deploy.lock");
      if (lock) {
        try {
          const authority = await this.withdrawals.authority(
            this.env.OPERATIONS_TOKEN_SECRET,
            true,
          );
          if (Date.now() >= (this.nextWithdrawal ?? 0)) {
            this.nextWithdrawal = Date.now() + 60000;
            await this.withdrawals.apply(authority);
          }
          if (Date.now() >= (this.nextExpiry ?? 0)) {
            this.nextExpiry = Date.now() + 60000;
            this.nextExpiry = await this.enforceRetention(
              (await this.settings()).configuration,
              authority,
            );
          }
        } finally {
          await lock.close();
        }
      }
    }
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
        const lock =
          current.operation === "backups.configure"
            ? null
            : await deploymentLock("/deploy.lock");
        if (lock === undefined) continue;
        try {
          current.state = "running";
          await this.step(current, "開始");
          try {
            await this.process(current);
            current.state = "complete";
            current.phase = "完了";
          } catch (error) {
            current.state = "failed";
            current.error = "BACKUP_OPERATION_FAILED";
            const code = String(error.code ?? error.message);
            console.log(
              "復旧処理を中断",
              current.phase,
              /^[A-Z0-9_]{3,64}$/.test(code) ? code : "OPERATION_FAILED",
            );
            current.phase = "復旧手順を確認してください";
          }
          current.finishedAt = new Date().toISOString();
          if (current.operation === "backups.configure") delete current.cipher;
          await this.save(`jobs/${file}`, current);
        } finally {
          await lock?.close();
        }
      }
      if (!blocked) await this.maintain();
    } finally {
      this.busy = false;
    }
  }
}
