import { RuntimeMonitor } from "../runtime/monitor.js";
import { Backups } from "../runtime/backups.js";
import { McpAuthorization, type McpPrincipal } from "./mcp.js";
import { McpOrigin, type McpPermission } from "./mcp-origin.js";
import { WorldManagement } from "./world-management.js";
import { seal } from "../secrets.js";
import { readJobs, resumeJob } from "../runtime/jobs.js";
import { RuntimeControl, RuntimeStopped } from "../runtime/control.js";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { AccessError, WorldAccess } from "./access.js";
import type { WorldPlayers } from "../runtime/players.js";
import { ModelLimits } from "../llm/limits.js";
import { WorldBudget } from "../llm/world-budget.js";
import { ExecutionBudget } from "../execution-budget.js";
import { ModelSettings, ModelCheckFailed } from "../llm/settings.js";
import { readCosts } from "../llm/costs.js";
import { InspectionStore } from "../inspection/store.js";
import {
  inspectionHistory,
  inspectionSettings,
  configureInspection,
} from "../inspection/history.js";

import {
  Member,
  Operation,
  LegacyClaimPage,
  WorldCatalogPage,
  PlayerPresetPage,
} from "@gestaloka/contracts";

type Input = z.infer<typeof Operation>;
type UserRow = {
  id: string;
  role: "admin" | "user";
  banned: boolean;
  created_at: Date;
};
const member = (row: UserRow) =>
  Member.parse({ ...row, createdAt: row.created_at.toISOString() });
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Database = Pick<pg.Pool, "query">;
type Context = {
  continuation?: McpPermission | null;
  mcp?: McpPrincipal;
  legacyToken?: string | undefined;
  players?: WorldPlayers | undefined;
};

export async function requireMember(
  database: Database,
  userId: string,
  admin = false,
) {
  const row = (
    await database.query<UserRow>(
      "SELECT * FROM app_user WHERE id=$1 FOR SHARE",
      [userId],
    )
  ).rows[0];
  if (!row)
    throw new AccessError(403, "REGISTRATION_REQUIRED", "利用登録が必要です");
  if (row.banned)
    throw new AccessError(403, "USER_BANNED", "利用が停止されています");
  if (admin && row.role !== "admin")
    throw new AccessError(403, "ADMIN_REQUIRED", "管理者の権限が必要です");
  return member(row);
}

