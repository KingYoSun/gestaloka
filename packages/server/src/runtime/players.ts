import { RuntimeExecutions } from "./executions.js";
import { McpOrigin } from "../http/mcp-origin.js";
import { RuntimeControl } from "./control.js";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { AccessError } from "../http/access.js";
import { requireMember } from "../http/operations.js";
import { ExecutionBudget } from "../execution-budget.js";
import { SupersededWorker } from "./agent.js";
import type { WorldConstruction } from "./construction.js";
import { playerIcon } from "./player-icons.js";
import { playerSettings } from "./player-settings.js";
import type { PlayerCharacter, JoinWorld } from "@gestaloka/contracts";
import { z } from "zod";

export type CharacterEvidence = {
  ids: string[];
  text: string;
  own?: boolean;
};

type JoinRow = {
  id: string;
  subject_id: string;
  construction_id: string;
  preset_id: string | null;
  preset_version: number | null;
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
      state text NOT NULL DEFAULT 'joining',actor_id uuid,at bigint NOT NULL,claim uuid,error text);
      CREATE TABLE IF NOT EXISTS world_player_icon (
      player_id uuid PRIMARY KEY, construction_id uuid NOT NULL REFERENCES world_construction(id) ON DELETE CASCADE,
      image text NOT NULL);`);
    await this.pool.query(
      "ALTER TABLE world_join ALTER COLUMN preset_id DROP NOT NULL, ALTER COLUMN preset_version DROP NOT NULL",
    );
    await this.construction.queue.createQueue(this.queueName, {
      retryLimit: 2,
      retryDelay: 5,
      expireInSeconds: 900,
      heartbeatSeconds: 30,
    });
  }
  async #enqueue(db: pg.PoolClient, id: string) {
    await McpOrigin.capture(db, "join", id);
    await this.construction.queue.send(
      this.queueName,
      { id },
      { db: { executeSql: (text, values) => db.query(text, values) } },
    );
  }
  async join(
    userId: string,
    id: string,
    input: Omit<z.infer<typeof JoinWorld>, "operation">,
    db: pg.PoolClient,
  ) {
    await requireMember(db, userId);
    await RuntimeControl.check(db, {}, true);
    const world = (
      await db.query<{
        world_id: string;
        root_ids: string[];
        at: string;
        published: boolean;
        accepting: boolean;
        state: string;
        player_settings: string;
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
    const preset =
      input.character !== undefined
        ? undefined
        : (
            await db.query<{ settings: string; version: number }>(
              "SELECT settings,version FROM player_preset WHERE id=$1 FOR SHARE",
              [input.presetId],
            )
          ).rows[0];
    if (
      input.character === undefined &&
      (!preset || preset.version !== input.presetVersion)
    )
      throw new AccessError(
        409,
        "PRESET_CHANGED",
        "プリセットを選び直してください",
      );
    const approved =
      world.player_settings && input.character !== undefined
        ? (
            await db.query(
              "SELECT id FROM player_device WHERE id=$1 AND user_id=$2 AND character_approved AND NOT revoked AND character=$3",
              [id, userId, input.character],
            )
          ).rowCount
        : false;
    const settings = input.character ?? preset!.settings;
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
        actionText: approved
          ? settings
          : playerSettings(world.player_settings, settings),
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
        input.presetId ?? null,
        preset?.version ?? null,
        operationId,
        world.at,
      ],
    );
    await ExecutionBudget.attribute(db, id, userId, { role: "user" });
    await this.#enqueue(db, id);
    return { id, state: "joining" };
  }
  async resume(userId: string, id: string, db: pg.PoolClient) {
    await requireMember(db, userId);
    await RuntimeControl.check(db, {}, true);
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
    await db.query(
      "UPDATE world_join SET state='joining',claim=NULL,error=NULL WHERE id=$1",
      [id],
    );
    await ExecutionBudget.attribute(db, id, userId, { role: "user" });
    await this.#enqueue(db, id);
    return { id, state: "joining" };
  }
  async list(
    userId: string,
    worldId: string,
    before?: string,
    entryId?: string,
    actorId?: string,
  ) {
    await requireMember(this.pool, userId);
    const rows = (
      await this.pool.query(
        `SELECT * FROM (
      SELECT j.id,j.actor_id AS "actorId",j.state,j.at FROM world_join j WHERE j.subject_id=$1 AND j.construction_id=$2
      UNION ALL SELECT a.id,a.actor_id AS "actorId",'ready' AS state,c.at FROM world_access a JOIN world_subject s ON s.id=a.subject_id
        JOIN world_construction c ON c.id=a.construction_id WHERE s.user_id=$1 AND s.active AND a.role='player' AND a.construction_id=$2
        AND NOT EXISTS(SELECT 1 FROM world_join j WHERE j.id=a.id)
      ) p WHERE ($3::uuid IS NULL OR p.id<$3) AND ($4::uuid IS NULL OR p.id=$4) AND ($5::uuid IS NULL OR p."actorId"=$5) ORDER BY p.id DESC LIMIT 51`,
        [userId, worldId, before ?? null, entryId ?? null, actorId ?? null],
      )
    ).rows;
    if (!rows.length) return { items: [], next: null };
    const world = await this.construction.get(worldId);
    const context = world.world_id
      ? this.construction.agent.store.context(world.world_id)
      : undefined;
    const icons = (
      await this.pool.query<{ player_id: string; image: string }>(
        "SELECT player_id,image FROM world_player_icon WHERE construction_id=$1 AND player_id=ANY($2::uuid[])",
        [worldId, rows.slice(0, 50).map((r) => r.id)],
      )
    ).rows;
    return {
      items: await Promise.all(
        rows.slice(0, 50).map(async (r) => ({
          ...r,
          at: Number(r.at),
          name: r.actorId
            ? ((await context?.node(r.actorId))?.text ?? null)
            : null,
          icon: icons.find((i) => i.player_id === r.id)?.image ?? null,
        })),
      ),
      next: rows.length > 50 ? rows[49]!.id : null,
    };
  }
  async setIcon(
    userId: string,
    worldId: string,
    playerId: string,
    image: string | null,
  ) {
    if (!(await this.list(userId, worldId, undefined, playerId)).items.length)
      throw new AccessError(
        404,
        "PLAYER_NOT_FOUND",
        "設定できる人物が見つかりません",
      );
    const normalized = image === null ? null : await playerIcon(image);
    if (normalized === null)
      await this.pool.query(
        "DELETE FROM world_player_icon WHERE construction_id=$1 AND player_id=$2",
        [worldId, playerId],
      );
    else
      await this.pool.query(
        "INSERT INTO world_player_icon(player_id,construction_id,image) VALUES($1,$2,$3) ON CONFLICT(player_id) DO UPDATE SET image=excluded.image",
        [playerId, worldId, normalized],
      );
    return { image: normalized };
  }
  // Candidates must come from the caller's own displayed receipts, never from a world-wide name search.
  async characters(
    worldId: string,
    viewerId: string,
    evidence: CharacterEvidence[],
  ) {
    if (!evidence.some((e) => e.ids.length)) return evidence.map(() => []);
    const world = await this.construction.get(worldId);
    const context = this.construction.agent.store.context(world.world_id!);
    const nodes = new Map<string, ReturnType<typeof context.node>>();
    const node = (id: string) => {
      const result = nodes.get(id) ?? context.node(id);
      nodes.set(id, result);
      return result;
    };
    const allIds = [
      ...new Set(
        evidence
          .flatMap((e) => e.ids)
          .filter((id) => z.uuid().safeParse(id).success),
      ),
    ];
    const events = (await Promise.all(allIds.map(node)))
      .filter((n) => n?.kind === "event")
      .map((n) => n!.id);
    const receipts = events.length
      ? (
          await this.pool.query<{
            id: string;
            information: { id: string }[] | null;
          }>(
            `SELECT e->>'id' AS id,p->'information' AS information FROM world_scene s
       CROSS JOIN LATERAL jsonb_array_elements(s.data->'events') e
       CROSS JOIN LATERAL jsonb_array_elements(e->'receipts') p
       WHERE s.construction_id=$1 AND (s.actor_id=$2 OR s.state='result')
       AND e->>'id'=ANY($3::text[]) AND p->>'observerId'=$2::text`,
            [worldId, viewerId, events],
          )
        ).rows
      : [];
    const candidates = await Promise.all(
      evidence.map(async (e) => {
        const ids = new Set<string>();
        for (const id of new Set(
          e.ids.filter((id) => z.uuid().safeParse(id).success),
        )) {
          const source = await node(id);
          if (source?.kind === "existence") ids.add(id);
          if (source?.kind === "event")
            for (const reference of receipts
              .filter((r) => r.id === id)
              .flatMap((r) => r.information ?? []))
              if (
                z.uuid().safeParse(reference.id).success &&
                (await node(reference.id))?.kind === "existence"
              )
                ids.add(reference.id);
        }
        const named = [];
        for (const actorId of ids) {
          const person = await node(actorId);
          if (
            person?.text.trim() &&
            (e.text.includes(person.text) || (e.own && actorId === viewerId))
          )
            named.push({ actorId, name: person.text });
        }
        return named;
      }),
    );
    const rows = (
      await this.pool.query<{ actor_id: string; image: string | null }>(
        `SELECT DISTINCT a.actor_id,i.image FROM world_access a LEFT JOIN world_player_icon i ON i.player_id=a.id
       WHERE a.construction_id=$1 AND a.role='player' AND a.actor_id=ANY($2::uuid[])`,
        [worldId, [...new Set(candidates.flat().map((c) => c.actorId))]],
      )
    ).rows;
    await context.validate();
    return candidates.map((list) =>
      list.flatMap((c) => {
        const row = rows.find((r) => r.actor_id === c.actorId);
        return row
          ? [
              { ...c, icon: row.image } satisfies z.infer<
                typeof PlayerCharacter
              >,
            ]
          : [];
      }),
    );
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
  async tick(id: string, jobId?: string) {
    return RuntimeExecutions.run(this.pool, "join", id, jobId, () =>
      this.#tick(id),
    );
  }
  async #tick(id: string) {
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
      await RuntimeControl.check(this.pool, {
        userId: row.subject_id,
        role: "user",
      });
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
            await this.tick(job.data.id, job.id);
          } catch {
            console.error(
              JSON.stringify({ joinId: job.data.id, state: "paused" }),
            );
          }
      },
    );
  }
}
