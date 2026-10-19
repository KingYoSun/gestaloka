import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { BudgetLedger, NANO_USD, type SavedCompletion } from "./budget.js";

export { BudgetLedger, BudgetUnavailable } from "./budget.js";
const TokenCount = z.number().int().nonnegative().safe();
const Response = z.object({
  id: z.string(),
  model: z.string(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({ content: z.string() }),
      }),
    )
    .length(1),
  usage: z.object({
    prompt_tokens: TokenCount,
    completion_tokens: TokenCount,
    prompt_cache_hit_tokens: TokenCount,
    prompt_cache_miss_tokens: TokenCount,
  }),
});
export const DeepSeekSettings = z.object({
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_BASE_URL: z
    .literal("https://api.deepseek.com")
    .default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.literal("deepseek-flash").default("deepseek-flash"),
  LLM_BUDGET_ID: z
    .string()
    .min(1)
    .default("deepseek-v4.1-flash-1017-evaluation"),
  LLM_BUDGET_USD: z.coerce.number().positive().max(40).default(40),
  LLM_REASONING_EFFORT: z.enum(["none", "low", "high", "max"]).default("high"),
  LLM_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(1)
    .max(393216)
    .default(16384),
});
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// Peak rates checked on 2026-10-19; integer nanodollars per token.
const INPUT_MISS = 300,
  INPUT_HIT = 6,
  OUTPUT = 1200;
export const MODEL_VERSION = "DeepSeek-V4.1-Flash-1017";

export class DeepSeekClient {
  readonly settings: z.infer<typeof DeepSeekSettings>;
  readonly ledger: BudgetLedger;
  constructor(
    pool: pg.Pool,
    environment: NodeJS.ProcessEnv = process.env,
    readonly transport: typeof fetch = fetch,
  ) {
    this.settings = DeepSeekSettings.parse(environment);
    this.ledger = new BudgetLedger(
      pool,
      this.settings.LLM_BUDGET_ID,
      Math.round(this.settings.LLM_BUDGET_USD * NANO_USD),
    );
  }

  async verifyModel() {
    const response = await this.transport(
      `${this.settings.DEEPSEEK_BASE_URL}/models`,
      {
        headers: { Authorization: `Bearer ${this.settings.DEEPSEEK_API_KEY}` },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new Error(
        `DeepSeekのモデル一覧を取得できません: HTTP ${response.status}`,
      );
    const body = z
      .object({ data: z.array(z.object({ id: z.string() })) })
      .parse(await response.json());
    if (!body.data.some((model) => model.id === this.settings.DEEPSEEK_MODEL))
      throw new Error("指定モデルのAPI識別子が利用できません");
    return {
      requestedVersion: MODEL_VERSION,
      apiModel: this.settings.DEEPSEEK_MODEL,
    };
  }

  async complete(
    id: string,
    role: string,
    messages: ChatMessage[],
  ): Promise<SavedCompletion> {
    z.uuid().parse(id);
    const previous = (await this.ledger.input(id)) as
      | {
          requestedVersion: string;
          pricingDate: string;
          request: {
            model: "deepseek-flash";
            reasoning_effort: string;
            max_tokens: number;
          };
        }
      | undefined;
    const request = {
      model: previous?.request?.model ?? this.settings.DEEPSEEK_MODEL,
      messages,
      response_format: { type: "json_object" },
      reasoning_effort:
        previous?.request?.reasoning_effort ??
        this.settings.LLM_REASONING_EFFORT,
      max_tokens:
        previous?.request?.max_tokens ?? this.settings.LLM_MAX_OUTPUT_TOKENS,
      stream: false,
    };
    const stored = {
      role,
      requestedVersion: previous?.requestedVersion ?? MODEL_VERSION,
      pricingDate: previous?.pricingDate ?? "2026-10-19",
      request,
    };
    const hash = createHash("sha256")
      .update(JSON.stringify(stored))
      .digest("hex");
    // Reserve the full provider context at cache-miss peak price; no tokenizer estimate can under-reserve.
    const reservation = 1_048_576 * INPUT_MISS + request.max_tokens * OUTPUT;
    const cached = await this.ledger.reserve(id, hash, reservation, stored);
    if (cached) return cached;
    const started = performance.now();
    const response = await this.transport(
      `${this.settings.DEEPSEEK_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.settings.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(180000),
      },
    );
    if (!response.ok)
      throw new Error(
        `DeepSeek要求の結果を確定できません: HTTP ${response.status}。予約枠は保持します`,
      );
    const result = Response.parse(await response.json());
    const usage = result.usage;
    if (
      usage.prompt_cache_hit_tokens + usage.prompt_cache_miss_tokens !==
      usage.prompt_tokens
    )
      throw new Error("DeepSeekの使用量内訳が整合しません。予約枠は保持します");
    const completion: SavedCompletion = {
      id: result.id,
      model: result.model,
      content: result.choices[0]!.message.content,
      finishReason: result.choices[0]!.finish_reason,
      usage,
    };
    const charge =
      usage.prompt_cache_hit_tokens * INPUT_HIT +
      usage.prompt_cache_miss_tokens * INPUT_MISS +
      usage.completion_tokens * OUTPUT;
    await this.ledger.settle(
      id,
      charge,
      completion,
      Math.round(performance.now() - started),
    );
    return completion;
  }
}
