import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

const scope = new AsyncLocalStorage<{ pool: pg.Pool; id: string }>();
export class ExecutionLimit extends Error {}

// Processing limits are independent of the administrator's API-spend budget.
export class ExecutionBudget {
  static async setup(pool: Pick<pg.Pool, "query">) {
    await pool.query(`CREATE TABLE IF NOT EXISTS execution_budget (
      id uuid PRIMARY KEY, llm_used integer NOT NULL DEFAULT 0, graph_used integer NOT NULL DEFAULT 0,
      llm_limit integer NOT NULL DEFAULT 64, graph_limit integer NOT NULL DEFAULT 4096);`);
  }

  static async run<T>(
    pool: pg.Pool,
    id: string,
    work: () => Promise<T>,
  ): Promise<T> {
    if (scope.getStore()) return work();
    await pool.query(
      "INSERT INTO execution_budget(id) VALUES($1) ON CONFLICT DO NOTHING",
      [id],
    );
    return scope.run({ pool, id }, work);
  }

  static bind<A extends unknown[], R>(work: (...args: A) => R) {
    const current = scope.getStore();
    return current
      ? (...args: A) => scope.run(current, () => work(...args))
      : work;
  }

  static async take(kind: "llm" | "graph", database?: Pick<pg.Pool, "query">) {
    const current = scope.getStore();
    if (!current) return;
    const result = await (database ?? current.pool).query(
      `UPDATE execution_budget SET ${kind}_used=${kind}_used+1 WHERE id=$1 AND ${kind}_used<${kind}_limit RETURNING id`,
      [current.id],
    );
    if (!result.rowCount)
      throw new ExecutionLimit(
        `${kind === "llm" ? "LLM呼出し" : "グラフ照会"}の処理上限に達したため保留しました。保存した状態から明示的に再開できます。`,
      );
  }

  static async extend(id: string, database: Pick<pg.Pool, "query">) {
    const result = await database.query(
      `UPDATE execution_budget SET llm_limit=llm_limit+64,graph_limit=graph_limit+4096
       WHERE id=$1 AND (llm_used>=llm_limit OR graph_used>=graph_limit) RETURNING id`,
      [id],
    );
    return result.rowCount === 1;
  }
}
