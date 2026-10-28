import type pg from "pg";
import { ExecutionBudget } from "../execution-budget.js";
import { ModelLimits } from "./limits.js";
import { WorldBudget } from "./world-budget.js";

export const NANO_USD = 1_000_000_000;
export class BudgetUnavailable extends Error {}
export class ResponseFormatError extends Error {
  constructor(readonly diagnostic: unknown) {
    super("LLM応答の形式を確認できません。予約枠は保持します");
  }
}
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
    cache_write_5m_tokens?: number;
    cache_write_1h_tokens?: number;
    reasoning_tokens?: number;
  };
};
type SavedResponse =
  | SavedCompletion
  | { error: string; rejection?: unknown; diagnostic?: unknown };

export class BudgetLedger {
  constructor(
    readonly pool: pg.Pool,
    readonly budgetId: string,
    readonly limitNano: number | null,
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
    await this.pool.query(
      "ALTER TABLE llm_budget ALTER COLUMN limit_nano DROP NOT NULL",
    );
    await this.pool
      .query(`ALTER TABLE llm_call ADD COLUMN IF NOT EXISTS world_id uuid;
      ALTER TABLE llm_call ADD COLUMN IF NOT EXISTS user_id uuid,
        ADD COLUMN IF NOT EXISTS response_id uuid, ADD COLUMN IF NOT EXISTS operation_id uuid,
        ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT 'unknown';
      CREATE INDEX IF NOT EXISTS llm_call_time ON llm_call(created_at,id);
      CREATE INDEX IF NOT EXISTS llm_call_user ON llm_call(user_id,created_at,id);
      CREATE INDEX IF NOT EXISTS llm_call_response ON llm_call(response_id,created_at,id);
      CREATE INDEX IF NOT EXISTS llm_call_world ON llm_call(world_id,created_at);`);
    await WorldBudget.setup(this.pool);
    const result = await this.pool.query<{ limit_nano: string | null }>(
      `INSERT INTO llm_budget (id, limit_nano) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING limit_nano`,
      [this.budgetId, this.limitNano],
    );
    if (
      (result.rows[0]!.limit_nano === null
        ? null
        : Number(result.rows[0]!.limit_nano)) !== this.limitNano
    )
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
        limit_nano: string | null;
      }>(
        "SELECT used_nano, limit_nano FROM llm_budget WHERE id = $1 FOR UPDATE",
        [this.budgetId],
      );
      const prior = await client.query<{
        hash: string;
        budget_id: string;
        state: string;
        response: SavedResponse;
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
        if ("error" in prior.rows[0].response)
          throw new Error(prior.rows[0].response.error);
        await client.query("COMMIT");
        return prior.rows[0].response;
      }
      if (
        !budget.rows[0] ||
        (budget.rows[0].limit_nano !== null &&
          Number(budget.rows[0].used_nano) + reservation >
            Number(budget.rows[0].limit_nano))
      )
        throw new BudgetUnavailable("費用上限のため実行を保留します");
      const worldId = ExecutionBudget.worldId;
      if (worldId) {
        const world = (
          await client.query<{ used_nano: string; limit_nano: string }>(
            "SELECT used_nano,limit_nano FROM world_budget WHERE world_id=$1 FOR UPDATE",
            [worldId],
          )
        ).rows[0];
        if (!world)
          throw new BudgetUnavailable(
            "世界の予算を設定してから再開してください",
          );
        if (Number(world.used_nano) + reservation > Number(world.limit_nano))
          throw new BudgetUnavailable("世界の予算上限のため実行を保留します");
        await client.query(
          "UPDATE world_budget SET used_nano=used_nano+$2 WHERE world_id=$1",
          [worldId, reservation],
        );
      }
      await ExecutionBudget.take(client);
      await client.query(
        "INSERT INTO llm_call (id, budget_id, hash, reserved_nano, request,world_id,user_id,response_id,operation_id,delivery) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved')",
        [
          id,
          this.budgetId,
          hash,
          reservation,
          JSON.stringify(request),
          worldId ?? null,
          ExecutionBudget.attribution.userId,
          ExecutionBudget.attribution.responseId,
          ExecutionBudget.attribution.operationId,
        ],
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
    response: SavedResponse,
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
        world_id: string | null;
      }>(
        "SELECT reserved_nano, state,world_id FROM llm_call WHERE id = $1 AND budget_id = $2 FOR UPDATE",
        [id, this.budgetId],
      );
      const call = result.rows[0];
      if (!call || charged > Number(call.reserved_nano))
        throw new Error("使用量が予約した費用上限と整合しません");
      if (call.state === "pending") {
        if (call.world_id)
          await client.query(
            "UPDATE world_budget SET used_nano=used_nano-$2+$3 WHERE world_id=$1",
            [call.world_id, Number(call.reserved_nano), charged],
          );
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

  async track<T>(id: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      await this.pool.query(
        "UPDATE llm_call SET delivery='unknown',response=coalesce($3::jsonb,response) WHERE id=$1 AND budget_id=$2 AND state='pending'",
        [
          id,
          this.budgetId,
          error instanceof ResponseFormatError
            ? JSON.stringify({
                error: error.message,
                diagnostic: error.diagnostic,
              })
            : null,
        ],
      );
      throw error;
    }
  }

  async hasPendingOperation(id: string) {
    return !!(
      await this.pool.query(
        "SELECT id FROM llm_call WHERE state='pending' AND (operation_id=$1 OR request->>'operationId'=$1::text) LIMIT 1",
        [id],
      )
    ).rowCount;
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
      limitUsd:
        row.limit_nano === null ? null : Number(row.limit_nano) / NANO_USD,
      upperCostUsd: Number(row.used_nano) / NANO_USD,
      calls: Number(row.calls),
      unsettled: Number(row.unsettled),
    };
  }
}
