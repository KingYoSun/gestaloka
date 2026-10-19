import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { BudgetLedger, NANO_USD, type SavedCompletion } from "./budget.js";

export { BudgetLedger, BudgetUnavailable } from "./budget.js";
export const MODEL_VERSION = "DeepSeek-V4.1-Flash-1017";
const Model = z.enum(["deepseek-flash", "gemini-3.8-flash", "gpt-6-luna"]);
// USD upper estimates in nanodollars/token, checked against official pricing on 2026-10-19.
const profiles = {
  "deepseek-flash": {
    prefix: "DEEPSEEK",
    baseUrl: "https://api.deepseek.com",
    version: MODEL_VERSION,
    context: 1_048_576,
    maxOutput: 393216,
    inputMiss: 300,
    inputHit: 6,
    output: 1200,
  },
  "gemini-3.8-flash": {
    prefix: "GEMINI",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    version: "Gemini 3.8 Flash",
    context: 1_048_576,
    maxOutput: 65536,
    inputMiss: 1500,
    inputHit: 150,
    output: 7500,
  },
  "gpt-6-luna": {
    prefix: "OPENAI",
    baseUrl: "https://api.openai.com/v1",
    version: "GPT-6 Luna",
    context: 1_050_000,
    maxOutput: 128000,
    inputMiss: 250,
    inputHit: 250,
    output: 750,
  },
} as const;
const selectedModel = (env: NodeJS.ProcessEnv) =>
  Model.parse(env.LLM_MODEL ?? env.DEEPSEEK_MODEL ?? "deepseek-flash");
export function llmApiKey(env: NodeJS.ProcessEnv = process.env) {
  return env[`${profiles[selectedModel(env)].prefix}_API_KEY`];
}
const Effort = z.enum(["none", "low", "medium", "high", "xhigh", "max"]);
function settings(env: NodeJS.ProcessEnv) {
  const model = selectedModel(env),
    profile = profiles[model];
  const defaults = model === "deepseek-flash" ? "high" : "low";
  const result = z
    .object({
      apiKey: z.string().min(1),
      baseUrl: z.url(),
      model: Model,
      effort: Effort,
      initialEffort: Effort,
      maxOutput: z.coerce.number().int().positive().max(profile.maxOutput),
      budgetId: z.string().min(1),
      budgetUsd: z.coerce.number().positive().max(40),
    })
    .parse({
      apiKey: llmApiKey(env),
      baseUrl: env[`${profile.prefix}_BASE_URL`] ?? profile.baseUrl,
      model,
      effort:
        env[`${profile.prefix}_REASONING_EFFORT`] ??
        env.LLM_REASONING_EFFORT ??
        defaults,
      initialEffort:
        env[`${profile.prefix}_INITIAL_REASONING_EFFORT`] ??
        env.LLM_INITIAL_REASONING_EFFORT ??
        defaults,
      maxOutput: env.LLM_MAX_OUTPUT_TOKENS ?? 16384,
      budgetId: env.LLM_BUDGET_ID ?? "deepseek-v4.1-flash-1017-evaluation",
      budgetUsd: env.LLM_BUDGET_USD ?? 40,
    });
  const efforts: readonly string[] =
    model === "gemini-3.8-flash"
      ? ["low", "medium", "high"]
      : model === "deepseek-flash"
        ? ["none", "low", "high", "max"]
        : ["none", "low", "medium", "high", "xhigh", "max"];
  if (
    ![result.effort, result.initialEffort].every((value) =>
      efforts.includes(value),
    )
  )
    throw new Error("選択したモデルが推論量の設定に対応していません");
  return { ...result, baseUrl: result.baseUrl.replace(/\/+$/, "") };
}

