import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { ConstructionDuration } from "@gestaloka/contracts";
import { WorldBuilder } from "./build.js";
import { WorldAgent, SupersededWorker, type WorldProposal } from "./agent.js";

type Work = {
  id: string;
  at: number;
  mode: "schedule" | "intent" | "resolve" | "participant" | "action" | "frame";
  actorId?: string;
  actionText?: string;
  planUntil?: number;
  observationId?: string;
  operationId?: string;
  members?: Work[];
  previousActions?: string[];
  triggers?: string[];
};
export type Construction = {
  id: string;
  state:
    | "generating"
    | "ready"
    | "running"
    | "paused"
    | "finished"
    | "joining"
    | "playing"
    | "play_paused";
  world_id: string | null;
  actor_id: string | null;
  root_ids: string[];
  at: number;
  target: number;
  agenda: Work[];
  current: Work | null;
  participant_id: string | null;
  claim: string | null;
  error: string | null;
  initial_prompt: string;
  created_at: Date;
};
const time = z.number().int().nonnegative().safe();
export class ConstructionStateError extends Error {}

export class WorldConstruction {
  constructor(
    readonly builder: WorldBuilder,
    readonly agent: WorldAgent,
    readonly queue: PgBoss,
    readonly queueName = "world-construction",
  ) {}
  get pool() {
    return this.agent.pool;
  }

