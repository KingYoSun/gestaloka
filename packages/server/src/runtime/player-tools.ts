import type pg from "pg";
import type { z } from "zod";
import type { PlayCommand, PlayerReportInput } from "@gestaloka/contracts";
import { AccessError } from "../http/access.js";
import type { WorldConstruction } from "./construction.js";
import { derivedId, type Change } from "../world/model.js";
import { locationRecords } from "../world/locations.js";
import { planBelongings } from "../world/belongings.js";
import { WorldConflict } from "../world/store.js";
import type { Session } from "./bot-play.js";
import type { Appearance } from "@gestaloka/contracts";

type Db = Pick<pg.Pool, "query">;
const reject = (code: string, message: string): never => {
  throw new AccessError(409, code, message);
};

export class PlayerTools {
  constructor(
    readonly construction: WorldConstruction,
    readonly now = () => new Date(),
  ) {}
  static async setup(db: Db) {
    await db.query(`CREATE TABLE IF NOT EXISTS player_report_policy (
      singleton boolean PRIMARY KEY CHECK(singleton),daily_limit bigint NOT NULL DEFAULT 10 CHECK(daily_limit>0),
      turns_per_report bigint NOT NULL DEFAULT 3 CHECK(turns_per_report>0),max_characters bigint NOT NULL DEFAULT 1200 CHECK(max_characters>0),
      version integer NOT NULL DEFAULT 1,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO player_report_policy(singleton) VALUES(true) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS player_report_usage (
      user_id uuid NOT NULL,world_id uuid NOT NULL,day date NOT NULL,turns bigint NOT NULL DEFAULT 0,sent bigint NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id,world_id,day));
      CREATE TABLE IF NOT EXISTS player_report (
      id uuid PRIMARY KEY,world_id uuid NOT NULL,user_id uuid NOT NULL,actor_id uuid,text text NOT NULL,
      created_at timestamptz NOT NULL);
      ALTER TABLE player_report ALTER COLUMN actor_id DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS player_report_world_time ON player_report(world_id,created_at,id);
      CREATE TABLE IF NOT EXISTS npc_promotion (
      id uuid PRIMARY KEY,world_id uuid NOT NULL,user_id uuid NOT NULL,actor_id uuid NOT NULL,
      source_request_id uuid NOT NULL,npc_index integer NOT NULL,label text NOT NULL,description text NOT NULL,source_text text NOT NULL,
      owner_id uuid,state text NOT NULL DEFAULT 'pending',npc_id uuid,created_at timestamptz NOT NULL,decided_by uuid);
      ALTER TABLE npc_promotion ADD COLUMN IF NOT EXISTS auto_review jsonb;
      CREATE TABLE IF NOT EXISTS npc_promotion_policy(world_id uuid PRIMARY KEY,condition text NOT NULL,version uuid NOT NULL,admin uuid NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS npc_promotion_active ON npc_promotion(world_id,source_request_id,npc_index) WHERE state<>'rejected';
      CREATE INDEX IF NOT EXISTS npc_promotion_world_time ON npc_promotion(world_id,created_at,id);
      CREATE INDEX IF NOT EXISTS npc_promotion_actor_time ON npc_promotion(world_id,actor_id,created_at,id);`);
  }
  #day(now = this.now()) {
    return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  }
  async completedTurn(db: Db, user: string, world: string) {
    await db.query(
      `INSERT INTO player_report_usage(user_id,world_id,day,turns) VALUES($1,$2,$3,1)
      ON CONFLICT(user_id,world_id,day) DO UPDATE SET turns=player_report_usage.turns+1`,
      [user, world, this.#day()],
    );
  }
  async reportStatus(
    db: Db,
    user: string,
    world: string,
    lock = false,
    now = this.now(),
  ) {
    const date = this.#day(now),
      policy = (
        await db.query(
          `SELECT daily_limit::float8 AS "dailyLimit",turns_per_report::float8 AS "turnsPerReport",max_characters::float8 AS "maxCharacters",version,
          coalesce(u.turns,0)::float8 AS turns,coalesce(u.sent,0)::float8 AS sent
          FROM player_report_policy p LEFT JOIN player_report_usage u ON u.user_id=$1 AND u.world_id=$2 AND u.day=$3
          WHERE singleton${lock ? " FOR SHARE OF p" : ""}`,
          [user, world, date],
        )
      ).rows[0];
    const allowance = Math.min(
      policy.dailyLimit,
      Math.max(1, Math.floor(policy.turns / policy.turnsPerReport)),
    );
    return {
      date,
      ...policy,
      allowance,
      available: Math.max(0, allowance - policy.sent),
    };
  }
  async report(
    db: Db,
    user: string,
    world: string,
    actor: string | null,
    input: z.infer<typeof PlayerReportInput>,
  ) {
    const now = this.now();
    const date = this.#day(now);
    await db.query(
      "INSERT INTO player_report_usage(user_id,world_id,day) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [user, world, date],
    );
    await db.query(
      "SELECT day FROM player_report_usage WHERE user_id=$1 AND world_id=$2 AND day=$3 FOR UPDATE",
      [user, world, date],
    );
    const quota = await this.reportStatus(db, user, world, true, now);
    if ([...input.text].length > quota.maxCharacters)
      reject(
        "REPORT_TOO_LONG",
        `報告・感想は${quota.maxCharacters}文字以内で送ってください`,
      );
    if (!quota.available)
      reject(
        "REPORT_LIMIT",
        "本日の送信枠がありません。通常手番の完了数と日次上限を確認してください",
      );
    const at = now.toISOString();
    await db.query(
      "INSERT INTO player_report(id,world_id,user_id,actor_id,text,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [input.requestId, world, user, actor, input.text, at],
    );
    await db.query(
      "UPDATE player_report_usage SET sent=sent+1 WHERE user_id=$1 AND world_id=$2 AND day=$3",
      [user, world, date],
    );
    return {
      id: input.requestId,
      createdAt: at,
      ...(await this.reportStatus(db, user, world, false, now)),
    };
  }
  async reports(db: Db, world: string, before?: string) {
    const rows = (
      await db.query(
        `SELECT id,world_id AS "worldId",user_id AS "userId",actor_id AS "actorId",text,created_at AS "createdAt"
      FROM player_report WHERE world_id=$1 AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM player_report WHERE world_id=$1 AND id=$2))
      ORDER BY created_at DESC,id DESC LIMIT 51`,
        [world, before ?? null],
      )
    ).rows;
    return {
      items: rows
        .slice(0, 50)
        .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      next: rows.length > 50 ? rows[49].id : null,
    };
  }
  async promotionSource(
    db: Db,
    world: string,
    actor: string,
    input: Extract<z.infer<typeof PlayCommand>, { command: "promote-npc" }>,
  ) {
    const w = await this.construction.get(world),
      store = this.construction.agent.store;
    const source = (
      await db.query(
        "SELECT result FROM bot_request WHERE world_id=$1 AND id=$2",
        [world, input.sourceRequestId],
      )
    ).rows[0]?.result;
    const receipt = source
      ? await store.receipt(w.world_id!, input.sourceRequestId)
      : undefined;
    const event = receipt?.changes.nodes.find((n) => n.kind === "event");
    const seen =
      event &&
      (
        await store
          .context(w.world_id!)
          .history(actor, "see", "out", Number.MAX_SAFE_INTEGER)
      ).some((e) => e.target === event.id);
    if (!seen)
      reject(
        "PROMOTION_SOURCE_NOT_AVAILABLE",
        "本人が受容した出現を指定してください",
      );
    const label = source?.instantNpcs?.[input.npcIndex];
    if (typeof label !== "string")
      reject(
        "INSTANT_NPC_NOT_FOUND",
        "出現したインスタントNPCの番号を確認してください",
      );
    if (input.ownerId && input.ownerId !== actor)
      reject(
        "OWNER_MISMATCH",
        "所有関係を申請する場合は本人を指定してください",
      );
    const appearance = (
      source?.appearances as Appearance[] | undefined
    )?.filter((a) => a.kind === "instant-npc")[input.npcIndex];
    return { label, eventText: event!.text, appearance };
  }
  async requestPromotion(
    db: Db,
    world: string,
    user: string,
    actor: string,
    input: Extract<z.infer<typeof PlayCommand>, { command: "promote-npc" }>,
    source: Awaited<ReturnType<PlayerTools["promotionSource"]>>,
  ) {
    const { label, eventText } = source;
    try {
      await db.query(
        `INSERT INTO npc_promotion(id,world_id,user_id,actor_id,source_request_id,npc_index,label,description,source_text,owner_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          input.requestId,
          world,
          user,
          actor,
          input.sourceRequestId,
          input.npcIndex,
          label,
          input.description,
          eventText,
          input.ownerId ?? null,
          this.now().toISOString(),
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        reject(
          "PROMOTION_EXISTS",
          "この出現には昇格申請または昇格済みのNPCがあります",
        );
      throw error;
    }
    return { promotionId: input.requestId, label, state: "pending" };
  }
  async promotions(db: Db, world: string, actor?: string, before?: string) {
    const rows = (
      await db.query(
        `SELECT id,actor_id AS "actorId",source_request_id AS "sourceRequestId",npc_index AS "npcIndex",label,description,source_text AS "sourceText",
      owner_id AS "ownerId",state,npc_id AS "npcId",created_at AS "createdAt",decided_by AS "decidedBy",CASE WHEN $2::uuid IS NULL THEN auto_review END AS "autoReview" FROM npc_promotion
      WHERE world_id=$1 AND ($2::uuid IS NULL OR actor_id=$2) AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM npc_promotion WHERE world_id=$1 AND id=$3))
      ORDER BY created_at DESC,id DESC LIMIT 51`,
        [world, actor ?? null, before ?? null],
      )
    ).rows;
    return {
      items: rows
        .slice(0, 50)
        .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      next: rows.length > 50 ? rows[49].id : null,
    };
  }
  async decidePromotion(
    db: Db,
    admin: string,
    world: string,
    id: string,
    approve: boolean,
    playingSession?: Session,
  ) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,225))", [
      world,
    ]);
    const row = (
      await db.query(
        "SELECT * FROM npc_promotion WHERE world_id=$1 AND id=$2 FOR UPDATE",
        [world, id],
      )
    ).rows[0];
    if (!row)
      throw new AccessError(
        404,
        "PROMOTION_NOT_FOUND",
        "昇格申請が見つかりません",
      );
    const state = approve ? "approved" : "rejected";
    if (row.state !== "pending") {
      if (row.state !== state)
        reject("PROMOTION_DECIDED", "この昇格申請は決定済みです");
      return { id, state, npcId: row.npc_id };
    }
    const source = (
      await db.query(
        "SELECT result FROM bot_request WHERE world_id=$1 AND id=$2",
        [world, row.source_request_id],
      )
    ).rows[0]?.result;
    const appearance = (
      source?.appearances as Appearance[] | undefined
    )?.filter((a) => a.kind === "instant-npc")[row.npc_index];
    const npc = appearance?.id ?? derivedId(`promotion:${id}:npc`);
    if (approve) {
      const session = (
        await db.query<Session>(
          "SELECT s.* FROM bot_scene p JOIN bot_session s ON s.id=p.session_id WHERE p.world_id=$1 AND p.actor_id=$2 AND NOT p.closed",
          [world, npc],
        )
      ).rows[0];
      const currentSession =
        playingSession && playingSession.id === session?.id
          ? playingSession
          : session;
      const member = currentSession?.data.members.find(
        (m) => m.actorId === npc,
      );
      const instant = member?.instant;
      const w = await this.construction.get(world),
        store = this.construction.agent.store,
        commitId = derivedId(`promotion:${id}`);
      if (!(await store.receipt(w.world_id!, commitId))) {
        const context = store.context(w.world_id!),
          locations = instant
            ? await Promise.all(
                instant.places.map(async (place) => ({
                  text: (await context.node(place))?.text ?? "",
                  aboutIds: [place],
                })),
              )
            : await locationRecords(context, row.actor_id);
        const at = Math.max(
          Number(w.at),
          (await context.latestTime(row.actor_id)) ?? 0,
        );
        const changes: Change = {
          nodes: [
            { id: npc, kind: "existence", text: row.label },
            {
              id: derivedId(`${npc}:description`),
              kind: "script",
              text: row.description,
            },
          ],
          revisions: [],
          endEdges: [],
          edges: [
            {
              id: derivedId(`${npc}:description-edge`),
              kind: "status",
              role: "content",
              source: npc,
              target: derivedId(`${npc}:description`),
              period: { from: at },
            },
          ],
        };
        if (row.owner_id)
          changes.edges.push({
            id: derivedId(`${npc}:owner`),
            kind: "has",
            source: row.owner_id,
            target: npc,
            period: { from: at },
          });
        if (instant)
          changes.edges.push({
            id: derivedId(npc + ":origin"),
            kind: "status",
            role: "about",
            source: derivedId(npc + ":description"),
            target: instant.sourceEventId,
            period: { from: at },
          });
        if (locations.length) {
          const placed = await planBelongings(context, commitId, at, [
            {
              type: "locate",
              subjectId: npc,
              text: locations.map((l) => l.text).join("、"),
              aboutIds: [...new Set(locations.flatMap((l) => l.aboutIds))],
            },
          ]);
          changes.nodes.push(...placed.changes.nodes);
          changes.edges.push(...placed.changes.edges);
        }
        try {
          await store.commit(
            await store.claim(w.world_id!, commitId),
            context,
            { commitId, at, changes },
          );
        } catch (error) {
          if (error instanceof WorldConflict)
            throw new AccessError(409, "WORLD_CHANGED", error.message);
          throw error;
        }
      }
      await db.query(
        "INSERT INTO bot_npc(world_id,actor_id,controller,user_id,assignment_id) VALUES($1,$2,$4,$5,$3) ON CONFLICT DO NOTHING",
        [world, npc, id, instant ? "server" : null, instant ? admin : null],
      );
      if (currentSession && member && instant) {
        delete member.instant;
        if (currentSession !== playingSession)
          await db.query("UPDATE bot_session SET data=$2 WHERE id=$1", [
            currentSession.id,
            currentSession.data,
          ]);
      }
      await db.query(
        "INSERT INTO world_controlled_actor(world_id,actor_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [w.world_id, npc],
      );
    }
    await db.query(
      "UPDATE npc_promotion SET state=$2,npc_id=$3,decided_by=$4 WHERE id=$1",
      [id, state, approve ? npc : null, admin],
    );
    return { id, state, npcId: approve ? npc : null };
  }
}