const TokenCount = z.number().int().nonnegative().safe();
const Response = z.object({
  id: z.string(),
  model: z.string(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .length(1),
  usage: z.object({
    prompt_tokens: TokenCount,
    completion_tokens: TokenCount,
    total_tokens: TokenCount.optional(),
    prompt_cache_hit_tokens: TokenCount.optional(),
    prompt_cache_miss_tokens: TokenCount.optional(),
    prompt_tokens_details: z
      .object({ cached_tokens: TokenCount.optional() })
      .nullish(),
  }),
});
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
type Connection = Pick<
  (typeof profiles)[keyof typeof profiles],
  "context" | "inputMiss" | "inputHit" | "output"
> & { baseUrl: string };
type StoredInput = {
  requestedVersion: string;
  pricingDate: string;
  connection?: Connection;
  request: {
    model: z.infer<typeof Model>;
    reasoning_effort: string;
    max_tokens?: number;
    max_completion_tokens?: number;
    service_tier?: "default";
  };
};

export class LlmClient {
  readonly settings: ReturnType<typeof settings>;
  readonly ledger: BudgetLedger;
  constructor(
    pool: pg.Pool,
    environment: NodeJS.ProcessEnv = process.env,
    readonly transport: typeof fetch = fetch,
  ) {
    this.settings = settings(environment);
    this.ledger = new BudgetLedger(
      pool,
      this.settings.budgetId,
      Math.round(this.settings.budgetUsd * NANO_USD),
    );
  }
  get requestedVersion() {
    return profiles[this.settings.model].version;
  }
  async verifyModel() {
    const response = await this.transport(`${this.settings.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.settings.apiKey}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`モデル一覧を取得できません: HTTP ${response.status}`);
    const body = z
      .object({ data: z.array(z.object({ id: z.string() })) })
      .parse(await response.json());
    if (
      !body.data.some(
        (model) =>
          model.id === this.settings.model ||
          (this.settings.model === "gemini-3.8-flash" &&
            model.id === `models/${this.settings.model}`),
      )
    )
      throw new Error("指定モデルのAPI識別子が利用できません");
    return {
      requestedVersion: this.requestedVersion,
      apiModel: this.settings.model,
    };
  }
  async complete(
    id: string,
    role: string,
    messages: ChatMessage[],
  ): Promise<SavedCompletion> {
    z.uuid().parse(id);
    const previous = (await this.ledger.input(id)) as StoredInput | undefined;
    const model = previous?.request.model ?? this.settings.model;
    const profile = profiles[model];
    const maxOutput =
      previous?.request.max_completion_tokens ??
      previous?.request.max_tokens ??
      this.settings.maxOutput;
    const request = {
      model,
      messages,
      response_format: { type: "json_object" },
      reasoning_effort:
        previous?.request.reasoning_effort ??
        (role === "initial-generation"
          ? this.settings.initialEffort
          : this.settings.effort),
      ...(model === "gpt-6-luna"
        ? { max_completion_tokens: maxOutput }
        : { max_tokens: maxOutput }),
      stream: false,
      ...(model === "gpt-6-luna" ? { service_tier: "default" } : {}),
    };
    const connection = {
      baseUrl: previous?.connection?.baseUrl ?? this.settings.baseUrl,
      context: previous?.connection?.context ?? profile.context,
      inputMiss: previous?.connection?.inputMiss ?? profile.inputMiss,
      inputHit: previous?.connection?.inputHit ?? profile.inputHit,
      output: previous?.connection?.output ?? profile.output,
    };
    const stored = {
      role,
      requestedVersion: previous?.requestedVersion ?? profile.version,
      pricingDate: previous?.pricingDate ?? "2026-10-19",
      request,
      // Existing DeepSeek records retain their exact hash shape; new records freeze endpoint and rates as well.
      ...(previous && !previous.connection ? {} : { connection }),
    };
    const hash = createHash("sha256")
      .update(JSON.stringify(stored))
      .digest("hex");
    const cached = await this.ledger.reserve(
      id,
      hash,
      connection.context * connection.inputMiss + maxOutput * connection.output,
      stored,
    );
    if (cached) return cached;
    const started = performance.now();
    const response = await this.transport(
      `${connection.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(180000),
      },
    );
    if (!response.ok)
      throw new Error(
        `LLM要求の結果を確定できません: HTTP ${response.status}。予約枠は保持します`,
      );
    const result = Response.parse(await response.json());
    const raw = result.usage;
    if (
      (model !== "deepseek-flash" && raw.total_tokens === undefined) ||
      (raw.total_tokens !== undefined &&
        raw.total_tokens < raw.prompt_tokens + raw.completion_tokens)
    )
      throw new Error("LLMの総使用量を確認できません。予約枠は保持します");
    const hit =
      raw.prompt_cache_hit_tokens ??
      raw.prompt_tokens_details?.cached_tokens ??
      0;
    const miss = raw.prompt_cache_miss_tokens ?? raw.prompt_tokens - hit;
    const output = Math.max(
      raw.completion_tokens,
      (raw.total_tokens ?? 0) - raw.prompt_tokens,
    );
    if (hit + miss !== raw.prompt_tokens || miss < 0 || hit > raw.prompt_tokens)
      throw new Error("LLMの使用量内訳が整合しません。予約枠は保持します");
    const completion: SavedCompletion = {
      id: result.id,
      model: result.model,
      content: result.choices[0]!.message.content ?? "",
      finishReason: result.choices[0]!.finish_reason,
      usage: {
        prompt_tokens: raw.prompt_tokens,
        completion_tokens: output,
        prompt_cache_hit_tokens: hit,
        prompt_cache_miss_tokens: miss,
      },
    };
    await this.ledger.settle(
      id,
      hit * connection.inputHit +
        miss * connection.inputMiss +
        output * connection.output,
      completion,
      Math.round(performance.now() - started),
    );
    return completion;
  }
}
export { LlmClient as DeepSeekClient };
