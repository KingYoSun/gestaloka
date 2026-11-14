import type pg from "pg";
import { isDeepStrictEqual } from "node:util";
import type { SharedScenes } from "./shared-scenes.js";
import type { SceneRow } from "./scene.js";
import { ConstructionStateError } from "./construction.js";
import { sceneId } from "./scene-data.js";

type Db = Pick<pg.Pool, "query">;
type PlayerState = {
  actorId: string;
  sceneId: string;
  startedAt: number;
  at: number;
  facts: { text: string; aboutIds: string[]; at: number }[];
  actions: { text: string; period: { from: number; until: number } }[];
  available: boolean;
};
export class ContactChanged extends Error {
  override readonly name = "ContactChanged";
}
export type ContactDecision = {
  player: PlayerState;
  eventId: string;
  inputId: string;
  speaker: string;
  text: string | null;
};

/** A contact references its source scene's event. Only that scene commits it. */
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
  async states(
    row: SceneRow,
    actors: string[],
    db: Db = this.shared.pool,
    lock = false,
  ) {
    if (!actors.length) return [];
    const rows = (
      await db.query<Omit<PlayerState, "available"> & { canRespond: boolean }>(
        `SELECT p.actor_id AS "actorId",s.id AS "sceneId",(s.data->>'startedAt')::float8 AS "startedAt",
       (s.data->>'at')::float8 AS at,s.state IN ('active','acting') AND NOT (s.data ? 'encounter' OR s.data ? 'soloProposal')
       AND coalesce(h.flow,'open')='open' AS "canRespond",
       ARRAY(SELECT jsonb_build_object('text',f->>'text','aboutIds',f->'aboutIds','at',coalesce(f->'at',s.data->'startedAt'))
         FROM jsonb_array_elements(s.data#>'{background,facts}') f WHERE f->>'subjectId'=p.actor_id::text) AS facts,
       ARRAY(SELECT jsonb_build_object('text',e->>'text','period',e->'period')
         FROM jsonb_array_elements(s.data->'events') e WHERE e->>'actorId'=p.actor_id::text) AS actions
       FROM world_actor_scene p JOIN world_scene s ON s.id=p.scene_id
       LEFT JOIN world_shared_scene h ON h.scene_id=s.id
       JOIN world_controlled_actor a ON a.world_id=$4 AND a.actor_id=p.actor_id AND NOT a.npc_active
       WHERE p.world_id=$1 AND p.actor_id=ANY($2::uuid[]) AND s.id<>$3
       AND s.state<>'result'
       AND NOT coalesce(s.data->'departures','{}') ? p.actor_id::text
       ORDER BY p.actor_id ${lock ? "FOR SHARE OF s" : ""}`,
        [row.construction_id, actors, row.id, row.data.worldId],
      )
    ).rows;
    if (!rows.length) return [];
    const awake = await this.shared.active(
      row.construction_id,
      rows.map((p) => p.actorId),
      undefined,
      db,
    );
    const available = new Set(awake);
    return rows.map(({ canRespond, ...p }) => ({
      ...p,
      available: canRespond && available.has(p.actorId),
    }));
  }
  async received(scene: string, actors: string[]) {
    return (
      await this.shared.pool.query<{
        eventId: string;
        speaker: string;
        listener: string;
        at: number;
        text: string;
        replyInputId: string | null;
      }>(
        `SELECT c.event_id AS "eventId",c.speaker,c.listener,c.at::float8,c.text,c.reply_id AS "replyInputId" FROM world_player_contact c
       WHERE c.target_scene=$1 AND c.listener=ANY($2::uuid[]) ORDER BY c.at,c.id`,
        [scene, actors],
      )
    ).rows;
  }
  async deliver(
    db: pg.PoolClient,
    row: SceneRow,
    decisions: ContactDecision[],
  ) {
    const current = await this.states(
      row,
      decisions.map((d) => d.player.actorId),
      db,
      true,
    );
    for (const { player, eventId, inputId, speaker, text } of decisions) {
      if (
        !isDeepStrictEqual(
          current.find((p) => p.actorId === player.actorId),
          player,
        )
      )
        throw new ContactChanged();
      const id = sceneId(`${eventId}:contact:${player.actorId}`);
      const status =
        text === null
          ? "呼びかけは届きませんでした。"
          : "呼びかけを届けました。";
      if (text !== null) {
        const deadline = new Date(
          this.shared.now().getTime() + this.shared.turns.replyMs,
        );
        await db.query(
          `INSERT INTO world_player_contact(id,world_id,source_scene,target_scene,speaker,listener,event_id,input_id,at,text,deadline)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            row.construction_id,
            row.id,
            player.sceneId,
            speaker,
            player.actorId,
            eventId,
            inputId,
            row.data.at,
            text,
            deadline,
          ],
        );
        await this.shared.notice(
          db,
          row.construction_id,
          player.actorId,
          player.sceneId,
          "opportunity",
          {
            contact: true,
            opportunityId: id,
            sourceInputId: inputId,
            context: [text],
            deadline: deadline.toISOString(),
          },
        );
        await this.shared.schedule(
          db,
          `contact:${id}`,
          { contactId: id },
          deadline,
        );
      }
      await this.shared.notice(
        db,
        row.construction_id,
        speaker,
        row.id,
        "opportunity",
        {
          contactOutcome: text === null ? "unreachable" : "delivered",
          sourceInputId: inputId,
          context: [status],
        },
      );
    }
  }
  async opportunities(world: string, actor: string) {
    return (
      await this.shared.pool.query(
        `SELECT id,target_scene AS "sceneId",input_id AS "sourceInputId", deadline,
      ARRAY[event_id] AS "seenEventIds",ARRAY[text] AS context FROM world_player_contact
      WHERE world_id=$1 AND listener=$2 AND state='pending' AND deadline>$3 ORDER BY deadline,id`,
        [world, actor, this.shared.now()],
      )
    ).rows.map((r) => ({ ...r, deadline: r.deadline.toISOString() }));
  }
  async answer(
    db: pg.PoolClient,
    row: SceneRow,
    actor: string,
    id: string,
    request: string,
    text: string | null,
    kind: "human" | "bot",
  ) {
    const contact = (
      await db.query(
        `SELECT * FROM world_player_contact WHERE id=$1 AND target_scene=$2 AND listener=$3 FOR UPDATE`,
        [id, row.id, actor],
      )
    ).rows[0];
    if (!contact) return false;
    if (
      contact.state !== "pending" ||
      contact.deadline <= this.shared.now() ||
      !["active", "acting"].includes(row.state)
    )
      throw new ConstructionStateError("この呼びかけには現在返答できません");
    const queued = text !== null && row.state === "acting" && !row.data.turns;
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
    if (text === null)
      await this.shared.notice(
        db,
        row.construction_id,
        contact.speaker,
        contact.source_scene,
        "opportunity",
        {
          contactOutcome: "unanswered",
          sourceInputId: contact.input_id,
          context: ["呼びかけは届きましたが、返答はありませんでした。"],
        },
      );
    return queued || text === null ? "accepted" : "act";
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
    if (r)
      await this.shared.notice(
        db,
        r.world_id,
        r.speaker,
        r.source_scene,
        "opportunity",
        {
          contactOutcome: "unanswered",
          sourceInputId: r.input_id,
          context: [
            "呼びかけは届きましたが、期限までに返答はありませんでした。",
          ],
        },
      );
  }
}
