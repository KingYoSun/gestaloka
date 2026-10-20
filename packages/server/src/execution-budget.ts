import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

const scope = new AsyncLocalStorage<{
  pool: pg.Pool;
  id: string;
  worldId?: string | undefined;
}>();
export class ExecutionLimit extends Error {}

// Counts belong to one response, including its nested work and retries.
export class ExecutionBudget {
  static async setup(pool: Pick<pg.Pool, "query">) {
    await pool.query(`CREATE TABLE IF NOT EXISTS execution_budget (
      id uuid PRIMARY KEY, llm_used integer NOT NULL DEFAULT 0,llm_limit integer NOT NULL DEFAULT 64);
      CREATE TABLE IF NOT EXISTS response_call_policy(singleton boolean PRIMARY KEY CHECK(singleton),
      calls integer NOT NULL DEFAULT 64,version integer NOT NULL DEFAULT 1,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO response_call_policy(singleton) VALUES(true) ON CONFLICT DO NOTHING;`);
  }

  static async run<T>(
    pool: pg.Pool,
    id: string,
    work: () => Promise<T>,
    worldId?: string,
  ): Promise<T> {
    const current = scope.getStore();
    if (current)
      return worldId && !current.worldId
        ? scope.run({ ...current, worldId }, work)
        : work();
    await pool.query(
      "INSERT INTO execution_budget(id) VALUES($1) ON CONFLICT DO NOTHING",
      [id],
    );
    return scope.run({ pool, id, worldId }, work);
  }
  static get worldId() {
    return scope.getStore()?.worldId;
  }
  static get id() {
    return scope.getStore()?.id;
  }

  static bind<A extends unknown[], R>(work: (...args: A) => R) {
    const current = scope.getStore();
    return current
      ? (...args: A) => scope.run(current, () => work(...args))
      : work;
  }

  static async take(database?: Pick<pg.Pool, "query">) {
    const current = scope.getStore();
    if (!current) return;
    const result = await (database ?? current.pool).query(
      `UPDATE execution_budget SET llm_used=llm_used+1,llm_limit=p.calls FROM response_call_policy p
       WHERE id=$1 AND p.singleton AND llm_used<p.calls RETURNING id`,
      [current.id],
    );
    if (!result.rowCount)
      throw new ExecutionLimit(
        "応答生成1回のAPI call回数上限に達したため保留しました。管理者が上限を見直した後、保存した状態から再開できます。",
      );
  }

  static async exhausted(id: string, database: Pick<pg.Pool, "query">) {
    const result = await database.query(
      `SELECT id FROM execution_budget,response_call_policy p WHERE id=$1 AND p.singleton AND llm_used>=p.calls`,
      [id],
    );
    return result.rowCount === 1;
  }
}
