import { createHash, randomInt } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { PlayCommand, type PlaySearch } from "@gestaloka/contracts";
import { AccessError } from "../http/access.js";
import { requireMember } from "../http/operations.js";
import { RuntimeControl, RuntimeStopped } from "./control.js";
import { ExecutionBudget } from "../execution-budget.js";
import {
  WorldConflict,
  WorldContext,
  type Dependency,
} from "../world/store.js";
import {
  derivedId,
  validateConnection,
  bindingScripts,
  validateBindings,
  type Change,
} from "../world/model.js";
import {
  BelongingOp,
  BelongingRejected,
  planBelongings,
  readBelongings,
} from "../world/belongings.js";
import { locationRecords } from "../world/locations.js";
import { canonical, parseOutput } from "../llm/prompt.js";
import type { WorldConstruction } from "./construction.js";
import { PlayerTools } from "./player-tools.js";

type Input = z.infer<typeof PlayCommand>;
type Db = Pick<pg.Pool, "query">;
type Entry = {
  actorId: string;
  input: string;
  result: unknown;
  applicationId?: string;
};
type Member = { actorId: string; sceneId: string; userId?: string };
type Session = {
  id: string;
  world_id: string;
  data: {
    members: Member[];
    turn: string;
    number: number;
    used: number;
    entries: Entry[];
    comment?: string;
    receiving?: {
      id: string;
      sender: string;
      recipients: string[];
      decided: string[];
      comments: Record<string, string>;
      deadline: string;
      changes: Change;
      at: number;
      dependencies: Dependency[];
      text: string;
    };
  };
};
type Plan = {
  context: WorldContext;
  changes: Change;
  at: number;
  recipients: string[];
  outcome?: unknown;
};
const latest = Number.MAX_SAFE_INTEGER;
const waitLeaseMs = 600000;
function reject(code: string, message: string): never {
  throw new AccessError(409, code, message);
}
function playError(error: unknown) {
  if (error instanceof RuntimeStopped)
    return new AccessError(409, error.code, error.message);
  if (error instanceof WorldConflict)
    return new AccessError(409, "WORLD_CHANGED", error.message);
  if (error instanceof BelongingRejected)
    return new AccessError(409, "UPDATE_REJECTED", error.message);
  if (error instanceof z.ZodError)
    return new AccessError(
      400,
      "INPUT_INVALID",
      "操作の形式を確認してください",
    );
  return error;
}
const empty = (): Change => ({
  nodes: [],
  revisions: [],
  edges: [],
  endEdges: [],
});
const CreationJudgment = z
  .object({ allowed: z.boolean(), reason: z.string() })
  .strict();
const DiceSetting = z
  .object({
    sides: z.number().int().min(2).max(2147483647),
    successThrough: z.number().int().positive(),
  })
  .strict()
  .refine((v) => v.successThrough < v.sides);

