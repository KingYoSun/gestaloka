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
};

/** Delivery of a recorded reception; participation and world-path calculation are not prerequisites. */
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
      CREATE INDEX IF NOT EXISTS world_contact_pending ON world_player_contact(world_id,listener) WHERE state='pending';`);
  }
  async received(
    scene: string,
    actors: string[],
    db: Pick<pg.Pool, "query"> = this.shared.pool,
  ) {
    return (
      await db.query<{
        eventId: string;
        speaker: string;
        listener: string;
        at: number;
        text: string;
        replyInputId: string | null;
      }>(
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
    const wait = intent.replyWait;
    return (
      !wait ||
      (await this.received(scene, [intent.actorId], db)).some(
        (r) =>
          wait.actors.includes(r.speaker) &&
          !wait.seenEventIds.includes(r.eventId),
      )
    );
  }
  async deliver(
    db: pg.PoolClient,
    row: SceneRow,
    decisions: ContactDecision[],
  ) {
    for (const { listener, eventId, inputId, speaker, text } of decisions) {
      const id = sceneId(`${eventId}:contact:${listener}`),
        deadline = new Date(
          this.shared.now().getTime() + this.shared.turns.replyMs,
        );
      if (
        (await db.query("SELECT 1 FROM world_player_contact WHERE id=$1", [id]))
          .rowCount
      )
        continue;
      const { WorldScenes } = await import("./scene.js");
      const target = await new WorldScenes(this.shared.construction).reception(
        row.construction_id,
        listener,
        speaker,
        row.data.at,
        id,
        db,
      );
      const inserted = await db.query(
        `INSERT INTO world_player_contact(id,world_id,source_scene,target_scene,speaker,listener,event_id,input_id,at,text,deadline)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING`,
        [
          id,
          row.construction_id,
          row.id,
          target.id,
          speaker,
          listener,
          eventId,
          inputId,
          row.data.at,
          text,
          deadline,
        ],
      );
      if (!inserted.rowCount) continue;
      await this.shared.wake(db, target.id);
      await this.shared.notice(
        db,
        row.construction_id,
        listener,
        target.id,
        "opportunity",
        {
          contact: true,
          opportunityId: id,
          sourceInputId: inputId,
          context: [text],
          deadline: deadline.toISOString(),
        },
      );
      await this.shared.notice(
        db,
        row.construction_id,
        speaker,
        row.id,
        "opportunity",
        {
          contactOutcome: "delivered",
          sourceInputId: inputId,
          context: ["働きかけを届けました。返答は相手が選びます。"],
        },
      );
      await this.shared.schedule(
        db,
        `contact:${id}`,
        { contactId: id },
        deadline,
      );
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
  async #wakeWaiting(db: pg.PoolClient, source: string, target: string | null) {
    for (const { id } of (
      await db.query<{ id: string }>(
        "SELECT id FROM world_scene WHERE id=ANY($1::uuid[]) AND state='active' AND data ? 'turns'",
        [[source, target]],
      )
    ).rows)
      await this.shared.wake(db, id);
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
    const contact = (
      await db.query(
        "SELECT * FROM world_player_contact WHERE id=$1 AND listener=$2 AND target_scene IS NOT DISTINCT FROM $3::uuid FOR UPDATE",
        [id, actor, row?.id ?? null],
      )
    ).rows[0];
    if (!contact) return false;
    if (contact.state !== "pending" || contact.deadline <= this.shared.now())
      throw new ConstructionStateError("この呼びかけには現在返答できません");
    const group =
      text !== null &&
      row?.data.turns &&
      row.state !== "reflecting" &&
      row.state !== "result";
    const queued = text !== null && !group && row?.state !== "active";
    if (group)
      await this.shared.turns.receiveChoice(
        db,
        row,
        actor,
        kind,
        request,
        text,
      );
    await db.query(
      "UPDATE world_player_contact SET state=$2,reply_id=$3,queued_text=$4,reply_kind=$5 WHERE id=$1",
      [
        id,
        text === null ? "declined" : "answered",
        request,
        queued ? text : null,
        kind,
      ],
    );
    await this.#wakeWaiting(db, contact.source_scene, row?.id ?? null);
    if (queued && row && ["ready", "active"].includes(row.state))
      await this.shared.wake(db, row.id);
    return group || queued || text === null ? "accepted" : "act";
  }
  async nextReply(db: pg.PoolClient, scene: string) {
    return (
      await db.query<{
        requestId: string;
        actionText: string;
        actor: string;
        kind: "human" | "bot";
      }>(
        `WITH next AS (SELECT id,queued_text FROM world_player_contact WHERE target_scene=$1 AND queued_text IS NOT NULL ORDER BY deadline,id LIMIT 1 FOR UPDATE)
       UPDATE world_player_contact c SET queued_text=NULL FROM next WHERE c.id=next.id RETURNING c.reply_id AS "requestId",next.queued_text AS "actionText",c.listener AS actor,c.reply_kind AS kind`,
        [scene],
      )
    ).rows[0];
  }
  async expire(db: pg.PoolClient, id: string) {
    const r = (
      await db.query(
        "UPDATE world_player_contact SET state='expired' WHERE id=$1 AND state='pending' AND deadline<=$2 RETURNING *",
        [id, this.shared.now()],
      )
    ).rows[0];
    if (r) {
      await this.#wakeWaiting(db, r.source_scene, r.target_scene);
      await this.shared.notice(
        db,
        r.world_id,
        r.speaker,
        r.source_scene,
        "opportunity",
        {
          contactOutcome: "unanswered",
          sourceInputId: r.input_id,
          context: ["相手からの返答はまだ届いていません。"],
        },
      );
    }
  }
}
