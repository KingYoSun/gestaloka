import { randomUUID } from "node:crypto";
import type pg from "pg";
import { ConstructionStateError } from "./construction.js";
import type { SharedScenes } from "./shared-scenes.js";
import type { SceneRow } from "./scene.js";
import type { SceneEnding } from "./scene-data.js";

type Db = Pick<pg.Pool, "query">;
export type SharedTurn = {
  id: string;
  sourceId: string;
  sourceKind: "human" | "bot";
  eventStart: number;
  reply: boolean;
  inputs: {
    id: string;
    actorId: string;
    text: string;
    leave?: true;
    seen: string[];
  }[];
};
type Flow = "open" | "manual" | "voting" | "rounds" | "inactive" | "closing";
type Control = {
  scene_id: string;
  flow: Flow;
  rounds: number;
  inactive_until: Date | null;
  resume_flow: Flow | null;
  continuation: { turn: SharedTurn; targets: string[] } | null;
  end_reason: SceneEnding | null;
};
type Task = {
  id: string;
  actor_id: string;
  kind: "human" | "bot";
  command: "act" | "leave" | "reply";
  data: { actionText?: string; waveId?: string };
};
type Wave = {
  id: string;
  scene_id: string;
  source_id: string;
  source_kind: "human" | "bot";
  deadline: Date;
  state: string;
};
const fail = (message: string) => new ConstructionStateError(message);