/** Shared by HTTP, local recovery, and the later MCP adapter. */
export class Operations {
  readonly mcp: McpAuthorization;
  readonly backups = new Backups();
  readonly models: ModelSettings;
  constructor(
    readonly pool: pg.Pool,
    readonly tokenSecret: string,
    transport: typeof fetch = fetch,
    mcpOptions: ConstructorParameters<typeof McpAuthorization>[1] = {},
  ) {
    if (!/^[a-f0-9]{64}$/.test(tokenSecret))
      throw new Error(
        "OPERATIONS_TOKEN_SECRETを設定してください（pnpm auth:init）",
      );
    this.models = new ModelSettings(pool, tokenSecret, transport);
    this.mcp = new McpAuthorization(pool, mcpOptions);
  }
  async setup() {
    await ModelSettings.setup(this.pool);
    await ModelLimits.setup(this.pool);
    await ExecutionBudget.setup(this.pool);
    await RuntimeMonitor.setup(this.pool);
    await WorldBudget.setup(this.pool);
    await InspectionStore.setup(this.pool);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS app_user (
      id uuid PRIMARY KEY REFERENCES app_identity(id),role text NOT NULL CHECK(role IN ('admin','user')),
      banned boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS operation_state (singleton boolean PRIMARY KEY CHECK(singleton),
        bootstrapped boolean NOT NULL DEFAULT false,invite_required boolean NOT NULL DEFAULT true);
      INSERT INTO operation_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS app_invite (id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL,
        expires_at timestamptz NOT NULL,max_uses bigint NOT NULL CHECK(max_uses>0),uses bigint NOT NULL DEFAULT 0,
        revoked boolean NOT NULL DEFAULT false,created_by uuid NOT NULL REFERENCES app_user(id),created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS invite_use(invite_id uuid NOT NULL REFERENCES app_invite(id),user_id uuid NOT NULL REFERENCES app_user(id),
        used_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(invite_id,user_id));
      CREATE TABLE IF NOT EXISTS operation_request(id uuid PRIMARY KEY,actor_id uuid REFERENCES app_identity(id),
        operation text NOT NULL,input_hash text NOT NULL,result jsonb,error jsonb,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS operation_audit(id bigserial PRIMARY KEY,request_id uuid NOT NULL REFERENCES operation_request(id),
        actor_id uuid REFERENCES app_identity(id),operation text NOT NULL,outcome text NOT NULL,details jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS operation_audit_request ON operation_audit(request_id,id);`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS player_preset (
      id uuid PRIMARY KEY,title text NOT NULL,description text NOT NULL,settings text NOT NULL,
      version integer NOT NULL DEFAULT 1,updated_by uuid NOT NULL REFERENCES app_identity(id),updated_at timestamptz NOT NULL DEFAULT now());`);
  }
  async state(userId: string) {
    const user = (
      await this.pool.query<UserRow>("SELECT * FROM app_user WHERE id=$1", [
        userId,
      ])
    ).rows[0];
    const state = (
      await this.pool.query<{
        bootstrapped: boolean;
        invite_required: boolean;
      }>("SELECT * FROM operation_state WHERE singleton")
    ).rows[0]!;
    return {
      member: user ? member(user) : null,
      inviteRequired: state.invite_required,
      bootstrapAvailable: !state.bootstrapped,
    };
  }
  async catalog(userId: string, before?: string, worldId?: string) {
    await this.authorize(userId);
    const rows = (
      await this.pool.query(
        `SELECT c.id,c.public_title AS title,c.public_description AS description,c.accepting,
      c.accepting AND c.published AND c.world_id IS NOT NULL AND c.state IN ('finished','playing','play_paused') AS "canJoin"
      FROM world_construction c WHERE ($2::uuid IS NULL OR c.id<$2) AND ($3::uuid IS NULL OR c.id=$3)
      AND (c.published OR EXISTS (SELECT 1 FROM world_access a JOIN world_subject s ON s.id=a.subject_id
        WHERE a.construction_id=c.id AND a.role='player' AND s.active AND s.user_id=$1))
      ORDER BY c.id DESC LIMIT 51`,
        [userId, before ?? null, worldId ?? null],
      )
    ).rows;
    return WorldCatalogPage.parse({
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49]!.id : null,
    });
  }
  async presets(userId: string, before?: string) {
    await this.authorize(userId);
    const rows = (
      await this.pool.query(
        "SELECT id,title,description,version FROM player_preset WHERE ($1::uuid IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",
        [before ?? null],
      )
    ).rows;
    return PlayerPresetPage.parse({
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49]!.id : null,
    });
  }
  async authorize(
    userId: string,
    admin = false,
    database: Database = this.pool,
  ) {
    return requireMember(database, userId, admin);
  }
  #token(id: string) {
    return `${id}.${createHmac("sha256", this.tokenSecret).update(`invite:${id}`).digest("base64url")}`;
  }
  async #legacySource(
    userId: string,
    token: string | undefined,
    db: Database,
    lock = false,
  ) {
    const source = token
      ? (
          await db.query<{ id: string; user_id: string | null }>(
            `SELECT id,user_id FROM world_subject WHERE token_hash=$1 AND active${lock ? " FOR UPDATE" : ""}`,
            [hash(token)],
          )
        ).rows[0]
      : undefined;
    if (!source)
      throw new AccessError(
        401,
        "LEGACY_COOKIE_REQUIRED",
        "このブラウザーで引き継げるデータが見つかりません",
      );
    if (source.user_id && source.user_id !== userId)
      throw new AccessError(
        403,
        "LEGACY_ALREADY_CLAIMED",
        "このデータは別のユーザーへ引き継ぎ済みです",
      );
    return source;
  }
  async #legacySnapshot(id: string, db: Database) {
    const row = (
      await db.query<{ total: string; version: string }>(
        `SELECT count(DISTINCT construction_id)::text AS total,
        md5($1::text||coalesce(string_agg(construction_id::text||':'||role||':'||coalesce(actor_id::text,''),',' ORDER BY construction_id,role),'')) AS version
        FROM world_access WHERE subject_id=$1::uuid`,
        [id],
      )
    ).rows[0]!;
    return { total: Number(row.total), version: row.version };
  }
  async legacyPreview(userId: string, token?: string, before?: string) {
    await this.authorize(userId);
    const source = await this.#legacySource(userId, token, this.pool);
    const snapshot = await this.#legacySnapshot(source.id, this.pool);
    const rows = (
      await this.pool.query<{
        id: string;
        prompt: string;
        actorId: string | null;
      }>(
        `SELECT a.construction_id AS id,b.initial_prompt AS prompt,max(a.actor_id::text)::uuid AS "actorId"
       FROM world_access a JOIN world_build b ON b.run_id=a.construction_id
       WHERE a.subject_id=$1 AND ($2::uuid IS NULL OR a.construction_id<$2)
       GROUP BY a.construction_id,b.initial_prompt ORDER BY a.construction_id DESC LIMIT 51`,
        [source.id, before ? z.uuid().parse(before) : null],
      )
    ).rows;
    return LegacyClaimPage.parse({
      subjectId: source.id,
      linked: source.user_id === userId,
      ...snapshot,
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49]!.id : null,
    });
  }
  async execute(
    actor: string,
    requestId: string,
    input: Input,
    context: Context = {},
  ) {
    return McpOrigin.run(
      context.mcp
        ? { grantId: context.mcp.grantId, scope: input.operation }
        : (context.continuation ?? null),
      () =>
        this.#execute(
          z.uuid().parse(actor),
          requestId,
          Operation.parse(input),
          context,
        ),
    );
  }
  async recover(userId: string, requestId: string, reason: string) {
    return this.#execute(null, z.uuid().parse(requestId), {
      operation: "recovery.admin",
      userId: z.uuid().parse(userId),
      reason: z.string().trim().min(1).parse(reason),
    });
  }
  async #execute(
    actor: string | null,
    requestId: string,
    input:
      Input | { operation: "recovery.admin"; userId: string; reason: string },
    context: Context = {},
  ) {
    z.uuid().parse(requestId);
    const digest = hash(JSON.stringify(input));
    await this.pool.query(
      "INSERT INTO operation_request(id,actor_id,operation,input_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [requestId, actor, input.operation, digest],
    );
    let preflightError: AccessError | undefined;
    let dependencies:
      | { configurationVersion?: number; credentials: Record<string, number> }
      | undefined;
    if (
      actor &&
      (input.operation === "models.put" ||
        input.operation === "credentials.put") &&
      !(
        await this.pool.query(
          "SELECT id FROM operation_request WHERE id=$1 AND actor_id=$2 AND (result IS NOT NULL OR error IS NOT NULL)",
          [requestId, actor],
        )
      ).rowCount
    ) {
      try {
        await this.authorize(actor, true);
        await this.#mcpCheck(this.pool, actor, input, context);
        if (input.operation === "models.put")
          dependencies = {
            credentials: await this.models.verify(input.configuration),
          };
        else {
          const current = await this.models.latest();
          dependencies = {
            configurationVersion: current?.version ?? 0,
            credentials: {},
          };
          if (
            current &&
            [
              current.configuration.default.provider,
              current.configuration.resolution.provider,
            ].includes(input.provider)
          )
            await this.models.verify(current.configuration, input);
        }
      } catch (error) {
        preflightError =
          error instanceof AccessError
            ? error
            : new AccessError(
                409,
                "MODEL_CHECK_FAILED",
                error instanceof ModelCheckFailed
                  ? error.message
                  : "モデル設定または接続を確認できません",
              );
      }
    }
    const database = await this.pool.connect();
    let result: Record<string, unknown> = {},
      failure: AccessError | undefined;
    try {
      await database.query("BEGIN");
      await database.query(
        "SELECT singleton FROM operation_state WHERE singleton FOR UPDATE",
      );
      const saved = (
        await database.query<{
          actor_id: string | null;
          input_hash: string;
          result: Record<string, unknown> | null;
          error: {
            status: 403 | 404 | 409;
            code: string;
            message: string;
          } | null;
        }>("SELECT * FROM operation_request WHERE id=$1", [requestId])
      ).rows[0];
      const completed =
        !!saved && (saved.result !== null || saved.error !== null);
      if (saved && (saved.actor_id !== actor || saved.input_hash !== digest)) {
        await this.#audit(
          database,
          actor,
          requestId,
          input.operation,
          "conflict",
          {},
        );
        await database.query("COMMIT");
        throw new AccessError(
          409,
          "REQUEST_CONFLICT",
          "同じ要求IDに異なる内容は使用できません",
        );
      }
      await database.query("SAVEPOINT operation");
      try {
        if (actor && input.operation !== "account.register")
          await this.authorize(
            actor,
            !["account.claim", "worlds.join", "worlds.resumeJoin"].includes(
              input.operation,
            ),
            database,
          );
        if (actor) await this.#mcpCheck(database, actor, input, context, true);
        if (actor && input.operation === "account.register") {
          const current = (
            await database.query<UserRow>(
              "SELECT * FROM app_user WHERE id=$1",
              [actor],
            )
          ).rows[0];
          if (current?.banned)
            throw new AccessError(403, "USER_BANNED", "利用が停止されています");
        }
        if (completed) {
          if (saved.error)
            throw new AccessError(
              saved.error.status,
              saved.error.code,
              saved.error.message,
            );
          result = saved!.result!;
        } else if (preflightError) throw preflightError;
        else {
          if (
            dependencies &&
            !(await this.models.unchanged(database, dependencies))
          )
            throw new AccessError(
              409,
              "SETTINGS_CHANGED",
              "接続確認中に設定が変わりました。現在の設定を読み直してください",
            );
          result = await this.#perform(
            database,
            actor,
            input,
            context,
            requestId,
          );
        }
      } catch (error) {
        if (
          !(error instanceof AccessError) &&
          !(error instanceof RuntimeStopped)
        )
          throw error;
        await database.query("ROLLBACK TO SAVEPOINT operation");
        failure =
          error instanceof RuntimeStopped
            ? new AccessError(409, error.code, error.message)
            : error;
      }
      const retryableFailure =
        !!failure &&
        ([401, 403, 503].includes(failure.status) ||
          [
            "MAINTENANCE",
            "USER_BANNED",
            "AUTHORITY_LOST",
            "MCP_AUTH_REVOKED",
          ].includes(failure.code));
      if (!completed)
        await database.query(
          "UPDATE operation_request SET result=$2,error=$3 WHERE id=$1",
          [
            requestId,
            failure ? null : JSON.stringify(result),
            failure && !retryableFailure
              ? JSON.stringify({
                  status: failure.status,
                  code: failure.code,
                  message: failure.message,
                })
              : null,
          ],
        );
      await this.#audit(
        database,
        actor,
        requestId,
        input.operation,
        failure ? "denied" : completed ? "replayed" : "accepted",
        {
          ...(context.mcp
            ? { clientId: context.mcp.clientId, grantId: context.mcp.grantId }
            : {}),
          ...(failure
            ? { code: failure.code }
            : completed ||
                input.operation.endsWith(".list") ||
                input.operation === "invites.uses" ||
                input.operation.endsWith(".read") ||
                input.operation.startsWith("monitor.")
              ? {}
              : {
                  ...result,
                  ...("reason" in input ? { reason: input.reason } : {}),
                }),
        },
      );
      await database.query("COMMIT");
    } catch (error) {
      if (!(error instanceof AccessError && error.code === "REQUEST_CONFLICT"))
        await database.query("ROLLBACK");
      throw error;
    } finally {
      database.release();
    }
    if (failure) throw failure;
    if (
      ["backups.configure", "backups.create", "backups.restore"].includes(
        input.operation,
      )
    )
      await this.backups.call("activate", { id: requestId });
    if (input.operation === "invites.create")
      return { ...result, token: this.#token(result.id as string) };
    return result;
  }
  async #mcpCheck(
    db: Database,
    actor: string,
    input:
      Input | { operation: "recovery.admin"; userId: string; reason: string },
    context: Context,
    lock = false,
  ) {
    const p = context.mcp;
    if (!p) return;
    if (p.userId !== actor)
      throw new AccessError(
        403,
        "MCP_ACTOR_MISMATCH",
        "認可された利用者を変更できません",
      );
    let worldId = "worldId" in input ? input.worldId : undefined;
    if (input.operation === "inspection.select")
      worldId = input.selection.worldId;
    if (
      "query" in input &&
      "worldId" in input.query &&
      typeof input.query.worldId === "string"
    )
      worldId = input.query.worldId;
    if (
      ["jobs.read", "jobs.resume"].includes(input.operation) &&
      "kind" in input
    ) {
      if (input.kind === "construction") worldId = input.id;
      else
        worldId = (
          await db.query(
            `SELECT construction_id FROM ${input.kind === "scene" ? "world_scene" : "world_join"} WHERE id=$1`,
            [input.id],
          )
        ).rows[0]?.construction_id;
    }
    if (input.operation === "worlds.resumeJoin")
      worldId = (
        await db.query("SELECT construction_id FROM world_join WHERE id=$1", [
          input.joinId,
        ])
      ).rows[0]?.construction_id;
    await this.mcp.check(db, p, input.operation, worldId, lock);
  }
  async #audit(
    database: Database,
    actor: string | null,
    request: string,
    operation: string,
    outcome: string,
    details: unknown,
  ) {
    await database.query(
      "INSERT INTO operation_audit(request_id,actor_id,operation,outcome,details) VALUES($1,$2,$3,$4,$5)",
      [request, actor, operation, outcome, JSON.stringify(details)],
    );
  }
  async #perform(
    db: pg.PoolClient,
    actor: string | null,
    input:
      Input | { operation: "recovery.admin"; userId: string; reason: string },
    context: Context,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    switch (input.operation) {
      case "inspection.select":
        return InspectionStore.select(db, input.selection);
      case "inspection.read":
        return InspectionStore.read(
          db,
          input.worldId,
          input.manifestId,
          input.after,
        );
      case "inspection.evaluate": {
        await InspectionStore.manifest(db, input.worldId, input.manifestId);
        if (
          !(
            await db.query(
              "SELECT version FROM llm_settings WHERE version=$1",
              [input.configuration.configurationVersion],
            )
          ).rowCount
        )
          throw new AccessError(
            409,
            "INSPECTION_MODEL_NOT_FOUND",
            "保存済みの評価モデル設定版を指定してください",
          );
        await db.query(
          "INSERT INTO inspection_evaluation(id,manifest_id,configuration) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [requestId, input.manifestId, input.configuration],
        );
        return { id: requestId, status: "queued" };
      }
      case "inspection.evaluation": {
        const row = (
          await db.query(
            'SELECT e.id,e.manifest_id AS "manifestId",e.configuration,e.status,e.result FROM inspection_evaluation e JOIN inspection_manifest m ON m.id=e.manifest_id WHERE e.id=$1 AND m.world_id=$2',
            [input.id, input.worldId],
          )
        ).rows[0];
        if (!row)
          throw new AccessError(
            404,
            "INSPECTION_EVALUATION_NOT_FOUND",
            "評価実行が見つかりません",
          );
        return row;
      }
      case "inspection.history":
        return inspectionHistory(db, input.query);
      case "inspection.settings":
        return inspectionSettings(db, input.worldId);
      case "inspection.configure":
        return configureInspection(
          db,
          input.worldId,
          input.configuration,
          input.expectedVersion,
        );
      case "requests.read": {
        const row = (
          await db.query(
            `SELECT r.operation,r.result,r.error,a.outcome,a.details->>'code' AS code FROM operation_request r
          LEFT JOIN LATERAL (SELECT outcome,details FROM operation_audit WHERE request_id=r.id ORDER BY id DESC LIMIT 1) a ON true
          WHERE r.id=$1 AND r.actor_id=$2`,
            [input.id, actor],
          )
        ).rows[0];
        if (!row) return { id: input.id, state: "unreceived" };
        if (context.mcp)
          await this.mcp.check(db, context.mcp, row.operation, undefined, true);
        return {
          id: input.id,
          operation: row.operation,
          state: row.error
            ? "failed"
            : row.result !== null
              ? "accepted"
              : "pending",
          outcome: row.outcome ?? null,
          code: row.code ?? null,
          result:
            row.result && row.operation === "invites.create"
              ? { ...row.result, token: this.#token(row.result.id) }
              : row.result,
          error: row.error,
        };
      }
      case "mcp.clients.list":
        return {
          ...(await this.mcp.clients(db, input.before)),
          resource: this.mcp.resource,
        };
      case "mcp.clients.put":
        return this.mcp.put(
          db,
          input.clientId,
          input.configuration,
          input.expectedVersion,
          actor!,
        );
      case "mcp.grants.list":
        return this.mcp.grants(db, input.before);
      case "mcp.grants.revoke": {
        const r = (
          await db.query(
            "UPDATE mcp_grant SET revoked=true WHERE id=$1 RETURNING id,revoked",
            [input.grantId],
          )
        ).rows[0];
        if (!r)
          throw new AccessError(
            404,
            "MCP_GRANT_NOT_FOUND",
            "認可が見つかりません",
          );
        return r;
      }
      case "worlds.list": {
        const allowed = context.mcp
          ? await this.mcp.worlds(db, context.mcp)
          : null;
        const rows = (
          await db.query(
            "SELECT id FROM world_construction WHERE ($1::uuid IS NULL OR id<$1) AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY id DESC LIMIT 51",
            [input.before ?? null, allowed],
          )
        ).rows;
        return {
          items: rows.slice(0, 50),
          next: rows.length > 50 ? rows[49].id : null,
        };
      }
      case "worlds.read":
        return {
          world: await this.#access(context).status(actor!, input.worldId),
        };
      case "worlds.records":
        return this.#access(context).records(
          actor!,
          input.worldId,
          input.before,
        );
      case "worlds.create":
        return this.#access(context).create(actor!, {
          requestId,
          prompt: input.prompt,
          budgetUsd: input.budgetUsd,
        });
      case "worlds.command":
        return this.#access(context).command(actor!, input.worldId, {
          ...input.command,
          requestId,
        });
      case "worlds.graph":
        return new WorldManagement(this.#access(context).players).read(
          db,
          input.worldId,
          input.query,
        );
      case "worlds.edit": {
        await RuntimeControl.check(db, {}, true);
        return new WorldManagement(this.#access(context).players).edit(
          db,
          actor!,
          input.worldId,
          requestId,
          input,
        );
      }
      case "backups.read":
      case "backups.jobs":
      case "backups.list":
      case "backups.job":
        return this.backups.call(input.operation.slice(8), input);
      case "backups.configure":
      case "backups.create":
      case "backups.restore":
        return this.backups.call("prepare", {
          id: requestId,
          actor,
          input,
          ...(context.mcp
            ? {
                permission: {
                  grantId: context.mcp.grantId,
                  scope: input.operation,
                },
              }
            : {}),
        });
      case "jobs.list":
        return readJobs(db, input.query);
      case "jobs.read":
        return { job: (await readJobs(db, {}, input)).items[0] };
      case "jobs.resume": {
        if (!context.players)
          throw new AccessError(
            503,
            "RUNTIME_NOT_CONFIGURED",
            "実行サービスを設定してください",
          );
        return resumeJob(db, context.players, input.kind, input.id, requestId);
      }
      case "monitor.samples":
        return RuntimeMonitor.page(db, "samples", input.query.before);
      case "monitor.notifications":
        return RuntimeMonitor.page(db, "notifications", input.query.before);
      case "monitorWebhook.put": {
        const cipher =
          input.url === null
            ? null
            : seal(
                this.tokenSecret,
                "gestaloka.monitor-webhook.v1",
                "url",
                input.url,
              );
        const row = (
          await db.query(
            "UPDATE runtime_control SET webhook_cipher=$1,webhook_version=webhook_version+1,version=version+1,updated_by=$2,updated_at=now() WHERE singleton AND webhook_version=$3 RETURNING webhook_version AS version,webhook_cipher IS NOT NULL AS configured",
            [cipher, actor, input.expectedVersion],
          )
        ).rows[0];
        if (!row)
          throw new AccessError(
            409,
            "SETTINGS_CHANGED",
            "現在の通知先の設定版を読み直してください",
          );
        return row;
      }
      case "runtime.read":
        return RuntimeControl.read(db);
      case "runtime.put": {
        const previous = await RuntimeControl.read(db);
        const row = (
          await db.query(
            "UPDATE runtime_control SET configuration=$1,version=version+1,updated_by=$2,updated_at=now() WHERE singleton AND version=$3 RETURNING version",
            [input.configuration, actor, input.expectedVersion],
          )
        ).rows[0];
        if (!row)
          throw new AccessError(
            409,
            "SETTINGS_CHANGED",
            "現在の運用設定版を読み直してください",
          );
        return {
          ...(await RuntimeControl.read(db)),
          previous: previous.configuration,
        };
      }
      case "costs.read":
        return readCosts(db, input.query);
      case "models.read":
        return this.models.read(db);
      case "models.put": {
        const saved = await this.models.put(
          db,
          input.configuration,
          input.expectedVersion,
          actor,
        );
        if (!saved)
          throw new AccessError(
            409,
            "SETTINGS_CHANGED",
            "現在のモデル設定版を読み直してください",
          );
        return saved;
      }
      case "credentials.put": {
        const saved = await this.models.putSecret(
          db,
          input.provider,
          input.value,
          input.expectedVersion,
          actor,
        );
        if (!saved)
          throw new AccessError(
            409,
            "SETTINGS_CHANGED",
            "現在のAPIキー設定版を読み直してください",
          );
        return saved;
      }
      case "responseLimits.read": {
        const row = (
          await db.query(
            'SELECT calls,version,updated_by AS "updatedBy",updated_at AS "updatedAt" FROM response_call_policy WHERE singleton',
          )
        ).rows[0];
        return { ...row, updatedAt: row.updatedAt.toISOString() };
      }
      case "responseLimits.put": {
        const before = (
          await db.query(
            "SELECT calls FROM response_call_policy WHERE singleton FOR UPDATE",
          )
        ).rows[0].calls;
        const row = (
          await db.query(
            'UPDATE response_call_policy SET calls=$1,version=version+1,updated_by=$2,updated_at=now() WHERE singleton AND version=$3 RETURNING calls,version,updated_by AS "updatedBy",updated_at AS "updatedAt"',
            [input.calls, actor, input.expectedVersion],
          )
        ).rows[0];
        if (!row)
          throw new AccessError(
            409,
            "SETTINGS_CHANGED",
            "現在の設定版を読み直してください",
          );
        return {
          ...row,
          updatedAt: row.updatedAt.toISOString(),
          previous: before,
        };
      }
      case "worldBudgets.read":
      case "worldBudgets.put": {
        const world = (
          await db.query<{ world_id: string }>(
            "SELECT world_id FROM world_build WHERE run_id=$1",
            [input.worldId],
          )
        ).rows[0];
        if (!world)
          throw new AccessError(404, "WORLD_NOT_FOUND", "世界が見つかりません");
        const previous = await WorldBudget.read(db, world.world_id);
        if (input.operation === "worldBudgets.put") {
          const row =
            (
              await db.query(
                `INSERT INTO world_budget(world_id,limit_nano,updated_by)
            SELECT $1,$2,$3 WHERE $4::int=0 ON CONFLICT(world_id) DO NOTHING RETURNING world_id`,
                [
                  world.world_id,
                  Math.round(input.budgetUsd * 1_000_000_000),
                  actor,
                  input.expectedVersion,
                ],
              )
            ).rows[0] ??
            (
              await db.query(
                "UPDATE world_budget SET limit_nano=$2,version=version+1,updated_by=$3,updated_at=now() WHERE world_id=$1 AND version=$4 AND $4>0 RETURNING world_id",
                [
                  world.world_id,
                  Math.round(input.budgetUsd * 1_000_000_000),
                  actor,
                  input.expectedVersion,
                ],
              )
            ).rows[0];
          if (!row)
            throw new AccessError(
              409,
              "SETTINGS_CHANGED",
              "現在の予算設定を読み直してください",
            );
        }
        return {
          worldId: input.worldId,
          ...(await WorldBudget.read(db, world.world_id)),
          ...(input.operation === "worldBudgets.put" ? { previous } : {}),
        };
      }
      case "modelLimits.read": {
        const row = (
          await db.query(
            'SELECT name,limits,version,updated_by AS "updatedBy",updated_at AS "updatedAt" FROM llm_model_policy WHERE name=$1',
            [input.name],
          )
        ).rows[0];
        return row
          ? { ...row, updatedAt: row.updatedAt.toISOString() }
          : {
              name: input.name,
              limits: null,
              version: 0,
              updatedBy: null,
              updatedAt: null,
            };
      }
      case "modelLimits.put": {
        const before = (
          await db.query(
            "SELECT limits,version FROM llm_model_policy WHERE name=$1 FOR UPDATE",
            [input.name],
          )
        ).rows[0];
        if ((before?.version ?? 0) !== input.expectedVersion)
          throw new AccessError(
            409,
            "SETTINGS_CHANGED",
            "設定が変わりました。現在の版を読み直してください",
          );
        const row = (
          await db.query(
            `INSERT INTO llm_model_policy(name,limits,updated_by) VALUES($1,$2,$3)
          ON CONFLICT(name) DO UPDATE SET limits=EXCLUDED.limits,version=llm_model_policy.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()
          RETURNING name,limits,version,updated_by AS "updatedBy",updated_at AS "updatedAt"`,
            [input.name, JSON.stringify(input.limits), actor],
          )
        ).rows[0];
        return {
          ...row,
          updatedAt: row.updatedAt.toISOString(),
          previous: before?.limits ?? null,
        };
      }
      case "worlds.join":
      case "worlds.resumeJoin": {
        if (!context.players)
          throw new AccessError(
            503,
            "MODEL_NOT_CONFIGURED",
            "参加処理を設定してください",
          );
        return input.operation === "worlds.join"
          ? context.players.join(actor!, requestId, input, db)
          : context.players.resume(actor!, input.joinId, db);
      }
      case "worlds.configure": {
        const row = (
          await db.query(
            `UPDATE world_construction SET public_title=$2,public_description=$3,published=$4,accepting=$5 WHERE id=$1
          RETURNING id,public_title AS title,public_description AS description,published,accepting`,
            [
              input.worldId,
              input.title,
              input.description,
              input.published,
              input.accepting,
            ],
          )
        ).rows[0];
        if (!row)
          throw new AccessError(404, "WORLD_NOT_FOUND", "世界が見つかりません");
        return row;
      }
      case "presets.put": {
        const row =
          (
            await db.query(
              `INSERT INTO player_preset(id,title,description,settings,updated_by)
          SELECT $1,$2,$3,$4,$5 WHERE $6::int=0
          ON CONFLICT(id) DO NOTHING RETURNING id,version`,
              [
                input.presetId,
                input.title,
                input.description,
                input.settings,
                actor,
                input.expectedVersion,
              ],
            )
          ).rows[0] ??
          (
            await db.query(
              `UPDATE player_preset SET title=$2,description=$3,settings=$4,updated_by=$5,updated_at=now(),version=version+1
            WHERE id=$1 AND version=$6 AND $6>0 RETURNING id,version`,
              [
                input.presetId,
                input.title,
                input.description,
                input.settings,
                actor,
                input.expectedVersion,
              ],
            )
          ).rows[0];
        if (!row)
          throw new AccessError(
            409,
            "PRESET_CHANGED",
            "設定が変わりました。プリセットを読み直してください",
          );
        return row;
      }
      case "presets.list": {
        const rows = (
          await db.query(
            "SELECT id,title,description,settings,version,updated_by,updated_at FROM player_preset WHERE ($1::uuid IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",
            [input.before ?? null],
          )
        ).rows;
        return {
          items: rows.slice(0, 50),
          next: rows.length > 50 ? rows[49]!.id : null,
        };
      }
      case "account.claim": {
        const source = await this.#legacySource(
          actor!,
          context.legacyToken,
          db,
          true,
        );
        const snapshot = await this.#legacySnapshot(source.id, db);
        if (snapshot.version !== input.version)
          throw new AccessError(
            409,
            "CLAIM_CHANGED",
            "引き継ぐ対象が変わりました。一覧を確認し直してください",
          );
        await db.query("UPDATE world_subject SET user_id=$2 WHERE id=$1", [
          source.id,
          actor,
        ]);
        return {
          subjectId: source.id,
          worldCount: snapshot.total,
          linked: true,
        };
      }
      case "account.register": {
        const known = (
          await db.query<UserRow>("SELECT * FROM app_user WHERE id=$1", [actor])
        ).rows[0];
        if (known) {
          if (known.banned)
            throw new AccessError(403, "USER_BANNED", "利用が停止されています");
          return { member: member(known) };
        }
        const state = (
          await db.query<{ bootstrapped: boolean; invite_required: boolean }>(
            "SELECT * FROM operation_state WHERE singleton",
          )
        ).rows[0]!;
        let invite: string | undefined;
        if (state.bootstrapped && state.invite_required) {
          const row = (
            await db.query<{ id: string }>(
              "SELECT id FROM app_invite WHERE token_hash=$1 AND NOT revoked AND expires_at>now() AND uses<max_uses FOR UPDATE",
              [hash(input.invitation ?? "")],
            )
          ).rows[0];
          if (!row)
            throw new AccessError(
              403,
              "INVITATION_REQUIRED",
              "有効な招待トークンが必要です",
            );
          invite = row.id;
        }
        const row = (
          await db.query<UserRow>(
            "INSERT INTO app_user(id,role) VALUES($1,$2) RETURNING *",
            [actor, state.bootstrapped ? "user" : "admin"],
          )
        ).rows[0]!;
        if (!state.bootstrapped)
          await db.query(
            "UPDATE operation_state SET bootstrapped=true WHERE singleton",
          );
        if (invite) {
          await db.query("UPDATE app_invite SET uses=uses+1 WHERE id=$1", [
            invite,
          ]);
          await db.query(
            "INSERT INTO invite_use(invite_id,user_id) VALUES($1,$2)",
            [invite, actor],
          );
        }
        return { member: member(row) };
      }
      case "settings.read":
        return {
          inviteRequired: (
            await db.query(
              "SELECT invite_required FROM operation_state WHERE singleton",
            )
          ).rows[0].invite_required,
        };
      case "settings.invites":
        await db.query(
          "UPDATE operation_state SET invite_required=$1 WHERE singleton",
          [input.enabled],
        );
        return { inviteRequired: input.enabled };
      case "users.list": {
        const rows = (
          await db.query<UserRow>(
            "SELECT * FROM app_user WHERE ($1::uuid IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",
            [input.before ?? null],
          )
        ).rows;
        return {
          items: rows.slice(0, 50).map(member),
          next: rows.length > 50 ? rows[49]!.id : null,
        };
      }
      case "recovery.admin":
      case "users.role":
      case "users.ban": {
        const before = (
          await db.query<UserRow>(
            "SELECT * FROM app_user WHERE id=$1 FOR UPDATE",
            [input.userId],
          )
        ).rows[0];
        if (!before && input.operation === "recovery.admin") {
          const row = (
            await db.query<UserRow>(
              "INSERT INTO app_user(id,role) SELECT id,'admin' FROM app_identity WHERE id=$1 RETURNING *",
              [input.userId],
            )
          ).rows[0];
          if (!row)
            throw new AccessError(
              404,
              "USER_NOT_FOUND",
              "先に本人がログインしてアプリIDを確認してください",
            );
          await db.query(
            "UPDATE operation_state SET bootstrapped=true WHERE singleton",
          );
          return { before: null, member: member(row) };
        }
        if (!before)
          throw new AccessError(
            404,
            "USER_NOT_FOUND",
            "ユーザーが見つかりません",
          );
        const role =
          input.operation === "users.ban"
            ? before.role
            : input.operation === "recovery.admin"
              ? "admin"
              : input.role;
        const banned =
          input.operation === "users.ban"
            ? input.banned
            : input.operation === "recovery.admin"
              ? false
              : before.banned;
        if (
          before.role === "admin" &&
          !before.banned &&
          (banned || role !== "admin")
        ) {
          const count = Number(
            (
              await db.query(
                "SELECT count(*) FROM app_user WHERE role='admin' AND NOT banned",
              )
            ).rows[0].count,
          );
          if (count === 1)
            throw new AccessError(
              409,
              "LAST_ADMIN",
              "最後の有効な管理者は降格・BANできません",
            );
        }
        const after = (
          await db.query<UserRow>(
            "UPDATE app_user SET role=$2,banned=$3 WHERE id=$1 RETURNING *",
            [input.userId, role, banned],
          )
        ).rows[0]!;
        return { before: member(before), member: member(after) };
      }
      case "invites.create": {
        if (Date.parse(input.expiresAt) <= Date.now())
          throw new AccessError(
            409,
            "INVITE_EXPIRY",
            "招待の有効期限は未来の日時にしてください",
          );
        const id = randomUUID();
        await db.query(
          "INSERT INTO app_invite(id,token_hash,expires_at,max_uses,created_by) VALUES($1,$2,$3,$4,$5)",
          [id, hash(this.#token(id)), input.expiresAt, input.maxUses, actor],
        );
        return { id, expiresAt: input.expiresAt, maxUses: input.maxUses };
      }
      case "invites.revoke": {
        const row = await db.query(
          "UPDATE app_invite SET revoked=true WHERE id=$1 RETURNING id",
          [input.inviteId],
        );
        if (!row.rowCount)
          throw new AccessError(
            404,
            "INVITE_NOT_FOUND",
            "招待が見つかりません",
          );
        return { id: input.inviteId, revoked: true };
      }
      case "invites.list": {
        const rows = (
          await db.query(
            "SELECT id,expires_at,max_uses,uses,revoked,created_by,created_at FROM app_invite WHERE ($1::uuid IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",
            [input.before ?? null],
          )
        ).rows;
        return {
          items: rows.slice(0, 50).map((row) => ({
            id: row.id,
            expiresAt: row.expires_at.toISOString(),
            maxUses: Number(row.max_uses),
            uses: Number(row.uses),
            revoked: row.revoked,
            createdBy: row.created_by,
            createdAt: row.created_at.toISOString(),
          })),
          next: rows.length > 50 ? rows[49]!.id : null,
        };
      }
      case "invites.uses": {
        const rows = (
          await db.query(
            "SELECT user_id,used_at FROM invite_use WHERE invite_id=$1 AND ($2::uuid IS NULL OR user_id<$2) ORDER BY user_id DESC LIMIT 51",
            [input.inviteId, input.before ?? null],
          )
        ).rows;
        return {
          items: rows.slice(0, 50).map((row) => ({
            userId: row.user_id,
            usedAt: row.used_at.toISOString(),
          })),
          next: rows.length > 50 ? rows[49]!.user_id : null,
        };
      }
      case "audit.list": {
        const rows = (
          await db.query(
            "SELECT id::text,request_id,actor_id,operation,outcome,details,created_at FROM operation_audit WHERE ($1::bigint IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",
            [input.before ?? null],
          )
        ).rows;
        return {
          items: rows.slice(0, 50),
          next: rows.length > 50 ? rows[49]!.id : null,
        };
      }
    }
  }
  #access(context: Context) {
    if (!context.players)
      throw new AccessError(
        503,
        "RUNTIME_NOT_CONFIGURED",
        "実行サービスを設定してください",
      );
    return new WorldAccess(context.players.construction);
  }
}
