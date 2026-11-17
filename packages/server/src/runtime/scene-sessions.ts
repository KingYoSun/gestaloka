import type pg from "pg";
import type { WorldStore } from "../world/store.js";
import { type SceneBackground, type RecordedSceneEvent } from "./scene-data.js";
import type { SceneRow } from "./scene.js";

type Db = Pick<pg.Pool, "query">;
export type SceneDraft = {
  sceneId: string;
  at: number;
  startedAt: number;
  background: SceneBackground;
  events: RecordedSceneEvent[];
};
type Session = {
  id: string;
  actor_id: string;
  world_id: string;
  current_id: string;
  closed: boolean;
  opening: { sceneId: string; at: number; background: SceneBackground } | null;
  result: NonNullable<SceneRow["data"]["participantResults"]>[string] | null;
  event_offset: number;
  action_offset: number;
  event_count: number;
  action_count: number;
};

/** A player's uninterrupted scene, independent of the current execution segment. */
export class SceneSessions {
  constructor(
    readonly pool: pg.Pool,
    readonly store: WorldStore,
  ) {}
  async setup() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_scene_session (
      id uuid NOT NULL,actor_id uuid NOT NULL,world_id uuid NOT NULL REFERENCES world_construction(id) ON DELETE CASCADE,
      current_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,closed boolean NOT NULL DEFAULT false,
      opening jsonb,result jsonb,event_offset integer NOT NULL DEFAULT 0,action_offset integer NOT NULL DEFAULT 0,
      event_count integer NOT NULL DEFAULT 0,action_count integer NOT NULL DEFAULT 0,PRIMARY KEY(id,actor_id));
      CREATE UNIQUE INDEX IF NOT EXISTS world_scene_session_active ON world_scene_session(world_id,actor_id) WHERE NOT closed;
      CREATE INDEX IF NOT EXISTS world_scene_session_current ON world_scene_session(current_id,actor_id);
      CREATE TABLE IF NOT EXISTS world_scene_record (
      session_id uuid NOT NULL,actor_id uuid NOT NULL,kind text NOT NULL,id uuid NOT NULL,
      scene_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,position integer NOT NULL,payload jsonb NOT NULL,
      PRIMARY KEY(session_id,actor_id,kind,id),FOREIGN KEY(session_id,actor_id) REFERENCES world_scene_session(id,actor_id) ON DELETE CASCADE);
      CREATE UNIQUE INDEX IF NOT EXISTS world_scene_record_position ON world_scene_record(session_id,actor_id,kind,position);
      ALTER TABLE world_scene_member ADD COLUMN IF NOT EXISTS session_id uuid;
      CREATE INDEX IF NOT EXISTS world_scene_member_session ON world_scene_member(session_id,actor_id);
      CREATE TABLE IF NOT EXISTS world_scene_dependency (
      child_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,
      parent_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,PRIMARY KEY(child_id,parent_id));
      CREATE INDEX IF NOT EXISTS world_scene_dependency_parent ON world_scene_dependency(parent_id);`);
  }
  async get(id: string, actor: string, db: Db = this.pool) {
    return (
      await db.query<Session>(
        "SELECT * FROM world_scene_session WHERE id=$1 AND actor_id=$2",
        [id, actor],
      )
    ).rows[0];
  }
  async resolve(id: string, actor: string, db: Db = this.pool) {
    return (await this.get(id, actor, db))?.current_id ?? id;
  }
  async records(
    id: string,
    actor: string,
    kind: "events" | "actions",
    db: Db = this.pool,
    from = 0,
    through?: number,
  ) {
    return (
      await db.query<{
        item: RecordedSceneEvent & SceneRow["data"]["actions"][number];
      }>(
        "SELECT payload AS item FROM world_scene_record WHERE session_id=$1 AND actor_id=$2 AND kind=$3 AND position >= $4 AND ($5::int IS NULL OR position <= $5) ORDER BY position",
        [id, actor, kind, from, through ?? null],
      )
    ).rows;
  }
  async present(
    row: SceneRow,
    actor: string,
    compact: boolean,
    db: Db = this.pool,
  ): Promise<{ row: SceneRow; anchorId: string; closed: boolean }> {
    const session = (
      await db.query<Session>(
        "SELECT * FROM world_scene_session WHERE current_id=$1 AND actor_id=$2",
        [row.id, actor],
      )
    ).rows[0];
    if (!session?.opening)
      return { row, anchorId: row.id, closed: session?.closed ?? false };
    const opening = session.opening.background;
    const ownResult =
      session.result ??
      (row.actor_id === actor
        ? row.data.result
          ? { text: row.data.result, information: row.data.resultInformation }
          : undefined
        : row.data.participantResults?.[actor]);
    const events = compact
      ? []
      : (await this.records(session.id, actor, "events", db)).map(
          (r) => r.item,
        );
    const actions = (await this.records(session.id, actor, "actions", db)).map(
      (r) => r.item,
    );
    const data = { ...row.data };
    delete data.result;
    delete data.resultInformation;
    if (!session.closed && data.departures?.[actor] !== undefined) {
      data.departures = { ...data.departures };
      delete data.departures[actor];
    }
    return {
      closed: session.closed,
      anchorId: session.opening.sceneId,
      row: {
        ...row,
        id: session.id,
        actor_id: actor,
        state: session.result
          ? "result"
          : session.closed && row.state !== "paused"
            ? "reflecting"
            : row.data.splitActors?.includes(actor)
              ? "acting"
              : row.state,
        data: {
          ...data,
          startedAt: session.opening.at,
          background: {
            ...opening,
            synopsis:
              actor ===
              (
                await db.query<{ actor_id: string }>(
                  "SELECT actor_id FROM world_scene WHERE id=$1",
                  [session.opening.sceneId],
                )
              ).rows[0]?.actor_id
                ? opening.synopsis
                : opening.perceptions
                    .filter((p) => p.observerId === actor)
                    .map((p) => p.text)
                    .join("\n\n"),
          },
          events,
          actions: compact ? actions.slice(-1) : actions,
          ...(ownResult?.text ? { result: ownResult.text } : {}),
          ...(ownResult?.information
            ? { resultInformation: ownResult.information }
            : {}),
        },
      },
    };
  }
}