  async setup() {
    await this.builder.setup();
    await this.agent.setup();
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_construction (
      id uuid PRIMARY KEY REFERENCES world_build(run_id), state text NOT NULL,
      world_id uuid, actor_id uuid, root_ids jsonb NOT NULL DEFAULT '[]',
      at bigint NOT NULL DEFAULT 0, target bigint NOT NULL DEFAULT 0,
      agenda jsonb NOT NULL DEFAULT '[]', current jsonb, participant_id uuid,
      claim uuid, error text);
      CREATE TABLE IF NOT EXISTS construction_log (
      id bigserial PRIMARY KEY, construction_id uuid NOT NULL REFERENCES world_construction(id),
      operation_id uuid UNIQUE NOT NULL REFERENCES world_operation(id),
      at bigint NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_run (
      id uuid PRIMARY KEY,construction_id uuid NOT NULL REFERENCES world_construction(id) ON DELETE CASCADE,
      actor_id uuid NOT NULL,action_text text NOT NULL,state text NOT NULL,
      started_at bigint NOT NULL,at bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS world_run_latest ON world_run(construction_id,actor_id,created_at DESC);`);
    for (const name of [this.queueName, `${this.queueName}-play`])
      await this.queue.createQueue(name, {
        retryLimit: 2,
        retryDelay: 5,
        expireInSeconds: 900,
        heartbeatSeconds: 30,
      });
  }

  async #transaction<T>(
    action: (client: pg.PoolClient) => Promise<T>,
    existing?: pg.PoolClient,
  ) {
    if (existing) return action(existing);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #enqueue(client: pg.PoolClient, id: string, play = false) {
    await this.queue.send(
      play ? `${this.queueName}-play` : this.queueName,
      { id },
      {
        db: { executeSql: (text, values) => client.query(text, values) },
      },
    );
  }

  async create(prompt: string, existing?: pg.PoolClient) {
    z.string().min(1).parse(prompt);
    return this.#transaction(async (client) => {
      const id = await this.builder.create(prompt, client);
      await client.query(
        "INSERT INTO world_construction(id,state) VALUES($1,'generating')",
        [id],
      );
      await this.#enqueue(client, id);
      return id;
    }, existing);
  }

  async get(
    id: string,
    client: Pick<pg.Pool, "query"> = this.pool,
    lock = false,
  ) {
    z.uuid().parse(id);
    const result = await client.query<Construction>(
      `SELECT c.*,b.initial_prompt,b.created_at FROM world_construction c JOIN world_build b ON b.run_id=c.id WHERE c.id=$1${lock ? " FOR UPDATE OF c" : ""}`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error("構築セッションが見つかりません");
    return { ...row, at: Number(row.at), target: Number(row.target) };
  }

  async command(
    id: string,
    command: "advance" | "resume" | "finish" | "join",
    duration?: number,
    existing?: pg.PoolClient,
  ) {
    return this.#transaction(async (client) => {
      const row = await this.get(id, client, true);
      if (command === "advance") {
        if (row.state !== "ready")
          throw new ConstructionStateError(
            "区切りに到達した構築セッションを指定してください",
          );
        ConstructionDuration.parse(duration);
        row.target = time.parse(row.at + duration!);
        row.state = "running";
        if (!row.agenda.length)
          row.agenda.push({ id: randomUUID(), at: row.at, mode: "schedule" });
      } else if (command === "resume") {
        if (row.state !== "paused" && row.state !== "play_paused")
          throw new ConstructionStateError(
            "保留中の構築セッションを指定してください",
          );
        row.state =
          row.state === "play_paused"
            ? "playing"
            : row.world_id
              ? row.current?.mode === "participant"
                ? "joining"
                : "running"
              : "generating";
        for (const work of row.current?.members ??
          (row.current ? [row.current] : []))
          if (
            work.mode === "intent" &&
            work.actionText === undefined &&
            !(await this.agent.hasCompletedIntent(work.id))
          )
            work.id = randomUUID();
      } else if (command === "finish") {
        if (row.state !== "ready")
          throw new ConstructionStateError(
            "指定時刻へ到達してから構築を完了してください",
          );
        row.state = "finished";
        row.agenda = row.agenda.filter(
          (work) =>
            work.mode !== "schedule" &&
            (work.actorId !== row.actor_id || work.mode !== "intent"),
        );
      } else {
        if (row.participant_id) return row;
        if (row.state !== "finished")
          throw new ConstructionStateError(
            "世界構築の完了後に参加してください",
          );
        row.state = "joining";
        row.current = { id: randomUUID(), at: row.at, mode: "participant" };
      }
      row.error = null;
      row.claim = null;
      await this.#save(row, client);
      if (row.state !== "finished")
        await this.#enqueue(client, id, row.state === "playing");
      return row;
    }, existing);
  }

  async play(
    id: string,
    actionText: string,
    existing?: pg.PoolClient,
    runId: string = randomUUID(),
  ) {
    z.string().min(1).parse(actionText);
    z.uuid().parse(runId);
    return this.#transaction(async (client) => {
      const row = await this.get(id, client, true);
      if (row.state !== "finished" || !row.participant_id)
        throw new ConstructionStateError(
          "前の行動が区切られてから操作してください",
        );
      row.state = "playing";
      await client.query(
        "INSERT INTO world_run(id,construction_id,actor_id,action_text,state,started_at,at) VALUES($1,$2,$3,$4,'running',$5,$5)",
        [runId, id, row.participant_id, actionText, row.at],
      );
      row.claim = null;
      row.error = null;
      row.agenda = row.agenda.filter(
        (work) => work.actorId !== row.participant_id || work.mode !== "intent",
      );
      row.agenda.push({
        id: randomUUID(),
        at: row.at,
        mode: "action",
        actorId: row.participant_id,
        actionText,
      });
      await this.#save(row, client);
      await this.#enqueue(client, id, true);
      return row;
    }, existing);
  }

  async #save(
    row: Construction,
    client: Pick<pg.Pool, "query"> = this.pool,
    expected?: string,
  ) {
    const result = await client.query(
      `WITH updated AS (UPDATE world_construction SET state=$2,world_id=$3,actor_id=$4,root_ids=$5,
       at=$6,target=$7,agenda=$8,current=$9,participant_id=$10,claim=$11,error=$12
       WHERE id=$1 AND ($13::uuid IS NULL OR claim=$13) RETURNING id,state,at,participant_id),
       progress AS (UPDATE world_run r SET at=u.at,state=CASE u.state WHEN 'playing' THEN 'running' WHEN 'play_paused' THEN 'paused' ELSE 'ready' END
       FROM updated u WHERE u.participant_id IS NOT NULL AND u.state IN ('playing','play_paused','finished')
       AND r.id=(SELECT id FROM world_run WHERE construction_id=u.id AND actor_id=u.participant_id ORDER BY created_at DESC,id DESC LIMIT 1)
       RETURNING r.id) SELECT id FROM updated`,
      [
        row.id,
        row.state,
        row.world_id,
        row.actor_id,
        JSON.stringify(row.root_ids),
        row.at,
        row.target,
        JSON.stringify(row.agenda),
        JSON.stringify(row.current),
        row.participant_id,
        row.claim,
        row.error,
        expected ?? null,
      ],
    );
    if (result.rowCount !== 1)
      throw new SupersededWorker("構築の実行が引き継がれました");
  }

  async #stage(row: Construction, claim: string) {
    return this.#transaction(async (client) => {
      await this.#save(row, client, claim);
      const work = row.current!;
      for (const member of work.members ?? []) {
        if (member.mode === "intent" && !member.observationId)
          member.observationId = await this.agent.create(
            {
              worldId: row.world_id!,
              phase: "observation",
              at: work.at,
              until: work.at,
              rootIds: [member.actorId!],
              actorId: member.actorId!,
              actionText: "",
            },
            randomUUID(),
            client,
          );
      }
      const prepared = (work.members ?? []).every(
        (member) => member.mode !== "intent" || member.actionText !== undefined,
      );
      const humanDecision =
        row.state === "playing" &&
        work.members?.some(
          (member) =>
            member.mode === "intent" && member.actorId === row.participant_id,
        );
      if (!work.operationId && prepared && !humanDecision) {
        const next = Math.min(
          ...row.agenda
            .filter((entry) => entry.at > work.at)
            .map((entry) => entry.at),
        );
        const until =
          work.mode === "participant"
            ? work.at
            : work.mode === "schedule" &&
                row.agenda.some((entry) => entry.at === work.at)
              ? work.at
              : row.state === "playing"
                ? Number.isFinite(next)
                  ? next
                  : undefined
                : Math.min(row.target, next);
        const controlledAction =
          row.state === "playing"
            ? (
                await client.query<{ action_text: string }>(
                  "SELECT action_text FROM world_run WHERE construction_id=$1 AND actor_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
                  [row.id, row.participant_id],
                )
              ).rows[0]?.action_text
            : undefined;
        work.operationId = await this.agent.create(
          {
            worldId: row.world_id!,
            phase:
              work.mode === "participant"
                ? "participant"
                : work.mode === "schedule"
                  ? "schedule"
                  : work.members?.every((member) => member.mode === "resolve")
                    ? "resolution"
                    : "interaction",
            at: work.at,
            ...(until === undefined ? {} : { until }),
            ...(row.state === "running" ? { activityUntil: row.target } : {}),
            rootIds: work.members?.length
              ? work.members.map((member) => member.actorId!)
              : row.root_ids,
            actionText: "",
            ...(row.state === "playing"
              ? { controlledActorId: row.participant_id! }
              : {}),
            ...(controlledAction === undefined
              ? {}
              : { controlledActionText: controlledAction }),
            triggerEdgeIds: [
              ...new Set(
                (work.members ?? []).flatMap((member) => member.triggers ?? []),
              ),
            ],
            ...(work.members
              ? {
                  intentions: work.members.map((member) => ({
                    actorId: member.actorId!,
                    actionText: member.actionText ?? "",
                    continuing: member.mode === "resolve",
                    ...(member.planUntil === undefined
                      ? {}
                      : { planUntil: member.planUntil }),
                  })),
                }
              : {}),
          },
          randomUUID(),
          client,
        );
      }
      await this.#save(row, client, claim);
    });
  }

  async #parallel(items: Work[], action: (work: Work) => Promise<void>) {
    const pending = [...items];
    const results = await Promise.allSettled(
      [0, 1].map(async () => {
        for (;;) {
          const work = pending.shift();
          if (!work) return;
          await action(work);
        }
      }),
    );
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
  }

  async #prepare(row: Construction, claim: string) {
    await this.#stage(row, claim);
    const members = row.current!.members ?? [];
    const observations = new Map<string, WorldProposal>();
    await this.#parallel(
      members.filter((member) => member.observationId !== undefined),
      async (member) => {
        observations.set(
          member.observationId!,
          await this.agent.run(member.observationId!),
        );
      },
    );
    await this.#transaction(async (client) => {
      await this.#save(row, client, claim);
      for (const [id, result] of observations)
        await this.#record(row, id, result, client);
      await this.#save(row, client, claim);
    });
    if (
      row.state === "playing" &&
      members.some(
        (member) =>
          member.mode === "intent" && member.actorId === row.participant_id,
      )
    ) {
      row.at = row.current!.at;
      row.state = "finished";
      row.current = null;
      await this.#save(row, this.pool, claim);
      return;
    }
    await this.#parallel(
      members.filter(
        (member) => member.mode === "intent" && member.actionText === undefined,
      ),
      async (member) => {
        member.actionText = await this.agent.intent(
          row.world_id!,
          member.actorId!,
          member.at,
          member.id,
          member.previousActions,
          row.state === "running" ? row.target : undefined,
        );
        if (row.state === "running") member.planUntil = row.target;
      },
    );
    await this.#stage(row, claim);
  }

  async #record(
    row: Construction,
    operationId: string,
    result: WorldProposal,
    client: pg.PoolClient,
    propagate = false,
  ) {
    const members = row.current?.members ?? (row.current ? [row.current] : []);
    await client.query(
      `INSERT INTO construction_log(construction_id,operation_id,at,result) VALUES($1,$2,$3,$4)
       ON CONFLICT(operation_id) DO NOTHING`,
      [row.id, operationId, result.resolvedUntil, JSON.stringify(result)],
    );
    for (const wakeup of result.wakeups) {
      const source = members.find(
        (member) => member.actorId === wakeup.actorId,
      );
      if (
        row.agenda.some(
          (entry) =>
            entry.actorId === wakeup.actorId &&
            entry.at === wakeup.at &&
            entry.mode === wakeup.mode,
        )
      )
        continue;
      row.agenda.push({
        id: randomUUID(),
        ...wakeup,
        ...(wakeup.mode === "resolve"
          ? {
              actionText: source?.actionText ?? "",
              ...(source?.planUntil === undefined
                ? {}
                : { planUntil: source.planUntil }),
            }
          : source?.actionText
            ? { previousActions: [source.actionText] }
            : {}),
      });
    }
    if (propagate) {
      for (const edge of result.changes.edges) {
        const receiver =
          edge.kind === "effect"
            ? edge.target
            : edge.kind === "see"
              ? edge.source
              : undefined;
        if (!receiver || receiver === row.participant_id) continue;
        const activationAt = Math.max(result.resolvedUntil, edge.period.from);
        let pending = row.agenda.find(
          (entry) => entry.actorId === receiver && entry.at === activationAt,
        );
        if (!pending) {
          const source = members.find((member) => member.actorId === receiver);
          pending = {
            id: randomUUID(),
            at: activationAt,
            mode: "resolve",
            actorId: receiver,
            actionText: source?.actionText ?? "",
            ...(source?.planUntil === undefined
              ? {}
              : { planUntil: source.planUntil }),
          };
          row.agenda.push(pending);
        }
        pending.triggers = [...new Set([...(pending.triggers ?? []), edge.id])];
      }
      if (row.state === "running")
        for (const source of members)
          if (
            source.planUntil !== undefined &&
            !row.agenda.some(
              (entry) =>
                entry.actorId === source.actorId &&
                entry.at === result.resolvedUntil,
            )
          )
            row.agenda.push({
              id: randomUUID(),
              at: result.resolvedUntil,
              actorId: source.actorId!,
              mode: "resolve",
              actionText: source.actionText ?? "",
              planUntil: source.planUntil,
            });
    }
  }

  #take(row: Construction): Work {
    row.agenda.sort(
      (a, b) =>
        a.at - b.at ||
        Number(b.mode === "schedule") - Number(a.mode === "schedule") ||
        a.id.localeCompare(b.id),
    );
    const first = row.agenda[0];
    if (!first || (row.state !== "playing" && first.at >= row.target))
      return { id: randomUUID(), at: row.at, mode: "schedule" };
    if (first.mode === "schedule") return row.agenda.shift()!;
    const due = row.agenda.filter((work) => work.at === first.at);
    row.agenda = row.agenda.filter((work) => work.at !== first.at);
    const human =
      row.state === "playing"
        ? due.find(
            (work) =>
              work.mode === "intent" && work.actorId === row.participant_id,
          )
        : undefined;
    if (human) {
      row.agenda.push(...due.filter((work) => work !== human));
      return {
        id: randomUUID(),
        at: first.at,
        mode: "frame",
        members: [human],
      };
    }
    const members = [];
    for (const actorId of new Set(due.map((work) => work.actorId))) {
      const actions = due.filter((work) => work.actorId === actorId);
      const selected = {
        ...(actions.find((work) => work.mode === "action") ??
          actions.find((work) => work.mode === "intent") ??
          actions[0]!),
      };
      if (
        row.state === "running" &&
        selected.planUntil !== undefined &&
        selected.planUntil <= first.at
      ) {
        selected.id = randomUUID();
        selected.mode = "intent";
        delete selected.actionText;
        delete selected.planUntil;
      }
      members.push({
        ...selected,
        triggers: [...new Set(actions.flatMap((work) => work.triggers ?? []))],
        previousActions: [
          ...new Set([
            ...actions.flatMap((work) => work.previousActions ?? []),
            ...actions
              .filter((work) => work.mode === "resolve")
              .flatMap((work) => (work.actionText ? [work.actionText] : [])),
          ]),
        ],
      });
    }
    return { id: randomUUID(), at: first.at, mode: "frame", members };
  }

  async tick(id: string) {
    const claim = randomUUID();
    let row = await this.#transaction(async (client) => {
      const row = await this.get(id, client, true);
      if (!["generating", "running", "joining", "playing"].includes(row.state))
        return row;
      row.claim = claim;
      await this.#save(row, client);
      return row;
    });
    if (row.claim !== claim) return;
    try {
      if (row.state === "generating") {
        const build = await this.builder.generate(id);
        row.world_id = build.world_id;
        row.actor_id = build.result!.playerId;
        row.root_ids = build.result!.rootIds;
        row.state = "ready";
        row.agenda = [
          { id: randomUUID(), at: 0, mode: "schedule" },
          { id: randomUUID(), at: 0, mode: "intent", actorId: row.actor_id },
        ];
        await this.#save(row, this.pool, claim);
        return;
      }
      if (!row.current) {
        row.current = this.#take(row);
      }
      if (!["frame", "schedule", "participant"].includes(row.current.mode))
        row.current = {
          id: randomUUID(),
          at: row.current.at,
          mode: "frame",
          members: [row.current],
          ...(row.current.operationId
            ? { operationId: row.current.operationId }
            : {}),
        };
      await this.#prepare(row, claim);
      if (!row.current) return row;
      const work = row.current;
      const result = await this.agent.run(work.operationId!);
      await this.#transaction(async (client) => {
        await this.#save(row, client, claim);
        await this.#record(
          row,
          work.operationId!,
          result,
          client,
          work.mode !== "participant",
        );
        if (work.mode === "participant") {
          row.participant_id = result.newParticipantId!;
          row.state = "finished";
        } else if (row.state === "playing") {
          row.at = Math.min(
            result.resolvedUntil,
            ...row.agenda.map((entry) => entry.at),
          );
          if (!row.agenda.length) row.state = "finished";
        } else {
          row.at = Math.min(
            row.target,
            result.resolvedUntil,
            ...row.agenda.map((entry) => entry.at),
          );
          if (row.at === row.target) row.state = "ready";
          else if (result.resolvedUntil <= work.at && row.agenda.length === 0) {
            row.state = "paused";
            row.error =
              "指定時刻までの進行と次の起動を確定できず、実際の到達時点で保留しました";
          }
        }
        row.current = null;
        if (row.state !== "paused") row.error = null;
        await this.#save(row, client, claim);
        if (row.state === "running" || row.state === "playing")
          await this.#enqueue(client, id, row.state === "playing");
      });
    } catch (error) {
      row.state = row.state === "playing" ? "play_paused" : "paused";
      row.error = error instanceof Error ? error.message : "実行を保留しました";
      await this.#save(row, this.pool, claim);
      throw error;
    }
    row = await this.get(id);
    return row;
  }

  async work() {
    return Promise.all(
      [this.queueName, `${this.queueName}-play`].map((name) =>
        this.queue.work<{ id: string }>(
          name,
          { localConcurrency: 2, pollingIntervalSeconds: 0.5 },
          async (jobs) => {
            for (const job of jobs) {
              try {
                await this.tick(job.data.id);
              } catch (error) {
                if (!(error instanceof Error)) throw error;
                console.error(
                  JSON.stringify({
                    constructionId: job.data.id,
                    error: error.message,
                  }),
                );
              }
            }
          },
        ),
      ),
    );
  }

  async report(id: string) {
    const session = await this.get(id);
    const records = await this.pool.query<{
      operation_id: string;
      at: string;
      result: WorldProposal;
    }>(
      "SELECT operation_id,at,result FROM construction_log WHERE construction_id=$1 ORDER BY id",
      [id],
    );
    return {
      session,
      records: records.rows.map((row) => ({ ...row, at: Number(row.at) })),
    };
  }
}