/** Bots select their own material; only completed public actions enter the chat. */
export class BotPlay {
  readonly tools: PlayerTools;
  constructor(
    readonly construction: WorldConstruction,
    readonly now = () => new Date(),
  ) {
    this.tools = new PlayerTools(construction, () => this.now());
  }
  get pool() {
    return this.construction.pool;
  }
  get store() {
    return this.construction.agent.store;
  }
  async setup() {
    await PlayerTools.setup(this.pool);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS bot_session (
      id uuid PRIMARY KEY,world_id uuid NOT NULL REFERENCES world_construction(id),data jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_scene (
      id uuid NOT NULL,actor_id uuid NOT NULL,world_id uuid NOT NULL REFERENCES world_construction(id),
      session_id uuid NOT NULL REFERENCES bot_session(id),closed boolean NOT NULL DEFAULT false,result jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(id,actor_id));
      CREATE UNIQUE INDEX IF NOT EXISTS bot_scene_active ON bot_scene(world_id,actor_id) WHERE NOT closed;
      CREATE TABLE IF NOT EXISTS bot_chat (
      id bigserial PRIMARY KEY,session_id uuid NOT NULL REFERENCES bot_session(id),payload jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_record (
      scene_id uuid NOT NULL,actor_id uuid NOT NULL,chat_id bigint NOT NULL REFERENCES bot_chat(id),
      PRIMARY KEY(scene_id,actor_id,chat_id));
      CREATE TABLE IF NOT EXISTS bot_request (
      id uuid PRIMARY KEY,actor_id uuid NOT NULL,world_id uuid NOT NULL,hash text NOT NULL,result jsonb,outcome jsonb);
      CREATE TABLE IF NOT EXISTS bot_dice (
      id uuid PRIMARY KEY,setting jsonb NOT NULL,roll integer);
      CREATE TABLE IF NOT EXISTS bot_npc (
      world_id uuid NOT NULL REFERENCES world_construction(id),actor_id uuid NOT NULL,
      controller text CHECK(controller IN ('bot','server')),user_id uuid,assignment_id uuid NOT NULL,PRIMARY KEY(world_id,actor_id));
      ALTER TABLE bot_npc ALTER COLUMN controller DROP NOT NULL;`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS player_waiting (
      world_id uuid NOT NULL,actor_id uuid NOT NULL,connection_id text NOT NULL,user_id uuid NOT NULL,
      active boolean NOT NULL,last_seen timestamptz NOT NULL,generation integer NOT NULL DEFAULT 1,
      PRIMARY KEY(world_id,actor_id,connection_id));
      CREATE INDEX IF NOT EXISTS player_waiting_live ON player_waiting(world_id,actor_id,last_seen);
      CREATE INDEX IF NOT EXISTS bot_chat_session ON bot_chat(session_id,id);`);
  }
  async keepAlive(
    world: string,
    actor: string,
    user: string,
    connection: string,
    db: Db = this.pool,
  ) {
    const now = this.now();
    await db.query(
      `UPDATE player_waiting SET generation=generation+CASE WHEN last_seen<$5 THEN 1 ELSE 0 END,last_seen=$4
      WHERE world_id=$1 AND actor_id=$2 AND user_id=$3 AND active AND connection_id=$6`,
      [
        world,
        actor,
        user,
        now.toISOString(),
        new Date(now.getTime() - waitLeaseMs).toISOString(),
        connection,
      ],
    );
  }
  async #setPresence(
    db: Db,
    world: string,
    actor: string,
    user: string,
    connection: string,
    active: boolean,
  ) {
    const now = this.now(),
      cutoff = new Date(now.getTime() - waitLeaseMs).toISOString();
    await db.query(
      `INSERT INTO player_waiting(world_id,actor_id,user_id,connection_id,active,last_seen) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(world_id,actor_id,connection_id) DO UPDATE SET user_id=$3,active=$5,last_seen=$6,
      generation=player_waiting.generation+CASE WHEN $5 AND (NOT player_waiting.active OR player_waiting.last_seen<$7 OR player_waiting.user_id<>$3) THEN 1 ELSE 0 END`,
      [world, actor, user, connection, active, now.toISOString(), cutoff],
    );
  }
  async waiting(
    world: string,
    actor: string,
    user: string,
    connection: string,
    active?: boolean,
    db: Db = this.pool,
  ) {
    const now = this.now();
    const assignment = (
      await db.query(
        "SELECT controller,user_id FROM bot_npc WHERE world_id=$1 AND actor_id=$2",
        [world, actor],
      )
    ).rows[0];
    if (
      assignment &&
      (assignment.controller !== "bot" || assignment.user_id !== user)
    )
      reject(
        "NPC_CONTROLLER_CHANGED",
        "本人のbot担当が指定された人物を使ってください",
      );
    if (active !== undefined)
      await this.#setPresence(db, world, actor, user, connection, active);
    else await this.keepAlive(world, actor, user, connection, db);
    const presence = (
      await db.query(
        "SELECT active,last_seen,generation FROM player_waiting WHERE world_id=$1 AND actor_id=$2 AND user_id=$3 AND connection_id=$4",
        [world, actor, user, connection],
      )
    ).rows[0];
    const connected =
      !!presence?.active &&
      presence.last_seen.getTime() >= now.getTime() - waitLeaseMs;
    const base = {
      active: !!presence?.active,
      connected,
      viewerId: actor,
      ...(presence
        ? {
            expiresAt: new Date(
              presence.last_seen.getTime() + waitLeaseMs,
            ).toISOString(),
          }
        : {}),
      actionable: false,
      wakeKey: null,
    };
    if (!connected) return { ...base, state: "inactive" };
    const w = await this.world(world, db);
    try {
      await RuntimeControl.check(
        db,
        { worldId: w.id, userId: user, role: "user", actorId: actor },
        true,
      );
    } catch (error) {
      if (error instanceof RuntimeStopped)
        return { ...base, state: "paused", code: error.code };
      throw error;
    }
    const session = await this.current(world, actor, db);
    if (!session) return { ...base, state: "standby" };
    const d = session.data,
      r = d.receiving,
      current = r ? r.recipients.find((id) => !r.decided.includes(id)) : d.turn;
    if (current !== actor)
      return {
        ...base,
        state: "standby",
        sessionId: session.id,
        turn: d.number,
      };
    const last =
      (
        await db.query(
          "SELECT id::text AS id FROM bot_chat WHERE session_id=$1 ORDER BY id DESC LIMIT 1",
          [session.id],
        )
      ).rows[0]?.id ?? "0";
    const state = r ? "receiving" : "turn",
      key = createHash("sha256")
        .update(
          JSON.stringify([
            session.id,
            d.number,
            actor,
            r?.id ?? "normal",
            last,
            d.members.length,
            presence.generation,
          ]),
        )
        .digest("hex");
    return {
      ...base,
      state,
      actionable: true,
      wakeKey: key,
      sessionId: session.id,
      turn: d.number,
      ...(r ? { applicationId: r.id, deadline: r.deadline } : {}),
    };
  }
  async #available(world: string, actors: string[], db: Db = this.pool) {
    return (
      await db.query<{
        actor_id: string;
        user_id: string | null;
        npc: boolean;
      }>(
        `SELECT target.actor_id,
      EXISTS(SELECT 1 FROM bot_npc n WHERE n.world_id=$1 AND n.actor_id=target.actor_id) AS npc,ready.user_id
      FROM unnest($2::uuid[]) AS target(actor_id) LEFT JOIN LATERAL (
      SELECT candidate.user_id FROM (
        SELECT n.user_id,0 AS priority,now() AS seen FROM bot_npc n WHERE n.world_id=$1 AND n.actor_id=target.actor_id AND n.controller='server'
        UNION ALL SELECT p.user_id,1 AS priority,p.last_seen AS seen FROM player_waiting p
        WHERE p.world_id=$1 AND p.actor_id=target.actor_id AND p.active AND p.last_seen>=$3
        AND EXISTS(SELECT 1 FROM world_access a JOIN world_subject s ON s.id=a.subject_id WHERE a.construction_id=$1 AND a.actor_id=p.actor_id AND a.role='player' AND s.user_id=p.user_id AND s.active)
        AND NOT EXISTS(SELECT 1 FROM bot_npc n WHERE n.world_id=$1 AND n.actor_id=p.actor_id AND (n.controller IS DISTINCT FROM 'bot' OR n.user_id IS DISTINCT FROM p.user_id))
      ) candidate JOIN app_user u ON u.id=candidate.user_id AND NOT u.banned ORDER BY candidate.priority,candidate.seen DESC LIMIT 1
      ) ready ON true`,
        [
          world,
          actors,
          new Date(this.now().getTime() - waitLeaseMs).toISOString(),
        ],
      )
    ).rows;
  }
  async #open(
    db: Db,
    world: string,
    actor: string,
    user: string,
    id: string,
  ): Promise<Session> {
    const legacy = (
      await db.query<{ id: string }>(
        "SELECT v.id FROM world_scene_session v WHERE world_id=$1 AND actor_id=$2 AND NOT closed AND NOT EXISTS(SELECT 1 FROM bot_scene p WHERE p.id=v.id AND p.actor_id=v.actor_id)",
        [world, actor],
      )
    ).rows[0];
    const session: Session = {
      id,
      world_id: world,
      data: {
        members: [{ actorId: actor, sceneId: legacy?.id ?? id, userId: user }],
        turn: actor,
        number: 1,
        used: 0,
        entries: [],
      },
    };
    await db.query(
      "INSERT INTO bot_session(id,world_id,data) VALUES($1,$2,$3)",
      [session.id, world, session.data],
    );
    await db.query(
      "INSERT INTO bot_scene(id,actor_id,world_id,session_id) VALUES($1,$2,$3,$4)",
      [session.data.members[0]!.sceneId, actor, world, session.id],
    );
    return session;
  }
  async tickNpcs() {
    const assigned = (
      await this.pool.query<{
        world_id: string;
        actor_id: string;
        user_id: string;
        assignment_id: string;
      }>("SELECT * FROM bot_npc WHERE controller='server'")
    ).rows;
    for (const npc of assigned) {
      let current = await this.current(npc.world_id, npc.actor_id);
      if (!current) {
        await this.submit(
          npc.world_id,
          npc.actor_id,
          {
            requestId: derivedId(`npc-start:${npc.assignment_id}`),
            command: "start",
          },
          npc.user_id,
          npc.assignment_id,
        );
        current = await this.current(npc.world_id, npc.actor_id);
      }
      if (!current) continue;
      const status = await this.status(npc.world_id, npc.actor_id);
      if (status.actorId !== npc.actor_id) continue;
      const requestId = derivedId(
        `npc:${npc.assignment_id}:${current.id}:${status.turn}:${status.callsUsed}:${status.commentUsed}:${current.data.receiving?.id ?? "normal"}`,
      );
      const world = await this.world(npc.world_id);
      await ExecutionBudget.run(
        this.pool,
        requestId,
        async () => {
          const self = await this.search(npc.world_id, npc.actor_id, {
              kind: "self",
            }),
            nearby = await this.search(npc.world_id, npc.actor_id, {
              kind: "surroundings",
            });
          const completion = await this.#ask(
            derivedId(`${requestId}:choice`),
            "world-server-npc",
            [
              {
                role: "system",
                content:
                  "あなたは明示的に担当を指定された一人のNPCです。本人に提供された素材とセッションの入力・結果から、本人として次のAPIコマンドを一つ選びます。世界の裁定や他人の私的な解釈を代作しません。requestIdはサーバーが設定します。commandSchemaに従うJSONだけを返します。",
              },
              {
                role: "user",
                content: JSON.stringify({
                  self,
                  nearby,
                  history: await this.history(npc.world_id, npc.actor_id),
                  status,
                  commandSchema: z.toJSONSchema(PlayCommand),
                }),
              },
            ],
            "default",
            (raw) =>
              PlayCommand.parse({ ...(parseOutput(raw) as object), requestId }),
          );
          const command = PlayCommand.parse({
            ...(parseOutput(completion.content) as object),
            requestId,
          });
          await this.submit(
            npc.world_id,
            npc.actor_id,
            command,
            npc.user_id,
            npc.assignment_id,
          );
        },
        world.id,
        npc.user_id,
      );
    }
  }
  async world(id: string, db: Db = this.pool) {
    const row = (
      await db.query<{ world_id: string; at: string }>(
        "SELECT world_id,at FROM world_construction WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!row?.world_id)
      reject("WORLD_NOT_FOUND", "確定した世界が見つかりません");
    return { id: row.world_id, at: Number(row.at) };
  }
  async current(world: string, actor: string, db: Db = this.pool) {
    return (
      await db.query<Session>(
        `SELECT s.* FROM bot_scene p JOIN bot_session s ON s.id=p.session_id
      WHERE p.world_id=$1 AND p.actor_id=$2 AND NOT p.closed`,
        [world, actor],
      )
    ).rows[0];
  }
  async #save(db: Db, session: Session) {
    await db.query("UPDATE bot_session SET data=$2 WHERE id=$1", [
      session.id,
      session.data,
    ]);
  }
  async #record(db: Db, session: Session, payload: Record<string, unknown>) {
    if (Array.isArray(payload.entries)) {
      const context = this.store.context(
        (await this.world(session.world_id, db)).id,
      );
      payload = {
        ...payload,
        entries: await Promise.all(
          (payload.entries as Entry[]).map(async (e) => ({
            ...e,
            label: (await context.node(e.actorId))?.text ?? "参加者",
          })),
        ),
      };
    }
    const id = (
      await db.query<{ id: string }>(
        "INSERT INTO bot_chat(session_id,payload) VALUES($1,$2) RETURNING id",
        [session.id, payload],
      )
    ).rows[0]!.id;
    for (const member of session.data.members)
      await db.query(
        "INSERT INTO bot_record(scene_id,actor_id,chat_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [member.sceneId, member.actorId, id],
      );
  }
  async #next(db: Db, session: Session) {
    const d = session.data;
    const user = d.members.find((m) => m.actorId === d.turn)?.userId;
    if (user) await this.tools.completedTurn(db, user, session.world_id);
    await this.#record(db, session, {
      turn: d.number,
      actorId: d.turn,
      entries: d.entries,
      ...(d.comment ? { comment: d.comment } : {}),
    });
    d.turn =
      d.members[
        (d.members.findIndex((m) => m.actorId === d.turn) + 1) %
          d.members.length
      ]!.actorId;
    d.number++;
    d.used = 0;
    d.entries = [];
    delete d.comment;
  }
  #settle(
    session: Session,
    state: string,
    extra: Record<string, unknown> = {},
  ) {
    const r = session.data.receiving!;
    const entry = session.data.entries.find((e) => e.applicationId === r.id)!;
    entry.result = { applicationId: r.id, state, ...extra };
    delete session.data.receiving;
  }
  async #expire(db: Db, session: Session) {
    const r = session.data.receiving;
    if (r && new Date(r.deadline) <= this.now()) {
      await this.#record(db, session, {
        applicationId: r.id,
        state: "failed",
        reason: "受領判断の期限が切れました",
      });
      this.#settle(session, "failed");
      if (
        session.data.used >=
        Number(
          (
            await db.query(
              "SELECT turn_calls FROM session_play_policy WHERE singleton",
            )
          ).rows[0].turn_calls,
        )
      )
        await this.#next(db, session);
      await this.#save(db, session);
    }
  }
  async status(world: string, actor: string, db: Db = this.pool) {
    const session = await this.current(world, actor, db);
    if (!session) return { session: null };
    const policy = (
      await db.query<{ turnCalls: number; receiptTimeoutSeconds: number }>(
        `SELECT turn_calls::float8 AS "turnCalls",receipt_timeout_seconds::float8 AS "receiptTimeoutSeconds" FROM session_play_policy WHERE singleton`,
      )
    ).rows[0]!;
    const r = session.data.receiving;
    const context = this.store.context((await this.world(world, db)).id),
      ids = session.data.members.map((m) => m.actorId);
    const icons = (
      await db.query<{ actor_id: string; image: string | null }>(
        `SELECT a.actor_id,i.image FROM world_access a LEFT JOIN world_player_icon i ON i.player_id=a.id WHERE a.construction_id=$1 AND a.actor_id=ANY($2::uuid[]) ORDER BY a.actor_id,(i.image IS NULL),a.id`,
        [world, ids],
      )
    ).rows;
    const characters = await Promise.all(
      ids.map(async (actorId) => ({
        actorId,
        name: (await context.node(actorId))?.text ?? "人物",
        icon: icons.find((r) => r.actor_id === actorId)?.image ?? null,
      })),
    );
    await context.validate();
    return {
      sessionId: session.id,
      members: session.data.members.map(({ actorId, sceneId }) => ({
        actorId,
        sceneId,
      })),
      characters,
      turn: session.data.number,
      actorId: r
        ? r.recipients.find((id) => !r.decided.includes(id))!
        : session.data.turn,
      callsUsed: session.data.used,
      callsLimit: policy.turnCalls,
      commentUsed: r
        ? !!r.comments[r.recipients.find((id) => !r.decided.includes(id))!]
        : !!session.data.comment,
      receiving: r
        ? {
            applicationId: r.id,
            sender: r.sender,
            deadline: r.deadline,
            ...(r.sender === actor || r.recipients.includes(actor)
              ? { text: r.text, changes: r.changes }
              : {}),
          }
        : null,
    };
  }
  async history(
    world: string,
    actor: string,
    scene?: string,
    db: Db = this.pool,
  ) {
    const selected =
      scene ??
      (await this.current(world, actor, db))?.data.members.find(
        (m) => m.actorId === actor,
      )?.sceneId ??
      (
        await db.query<{ id: string }>(
          "SELECT id FROM bot_scene WHERE world_id=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 1",
          [world, actor],
        )
      ).rows[0]?.id;
    if (!selected) return { entries: [] };
    const valid = (
      await db.query(
        "SELECT result FROM bot_scene WHERE id=$1 AND actor_id=$2 AND world_id=$3 UNION ALL SELECT result FROM world_scene_session WHERE id=$1 AND actor_id=$2 AND world_id=$3",
        [selected, actor, world],
      )
    ).rows[0];
    if (!valid) reject("SCENE_NOT_FOUND", "本人のシーンを指定してください");
    return {
      sceneId: selected,
      result: valid.result,
      legacy: (
        await db.query(
          "SELECT kind,id,payload FROM world_scene_record WHERE session_id=$1 AND actor_id=$2 ORDER BY kind,position",
          [selected, actor],
        )
      ).rows,
      entries: (
        await db.query(
          `SELECT c.id,c.payload FROM bot_record r JOIN bot_chat c ON c.id=r.chat_id
      WHERE r.scene_id=$1 AND r.actor_id=$2 ORDER BY c.id`,
          [selected, actor],
        )
      ).rows,
    };
  }
  async expire(world?: string) {
    const sessions = (
      await this.pool.query<Session>(
        `SELECT * FROM bot_session WHERE data->'receiving' IS NOT NULL AND ($1::uuid IS NULL OR world_id=$1)`,
        [world ?? null],
      )
    ).rows;
    for (const initial of sessions) {
      const db = await this.pool.connect();
      try {
        await db.query("BEGIN");
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,225))",
          [initial.world_id],
        );
        const session = (
          await db.query<Session>("SELECT * FROM bot_session WHERE id=$1", [
            initial.id,
          ])
        ).rows[0]!;
        await this.#expire(db, session);
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    }
  }
  async #places(context: WorldContext, actor: string) {
    return [
      ...new Set(
        (await locationRecords(context, actor)).flatMap((r) => r.aboutIds),
      ),
    ];
  }
  async contact(context: WorldContext, actor: string, target: string) {
    const own = await this.#places(context, actor);
    if (!own.length)
      return { allowed: false, reason: "本人の所在地が未確定です" };
    const other = await this.#places(context, target);
    return own.some((p) => other.includes(p))
      ? { allowed: true, reason: "同じ所在地です" }
      : {
          allowed: false,
          reason: "本人の所在地で接触できることを確認できません",
        };
  }
  async #nearby(context: WorldContext, actor: string) {
    const found = new Set<string>();
    for (const place of await this.#places(context, actor)) {
      found.add(place);
      for (const subject of await context.locationSubjects(place))
        if (
          (await locationRecords(context, subject)).some((r) =>
            r.aboutIds.includes(place),
          )
        )
          found.add(subject);
    }
    found.delete(actor);
    return found;
  }
  async search(
    world: string,
    actor: string,
    query: z.infer<typeof PlaySearch>,
    dependencies: Dependency[] = [],
  ) {
    const w = await this.world(world),
      context = this.store.context(w.id, dependencies);
    const at = latest;
    let material: unknown;
    if (query.kind === "belongings")
      material = await readBelongings(context, actor);
    else if (query.kind === "memos") {
      const memos = [];
      for (const edge of await context.relations(actor, "has", "out", at)) {
        const node = await context.node(edge.target);
        if (!edge.role && node?.kind === "script" && node.type === "memo")
          memos.push({
            ...node,
            participants: await Promise.all(
              (await context.relations(node.id, "has", "in", at))
                .filter((e) => !e.role)
                .map(async (e) => ({
                  id: e.source,
                  name: (await context.node(e.source))?.text ?? "人物",
                })),
            ),
          });
      }
      material = memos;
    } else if (query.kind === "history") {
      const seen = await context.history(actor, "see", "out", at);
      material = seen.filter(
        (e) =>
          !query.targetId ||
          e.target === query.targetId ||
          e.observation?.sourceIds.includes(query.targetId),
      );
    } else if (query.kind === "surroundings") {
      const neighbors = await this.#nearby(context, actor);
      const contacts = await this.#available(world, [...neighbors]);
      material = {
        locations: await locationRecords(context, actor),
        subjects: await Promise.all(
          [...neighbors].map(async (id) => ({
            ...(await context.node(id)),
            contactAvailable: contacts.some(
              (r) => r.actor_id === id && r.user_id !== null,
            ),
            npc: contacts.find((r) => r.actor_id === id)?.npc ?? false,
          })),
        ),
      };
    } else {
      const target = query.kind === "self" ? actor : query.targetId;
      const accessible =
        target === actor ||
        (await this.#nearby(context, actor)).has(target) ||
        (await context.relations(actor, "has", "out", at)).some(
          (e) => e.target === target,
        ) ||
        (await context.history(actor, "see", "out", at)).some(
          (e) =>
            e.target === target || e.observation?.sourceIds.includes(target),
        );
      if (!accessible)
        reject(
          "MATERIAL_NOT_AVAILABLE",
          "本人へ提供されている対象を指定してください",
        );
      const states = [];
      for (const e of await context.relations(target, "status", "out", at))
        if (e.role === "content")
          states.push({
            relation: e,
            node: await context.node(e.target),
            about: await context.relations(e.target, "status", "out", at),
          });
      material = {
        node: await context.node(target),
        states,
        ...(target === actor
          ? {
              interpretations: await Promise.all(
                (await context.relations(actor, "interpret", "out", at))
                  .filter((e) => e.role === "content")
                  .map(async (e) => ({
                    relation: e,
                    node: await context.node(e.target),
                  })),
              ),
            }
          : {}),
      };
    }
    await context.validate();
    return { material, dependencies: context.dependencies };
  }
  async #creation(
    world: string,
    actor: string,
    requestId: string,
    context: WorldContext,
    text: string,
    changes: Change,
  ) {
    if (!changes.nodes.length && !changes.edges.length) return;
    if (
      changes.nodes.every((n) => n.kind === "script") &&
      changes.edges.length &&
      changes.edges.every(
        (e) =>
          e.kind === "interpret" &&
          (e.role === "content"
            ? e.source === actor
            : changes.nodes.some((n) => n.id === e.source)),
      )
    )
      return;
    const roots = (await this.construction.get(world)).root_ids;
    const nodes = await this.#facts(context, [
      actor,
      ...roots,
      ...changes.edges.flatMap((e) => [e.source, e.target]),
    ]);
    const response = await this.#ask(
      derivedId(`${requestId}:creation`),
      "world-creation-permission",
      [
        {
          role: "system",
          content:
            "新しいノード・エッジの作成可否だけを判断する。申請者、申請、関係する確定済みの材料を参照する。許可ならallowed=true、拒否ならfalseと理由を返す。物語・行動結果・追加の変更を生成しない。JSON: {allowed:boolean,reason:string}",
        },
        {
          role: "user",
          content: JSON.stringify({
            world,
            actor,
            text,
            changes,
            nodes,
            dependencies: context.dependencies,
          }),
        },
      ],
      "resolution",
      (raw) => CreationJudgment.parse(parseOutput(raw)),
    );
    const judgment = CreationJudgment.parse(parseOutput(response.content));
    if (!judgment.allowed) reject("CREATION_REJECTED", judgment.reason);
  }
  #ask(
    id: string,
    role: string,
    messages: import("../llm/client.js").ChatMessage[],
    target: "default" | "resolution",
    validate: (raw: string) => unknown,
  ) {
    return this.construction.agent.model.complete(
      id,
      role,
      messages,
      target,
      target,
      false,
      0,
      validate,
    );
  }
  async #facts(context: WorldContext, ids: Iterable<string>) {
    const result = [];
    for (const id of new Set(ids)) {
      const node = await context.node(id);
      if (!node) continue;
      const states = [];
      for (const edge of await context.relations(id, "status", "out", latest))
        if (edge.role === "content")
          states.push({
            edge,
            node: await context.node(edge.target),
            about: await context.relations(
              edge.target,
              "status",
              "out",
              latest,
            ),
          });
      result.push({
        node,
        states,
        ...(node.kind === "existence"
          ? { belongings: await readBelongings(context, id) }
          : {}),
      });
    }
    await context.validate();
    return result;
  }
  async #validate(context: WorldContext, changes: Change, at: number) {
    for (const node of changes.nodes)
      if (await context.node(node.id))
        reject("NODE_EXISTS", "新規ノードの同一性は既に存在します");
    for (const node of changes.revisions)
      if ((await context.node(node.id))?.kind !== node.kind)
        reject("NODE_CHANGED", "改訂する既存ノードの種別を確認してください");
    for (const id of changes.endEdges)
      if (!(await context.edge(id)))
        reject("EDGE_NOT_FOUND", "終了する関係が見つかりません");
    const draft = new WorldContext(
      this.store.driver,
      context.worldId,
      context.dependencies,
      [{ at, changes }],
    );
    try {
      for (const edge of changes.edges) {
        if (await context.edge(edge.id))
          reject("EDGE_EXISTS", "新規の関係は既に存在します");
        const source = await draft.node(edge.source),
          target = await draft.node(edge.target);
        if (!source || !target)
          reject("TARGET_NOT_FOUND", "関係の接続先が存在しません");
        validateConnection(edge, source, target);
      }
      const ended = await Promise.all(
        changes.endEdges.map((id) => context.edge(id)),
      );
      for (const binding of bindingScripts([
        ...changes.edges,
        ...ended.filter((e) => e !== undefined),
      ]))
        validateBindings(binding.kind, binding.id, [
          ...(await draft.relations(binding.id, binding.kind, "in", latest)),
          ...(await draft.relations(binding.id, binding.kind, "out", latest)),
        ]);
    } catch (error) {
      if (error instanceof AccessError) throw error;
      reject("CONNECTION_REJECTED", (error as Error).message);
    }
    const combined = this.store.context(context.worldId, [
      ...context.dependencies,
      ...draft.dependencies,
    ]);
    await combined.validate();
    return combined;
  }
  async #plan(
    world: string,
    actor: string,
    input: Input,
  ): Promise<Plan | undefined> {
    if (!("dependencies" in input)) return;
    const w = await this.world(world);
    let context = this.store.context(w.id, input.dependencies);
    const prior = await this.store.receipt(w.id, input.requestId);
    if (prior)
      return {
        context,
        changes: prior.changes,
        at: prior.at,
        recipients: [],
        outcome: (
          await this.pool.query("SELECT outcome FROM bot_request WHERE id=$1", [
            input.requestId,
          ])
        ).rows[0]?.outcome,
      };
    await context.validate();
    const registered = (
      await this.pool.query<{ actor_id: string; controller: string | null }>(
        "SELECT actor_id,controller FROM bot_npc WHERE world_id=$1",
        [world],
      )
    ).rows;
    const controlled = new Set(
      (
        await this.pool.query<{ actor_id: string }>(
          "SELECT actor_id FROM world_controlled_actor WHERE world_id=$1",
          [w.id],
        )
      ).rows.map((r) => r.actor_id),
    );
    for (const r of registered) controlled.add(r.actor_id);
    const parties = new Set<string>(),
      refs = new Set<string>();
    const holders = async (id: string) =>
      (await context.relations(id, "has", "in", latest)).filter(
        (e) => e.role !== "summary",
      );
    const owners = async (
      id: string,
      seen = new Set<string>(),
    ): Promise<string[]> => {
      if (controlled.has(id) || id === actor) return [id];
      if (seen.has(id)) return [];
      seen.add(id);
      const incoming = await holders(id),
        held = incoming.filter((e) => e.role === "hold");
      const sources = (
        held.length
          ? held
          : incoming.filter((e) => e.role === undefined || e.role === "skill")
      ).map((e) => e.source);
      for (const kind of ["status", "interpret"] as const)
        for (const e of await context.relations(id, kind, "in", latest))
          if (e.role === "content") sources.push(e.source);
      const result = (
        await Promise.all(
          sources.map((source) => owners(source, new Set(seen))),
        )
      ).flat();
      return result.length ? result : sources.length ? [] : [id];
    };
    const affect = async (id: string) => {
      refs.add(id);
      const found = await owners(id);
      for (const owner of found.length ? found : [id]) parties.add(owner);
    };
    let changes = empty(),
      at = w.at,
      needsCreation = false,
      impossible = false;
    if (input.command === "memo") {
      const id = derivedId(`${input.requestId}:memo`);
      changes.nodes.push({
        id,
        kind: "script",
        type: "memo",
        text: input.text,
      });
      for (const person of new Set([actor, ...input.participants])) {
        if (
          !controlled.has(person) ||
          (await context.node(person))?.kind !== "existence"
        )
          reject(
            "PARTICIPANT_NOT_FOUND",
            "メモに関連付ける人物を確認してください",
          );
        parties.add(person);
        changes.edges.push({
          id: derivedId(`${id}:${person}`),
          kind: "has",
          source: person,
          target: id,
          period: { from: at },
        });
      }
    } else if ("operations" in input && input.operations) {
      const ops: BelongingOp[] = input.operations.map((op) => ({ ...op })),
        plannedOps: BelongingOp[] = [];
      for (const op of ops) {
        if (op.type === "locate") await affect(op.subjectId);
        else if (op.type === "create") {
          parties.add(op.holder);
          if (op.owner) parties.add(op.owner);
          needsCreation = true;
        } else if (op.type === "learn") {
          await affect(op.person);
          needsCreation = true;
        } else {
          const id =
            "item" in op ? op.item : "storage" in op ? op.storage : op.id;
          refs.add(id);
          if (!(await context.node(id)))
            reject("TARGET_NOT_FOUND", "操作の対象が見つかりません");
          const incoming = await holders(id);
          if (op.type === "move") {
            const held = incoming.find((e) => e.role === "hold");
            if (input.command === "oppose" && held?.source === op.to) {
              continue;
            }
            if (held && held.source !== op.from) {
              if (input.command === "oppose") impossible = true;
              else
                reject("HOLD_CHANGED", "物品の現在の保持者が指定と異なります");
            }
            if (!held && op.from !== null) {
              if (input.command === "oppose") {
                parties.add(op.from);
                op.from = null;
              } else
                reject(
                  "HOLD_NOT_RECORDED",
                  "指定された保持者の関係は未記録です",
                );
            }
            await affect(id);
            await affect(op.to);
          } else if (op.type === "transfer") {
            for (const e of incoming.filter((e) => e.role === undefined))
              parties.add(e.source);
            if (!incoming.some((e) => e.role === undefined)) parties.add(id);
            await affect(op.to);
          } else if (op.type === "grant" || op.type === "revoke") {
            await affect(op.storage);
            await affect(op.person);
          } else {
            if (!incoming.length)
              reject(
                "BELONGING_NOT_RECORDED",
                "物品・技能の保持または所有は未記録です",
              );
            await affect(id);
          }
        }
        plannedOps.push(op);
      }
      if (!impossible) {
        const plan = await planBelongings(
          context,
          input.requestId,
          at,
          plannedOps,
        );
        changes = plan.changes;
        at = plan.at;
      }
    } else {
      changes = input.changes!;
      if (
        input.command === "create" &&
        (changes.revisions.length || changes.endEdges.length)
      )
        reject("CREATION_ONLY", "新規作成だけを指定してください");
      const ended = await Promise.all(
        changes.endEdges.map((id) => context.edge(id)),
      );
      if (
        [...changes.edges, ...ended.filter((e) => e !== undefined)].some(
          (e) =>
            (e.kind === "has" && e.role !== undefined) ||
            (e.kind === "status" &&
              e.role === "content" &&
              e.text === "location"),
        )
      )
        reject(
          "INTERNAL_OPERATION_REQUIRED",
          "保持・保管・技能・所在地は用途別の操作で申請してください",
        );
      for (const node of changes.revisions) await affect(node.id);
      const newlyCreated = new Set(changes.nodes.map((n) => n.id));
      for (const edge of [
        ...changes.edges,
        ...ended.filter((e) => e !== undefined),
      ]) {
        refs.add(edge.source);
        refs.add(edge.target);
        if (edge.kind === "status" || edge.kind === "interpret") {
          if (edge.role === "content") await affect(edge.source);
          else
            for (const e of [
              ...changes.edges,
              ...(await context.relations(
                edge.source,
                edge.kind,
                "in",
                latest,
              )),
            ])
              if (
                e.kind === edge.kind &&
                e.role === "content" &&
                e.target === edge.source
              )
                await affect(e.source);
        } else if (edge.kind === "effect") await affect(edge.target);
        else {
          await affect(edge.source);
          if (edge.kind === "has" && !newlyCreated.has(edge.target))
            for (const own of (await holders(edge.target)).filter(
              (e) => !e.role,
            ))
              parties.add(own.source);
        }
      }
      needsCreation = !!(changes.nodes.length || changes.edges.length);
    }
    if (impossible) {
      const outcome = {
        success: false,
        reason: "対象の保持者が申請の前提と異なります",
      };
      await this.pool.query("UPDATE bot_request SET outcome=$2 WHERE id=$1", [
        input.requestId,
        outcome,
      ]);
      return { context, changes: empty(), at, recipients: [], outcome };
    }
    context = await this.#validate(context, changes, at);
    const recipients = [...parties].filter(
      (id) => id !== actor && controlled.has(id),
    );
    if (input.command !== "oppose") {
      const session = await this.current(world, actor);
      for (const id of recipients) {
        if (registered.some((n) => n.actor_id === id && n.controller === null))
          reject(
            "NPC_UNASSIGNED",
            "対象のユニークNPCには操作担当が指定されていません",
          );
        if (!session?.data.members.some((m) => m.actorId === id))
          reject(
            "REMOTE_RECEIVING",
            "受領者は同じセッションにいる必要があります",
          );
      }
      if (
        !needsCreation &&
        [...parties].some((id) => id !== actor && !controlled.has(id))
      )
        reject(
          "AUTHORITY_REQUIRED",
          "本人の操作範囲または同席者の判断が必要です",
        );
    }
    if (needsCreation)
      await this.#creation(
        world,
        actor,
        input.requestId,
        context,
        input.text,
        changes,
      );
    let outcome: unknown;
    if (input.command === "oppose") {
      let success = [...parties].every((id) => id === actor);
      if (!success) {
        const materials = await this.#facts(context, [
          actor,
          ...parties,
          ...refs,
        ]);
        const response = await this.#ask(
          derivedId(`${input.requestId}:dice-setting`),
          "world-opposition-dice",
          [
            {
              role: "system",
              content:
                "受領を経ない対抗行動の確率をダイス設定だけで返す。JSON: {sides:整数,successThrough:整数}。1からsidesまでの一様な出目がsuccessThrough以下なら成功。1<=successThrough<sides。成否、出目、物語、追加の変更は生成しない。",
            },
            {
              role: "user",
              content: JSON.stringify({
                actor,
                action: input.text,
                changes,
                materials,
              }),
            },
          ],
          "resolution",
          (raw) => DiceSetting.parse(parseOutput(raw)),
        );
        const setting = DiceSetting.parse(parseOutput(response.content)),
          saved = await this.#roll(input.requestId, setting);
        success = saved.roll <= saved.setting.successThrough;
        outcome = { success, ...saved };
      } else
        outcome = {
          success: true,
          reason: "本人の操作範囲または既に成立している状態です",
        };
      if (!success) changes = empty();
      await this.pool.query("UPDATE bot_request SET outcome=$2 WHERE id=$1", [
        input.requestId,
        outcome,
      ]);
    }
    return {
      context,
      changes,
      at,
      recipients: input.command === "oppose" ? [] : recipients,
      outcome,
    };
  }
  async #commit(
    world: string,
    requestId: string,
    plan: Pick<Plan, "context" | "at" | "changes">,
  ) {
    const prior = await this.store.receipt(world, requestId);
    return (
      prior ??
      this.store.commit(
        await this.store.claim(world, requestId),
        plan.context,
        { commitId: requestId, at: plan.at, changes: plan.changes },
      )
    );
  }
  async #roll(id: string, setting: z.infer<typeof DiceSetting>) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "INSERT INTO bot_dice(id,setting) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, setting],
      );
      const row = (
        await db.query<{
          setting: z.infer<typeof DiceSetting>;
          roll: number | null;
        }>("SELECT * FROM bot_dice WHERE id=$1 FOR UPDATE", [id])
      ).rows[0]!;
      const roll = row.roll ?? randomInt(1, row.setting.sides + 1);
      if (row.roll === null)
        await db.query("UPDATE bot_dice SET roll=$2 WHERE id=$1", [id, roll]);
      await db.query("COMMIT");
      return { setting: row.setting, roll };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async submit(
    world: string,
    actor: string,
    input: Input,
    user: string,
    expectedAssignment?: string,
    connectionId = `human:${user}`,
  ) {
    const hash = createHash("sha256").update(canonical(input)).digest("hex");
    await this.pool.query(
      "INSERT INTO bot_request(id,actor_id,world_id,hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [input.requestId, actor, world, hash],
    );
    const saved = (
      await this.pool.query<{
        actor_id: string;
        world_id: string;
        hash: string;
        result: Record<string, unknown> | null;
      }>("SELECT * FROM bot_request WHERE id=$1", [input.requestId])
    ).rows[0]!;
    if (
      saved.actor_id !== actor ||
      saved.world_id !== world ||
      saved.hash !== hash
    )
      reject("REQUEST_CONFLICT", "同じ要求IDに異なる内容は使用できません");
    if (saved.result) return saved.result;
    if (
      expectedAssignment &&
      (
        await this.pool.query(
          "SELECT assignment_id FROM bot_npc WHERE world_id=$1 AND actor_id=$2",
          [world, actor],
        )
      ).rows[0]?.assignment_id !== expectedAssignment
    )
      reject("NPC_CONTROLLER_CHANGED", "NPCの操作担当が変わりました");
    const w = await this.world(world);
    if (["update", "create", "oppose", "memo"].includes(input.command)) {
      const active = await this.current(world, actor);
      if (!active || active.data.turn !== actor || active.data.receiving)
        reject("TURN_REQUIRED", "本人の通常手番ではありません");
    }
    // Semantic work precedes all session locks; its graph dependencies are validated at commit.
    const plan = await ExecutionBudget.run(
      this.pool,
      input.requestId,
      () => this.#plan(world, actor, input),
      w.id,
      user,
    ).catch((error) => {
      throw playError(error);
    });
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT id FROM bot_request WHERE id=$1 FOR UPDATE", [
        input.requestId,
      ]);
      await requireMember(db, user);
      const assignment = (
        await db.query<{
          user_id: string | null;
          controller: string | null;
          assignment_id: string;
        }>(
          "SELECT user_id,controller,assignment_id FROM bot_npc WHERE world_id=$1 AND actor_id=$2",
          [world, actor],
        )
      ).rows[0];
      if (
        expectedAssignment &&
        assignment?.assignment_id !== expectedAssignment
      )
        reject("NPC_CONTROLLER_CHANGED", "NPCの操作担当が変わりました");
      if (assignment && assignment.user_id !== user)
        reject(
          "NPC_CONTROLLER_REQUIRED",
          "指定された操作担当だけがこの人物を操作できます",
        );
      await RuntimeControl.check(
        db,
        {
          worldId: w.id,
          userId: user,
          role: assignment?.controller === "server" ? "admin" : "user",
          ...(assignment?.controller === "server" ? {} : { actorId: actor }),
        },
        true,
      );
      const granted = (
        await db.query(
          `SELECT 1 FROM world_access a JOIN world_subject s ON s.id=a.subject_id WHERE s.user_id=$1 AND s.active AND a.construction_id=$2 AND a.actor_id=$3 AND a.role='player'`,
          [user, world, actor],
        )
      ).rowCount;
      if (!granted && !assignment)
        reject("ACTOR_REQUIRED", "本人が操作できる人物を指定してください");
      if (assignment?.controller !== "server")
        await this.#setPresence(db, world, actor, user, connectionId, true);
      const again = (
        await db.query<{ result: Record<string, unknown> | null }>(
          "SELECT result FROM bot_request WHERE id=$1",
          [input.requestId],
        )
      ).rows[0]!.result;
      if (again) {
        await db.query("COMMIT");
        return again;
      }
      // Membership changes share a short lock, never held across a model call.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,225))", [
        world,
      ]);
      let session = await this.current(world, actor, db);
      if (session) await this.#expire(db, session);
      let result: Record<string, unknown> = {};
      if (input.command === "start") {
        session ??= await this.#open(db, world, actor, user, input.requestId);
      } else {
        if (!session)
          reject("SESSION_REQUIRED", "本人のセッションを開始してください");
        const d = session.data,
          receiving = d.receiving;
        const member = d.members.find((m) => m.actorId === actor);
        if (member) member.userId = user;
        if (input.command === "leave" || input.command === "finish") {
          if (
            receiving &&
            (receiving.sender === actor || receiving.recipients.includes(actor))
          ) {
            await this.#record(db, session, {
              applicationId: receiving.id,
              state: "failed",
              reason: "関係する参加者が退出しました",
            });
            this.#settle(session, "failed");
          }
          if (d.turn === actor) await this.#next(db, session);
          const member = d.members.find((m) => m.actorId === actor)!;
          d.members = d.members.filter((m) => m.actorId !== actor);
          if (input.command === "finish") {
            const { legacy, entries } = await this.history(
                world,
                actor,
                member.sceneId,
                db,
              ),
              final = { legacy, entries };
            await db.query(
              "UPDATE bot_scene SET closed=true,result=$3 WHERE id=$1 AND actor_id=$2",
              [member.sceneId, actor, JSON.stringify(final)],
            );
            result = { sceneId: member.sceneId, result: final };
          } else {
            const separated: Session = {
              id: input.requestId,
              world_id: world,
              data: {
                members: [member],
                turn: actor,
                number: 1,
                used: 0,
                entries: [],
              },
            };
            await db.query(
              "INSERT INTO bot_session(id,world_id,data) VALUES($1,$2,$3)",
              [separated.id, world, separated.data],
            );
            await db.query(
              "UPDATE bot_scene SET session_id=$3 WHERE id=$1 AND actor_id=$2",
              [member.sceneId, actor, separated.id],
            );
          }
          if (d.members.length && !d.members.some((m) => m.actorId === d.turn))
            d.turn = d.members[0]!.actorId;
        } else if (input.command === "comment" && receiving) {
          if (
            receiving.recipients.find(
              (id) => !receiving.decided.includes(id),
            ) !== actor
          )
            reject("TURN_REQUIRED", "本人の受領判断の手番ではありません");
          if (receiving.comments[actor])
            reject("COMMENT_USED", "この手番のコメントは投稿済みです");
          receiving.comments[actor] = input.text;
        } else if (input.command === "receive") {
          if (
            !receiving ||
            receiving.id !== input.applicationId ||
            receiving.recipients.find(
              (id) => !receiving.decided.includes(id),
            ) !== actor
          )
            reject(
              "RECEIVING_TURN_REQUIRED",
              "本人の受領判断を指定してください",
            );
          if (!input.accept) {
            this.#settle(session, "rejected");
          } else {
            receiving.decided.push(actor);
            if (
              receiving.recipients.every((id) => receiving.decided.includes(id))
            ) {
              const receipt = await this.#commit(w.id, receiving.id, {
                at: receiving.at,
                changes: receiving.changes,
                context: this.store.context(w.id, receiving.dependencies),
              });
              this.#settle(session, "accepted", { commitId: receipt.commitId });
            }
          }
          await this.#record(db, session, {
            ...(receiving.comments[actor]
              ? { comment: receiving.comments[actor] }
              : {}),
            entries: [
              {
                actorId: actor,
                input: input.accept ? "受領を承認する" : "受領を拒否する",
                result: {
                  applicationId: input.applicationId,
                  state: input.accept
                    ? d.receiving
                      ? "receiving"
                      : "accepted"
                    : "rejected",
                },
              },
            ],
          });
          if (
            !d.receiving &&
            d.used >=
              Number(
                (
                  await db.query(
                    "SELECT turn_calls FROM session_play_policy WHERE singleton",
                  )
                ).rows[0].turn_calls,
              )
          )
            await this.#next(db, session);
        } else {
          if (receiving || d.turn !== actor)
            reject("TURN_REQUIRED", "本人の通常手番ではありません");
          if (input.command === "comment") {
            if (d.comment)
              reject("COMMENT_USED", "この手番のコメントは投稿済みです");
            d.comment = input.text;
          } else if (input.command === "end-turn")
            await this.#next(db, session);
          else {
            if (input.command === "search")
              result = await this.search(world, actor, input.query);
            else if (input.command === "promote-npc") {
              result = await this.tools.requestPromotion(
                db,
                world,
                user,
                actor,
                input,
              );
              d.entries.push({
                actorId: actor,
                input: `${result.label}の昇格申請: ${input.description}`,
                result,
              });
            } else if (input.command === "contact") {
              const context = this.store.context(w.id),
                contact = await this.contact(context, actor, input.targetId);
              if (!contact.allowed) reject("CONTACT_MISMATCH", contact.reason);
              const available = (
                await this.#available(world, [input.targetId], db)
              )[0];
              if (!available?.user_id)
                reject(
                  "PARTNER_NOT_AVAILABLE",
                  "接触先に在席中の操作担当を確認できません",
                );
              const other =
                (await this.current(world, input.targetId, db)) ??
                (await this.#open(
                  db,
                  world,
                  input.targetId,
                  available.user_id,
                  derivedId(`${input.requestId}:contact:${input.targetId}`),
                ));
              result = { contact: "joined", targetId: input.targetId };
              d.entries.push({
                actorId: actor,
                input: `${(await context.node(input.targetId))?.text ?? "相手"}に接触する`,
                result,
              });
              if (other.id !== session.id) {
                await context.validate();
                d.used++;
                await this.#next(db, session);
                const member = d.members.find((m) => m.actorId === actor)!;
                d.members = d.members.filter((m) => m.actorId !== actor);
                await this.#save(db, session);
                other.data.members.push(member);
                await db.query(
                  "UPDATE bot_scene SET session_id=$3 WHERE id=$1 AND actor_id=$2",
                  [member.sceneId, actor, other.id],
                );
                session = other;
              }
            } else if (input.command === "say") {
              const event = derivedId(`${input.requestId}:speech`),
                changes = empty();
              changes.nodes.push({
                id: event,
                kind: "event",
                text: input.text,
                period: { from: w.at },
              });
              changes.edges.push({
                id: derivedId(`${event}:speaker`),
                kind: "happen",
                source: actor,
                target: event,
                period: { from: w.at },
              });
              for (const member of d.members)
                changes.edges.push({
                  id: derivedId(`${event}:${member.actorId}`),
                  kind: "see",
                  source: member.actorId,
                  target: event,
                  text: input.text,
                  period: { from: w.at },
                  observation: {
                    aspect: "発言",
                    through: w.at,
                    sourceIds: [actor, event],
                    pathIds: [],
                  },
                });
              const receipt = await this.#commit(w.id, input.requestId, {
                context: this.store.context(w.id),
                at: w.at,
                changes,
              });
              result = {
                state: "accepted",
                commitId: receipt.commitId,
                instantNpcs: input.instantNpcs,
              };
              d.entries.push({ actorId: actor, input: input.text, result });
            } else if (plan) {
              for (const recipient of plan.recipients)
                if (!d.members.some((m) => m.actorId === recipient))
                  reject(
                    "REMOTE_RECEIVING",
                    "受領者は同じセッションにいる必要があります",
                  );
              if (plan.recipients.length) {
                const timeout = Number(
                  (
                    await db.query(
                      "SELECT receipt_timeout_seconds FROM session_play_policy WHERE singleton",
                    )
                  ).rows[0].receipt_timeout_seconds,
                );
                d.entries.push({
                  applicationId: input.requestId,
                  actorId: actor,
                  input: "text" in input ? input.text : "",
                  result: {
                    applicationId: input.requestId,
                    state: "receiving",
                  },
                });
                d.receiving = {
                  id: input.requestId,
                  sender: actor,
                  recipients: plan.recipients,
                  decided: [],
                  comments: {},
                  deadline: new Date(
                    this.now().getTime() + timeout * 1000,
                  ).toISOString(),
                  changes: plan.changes,
                  at: plan.at,
                  dependencies: plan.context.dependencies,
                  text: "text" in input ? input.text : "",
                };
                result = { applicationId: input.requestId, state: "receiving" };
              } else {
                const receipt = await this.#commit(w.id, input.requestId, plan);
                result = {
                  state: "accepted",
                  commitId: receipt.commitId,
                  ...(plan.outcome ? { outcome: plan.outcome } : {}),
                };
                if (
                  !plan.changes.edges.length ||
                  !plan.changes.edges.every((e) => e.kind === "interpret")
                )
                  d.entries.push({
                    actorId: actor,
                    input: "text" in input ? input.text : "",
                    result,
                  });
              }
            }
            // Only successful calls consume a slot. Read material never enters chat.
            if (input.command !== "contact" || session.data.turn === actor) {
              session.data.used++;
              const limit = Number(
                (
                  await db.query(
                    "SELECT turn_calls FROM session_play_policy WHERE singleton",
                  )
                ).rows[0].turn_calls,
              );
              if (session.data.used >= limit && !session.data.receiving)
                await this.#next(db, session);
            }
          }
        }
        await this.#save(db, session);
      }
      result = { ...result, ...(await this.status(world, actor, db)) };
      if (input.command === "memo")
        result.memoId = derivedId(`${input.requestId}:memo`);
      await db.query("UPDATE bot_request SET result=$2 WHERE id=$1", [
        input.requestId,
        result,
      ]);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw playError(error);
    } finally {
      db.release();
    }
  }
}
