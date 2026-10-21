import { RuntimeExecutions } from "./runtime/executions.js";
import { McpOrigin } from "./http/mcp-origin.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import { RuntimeControl, type Authority } from "./runtime/control.js";

const scope = new AsyncLocalStorage<{
  pool: pg.Pool;
  id: string;
  worldId?: string | undefined;
  userId?: string | undefined;
  operationId: string;
  authority?: Authority | undefined;
}>();
export class ExecutionLimit extends Error {}

// Counts belong to one response, including its nested work and retries.
export class ExecutionBudget {
  static async setup(pool: Pick<pg.Pool, "query">) {
    await RuntimeControl.setup(pool);
    await RuntimeExecutions.setup(pool);
    await pool.query(`CREATE TABLE IF NOT EXISTS execution_budget (
      id uuid PRIMARY KEY, llm_used integer NOT NULL DEFAULT 0,llm_limit integer NOT NULL DEFAULT 64);
      CREATE TABLE IF NOT EXISTS response_call_policy(singleton boolean PRIMARY KEY CHECK(singleton),
      calls integer NOT NULL DEFAULT 64,version integer NOT NULL DEFAULT 1,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE execution_budget ADD COLUMN IF NOT EXISTS user_id uuid, ADD COLUMN IF NOT EXISTS authority jsonb;
      INSERT INTO response_call_policy(singleton) VALUES(true) ON CONFLICT DO NOTHING;`);
  }

  static async run<T>(
    pool: pg.Pool,
    id: string,
    work: () => Promise<T>,
    worldId?: string,
    userId?: string,
    authority?: Authority,
  ): Promise<T> {
    const current = scope.getStore();
    if (current)
      return scope.run(
        { ...current, worldId: current.worldId ?? worldId, operationId: id },
        async () => {
          await RuntimeExecutions.attach(
            pool,
            current.id,
            id,
            current.worldId ?? worldId,
            current.userId,
          );
          return work();
        },
      );
    await pool.query(
      "INSERT INTO execution_budget(id,user_id,authority) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [
        id,
        userId ?? null,
        {
          ...authority,
          ...(McpOrigin.current ? { mcp: McpOrigin.current } : {}),
        },
      ],
    );
    const saved = (
      await pool.query<{ user_id: string | null; authority: Authority | null }>(
        "SELECT user_id,authority FROM execution_budget WHERE id=$1",
        [id],
      )
    ).rows[0]!;
    const authorityWithOrigin = {
      ...(saved.authority ?? {}),
      ...(McpOrigin.current ? { mcp: McpOrigin.current } : {}),
    };
    if (McpOrigin.current === null) delete authorityWithOrigin.mcp;
    await pool.query("UPDATE execution_budget SET authority=$2 WHERE id=$1", [
      id,
      authorityWithOrigin,
    ]);
    return scope.run(
      {
        pool,
        id,
        worldId,
        operationId: id,
        userId: saved.user_id ?? undefined,
        authority: authorityWithOrigin,
      },
      async () => {
        await RuntimeExecutions.attach(
          pool,
          id,
          id,
          worldId,
          saved.user_id ?? undefined,
        );
        return work();
      },
    );
  }
  static get worldId() {
    return scope.getStore()?.worldId;
  }
  static get attribution() {
    const current = scope.getStore();
    return {
      responseId: current?.id ?? null,
      operationId: current?.operationId ?? null,
      userId: current?.userId ?? null,
    };
  }
  static async attribute(
    db: Pick<pg.Pool, "query">,
    id: string,
    userId: string,
    authority?: Authority,
  ) {
    await db.query(
      "INSERT INTO execution_budget(id,user_id,authority) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [id, userId, authority ?? null],
    );
  }
  static get id() {
    return scope.getStore()?.id;
  }

  static bind<A extends unknown[], R>(work: (...args: A) => R) {
    const current = scope.getStore();
    return RuntimeExecutions.bind(
      current ? (...args: A) => scope.run(current, () => work(...args)) : work,
    );
  }

  static async check(database?: Pick<pg.Pool, "query">, lock = false) {
    const current = scope.getStore();
    if (!current) return;
    await RuntimeControl.check(
      database ?? current.pool,
      {
        ...current.authority,
        userId: current.userId,
        worldId: current.worldId,
      },
      lock,
    );
    await RuntimeExecutions.check(database ?? current.pool, lock);
  }
  static async commit<T>(work: () => Promise<T>) {
    const current = scope.getStore();
    if (!current) return work();
    const db = await current.pool.connect();
    try {
      await db.query("BEGIN");
      await this.check(db, true);
      const result = await work();
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  static async take(database?: Pick<pg.Pool, "query">) {
    const current = scope.getStore();
    if (!current) return;
    await this.check(database, true);
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
