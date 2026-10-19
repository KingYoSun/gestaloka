import { createHash, randomBytes, randomUUID } from "node:crypto";
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
} from "@gestaloka/contracts";
import {
  ConstructionStateError,
  type WorldConstruction,
} from "../runtime/construction.js";

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
  constructor(readonly construction: WorldConstruction) {}
  get pool() {
    return this.construction.pool;
  }

  async setup() {
    await this.construction.setup();
    await this.pool.query(`CREATE TABLE IF NOT EXISTS browser_session (
      id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, active boolean NOT NULL DEFAULT true);
      CREATE TABLE IF NOT EXISTS world_access (
      subject_id uuid NOT NULL REFERENCES browser_session(id), construction_id uuid NOT NULL REFERENCES world_construction(id),
      role text NOT NULL CHECK(role IN ('admin','player')),actor_id uuid,
      PRIMARY KEY(subject_id,construction_id,role));
      CREATE TABLE IF NOT EXISTS api_request (
      id uuid PRIMARY KEY,subject_id uuid NOT NULL REFERENCES browser_session(id),hash text NOT NULL,response jsonb);
      CREATE TABLE IF NOT EXISTS world_event (
      id bigserial PRIMARY KEY,subject_id uuid NOT NULL REFERENCES browser_session(id),
      construction_id uuid NOT NULL REFERENCES world_construction(id),role text NOT NULL,event_key text UNIQUE NOT NULL);
      CREATE INDEX IF NOT EXISTS world_event_scope ON world_event(subject_id,construction_id,role,id);
      CREATE OR REPLACE FUNCTION notify_construction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.participant_id IS NOT NULL THEN
          INSERT INTO world_access(subject_id,construction_id,role,actor_id)
          SELECT subject_id,construction_id,'player',NEW.participant_id FROM world_access
          WHERE construction_id=NEW.id AND role='admin' ON CONFLICT DO NOTHING;
        END IF;
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
  }

  async session(token?: string) {
    if (token) {
      const known = await this.pool.query<{ id: string }>(
        "SELECT id FROM browser_session WHERE token_hash=$1 AND active",
        [digest(token)],
      );
      if (known.rows[0]) return { id: known.rows[0].id };
    }
    const id = randomUUID(),
      credential = randomBytes(32).toString("base64url");
    await this.pool.query(
      "INSERT INTO browser_session(id,token_hash) VALUES($1,$2)",
      [id, digest(credential)],
    );
    return { id, credential };
  }
  async authenticate(token?: string) {
    const row = token
      ? (
          await this.pool.query<{ id: string }>(
            "SELECT id FROM browser_session WHERE token_hash=$1 AND active",
            [digest(token)],
          )
        ).rows[0]
      : undefined;
    if (!row)
      throw new AccessError(
        401,
        "SESSION_REQUIRED",
        "セッションを確認してください",
      );
    return row.id;
  }
  async authorize(
    subject: string,
    id: string,
    role: Role,
    client: Pick<pg.Pool, "query"> = this.pool,
  ) {
    const row = (
      await client.query<{ actor_id: string | null }>(
        `SELECT a.actor_id FROM world_access a JOIN browser_session s ON s.id=a.subject_id
       WHERE a.subject_id=$1 AND a.construction_id=$2 AND a.role=$3 AND s.active`,
        [subject, id, role],
      )
    ).rows[0];
    if (!row)
      throw new AccessError(
        404,
        "WORLD_NOT_FOUND",
        "利用できる世界が見つかりません",
      );
    return row;
  }
  async #accept<T>(
    subject: string,
    requestId: string,
    body: unknown,
    perform: (client: pg.PoolClient) => Promise<T>,
  ) {
    const hash = digest(JSON.stringify(body));
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const active = (
        await client.query(
          "SELECT id FROM browser_session WHERE id=$1 AND active FOR SHARE",
          [subject],
        )
      ).rowCount;
      if (!active)
        throw new AccessError(
          401,
          "SESSION_REQUIRED",
          "セッションを確認してください",
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
      if (saved.subject_id !== subject || saved.hash !== hash)
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
      error: row.error,
    });
  }
  async create(subject: string, input: { requestId: string; prompt: string }) {
    return this.#accept(
      subject,
      input.requestId,
      { operation: "create", ...input },
      async (client) => {
        const id = await this.construction.create(input.prompt, client);
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
  ) {
    const last = (
      await database.query<{ id: string }>(
        "SELECT id FROM world_run WHERE construction_id=$1 AND actor_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [row.id, row.participant_id],
      )
    ).rows[0];
    return PlayerStatus.parse({
      id: row.id,
      viewerId: row.participant_id,
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
  async player(subject: string, id: string) {
    const grant = await this.authorize(subject, id, "player");
    const row = await this.construction.get(id);
    if (grant.actor_id !== row.participant_id)
      throw new AccessError(
        403,
        "ACTOR_CHANGED",
        "操作対象を再取得してください",
      );
    return this.playerData(row);
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
    const grant = await this.authorize(subject, row.construction_id, "player");
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
      async (client) => {
        const grant = await this.authorize(subject, id, "player", client);
        const current = await this.construction.get(id, client, true);
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
    return (
      await this.pool.query<{ id: string }>(
        "SELECT construction_id AS id FROM world_access WHERE subject_id=$1 AND role='admin' ORDER BY construction_id",
        [subject],
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
  ) {
    const grant = await this.authorize(subject, id, "player");
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
    for (const edge of edges) {
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
            ? edge.observation?.aspect || edge.text || ""
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
  async events(subject: string, id: string, role: Role, after: string) {
    await this.authorize(subject, id, role);
    if (!sequence(after))
      throw new AccessError(409, "CURSOR_INVALID", "進捗を再取得してください");
    if (after !== "0") {
      const cursor = await this.pool.query(
        "SELECT id FROM world_event WHERE id=$1 AND subject_id=$2 AND construction_id=$3 AND role=$4",
        [after, subject, id, role],
      );
      if (!cursor.rowCount)
        throw new AccessError(
          409,
          "CURSOR_INVALID",
          "進捗を再取得してください",
        );
    }
    return (
      await this.pool.query<{ id: string }>(
        "SELECT id::text FROM world_event WHERE subject_id=$1 AND construction_id=$2 AND role=$3 AND id>$4 ORDER BY id LIMIT 50",
        [subject, id, role, after],
      )
    ).rows;
  }
  async cursor(subject: string, id: string, role: Role) {
    await this.authorize(subject, id, role);
    return {
      cursor: (
        await this.pool.query<{ id: string }>(
          "SELECT coalesce(max(id),0)::text AS id FROM world_event WHERE subject_id=$1 AND construction_id=$2 AND role=$3",
          [subject, id, role],
        )
      ).rows[0]!.id,
    };
  }
}
