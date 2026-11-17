import type pg from "pg";
import { z } from "zod";
import type { WorldConstruction } from "./construction.js";
import { SharedTurns } from "./shared-turns.js";
import { PlayerContacts } from "./player-contact.js";
import { SceneSessions } from "./scene-sessions.js";

export const SceneSelection = z
  .object({
    type: z.literal("selection"),
    candidates: z.array(z.uuid()),
    mergeInto: z.uuid().nullable(),
  })
  .strict();
type Selection = z.infer<typeof SceneSelection>;
type SharedRow = {
  scene_id: string;
  world_id: string;
  owner_id: string;
  at: string;
  sequence: string;
  phase: "selecting" | "inviting" | "settled" | "offered" | "merged";
  offer_to: string | null;
  deadline: Date | null;
  plan: Selection | null;
  own_context: string[];
};
type Member = {
  scene_id: string;
  world_id: string;
  actor_id: string;
  request_id: string;
  last_request_id: string | null;
  session_id: string | null;
  state: "reserved" | "joined" | "left" | "ended";
  kind: "human" | "bot";
};

/** Connections and invitations are control state, never world observations or player intentions. */
export class SharedScenes {
  readonly deadlineQueue: string;
  readonly sceneQueue: string;
  readonly turns: SharedTurns;
  readonly sessions: SceneSessions;
  readonly contacts = new PlayerContacts(this);
  readonly invitationMs =
    Number(process.env.SCENE_INVITATION_SECONDS ?? 300) * 1000;
  constructor(
    readonly construction: WorldConstruction,
    readonly now = () => new Date(),
  ) {
    this.sceneQueue = `${construction.queueName}-shared-scenes`;
    this.deadlineQueue = `${construction.queueName}-scene-deadlines`;
    this.turns = new SharedTurns(this);
    this.sessions = new SceneSessions(
      construction.pool,
      construction.agent.store,
    );
  }
  get pool() {
    return this.construction.pool;
  }
  async setup() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_scene_presence (
      id uuid PRIMARY KEY,world_id uuid NOT NULL REFERENCES world_construction(id) ON DELETE CASCADE,
      actor_id uuid NOT NULL,user_id uuid NOT NULL,device_id uuid,kind text NOT NULL,active boolean NOT NULL,expires_at timestamptz NOT NULL);
      CREATE INDEX IF NOT EXISTS world_scene_presence_actor ON world_scene_presence(world_id,actor_id,kind,expires_at) WHERE active;
      CREATE TABLE IF NOT EXISTS world_shared_scene (
      scene_id uuid PRIMARY KEY REFERENCES world_scene(id) ON DELETE CASCADE,world_id uuid NOT NULL,owner_id uuid NOT NULL,
      at bigint NOT NULL,sequence bigserial UNIQUE,phase text NOT NULL DEFAULT 'selecting',offer_to uuid,deadline timestamptz,plan jsonb,own_context jsonb NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS world_scene_member (
      scene_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,world_id uuid NOT NULL,actor_id uuid NOT NULL,
      request_id uuid NOT NULL,last_request_id uuid,state text NOT NULL,PRIMARY KEY(scene_id,actor_id));
      CREATE UNIQUE INDEX IF NOT EXISTS world_scene_member_active ON world_scene_member(world_id,actor_id) WHERE state IN ('reserved','joined');
      CREATE TABLE IF NOT EXISTS world_actor_scene(world_id uuid NOT NULL,actor_id uuid NOT NULL,scene_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,PRIMARY KEY(world_id,actor_id));
      CREATE TABLE IF NOT EXISTS world_scene_invitation (
      id uuid PRIMARY KEY,scene_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,actor_id uuid NOT NULL,
      state text NOT NULL DEFAULT 'pending',deadline timestamptz NOT NULL,context jsonb NOT NULL,UNIQUE(scene_id,actor_id));
      CREATE TABLE IF NOT EXISTS world_scene_notice (
      id bigserial PRIMARY KEY,world_id uuid NOT NULL REFERENCES world_construction(id) ON DELETE CASCADE,actor_id uuid NOT NULL,
      scene_id uuid REFERENCES world_scene(id) ON DELETE CASCADE,kind text NOT NULL,data jsonb NOT NULL);
      CREATE INDEX IF NOT EXISTS world_scene_notice_actor ON world_scene_notice(world_id,actor_id,id);`);
    await this.pool.query(
      "ALTER TABLE world_scene_member ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'human'",
    );
    await this.turns.setup();
    await this.sessions.setup();
    await this.contacts.setup();
    await this.construction.queue.createQueue(this.deadlineQueue, {
      retryLimit: 2,
      retryDelay: 1,
    });
    await this.construction.queue.createQueue(this.sceneQueue, {
      policy: "singleton",
      retryLimit: 2,
      retryDelay: 5,
      expireInSeconds: 900,
      heartbeatSeconds: 30,
    });
  }
  async active(
    world: string,
    actors: string[],
    kind?: "human" | "bot",
    db: Pick<pg.Pool, "query"> = this.pool,
  ) {
    return (
      await db.query<{ actor_id: string }>(
        `SELECT DISTINCT p.actor_id FROM world_scene_presence p JOIN app_user u ON u.id=p.user_id
      LEFT JOIN player_device d ON d.id=p.device_id WHERE p.world_id=$1 AND p.actor_id=ANY($2::uuid[]) AND ($3::text IS NULL OR p.kind=$3)
      AND p.active AND p.expires_at>$4 AND NOT u.banned AND (p.device_id IS NULL OR NOT d.revoked)`,
        [world, actors, kind, this.now()],
      )
    ).rows.map((r) => r.actor_id);
  }
  async get(scene: string, db: Pick<pg.Pool, "query"> = this.pool) {
    return (
      await db.query<SharedRow>(
        "SELECT * FROM world_shared_scene WHERE scene_id=$1",
        [scene],
      )
    ).rows[0];
  }
  async members(scene: string, db: Pick<pg.Pool, "query"> = this.pool) {
    return (
      await db.query<Member>(
        "SELECT * FROM world_scene_member WHERE scene_id=$1 ORDER BY actor_id",
        [scene],
      )
    ).rows;
  }
  async state(
    scene: string,
    actor: string,
    db: Pick<pg.Pool, "query"> = this.pool,
  ) {
    const row = await this.get(scene, db);
    if (!row || row.phase === "merged") return undefined;
    const pending = await db.query(
      "SELECT id FROM world_scene_invitation WHERE scene_id=$1 AND state='pending'",
      [scene],
    );
    return {
      ...(await this.turns.control(scene, db)),
      requestIds: (await this.members(scene, db))
        .filter((m) => m.actor_id === actor)
        .flatMap((m) => [
          m.request_id,
          ...(m.last_request_id ? [m.last_request_id] : []),
        ]),
      owner: row.owner_id === actor,
      phase: row.phase === "offered" ? "inviting" : row.phase,
      pending: pending.rowCount ?? 0,
      deadline: row.deadline?.toISOString() ?? null,
    };
  }
  async waiting(scene: string, db: Pick<pg.Pool, "query"> = this.pool) {
    const row = (
      await db.query<{
        state: string;
        actor_id: string;
        construction_id: string;
        data: {
          worldId: string;
          at: number;
          work?: { kind: string; actorId?: string };
          awaiting?: string[];
        };
      }>(
        "SELECT state,actor_id,construction_id,jsonb_build_object('worldId',data->'worldId','at',data->'at','work',data->'work','awaiting',data->'awaiting') AS data FROM world_scene WHERE id=$1",
        [scene],
      )
    ).rows[0];
    if (!row || row.state === "result") return [];
    if ((await this.turns.control(scene, db))?.flow === "closing")
      return [
        {
          kind: "system" as const,
          actors: [],
          reason:
            row.state === "paused"
              ? "終了要求は保存されています。終了処理を保留しています"
              : "終了要求を受け付けました。受理済みの処理を整理しています",
          deadline: null,
        },
      ];
    const answers = (
      await db.query<{ actor: string; deadline: Date }>(
        `
      SELECT r.actor_id AS actor,w.deadline FROM world_scene_wave w JOIN world_scene_reply r ON r.wave_id=w.id
      WHERE w.scene_id=$1 AND w.state='pending' AND r.state='pending'
      UNION ALL SELECT actor_id,deadline FROM world_scene_invitation WHERE scene_id=$1 AND state='pending'
      UNION ALL SELECT listener,deadline FROM world_player_contact WHERE source_scene=$1 AND state='pending'
      UNION ALL SELECT a.actor_id,v.deadline FROM world_scene_end_vote v JOIN world_scene_end_answer a ON a.vote_id=v.id
      WHERE v.scene_id=$1 AND v.state='pending' AND a.answer IS NULL`,
        [scene],
      )
    ).rows;
    const context = this.construction.agent.store.context(row.data.worldId);
    const actors = async (ids: string[]) =>
      Promise.all(
        [...new Set(ids)].map(async (id) => ({
          id,
          name: (await context.node(id, row.data.at))?.text ?? "参加者",
        })),
      );
    const waiting: {
      kind: "participants" | "npc" | "system";
      actors: { id: string; name: string }[];
      reason: string;
      deadline: string | null;
    }[] = [];
    if (answers.length)
      waiting.push({
        kind: "participants",
        actors: await actors(answers.map((a) => a.actor)),
        reason: "回答を待っています",
        deadline: new Date(
          Math.min(...answers.map((a) => a.deadline.getTime())),
        ).toISOString(),
      });
    if (["preparing", "acting", "reflecting", "paused"].includes(row.state)) {
      const npc = row.data.work?.kind === "intent" && row.data.work.actorId;
      waiting.push({
        kind: npc ? "npc" : "system",
        actors: npc ? await actors([npc]) : [],
        reason:
          row.state === "reflecting"
            ? "リザルトを生成しています"
            : row.state === "paused"
              ? "処理を保留しています"
              : row.state === "preparing"
                ? "場面を準備しています"
                : npc
                  ? "次の判断を生成しています"
                  : "行動の結果を生成しています",
        deadline: null,
      });
    } else {
      const human = await this.active(
        row.construction_id,
        row.data.awaiting ?? [],
        "human",
        db,
      );
      if (!waiting.length || human.length)
        waiting.push({
          kind: "participants",
          actors: await actors(human.length ? human : [row.actor_id]),
          reason:
            row.state === "ready"
              ? "シーンの開始を待っています"
              : "次の入力を待っています",
          deadline: null,
        });
    }
    return waiting;
  }
}
