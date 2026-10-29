import { z } from "zod";
import { ModelProvider } from "@gestaloka/contracts";

export const MODEL_VERSION = "DeepSeek-V4.1-Flash-1017";
export type LlmTarget = "default" | "resolution";
export const Provider = ModelProvider;
export type Provider = z.infer<typeof Provider>;
export type Api = "chat-completions" | "responses" | "messages";
const endpoints: Record<Provider, string> = {
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
};
export const profiles: Record<
  string,
  {
    provider: Provider;
    version: string;
    context: number;
    maxOutput: number;
    inputMiss: number;
    inputHit: number;
    output: number;
    api?: Api;
    pricingDate?: string;
    longContext?: { threshold: number; input: number; output: number };
    cacheStorage?: number;
  }
> = {
  "deepseek-flash": {
    provider: "deepseek",
    version: MODEL_VERSION,
    context: 1048576,
    maxOutput: 393216,
    inputMiss: 300,
    inputHit: 6,
    output: 1200,
  },
  "gemini-3.8-flash": {
    provider: "gemini",
    version: "Gemini 3.8 Flash",
    context: 1048576,
    maxOutput: 65536,
    inputMiss: 750,
    inputHit: 75,
    output: 3750,
    pricingDate: "2026-10-29",
    cacheStorage: 500 / 3600,
  },
  "gpt-6.1-terra": {
    provider: "openai",
    version: "GPT-6.1 Terra",
    api: "responses",
    context: 1050000,
    maxOutput: 128000,
    inputMiss: 1000,
    inputHit: 50,
    output: 5000,
    pricingDate: "2026-10-29",
    longContext: { threshold: 272000, input: 2, output: 1.5 },
  },
  "gpt-6.1-sol": {
    provider: "openai",
    version: "GPT-6.1 Sol",
    api: "responses",
    context: 1050000,
    maxOutput: 128000,
    inputMiss: 2000,
    inputHit: 100,
    output: 10000,
    pricingDate: "2026-10-29",
    longContext: { threshold: 272000, input: 2, output: 1.5 },
  },
  "gpt-6-luna": {
    provider: "openai",
    version: "GPT-6 Luna",
    context: 1050000,
    maxOutput: 128000,
    inputMiss: 250,
    inputHit: 250,
    output: 750,
  },
};
export function providerFor(model: string, explicit?: string): Provider {
  return Provider.parse(
    explicit ??
      profiles[model]?.provider ??
      (model.startsWith("claude-")
        ? "anthropic"
        : model.startsWith("gemini-")
          ? "gemini"
          : model.startsWith("gpt-")
            ? "openai"
            : model.startsWith("deepseek-")
              ? "deepseek"
              : undefined),
  );
}
const optional = (env: NodeJS.ProcessEnv, name: string) =>
  env[name] || undefined;
const selectedModel = (env: NodeJS.ProcessEnv, target: LlmTarget) =>
  z
    .string()
    .min(1)
    .parse(
      (target === "resolution"
        ? optional(env, "LLM_RESOLUTION_MODEL")
        : undefined) ??
        optional(env, "LLM_MODEL") ??
        optional(env, "DEEPSEEK_MODEL") ??
        "deepseek-flash",
    );
