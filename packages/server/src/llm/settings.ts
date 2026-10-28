import { seal, unseal } from "../secrets.js";
import type pg from "pg";
import {
  ModelConfiguration,
  ModelProvider,
  ModelSetting,
} from "@gestaloka/contracts";
import type { z } from "zod";
import { settings, llmApiKey } from "./config.js";

type Configuration = z.infer<typeof ModelConfiguration>;
type Provider = z.infer<typeof ModelProvider>;
type Database = Pick<pg.Pool, "query">;
const snapshot = (row: SettingsSnapshot | undefined) =>
  row && {
    ...row,
    configuration: {
      ...row.configuration,
      default: ModelSetting.strip().parse(row.configuration.default),
      resolution: ModelSetting.strip().parse(row.configuration.resolution),
    },
  };
export type SettingsSnapshot = {
  version: number;
  configuration: Configuration;
  billingVersion?: number;
};
export class ModelCheckFailed extends Error {}

export class ModelSettings {
  constructor(
    readonly pool: pg.Pool,
    readonly master: string,
    readonly transport: typeof fetch = fetch,
  ) {}
  static async setup(db: Database) {
    await db.query(`CREATE TABLE IF NOT EXISTS llm_settings(version integer PRIMARY KEY,configuration jsonb NOT NULL,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS llm_credential(provider text PRIMARY KEY,cipher text NOT NULL,version integer NOT NULL DEFAULT 1,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS llm_response_settings(id uuid PRIMARY KEY,version integer NOT NULL REFERENCES llm_settings(version));
      ALTER TABLE llm_response_settings ADD COLUMN IF NOT EXISTS billing_version integer NOT NULL DEFAULT 1;`);
  }
  static environment(
    config: Configuration,
    billingVersion = 3,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      LLM_RESOLUTION_JUDGMENT: config.judgment,
      LLM_CACHE_BILLING: billingVersion === 1 ? "legacy" : "split",
      LLM_OPENAI_CACHE_BILLING: billingVersion >= 3 ? "split" : "legacy",
    };
    for (const role of ["default", "resolution"] as const) {
      const m = config[role],
        prefix = role === "default" ? "LLM_" : "LLM_RESOLUTION_";
      for (const [key, value] of Object.entries({
        MODEL: m.model,
        PROVIDER: m.provider,
        BASE_URL: m.baseUrl,
        API: m.api,
        REASONING_EFFORT: m.effort,
        INITIAL_REASONING_EFFORT: m.initialEffort,
        CONTEXT_TOKENS: m.contextTokens,
        MAX_OUTPUT_TOKENS: m.maxOutputTokens,
        INPUT_USD_PER_MILLION: m.inputUsdPerMillion,
        CACHED_INPUT_USD_PER_MILLION: m.cachedInputUsdPerMillion,
        OUTPUT_USD_PER_MILLION: m.outputUsdPerMillion,
        CACHE_WRITE_5M_USD_PER_MILLION:
          m.cacheWrite5mUsdPerMillion ?? m.inputUsdPerMillion * 1.25,
        CACHE_WRITE_1H_USD_PER_MILLION:
          m.cacheWrite1hUsdPerMillion ?? m.inputUsdPerMillion * 2,
        CACHE_WRITE_30M_USD_PER_MILLION:
          m.cacheWrite30mUsdPerMillion ?? m.inputUsdPerMillion * 1.25,
        CACHE_WRITE_12H_USD_PER_MILLION:
          m.cacheWrite12hUsdPerMillion ?? m.inputUsdPerMillion * 2.5,
        PRICING_DATE: m.pricingDate,
      }))
        if (value !== undefined) env[prefix + key] = String(value);
      env[`${m.provider.toUpperCase()}_API_KEY`] = "stored-credential";
      if (role === "default") {
        env[`${m.provider.toUpperCase()}_REASONING_EFFORT`] = m.effort;
        env[`${m.provider.toUpperCase()}_INITIAL_REASONING_EFFORT`] =
          m.initialEffort;
      }
    }
    return env;
  }
  async #credential(provider: Provider, db: Database = this.pool) {
    const row = (
      await db.query<{ cipher: string; version: number }>(
        "SELECT cipher,version FROM llm_credential WHERE provider=$1",
        [provider],
      )
    ).rows[0];
    if (!row) return undefined;

    return {
      version: row.version,
      value: unseal(
        this.master,
        "gestaloka.llm-credentials.v1",
        provider,
        row.cipher,
      ),
    };
  }
  async secret(provider: Provider, db: Database = this.pool) {
    return (await this.#credential(provider, db))?.value;
  }
  async latest(
    db: Database = this.pool,
  ): Promise<SettingsSnapshot | undefined> {
    return snapshot(
      (
        await db.query<SettingsSnapshot>(
          "SELECT version,configuration FROM llm_settings ORDER BY version DESC LIMIT 1",
        )
      ).rows[0],
    );
  }
  async read(db: Database = this.pool) {
    const row = await this.latest(db);
    const metadata = (
      await db.query(
        "SELECT updated_by,updated_at FROM llm_settings WHERE version=$1",
        [row?.version ?? 0],
      )
    ).rows[0];
    const credentials = (
      await db.query(
        'SELECT provider,version,updated_by AS "updatedBy",updated_at AS "updatedAt" FROM llm_credential ORDER BY provider',
      )
    ).rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
    return {
      ...(row ?? { version: 0, configuration: null }),
      updatedBy: metadata?.updated_by ?? null,
      updatedAt: metadata?.updated_at.toISOString() ?? null,
      credentials,
    };
  }
  async capture(id: string, db: Database = this.pool, version?: number) {
    await db.query(
      `INSERT INTO llm_response_settings(id,version,billing_version) SELECT $1,version,3 FROM llm_settings WHERE ($2::int IS NULL OR version=$2) ORDER BY version DESC LIMIT 1 ON CONFLICT(id) DO NOTHING`,
      [id, version ?? null],
    );
    return snapshot(
      (
        await db.query<SettingsSnapshot>(
          'SELECT c.version,c.configuration,s.billing_version AS "billingVersion" FROM llm_settings c JOIN llm_response_settings s ON s.version=c.version WHERE s.id=$1',
          [id],
        )
      ).rows[0],
    );
  }
  async verify(
    configuration: Configuration,
    replacement?: { provider: Provider; value: string },
  ) {
    const env = ModelSettings.environment(configuration);
    for (const role of ["default", "resolution"] as const) settings(env, role);
    const checked = new Set<string>();
    const credentials = new Map<Provider, { value: string; version: number }>();
    for (const m of [configuration.default, configuration.resolution]) {
      if (replacement && replacement.provider !== m.provider) continue;
      const name = `${m.provider}:${m.baseUrl}:${m.model}`;
      if (checked.has(name)) continue;
      checked.add(name);
      if (!replacement && !credentials.has(m.provider)) {
        const entry = await this.#credential(m.provider);
        if (entry) credentials.set(m.provider, entry);
      }
      const key =
        replacement?.provider === m.provider
          ? replacement.value
          : credentials.get(m.provider)?.value;
      if (!key)
        throw new ModelCheckFailed(
          `${m.provider}のAPIキーを先に設定してください`,
        );
      const response = await this.transport(
        `${m.baseUrl.replace(/\/+$/, "")}/models`,
        {
          headers:
            m.provider === "anthropic"
              ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
              : { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok)
        throw new ModelCheckFailed(
          `モデル接続の確認に失敗しました: HTTP ${response.status}`,
        );
      const body = (await response.json()) as { data?: { id: string }[] };
      if (
        !body.data?.some(
          (v) =>
            v.id === m.model ||
            (m.provider === "gemini" && v.id === `models/${m.model}`),
        )
      )
        throw new ModelCheckFailed(
          "指定したAPI識別子をモデル一覧で確認できません",
        );
    }
    return Object.fromEntries(
      [...credentials].map(([provider, entry]) => [provider, entry.version]),
    );
  }
  async unchanged(
    db: Database,
    dependencies: {
      configurationVersion?: number;
      credentials: Record<string, number>;
    },
  ) {
    if (
      dependencies.configurationVersion !== undefined &&
      ((await this.latest(db))?.version ?? 0) !==
        dependencies.configurationVersion
    )
      return false;
    const rows = (
      await db.query<{ provider: string; version: number }>(
        "SELECT provider,version FROM llm_credential WHERE provider=ANY($1)",
        [Object.keys(dependencies.credentials)],
      )
    ).rows;
    return (
      rows.length === Object.keys(dependencies.credentials).length &&
      rows.every(
        (row) => dependencies.credentials[row.provider] === row.version,
      )
    );
  }
  async put(
    db: Database,
    configuration: Configuration,
    expectedVersion: number,
    actor: string | null,
  ) {
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':llm_settings',0))",
    );
    const previous = await this.latest(db);
    if ((previous?.version ?? 0) !== expectedVersion) return undefined;
    const row = (
      await db.query<SettingsSnapshot>(
        "INSERT INTO llm_settings(version,configuration,updated_by) VALUES($1,$2,$3) RETURNING version,configuration",
        [expectedVersion + 1, JSON.stringify(configuration), actor],
      )
    ).rows[0]!;
    return { ...row, previous: previous?.configuration ?? null };
  }
  async putSecret(
    db: Database,
    provider: Provider,
    value: string,
    expectedVersion: number,
    actor: string | null,
  ) {
    const cipher = seal(
      this.master,
      "gestaloka.llm-credentials.v1",
      provider,
      value,
    );
    const row =
      (
        await db.query(
          `INSERT INTO llm_credential(provider,cipher,updated_by) SELECT $1,$2,$3 WHERE $4::int=0 ON CONFLICT(provider) DO NOTHING RETURNING provider,version`,
          [provider, cipher, actor, expectedVersion],
        )
      ).rows[0] ??
      (
        await db.query(
          "UPDATE llm_credential SET cipher=$2,version=version+1,updated_by=$3,updated_at=now() WHERE provider=$1 AND version=$4 AND $4>0 RETURNING provider,version",
          [provider, cipher, actor, expectedVersion],
        )
      ).rows[0];
    return row;
  }
  async initialize(env: NodeJS.ProcessEnv) {
    if (
      (await this.latest()) ||
      !llmApiKey(env) ||
      (await this.pool.query("SELECT provider FROM llm_credential LIMIT 1"))
        .rowCount
    )
      return;
    const entry = (
      role: "default" | "resolution",
    ): z.infer<typeof ModelSetting> => {
      const s = settings(env, role);
      return {
        provider: s.provider,
        model: s.model,
        api: s.api,
        baseUrl: s.baseUrl,
        effort: s.effort,
        initialEffort: s.initialEffort,
        contextTokens: s.context,
        maxOutputTokens: s.maxOutput,
        inputUsdPerMillion: s.inputMiss / 1000,
        cachedInputUsdPerMillion: s.inputHit / 1000,
        outputUsdPerMillion: s.output / 1000,
        ...(s.cacheWrite5m === undefined
          ? {}
          : {
              cacheWrite5mUsdPerMillion: s.cacheWrite5m / 1000,
              cacheWrite1hUsdPerMillion: s.cacheWrite1h! / 1000,
            }),
        pricingDate: s.pricingDate,
        ...(s.cacheWrite30m === undefined
          ? {}
          : {
              cacheWrite30mUsdPerMillion: s.cacheWrite30m / 1000,
              cacheWrite12hUsdPerMillion: s.cacheWrite12h! / 1000,
            }),
      };
    };
    const configuration = {
      default: entry("default"),
      resolution: entry("resolution"),
      judgment: settings(env).judgment,
    };
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const created = await this.put(db, configuration, 0, null);
      if (created)
        for (const provider of ModelProvider.options) {
          const value = env[`${provider.toUpperCase()}_API_KEY`];
          if (value) await this.putSecret(db, provider, value, 0, null);
        }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
}
