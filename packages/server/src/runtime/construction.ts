import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { WorldBuilder } from "./build.js";
import { WorldAgent, SupersededWorker, type WorldProposal } from "./agent.js";

type Work = {
  id: string;
  at: number;
  mode: "schedule" | "intent" | "resolve" | "participant";
  actorId?: string;
  actionText?: string;
  observationId?: string;
  operationId?: string;
};
export type Construction = {
  id: string;
  state: "generating" | "ready" | "running" | "paused" | "finished" | "joining";
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
    await this.queue.createQueue(this.queueName, {
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

  async #enqueue(client: pg.PoolClient, id: string) {
    await this.queue.send(
      this.queueName,
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
      `SELECT * FROM world_construction WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
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
        time.positive().parse(duration);
        row.target = time.parse(row.at + duration!);
        row.state = "running";
        row.agenda.push({ id: randomUUID(), at: row.at, mode: "schedule" });
      } else if (command === "resume") {
        if (row.state !== "paused")
          throw new ConstructionStateError(
            "保留中の構築セッションを指定してください",
          );
        row.state = row.world_id
          ? row.current?.mode === "participant"
            ? "joining"
            : "running"
          : "generating";
        if (
          row.current?.mode === "intent" &&
          row.current.actionText === undefined
        )
          row.current.id = randomUUID();
      } else if (command === "finish") {
        if (row.state !== "ready")
          throw new ConstructionStateError(
            "指定時刻へ到達してから構築を完了してください",
          );
        row.state = "finished";
        row.agenda = row.agenda.filter(
          (work) => work.actorId !== row.actor_id || work.mode !== "intent",
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
      if (row.state !== "finished") await this.#enqueue(client, id);
      return row;
    }, existing);
  }

  async #save(
    row: Construction,
    client: Pick<pg.Pool, "query"> = this.pool,
    expected?: string,
  ) {
    const result = await client.query(
      `UPDATE world_construction SET state=$2,world_id=$3,actor_id=$4,root_ids=$5,
       at=$6,target=$7,agenda=$8,current=$9,participant_id=$10,claim=$11,error=$12
       WHERE id=$1 AND ($13::uuid IS NULL OR claim=$13)`,
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
      if (work.mode === "intent" && !work.observationId) {
        work.observationId = await this.agent.create(
          {
            worldId: row.world_id!,
            phase: "observation",
            at: work.at,
            until: work.at,
            rootIds: row.root_ids,
            actorId: work.actorId!,
            actionText: "",
          },
          randomUUID(),
          client,
        );
      }
      if (work.mode !== "intent" || work.actionText !== undefined) {
        if (!work.operationId)
          work.operationId = await this.agent.create(
            {
              worldId: row.world_id!,
              phase:
                work.mode === "participant"
                  ? "participant"
                  : work.mode === "schedule" ||
                      (work.mode === "resolve" && !work.actionText)
                    ? "schedule"
                    : "interaction",
              at: work.at,
              until:
                work.mode === "participant"
                  ? work.at
                  : Math.min(
                      row.target,
                      ...row.agenda
                        .filter((entry) => entry.at >= work.at)
                        .map((entry) => entry.at),
                    ),
              rootIds: row.root_ids,
              ...(work.actorId ? { actorId: work.actorId } : {}),
              actionText: work.actionText ?? "",
            },
            randomUUID(),
            client,
          );
      }
      await this.#save(row, client, claim);
    });
  }

  async #record(
    row: Construction,
    operationId: string,
    result: WorldProposal,
    client: pg.PoolClient,
  ) {
    await client.query(
      `INSERT INTO construction_log(construction_id,operation_id,at,result) VALUES($1,$2,$3,$4)
       ON CONFLICT(operation_id) DO NOTHING`,
      [row.id, operationId, result.resolvedUntil, JSON.stringify(result)],
    );
    for (const wakeup of result.wakeups) {
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
              actionText:
                wakeup.actorId === row.current?.actorId
                  ? (row.current.actionText ?? "")
                  : "",
            }
          : {}),
      });
    }
  }

  async tick(id: string) {
    const claim = randomUUID();
    let row = await this.#transaction(async (client) => {
      const row = await this.get(id, client, true);
      if (!["generating", "running", "joining"].includes(row.state)) return row;
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
          { id: randomUUID(), at: 0, mode: "intent", actorId: row.actor_id },
        ];
        await this.#save(row, this.pool, claim);
        return;
      }
      if (!row.current) {
        row.agenda.sort(
          (a, b) =>
            a.at - b.at ||
            Number(b.mode === "schedule") - Number(a.mode === "schedule") ||
            a.id.localeCompare(b.id),
        );
        const work = row.agenda[0];
        row.current =
          work && work.at < row.target
            ? row.agenda.shift()!
            : { id: randomUUID(), at: row.at, mode: "schedule" };
      }
      const work = row.current;
      await this.#stage(row, claim);
      if (work.mode === "intent") {
        const observed = await this.agent.run(work.observationId!);
        await this.#transaction(async (client) => {
          await this.#save(row, client, claim);
          await this.#record(row, work.observationId!, observed, client);
          await this.#save(row, client, claim);
        });
        if (work.actionText === undefined) {
          work.actionText = await this.agent.intent(
            row.world_id!,
            work.actorId!,
            work.at,
            work.id,
          );
          await this.#stage(row, claim);
        }
      }
      const result = await this.agent.run(work.operationId!);
      await this.#transaction(async (client) => {
        await this.#save(row, client, claim);
        await this.#record(row, work.operationId!, result, client);
        if (work.mode === "participant") {
          row.participant_id = result.newParticipantId!;
          row.state = "finished";
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
        if (row.state === "running") await this.#enqueue(client, id);
      });
    } catch (error) {
      await this.pool.query(
        "UPDATE world_construction SET state='paused',error=$3 WHERE id=$1 AND claim=$2",
        [
          id,
          claim,
          error instanceof Error ? error.message : "実行を保留しました",
        ],
      );
      throw error;
    }
    row = await this.get(id);
    return row;
  }

  async work() {
    return this.queue.work<{ id: string }>(
      this.queueName,
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
