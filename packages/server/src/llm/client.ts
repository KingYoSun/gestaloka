import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { BudgetLedger, NANO_USD, type SavedCompletion } from "./budget.js";
import { ModelLimits } from "./limits.js";
import {
  settings,
  providerFor,
  profiles,
  type Provider,
  type Api,
  type LlmTarget,
} from "./config.js";
export { BudgetLedger, BudgetUnavailable } from "./budget.js";
export { MODEL_VERSION, llmApiKey, type LlmTarget } from "./config.js";
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type Connection = {
  baseUrl: string;
  context: number;
  inputMiss: number;
  inputHit: number;
  output: number;
  provider?: Provider;
  api?: Api;
};
type StoredRequest = {
  model: string;
  reasoning_effort?: string;
  max_tokens?: number;
  max_completion_tokens?: number;
  max_output_tokens?: number;
  reasoning?: { effort: string };
  output_config?: { effort?: string };
  thinking?: { type: string };
};
type StoredInput = {
  role: string;
  requestedVersion: string;
  pricingDate: string;
  connection?: Connection;
  request: StoredRequest;
};
const count = z.number().int().nonnegative().safe();
const ChatResponse = z.object({
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
    prompt_tokens: count,
    completion_tokens: count,
    total_tokens: count.optional(),
    prompt_cache_hit_tokens: count.optional(),
    prompt_cache_miss_tokens: count.optional(),
    prompt_tokens_details: z
      .object({ cached_tokens: count.optional() })
      .nullish(),
  }),
});
export const MessageUsage = z.object({
  input_tokens: count,
  output_tokens: count,
  cache_creation_input_tokens: count.optional(),
  cache_read_input_tokens: count.optional(),
});
export function messageUsage(
  input: z.infer<typeof MessageUsage>,
): SavedCompletion["usage"] {
  const miss = input.input_tokens + (input.cache_creation_input_tokens ?? 0),
    hit = input.cache_read_input_tokens ?? 0;
  return {
    prompt_tokens: miss + hit,
    completion_tokens: input.output_tokens,
    prompt_cache_hit_tokens: hit,
    prompt_cache_miss_tokens: miss,
  };
}
const MessageResponse = z.object({
  id: z.string(),
  model: z.string(),
  stop_reason: z.string().nullable(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: MessageUsage,
});
const ResponsesResponse = z.object({
  id: z.string(),
  model: z.string(),
  status: z.string(),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .optional(),
    }),
  ),
  usage: z.object({
    input_tokens: count,
    output_tokens: count,
    input_tokens_details: z
      .object({ cached_tokens: count.optional() })
      .optional(),
  }),
});
export class LlmClient {
  readonly settings: ReturnType<typeof settings>;
  readonly environment: NodeJS.ProcessEnv;
  readonly ledger: BudgetLedger;
  readonly limits: ModelLimits;
  constructor(
    pool: pg.Pool,
    environment: NodeJS.ProcessEnv = process.env,
    readonly transport: typeof fetch = fetch,
  ) {
    this.environment = { ...environment };
    this.settings = settings(this.environment);
    this.limits = new ModelLimits(pool, environment.LLM_MODEL_LIMITS || "{}");
    this.ledger = new BudgetLedger(
      pool,
      this.settings.budgetId,
      Math.round(this.settings.budgetUsd * NANO_USD),
      this.limits,
    );
  }
  settingsFor(target: LlmTarget = "default") {
    return target === "default"
      ? this.settings
      : settings(this.environment, target);
  }
  get requestedVersion() {
    return this.settings.version;
  }
  headers(provider: Provider) {
    const key = this.environment[`${provider.toUpperCase()}_API_KEY`];
    if (!key) throw new Error(`${provider}のAPIキーを設定してください`);
    return provider === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${key}` };
  }
  async verifyModel(target: LlmTarget = "default") {
    const config = this.settingsFor(target);
    const response = await this.transport(`${config.baseUrl}/models`, {
      headers: this.headers(config.provider),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(`モデル一覧を取得できません: HTTP ${response.status}`);
    const body = z
      .object({ data: z.array(z.object({ id: z.string() })) })
      .parse(await response.json());
    if (
      !body.data.some(
        (item) =>
          item.id === config.model ||
          (config.provider === "gemini" &&
            item.id === `models/${config.model}`),
      )
    )
      throw new Error("指定モデルのAPI識別子が利用できません");
    return { requestedVersion: config.version, apiModel: config.model };
  }
  async complete(
    id: string,
    role: string,
    messages: ChatMessage[],
    target: LlmTarget = "default",
  ): Promise<SavedCompletion> {
    z.uuid().parse(id);
    const previous = (await this.ledger.input(id)) as StoredInput | undefined;
    const selected = previous ? this.settings : this.settingsFor(target);
    const model = previous?.request.model ?? selected.model;
    const provider = previous
      ? (previous.connection?.provider ?? providerFor(model))
      : selected.provider;
    const api = previous
      ? (previous.connection?.api ?? "chat-completions")
      : selected.api;
    const maxOutput =
      previous?.request.max_completion_tokens ??
      previous?.request.max_tokens ??
      previous?.request.max_output_tokens ??
      selected.maxOutput;
    const effort =
      previous?.request.reasoning_effort ??
      previous?.request.reasoning?.effort ??
      previous?.request.output_config?.effort ??
      (previous?.request.thinking?.type === "disabled" ? "none" : undefined) ??
      (role === "initial-generation"
        ? selected.initialEffort
        : selected.effort);
    const request =
      api === "messages"
        ? {
            model,
            system: messages
              .filter((m) => m.role === "system")
              .map((m) => m.content)
              .join("\n\n"),
            messages: messages.filter((m) => m.role !== "system"),
            max_tokens: maxOutput,
            thinking: { type: effort === "none" ? "disabled" : "adaptive" },
            output_config: effort === "none" ? {} : { effort },
            stream: false,
          }
        : api === "responses"
          ? {
              model,
              input: messages,
              text: { format: { type: "json_object" } },
              reasoning: { effort },
              max_output_tokens: maxOutput,
              store: false,
              stream: false,
              service_tier: "default",
            }
          : {
              model,
              messages,
              response_format: { type: "json_object" },
              reasoning_effort: effort,
              ...(provider === "openai"
                ? { max_completion_tokens: maxOutput }
                : { max_tokens: maxOutput }),
              stream: false,
              ...(provider === "openai" ? { service_tier: "default" } : {}),
            };
    const known = profiles[model];
    const connection: Connection = previous?.connection
      ? {
          baseUrl: previous.connection.baseUrl,
          context: previous.connection.context,
          inputMiss: previous.connection.inputMiss,
          inputHit: previous.connection.inputHit,
          output: previous.connection.output,
          ...(previous.connection.provider
            ? { provider: previous.connection.provider }
            : {}),
          ...(previous.connection.api ? { api: previous.connection.api } : {}),
        }
      : {
          baseUrl: selected.baseUrl,
          context: previous ? known!.context : selected.context,
          inputMiss: previous ? known!.inputMiss : selected.inputMiss,
          inputHit: previous ? known!.inputHit : selected.inputHit,
          output: previous ? known!.output : selected.output,
          provider,
          api,
        };
    const stored = {
      role,
      requestedVersion: previous?.requestedVersion ?? selected.version,
      pricingDate: previous?.pricingDate ?? "2026-10-20",
      request,
      ...(previous && !previous.connection ? {} : { connection }),
    };
    const hash = createHash("sha256")
      .update(JSON.stringify(stored))
      .digest("hex");
    return this.limits.run(
      {
        name: `${provider}:${model}`,
        key: this.environment[`${provider.toUpperCase()}_API_KEY`]!,
        request,
        maxOutput,
        cached: !!previous,
      },
      async (quota) => {
        const cached = await this.ledger.reserve(
          id,
          hash,
          connection.context * connection.inputMiss +
            maxOutput * connection.output,
          stored,
        );
        if (cached) return cached;
        const started = performance.now();
        const path =
          api === "messages"
            ? "messages"
            : api === "responses"
              ? "responses"
              : "chat/completions";
        quota.sent();
        const response = await this.transport(`${connection.baseUrl}/${path}`, {
          method: "POST",
          headers: {
            ...this.headers(provider),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(180000),
        });
        if (!response.ok)
          throw new Error(
            `LLM要求の結果を確定できません: HTTP ${response.status}。予約枠は保持します`,
          );
        const raw: unknown = await response.json();
        let completion: SavedCompletion;
        if (api === "messages") {
          const result = MessageResponse.parse(raw);
          completion = {
            id: result.id,
            model: result.model,
            content: result.content
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join(""),
            finishReason:
              result.stop_reason === "end_turn"
                ? "stop"
                : (result.stop_reason ?? "incomplete"),
            usage: messageUsage(result.usage),
          };
        } else if (api === "responses") {
          const result = ResponsesResponse.parse(raw),
            hit = result.usage.input_tokens_details?.cached_tokens ?? 0;
          completion = {
            id: result.id,
            model: result.model,
            content: result.output
              .filter((o) => o.type === "message")
              .flatMap((o) => o.content ?? [])
              .filter((c) => c.type === "output_text")
              .map((c) => c.text ?? "")
              .join(""),
            finishReason:
              result.status === "completed" ? "stop" : result.status,
            usage: {
              prompt_tokens: result.usage.input_tokens,
              completion_tokens: result.usage.output_tokens,
              prompt_cache_hit_tokens: hit,
              prompt_cache_miss_tokens: result.usage.input_tokens - hit,
            },
          };
        } else {
          const result = ChatResponse.parse(raw),
            usage = result.usage;
          if (
            (provider !== "deepseek" && usage.total_tokens === undefined) ||
            (usage.total_tokens !== undefined &&
              usage.total_tokens <
                usage.prompt_tokens + usage.completion_tokens)
          )
            throw new Error(
              "LLMの総使用量を確認できません。予約枠は保持します",
            );
          const hit =
            usage.prompt_cache_hit_tokens ??
            usage.prompt_tokens_details?.cached_tokens ??
            0;
          completion = {
            id: result.id,
            model: result.model,
            content: result.choices[0]!.message.content ?? "",
            finishReason: result.choices[0]!.finish_reason,
            usage: {
              prompt_tokens: usage.prompt_tokens,
              completion_tokens: Math.max(
                usage.completion_tokens,
                (usage.total_tokens ?? 0) - usage.prompt_tokens,
              ),
              prompt_cache_hit_tokens: hit,
              prompt_cache_miss_tokens:
                usage.prompt_cache_miss_tokens ?? usage.prompt_tokens - hit,
            },
          };
        }
        const usage = completion.usage;
        quota.used(usage.prompt_tokens + usage.completion_tokens);
        if (
          usage.prompt_cache_hit_tokens + usage.prompt_cache_miss_tokens !==
            usage.prompt_tokens ||
          usage.prompt_cache_miss_tokens < 0 ||
          usage.prompt_cache_hit_tokens > usage.prompt_tokens
        )
          throw new Error("LLMの使用量内訳が整合しません。予約枠は保持します");
        await this.ledger.settle(
          id,
          usage.prompt_cache_hit_tokens * connection.inputHit +
            usage.prompt_cache_miss_tokens * connection.inputMiss +
            usage.completion_tokens * connection.output,
          completion,
          Math.round(performance.now() - started),
        );
        return completion;
      },
    );
  }
}
export { LlmClient as DeepSeekClient };
