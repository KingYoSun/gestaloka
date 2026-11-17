import type pg from "pg";
import { randomUUID } from "node:crypto";
import type { WorldStore } from "../world/store.js";
import {
  sceneAnchors,
  sceneId,
  type SceneBackground,
  type RecordedSceneEvent,
} from "./scene-data.js";
import type { SceneRow } from "./scene.js";
import type { SharedScenes } from "./shared-scenes.js";
import type { ReceivedContact } from "./player-contact.js";
import type { SceneIntent } from "./scene-data.js";

type Db = Pick<pg.Pool, "query">;
type Member = {
  scene_id: string;
  actor_id: string;
  kind: "human" | "bot";
  session_id: string | null;
  request_id: string;
  last_request_id: string | null;
};
type Link = {
  id: string;
  world_id: string;
  source_scene: string;
  target_scene: string;
  speaker: string;
  listener: string;
  event_id: string;
  input_id: string;
  at: string;
  text: string;
  reply_id: string | null;
  queued_text: string | null;
  reply_kind: "human" | "bot" | null;
};
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
  async attach(db: pg.PoolClient, scene: string, actor: string, fresh = false) {
    const row = (
      await db.query<SceneRow>("SELECT * FROM world_scene WHERE id=$1", [scene])
    ).rows[0]!;
    if (fresh)
      await db.query(
        "UPDATE world_scene_session SET closed=true WHERE world_id=$1 AND actor_id=$2 AND NOT closed",
        [row.construction_id, actor],
      );
    const existing =
      !fresh &&
      (
        await db.query<Session>(
          "SELECT * FROM world_scene_session WHERE world_id=$1 AND actor_id=$2 AND NOT closed",
          [row.construction_id, actor],
        )
      ).rows[0];
    const id = existing ? existing.id : scene;
    if (existing)
      await db.query(
        "UPDATE world_scene_session SET current_id=$3 WHERE id=$1 AND actor_id=$2",
        [id, actor, scene],
      );
    else
      await db.query(
        "INSERT INTO world_scene_session(id,actor_id,world_id,current_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [id, actor, row.construction_id, scene],
      );
    await db.query(
      "UPDATE world_scene_member SET session_id=$3 WHERE scene_id=$1 AND actor_id=$2",
      [scene, actor, id],
    );
    return id;
  }
  async resolve(id: string, actor: string, db: Db = this.pool) {
    return (await this.get(id, actor, db))?.current_id ?? id;
  }
  async finish(
    scene: string,
    actor: string,
    result: NonNullable<Session["result"]>,
    shared: SharedScenes,
  ) {
    await shared.transaction(async (db) => {
      const view = await this.current(scene, actor, db);
      if (!view) return;
      await shared.lock(db, view.world_id);
      const updated = await db.query(
        "UPDATE world_scene_session SET closed=true,result=$3 WHERE id=$1 AND actor_id=$2 AND result IS NULL RETURNING id",
        [view.id, actor, JSON.stringify(result)],
      );
      if (!updated.rowCount) return;
      await db.query(
        "UPDATE world_scene_member SET state='ended' WHERE scene_id=$1 AND actor_id=$2",
        [scene, actor],
      );
      await shared.notice(db, view.world_id, actor, scene, "result");
    });
  }
  async record(db: pg.PoolClient, row: SceneRow) {
    const members = (
      await db.query<{ actor_id: string; session_id: string | null }>(
        "SELECT actor_id,session_id FROM world_scene_member WHERE scene_id=$1 AND state IN ('joined','left')",
        [row.id],
      )
    ).rows;
    for (const member of members) {
      if (!member.session_id) {
        const current = (
          await db.query<{ scene_id: string }>(
            "SELECT scene_id FROM world_actor_scene WHERE world_id=$1 AND actor_id=$2",
            [row.construction_id, member.actor_id],
          )
        ).rows[0];
        if (current?.scene_id !== row.id) continue;
        member.session_id = await this.attach(db, row.id, member.actor_id);
      }
      const session = await this.get(member.session_id, member.actor_id, db);
      if (!session || session.current_id !== row.id) continue;
      if (
        !session.opening &&
        row.data.background?.perceptions.some(
          (p) => p.observerId === member.actor_id,
        )
      )
        await db.query(
          "UPDATE world_scene_session SET opening=$3 WHERE id=$1 AND actor_id=$2 AND opening IS NULL",
          [
            session.id,
            member.actor_id,
            JSON.stringify({
              sceneId: row.id,
              at: row.data.startedAt,
              background: row.data.background,
            }),
          ],
        );
      for (const kind of ["events", "actions"] as const) {
        const offset =
          kind === "events" ? session.event_offset : session.action_offset;
        const items = row.data[kind].flatMap<{
          id: string;
          position: number;
          payload: unknown;
        }>((item, index) => {
          if ("receipts" in item) {
            const receipts = item.receipts.filter(
              (r) => r.observerId === member.actor_id,
            );
            return receipts.length
              ? [
                  {
                    id: item.id,
                    position: offset + index,
                    payload: { ...item, receipts },
                  },
                ]
              : [];
          }
          return (item.actorId ?? row.actor_id) === member.actor_id
            ? [
                {
                  id: item.id,
                  position: offset + index,
                  payload: { ...item, actorId: member.actor_id },
                },
              ]
            : [];
        });
        if (items.length)
          await db.query(
            `INSERT INTO world_scene_record(session_id,actor_id,kind,id,scene_id,position,payload)
          SELECT $1,$2,$3,i.id,$4,i.position,i.payload FROM jsonb_to_recordset($5) AS i(id uuid,position integer,payload jsonb)
          ON CONFLICT(session_id,actor_id,kind,id) DO UPDATE SET payload=CASE WHEN excluded.kind='actions' THEN
          (world_scene_record.payload-'state'-'completedAt') || jsonb_strip_nulls(jsonb_build_object('state',excluded.payload->'state','completedAt',excluded.payload->'completedAt')) ELSE world_scene_record.payload END`,
            [session.id, member.actor_id, kind, row.id, JSON.stringify(items)],
          );
      }
      await db.query(
        "UPDATE world_scene_session SET event_count=greatest(event_count,event_offset+$3),action_count=greatest(action_count,action_offset+$4) WHERE id=$1 AND actor_id=$2",
        [
          session.id,
          member.actor_id,
          row.data.events.length,
          row.data.actions.length,
        ],
      );
    }
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
  ): Promise<{ row: SceneRow; anchorId: string }> {
    const session = (
      await db.query<Session>(
        "SELECT * FROM world_scene_session WHERE current_id=$1 AND actor_id=$2",
        [row.id, actor],
      )
    ).rows[0];
    if (!session?.opening) return { row, anchorId: row.id };
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
      anchorId: session.opening.sceneId,
      row: {
        ...row,
        id: session.id,
        actor_id: actor,
        state: session.result
          ? "result"
          : session.closed && ["ready", "active", "acting"].includes(row.state)
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
  history(row: SceneRow) {
    return [
      ...new Map(
        [
          ...(row.data.drafts ?? []).flatMap((d) => d.events),
          ...row.data.events,
        ].map((e) => [e.id, e]),
      ).values(),
    ];
  }
  async context(row: SceneRow, actor: string, db: Db = this.pool) {
    const session = (
      await db.query<Session>(
        "SELECT * FROM world_scene_session WHERE current_id=$1 AND actor_id=$2",
        [row.id, actor],
      )
    ).rows[0];
    const stored = session
      ? (await this.records(session.id, actor, "events", db)).map((r) => r.item)
      : [];
    const events = [
      ...new Map(
        [...stored, ...this.history(row)].map((e) => [e.id, e]),
      ).values(),
    ].filter((e) => e.receipts.some((r) => r.observerId === actor));
    return {
      seen: events.map((e) => e.id),
      context: [
        ...(session?.opening?.background ?? row.data.background)!.perceptions
          .filter((p) => p.observerId === actor)
          .map((p) => p.text),
        ...events.flatMap((e) =>
          e.receipts.filter((r) => r.observerId === actor).map((r) => r.text),
        ),
      ],
    };
  }
  async received(
    scene: SceneRow | string,
    actors: string[],
    db: Db = this.pool,
  ): Promise<ReceivedContact[]> {
    const row =
      typeof scene === "string"
        ? (
            await db.query<SceneRow>("SELECT * FROM world_scene WHERE id=$1", [
              scene,
            ])
          ).rows[0]!
        : scene;
    const legacy = (
      await db.query<ReceivedContact>(
        `SELECT event_id AS "eventId",speaker,listener,at::float8,text,reply_id AS "replyInputId" FROM world_player_contact WHERE target_scene=$1 AND listener=ANY($2::uuid[]) ORDER BY at,id`,
        [row.id, actors],
      )
    ).rows;
    const result = new Map(
      legacy.map((r) => [`${r.eventId}:${r.listener}`, r]),
    );
    for (const actor of actors) {
      const session = (
        await db.query<Session>(
          "SELECT * FROM world_scene_session WHERE current_id=$1 AND actor_id=$2",
          [row.id, actor],
        )
      ).rows[0];
      const stored = session
        ? (await this.records(session.id, actor, "events", db)).map(
            (r) => r.item,
          )
        : [];
      for (const event of [...this.history(row), ...stored])
        for (const r of event.receipts.filter(
          (r) => r.observerId === actor && event.actorId !== actor,
        ))
          result.set(`${event.id}:${actor}`, {
            eventId: event.id,
            speaker: event.actorId,
            listener: actor,
            at: r.at ?? event.period.until ?? event.period.from,
            text: r.text,
            replyInputId:
              result.get(`${event.id}:${actor}`)?.replyInputId ?? null,
          });
    }
    return [...result.values()].sort((a, b) => a.at - b.at);
  }
  async ready(scene: string, intent: SceneIntent, db: Db = this.pool) {
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
  async inherit(db: pg.PoolClient, child: SceneRow, prior: SceneRow) {
    const exit = prior.data.departures?.[child.actor_id],
      drafts = [...(child.data.drafts ?? []), ...(prior.data.drafts ?? [])];
    if (
      exit !== undefined ||
      prior.data.waitingFor?.length ||
      prior.data.handoff
    ) {
      const events = prior.data.events.slice(
        0,
        exit ?? prior.data.events.length,
      );
      drafts.push({
        sceneId: prior.id,
        at: events.at(-1)?.period.until ?? prior.data.startedAt,
        startedAt: prior.data.startedAt,
        background: prior.data.background!,
        events,
      });
    }
    child.data.drafts = [
      ...new Map(drafts.map((d) => [d.sceneId, d])).values(),
    ];
    child.data.at = child.data.startedAt = Math.max(
      child.data.at,
      ...drafts.map((d) => d.at),
    );
    for (const draft of drafts)
      await db.query(
        "INSERT INTO world_scene_dependency(child_id,parent_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [child.id, draft.sceneId],
      );
  }
  run<T>(row: SceneRow, work: () => Promise<T>) {
    return this.store.withDrafts(
      row.data.worldId,
      (row.data.drafts ?? []).map((d) => ({
        at: d.startedAt,
        changes: sceneAnchors(d.background, d.events, d.startedAt, d.sceneId),
      })),
      work,
    );
  }
  async waitingFor(row: SceneRow) {
    const parents = (
      await this.pool.query<{ id: string; commit_id: string | null }>(
        "SELECT s.id,o.commit_id FROM world_scene_dependency d JOIN world_scene s ON s.id=d.parent_id LEFT JOIN world_operation o ON o.id=(s.data->>'operationId')::uuid WHERE d.child_id=$1 ORDER BY s.created_at,s.id",
        [row.id],
      )
    ).rows;
    const waiting = [];
    for (const parent of parents)
      if (
        !parent.commit_id ||
        !(await this.store.receipt(row.data.worldId, parent.commit_id))
      )
        waiting.push(parent.id);
    return waiting;
  }
  async dependents(db: pg.PoolClient, parent: string) {
    return (
      await db.query<{ id: string; shared: boolean }>(
        "SELECT s.id,s.data ? 'shared' AS shared FROM world_scene_dependency d JOIN world_scene s ON s.id=d.child_id WHERE d.parent_id=$1 AND s.state='reflecting'",
        [parent],
      )
    ).rows;
  }

  async pending(db: Db, scene: string) {
    return !!(
      await db.query(
        `SELECT 1 FROM world_player_contact WHERE state='handoff' AND (source_scene=$1 OR target_scene=$1)
        UNION ALL SELECT 1 FROM world_scene_session s WHERE s.current_id=$1 AND s.closed AND s.result IS NULL
        AND EXISTS(SELECT 1 FROM world_scene_session other WHERE other.current_id=$1 AND NOT other.closed) LIMIT 1`,
        [scene],
      )
    ).rowCount;
  }
  async closeScene(db: Db, scene: string, actors?: string[]) {
    await db.query(
      "UPDATE world_scene_session SET closed=true WHERE current_id=$1 AND ($2::uuid[] IS NULL OR actor_id=ANY($2))",
      [scene, actors ?? null],
    );
  }
  async end(
    db: pg.PoolClient,
    shared: SharedScenes,
    row: SceneRow,
    actor: string,
  ) {
    await this.record(db, row);
    await this.closeScene(db, row.id, [actor]);
    const open = (
      await db.query(
        "SELECT 1 FROM world_scene_session WHERE current_id=$1 AND NOT closed",
        [row.id],
      )
    ).rowCount;
    if (!open) await shared.turns.close(db, row.id, "requested");
    else {
      row.data.finishActors = [
        ...new Set([...(row.data.finishActors ?? []), actor]),
      ];
      await db.query(
        "UPDATE world_scene SET data=jsonb_set(data,'{finishActors}',$2),inspection_revision=inspection_revision+1 WHERE id=$1",
        [row.id, JSON.stringify(row.data.finishActors)],
      );
    }
    await shared.wake(db, row.id);
  }
  async current(scene: string, actor: string, db: Db = this.pool) {
    return (
      await db.query<Session>(
        "SELECT * FROM world_scene_session WHERE current_id=$1 AND actor_id=$2",
        [scene, actor],
      )
    ).rows[0];
  }
  async priorRows(row: SceneRow, actor: string) {
    const session = await this.current(row.id, actor);
    if (!session) return [];
    return (
      await this.pool.query<SceneRow>(
        `SELECT s.* FROM world_scene s WHERE s.id<>$3 AND (s.id=$4 OR s.id IN
      (SELECT scene_id FROM world_scene_record WHERE session_id=$1 AND actor_id=$2
       UNION SELECT scene_id FROM world_scene_member WHERE session_id=$1 AND actor_id=$2)) ORDER BY s.created_at,s.id`,
        [session.id, actor, row.id, session.opening?.sceneId ?? null],
      )
    ).rows;
  }

  /** Changes execution ownership only after the affected turns have finished. */
  async process(db: pg.PoolClient, shared: SharedScenes, row: SceneRow) {
    if (row.data.handoff) return false;
    await db.query(
      `UPDATE world_player_contact c SET state='handoff',queued_text=t.data->>'actionText'
      FROM world_scene_turn t WHERE c.reply_id=t.id AND t.scene_id=$1 AND t.state IN ('queued','held') AND t.command='act' AND c.state='answered'`,
      [row.id],
    );
    await db.query(
      `UPDATE world_scene_turn t SET state='resolved' FROM world_player_contact c
      WHERE c.reply_id=t.id AND t.scene_id=$1 AND t.state IN ('queued','held') AND c.state='handoff'`,
      [row.id],
    );
    let parents = [row];
    let links: Link[] = [];
    let members: Member[] = [];
    for (;;) {
      members = (
        await db.query<Member>(
          `SELECT m.* FROM world_scene_member m JOIN world_actor_scene a
        ON a.world_id=m.world_id AND a.actor_id=m.actor_id AND a.scene_id=m.scene_id
        WHERE m.scene_id=ANY($1::uuid[]) AND m.state IN ('joined','left')`,
          [parents.map((p) => p.id)],
        )
      ).rows;
      const actors = members.map((m) => m.actor_id);
      links = (
        await db.query<Link>(
          "SELECT * FROM world_player_contact WHERE world_id=$1 AND state='handoff' AND (speaker=ANY($2::uuid[]) OR listener=ANY($2::uuid[])) ORDER BY deadline,id",
          [row.construction_id, actors],
        )
      ).rows;
      const all = [
        ...new Set([
          ...actors,
          ...links.flatMap((l) => [l.speaker, l.listener]),
        ]),
      ];
      const current = (
        await db.query<SceneRow>(
          `SELECT s.* FROM world_scene s JOIN world_actor_scene a ON a.scene_id=s.id
          JOIN world_scene_member m ON m.scene_id=s.id AND m.actor_id=a.actor_id
          WHERE a.world_id=$1 AND a.actor_id=ANY($2::uuid[]) AND m.state IN ('joined','left') AND s.state<>'result'`,
          [row.construction_id, all],
        )
      ).rows;
      const unique = [...new Map(current.map((p) => [p.id, p])).values()];
      if (unique.every((p) => parents.some((old) => old.id === p.id))) break;
      parents = unique;
    }
    const closing = (
      await db.query<{ actor_id: string }>(
        "SELECT actor_id FROM world_scene_session WHERE current_id=$1 AND closed AND result IS NULL",
        [row.id],
      )
    ).rows;
    if (
      !closing.length &&
      !links.length &&
      !row.data.splitActors?.length &&
      !row.data.finishActors?.length
    )
      return false;
    const busy = (
      await db.query<{ id: string }>(
        "SELECT id FROM runtime_execution WHERE kind='scene' AND id=ANY($1::uuid[]) AND id<>$2 AND state IN ('running','waiting')",
        [parents.map((p) => p.id), row.id],
      )
    ).rows;
    const earlyClosed = (
      await db.query<{ actor_id: string }>(
        "SELECT actor_id FROM world_scene_session WHERE current_id=$1 AND closed AND result IS NULL",
        [row.id],
      )
    ).rows;
    if (
      !links.length &&
      !row.data.splitActors?.length &&
      earlyClosed.length &&
      members.every((m) => earlyClosed.some((c) => c.actor_id === m.actor_id))
    ) {
      await shared.turns.close(db, row.id, "requested");
      return false;
    }
    // The current worker must finish its own durable work before handing it off.
    if (
      !row.data.background ||
      row.data.turn ||
      row.state === "preparing" ||
      (row.data.work &&
        !(row.state === "reflecting" && row.data.work.kind === "result"))
    )
      return false;
    if (
      busy.length ||
      parents.some(
        (p) =>
          !p.data.background ||
          p.data.turn ||
          (p.data.work &&
            !(p.state === "reflecting" && p.data.work.kind === "result")) ||
          p.state === "preparing",
      )
    ) {
      await shared.schedule(
        db,
        `handoff:${row.id}`,
        { sceneId: row.id },
        new Date(shared.now().getTime() + 1000),
      );
      return true;
    }
    for (const parent of parents) await this.record(db, parent);
    members = (
      await db.query<Member>(
        `SELECT m.* FROM world_scene_member m JOIN world_actor_scene a
      ON a.world_id=m.world_id AND a.actor_id=m.actor_id AND a.scene_id=m.scene_id
      WHERE m.scene_id=ANY($1::uuid[]) AND m.state IN ('joined','left')`,
        [parents.map((p) => p.id)],
      )
    ).rows;
    const actorSet = new Set(members.map((m) => m.actor_id));
    const sessions = new Map<string, Session>();
    for (const m of members) {
      const id =
        m.session_id ?? (await this.attach(db, m.scene_id, m.actor_id));
      sessions.set(m.actor_id, (await this.get(id, m.actor_id, db))!);
    }
    const endings = new Set(
      [...sessions.values()].filter((s) => s.closed).map((s) => s.actor_id),
    );
    const split = new Set(parents.flatMap((p) => p.data.splitActors ?? []));
    const roots = new Map([...actorSet].map((a) => [a, a]));
    const root = (a: string): string =>
      roots.get(a) === a ? a : root(roots.get(a)!);
    const connect = (a: string, b: string) => {
      if (
        actorSet.has(a) &&
        actorSet.has(b) &&
        !endings.has(a) &&
        !endings.has(b) &&
        !split.has(a) &&
        !split.has(b)
      )
        roots.set(root(b), root(a));
    };
    for (const l of links) connect(l.speaker, l.listener);
    for (const parent of parents) {
      for (const i of Object.values(parent.data.pending))
        for (const a of i.replyWait?.actors ?? []) connect(i.actorId, a);
      const waves = (
        await db.query<{ source_id: string; actors: string[] }>(
          `SELECT w.source_id,array_agg(r.actor_id) AS actors FROM world_scene_wave w JOIN world_scene_reply r ON r.wave_id=w.id
        WHERE w.scene_id=$1 AND w.state IN ('pending','queued') AND w.source_kind<>'idle' GROUP BY w.id`,
          [parent.id],
        )
      ).rows;
      for (const wave of waves) {
        const action =
          parent.data.actions.find((a) => a.id === wave.source_id) ??
          parent.data.carriedInputs?.[wave.source_id];
        const previous = action
          ? [action.actorId ?? parent.actor_id]
          : (
              await db.query<{ actor_id: string }>(
                "SELECT actor_id FROM world_scene_reply WHERE wave_id=$1 AND state='answered'",
                [wave.source_id],
              )
            ).rows.map((r) => r.actor_id);
        for (const a of previous) for (const b of wave.actors) connect(a, b);
      }
      if (!links.length && parent.data.finishActors?.length) {
        const remaining = members.filter(
          (m) =>
            m.scene_id === parent.id &&
            !endings.has(m.actor_id) &&
            !split.has(m.actor_id),
        );
        for (const m of remaining.slice(1))
          connect(remaining[0]!.actor_id, m.actor_id);
      }
    }
    const groups = new Map<string, string[]>();
    for (const actor of actorSet) {
      const key = root(actor);
      groups.set(key, [...(groups.get(key) ?? []), actor]);
    }
    if (!links.length && !split.size && endings.size === sessions.size) {
      await shared.turns.close(db, row.id, "requested");
      return false;
    }
    const moved = await this.repartition(
      db,
      shared,
      parents,
      [...groups.values()],
      sessions,
      endings,
    );
    for (const link of links) {
      const target = moved.get(link.listener)!;
      await db.query(
        "UPDATE world_player_contact SET state='joined',target_scene=$2,queued_text=NULL WHERE id=$1",
        [link.id, target],
      );
      if (sessions.get(link.listener)?.closed && !link.queued_text) continue;
      const receiver = (
        await db.query<SceneRow>("SELECT * FROM world_scene WHERE id=$1", [
          target,
        ])
      ).rows[0]!;
      const senderKind =
        members.find((m) => m.actor_id === link.speaker)?.kind ??
        (
          await db.query<Member>(
            "SELECT kind FROM world_scene_member WHERE scene_id=$1 AND actor_id=$2",
            [link.source_scene, link.speaker],
          )
        ).rows[0]?.kind ??
        "bot";
      await shared.turns.cancelIdleOffer(db, target);
      if (link.queued_text && link.reply_id) {
        await shared.turns.receiveReply(
          db,
          receiver,
          link.listener,
          link.reply_kind ?? "bot",
          link.reply_id,
          link.queued_text,
          link.input_id,
          senderKind,
        );
      } else if (!receiver.data.pending[link.listener]?.inputId)
        await shared.turns.publish(
          db,
          receiver,
          { id: link.input_id, sourceKind: senderKind, reply: false },
          [link.listener],
        );
    }
    return true;
  }

  async repartition(
    db: pg.PoolClient,
    shared: SharedScenes,
    parents: SceneRow[],
    groups: string[][],
    sessions: Map<string, Session>,
    endings: Set<string>,
  ) {
    const ids = parents.map((p) => p.id);
    const members = (
      await db.query<Member>(
        "SELECT * FROM world_scene_member WHERE scene_id=ANY($1::uuid[]) AND state IN ('joined','left')",
        [ids],
      )
    ).rows;
    const memberByActor = new Map(
      members
        .filter((m) => sessions.has(m.actor_id))
        .map((m) => [m.actor_id, m]),
    );
    const allInputs = new Map(
      parents
        .flatMap((p) => [
          ...Object.values(p.data.carriedInputs ?? {}),
          ...p.data.actions,
        ])
        .map((a) => [a.id, a]),
    );
    const owner = (p: SceneRow, actor: string, input?: string) =>
      memberByActor.has(actor)
        ? actor
        : (allInputs.get(input ?? "")?.actorId ?? p.actor_id);
    const moved = new Map<string, string>();
    const controls = (
      await db.query<{
        scene_id: string;
        rounds: number;
        continuation: Awaited<
          ReturnType<SharedScenes["turns"]["control"]>
        >["continuation"];
      }>(
        "SELECT scene_id,rounds,continuation FROM world_shared_scene WHERE scene_id=ANY($1::uuid[])",
        [ids],
      )
    ).rows;
    const receptions = (
      await db.query<Link>(
        "SELECT * FROM world_player_contact WHERE target_scene=ANY($1::uuid[]) AND listener=ANY($2::uuid[]) ORDER BY deadline,id",
        [ids, [...sessions.keys()]],
      )
    ).rows;
    const sources = (
      await db.query<{ id: string; events: RecordedSceneEvent[] }>(
        "SELECT id,data->'events' AS events FROM world_scene WHERE id=ANY($1::uuid[])",
        [[...new Set(receptions.map((c) => c.source_scene))]],
      )
    ).rows;
    const sourceEvents = new Map(
      sources.flatMap((s) => s.events).map((e) => [e.id, e]),
    );
    for (const session of sessions.values()) {
      const received = receptions.filter(
        (c) => c.listener === session.actor_id,
      );
      const existing = new Set(
        (
          await db.query<{ id: string }>(
            "SELECT id FROM world_scene_record WHERE session_id=$1 AND actor_id=$2 AND kind='events' AND id=ANY($3::uuid[])",
            [session.id, session.actor_id, received.map((c) => c.event_id)],
          )
        ).rows.map((r) => r.id),
      );
      for (const c of received) {
        const event = sourceEvents.get(c.event_id);
        if (!event || existing.has(event.id)) continue;
        const payload = {
          ...event,
          receipts: [
            { observerId: session.actor_id, text: c.text, at: Number(c.at) },
          ],
        };
        await db.query(
          "INSERT INTO world_scene_record(session_id,actor_id,kind,id,scene_id,position,payload) VALUES($1,$2,'events',$3,$4,$5,$6) ON CONFLICT DO NOTHING",
          [
            session.id,
            session.actor_id,
            event.id,
            c.source_scene,
            session.event_count++,
            JSON.stringify(payload),
          ],
        );
        existing.add(event.id);
      }
    }
    for (const parent of parents)
      await db.query(
        "UPDATE world_scene_member SET state='ended' WHERE scene_id=$1",
        [parent.id],
      );
    for (const actors of groups) {
      const id = randomUUID();
      const lead =
        parents.find((p) => actors.includes(p.actor_id))?.actor_id ??
        actors[0]!;
      const base = parents.find((p) => p.actor_id === lead) ?? parents[0]!;
      const ended = actors.every((a) => endings.has(a));
      const selected = new Set(actors);
      const pending: SceneRow["data"]["pending"] = {},
        intentions: SceneRow["data"]["intentions"] = {};
      const decisions: string[] = [];
      for (const p of parents) {
        for (const [actor, intent] of Object.entries(p.data.pending))
          if (selected.has(owner(p, actor, intent.inputId))) {
            pending[actor] = { ...intent, continuing: true };
            intentions[actor] = { ...(p.data.intentions[actor] ?? intent) };
          }
        decisions.push(
          ...p.data.nextDecisions.filter((actor) =>
            selected.has(owner(p, actor)),
          ),
        );
      }
      const carried = [...allInputs.values()].filter((a) =>
        selected.has(a.actorId ?? base.actor_id),
      );
      const views: SceneRow["data"]["views"] = {};
      const sources: NonNullable<SceneRow["data"]["sources"]> = {};
      for (const p of parents) {
        Object.assign(views, p.data.views);
        Object.assign(sources, p.data.sources);
      }
      const background: SceneBackground = {
        type: "background",
        synopsis: "直前の出来事から続く場面。",
        participants: [
          ...new Set([
            ...actors,
            ...parents
              .flatMap((p) => p.data.background!.participants)
              .filter((a) => !memberByActor.has(a)),
          ]),
        ],
        facts: [],
        beliefs: [],
        creations: [
          ...new Map(
            parents
              .flatMap((p) => p.data.background!.creations)
              .map((n) => [n.id, n]),
          ).values(),
        ],
        perceptions: [],
        unknowns: parents.flatMap((p) => p.data.background!.unknowns),
      };
      const character = (
        await db.query<{ value: NonNullable<SceneRow["data"]["character"]> }>(
          "SELECT jsonb_build_object('presetId',j.preset_id,'version',j.preset_version,'settings',o.request->>'actionText','registrationAt',j.at) AS value FROM world_join j JOIN world_operation o ON o.id=j.operation_id WHERE j.construction_id=$1 AND j.actor_id=$2 ORDER BY j.id LIMIT 1",
          [base.construction_id, lead],
        )
      ).rows[0]?.value;
      const data: SceneRow["data"] = {
        playVersion: 4,
        shared: true,
        turns: true,
        recordingVersion: "inspection-record-v2",
        commandId: id,
        requestId: id,
        reflectionResponseId: sceneId(`${id}:reflection`),
        worldId: base.data.worldId,
        at: Math.max(...parents.map((p) => p.data.at)),
        startedAt: Math.max(...parents.map((p) => p.data.at)),
        purpose: base.data.purpose,
        roots: [...new Set(parents.flatMap((p) => p.data.roots))],
        originalAgenda: base.data.originalAgenda,
        basis: [],
        views,
        background,
        sources,
        events: [],
        actions: [],
        pending,
        intentions,
        choices: [],
        previous: {},
        nextDecisions: [...new Set(decisions)],
        externalActors: actors,
        sessionIds: Object.assign(
          {},
          ...parents.map((p) => p.data.sessionIds ?? {}),
          Object.fromEntries([...sessions].map(([a, s]) => [a, s.id])),
        ),
        carriedInputs: Object.fromEntries(carried.map((a) => [a.id, a])),
        ...(carried.at(-1) ? { lastInputId: carried.at(-1)!.id } : {}),
        ...(character ? { character } : {}),
        ...(ended ? { ending: "requested" as const } : {}),
      };
      const user = (
        await db.query<{ user_id: string }>(
          "SELECT s.user_id FROM world_access a JOIN world_subject s ON s.id=a.subject_id WHERE a.construction_id=$1 AND a.actor_id=$2 AND a.role='player' LIMIT 1",
          [base.construction_id, lead],
        )
      ).rows[0]?.user_id;
      const child: SceneRow = {
        id,
        construction_id: base.construction_id,
        actor_id: lead,
        state: ended ? "reflecting" : "active",
        claim: null,
        data,
        ...(user ? { user_id: user } : {}),
      };
      await db.query(
        "INSERT INTO world_scene(id,construction_id,actor_id,state,data,user_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          child.construction_id,
          lead,
          child.state,
          JSON.stringify(data),
          user ?? null,
        ],
      );
      for (const p of parents)
        await this.inherit(db, child, {
          ...p,
          data: { ...p.data, handoff: true },
        });
      await db.query("UPDATE world_scene SET data=$2 WHERE id=$1", [
        id,
        JSON.stringify(child.data),
      ]);
      await db.query(
        "INSERT INTO world_shared_scene(scene_id,world_id,owner_id,at,phase,flow,rounds,end_reason) VALUES($1,$2,$3,$4,'settled',$5,$6,$7)",
        [
          id,
          child.construction_id,
          lead,
          data.at,
          ended ? "closing" : "open",
          Math.max(
            0,
            ...controls
              .filter((c) => parents.some((p) => p.id === c.scene_id))
              .map((c) => c.rounds),
          ),
          ended ? "requested" : null,
        ],
      );
      for (const actor of actors) {
        const m = memberByActor.get(actor)!;
        const s = sessions.get(actor)!;
        await db.query(
          "INSERT INTO world_scene_member(scene_id,world_id,actor_id,request_id,last_request_id,state,kind,session_id) VALUES($1,$2,$3,$4,$5,'joined',$6,$7)",
          [
            id,
            child.construction_id,
            actor,
            m.request_id,
            m.last_request_id,
            m.kind,
            s.id,
          ],
        );
        await db.query(
          "UPDATE world_actor_scene SET scene_id=$3 WHERE world_id=$1 AND actor_id=$2",
          [child.construction_id, actor, id],
        );
        await db.query(
          "UPDATE world_scene_session SET current_id=$3,event_offset=$4,event_count=$4,action_offset=action_count WHERE id=$1 AND actor_id=$2",
          [s.id, actor, id, s.event_count],
        );
        moved.set(actor, id);
      }
      const continuations = controls
        .flatMap((c) =>
          !c.continuation
            ? []
            : Array.isArray(c.continuation)
              ? c.continuation
              : [c.continuation],
        )
        .map((c) => ({
          ...c,
          targets: c.targets.filter((a) => selected.has(a)),
        }))
        .filter((c) => c.targets.length);
      if (!ended && continuations.length)
        await db.query(
          "UPDATE world_shared_scene SET continuation=$2 WHERE scene_id=$1",
          [id, JSON.stringify(continuations)],
        );
      await shared.wake(db, id);
    }
    const tasks = (
      await db.query<{
        id: string;
        scene_id: string;
        actor_id: string;
        command: string;
      }>(
        "SELECT id,scene_id,actor_id,command FROM world_scene_turn WHERE scene_id=ANY($1::uuid[]) AND state IN ('queued','held')",
        [ids],
      )
    ).rows;
    for (const task of tasks.filter((t) => t.command !== "reply")) {
      const p = parents.find((p) => p.id === task.scene_id)!;
      const target = moved.get(owner(p, task.actor_id))!;
      await db.query("UPDATE world_scene_turn SET scene_id=$2 WHERE id=$1", [
        task.id,
        target,
      ]);
    }
    const waves = (
      await db.query<{
        id: string;
        scene_id: string;
        source_id: string;
        source_kind: string;
        deadline: Date;
        state: string;
      }>(
        "SELECT * FROM world_scene_wave WHERE scene_id=ANY($1::uuid[]) AND state IN ('pending','queued')",
        [ids],
      )
    ).rows;
    for (const wave of waves) {
      const replies = (
        await db.query<{ id: string; actor_id: string; state: string }>(
          "SELECT id,actor_id,state FROM world_scene_reply WHERE wave_id=$1",
          [wave.id],
        )
      ).rows;
      for (const target of new Set(
        replies
          .map((r) => moved.get(r.actor_id))
          .filter((id): id is string => !!id),
      )) {
        const own = replies.filter((r) => moved.get(r.actor_id) === target);
        const id = sceneId(`${wave.id}:${target}`);
        const ended = own.every((r) => endings.has(r.actor_id));
        await db.query(
          "INSERT INTO world_scene_wave(id,scene_id,source_id,source_kind,deadline,state) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            target,
            wave.source_id,
            wave.source_kind,
            wave.deadline,
            ended ? "queued" : wave.state,
          ],
        );
        await db.query(
          "UPDATE world_scene_reply SET wave_id=$2,state=CASE WHEN $3 AND state='pending' THEN 'closed' ELSE state END WHERE id=ANY($1::uuid[])",
          [own.map((r) => r.id), id, ended],
        );
        if (ended || wave.state === "queued")
          await db.query(
            "INSERT INTO world_scene_turn(id,scene_id,actor_id,kind,command,data) VALUES($1,$2,$3,'bot','reply',$4)",
            [id, target, own[0]!.actor_id, JSON.stringify({ waveId: id })],
          );
        else
          await shared.schedule(
            db,
            `wave:${id}`,
            { waveId: id },
            wave.deadline,
          );
      }
      await db.query(
        "UPDATE world_scene_wave SET state='resolved' WHERE id=$1",
        [wave.id],
      );
      await db.query(
        "UPDATE world_scene_turn SET state='resolved' WHERE id=$1",
        [wave.id],
      );
    }
    const votes = (
      await db.query<{ id: string; scene_id: string; deadline: Date }>(
        "SELECT * FROM world_scene_end_vote WHERE scene_id=ANY($1::uuid[]) AND state='pending'",
        [ids],
      )
    ).rows;
    for (const vote of votes) {
      const answers = (
        await db.query<{
          actor_id: string;
          answer: boolean | null;
          proposal_id: string | null;
        }>("SELECT * FROM world_scene_end_answer WHERE vote_id=$1", [vote.id])
      ).rows;
      for (const target of new Set(
        answers
          .filter((a) => !endings.has(a.actor_id))
          .map((a) => moved.get(a.actor_id))
          .filter((id): id is string => !!id),
      )) {
        const id = sceneId(`${vote.id}:${target}`);
        await db.query(
          "INSERT INTO world_scene_end_vote(id,scene_id,deadline) VALUES($1,$2,$3)",
          [id, target, vote.deadline],
        );
        for (const a of answers.filter(
          (a) => moved.get(a.actor_id) === target && !endings.has(a.actor_id),
        ))
          await db.query(
            "INSERT INTO world_scene_end_answer(vote_id,actor_id,answer,proposal_id) VALUES($1,$2,$3,$4)",
            [id, a.actor_id, a.answer, a.proposal_id ?? vote.id],
          );
        await db.query(
          "UPDATE world_shared_scene SET flow='voting' WHERE scene_id=$1",
          [target],
        );
        await shared.schedule(
          db,
          `vote:${id}`,
          { proposalId: id },
          vote.deadline,
        );
      }
      await db.query(
        "UPDATE world_scene_end_vote SET state='closed' WHERE id=$1",
        [vote.id],
      );
    }
    for (const target of new Set(moved.values())) {
      const child = (
        await db.query<SceneRow>("SELECT * FROM world_scene WHERE id=$1", [
          target,
        ])
      ).rows[0]!;
      for (const vote of (await db.query<{id:string}>("SELECT id FROM world_scene_end_vote WHERE scene_id=$1 AND state='pending'",[target])).rows)
        await shared.turns.settleVote(db,target,vote.id);
      await shared.turns.resumeOffers(db, child);
    }
    for (const parent of parents) {
      const data = {
        ...parent.data,
        handoff: true as const,
        pending: {},
        nextDecisions: [],
        intentions: Object.fromEntries(
          Object.entries(parent.data.intentions).filter(
            ([a]) => !parent.data.pending[a],
          ),
        ),
      };
      delete data.turn;
      delete data.work;
      delete data.splitActors;
      delete data.finishActors;
      await db.query(
        "UPDATE world_scene SET state='reflecting',claim=NULL,data=$2 WHERE id=$1",
        [parent.id, JSON.stringify(data)],
      );
      await db.query(
        "UPDATE world_shared_scene SET phase='merged',flow='closing',continuation=NULL WHERE scene_id=$1",
        [parent.id],
      );
      await shared.wake(db, parent.id);
    }
    await db.query(
      `UPDATE world_scene s SET state='acting' WHERE s.id=ANY($1::uuid[]) AND s.state='reflecting'
      AND EXISTS(SELECT 1 FROM world_scene_turn t WHERE t.scene_id=s.id AND t.state='queued')`,
      [[...new Set(moved.values())]],
    );
    return moved;
  }
}
