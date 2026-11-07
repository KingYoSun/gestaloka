import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { AccessError } from "./access.js";
import { requireMember } from "./operations.js";
import type { z } from "zod";
import { PlayerDeviceApproval, PlayerDeviceStatus } from "@gestaloka/contracts";

type Device = {
  id: string;
  world_id: string;
  token_hash: string;
  user_code: string;
  user_id: string | null;
  actor_id: string | null;
  preset_id: string | null;
  preset_version: number | null;
  revoked: boolean;
  join_state?: string;
};
const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
const denied = () =>
  new AccessError(
    403,
    "PLAYER_DEVICE_DENIED",
    "プレイの許可を確認してください",
  );

/** A device can receive one existing actor or one fixed join request, never an account session. */
export class PlayerDevices {
  constructor(readonly pool: pg.Pool) {}

  async setup() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS player_device (
      id uuid PRIMARY KEY,world_id uuid NOT NULL REFERENCES world_construction(id) ON DELETE CASCADE,
      token_hash text UNIQUE NOT NULL,user_code text UNIQUE NOT NULL,
      user_id uuid REFERENCES app_identity(id) ON DELETE CASCADE,actor_id uuid,preset_id uuid,preset_version integer,
      revoked boolean NOT NULL DEFAULT false);
      CREATE INDEX IF NOT EXISTS player_device_owner ON player_device(user_id,id);`);
  }

  async begin(id: string, worldId: string, secret: string) {
    const world = await this.pool.query(
      "SELECT id FROM world_construction WHERE id=$1",
      [worldId],
    );
    if (!world.rowCount)
      throw new AccessError(404, "WORLD_NOT_FOUND", "世界が見つかりません");
    const row = (
      await this.pool.query<Device>(
        `INSERT INTO player_device(id,world_id,token_hash,user_code)
       VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET id=excluded.id RETURNING *`,
        [
          id,
          worldId,
          hash(secret),
          randomBytes(5).toString("hex").toUpperCase(),
        ],
      )
    ).rows[0]!;
    if (row.world_id !== worldId || row.token_hash !== hash(secret))
      throw denied();
    return {
      id,
      userCode: row.user_code,
      verificationPath: `/auth/player?code=${row.user_code}`,
    };
  }

  async read(authorization?: string) {
    const token = authorization?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    if (!token) throw denied();
    const row = (
      await this.pool.query<Device>(
        `SELECT d.*,coalesce(d.actor_id,j.actor_id) AS actor_id,j.state AS join_state
       FROM player_device d LEFT JOIN world_join j ON j.id=d.id AND j.subject_id=d.user_id
       WHERE d.token_hash=$1`,
        [hash(token)],
      )
    ).rows[0];
    if (!row || row.revoked) throw denied();
    if (row.user_id) await requireMember(this.pool, row.user_id);
    return row;
  }

  status(row: Device) {
    return PlayerDeviceStatus.parse({
      id: row.id,
      worldId: row.world_id,
      actorId: row.actor_id,
      joinId: row.preset_id ? row.id : null,
      presetId: row.preset_id,
      presetVersion: row.preset_version,
      state: !row.user_id
        ? "authorization_pending"
        : row.actor_id
          ? "ready"
          : (row.join_state ?? "authorized"),
    });
  }

  async authorize(
    authorization: string | undefined,
    worldId?: string,
    actorId?: string,
  ) {
    const row = await this.read(authorization);
    if (
      !row.user_id ||
      (worldId !== undefined && row.world_id !== worldId) ||
      (actorId !== undefined && row.actor_id !== actorId)
    )
      throw denied();
    return row;
  }

  async pending(code: string) {
    const row = (
      await this.pool.query<Device>(
        "SELECT * FROM player_device WHERE user_code=$1 AND NOT revoked",
        [code],
      )
    ).rows[0];
    if (!row) throw denied();
    return row;
  }

  async approve(
    userId: string,
    code: string,
    choice: z.infer<typeof PlayerDeviceApproval>,
  ) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await requireMember(db, userId);
      const row = (
        await db.query<Device>(
          "SELECT * FROM player_device WHERE user_code=$1 AND NOT revoked FOR UPDATE",
          [code],
        )
      ).rows[0];
      if (!row) throw denied();
      if (row.user_id) {
        if (
          row.user_id !== userId ||
          row.actor_id !== ("actorId" in choice ? choice.actorId : null) ||
          row.preset_id !== ("presetId" in choice ? choice.presetId : null) ||
          row.preset_version !==
            ("presetVersion" in choice ? choice.presetVersion : null)
        )
          throw denied();
      } else if ("actorId" in choice) {
        const owned = await db.query(
          `SELECT a.id FROM world_access a JOIN world_subject s ON s.id=a.subject_id
          WHERE s.user_id=$1 AND s.active AND a.construction_id=$2 AND a.actor_id=$3 AND a.role='player'`,
          [userId, row.world_id, choice.actorId],
        );
        if (!owned.rowCount) throw denied();
      } else {
        const available = await db.query(
          `SELECT p.id FROM player_preset p,world_construction w
          WHERE p.id=$1 AND p.version=$2 AND w.id=$3 AND w.published AND w.accepting
          AND w.world_id IS NOT NULL AND w.state IN ('finished','playing','play_paused')`,
          [choice.presetId, choice.presetVersion, row.world_id],
        );
        if (!available.rowCount)
          throw new AccessError(
            409,
            "JOIN_CLOSED",
            "参加受付と設定を確認してください",
          );
      }
      await db.query(
        "UPDATE player_device SET user_id=$2,actor_id=$3,preset_id=$4,preset_version=$5 WHERE id=$1",
        [
          row.id,
          userId,
          "actorId" in choice ? choice.actorId : null,
          "presetId" in choice ? choice.presetId : null,
          "presetVersion" in choice ? choice.presetVersion : null,
        ],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  async list(userId: string, before?: string) {
    await requireMember(this.pool, userId);
    const rows = (
      await this.pool.query<Device>(
        `SELECT d.*,coalesce(d.actor_id,j.actor_id) AS actor_id
      FROM player_device d LEFT JOIN world_join j ON j.id=d.id AND j.subject_id=d.user_id
      WHERE d.user_id=$1 AND NOT d.revoked AND ($2::uuid IS NULL OR d.id<$2) ORDER BY d.id DESC LIMIT 51`,
        [userId, before ?? null],
      )
    ).rows;
    return {
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49]!.id : null,
    };
  }

  async revoke(userId: string, id: string) {
    await requireMember(this.pool, userId);
    const result = await this.pool.query(
      "UPDATE player_device SET revoked=true WHERE id=$1 AND user_id=$2 RETURNING id",
      [id, userId],
    );
    if (!result.rowCount) throw denied();
  }
}
