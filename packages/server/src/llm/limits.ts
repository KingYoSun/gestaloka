import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";
import { z } from "zod";
import { ModelLimit, ModelLimitName } from "@gestaloka/contracts";

const Limits = z.record(ModelLimitName, ModelLimit);
type Usage = { sent: () => void; used: (tokens: number) => void };

export class ModelLimits {
  readonly limits: z.infer<typeof Limits>;
  constructor(
    readonly pool: pg.Pool,
    json = "{}",
  ) {
    this.limits = Limits.parse(JSON.parse(json));
  }
  static async setup(pool: pg.Pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS llm_model_use (
      id uuid PRIMARY KEY,scope text NOT NULL,tokens bigint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),active_until timestamptz);
      CREATE INDEX IF NOT EXISTS llm_model_use_scope ON llm_model_use(scope,created_at);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS llm_model_policy (
      name text PRIMARY KEY,limits jsonb,version integer NOT NULL DEFAULT 1,
      updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now());`);
  }
  async setup() {
    await ModelLimits.setup(this.pool);
    await this.pool.query(
      `INSERT INTO llm_model_policy(name,limits)
      SELECT key,value FROM jsonb_each($1::jsonb) ON CONFLICT(name) DO NOTHING`,
      [JSON.stringify(this.limits)],
    );
  }
  async run<T>(
    input: {
      name: string;
      key: string;
      request: unknown;
      maxOutput: number;
      cached: boolean;
    },
    work: (usage: Usage) => Promise<T>,
  ): Promise<T> {
    if (input.cached) return work({ sent: () => {}, used: () => {} });
    const tokens =
      Buffer.byteLength(JSON.stringify(input.request), "utf8") +
      input.maxOutput;
    const scope = createHash("sha256")
        .update(`${input.name}:${input.key}`)
        .digest("hex"),
      id = randomUUID();
    for (;;) {
      const client = await this.pool.connect();
      let admitted: boolean;
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [scope],
        );
        const saved = (
          await client.query<{ limits: z.infer<typeof ModelLimit> | null }>(
            "SELECT limits FROM llm_model_policy WHERE name=$1",
            [input.name],
          )
        ).rows[0];
        const limit = saved?.limits ?? {};
        if (limit.tokensPerMinute && tokens > limit.tokensPerMinute)
          throw new Error(
            "1要求のトークン予約がモデルの1分の利用枠を超えます。入力・出力上限か利用枠を確認してください",
          );
        await client.query(
          "DELETE FROM llm_model_use WHERE scope=$1 AND created_at<=clock_timestamp()-interval '1 minute' AND (active_until IS NULL OR active_until<=clock_timestamp())",
          [scope],
        );
        const row = (
          await client.query<{
            active: string;
            requests: string;
            tokens: string;
          }>(
            `SELECT count(*) FILTER(WHERE active_until>clock_timestamp()) AS active,
           count(*) FILTER(WHERE created_at>clock_timestamp()-interval '1 minute') AS requests,
           coalesce(sum(tokens) FILTER(WHERE created_at>clock_timestamp()-interval '1 minute'),0)::text AS tokens
           FROM llm_model_use WHERE scope=$1`,
            [scope],
          )
        ).rows[0]!;
        admitted =
          (limit.concurrency === undefined ||
            Number(row.active) < limit.concurrency) &&
          (limit.requestsPerMinute === undefined ||
            Number(row.requests) < limit.requestsPerMinute) &&
          (limit.tokensPerMinute === undefined ||
            Number(row.tokens) + tokens <= limit.tokensPerMinute);
        if (admitted)
          await client.query(
            "INSERT INTO llm_model_use(id,scope,tokens,active_until) VALUES($1,$2,$3,clock_timestamp()+interval '4 minutes')",
            [id, scope, tokens],
          );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      if (admitted) break;
      await delay(250);
    }
    let sent = false,
      used = tokens;
    try {
      return await work({
        sent: () => {
          sent = true;
        },
        used: (value) => {
          used = value;
        },
      });
    } finally {
      if (sent)
        await this.pool.query(
          "UPDATE llm_model_use SET tokens=$2,active_until=NULL WHERE id=$1",
          [id, used],
        );
      else await this.pool.query("DELETE FROM llm_model_use WHERE id=$1", [id]);
    }
  }
}