export function llmApiKey(
  env: NodeJS.ProcessEnv = process.env,
  target: LlmTarget = "default",
) {
  const model = selectedModel(env, target);
  const provider = providerFor(
    model,
    (target === "resolution"
      ? optional(env, "LLM_RESOLUTION_PROVIDER")
      : undefined) ??
      (model === selectedModel(env, "default")
        ? optional(env, "LLM_PROVIDER")
        : undefined),
  );
  return env[`${provider.toUpperCase()}_API_KEY`];
}
const count = z.coerce.number().int().positive().safe();
const price = z.coerce.number().nonnegative().finite();
const effort = z.enum(["none", "low", "medium", "high", "xhigh", "max"]);
export function settings(
  env: NodeJS.ProcessEnv,
  target: LlmTarget = "default",
) {
  const model = selectedModel(env, target),
    baseModel = selectedModel(env, "default");
  const same = model === baseModel;
  const get = (name: string) =>
    (target === "resolution"
      ? optional(env, `LLM_RESOLUTION_${name}`)
      : undefined) ?? (same ? optional(env, `LLM_${name}`) : undefined);
  const provider = providerFor(model, get("PROVIDER")),
    prefix = provider.toUpperCase();
  const known =
    profiles[model]?.provider === provider ? profiles[model] : undefined;
  const rate = (name: string, fallback?: number) => {
    const value = get(`${name}_USD_PER_MILLION`);
    if (value === undefined && fallback === undefined)
      throw new Error(
        `${model}の料金が未設定です: ${target === "resolution" ? "LLM_RESOLUTION" : "LLM"}_${name}_USD_PER_MILLION`,
      );
    return value === undefined
      ? fallback!
      : (["INPUT", "OUTPUT"].includes(name) ? price.positive() : price).parse(
          value,
        ) * 1000;
  };
  const context = get("CONTEXT_TOKENS") ?? known?.context;
  if (context === undefined)
    throw new Error(`${model}のCONTEXT_TOKENSを設定してください`);
  const inputMiss = rate("INPUT", known?.inputMiss);
  const cacheWrite =
    providerFor(model, get("PROVIDER")) === "anthropic" &&
    env.LLM_CACHE_BILLING !== "legacy"
      ? {
          cacheWrite5m: rate("CACHE_WRITE_5M", inputMiss * 1.25),
          cacheWrite1h: rate("CACHE_WRITE_1H", inputMiss * 2),
        }
      : provider === "openai" && env.LLM_OPENAI_CACHE_BILLING !== "legacy"
        ? {
            cacheWrite30m: rate("CACHE_WRITE_30M", inputMiss * 1.25),
            cacheWrite12h: rate("CACHE_WRITE_12H", inputMiss * 2.5),
          }
        : {};
  const api = z
    .enum(["chat-completions", "responses", "messages"])
    .parse(
      get("API") ??
        optional(env, `${prefix}_API`) ??
        known?.api ??
        (provider === "anthropic" ? "messages" : "chat-completions"),
    );
  if (
    (provider === "anthropic" && api !== "messages") ||
    (provider !== "anthropic" && api === "messages") ||
    (api === "responses" && provider !== "openai")
  )
    throw new Error("プロバイダーとAPI形式が対応していません");
  const defaults = provider === "deepseek" ? "high" : "low";
  const result = {
    provider,
    api,
    judgment: z
      .enum(["separate", "combined"])
      .parse(env.LLM_RESOLUTION_JUDGMENT ?? "separate"),
    model,
    version: known?.version ?? model,
    apiKey: z.string().min(1).parse(llmApiKey(env, target)),
    baseUrl: z
      .url()
      .parse(
        get("BASE_URL") ??
          optional(env, `${prefix}_BASE_URL`) ??
          endpoints[provider],
      )
      .replace(/\/+$/, ""),
    effort: effort.parse(
      (target === "resolution"
        ? optional(env, "LLM_RESOLUTION_REASONING_EFFORT")
        : undefined) ??
        optional(env, `${prefix}_REASONING_EFFORT`) ??
        optional(env, "LLM_REASONING_EFFORT") ??
        defaults,
    ),
    initialEffort: effort.parse(
      (target === "resolution"
        ? optional(env, "LLM_RESOLUTION_INITIAL_REASONING_EFFORT")
        : undefined) ??
        optional(env, `${prefix}_INITIAL_REASONING_EFFORT`) ??
        optional(env, "LLM_INITIAL_REASONING_EFFORT") ??
        defaults,
    ),
    context: count.parse(context),
    maxOutput: count.parse(
      get("MAX_OUTPUT_TOKENS") ?? env.LLM_MAX_OUTPUT_TOKENS ?? 16384,
    ),
    inputMiss,
    ...cacheWrite,
    ...(provider === "gemini"
      ? {
          cacheStorage:
            get("CACHE_STORAGE_USD_PER_MILLION_TOKEN_HOUR") === undefined
              ? known?.cacheStorage
              : (price.parse(get("CACHE_STORAGE_USD_PER_MILLION_TOKEN_HOUR")) *
                  1000) /
                3600,
        }
      : {}),
    inputHit: rate("CACHED_INPUT", known?.inputHit),
    output: rate("OUTPUT", known?.output),
    pricingDate: z.iso
      .date()
      .parse(get("PRICING_DATE") ?? known?.pricingDate ?? "2026-10-20"),
    longContext:
      env.LLM_OPENAI_CACHE_BILLING === "legacy"
        ? undefined
        : known?.longContext,
    ...budgetSettings(env),
  };
  const allowed =
    provider === "gemini"
      ? ["low", "medium", "high"]
      : provider === "deepseek"
        ? ["none", "low", "high", "max"]
        : effort.options;
  if (
    ![result.effort, result.initialEffort].every((value) =>
      allowed.includes(value),
    )
  )
    throw new Error("選択したモデルが推論量の設定に対応していません");
  if (result.maxOutput > (known?.maxOutput ?? result.context))
    throw new Error("モデルの出力上限を超えています");
  z.number()
    .int()
    .nonnegative()
    .safe()
    .parse(
      Math.ceil(
        result.context *
          Math.max(
            result.inputMiss,
            result.inputHit,
            result.cacheWrite5m ?? 0,
            result.cacheWrite1h ?? 0,
            result.cacheWrite30m ?? 0,
            result.cacheWrite12h ?? 0,
          ) +
          result.maxOutput * result.output,
      ),
    );
  return result;
}
export function budgetSettings(env: NodeJS.ProcessEnv) {
  return {
    budgetId: z
      .string()
      .min(1)
      .parse(env.LLM_BUDGET_ID ?? "service-usage"),
    budgetUsd: env.LLM_BUDGET_USD
      ? z.coerce
          .number()
          .positive()
          .max(Number.MAX_SAFE_INTEGER / 1_000_000_000)
          .parse(env.LLM_BUDGET_USD)
      : null,
  };
}
