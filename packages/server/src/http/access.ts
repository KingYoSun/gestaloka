import { createHash } from "node:crypto";
import { z } from "zod";
import type pg from "pg";
import {
  WorldStatus,
  KnowledgePage,
  AdminPage,
  type WorldCommand,
  type PlayerAction,
  PlayerStatus,
  PlayRun,
  SceneStatus,
  type SceneCommand,
  SceneRecordPage,
  type SceneRecordQuery,
  type CreateWorld,
} from "@gestaloka/contracts";
import {
  ConstructionStateError,
  type WorldConstruction,
} from "../runtime/construction.js";
import { WorldScenes, type SceneRow } from "../runtime/scene.js";
import { sceneAnchors } from "../runtime/scene-data.js";
import { requireMember } from "./operations.js";
import { WorldPlayers } from "../runtime/players.js";

export class AccessError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const sequence = (value: string) =>
  /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const Cursor = z
  .object({ from: z.number().int().nonnegative().safe(), id: z.uuid() })
  .strict();
type Role = "admin" | "player";

export class WorldAccess {
  readonly scenes: WorldScenes;
  readonly players: WorldPlayers;
  constructor(readonly construction: WorldConstruction) {
    this.scenes = new WorldScenes(construction);
    this.players = new WorldPlayers(construction);
  }
  get pool() {
    return this.construction.pool;
  }

  async setup() {
    await this.construction.setup();
    await this.pool.query(`DO $$ BEGIN
      IF to_regclass('world_subject') IS NULL AND to_regclass('browser_session') IS NOT NULL THEN
        ALTER TABLE browser_session RENAME TO world_subject;
      END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS world_subject (
      id uuid PRIMARY KEY, token_hash text UNIQUE, active boolean NOT NULL DEFAULT true);
      ALTER TABLE world_subject ALTER COLUMN token_hash DROP NOT NULL;
      ALTER TABLE world_subject ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES app_identity(id);
      CREATE INDEX IF NOT EXISTS world_subject_user ON world_subject(user_id,id);
      CREATE TABLE IF NOT EXISTS world_access (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_id uuid NOT NULL REFERENCES world_subject(id), construction_id uuid NOT NULL REFERENCES world_construction(id),
      role text NOT NULL CHECK(role IN ('admin','player')),actor_id uuid);
      DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='world_access'::regclass AND attname='id' AND NOT attisdropped) THEN
          ALTER TABLE world_access ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
          ALTER TABLE world_access DROP CONSTRAINT world_access_pkey;
          ALTER TABLE world_access ADD PRIMARY KEY(id);
        END IF;
      END $$;
      CREATE UNIQUE INDEX IF NOT EXISTS world_access_admin ON world_access(subject_id,construction_id) WHERE role='admin';
      CREATE UNIQUE INDEX IF NOT EXISTS world_access_player ON world_access(subject_id,construction_id,actor_id) WHERE role='player';
      CREATE OR REPLACE FUNCTION guard_subject_grants() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM id FROM world_subject WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.subject_id ELSE NEW.subject_id END FOR SHARE;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $$;
      CREATE OR REPLACE TRIGGER world_access_subject_guard BEFORE INSERT OR UPDATE OR DELETE ON world_access
      FOR EACH ROW EXECUTE FUNCTION guard_subject_grants();
      CREATE TABLE IF NOT EXISTS api_request (
      id uuid PRIMARY KEY,subject_id uuid NOT NULL REFERENCES world_subject(id),hash text NOT NULL,response jsonb);
      CREATE TABLE IF NOT EXISTS world_event (
      id bigserial PRIMARY KEY,subject_id uuid NOT NULL REFERENCES world_subject(id),
      construction_id uuid NOT NULL REFERENCES world_construction(id),role text NOT NULL,event_key text UNIQUE NOT NULL);
      CREATE INDEX IF NOT EXISTS world_event_scope ON world_event(subject_id,construction_id,role,id);
      CREATE OR REPLACE FUNCTION stamp_world_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(NEW.construction_id::text,0));
        NEW.id := nextval(pg_get_serial_sequence('world_event','id'));
        RETURN NEW;
      END $$;
      CREATE OR REPLACE TRIGGER world_event_order BEFORE INSERT ON world_event
      FOR EACH ROW EXECUTE FUNCTION stamp_world_event();
      CREATE OR REPLACE FUNCTION notify_construction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (NEW.state,NEW.at,NEW.target,NEW.participant_id,NEW.error) IS DISTINCT FROM
           (OLD.state,OLD.at,OLD.target,OLD.participant_id,OLD.error) THEN
          INSERT INTO world_event(subject_id,construction_id,role,event_key)
          SELECT subject_id,construction_id,role,gen_random_uuid()::text FROM world_access
          WHERE construction_id=NEW.id AND (role='admin' OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
            OR (role='player' AND (NEW.state IN ('playing','play_paused') OR OLD.state IN ('playing','play_paused'))));
        END IF;
        RETURN NEW;
      END $$;
      CREATE OR REPLACE TRIGGER construction_notification AFTER UPDATE ON world_construction
      FOR EACH ROW EXECUTE FUNCTION notify_construction();`);
    await this.scenes.setup();
    await this.players.setup();
    await this.pool.query(`INSERT INTO world_controlled_actor(world_id,actor_id)
      SELECT c.world_id,a.actor_id FROM world_access a JOIN world_construction c ON c.id=a.construction_id
      WHERE a.role='player' AND a.actor_id IS NOT NULL AND c.world_id IS NOT NULL ON CONFLICT DO NOTHING`);
  }

