import { randomUUID } from "node:crypto";
import type pg from "pg";
import { AccessError } from "../http/access.js";
import { requireMember } from "../http/operations.js";
import { ExecutionBudget } from "../execution-budget.js";
import { SupersededWorker } from "./agent.js";
import type { WorldConstruction } from "./construction.js";

type JoinRow = {
  id: string;
  subject_id: string;
  construction_id: string;
  preset_id: string;
  preset_version: number;
  operation_id: string;
  state: "joining" | "ready" | "paused";
  actor_id: string | null;
  claim: string | null;
  at: string;
  error: string | null;
};

export class WorldPlayers {
  readonly queueName: string;
  constructor(readonly construction: WorldConstruction) {
    this.queueName = `${construction.queueName}-joins`;
  }
  get pool() {
    return this.construction.pool;
  }
  async setup() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_join (
      id uuid PRIMARY KEY,subject_id uuid NOT NULL,construction_id uuid NOT NULL REFERENCES world_construction(id) ON DELETE CASCADE,
      preset_id uuid NOT NULL,preset_version integer NOT NULL,operation_id uuid NOT NULL REFERENCES world_operation(id),
      state text NOT NULL DEFAULT 'joining',actor_id uuid,at bigint NOT NULL,claim uuid,error text);`);
    await this.construction.queue.createQueue(this.queueName, {
      retryLimit: 2,
      retryDelay: 5,
      expireInSeconds: 900,
      heartbeatSeconds: 30,
    });
  }
  async #enqueue(db: pg.PoolClient, id: string) {
    await this.construction.queue.send(
      this.queueName,
      { id },
      { db: { executeSql: (text, values) => db.query(text, values) } },
    );
  }
  async join(
    userId: string,
    id: string,
    input: { worldId: string; presetId: string; presetVersion: number },
    db: pg.PoolClient,
  ) {
    await requireMember(db, userId);
    const world = (
      await db.query<{
        world_id: string;
        root_ids: string[];
        at: string;
        published: boolean;
        accepting: boolean;
        state: string;
      }>("SELECT * FROM world_construction WHERE id=$1 FOR SHARE", [
        input.worldId,
      ])
    ).rows[0];
    if (!world || !world.published)
      throw new AccessError(
        404,
        "WORLD_NOT_FOUND",
        "参加できる世界が見つかりません",
      );
    if (
      !world.accepting ||
      !["finished", "playing", "play_paused"].includes(world.state) ||
      !world.world_id
    )
      throw new AccessError(
        409,
        "JOIN_CLOSED",
        "現在は参加を受け付けていません",
      );
    const preset = (
      await db.query<{ settings: string; version: number }>(
        "SELECT settings,version FROM player_preset WHERE id=$1 FOR SHARE",
        [input.presetId],
      )
    ).rows[0];
    if (!preset || preset.version !== input.presetVersion)
      throw new AccessError(
        409,
        "PRESET_CHANGED",
        "プリセットを選び直してください",
      );
    await db.query(
      "INSERT INTO world_subject(id,user_id) VALUES($1,$1) ON CONFLICT DO NOTHING",
      [userId],
    );
    const operationId = await this.construction.agent.create(
      {
        worldId: world.world_id,
        phase: "participant",
        at: Number(world.at),
        until: Number(world.at),
        rootIds: world.root_ids,
        actionText: preset.settings,
      },
      id,
      db,
    );
    await db.query(
      "INSERT INTO world_join(id,subject_id,construction_id,preset_id,preset_version,operation_id,at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        userId,
        input.worldId,
        input.presetId,
        preset.version,
        operationId,
        world.at,
      ],
    );
    await this.#enqueue(db, id);
    return { id, state: "joining" };
  }
  async resume(userId: string, id: string, db: pg.PoolClient) {
    await requireMember(db, userId);
    const row = (
      await db.query<JoinRow>(
        "SELECT * FROM world_join WHERE id=$1 AND subject_id=$2 FOR UPDATE",
        [id, userId],
      )
    ).rows[0];
    if (!row)
      throw new AccessError(404, "JOIN_NOT_FOUND", "参加要求が見つかりません");
    if (row.state !== "paused")
      throw new AccessError(
        409,
        "STATE_CONFLICT",
        "保留中の参加要求を指定してください",
      );
    await ExecutionBudget.extend(id, db);
    await db.query(
      "UPDATE world_join SET state='joining',claim=NULL,error=NULL WHERE id=$1",
      [id],
    );
    await this.#enqueue(db, id);
    return { id, state: "joining" };
  }
  async list(userId: string, worldId: string, before?: string) {
    await requireMember(this.pool, userId);
    const rows = (
      await this.pool.query(
        `SELECT * FROM (
      SELECT j.id,j.actor_id AS "actorId",j.state,j.at FROM world_join j WHERE j.subject_id=$1 AND j.construction_id=$2
      UNION ALL SELECT a.id,a.actor_id AS "actorId",'ready' AS state,c.at FROM world_access a JOIN world_subject s ON s.id=a.subject_id
        JOIN world_construction c ON c.id=a.construction_id WHERE s.user_id=$1 AND s.active AND a.role='player' AND a.construction_id=$2
        AND NOT EXISTS(SELECT 1 FROM world_join j WHERE j.id=a.id)
      ) p WHERE ($3::uuid IS NULL OR p.id<$3) ORDER BY p.id DESC LIMIT 51`,
        [userId, worldId, before ?? null],
      )
    ).rows;
    return {
      items: rows.slice(0, 50).map((r) => ({ ...r, at: Number(r.at) })),
      next: rows.length > 50 ? rows[49]!.id : null,
    };
  }
  async #transaction<T>(fn: (db: pg.PoolClient) => Promise<T>) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const result = await fn(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async tick(id: string) {
    const claim = randomUUID();
    const row = await this.#transaction(async (db) => {
      const row = (
        await db.query<JoinRow>(
          "SELECT * FROM world_join WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!row) throw new Error("参加要求が見つかりません");
      if (row.state !== "joining") return row;
      await db.query("UPDATE world_join SET claim=$2 WHERE id=$1", [id, claim]);
      return { ...row, claim };
    });
    if (row.claim !== claim) return;
    try {
      const result = await ExecutionBudget.run(this.pool, id, () =>
        this.construction.agent.run(row.operation_id),
      );
      const commit = (
        await this.pool.query<{ commit_id: string }>(
          "SELECT commit_id FROM world_operation WHERE id=$1",
          [row.operation_id],
        )
      ).rows[0]!;
      await this.#transaction(async (db) => {
        const updated = await db.query(
          "UPDATE world_join SET actor_id=$3,state='ready',error=NULL WHERE id=$1 AND claim=$2 RETURNING id",
          [id, claim, result.newParticipantId],
        );
        if (!updated.rowCount)
          throw new SupersededWorker("参加処理が引き継がれました");
        await db.query(
          "INSERT INTO world_access(id,subject_id,construction_id,role,actor_id) VALUES($1,$2,$3,'player',$4) ON CONFLICT DO NOTHING",
          [id, row.subject_id, row.construction_id, result.newParticipantId],
        );
        await db.query(
          "INSERT INTO operation_audit(request_id,actor_id,operation,outcome,details) VALUES($1,$2,'worlds.join','completed',$3)",
          [
            id,
            row.subject_id,
            JSON.stringify({
              worldId: row.construction_id,
              actorId: result.newParticipantId,
              commitId: commit.commit_id,
            }),
          ],
        );
        await db.query(
          "INSERT INTO world_event(subject_id,construction_id,role,event_key) VALUES($1,$2,'player',$3) ON CONFLICT DO NOTHING",
          [row.subject_id, row.construction_id, `join:${id}`],
        );
      });
    } catch (error) {
      if (error instanceof SupersededWorker) return;
      await this.pool.query(
        "UPDATE world_join SET state='paused',error=$3 WHERE id=$1 AND claim=$2",
        [
          id,
          claim,
          error instanceof Error ? error.message : "参加処理を保留しました",
        ],
      );
      throw error;
    }
  }
  async work() {
    return this.construction.queue.work<{ id: string }>(
      this.queueName,
      { localConcurrency: 2, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        for (const job of jobs)
          try {
            await this.tick(job.data.id);
          } catch {
            console.error(
              JSON.stringify({ joinId: job.data.id, state: "paused" }),
            );
          }
      },
    );
  }
}
