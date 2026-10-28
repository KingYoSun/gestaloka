import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Authority } from "../runtime/control.js";
import { ExecutionBudget } from "../execution-budget.js";
import { ModelSettings, type SettingsSnapshot } from "./settings.js";
import type pg from "pg";
import { z } from "zod";
import {
  BudgetLedger,
  NANO_USD,
  UncertainResponse,
  type SavedCompletion,
} from "./budget.js";
import { ModelLimits } from "./limits.js";
import { responseDeadline } from "./response-deadline.js";
import { anthropicPrompt, canonical, parseOutput } from "./prompt.js";
import {
  settings,
  budgetSettings,
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
  cacheWrite5m?: number;
  cacheWrite1h?: number;
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
  sourceMessages?: ChatMessage[];
  configurationVersion?: number;
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
    completion_tokens_details: z
      .object({ reasoning_tokens: count.optional() })
      .nullish(),
  }),
});
export const MessageUsage = z.object({
  input_tokens: count,
  output_tokens: count,
  cache_creation_input_tokens: count.optional(),
  cache_read_input_tokens: count.optional(),
  cache_creation: z
    .object({
      ephemeral_5m_input_tokens: count,
      ephemeral_1h_input_tokens: count,
    })
    .optional(),
});
export function messageUsage(
  input: z.infer<typeof MessageUsage>,
): SavedCompletion["usage"] {
  if (
    input.cache_creation &&
    input.cache_creation_input_tokens !== undefined &&
    input.cache_creation.ephemeral_5m_input_tokens +
      input.cache_creation.ephemeral_1h_input_tokens !==
      input.cache_creation_input_tokens
  )
    throw new Error("キャッシュ作成の使用量内訳が整合しません");
  const miss =
      input.input_tokens +
      (input.cache_creation_input_tokens ??
        (input.cache_creation
          ? input.cache_creation.ephemeral_5m_input_tokens +
            input.cache_creation.ephemeral_1h_input_tokens
          : 0)),
    hit = input.cache_read_input_tokens ?? 0;
  return {
    prompt_tokens: miss + hit,
    completion_tokens: input.output_tokens,
    prompt_cache_hit_tokens: hit,
    prompt_cache_miss_tokens: miss,
    ...(input.cache_creation
      ? {
          cache_write_5m_tokens: input.cache_creation.ephemeral_5m_input_tokens,
          cache_write_1h_tokens: input.cache_creation.ephemeral_1h_input_tokens,
        }
      : input.cache_creation_input_tokens === undefined
        ? {}
        : {
            cache_write_5m_tokens: input.cache_creation_input_tokens,
            cache_write_1h_tokens: 0,
          }),
  };
}
const MessageResponse = z.object({
  id: z.string(),
  model: z.string(),
  stop_reason: z.string().nullable(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: MessageUsage,
});
const MessageEvent = z.object({
  type: z.string(),
  message: MessageResponse.optional(),
  index: count.optional(),
  content_block: z
    .object({ type: z.string(), text: z.string().optional() })
    .optional(),
  delta: z
    .object({
      type: z.string().optional(),
      text: z.string().optional(),
      stop_reason: z.string().nullable().optional(),
    })
    .optional(),
  usage: MessageUsage.partial().optional(),
});
async function streamedMessage(response: Response, onData: () => void) {
  if (!response.body) throw new Error("LLM応答のストリームがありません");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "",
    message: z.infer<typeof MessageResponse> | undefined;
  let finalUsage = false;
  const open = new Set<number>();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done)
        throw new Error("LLM応答が完了前に切断されました。予約枠は保持します");
      onData();
      buffer += chunk.value;
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const event = MessageEvent.parse(JSON.parse(data));
        if (event.type === "error")
          throw new Error(
            "LLM応答中にAPIエラーが発生しました。予約枠は保持します",
          );
        if (event.type === "message_start") message = event.message;
        else if (
          event.type === "content_block_start" &&
          message &&
          event.index !== undefined &&
          event.content_block
        ) {
          // Thinking and signatures are never accumulated or persisted.
          message.content[event.index] =
            event.content_block.type === "text"
              ? event.content_block
              : { type: event.content_block.type };
          open.add(event.index);
        } else if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta"
        ) {
          const block = message?.content[event.index ?? -1];
          if (!block || block.type !== "text" || !open.has(event.index!))
            throw new Error("LLM応答の本文ブロックが不正です");
          block.text = (block.text ?? "") + (event.delta.text ?? "");
        } else if (
          event.type === "content_block_stop" &&
          event.index !== undefined
        )
          open.delete(event.index);
        else if (event.type === "message_delta" && message) {
          message.usage = MessageUsage.parse({
            ...message.usage,
            ...event.usage,
          });
          if (event.usage?.output_tokens !== undefined) finalUsage = true;
          if (event.delta?.stop_reason !== undefined)
            message.stop_reason = event.delta.stop_reason;
        } else if (event.type === "message_stop") {
          if (!message?.stop_reason || !finalUsage || open.size)
            throw new Error(
              "LLM応答の終了または使用量を確認できません。予約枠は保持します",
            );
          return MessageResponse.parse(message);
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
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
    output_tokens_details: z
      .object({ reasoning_tokens: count.optional() })
      .optional(),
  }),
});
const configurationScope = new AsyncLocalStorage<SettingsSnapshot | null>();
export class LlmClient {
  readonly #baseEnvironment: NodeJS.ProcessEnv;
  #configuration: ModelSettings | undefined;
  readonly ledger: BudgetLedger;
  readonly limits: ModelLimits;
  constructor(
    pool: pg.Pool,
    environment: NodeJS.ProcessEnv = process.env,
    readonly transport: typeof fetch = fetch,
    managed = false,
  ) {
    this.#baseEnvironment = { ...environment };
    if (!managed) settings(this.#baseEnvironment);
    const budget = budgetSettings(environment);
    this.limits = new ModelLimits(
      pool,
      environment.LLM_MODEL_LIMITS || "{}",
      managed ? "service" : undefined,
    );
    this.ledger = new BudgetLedger(
      pool,
      budget.budgetId,
      budget.budgetUsd === null
        ? null
        : Math.round(budget.budgetUsd * NANO_USD),
      this.limits,
    );
  }
  static async create(
    pool: pg.Pool,
    environment: NodeJS.ProcessEnv = process.env,
    transport: typeof fetch = fetch,
  ) {
    const store = new ModelSettings(
      pool,
      environment.OPERATIONS_TOKEN_SECRET ?? "",
      transport,
    );
    await ModelSettings.setup(pool);
    const env = {
      ...environment,
      LLM_MAX_OUTPUT_TOKENS: environment.LLM_MAX_OUTPUT_TOKENS ?? "65536",
    };
    await store.initialize(env);
    const current = await store.latest();
    const model = new LlmClient(
      pool,
      {
        ...env,
        ...(current ? ModelSettings.environment(current.configuration) : {}),
      },
      transport,
      true,
    );
    model.#configuration = store;
    return model;
  }
  get environment() {
    const config = this.#configuration && configurationScope.getStore();
    return config
      ? {
          ...this.#baseEnvironment,
          ...ModelSettings.environment(
            config.configuration,
            config.billingVersion,
          ),
        }
      : this.#baseEnvironment;
  }
  get settings() {
    return this.settingsFor();
  }
  get configurationVersion() {
    return this.#configuration
      ? (configurationScope.getStore()?.version ?? null)
      : null;
  }
  async settingsAt(
    target: LlmTarget,
    id: string,
    database: Pick<pg.Pool, "query">,
  ) {
    if (!this.#configuration) return this.settingsFor(target);
    const snapshot = await this.#configuration.capture(
      id,
      database,
      configurationScope.getStore()?.version,
    );
    if (!snapshot) throw new Error("モデルの運用設定を有効にしてください");
    return settings(
      {
        ...this.#baseEnvironment,
        ...(snapshot
          ? ModelSettings.environment(
              snapshot.configuration,
              snapshot.billingVersion,
            )
          : {}),
      },
      target,
    );
  }
  async run<T>(
    id: string,
    work: () => Promise<T>,
    worldId?: string,
    userId?: string,
    authority?: Authority,
  ): Promise<T> {
    return ExecutionBudget.run(
      this.ledger.pool,
      id,
      async () => {
        if (!this.#configuration || configurationScope.getStore() !== undefined)
          return work();
        const child = await this.#configuration.capture(id),
          rootId = ExecutionBudget.id!;
        const snapshot =
          rootId === id
            ? child
            : await this.#configuration.capture(
                rootId,
                undefined,
                child?.version,
              );
        return configurationScope.run(snapshot ?? null, work);
      },
      worldId,
      userId,
      authority,
    );
  }
  bind<A extends unknown[], R>(work: (...args: A) => R) {
    const current = configurationScope.getStore();
    return ExecutionBudget.bind(
      current === undefined
        ? work
        : (...args: A) => configurationScope.run(current, () => work(...args)),
    );
  }
  settingsFor(target: LlmTarget = "default") {
    if (this.#configuration && configurationScope.getStore() === null)
      throw new Error("モデルの運用設定を有効にしてください");
    return settings(this.environment, target);
  }
  get requestedVersion() {
    return this.settings.version;
  }
  async apiKey(provider: Provider) {
    const key =
      (await this.#configuration?.secret(provider)) ??
      this.#baseEnvironment[`${provider.toUpperCase()}_API_KEY`];
    if (!key) throw new Error(`${provider}のAPIキーを設定してください`);
    return key;
  }
  async headers(provider: Provider, suppliedKey?: string) {
    const key = suppliedKey ?? (await this.apiKey(provider));
    return provider === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${key}` };
  }
  async verifyModel(target: LlmTarget = "default") {
    const config = this.settingsFor(target);
    const response = await this.transport(`${config.baseUrl}/models`, {
      headers: await this.headers(config.provider),
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
    if (this.#configuration && configurationScope.getStore() === undefined)
      return this.run(id, () => this.complete(id, role, messages, target));
    z.uuid().parse(id);
    const previous = (await this.ledger.input(id)) as StoredInput | undefined;
    if (previous?.sourceMessages) {
      if (
        previous.role !== role ||
        canonical(previous.sourceMessages) !== canonical(messages)
      )
        throw new Error("同じ呼出しIDに異なる要求を使用できません");
      return (await this.ledger.reserve(
        id,
        createHash("sha256").update(canonical(previous)).digest("hex"),
        0,
        previous,
      ))!;
    }
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
    const prompt =
      !previous && api === "messages"
        ? // The full world schema exceeds Anthropic's grammar limit; retain Zod validation.
          anthropicPrompt(
            messages,
            [
              "scene-resolve",
              "scene-result",
              "narrative-inspection",
              "world-commit",
              "initial-commit",
            ].includes(role),
            ["intent", "scene-intent"].includes(role),
          )
        : undefined;
    const request =
      api === "messages"
        ? {
            model,
            system:
              prompt?.system ??
              messages
                .filter((m) => m.role === "system")
                .map((m) => m.content)
                .join("\n\n"),
            messages:
              prompt?.messages ?? messages.filter((m) => m.role !== "system"),
            max_tokens: maxOutput,
            thinking: { type: effort === "none" ? "disabled" : "adaptive" },
            output_config: {
              ...(effort === "none" ? {} : { effort }),
              ...(prompt?.format ? { format: prompt.format } : {}),
            },
            stream: true,
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
          ...(previous.connection.cacheWrite5m === undefined
            ? {}
            : {
                cacheWrite5m: previous.connection.cacheWrite5m,
                cacheWrite1h: previous.connection.cacheWrite1h!,
              }),
        }
      : {
          baseUrl: selected.baseUrl,
          context: previous ? known!.context : selected.context,
          inputMiss: previous ? known!.inputMiss : selected.inputMiss,
          inputHit: previous ? known!.inputHit : selected.inputHit,
          output: previous ? known!.output : selected.output,
          provider,
          api,
          ...(previous || selected.cacheWrite5m === undefined
            ? {}
            : {
                cacheWrite5m: selected.cacheWrite5m,
                cacheWrite1h: selected.cacheWrite1h!,
              }),
        };
    const stored = {
      ...(prompt ? { sourceMessages: messages } : {}),
      role,
      requestedVersion: previous?.requestedVersion ?? selected.version,
      pricingDate: previous?.pricingDate ?? selected.pricingDate,
      ...(previous
        ? previous.configurationVersion === undefined
          ? {}
          : { configurationVersion: previous.configurationVersion }
        : this.configurationVersion === null
          ? {}
          : { configurationVersion: this.configurationVersion }),
      request,
      ...(previous && !previous.connection ? {} : { connection }),
    };
    const hash = createHash("sha256")
      .update(prompt ? canonical(stored) : JSON.stringify(stored))
      .digest("hex");
    if (previous) return (await this.ledger.reserve(id, hash, 0, stored))!;
    return this.limits.run(
      {
        name: `${provider}:${model}`,
        key: () => this.apiKey(provider),
        request,
        maxOutput,
        cached: !!previous,
      },
      async (quota) => {
        let inputTokens: number | undefined;
        if (provider === "anthropic" && api === "messages") {
          const input = Object.fromEntries(
            Object.entries(request).filter(
              ([key]) => !["max_tokens", "stream"].includes(key),
            ),
          );
          const counted = await this.transport(
            `${connection.baseUrl}/messages/count_tokens`,
            {
              method: "POST",
              headers: {
                ...(await this.headers(provider, quota.key)),
                "Content-Type": "application/json",
              },
              body: JSON.stringify(input),
              signal: AbortSignal.timeout(30000),
            },
          );
          if (!counted.ok)
            throw new Error(
              `入力トークン数を確認できません: HTTP ${counted.status}。生成は送信していません`,
            );
          inputTokens = z
            .object({ input_tokens: count })
            .parse(await counted.json()).input_tokens;
        }
        const cached = await this.ledger.reserve(
          id,
          hash,
          Math.ceil(
            (inputTokens ?? connection.context) *
              Math.max(
                connection.inputMiss,
                connection.inputHit,
                connection.cacheWrite5m ?? 0,
                connection.cacheWrite1h ?? 0,
              ) +
              maxOutput * connection.output,
          ),
          stored,
          inputTokens,
        );
        if (cached) return cached;
        return this.ledger.track(id, async () => {
          const started = performance.now();
          const path =
            api === "messages"
              ? "messages"
              : api === "responses"
                ? "responses"
                : "chat/completions";
          quota.sent();
          const deadline = responseDeadline(api === "messages");
          try {
            const response = await this.transport(
              `${connection.baseUrl}/${path}`,
              {
                method: "POST",
                headers: {
                  ...(await this.headers(provider, quota.key)),
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(request),
                signal: deadline.signal,
              },
            );
            if (!response.ok) {
              if (
                response.status === 400 &&
                (provider === "anthropic" || provider === "gemini")
              ) {
                const raw: unknown = await response.json().catch(() => null);
                const rejected = (
                  provider === "anthropic"
                    ? z.object({
                        type: z.literal("error"),
                        error: z.object({
                          type: z.literal("invalid_request_error"),
                          message: z.string(),
                        }),
                        request_id: z.string(),
                      })
                    : z.tuple([
                        z.object({
                          error: z.object({
                            code: z.literal(400),
                            message: z.string(),
                            status: z.string().min(1),
                          }),
                        }),
                      ])
                ).safeParse(raw);
                if (rejected.success) {
                  // Failed API calls are not billed; timeouts remain uncertain.
                  // https://support.claude.com/en/articles/8977456
                  // Gemini still counts the request against quota:
                  // https://ai.google.dev/gemini-api/docs/billing#faq
                  const error =
                    "LLM要求がHTTP 400で拒否されました。予約枠を解除しました";
                  await this.ledger.settle(
                    id,
                    0,
                    { error, rejection: raw },
                    Math.round(performance.now() - started),
                  );
                  quota.used(0);
                  throw new Error(error);
                }
              }
              throw new Error(
                `LLM要求の結果を確定できません: HTTP ${response.status}。予約枠は保持します`,
              );
            }
            const raw: unknown = await (
              api === "messages" &&
              response.headers
                .get("content-type")
                ?.includes("text/event-stream")
                ? streamedMessage(response, deadline.touch)
                : response.json()
            ).catch((error: unknown) => {
              if (error instanceof Error && error.message.includes("予約枠"))
                throw error;
              throw new UncertainResponse(
                {
                  requestId: response.headers.get("request-id"),
                  contentType: response.headers.get("content-type"),
                  errorName: error instanceof Error ? error.name : "unknown",
                  timeoutKind: deadline.timeoutKind,
                  receivedChunks: deadline.receivedChunks,
                  ...(error instanceof z.ZodError
                    ? {
                        issues: error.issues.map(({ code, path }) => ({
                          code,
                          path,
                        })),
                      }
                    : {}),
                },
                deadline.signal.aborted
                  ? "LLM応答の待機上限に達しました。予約枠は保持します"
                  : undefined,
              );
            });
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
                  ...(result.usage.output_tokens_details?.reasoning_tokens ===
                  undefined
                    ? {}
                    : {
                        reasoning_tokens:
                          result.usage.output_tokens_details.reasoning_tokens,
                      }),
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
                  ...(usage.completion_tokens_details?.reasoning_tokens ===
                  undefined
                    ? {}
                    : {
                        reasoning_tokens:
                          usage.completion_tokens_details.reasoning_tokens,
                      }),
                },
              };
            }
            const usage = completion.usage;
            if (prompt && completion.finishReason === "stop") {
              try {
                completion.content = JSON.stringify(
                  parseOutput(completion.content),
                );
              } catch {
                /* Persist the invalid response; the caller's existing validation handles it. */
              }
            }
            quota.used(usage.prompt_tokens + usage.completion_tokens);
            if (
              usage.prompt_cache_hit_tokens + usage.prompt_cache_miss_tokens !==
                usage.prompt_tokens ||
              usage.prompt_cache_miss_tokens < 0 ||
              usage.prompt_cache_hit_tokens > usage.prompt_tokens
            )
              throw new Error(
                "LLMの使用量内訳が整合しません。予約枠は保持します",
              );
            await this.ledger.settle(
              id,
              calculatedCharge(usage, connection),
              completion,
              Math.round(performance.now() - started),
            );
            return completion;
          } catch (error) {
            if (
              deadline.signal.aborted &&
              !(error instanceof UncertainResponse)
            )
              throw new UncertainResponse(
                {
                  errorName: error instanceof Error ? error.name : "unknown",
                  timeoutKind: deadline.timeoutKind,
                  receivedChunks: deadline.receivedChunks,
                },
                "LLM応答の待機上限に達しました。予約枠は保持します",
              );
            throw error;
          } finally {
            deadline.close();
          }
        });
      },
    );
  }
}
export { LlmClient as DeepSeekClient };

export function calculatedCharge(
  usage: SavedCompletion["usage"],
  rates: Pick<
    Connection,
    "inputMiss" | "inputHit" | "output" | "cacheWrite5m" | "cacheWrite1h"
  >,
) {
  const write5m = usage.cache_write_5m_tokens ?? 0,
    write1h = usage.cache_write_1h_tokens ?? 0;
  if (
    write5m + write1h > usage.prompt_cache_miss_tokens ||
    (usage.reasoning_tokens ?? 0) > usage.completion_tokens
  )
    throw new Error("LLMの使用量内訳が整合しません。予約枠は保持します");
  return Math.round(
    usage.prompt_cache_hit_tokens * rates.inputHit +
      usage.prompt_cache_miss_tokens * rates.inputMiss +
      write5m * ((rates.cacheWrite5m ?? rates.inputMiss) - rates.inputMiss) +
      write1h * ((rates.cacheWrite1h ?? rates.inputMiss) - rates.inputMiss) +
      usage.completion_tokens * rates.output,
  );
}
