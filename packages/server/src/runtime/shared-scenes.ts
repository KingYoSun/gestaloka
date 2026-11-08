import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { SceneInbox, ScenePresenceStatus } from "@gestaloka/contracts";
import type { WorldConstruction } from "./construction.js";
import { ConstructionStateError } from "./construction.js";

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
  state: "reserved" | "joined" | "left" | "ended";
};
const conflict = (text: string) => new ConstructionStateError(text);

/** Connections and invitations are control state, never world observations or player intentions. */
export class SharedScenes {
  readonly deadlineQueue: string;
  readonly sceneQueue: string;
  constructor(
    readonly construction: WorldConstruction,
    readonly now = () => new Date(),
  ) {
    this.sceneQueue = `${construction.queueName}-shared-scenes`;
    this.deadlineQueue = `${construction.queueName}-scene-deadlines`;
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
  async transaction<T>(work: (db: pg.PoolClient) => Promise<T>) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const value = await work(db);
      await db.query("COMMIT");
      return value;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async lock(db: pg.PoolClient, world: string) {
    await db.query("SELECT id FROM world_construction WHERE id=$1 FOR UPDATE", [
      world,
    ]);
  }
  async wake(db: pg.PoolClient, sceneId: string) {
    await this.construction.queue.send(
      this.sceneQueue,
      { id: sceneId },
      {
        singletonKey: sceneId,
        db: { executeSql: (text, values) => db.query(text, values) },
      },
    );
  }
  async schedule(db: pg.PoolClient, key: string, data: object, at: Date) {
    await this.construction.queue.upsert(this.deadlineQueue, data, {
      singletonKey: key,
      startAfter: at,
      db: { executeSql: (text, values) => db.query(text, values) },
    });
  }
  async notice(
    db: pg.PoolClient,
    world: string,
    actor: string,
    scene: string | null,
    kind: string,
    data: object = {},
  ) {
    await db.query(
      "INSERT INTO world_scene_notice(world_id,actor_id,scene_id,kind,data) VALUES($1,$2,$3,$4,$5)",
      [world, actor, scene, kind, data],
    );
    await db.query(
      `INSERT INTO world_event(subject_id,construction_id,role,event_key)
      SELECT a.subject_id,a.construction_id,'player',gen_random_uuid()::text FROM world_access a JOIN world_subject s ON s.id=a.subject_id
      WHERE a.construction_id=$1 AND a.actor_id=$2 AND a.role='player' AND s.active`,
      [world, actor],
    );
  }
  async presence(
    db: pg.PoolClient,
    world: string,
    actor: string,
    user: string,
    id: string,
    active: boolean,
    kind: "human" | "bot",
    device?: string,
  ) {
    const expires = new Date(this.now().getTime() + (active ? 90000 : 0));
    const result = await db.query(
      `INSERT INTO world_scene_presence(id,world_id,actor_id,user_id,device_id,kind,active,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET active=$7,expires_at=$8
      WHERE world_scene_presence.world_id=$2 AND world_scene_presence.actor_id=$3 AND world_scene_presence.user_id=$4
      AND world_scene_presence.kind=$6 AND world_scene_presence.device_id IS NOT DISTINCT FROM $5 RETURNING id`,
      [id, world, actor, user, device ?? null, kind, active, expires],
    );
    if (!result.rowCount) throw conflict("接続の対象が異なります");
    if (active)
      await this.schedule(db, `presence:${id}`, { connectionId: id }, expires);
    else await this.notice(db, world, actor, null, "presence_inactive");
    return ScenePresenceStatus.parse({
      connectionId: id,
      active,
      kind,
      expiresAt: expires.toISOString(),
    });
  }
  async active(
    world: string,
    actors: string[],
    kind: "human" | "bot",
    db: Pick<pg.Pool, "query"> = this.pool,
  ) {
    return (
      await db.query<{ actor_id: string }>(
        `SELECT DISTINCT p.actor_id FROM world_scene_presence p JOIN app_user u ON u.id=p.user_id
      LEFT JOIN player_device d ON d.id=p.device_id WHERE p.world_id=$1 AND p.actor_id=ANY($2::uuid[]) AND p.kind=$3
      AND p.active AND p.expires_at>$4 AND NOT u.banned AND (p.device_id IS NULL OR NOT d.revoked)`,
        [world, actors, kind, this.now()],
      )
    ).rows.map((r) => r.actor_id);
  }
  async open(
    db: pg.PoolClient,
    world: string,
    actor: string,
    scene: string,
    at: number,
    requestId: string,
  ) {
    const occupied = await db.query(
      "SELECT scene_id FROM world_scene_member WHERE world_id=$1 AND actor_id=$2 AND state IN ('reserved','joined')",
      [world, actor],
    );
    if (occupied.rowCount) throw conflict("この人物は別のシーンに参加中です");
    await db.query(
      "INSERT INTO world_shared_scene(scene_id,world_id,owner_id,at) VALUES($1,$2,$3,$4)",
      [scene, world, actor, at],
    );
    await db.query(
      "INSERT INTO world_scene_member(scene_id,world_id,actor_id,request_id,state) VALUES($1,$2,$3,$4,'reserved')",
      [scene, world, actor, requestId],
    );
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
  async candidates(world: string, actors: string[]) {
    return (
      await this.pool.query(
        `SELECT h.scene_id AS id,h.owner_id AS "actorId",h.at,s.data->>'purpose' AS purpose FROM world_shared_scene h
      JOIN world_scene s ON s.id=h.scene_id WHERE h.world_id=$1 AND h.owner_id=ANY($2::uuid[]) AND h.phase IN ('selecting','inviting') ORDER BY h.sequence`,
        [world, actors],
      )
    ).rows;
  }
  async invite(
    db: pg.PoolClient,
    row: SharedRow,
    actor: string,
    context: string[],
  ) {
    if (!row.deadline) {
      row.deadline = new Date(this.now().getTime() + 60000);
      await db.query(
        "UPDATE world_shared_scene SET deadline=$2 WHERE scene_id=$1",
        [row.scene_id, row.deadline],
      );
    }
    const id = randomUUID();
    const result = await db.query(
      "INSERT INTO world_scene_invitation(id,scene_id,actor_id,deadline,context) VALUES($1,$2,$3,$4,$5) ON CONFLICT(scene_id,actor_id) DO NOTHING RETURNING id",
      [id, row.scene_id, actor, row.deadline, JSON.stringify(context)],
    );
    if (result.rowCount)
      await this.notice(db, row.world_id, actor, row.scene_id, "invitation", {
        invitationId: id,
        deadline: row.deadline.toISOString(),
        context,
      });
    await this.schedule(
      db,
      `scene:${row.scene_id}`,
      { sceneId: row.scene_id },
      row.deadline,
    );
  }
  async select(scene: string, plan: Selection) {
    const original = await this.get(scene);
    if (!original) throw conflict("共有シーンが見つかりません");
    const candidates = await this.active(
      original.world_id,
      plan.candidates.filter((a) => a !== original.owner_id),
      "bot",
    );
    const views = new Map<string, string[]>();
    const world = await this.construction.get(original.world_id);
    for (const actor of [...new Set([...candidates, original.owner_id])]) {
      const view = await this.construction.agent.view(
        world.world_id!,
        actor,
        Number(original.at),
      );
      views.set(actor, [
        ...view.observations.flatMap((o) => (o.text ? [o.text] : [])),
        ...view.interpretations.map((i) => i.text),
      ]);
    }
    return this.transaction(async (db) => {
      await this.lock(db, original.world_id);
      const row = (await this.get(scene, db))!;
      if (row.phase === "merged" || row.phase === "settled") return row;
      if (row.phase === "offered") {
        const invitation = (
          await db.query<{ state: string }>(
            "SELECT state FROM world_scene_invitation WHERE scene_id=$1 AND actor_id=$2",
            [row.offer_to, row.owner_id],
          )
        ).rows[0];
        if (!invitation || invitation.state === "pending") return row;
        if (invitation.state === "accepted")
          return (await this.get(scene, db))!;
      }
      if (plan.mergeInto && row.phase === "selecting") {
        const target = await this.get(plan.mergeInto, db);
        if (
          target &&
          target.world_id === row.world_id &&
          target.at === row.at &&
          BigInt(target.sequence) < BigInt(row.sequence) &&
          ["selecting", "inviting"].includes(target.phase) &&
          candidates.includes(target.owner_id)
        ) {
          await db.query(
            "UPDATE world_shared_scene SET phase='offered',offer_to=$2,plan=$3,own_context=$4 WHERE scene_id=$1",
            [
              scene,
              target.scene_id,
              JSON.stringify({ ...plan, candidates }),
              JSON.stringify(views.get(row.owner_id)),
            ],
          );
          if (target.phase === "inviting")
            await this.invite(
              db,
              target,
              row.owner_id,
              views.get(row.owner_id)!,
            );
          return (await this.get(scene, db))!;
        }
      }
      await db.query(
        "UPDATE world_shared_scene SET phase='inviting',plan=$2 WHERE scene_id=$1",
        [scene, JSON.stringify({ ...plan, candidates })],
      );
      row.phase = "inviting";
      for (const actor of candidates) {
        const busy = (
          await db.query<{
            scene_id: string;
            phase: string | null;
            sequence: string | null;
          }>(
            `SELECT s.id AS scene_id,h.phase,h.sequence FROM world_scene s
          LEFT JOIN world_shared_scene h ON h.scene_id=s.id WHERE s.construction_id=$1 AND (EXISTS(SELECT 1 FROM world_actor_scene p WHERE p.world_id=$1 AND p.actor_id=$2 AND p.scene_id=s.id) OR (s.actor_id=$2 AND NOT EXISTS(SELECT 1 FROM world_actor_scene p WHERE p.world_id=$1 AND p.actor_id=$2))) AND s.state<>'result' AND NOT coalesce(s.data->'departures','{}'::jsonb) ? $2::text AND coalesce(jsonb_array_length(s.data->'waitingFor'),0)=0
          AND coalesce(h.phase,'')<>'merged' ORDER BY s.created_at DESC,s.id DESC LIMIT 1`,
            [row.world_id, actor],
          )
        ).rows[0];
        if (
          busy &&
          (!busy.phase ||
            !["selecting", "inviting", "offered"].includes(busy.phase) ||
            BigInt(busy.sequence!) < BigInt(row.sequence))
        )
          continue;
        await this.invite(db, row, actor, views.get(actor)!);
      }
      for (const offered of (
        await db.query<SharedRow>(
          "SELECT * FROM world_shared_scene WHERE offer_to=$1 AND phase='offered'",
          [scene],
        )
      ).rows) {
        await this.invite(db, row, offered.owner_id, offered.own_context);
      }
      return this.settle(db, row);
    });
  }
  async settle(db: pg.PoolClient, row: SharedRow) {
    if (row.phase !== "inviting") return row;
    if (row.deadline && row.deadline <= this.now()) {
      const expired = await db.query<{ actor_id: string; id: string }>(
        "UPDATE world_scene_invitation SET state='expired' WHERE scene_id=$1 AND state='pending' RETURNING actor_id,id",
        [row.scene_id],
      );
      for (const actor of expired.rows) {
        await this.notice(
          db,
          row.world_id,
          actor.actor_id,
          row.scene_id,
          "invitation_closed",
          { invitationId: actor.id, answer: "expired" },
        );
        await this.resumeOffered(db, row.scene_id, actor.actor_id);
      }
    }
    const pending = await db.query(
      "SELECT id FROM world_scene_invitation WHERE scene_id=$1 AND state='pending'",
      [row.scene_id],
    );
    if (pending.rowCount) return row;
    await db.query(
      "UPDATE world_shared_scene SET phase='settled' WHERE scene_id=$1",
      [row.scene_id],
    );
    await db.query(
      "UPDATE world_scene_member SET state='joined' WHERE scene_id=$1 AND state='reserved'",
      [row.scene_id],
    );
    row.phase = "settled";
    for (const member of await this.members(row.scene_id, db))
      if (member.state === "joined")
        await this.notice(
          db,
          row.world_id,
          member.actor_id,
          row.scene_id,
          "participation_settled",
        );
    return row;
  }
  async resumeOffered(db: pg.PoolClient, source: string, actor: string) {
    for (const row of (
      await db.query<SharedRow>(
        "UPDATE world_shared_scene SET phase='inviting' WHERE offer_to=$1 AND owner_id=$2 AND phase='offered' RETURNING *",
        [source, actor],
      )
    ).rows)
      await this.wake(db, row.scene_id);
  }
  async respond(
    db: pg.PoolClient,
    world: string,
    actor: string,
    invitationId: string,
    accept: boolean,
    requestId: string,
  ) {
    await this.lock(db, world);
    const invitation = (
      await db.query<{ scene_id: string; state: string; deadline: Date }>(
        `SELECT i.scene_id,i.state,i.deadline FROM world_scene_invitation i JOIN world_shared_scene h ON h.scene_id=i.scene_id
      WHERE i.id=$1 AND i.actor_id=$2 AND h.world_id=$3 FOR UPDATE OF i`,
        [invitationId, actor, world],
      )
    ).rows[0];
    if (!invitation) throw conflict("参加要請が見つかりません");
    const row = (await this.get(invitation.scene_id, db))!;
    if (
      invitation.state !== "pending" ||
      invitation.deadline <= this.now() ||
      row.phase !== "inviting"
    )
      throw conflict("この参加要請は締め切られています");
    if (accept) {
      const legacy = await db.query(
        `SELECT s.id FROM world_scene s WHERE s.construction_id=$1 AND (EXISTS(SELECT 1 FROM world_actor_scene p WHERE p.world_id=$1 AND p.actor_id=$2 AND p.scene_id=s.id) OR (s.actor_id=$2 AND NOT EXISTS(SELECT 1 FROM world_actor_scene p WHERE p.world_id=$1 AND p.actor_id=$2))) AND s.state<>'result' AND NOT coalesce(s.data->'departures','{}'::jsonb) ? $2::text AND coalesce(jsonb_array_length(s.data->'waitingFor'),0)=0
        AND NOT EXISTS(SELECT 1 FROM world_shared_scene h WHERE h.scene_id=s.id) LIMIT 1`,
        [world, actor],
      );
      if (legacy.rowCount) throw conflict("この人物は別のシーンに参加中です");
      const own = (
        await db.query<Member>(
          "SELECT * FROM world_scene_member WHERE world_id=$1 AND actor_id=$2 AND state IN ('reserved','joined')",
          [world, actor],
        )
      ).rows[0];
      if (own) {
        const other = await this.get(own.scene_id, db);
        if (
          own.state !== "reserved" ||
          !other ||
          BigInt(other.sequence) <= BigInt(row.sequence)
        )
          throw conflict("この人物は別のシーンに参加中です");
        await db.query(
          "UPDATE world_shared_scene SET phase='merged',offer_to=$2 WHERE scene_id=$1",
          [own.scene_id, row.scene_id],
        );
        await db.query(
          "UPDATE world_scene_member SET state='ended' WHERE scene_id=$1 AND actor_id=$2",
          [own.scene_id, actor],
        );
        await db.query("UPDATE world_scene SET claim=NULL WHERE id=$1", [
          own.scene_id,
        ]);
      }
      const original = own?.request_id ?? requestId;
      await db.query(
        "INSERT INTO world_scene_member(scene_id,world_id,actor_id,request_id,last_request_id,state) VALUES($1,$2,$3,$4,$5,'joined')",
        [row.scene_id, world, actor, original, requestId],
      );
    }
    if (accept)
      await db.query(
        "INSERT INTO world_actor_scene(world_id,actor_id,scene_id) VALUES($1,$2,$3) ON CONFLICT(world_id,actor_id) DO UPDATE SET scene_id=excluded.scene_id",
        [world, actor, row.scene_id],
      );
    await db.query("UPDATE world_scene_invitation SET state=$2 WHERE id=$1", [
      invitationId,
      accept ? "accepted" : "declined",
    ]);
    await this.notice(db, world, actor, row.scene_id, "invitation_closed", {
      invitationId,
      requestId,
      answer: accept ? "accepted" : "declined",
    });
    if (!accept) await this.resumeOffered(db, row.scene_id, actor);
    await this.settle(db, row);
    await this.wake(db, row.scene_id);
    return row.scene_id;
  }
  async state(scene: string, actor: string) {
    const row = await this.get(scene);
    if (!row || row.phase === "merged") return undefined;
    const pending = await this.pool.query(
      "SELECT id FROM world_scene_invitation WHERE scene_id=$1 AND state='pending'",
      [scene],
    );
    return {
      requestIds: (await this.members(scene))
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
  async inbox(world: string, actor: string, after?: string) {
    let position = "0";
    if (after) {
      let value;
      try {
        value = JSON.parse(Buffer.from(after, "base64url").toString("utf8"));
      } catch {
        throw conflict("通知の取得位置を確認してください");
      }
      if (
        value.world !== world ||
        value.actor !== actor ||
        !/^\d+$/.test(value.position)
      )
        throw conflict("通知の取得位置を確認してください");
      position = value.position;
    }
    const rows = (
      await this.pool.query<{
        id: string;
        scene_id: string | null;
        kind: string;
        data: object;
      }>(
        "SELECT id::text,scene_id,kind,data FROM world_scene_notice WHERE world_id=$1 AND actor_id=$2 AND id>$3 ORDER BY id LIMIT 51",
        [world, actor, position],
      )
    ).rows;
    const invitations = (
      await this.pool.query<{
        id: string;
        scene_id: string;
        deadline: Date;
        context: string[];
      }>(
        `SELECT i.id,i.scene_id,i.deadline,i.context FROM world_scene_invitation i JOIN world_shared_scene h ON h.scene_id=i.scene_id
      WHERE h.world_id=$1 AND i.actor_id=$2 AND i.state='pending' AND i.deadline>$3 AND h.phase='inviting' ORDER BY i.deadline,i.id`,
        [world, actor, this.now()],
      )
    ).rows;
    return SceneInbox.parse({
      viewerId: actor,
      invitations: invitations.map((i) => ({
        id: i.id,
        sceneId: i.scene_id,
        deadline: i.deadline.toISOString(),
        context: i.context,
      })),
      items: rows.slice(0, 50).map((r) => ({
        id: r.id,
        sceneId: r.scene_id,
        kind: r.kind,
        ...r.data,
      })),
      next: rows.length
        ? Buffer.from(
            JSON.stringify({
              world,
              actor,
              position: rows[Math.min(rows.length, 50) - 1]!.id,
            }),
          ).toString("base64url")
        : (after ?? null),
    });
  }
  async expire(data: { connectionId?: string; sceneId?: string }) {
    return this.transaction(async (db) => {
      if (data.connectionId) {
        const rows = (
          await db.query<{ world_id: string; actor_id: string }>(
            "UPDATE world_scene_presence SET active=false WHERE id=$1 AND active AND expires_at<=$2 RETURNING world_id,actor_id",
            [data.connectionId, this.now()],
          )
        ).rows;
        for (const row of rows)
          await this.notice(
            db,
            row.world_id,
            row.actor_id,
            null,
            "presence_inactive",
          );
      } else if (data.sceneId) {
        const row = await this.get(data.sceneId, db);
        if (row) {
          await this.lock(db, row.world_id);
          await this.settle(db, row);
        }
        await this.wake(db, data.sceneId);
      }
    });
  }
  async work() {
    await this.construction.queue.work<{
      connectionId?: string;
      sceneId?: string;
    }>(this.deadlineQueue, { pollingIntervalSeconds: 0.5 }, async (jobs) => {
      for (const job of jobs) await this.expire(job.data);
    });
  }
}
