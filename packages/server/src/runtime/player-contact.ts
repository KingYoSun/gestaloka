import type pg from "pg";
import type { SharedScenes } from "./shared-scenes.js";
import type { SceneRow } from "./scene.js";
import { ConstructionStateError } from "./construction.js";
import { sceneId, type SceneIntent } from "./scene-data.js";

export type ContactDecision = {
  listener: string;
  eventId: string;
  inputId: string;
  speaker: string;
  text: string;
  independent?: boolean;
};
export type ReceivedContact = {
  eventId: string;
  speaker: string;
  listener: string;
  at: number;
  text: string;
  replyInputId: string | null;
};

/** Stage a common execution; old opportunities are adapted at the reply boundary. */
export class PlayerContacts {
  constructor(readonly shared: SharedScenes) {}
  async setup() {
    await this.shared.pool
      .query(`CREATE TABLE IF NOT EXISTS world_player_contact (
      id uuid PRIMARY KEY,world_id uuid NOT NULL,source_scene uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,
      target_scene uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,speaker uuid NOT NULL,listener uuid NOT NULL,
      event_id uuid NOT NULL,input_id uuid NOT NULL,at bigint NOT NULL,text text NOT NULL,deadline timestamptz NOT NULL,
      state text NOT NULL DEFAULT 'pending',reply_id uuid UNIQUE,queued_text text,reply_kind text);
      CREATE INDEX IF NOT EXISTS world_contact_listener ON world_player_contact(target_scene,listener,at);
      CREATE INDEX IF NOT EXISTS world_contact_pending ON world_player_contact(world_id,listener) WHERE state='pending';
      CREATE INDEX IF NOT EXISTS world_contact_handoff_source ON world_player_contact(world_id,speaker) WHERE state='handoff';
      CREATE INDEX IF NOT EXISTS world_contact_handoff_listener ON world_player_contact(world_id,listener) WHERE state='handoff';`);
  }
  async received(
    scene: string,
    actors: string[],
    db: Pick<pg.Pool, "query"> = this.shared.pool,
  ) {
    return (
      await db.query<ReceivedContact>(
        `SELECT event_id AS "eventId",speaker,listener,at::float8,text,reply_id AS "replyInputId"
      FROM world_player_contact WHERE target_scene=$1 AND listener=ANY($2::uuid[]) ORDER BY at,id`,
        [scene, actors],
      )
    ).rows;
  }
  async ready(
    scene: string,
    intent: SceneIntent,
    db: Pick<pg.Pool, "query"> = this.shared.pool,
  ) {
    return this.shared.sessions.ready(scene, intent, db);
  }
  async deliver(
    db: pg.PoolClient,
    row: SceneRow,
    decisions: ContactDecision[],
  ) {
    for (const d of decisions) {
      const previous = row.data.sessionIds?.[d.listener];
      if (
        previous &&
        d.independent === false &&
        (await this.shared.sessions.get(previous, d.listener, db))?.closed
      )
        continue;
      const id = sceneId(`${d.eventId}:contact:${d.listener}`);
      if (
        (await db.query("SELECT 1 FROM world_player_contact WHERE id=$1", [id]))
          .rowCount
      )
        continue;
      const { WorldScenes } = await import("./scene.js");
      const target = await new WorldScenes(this.shared.construction).reception(
        row.construction_id,
        d.listener,
        d.speaker,
        row.data.at,
        id,
        db,
      );
      await db.query(
        `INSERT INTO world_player_contact(id,world_id,source_scene,target_scene,speaker,listener,event_id,input_id,at,text,deadline,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'handoff') ON CONFLICT DO NOTHING`,
        [
          id,
          row.construction_id,
          row.id,
          target.id,
          d.speaker,
          d.listener,
          d.eventId,
          d.inputId,
          row.data.at,
          d.text,
          this.shared.now(),
        ],
      );
      await this.shared.wake(db, row.id);
      await this.shared.wake(db, target.id);
    }
  }
  async pending(db: pg.PoolClient, world: string, actor: string, id: string) {
    return (
      await db.query<{
        id: string;
        target_scene: string;
        source_scene: string;
        text: string;
        speaker: string;
        at: string;
        deadline: Date;
        state: string;
      }>(
        "SELECT * FROM world_player_contact WHERE id=$1 AND world_id=$2 AND listener=$3 FOR UPDATE",
        [id, world, actor],
      )
    ).rows[0];
  }
  async opportunities(world: string, actor: string) {
    return (
      await this.shared.pool.query(
        `SELECT id,target_scene AS "sceneId",input_id AS "sourceInputId",deadline,
      ARRAY[event_id] AS "seenEventIds",ARRAY[text] AS context FROM world_player_contact
      WHERE world_id=$1 AND listener=$2 AND state='pending' AND deadline>$3 ORDER BY deadline,id`,
        [world, actor, this.shared.now()],
      )
    ).rows.map((r) => ({ ...r, deadline: r.deadline.toISOString() }));
  }
  async answer(
    db: pg.PoolClient,
    row: SceneRow | null,
    actor: string,
    id: string,
    request: string,
    text: string | null,
    kind: "human" | "bot",
  ) {
    const c = (
      await db.query(
        "SELECT * FROM world_player_contact WHERE id=$1 AND listener=$2 AND target_scene IS NOT DISTINCT FROM $3::uuid FOR UPDATE",
        [id, actor, row?.id ?? null],
      )
    ).rows[0];
    if (!c) return false;
    if (c.state !== "pending" || c.deadline <= this.shared.now())
      throw new ConstructionStateError("この呼びかけには現在返答できません");
    if (
      text !== null &&
      row &&
      (await this.shared.turns.control(row.id, db, true)).flow === "closing"
    )
      throw new ConstructionStateError("シーンは終了処理中です");
    await db.query(
      "UPDATE world_player_contact SET state=$2,reply_id=$3,queued_text=$4,reply_kind=$5 WHERE id=$1",
      [id, text === null ? "declined" : "handoff", request, text, kind],
    );
    if (row && text !== null && ["ready", "active"].includes(row.state)) {
      row.state = "acting";
      await db.query(
        "UPDATE world_scene SET state='acting',claim=NULL WHERE id=$1",
        [row.id],
      );
    }
    for (const scene of new Set(
      [c.source_scene, row?.id].filter((s): s is string => !!s),
    ))
      await this.shared.wake(db, scene);
    return "accepted" as const;
  }
  async expire(db: pg.PoolClient, id: string) {
    const c = (
      await db.query(
        "UPDATE world_player_contact SET state='expired' WHERE id=$1 AND state='pending' AND deadline<=$2 RETURNING *",
        [id, this.shared.now()],
      )
    ).rows[0];
    if (c)
      for (const scene of [c.source_scene, c.target_scene])
        await this.shared.wake(db, scene);
  }
}
