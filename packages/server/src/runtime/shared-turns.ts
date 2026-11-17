import type pg from "pg";
import type { SharedScenes } from "./shared-scenes.js";
import type { SceneEnding } from "./scene-data.js";

type Db = Pick<pg.Pool, "query">;
export type SharedTurn = {
  id: string;
  npcActor?: string;
  npcSession?: string;
  continuingActor?: string;
  sourceId: string;
  sourceKind: "human" | "bot";
  eventStart: number;
  reply: boolean;
  idleInput?: true;
  inputs: {
    id: string;
    actorId: string;
    text: string;
    leave?: true;
    seen: string[];
  }[];
};
type Flow = "open" | "manual" | "voting" | "rounds" | "inactive" | "closing";
type Offer = {
  turn: Pick<SharedTurn, "id" | "sourceKind" | "reply">;
  targets: string[];
};
type Control = {
  scene_id: string;
  flow: Flow;
  rounds: number;
  inactive_until: Date | null;
  resume_flow: Flow | null;
  continuation: Offer | Offer[] | null;
  end_reason: SceneEnding | null;
  last_idle_actor: string | null;
};

/** Durable external decisions. No model calls, narrative generation, or world writes. */
export class SharedTurns {
  readonly replyMs = Number(process.env.SCENE_REACTION_SECONDS ?? 300) * 1000;
  readonly humanRounds = Number(process.env.SCENE_HUMAN_ROUNDS ?? 5);
  readonly botRounds = Number(process.env.SCENE_BOT_ROUNDS ?? 10);
  constructor(readonly shared: SharedScenes) {}
  get pool() {
    return this.shared.pool;
  }
  async setup() {
    await this.pool
      .query(`ALTER TABLE world_shared_scene ADD COLUMN IF NOT EXISTS flow text NOT NULL DEFAULT 'open';
      ALTER TABLE world_shared_scene ADD COLUMN IF NOT EXISTS rounds integer NOT NULL DEFAULT 0;
      ALTER TABLE world_shared_scene ADD COLUMN IF NOT EXISTS last_idle_actor uuid;
      ALTER TABLE world_shared_scene ADD COLUMN IF NOT EXISTS continuation jsonb;
      ALTER TABLE world_shared_scene ADD COLUMN IF NOT EXISTS end_reason text;
      ALTER TABLE world_shared_scene ADD COLUMN IF NOT EXISTS inactive_until timestamptz,
        ADD COLUMN IF NOT EXISTS resume_flow text;
      CREATE TABLE IF NOT EXISTS world_scene_turn (
      id uuid PRIMARY KEY,scene_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,
      actor_id uuid NOT NULL,kind text NOT NULL,command text NOT NULL,data jsonb NOT NULL,
      state text NOT NULL DEFAULT 'queued',sequence bigserial UNIQUE);
      CREATE INDEX IF NOT EXISTS world_scene_turn_queued ON world_scene_turn(scene_id,sequence) WHERE state='queued';
      CREATE TABLE IF NOT EXISTS world_scene_wave (
      id uuid PRIMARY KEY,scene_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,
      source_id uuid NOT NULL,source_kind text NOT NULL,deadline timestamptz NOT NULL,state text NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS world_scene_reply (
      id uuid PRIMARY KEY,wave_id uuid NOT NULL REFERENCES world_scene_wave(id) ON DELETE CASCADE,
      actor_id uuid NOT NULL,request_id uuid,state text NOT NULL DEFAULT 'pending',text text,seen jsonb NOT NULL,context jsonb NOT NULL,
      UNIQUE(wave_id,actor_id));
      CREATE TABLE IF NOT EXISTS world_scene_end_vote (
      id uuid PRIMARY KEY,scene_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,
      deadline timestamptz NOT NULL,state text NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS world_scene_end_answer (
      vote_id uuid NOT NULL REFERENCES world_scene_end_vote(id) ON DELETE CASCADE,actor_id uuid NOT NULL,answer boolean,
      PRIMARY KEY(vote_id,actor_id));
      ALTER TABLE world_scene_end_answer ADD COLUMN IF NOT EXISTS proposal_id uuid;
      DROP INDEX IF EXISTS world_scene_end_vote_pending;
      CREATE INDEX IF NOT EXISTS world_scene_end_vote_open ON world_scene_end_vote(scene_id) WHERE state='pending';`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_scene_absence (
      scene_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,actor_id uuid NOT NULL,
      from_event integer NOT NULL,through_event integer,PRIMARY KEY(scene_id,actor_id,from_event));
      CREATE UNIQUE INDEX IF NOT EXISTS world_scene_absence_open ON world_scene_absence(scene_id,actor_id) WHERE through_event IS NULL;`);
  }
  async control(scene: string, db: Db = this.pool, lock = false) {
    return (
      await db.query<Control>(
        `SELECT scene_id,flow,rounds,continuation,end_reason,inactive_until,resume_flow,last_idle_actor FROM world_shared_scene WHERE scene_id=$1 ${lock ? "FOR UPDATE" : ""}`,
        [scene],
      )
    ).rows[0]!;
  }
}