  async authorize(
    subject: string,
    id: string,
    role: Role,
    client: Pick<pg.Pool, "query"> = this.pool,
    actorId?: string,
  ) {
    await requireMember(client, subject, role === "admin");
    if (role === "admin") {
      const exists = await client.query(
        "SELECT id FROM world_construction WHERE id=$1",
        [id],
      );
      if (!exists.rowCount)
        throw new AccessError(
          404,
          "WORLD_NOT_FOUND",
          "利用できる世界が見つかりません",
        );
      return { actor_id: null };
    }
    const row = (
      await client.query<{ actor_id: string | null }>(
        `SELECT DISTINCT a.actor_id FROM world_access a JOIN world_subject s ON s.id=a.subject_id
       WHERE s.user_id=$1 AND a.construction_id=$2 AND a.role=$3 AND s.active AND ($4::uuid IS NULL OR a.actor_id=$4) LIMIT 2`,
        [subject, id, role, actorId ?? null],
      )
    ).rows;
    if (row.length > 1)
      throw new AccessError(
        409,
        "ACTOR_REQUIRED",
        "操作する存在を選んでください",
      );
    if (!row[0])
      throw new AccessError(
        404,
        "WORLD_NOT_FOUND",
        "利用できる世界が見つかりません",
      );
    return row[0];
  }
  async #accept<T>(
    subject: string,
    requestId: string,
    body: unknown,
    role: Role,
    perform: (client: pg.PoolClient) => Promise<T>,
  ) {
    const hash = digest(JSON.stringify(body));
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await requireMember(client, subject, role === "admin");
      await client.query(
        "INSERT INTO world_subject(id,user_id) VALUES($1,$1) ON CONFLICT DO NOTHING",
        [subject],
      );
      await client.query(
        "INSERT INTO api_request(id,subject_id,hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [requestId, subject, hash],
      );
      const saved = (
        await client.query<{
          subject_id: string;
          hash: string;
          response: T | null;
        }>("SELECT * FROM api_request WHERE id=$1 FOR UPDATE", [requestId])
      ).rows[0]!;
      const owner = await client.query(
        "SELECT id FROM world_subject WHERE id=$1 AND user_id=$2 AND active",
        [saved.subject_id, subject],
      );
      if (!owner.rowCount || saved.hash !== hash)
        throw new AccessError(
          409,
          "REQUEST_CONFLICT",
          "同じ要求IDに異なる内容は使用できません",
        );
      const response = saved.response ?? (await perform(client));
      if (saved.response === null)
        await client.query("UPDATE api_request SET response=$2 WHERE id=$1", [
          requestId,
          JSON.stringify(response),
        ]);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  statusData(row: Awaited<ReturnType<WorldConstruction["get"]>>) {
    return WorldStatus.parse({
      id: row.id,
      prompt: row.initial_prompt,
      createdAt: row.created_at.toISOString(),
      state: row.state,
      at: row.at,
      target: row.target,
      hasParticipant: row.participant_id !== null,
      publication: {
        title: row.public_title,
        description: row.public_description,
        published: row.published,
        accepting: row.accepting,
      },
      error: row.error,
    });
  }
  async create(subject: string, input: z.infer<typeof CreateWorld>) {
    return this.#accept(
      subject,
      input.requestId,
      { operation: "create", ...input },
      "admin",
      async (client) => {
        const id = await this.construction.create(
          input.prompt,
          input.budgetUsd,
          client,
        );
        await client.query(
          "UPDATE world_budget SET updated_by=$2 FROM world_build b WHERE world_budget.world_id=b.world_id AND b.run_id=$1",
          [id, subject],
        );
        await client.query(
          "INSERT INTO world_access(subject_id,construction_id,role) VALUES($1,$2,'admin')",
          [subject, id],
        );
        await client.query(
          "INSERT INTO world_event(subject_id,construction_id,role,event_key) VALUES($1,$2,'admin',$3)",
          [subject, id, input.requestId],
        );
        return this.statusData(await this.construction.get(id, client));
      },
    );
  }
  async command(
    subject: string,
    id: string,
    input: z.infer<typeof WorldCommand>,
  ) {
    await this.authorize(subject, id, "admin");
    return this.#accept(
      subject,
      input.requestId,
      { id, ...input },
      "admin",
      async (client) => {
        await this.authorize(subject, id, "admin", client);
        let row;
        try {
          row = await this.construction.command(
            id,
            input.command,
            "duration" in input ? input.duration : undefined,
            client,
          );
        } catch (error) {
          if (error instanceof ConstructionStateError)
            throw new AccessError(409, "STATE_CONFLICT", error.message);
          throw error;
        }
        return this.statusData(row);
      },
    );
  }
  async status(subject: string, id: string) {
    await this.authorize(subject, id, "admin");
    return this.statusData(await this.construction.get(id));
  }
  async playerData(
    row: Awaited<ReturnType<WorldConstruction["get"]>>,
    database: Pick<pg.Pool, "query"> = this.pool,
    actorId = row.participant_id,
  ) {
    const last = (
      await database.query<{ id: string }>(
        "SELECT id FROM world_run WHERE construction_id=$1 AND actor_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [row.id, actorId],
      )
    ).rows[0];
    return PlayerStatus.parse({
      id: row.id,
      viewerId: actorId,
      runId: last?.id ?? null,
      at: row.at,
      state:
        row.state === "play_paused"
          ? "paused"
          : row.state === "playing"
            ? "running"
            : "ready",
      error:
        row.state === "play_paused"
          ? "処理を保留しました。保存済みの状態から再開できます。"
          : null,
    });
  }
  async player(subject: string, id: string, actorId?: string) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    const row = await this.construction.get(id);
    const scene = await this.scenes.latest(
      id,
      this.pool,
      true,
      grant.actor_id!,
    );
    return {
      ...(await this.playerData(row, this.pool, grant.actor_id!)),
      at: scene && scene.state !== "result" ? scene.data.at : row.at,
      error:
        scene?.state === "paused" ||
        (grant.actor_id === row.participant_id && row.state === "play_paused")
          ? "処理を保留しました。保存済みの状態から再開できます。"
          : null,
      state: scene
        ? scene.state === "paused"
          ? ("paused" as const)
          : ["preparing", "acting", "reflecting"].includes(scene.state)
            ? ("running" as const)
            : ("ready" as const)
        : grant.actor_id === row.participant_id &&
            ["playing", "play_paused"].includes(row.state)
          ? row.state === "playing"
            ? ("running" as const)
            : ("paused" as const)
          : ("ready" as const),
    };
  }
  sceneData(row: SceneRow | null, compact = false) {
    if (!row) return { scene: null };
    const d = row.data;
    return {
      scene: SceneStatus.parse({
        id: row.id,
        requestId: d.commandId,
        viewerId: row.actor_id,
        at: d.at,
        state: row.state,
        synopsis: d.background?.synopsis ?? null,
        result: row.state === "result" ? (d.result ?? null) : null,
        error:
          row.state === "paused"
            ? d.limitReached
              ? "応答生成のcall回数上限に達しました。管理者による上限の見直し後、保存したシーンから再開できます。"
              : "処理を保留しました。保存したシーンから再開できます。"
            : null,
        messages: compact
          ? []
          : d.events.flatMap((e) =>
              e.receipts
                .filter((p) => p.observerId === row.actor_id)
                .map((p) => ({ id: e.id, text: p.text })),
            ),
        actions: compact ? d.actions.slice(-1) : d.actions,
        recordIds:
          !compact && d.background
            ? sceneAnchors(d.background, d.events, d.startedAt, row.id)
                .edges.filter(
                  (e) => e.kind === "see" && e.source === row.actor_id,
                )
                .map((e) => e.id)
            : [],
        nextPurpose: d.nextPurpose ?? null,
      }),
    };
  }
  async scene(subject: string, id: string, compact = false, actorId?: string) {
    const grant = await this.authorize(
        subject,
        id,
        "player",
        this.pool,
        actorId,
      ),
      row = await this.scenes.latest(id, this.pool, compact, grant.actor_id!);
    if (row && row.actor_id !== grant.actor_id)
      throw new AccessError(
        403,
        "ACTOR_CHANGED",
        "操作対象を再取得してください",
      );
    return this.sceneData(row, compact);
  }
  async sceneRecords(
    subject: string,
    id: string,
    input: z.infer<typeof SceneRecordQuery>,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      input.actorId,
    );
    const row = (
      await this.pool.query<{ count: number }>(
        "SELECT jsonb_array_length(data->$3) AS count FROM world_scene WHERE id=$1 AND construction_id=$2 AND actor_id=$4",
        [input.sceneId, id, input.kind, grant.actor_id],
      )
    ).rows[0];
    if (!row)
      throw new AccessError(
        404,
        "SCENE_NOT_FOUND",
        "利用できるシーンが見つかりません",
      );
    let position = row.count;
    const raw = input.after || input.before;
    if (raw) {
      try {
        const cursor = z
          .object({
            sceneId: z.literal(input.sceneId),
            kind: z.literal(input.kind),
            index: z.number().int().nonnegative().safe(),
          })
          .parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
        position = cursor.index;
      } catch {
        throw new AccessError(
          409,
          "CURSOR_INVALID",
          "履歴を再取得してください",
        );
      }
    }
    const low = input.after ? position + 1 : Math.max(0, position - 50),
      high = Math.min(
        row.count - 1,
        input.after ? position + 50 : position - 1,
      );
    const rows = (
      await this.pool.query<{
        item: SceneRow["data"]["events"][number] &
          SceneRow["data"]["actions"][number];
      }>(
        "SELECT data->$3->n AS item FROM world_scene CROSS JOIN generate_series($4::int,$5::int) n WHERE id=$1 AND construction_id=$2 ORDER BY n DESC",
        [input.sceneId, id, input.kind, low, high],
      )
    ).rows;
    const encode = (index: number) =>
      Buffer.from(
        JSON.stringify({ sceneId: input.sceneId, kind: input.kind, index }),
      ).toString("base64url");
    return SceneRecordPage.parse({
      viewerId: grant.actor_id,
      items: rows.flatMap(({ item }) => {
        const text =
          input.kind === "actions"
            ? item.text
            : item.receipts
                .filter((p) => p.observerId === grant.actor_id)
                .map((p) => p.text)
                .join("\n\n");
        return text
          ? [
              {
                id: item.id,
                text,
                at: input.kind === "events" ? item.period.from : null,
                kind: input.kind === "events" ? "message" : "action",
                continuation:
                  item.state === "boundary" ? "続きは次のシーンで" : null,
              },
            ]
          : [];
      }),
      next: low > 0 ? encode(low) : null,
      previous: high < row.count - 1 ? encode(high) : null,
    });
  }
  async sceneCommand(
    subject: string,
    id: string,
    input: z.infer<typeof SceneCommand>,
    compact = false,
    actorId?: string,
  ) {
    await this.authorize(subject, id, "player", this.pool, actorId);
    return this.#accept(
      subject,
      input.requestId,
      { operation: "scene", id, ...input, ...(actorId ? { actorId } : {}) },
      "player",
      async (client) => {
        const grant = await this.authorize(
          subject,
          id,
          "player",
          client,
          actorId,
        );
        try {
          return this.sceneData(
            input.command === "prepare"
              ? await this.scenes.open(
                  id,
                  input.purpose,
                  client,
                  input.requestId,
                  grant.actor_id!,
                )
              : await this.scenes.command(
                  id,
                  input.command,
                  client,
                  input,
                  grant.actor_id!,
                ),
            compact,
          );
        } catch (error) {
          if (error instanceof ConstructionStateError)
            throw new AccessError(409, "STATE_CONFLICT", error.message);
          throw error;
        }
      },
    );
  }
  async run(subject: string, id: string) {
    const row = (
      await this.pool.query<{
        id: string;
        construction_id: string;
        actor_id: string;
        action_text: string;
        state: string;
        started_at: string;
        at: string;
      }>("SELECT * FROM world_run WHERE id=$1", [id])
    ).rows[0];
    if (!row)
      throw new AccessError(
        404,
        "RUN_NOT_FOUND",
        "利用できる実行が見つかりません",
      );
    const grant = await this.authorize(
      subject,
      row.construction_id,
      "player",
      this.pool,
      row.actor_id,
    );
    if (grant.actor_id !== row.actor_id)
      throw new AccessError(
        404,
        "RUN_NOT_FOUND",
        "利用できる実行が見つかりません",
      );
    return PlayRun.parse({
      id: row.id,
      viewerId: row.actor_id,
      worldId: row.construction_id,
      actionText: row.action_text,
      startedAt: Number(row.started_at),
      at: Number(row.at),
      state: row.state,
      error:
        row.state === "paused"
          ? "処理を保留しました。保存済みの状態から再開できます。"
          : null,
    });
  }
  async play(
    subject: string,
    id: string,
    input: z.infer<typeof PlayerAction> | { requestId: string; resume: true },
  ) {
    await this.authorize(subject, id, "player");
    return this.#accept(
      subject,
      input.requestId,
      { operation: "play", id, ...input },
      "player",
      async (client) => {
        const grant = await this.authorize(subject, id, "player", client);
        const current = await this.construction.get(id, client, true);
        const scene = await this.scenes.latest(
          id,
          client,
          true,
          grant.actor_id!,
        );
        if (scene && scene.state !== "result")
          throw new AccessError(
            409,
            "STATE_CONFLICT",
            "進行中のシーンを終えてください",
          );
        if (grant.actor_id !== current.participant_id)
          throw new AccessError(
            403,
            "ACTOR_CHANGED",
            "操作対象を再取得してください",
          );
        try {
          if ("resume" in input) {
            if (current.state !== "play_paused")
              throw new ConstructionStateError(
                "保留中の行動を指定してください",
              );
            return this.playerData(
              await this.construction.command(id, "resume", undefined, client),
              client,
            );
          }
          return this.playerData(
            await this.construction.play(
              id,
              input.actionText,
              client,
              input.requestId,
            ),
            client,
          );
        } catch (error) {
          if (error instanceof ConstructionStateError)
            throw new AccessError(409, "STATE_CONFLICT", error.message);
          throw error;
        }
      },
    );
  }
  async list(subject: string) {
    const member = await requireMember(this.pool, subject);
    return (
      await this.pool.query<{ id: string }>(
        member.role === "admin"
          ? "SELECT id FROM world_construction ORDER BY id"
          : "SELECT DISTINCT a.construction_id AS id FROM world_access a JOIN world_subject s ON s.id=a.subject_id WHERE s.user_id=$1 AND s.active AND a.role='player' ORDER BY id",
        member.role === "admin" ? [] : [subject],
      )
    ).rows;
  }
  async records(subject: string, id: string, before?: string, after?: string) {
    await this.authorize(subject, id, "admin");
    if ((before && !sequence(before)) || (after && !sequence(after)))
      throw new AccessError(409, "CURSOR_INVALID", "履歴を再取得してください");
    const rows = (
      await this.pool.query<{
        id: string;
        at: string;
        result: {
          summary: string;
          continuation?: string;
          changes: { nodes: unknown[]; edges: unknown[] };
        };
      }>(
        `SELECT id::text,at::text,result FROM construction_log WHERE construction_id=$1 AND ($2::bigint IS NULL OR id${after ? ">" : "<"}$2) ORDER BY id ${after ? "ASC" : "DESC"} LIMIT 51`,
        [id, after || before || null],
      )
    ).rows;
    const page = rows.slice(0, 50);
    if (after) page.reverse();
    const items = page.map((row) => ({
      id: row.id,
      at: Number(row.at),
      summary: row.result.summary,
      continuation: row.result.continuation ?? null,
      counts: {
        nodes: row.result.changes.nodes.length,
        edges: row.result.changes.edges.length,
      },
    }));
    if (!after && rows.length < 50) {
      const initial = (
        await this.pool.query<{
          result: {
            report: string;
            changes: { nodes: unknown[]; edges: unknown[] };
          } | null;
        }>("SELECT result FROM world_build WHERE run_id=$1", [id])
      ).rows[0]?.result;
      if (initial)
        items.push({
          id: "initial",
          at: 0,
          summary: initial.report,
          continuation: null,
          counts: {
            nodes: initial.changes.nodes.length,
            edges: initial.changes.edges.length,
          },
        });
    }
    return AdminPage.parse({
      items,
      next:
        page.length && (after || rows.length >= 50) ? page.at(-1)!.id : null,
      previous:
        items.length && (after ? rows.length > 50 : !!before)
          ? (page[0]?.id ?? "0")
          : null,
    });
  }
  async knowledge(
    subject: string,
    id: string,
    before?: string,
    after?: string,
    excludeScene?: string,
    actorId?: string,
  ) {
    const grant = await this.authorize(
      subject,
      id,
      "player",
      this.pool,
      actorId,
    );
    const row = await this.construction.get(id);
    let cursor: z.infer<typeof Cursor> | undefined;
    const raw = after || before;
    if (raw)
      try {
        cursor = Cursor.parse(
          JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
        );
      } catch {
        throw new AccessError(
          409,
          "CURSOR_INVALID",
          "履歴を再取得してください",
        );
      }
    const context = this.construction.agent.store.context(row.world_id!);
    const all = (
      await Promise.all([
        context.historyPage(
          grant.actor_id!,
          "see",
          row.at,
          after ? undefined : cursor,
          after ? cursor : undefined,
        ),
        context.historyPage(
          grant.actor_id!,
          "interpret",
          row.at,
          after ? undefined : cursor,
          after ? cursor : undefined,
        ),
      ])
    )
      .flat()
      .sort(
        (a, b) =>
          (after ? 1 : -1) *
          (a.period.from - b.period.from ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      );
    const edges = all.slice(0, 50);
    if (after) edges.reverse();
    const items = [];
    const excluded = new Set(
      excludeScene
        ? (
            await this.pool.query<{ id: string }>(
              `SELECT e->>'id' AS id FROM world_scene s JOIN world_operation o ON o.id=(s.data->>'operationId')::uuid
       CROSS JOIN LATERAL jsonb_array_elements(o.request#>'{completedScene,anchors,edges}') e
       WHERE s.id=$1 AND s.construction_id=$2 AND s.actor_id=$3 AND e->>'kind'='see' AND e->>'id'=ANY($4::text[])`,
              [excludeScene, id, grant.actor_id, edges.map((e) => e.id)],
            )
          ).rows.map((e) => e.id)
        : [],
    );
    for (const edge of edges) {
      if (excluded.has(edge.id)) continue;
      if (edge.kind === "interpret" && edge.role !== "content") continue;
      const content =
        edge.kind === "interpret"
          ? await context.node(
              edge.target,
              Math.min(
                row.at,
                Math.max(0, (edge.period.until ?? row.at + 1) - 1),
              ),
            )
          : undefined;
      items.push({
        id: edge.id,
        kind: edge.kind === "see" ? "observation" : "interpretation",
        text:
          edge.kind === "see"
            ? edge.text || edge.observation?.aspect || ""
            : (content?.text ?? ""),
        from: edge.period.from,
        ...(edge.period.until === undefined
          ? {}
          : { until: edge.period.until }),
      });
    }
    await context.validate();
    const encode = (edge: (typeof edges)[number] | undefined) =>
      edge
        ? Buffer.from(
            JSON.stringify({ from: edge.period.from, id: edge.id }),
          ).toString("base64url")
        : null;
    return KnowledgePage.parse({
      viewerId: grant.actor_id,
      at: row.at,
      items,
      next: after || all.length > 50 ? encode(edges.at(-1)) : null,
      previous: (after ? all.length > 50 : !!before) ? encode(edges[0]) : null,
    });
  }
  async reconcile(id: string) {
    const row = (
      await this.pool.query<{ world_id: string }>(
        "SELECT coalesce(c.world_id,b.world_id) AS world_id FROM world_construction c JOIN world_build b ON b.run_id=c.id WHERE c.id=$1",
        [id],
      )
    ).rows[0];
    if (!row) return;
    const store = this.construction.agent.store;
    for (const receipt of await store.pendingReceipts(row.world_id)) {
      const context = store.context(row.world_id),
        edges = [...receipt.changes.edges];
      for (const edgeId of receipt.changes.endEdges) {
        const edge = await context.edge(edgeId);
        if (edge) edges.push(edge);
      }
      const actors = new Set(
        edges
          .filter(
            (e) =>
              e.kind === "see" ||
              (e.kind === "interpret" && e.role === "content"),
          )
          .map((e) => e.source),
      );
      for (const node of receipt.changes.revisions.filter(
        (n) => n.kind === "script",
      ))
        for (const edge of await context.history(
          node.id,
          "interpret",
          "in",
          receipt.at,
        ))
          if (edge.role === "content") actors.add(edge.source);
      await context.validate();
      await this.pool.query(
        `INSERT INTO world_event(subject_id,construction_id,role,event_key)
         SELECT a.subject_id,a.construction_id,a.role,'commit:'||$2::text||':'||a.subject_id::text||':'||a.role||':'||a.construction_id::text
         FROM world_access a JOIN world_subject s ON s.id=a.subject_id
         WHERE a.construction_id=$1 AND s.active AND (a.role='admin' OR a.actor_id=ANY($3::uuid[]))
         ON CONFLICT(event_key) DO NOTHING`,
        [id, receipt.commitId, [...actors]],
      );
      await store.ackReceipt(row.world_id, receipt.commitId);
    }
  }

  async events(
    subject: string,
    id: string,
    role: Role,
    after: string,
    actorId?: string,
  ) {
    await this.authorize(subject, id, role, this.pool, actorId);
    if (!sequence(after))
      throw new AccessError(409, "CURSOR_INVALID", "進捗を再取得してください");
    if (after !== "0") {
      const cursor = await this.pool.query(
        "SELECT e.id FROM world_event e JOIN world_subject s ON s.id=e.subject_id WHERE e.id=$1 AND ($4='admin' OR (s.user_id=$2 AND s.active)) AND e.construction_id=$3 AND e.role=$4",
        [after, subject, id, role],
      );
      if (!cursor.rowCount)
        throw new AccessError(
          409,
          "CURSOR_INVALID",
          "進捗を再取得してください",
        );
    }
    await this.reconcile(id);
    return (
      await this.pool.query<{ id: string }>(
        "SELECT e.id::text FROM world_event e JOIN world_subject s ON s.id=e.subject_id WHERE ($3='admin' OR (s.user_id=$1 AND s.active)) AND e.construction_id=$2 AND e.role=$3 AND e.id>$4 ORDER BY e.id LIMIT 50",
        [subject, id, role, after],
      )
    ).rows;
  }
  async cursor(subject: string, id: string, role: Role, actorId?: string) {
    await this.authorize(subject, id, role, this.pool, actorId);
    await this.reconcile(id);
    return {
      cursor: (
        await this.pool.query<{ id: string }>(
          "SELECT coalesce(max(e.id),0)::text AS id FROM world_event e JOIN world_subject s ON s.id=e.subject_id WHERE ($3='admin' OR (s.user_id=$1 AND s.active)) AND e.construction_id=$2 AND e.role=$3",
          [subject, id, role],
        )
      ).rows[0]!.id,
    };
  }
}
