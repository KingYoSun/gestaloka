import type pg from "pg";

export class WorldBudget {
  static async setup(pool: Pick<pg.Pool, "query">) {
    await pool.query(`CREATE TABLE IF NOT EXISTS world_budget (
      world_id uuid PRIMARY KEY,limit_nano bigint NOT NULL,used_nano bigint NOT NULL DEFAULT 0,
      since timestamptz NOT NULL DEFAULT clock_timestamp(),includes_initial boolean NOT NULL DEFAULT false,
      version integer NOT NULL DEFAULT 1,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now());`);
  }
  static async read(database: Pick<pg.Pool, "query">, worldId: string) {
    const row = (
      await database.query("SELECT * FROM world_budget WHERE world_id=$1", [
        worldId,
      ])
    ).rows[0];
    return row
      ? {
          limitUsd: Number(row.limit_nano) / 1_000_000_000,
          upperCostUsd: Number(row.used_nano) / 1_000_000_000,
          version: row.version,
          since: row.since.toISOString(),
          historyScope: row.includes_initial ? "all" : "sinceBudgetConfigured",
          updatedBy: row.updated_by,
          updatedAt: row.updated_at.toISOString(),
        }
      : {
          limitUsd: null,
          upperCostUsd: null,
          version: 0,
          since: null,
          historyScope: "beforeBudgetConfigured",
          updatedBy: null,
          updatedAt: null,
        };
  }
  static async create(
    database: Pick<pg.Pool, "query">,
    worldId: string,
    usd: number,
  ) {
    await database.query(
      "INSERT INTO world_budget(world_id,limit_nano,includes_initial) VALUES($1,$2,true)",
      [worldId, Math.round(usd * 1_000_000_000)],
    );
  }
}
