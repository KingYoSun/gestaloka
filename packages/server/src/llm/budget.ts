import type pg from "pg";
import { ExecutionBudget } from "../execution-budget.js";
import { ModelLimits } from "./limits.js";

export const NANO_USD = 1_000_000_000;
export class BudgetUnavailable extends Error {}
export type SavedCompletion = {
  id: string;
  model: string;
  content: string;
  finishReason: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_cache_hit_tokens: number;
    prompt_cache_miss_tokens: number;
  };
};

export class BudgetLedger {
  constructor(
    readonly pool: pg.Pool,
    readonly budgetId: string,
    readonly limitNano: number,
    readonly modelLimits = new ModelLimits(pool),
  ) {}
  async setup() {
    await ExecutionBudget.setup(this.pool);
    await this.modelLimits.setup();
    await this.pool.query(`CREATE TABLE IF NOT EXISTS llm_budget (
      id text PRIMARY KEY, limit_nano bigint NOT NULL, used_nano bigint NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS llm_call (
      id uuid PRIMARY KEY, budget_id text NOT NULL REFERENCES llm_budget(id), hash text NOT NULL,
      reserved_nano bigint NOT NULL, charged_nano bigint, request jsonb NOT NULL,
      response jsonb, state text NOT NULL DEFAULT 'pending', elapsed_ms integer,
      created_at timestamptz NOT NULL DEFAULT now());`);
    const result = await this.pool.query<{ limit_nano: string }>(
      `INSERT INTO llm_budget (id, limit_nano) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING limit_nano`,
      [this.budgetId, this.limitNano],
    );
    if (Number(result.rows[0]!.limit_nano) !== this.limitNano)
      throw new BudgetUnavailable(
        "保存済み予算と設定が異なります。自動では予算を増額しません",
      );
  }

  async reserve(
    id: string,
    hash: string,
    reservation: number,
    request: unknown,
  ): Promise<SavedCompletion | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const budget = await client.query<{
        used_nano: string;
        limit_nano: string;
      }>(
        "SELECT used_nano, limit_nano FROM llm_budget WHERE id = $1 FOR UPDATE",
        [this.budgetId],
      );
      const prior = await client.query<{
        hash: string;
        budget_id: string;
        state: string;
        response: SavedCompletion;
      }>(
        "SELECT hash, budget_id, state, response FROM llm_call WHERE id = $1",
        [id],
      );
      if (prior.rows[0]) {
        if (
          prior.rows[0].hash !== hash ||
          prior.rows[0].budget_id !== this.budgetId
        )
          throw new Error("同じ呼出しIDに異なる要求は対応させられません");
        if (prior.rows[0].state !== "complete")
          throw new BudgetUnavailable(
            "送信済み要求の結果が未確定です。自動では再送しません",
          );
        await client.query("COMMIT");
        return prior.rows[0].response;
      }
      if (
        !budget.rows[0] ||
        Number(budget.rows[0].used_nano) + reservation >
          Number(budget.rows[0].limit_nano)
      )
        throw new BudgetUnavailable("費用上限のため実行を保留します");
      await ExecutionBudget.take("llm", client);
      await client.query(
        "INSERT INTO llm_call (id, budget_id, hash, reserved_nano, request) VALUES ($1,$2,$3,$4,$5)",
        [id, this.budgetId, hash, reservation, JSON.stringify(request)],
      );
      await client.query(
        "UPDATE llm_budget SET used_nano = used_nano + $2 WHERE id = $1",
        [this.budgetId, reservation],
      );
      await client.query("COMMIT");
      return undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async settle(
    id: string,
    charged: number,
    response: SavedCompletion,
    elapsedMs: number,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM llm_budget WHERE id = $1 FOR UPDATE", [
        this.budgetId,
      ]);
      const result = await client.query<{
        reserved_nano: string;
        state: string;
      }>(
        "SELECT reserved_nano, state FROM llm_call WHERE id = $1 AND budget_id = $2 FOR UPDATE",
        [id, this.budgetId],
      );
      const call = result.rows[0];
      if (!call || charged > Number(call.reserved_nano))
        throw new Error("使用量が予約した費用上限と整合しません");
      if (call.state === "pending") {
        await client.query(
          "UPDATE llm_budget SET used_nano = used_nano - $2 + $3 WHERE id = $1",
          [this.budgetId, Number(call.reserved_nano), charged],
        );
        await client.query(
          `UPDATE llm_call SET charged_nano = $2, response = $3, state = 'complete', elapsed_ms = $4 WHERE id = $1`,
          [id, charged, JSON.stringify(response), elapsedMs],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async state(id: string) {
    const result = await this.pool.query<{ state: string }>(
      "SELECT state FROM llm_call WHERE id=$1 AND budget_id=$2",
      [id, this.budgetId],
    );
    return result.rows[0]?.state;
  }
  async input(id: string) {
    const result = await this.pool.query<{ request: unknown }>(
      "SELECT request FROM llm_call WHERE id=$1 AND budget_id=$2",
      [id, this.budgetId],
    );
    return result.rows[0]?.request;
  }

  async summary() {
    const result = await this.pool.query<{
      limit_nano: string;
      used_nano: string;
      calls: string;
      unsettled: string;
    }>(
      `SELECT b.limit_nano, b.used_nano, count(c.id) AS calls,
       count(c.id) FILTER (WHERE c.state <> 'complete') AS unsettled
       FROM llm_budget b LEFT JOIN llm_call c ON c.budget_id = b.id
       WHERE b.id = $1 GROUP BY b.id`,
      [this.budgetId],
    );
    const row = result.rows[0]!;
    return {
      limitUsd: Number(row.limit_nano) / NANO_USD,
      upperCostUsd: Number(row.used_nano) / NANO_USD,
      calls: Number(row.calls),
      unsettled: Number(row.unsettled),
    };
  }
}
