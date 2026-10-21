import type pg from "pg";
import { RuntimeSettings } from "@gestaloka/contracts";
import { McpOrigin, type McpPermission } from "../http/mcp-origin.js";

export class RuntimeStopped extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export type Authority = {
  role?: "admin" | "user";
  actorId?: string;
  mcp?: McpPermission;
};
type Database = Pick<pg.Pool, "query">;
export class RuntimeControl {
  static async setup(db: Database) {
    await McpOrigin.setup(db);
    await db.query(`CREATE TABLE IF NOT EXISTS runtime_control(singleton boolean PRIMARY KEY CHECK(singleton),
      version integer NOT NULL DEFAULT 1,configuration jsonb NOT NULL,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now());`);
    await db.query(
      "ALTER TABLE runtime_control ADD COLUMN IF NOT EXISTS webhook_cipher text, ADD COLUMN IF NOT EXISTS webhook_version integer NOT NULL DEFAULT 0",
    );
    await db.query(
      "INSERT INTO runtime_control(singleton,configuration) VALUES(true,$1) ON CONFLICT DO NOTHING",
      [
        RuntimeSettings.parse({
          paused: false,
          concurrency: null,
          sampleIntervalSeconds: 60,
          retentionDays: 30,
          thresholds: {},
        }),
      ],
    );
  }
  static async read(db: Database) {
    const row = (
      await db.query(
        "SELECT version,configuration,updated_by,updated_at,webhook_version,webhook_cipher IS NOT NULL AS webhook_configured FROM runtime_control WHERE singleton",
      )
    ).rows[0];
    return {
      version: row.version,
      webhookVersion: row.webhook_version,
      webhookConfigured: row.webhook_configured,
      configuration: RuntimeSettings.parse(row.configuration),
      updatedBy: row.updated_by,
      updatedAt: row.updated_at.toISOString(),
    };
  }
  static async check(
    db: Database,
    context: Authority & {
      userId?: string | undefined;
      worldId?: string | undefined;
    } = {},
    lock = false,
  ) {
    const policy = (
      await db.query(
        `SELECT configuration FROM runtime_control WHERE singleton${lock ? " FOR SHARE" : ""}`,
      )
    ).rows[0];
    if (policy?.configuration.paused)
      throw new RuntimeStopped(
        "MAINTENANCE",
        "運用停止中です。保存状態を保持し、解除後に再開できます。",
      );
    if (!context.userId) return;
    const user = (
      await db.query(
        `SELECT role,banned FROM app_user WHERE id=$1${lock ? " FOR SHARE" : ""}`,
        [context.userId],
      )
    ).rows[0];
    if (user?.banned)
      throw new RuntimeStopped(
        "USER_BANNED",
        "利用停止のため処理を保留しました。",
      );
    if (!user || (context.role === "admin" && user.role !== "admin"))
      throw new RuntimeStopped(
        "AUTHORITY_LOST",
        "実行に必要な権限が失効したため処理を保留しました。",
      );
    if (context.mcp) {
      const r = (
        await db.query(
          `SELECT c.configuration,g.scopes,g.world_ids,g.revoked,u.role AS operator_role,u.banned AS operator_banned FROM mcp_grant g JOIN mcp_client c ON c.id=g.client_id JOIN app_user u ON u.id=g.user_id
        WHERE g.id=$1${lock ? " FOR SHARE OF g,c,u" : ""}`,
          [context.mcp.grantId],
        )
      ).rows[0];
      const world = (
        await db.query("SELECT run_id FROM world_build WHERE world_id=$1", [
          context.worldId ?? null,
        ])
      ).rows[0]?.run_id;
      if (
        !r ||
        r.revoked ||
        !r.configuration.enabled ||
        r.operator_role !== "admin" ||
        r.operator_banned ||
        !r.scopes.includes(context.mcp.scope) ||
        !r.configuration.scopes.includes(context.mcp.scope) ||
        [r.world_ids, r.configuration.worldIds].some(
          (ids) => ids !== null && !ids.includes(world),
        )
      )
        throw new RuntimeStopped(
          "MCP_AUTH_REVOKED",
          "MCPの認可が失効したため処理を保留しました。",
        );
    }
    if (
      context.actorId &&
      !(
        await db.query(
          `SELECT a.id FROM world_access a JOIN world_subject s ON s.id=a.subject_id
      JOIN world_build b ON b.run_id=a.construction_id WHERE s.user_id=$1 AND s.active AND a.role='player' AND a.actor_id=$2 AND b.world_id=$3${lock ? " FOR SHARE OF a,s" : ""}`,
          [context.userId, context.actorId, context.worldId],
        )
      ).rowCount
    )
      throw new RuntimeStopped(
        "AUTHORITY_LOST",
        "操作対象の権限が失効したため処理を保留しました。",
      );
  }
}