/** Durable external decisions. No model calls, narrative generation, or world writes. */
export class SharedTurns {
  readonly replyMs = Number(process.env.SCENE_REACTION_SECONDS ?? 60) * 1000;
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
      CREATE UNIQUE INDEX IF NOT EXISTS world_scene_end_vote_pending ON world_scene_end_vote(scene_id) WHERE state='pending';
      CREATE TABLE IF NOT EXISTS world_scene_end_answer (
      vote_id uuid NOT NULL REFERENCES world_scene_end_vote(id) ON DELETE CASCADE,actor_id uuid NOT NULL,answer boolean,
      PRIMARY KEY(vote_id,actor_id));`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_scene_absence (
      scene_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,actor_id uuid NOT NULL,
      from_event integer NOT NULL,through_event integer,PRIMARY KEY(scene_id,actor_id,from_event));
      CREATE UNIQUE INDEX IF NOT EXISTS world_scene_absence_open ON world_scene_absence(scene_id,actor_id) WHERE through_event IS NULL;`);
  }
  async control(scene: string, db: Db = this.pool, lock = false) {
    return (
      await db.query<Control>(
        `SELECT scene_id,flow,rounds,continuation,end_reason,inactive_until,resume_flow FROM world_shared_scene WHERE scene_id=$1 ${lock ? "FOR UPDATE" : ""}`,
        [scene],
      )
    ).rows[0]!;
  }
  async #queue(
    db: pg.PoolClient,
    scene: string,
    id: string,
    actor: string,
    kind: "human" | "bot",
    command: Task["command"],
    data: Task["data"],
  ) {
    await db.query(
      "INSERT INTO world_scene_turn(id,scene_id,actor_id,kind,command,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [id, scene, actor, kind, command, data],
    );
  }
  async #flush(db: pg.PoolClient, wave: Wave, forced = false) {
    if (wave.state !== "pending") return;
    const pending = await db.query(
      "SELECT id FROM world_scene_reply WHERE wave_id=$1 AND state='pending'",
      [wave.id],
    );
    if (!forced && pending.rowCount && wave.deadline > this.shared.now())
      return;
    await db.query("UPDATE world_scene_wave SET state='queued' WHERE id=$1", [
      wave.id,
    ]);
    const actor = (
      await db.query<{ actor_id: string }>(
        "SELECT actor_id FROM world_scene_reply WHERE wave_id=$1 ORDER BY (state='answered') DESC,actor_id LIMIT 1",
        [wave.id],
      )
    ).rows[0]!.actor_id;
    await this.#queue(db, wave.scene_id, wave.id, actor, "bot", "reply", {
      waveId: wave.id,
    });
  }
  async #close(
    db: pg.PoolClient,
    scene: string,
    reason: SceneEnding = "requested",
  ) {
    await db.query(
      "UPDATE world_shared_scene SET flow='closing',continuation=NULL,inactive_until=NULL,resume_flow=NULL,end_reason=coalesce(end_reason,$2) WHERE scene_id=$1",
      [scene, reason],
    );
    await db.query(
      "UPDATE world_scene_end_vote SET state='closed' WHERE scene_id=$1 AND state='pending'",
      [scene],
    );
    for (const w of (
      await db.query<Wave>(
        "SELECT * FROM world_scene_wave WHERE scene_id=$1 AND state='pending' ORDER BY deadline,id",
        [scene],
      )
    ).rows)
      await this.#flush(db, w, true);
  }
  async submit(
    db: pg.PoolClient,
    row: SceneRow,
    actor: string,
    kind: "human" | "bot",
    input: {
      requestId: string;
      command: string;
      actionText?: string | null;
      opportunityId?: string;
      proposalId?: string;
      continue?: boolean;
    },
  ) {
    const control = await this.control(row.id, db, true);
    if (
      control.flow === "closing" ||
      ["result", "reflecting"].includes(row.state)
    )
      throw fail("シーンは終了処理中です");
    if (input.command === "react") {
      const reply = (
        await db.query<{
          id: string;
          wave_id: string;
          reply_state: string;
          deadline: Date;
          state: string;
        }>(
          `SELECT r.id,r.wave_id,r.state AS reply_state,w.deadline,w.state FROM world_scene_reply r JOIN world_scene_wave w ON w.id=r.wave_id
        WHERE r.id=$1 AND r.actor_id=$2 AND w.scene_id=$3`,
          [input.opportunityId, actor, row.id],
        )
      ).rows[0];
      if (
        !reply ||
        reply.reply_state !== "pending" ||
        reply.state !== "pending" ||
        reply.deadline <= this.shared.now()
      )
        throw fail("この反応機会は締め切られています");
      await db.query(
        "UPDATE world_scene_reply SET state='answered',text=$2,request_id=$3 WHERE id=$1",
        [reply.id, input.actionText ?? null, input.requestId],
      );
      await this.#flush(
        db,
        (
          await db.query<Wave>("SELECT * FROM world_scene_wave WHERE id=$1", [
            reply.wave_id,
          ])
        ).rows[0]!,
      );
    } else if (input.command === "vote") {
      await this.answer(db, row.id, actor, input.proposalId!, input.continue!);
      await this.#vote(db, row.id, input.proposalId!);
    } else if (input.command === "finish") {
      if (actor !== row.actor_id) throw fail("開始者が終了してください");
      await this.#close(db, row.id);
    } else if (input.command === "resume") {
      if (
        actor !== row.actor_id ||
        !["rounds", "inactive"].includes(control.flow)
      )
        throw fail("開始者が休止中のシーンを再開してください");
      await db.query(
        "UPDATE world_shared_scene SET flow='open',rounds=0,inactive_until=NULL,resume_flow=NULL WHERE scene_id=$1",
        [row.id],
      );
      await this.#continue(db, row);
    } else {
      if (
        !["active", "acting"].includes(row.state) ||
        (input.command !== "leave" &&
          control.flow !== "open" &&
          !(kind === "human" && ["manual", "voting"].includes(control.flow)))
      )
        throw fail("シーンが操作可能になるまで待ってください");
      if (
        !(await this.shared.members(row.id, db)).some(
          (m) => m.actor_id === actor && m.state === "joined",
        )
      )
        throw fail("参加中の本人を指定してください");
      await this.#queue(
        db,
        row.id,
        input.requestId,
        actor,
        kind,
        input.command === "leave" ? "leave" : "act",
        {
          actionText:
            input.command === "leave"
              ? "この場から退出する"
              : input.actionText!,
        },
      );
      if (kind === "human" && input.command !== "leave") {
        await db.query(
          "UPDATE world_scene_end_vote SET state='closed' WHERE scene_id=$1 AND state='pending'",
          [row.id],
        );
        await db.query(
          "UPDATE world_shared_scene SET rounds=0,flow='open',continuation=NULL WHERE scene_id=$1",
          [row.id],
        );
      }
    }
    await db.query(
      "UPDATE world_scene_member SET last_request_id=$3 WHERE scene_id=$1 AND actor_id=$2",
      [row.id, actor, input.requestId],
    );
    await db.query(
      "UPDATE world_scene SET state='acting',claim=NULL WHERE id=$1 AND state IN ('active','paused')",
      [row.id],
    );
    await this.shared.wake(db, row.id);
  }
  async next(db: pg.PoolClient, row: SceneRow): Promise<SharedTurn | null> {
    const control = await this.control(row.id, db, true);
    const task = (
      await db.query<Task>(
        "SELECT * FROM world_scene_turn WHERE scene_id=$1 AND state='queued' AND ($2 OR command='leave') ORDER BY sequence LIMIT 1 FOR UPDATE",
        [row.id, control.flow === "closing" || control.flow === "open"],
      )
    ).rows[0];
    if (!task) return null;
    if (task.kind === "human" && task.command !== "reply")
      await db.query(
        "UPDATE world_shared_scene SET rounds=0 WHERE scene_id=$1",
        [row.id],
      );
    const inputs: SharedTurn["inputs"] =
      task.command === "reply"
        ? (
            await db.query<{
              request_id: string;
              actor_id: string;
              text: string;
              seen: string[];
            }>(
              "SELECT * FROM world_scene_reply WHERE wave_id=$1 AND state='answered' AND text IS NOT NULL ORDER BY actor_id",
              [task.data.waveId],
            )
          ).rows.map((r) => ({
            id: r.request_id,
            actorId: r.actor_id,
            text: r.text,
            seen: r.seen,
          }))
        : [
            {
              id: task.id,
              actorId: task.actor_id,
              text: task.data.actionText!,
              seen: row.data.events
                .filter((e) =>
                  e.receipts.some((p) => p.observerId === task.actor_id),
                )
                .map((e) => e.id),
              ...(task.command === "leave" ? { leave: true as const } : {}),
            },
          ];
    const wave =
      task.command === "reply"
        ? (
            await db.query<Wave>("SELECT * FROM world_scene_wave WHERE id=$1", [
              task.data.waveId,
            ])
          ).rows[0]!
        : null;
    await db.query("UPDATE world_scene_turn SET state='running' WHERE id=$1", [
      task.id,
    ]);
    return {
      id: task.id,
      sourceId: wave?.source_id ?? task.id,
      sourceKind: wave?.source_kind ?? task.kind,
      eventStart: row.data.events.length,
      reply: !!wave,
      inputs,
    };
  }
  async publish(
    db: pg.PoolClient,
    row: SceneRow,
    turn: SharedTurn,
    targets: string[],
  ) {
    const control = await this.control(row.id, db, true);
    if (control.flow !== "open") return;
    const members = (await this.shared.members(row.id, db))
        .filter((m) => m.state === "joined" && m.kind === "bot")
        .map((m) => m.actor_id),
      actors = targets.filter((a) => members.includes(a));
    if (!actors.length) return;
    const id = randomUUID(),
      deadline = new Date(this.shared.now().getTime() + this.replyMs);
    await db.query(
      "INSERT INTO world_scene_wave(id,scene_id,source_id,source_kind,deadline) VALUES($1,$2,$3,$4,$5)",
      [id, row.id, turn.id, turn.reply ? "bot" : turn.sourceKind, deadline],
    );
    for (const actor of [...new Set(actors)]) {
      const events = row.data.events.filter((e) =>
          e.receipts.some((p) => p.observerId === actor),
        ),
        context = [
          ...row.data
            .background!.perceptions.filter((p) => p.observerId === actor)
            .map((p) => p.text),
          ...events.flatMap((e) =>
            e.receipts.filter((p) => p.observerId === actor).map((p) => p.text),
          ),
        ],
        opportunityId = randomUUID();
      await db.query(
        "INSERT INTO world_scene_reply(id,wave_id,actor_id,seen,context) VALUES($1,$2,$3,$4,$5)",
        [
          opportunityId,
          id,
          actor,
          JSON.stringify(events.map((e) => e.id)),
          JSON.stringify(context),
        ],
      );
      await this.shared.notice(
        db,
        row.construction_id,
        actor,
        row.id,
        "opportunity",
        {
          opportunityId,
          sourceInputId: turn.id,
          deadline: deadline.toISOString(),
        },
      );
    }
    await this.shared.schedule(db, `wave:${id}`, { waveId: id }, deadline);
  }
  async complete(
    db: pg.PoolClient,
    row: SceneRow,
    turn: SharedTurn,
    targets: string[],
    finished = false,
  ) {
    await db.query("UPDATE world_scene_turn SET state='resolved' WHERE id=$1", [
      turn.id,
    ]);
    if (turn.reply)
      await db.query(
        "UPDATE world_scene_wave SET state='resolved' WHERE id=$1",
        [turn.id],
      );
    if (
      turn.reply &&
      turn.sourceKind === "bot" &&
      row.data.events
        .slice(turn.eventStart)
        .some((e) => turn.inputs.some((i) => i.actorId === e.actorId))
    )
      await db.query(
        "UPDATE world_shared_scene SET rounds=rounds+1 WHERE scene_id=$1",
        [row.id],
      );
    if (
      !(await this.shared.members(row.id, db)).some((m) => m.state === "joined")
    )
      await this.#close(db, row.id, "departed");
    else if (finished) await this.#close(db, row.id, "concluded");
    let control = await this.control(row.id, db, true);
    const priorFlow = control.flow;
    if (control.flow === "open") {
      const actors = (await this.shared.members(row.id, db))
          .filter((m) => m.state === "joined")
          .map((m) => m.actor_id),
        human =
          (await this.shared.active(row.construction_id, actors, "human", db))
            .length > 0;
      if (human && control.rounds >= this.humanRounds)
        await db.query(
          "UPDATE world_shared_scene SET flow='manual' WHERE scene_id=$1",
          [row.id],
        );
      else if (!human && control.rounds >= this.botRounds)
        await this.propose(
          db,
          row,
          (await this.shared.members(row.id, db))
            .filter((m) => m.state === "joined" && m.kind === "bot")
            .map((m) => m.actor_id),
        );
      if ((await this.control(row.id, db)).flow !== "open")
        await db.query(
          "UPDATE world_shared_scene SET continuation=$2 WHERE scene_id=$1",
          [row.id, JSON.stringify({ turn, targets })],
        );
      await this.publish(db, row, turn, targets);
      if (
        targets.length &&
        !(await this.shared.active(row.construction_id, actors, "human", db))
          .length &&
        !(await this.shared.active(row.construction_id, actors, "bot", db))
          .length
      )
        await this.inactivate(db, row.id);
    }
    control = await this.control(row.id, db);
    if (
      priorFlow !== control.flow &&
      ["manual", "rounds"].includes(control.flow)
    )
      for (const member of await this.shared.members(row.id, db))
        await this.shared.notice(
          db,
          row.construction_id,
          member.actor_id,
          row.id,
          "paused",
        );
    const queued = (
      await db.query(
        "SELECT id FROM world_scene_turn WHERE scene_id=$1 AND state='queued' LIMIT 1",
        [row.id],
      )
    ).rowCount;
    if (control.flow === "closing")
      return queued ? ("acting" as const) : ("reflecting" as const);
    return control.flow === "rounds" || control.flow === "inactive"
      ? ("paused" as const)
      : queued && control.flow === "open"
        ? ("acting" as const)
        : ("active" as const);
  }
  async propose(db: pg.PoolClient, row: SceneRow, actors: string[]) {
    const id = randomUUID(),
      deadline = new Date(this.shared.now().getTime() + this.replyMs);
    await db.query(
      "INSERT INTO world_scene_end_vote(id,scene_id,deadline) VALUES($1,$2,$3)",
      [id, row.id, deadline],
    );
    if (row.data.shared)
      await db.query(
        "UPDATE world_shared_scene SET flow='voting' WHERE scene_id=$1",
        [row.id],
      );
    for (const actor of actors) {
      await db.query(
        "INSERT INTO world_scene_end_answer(vote_id,actor_id) VALUES($1,$2)",
        [id, actor],
      );
      await this.shared.notice(
        db,
        row.construction_id,
        actor,
        row.id,
        "end_proposal",
        { proposalId: id, deadline: deadline.toISOString() },
      );
    }
    await this.shared.schedule(db, `vote:${id}`, { proposalId: id }, deadline);
    return id;
  }
  async answer(
    db: pg.PoolClient,
    scene: string,
    actor: string,
    proposal: string,
    keepGoing: boolean,
  ) {
    const vote = (
      await db.query<{ deadline: Date; state: string }>(
        "SELECT deadline,state FROM world_scene_end_vote WHERE id=$1 AND scene_id=$2",
        [proposal, scene],
      )
    ).rows[0];
    if (!vote || vote.state !== "pending" || vote.deadline <= this.shared.now())
      throw fail("この終了提案は締め切られています");
    if (
      !(
        await db.query(
          "UPDATE world_scene_end_answer SET answer=$3 WHERE vote_id=$1 AND actor_id=$2 AND answer IS NULL RETURNING actor_id",
          [proposal, actor, keepGoing],
        )
      ).rowCount
    )
      throw fail("この終了提案には回答できません");
  }
  async #vote(db: pg.PoolClient, scene: string, id: string, expired = false) {
    const answers = (
      await db.query<{ answer: boolean | null }>(
        "SELECT answer FROM world_scene_end_answer WHERE vote_id=$1",
        [id],
      )
    ).rows.map((r) => r.answer);
    if (
      !expired &&
      answers.includes(null) &&
      !(answers.includes(true) && answers.includes(false))
    )
      return;
    await db.query(
      "UPDATE world_scene_end_vote SET state='closed' WHERE id=$1",
      [id],
    );
    if (!expired && answers.length && answers.every((a) => a === true)) {
      await db.query(
        `UPDATE world_shared_scene SET rounds=0,
        resume_flow=CASE WHEN flow='inactive' THEN 'open' ELSE resume_flow END,
        flow=CASE WHEN flow='inactive' THEN flow ELSE 'open' END WHERE scene_id=$1`,
        [scene],
      );
      const row = (
        await db.query<SceneRow>("SELECT * FROM world_scene WHERE id=$1", [
          scene,
        ])
      ).rows[0]!;
      await this.#continue(db, row);
    } else
      await this.#close(
        db,
        scene,
        !expired && answers.length && answers.every((a) => a === false)
          ? "unanimous"
          : "dissolved",
      );
  }
  async #continue(db: pg.PoolClient, row: SceneRow) {
    const control = await this.control(row.id, db),
      continuation = control.continuation;
    if (control.flow !== "open") return;
    if (!continuation) return;
    await db.query(
      "UPDATE world_shared_scene SET continuation=NULL WHERE scene_id=$1",
      [row.id],
    );
    await this.publish(db, row, continuation.turn, continuation.targets);
  }

  async departed(db: pg.PoolClient, row: SceneRow, actors: string[]) {
    await db.query(
      "UPDATE world_scene_reply r SET state='closed' FROM world_scene_wave w WHERE r.wave_id=w.id AND w.scene_id=$1 AND r.actor_id=ANY($2::uuid[]) AND r.state='pending'",
      [row.id, actors],
    );
    for (const w of (
      await db.query<Wave>(
        "SELECT * FROM world_scene_wave WHERE scene_id=$1 AND state='pending'",
        [row.id],
      )
    ).rows)
      await this.#flush(db, w);
    await db.query(
      "DELETE FROM world_scene_end_answer a USING world_scene_end_vote v WHERE a.vote_id=v.id AND v.scene_id=$1 AND v.state='pending' AND a.actor_id=ANY($2::uuid[])",
      [row.id, actors],
    );
    for (const v of (
      await db.query<{ id: string }>(
        "SELECT id FROM world_scene_end_vote WHERE scene_id=$1 AND state='pending'",
        [row.id],
      )
    ).rows)
      await this.#vote(db, row.id, v.id);
  }

  async inactivate(db: pg.PoolClient, scene: string) {
    const control = await this.control(scene, db, true);
    if (["closing", "rounds"].includes(control.flow) || control.inactive_until)
      return;
    const deadline = new Date(this.shared.now().getTime() + 10 * 60 * 1000);
    await db.query(
      "UPDATE world_shared_scene SET flow='inactive',inactive_until=$2,resume_flow=$3 WHERE scene_id=$1",
      [scene, deadline, control.flow === "inactive" ? "open" : control.flow],
    );
    await this.shared.schedule(
      db,
      `inactive:${scene}`,
      { inactiveSceneId: scene },
      deadline,
    );
  }
  async unavailable(db: pg.PoolClient, world: string, actor: string) {
    await this.shared.lock(db, world);
    if (
      (await this.shared.active(world, [actor], "human", db)).length ||
      (await this.shared.active(world, [actor], "bot", db)).length
    )
      return;
    const rows = (
      await db.query<SceneRow>(
        "SELECT s.* FROM world_scene s JOIN world_scene_member m ON m.scene_id=s.id WHERE m.world_id=$1 AND m.actor_id=$2 AND m.state='joined' AND s.data ? 'turns' AND s.state IN ('active','acting')",
        [world, actor],
      )
    ).rows;
    for (const row of rows) {
      await db.query(
        "INSERT INTO world_scene_absence(scene_id,actor_id,from_event) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [row.id, actor, row.data.events.length],
      );
      const members = (await this.shared.members(row.id, db))
        .filter((m) => m.state === "joined")
        .map((m) => m.actor_id);
      if (
        (await this.shared.active(world, members, "human", db)).length ||
        (await this.shared.active(world, members, "bot", db)).length
      )
        continue;
      const control = await this.control(row.id, db, true);
      if (["closing", "rounds"].includes(control.flow)) continue;
      await this.inactivate(db, row.id);
      await db.query(
        `UPDATE world_scene SET state='paused',claim=NULL,data=jsonb_set(data,'{resumeState}','"active"'::jsonb) WHERE id=$1 AND state='active'`,
        [row.id],
      );
      for (const member of members)
        await this.shared.notice(db, world, member, row.id, "paused");
      await this.shared.wake(db, row.id);
    }
  }
  async available(db: pg.PoolClient, world: string, actor: string) {
    await this.shared.lock(db, world);
    await db.query(
      "UPDATE world_scene_absence a SET through_event=jsonb_array_length(s.data->'events') FROM world_scene s WHERE a.scene_id=s.id AND s.construction_id=$1 AND a.actor_id=$2 AND a.through_event IS NULL",
      [world, actor],
    );
    for (const row of (
      await db.query<SceneRow>(
        `SELECT s.* FROM world_scene s JOIN world_shared_scene h ON h.scene_id=s.id
      JOIN world_scene_member m ON m.scene_id=s.id WHERE m.world_id=$1 AND m.actor_id=$2 AND m.state='joined'
      AND h.flow='inactive' AND s.state IN ('active','acting','paused')`,
        [world, actor],
      )
    ).rows) {
      if (await this.#endInactive(db, row.id)) continue;
      await db.query(
        "UPDATE world_shared_scene SET flow=coalesce(resume_flow,'open'),inactive_until=NULL,resume_flow=NULL WHERE scene_id=$1",
        [row.id],
      );
      if (
        row.data.error ||
        (row.state === "paused" && row.data.resumeState !== "active")
      )
        continue;
      await db.query(
        "UPDATE world_scene SET state='acting',claim=NULL WHERE id=$1 AND state='paused'",
        [row.id],
      );
      await this.#continue(db, row);
      await this.shared.wake(db, row.id);
    }
  }
  async expireInactivity(scene: string) {
    const shared = await this.shared.get(scene);
    if (!shared) return;
    await this.shared.transaction(async (db) => {
      await this.shared.lock(db, shared.world_id);
      await this.#endInactive(db, scene);
    });
  }
  async #endInactive(db: pg.PoolClient, scene: string) {
    const control = await this.control(scene, db, true);
    if (
      control.flow !== "inactive" ||
      !control.inactive_until ||
      control.inactive_until > this.shared.now()
    )
      return false;
    await this.#close(db, scene, "dissolved");
    await db.query(
      "UPDATE world_scene SET state='acting',claim=NULL WHERE id=$1 AND state IN ('active','paused') AND data->>'error' IS NULL",
      [scene],
    );
    await this.shared.wake(db, scene);
    return true;
  }
  async expire(data: { waveId?: string; proposalId?: string }) {
    const table = data.waveId ? "world_scene_wave" : "world_scene_end_vote",
      id = data.waveId ?? data.proposalId;
    if (!id) return;
    const found = (
      await this.pool.query<{ scene_id: string; world_id: string }>(
        `SELECT t.scene_id,s.construction_id AS world_id FROM ${table} t JOIN world_scene s ON s.id=t.scene_id WHERE t.id=$1`,
        [id],
      )
    ).rows[0];
    if (!found) return;
    await this.shared.transaction(async (db) => {
      await this.shared.lock(db, found.world_id);
      await this.control(found.scene_id, db, true);
      const item = (
        await db.query<Wave>(`SELECT * FROM ${table} WHERE id=$1`, [id])
      ).rows[0]!;
      if (item.state !== "pending" || item.deadline > this.shared.now()) return;
      if (
        data.proposalId &&
        (
          await db.query(
            `UPDATE world_scene SET state='reflecting',claim=NULL,
         data=(data-'soloProposal'-'deferredSoloAction') || '{"ending":"dissolved"}'::jsonb
         WHERE id=$1 AND state='active' AND data->>'soloProposal'=$2`,
            [item.scene_id, id],
          )
        ).rowCount
      ) {
        await db.query(
          "UPDATE world_scene_end_vote SET state='closed' WHERE id=$1",
          [id],
        );
        await this.shared.wake(db, item.scene_id);
        return;
      }
      if (data.waveId) await this.#flush(db, item);
      else await this.#vote(db, item.scene_id, id, true);
      await db.query(
        `UPDATE world_scene SET state='acting',claim=NULL WHERE id=$1 AND (state='active' OR
        (state='paused' AND data->>'error' IS NULL AND EXISTS(SELECT 1 FROM world_shared_scene h WHERE h.scene_id=$1 AND h.flow='closing')))`,
        [item.scene_id],
      );
      await this.shared.wake(db, item.scene_id);
    });
  }
  async inbox(world: string, actor: string) {
    const opportunities = (
      await this.pool.query(
        `SELECT r.id,w.scene_id AS "sceneId",w.source_id AS "sourceInputId",w.deadline,r.seen AS "seenEventIds",r.context
      FROM world_scene_reply r JOIN world_scene_wave w ON w.id=r.wave_id JOIN world_shared_scene h ON h.scene_id=w.scene_id
      WHERE h.world_id=$1 AND r.actor_id=$2 AND r.state='pending' AND w.state='pending' AND w.deadline>$3 ORDER BY w.deadline,r.id`,
        [world, actor, this.shared.now()],
      )
    ).rows.map((r) => ({ ...r, deadline: r.deadline.toISOString() }));
    const proposals = (
      await this.pool.query(
        `SELECT v.id,v.scene_id AS "sceneId",v.deadline FROM world_scene_end_vote v JOIN world_scene_end_answer a ON a.vote_id=v.id
      JOIN world_scene s ON s.id=v.scene_id WHERE s.construction_id=$1 AND a.actor_id=$2 AND a.answer IS NULL AND v.state='pending' AND v.deadline>$3 ORDER BY v.deadline,v.id`,
        [world, actor, this.shared.now()],
      )
    ).rows.map((r) => ({ ...r, deadline: r.deadline.toISOString() }));
    return { opportunities, proposals };
  }
}
