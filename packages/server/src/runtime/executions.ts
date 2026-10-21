import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";
import { RuntimeStopped } from "./control.js";

type Kind = "construction" | "scene" | "join";
const scope = new AsyncLocalStorage<{
  kind: Kind;
  id: string;
  token: string;
}>();
export class RuntimeExecutions {
  static async setup(db: Pick<pg.Pool, "query">) {
    await db.query(`CREATE TABLE IF NOT EXISTS runtime_execution(
      kind text NOT NULL,id uuid NOT NULL,token uuid NOT NULL,job_id uuid,state text NOT NULL,
      deliveries integer NOT NULL DEFAULT 1,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
      response_id uuid,operation_id uuid,world_id uuid,user_id uuid,error_code text,PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS runtime_execution_active ON runtime_execution(state,job_id);
      CREATE TABLE IF NOT EXISTS runtime_metric(at timestamptz PRIMARY KEY,completed bigint NOT NULL DEFAULT 0,
      failed bigint NOT NULL DEFAULT 0,latency_ms bigint NOT NULL DEFAULT 0);`);
  }
  static async run<T>(
    pool: pg.Pool,
    kind: Kind,
    id: string,
    jobId: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    const token = randomUUID();
    let first = true;
    for (;;) {
      const db = await pool.connect();
      let acquired: boolean;
      try {
        await db.query("BEGIN");
        const p = (
          await db.query(
            "SELECT configuration FROM runtime_control WHERE singleton FOR UPDATE",
          )
        ).rows[0].configuration;
        const busy = (
          await db.query(
            `SELECT count(*)::int AS n FROM runtime_execution r WHERE r.state='running' AND (kind,id)<>($1,$2)
          AND (job_id IS NULL OR EXISTS(SELECT 1 FROM pgboss.job j WHERE j.id=r.job_id AND j.state='active'))`,
            [kind, id],
          )
        ).rows[0].n;
        acquired = p.paused || p.concurrency === null || busy < p.concurrency;
        const claimed = await db.query(
          `INSERT INTO runtime_execution(kind,id,token,job_id,state) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(kind,id) DO UPDATE SET token=$3,job_id=$4,state=$5,deliveries=runtime_execution.deliveries+CASE WHEN runtime_execution.token=$3 THEN 0 ELSE 1 END,
          started_at=CASE WHEN runtime_execution.token=$3 THEN runtime_execution.started_at ELSE now() END,finished_at=NULL,error_code=NULL WHERE runtime_execution.token=$3 OR $6::boolean RETURNING id`,
          [
            kind,
            id,
            token,
            jobId ?? null,
            acquired ? "running" : "waiting",
            first,
          ],
        );
        if (!claimed.rowCount)
          throw new RuntimeStopped(
            "SUPERSEDED",
            "古いワーカーの処理枠待ちは終了しました。",
          );
        first = false;
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
      if (acquired) break;
      await delay(500);
    }
    return scope.run({ kind, id, token }, async () => {
      let failed = false,
        code: string | null = null;
      try {
        return await work();
      } catch (error) {
        failed = true;
        code =
          error instanceof RuntimeStopped ? error.code : "EXECUTION_FAILED";
        throw error;
      } finally {
        await pool.query(
          `WITH done AS (UPDATE runtime_execution SET state=$4,error_code=$5,finished_at=now()
          WHERE kind=$1 AND id=$2 AND token=$3 RETURNING extract(epoch FROM now()-started_at)*1000 AS latency)
          INSERT INTO runtime_metric(at,completed,failed,latency_ms) SELECT date_trunc('minute',now()),1,$6,ceil(latency)::bigint FROM done
          ON CONFLICT(at) DO UPDATE SET completed=runtime_metric.completed+1,failed=runtime_metric.failed+$6,
          latency_ms=greatest(runtime_metric.latency_ms,excluded.latency_ms)`,
          [
            kind,
            id,
            token,
            failed ? "paused" : "finished",
            code,
            failed ? 1 : 0,
          ],
        );
      }
    });
  }
  static async attach(
    db: Pick<pg.Pool, "query">,
    responseId: string,
    operationId: string,
    worldId?: string,
    userId?: string,
  ) {
    const current = scope.getStore();
    if (!current) return;
    await db.query(
      "UPDATE runtime_execution SET response_id=$4,operation_id=$5,world_id=coalesce($6,world_id),user_id=coalesce($7,user_id) WHERE kind=$1 AND id=$2 AND token=$3",
      [
        current.kind,
        current.id,
        current.token,
        responseId,
        operationId,
        worldId ?? null,
        userId ?? null,
      ],
    );
  }
  static async check(db: Pick<pg.Pool, "query">, lock = false) {
    const current = scope.getStore();
    if (!current) return;
    if (
      !(
        await db.query(
          `SELECT id FROM runtime_execution WHERE kind=$1 AND id=$2 AND token=$3 AND state='running'${lock ? " FOR SHARE" : ""}`,
          [current.kind, current.id, current.token],
        )
      ).rowCount
    )
      throw new RuntimeStopped(
        "SUPERSEDED",
        "古いワーカーから新たな推論・確定は実行できません。",
      );
  }
  static bind<A extends unknown[], R>(work: (...args: A) => R) {
    const current = scope.getStore();
    return current
      ? (...args: A) => scope.run(current, () => work(...args))
      : work;
  }
  static async reconcile(db: Pick<pg.Pool, "query">) {
    await db.query(`WITH interrupted AS (UPDATE runtime_execution r SET state='interrupted',error_code='WORKER_INTERRUPTED',finished_at=now(),token=gen_random_uuid()
      WHERE state IN ('running','waiting') AND job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pgboss.job j WHERE j.id=r.job_id AND j.state='active') RETURNING response_id,started_at),
      metrics AS (INSERT INTO runtime_metric(at,completed,failed,latency_ms) SELECT date_trunc('minute',now()),count(*),count(*),ceil(max(extract(epoch FROM now()-started_at)*1000))::bigint FROM interrupted HAVING count(*)>0
        ON CONFLICT(at) DO UPDATE SET completed=runtime_metric.completed+excluded.completed,failed=runtime_metric.failed+excluded.failed,latency_ms=greatest(runtime_metric.latency_ms,excluded.latency_ms) RETURNING at)
      UPDATE llm_call c SET delivery='unknown' FROM interrupted i WHERE c.response_id=i.response_id AND c.state='pending' AND c.created_at>=i.started_at`);
  }
}
