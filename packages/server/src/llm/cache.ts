import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { canonical, preparePrompt } from "./prompt.js";
import type { Api, Provider } from "./config.js";
import type { BudgetLedger } from "./budget.js";

type Prepared = ReturnType<typeof preparePrompt>;
type Block = { text: string; cacheBoundary?: true };
type Message = { role: "system" | "user" | "assistant"; content: Block[] };
const hash = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const ttlSeconds = 300;

/** One prefix plan; adapters only translate the selected boundaries. */
export function cacheMessages(prompt: Prepared): Message[] {
  const messages: Message[] = [
    ...(prompt.system.length
      ? [{ role: "system" as const, content: prompt.system }]
      : []),
    ...prompt.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string" ? [{ text: m.content }] : m.content,
    })),
  ];
  const boundaries = messages.flatMap((m) =>
    m.content.filter((b) => b.cacheBoundary),
  );
  const selected = new Set([boundaries[0], ...boundaries.slice(-3)]);
  return messages.map((m) => ({
    ...m,
    content: m.content.map((b) => ({
      text: b.text,
      ...(selected.has(b) && b.cacheBoundary
        ? { cacheBoundary: true as const }
        : {}),
    })),
  }));
}

export function renderCachedPrompt(
  prompt: Prepared,
  provider: Provider,
  api: Api,
  model: string,
) {
  const messages = cacheMessages(prompt);
  if (provider === "anthropic") {
    const blocks = (parts: Block[]) =>
      parts.map((b) => ({
        type: "text" as const,
        text: b.text,
        ...(b.cacheBoundary
          ? { cache_control: { type: "ephemeral" as const } }
          : {}),
      }));
    return {
      system: blocks(
        messages.filter((m) => m.role === "system").flatMap((m) => m.content),
      ),
      messages: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: blocks(m.content) })),
    };
  }
  const generation = /^gpt-(\d+)(?:\.(\d+))?/.exec(model);
  const explicit =
    provider === "openai" &&
    generation &&
    (Number(generation[1]) > 5 ||
      (Number(generation[1]) === 5 && Number(generation[2]) >= 6));
  const rendered = messages.map((m) => ({
    role:
      explicit && api === "responses" && m.role === "system"
        ? "developer"
        : m.role,
    content:
      explicit && m.role !== "assistant"
        ? m.content.map((b) => ({
            type: api === "responses" ? "input_text" : "text",
            text: b.text,
            ...(b.cacheBoundary
              ? { prompt_cache_breakpoint: { mode: "explicit" } }
              : {}),
          }))
        : m.content.map((b) => b.text).join(""),
  }));
  return {
    ...(api === "responses" ? { input: rendered } : { messages: rendered }),
    ...(explicit
      ? { prompt_cache_options: { mode: "explicit", ttl: "30m" } }
      : {}),
  };
}

export function geminiCachePlan(prompt: Prepared) {
  const messages = cacheMessages(prompt),
    boundaries = messages.flatMap((m, mi) =>
      m.content.flatMap((b, bi) => (b.cacheBoundary ? [{ mi, bi }] : [])),
    );
  // Keep growing scene history outside a separately stored prefix.
  const boundary =
    boundaries.find((b) => messages[b.mi]!.role !== "system") ??
    boundaries.at(-1);
  const prefix: Message[] = [],
    tail: { role: Message["role"]; content: string }[] = [];
  for (const [mi, m] of messages.entries()) {
    const end =
      !boundary || mi > boundary.mi
        ? 0
        : mi < boundary.mi
          ? m.content.length
          : boundary.bi + 1;
    if (end) prefix.push({ ...m, content: m.content.slice(0, end) });
    if (end < m.content.length)
      tail.push({
        role: m.role,
        content: m.content
          .slice(end)
          .map((b) => b.text)
          .join(""),
      });
  }
  return { prefix: geminiInput(prefix), tail, full: geminiInput(messages) };
}
function geminiInput(messages: Message[]) {
  return {
    ...(messages.some((m) => m.role === "system")
      ? {
          systemInstruction: {
            parts: messages
              .filter((m) => m.role === "system")
              .map((m) => ({ text: m.content.map((b) => b.text).join("") })),
          },
        }
      : {}),
    contents: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content.map((b) => b.text).join("") }],
      })),
  };
}
type GeminiConfig = {
  model: string;
  baseUrl: string;
  cacheStorage?: number | undefined;
  version: string;
  pricingDate: string;
};
export class PromptCache {
  constructor(
    readonly ledger: BudgetLedger,
    readonly transport: typeof fetch,
  ) {}
  async #post(base: string, path: string, key: string, body: unknown) {
    return this.transport(`${base.replace(/\/openai$/, "")}/${path}`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  }
  async countGemini(
    config: GeminiConfig,
    key: string,
    input: ReturnType<typeof geminiInput>,
  ) {
    const response = await this.#post(
      config.baseUrl,
      `models/${config.model}:countTokens`,
      key,
      {
        generateContentRequest: { model: `models/${config.model}`, ...input },
      },
    );
    if (!response.ok)
      throw new Error(
        `入力トークン数を確認できません: HTTP ${response.status}。生成は送信していません`,
      );
    return z
      .object({ totalTokens: z.number().int().nonnegative() })
      .parse(await response.json()).totalTokens;
  }
  async gemini(
    config: GeminiConfig,
    key: string,
    plan: ReturnType<typeof geminiCachePlan>,
    configurationVersion: number | null,
  ) {
    if (config.cacheStorage === undefined || !plan.tail.length)
      return undefined;
    const cacheKey = hash({
      endpoint: config.baseUrl,
      model: config.model,
      credential: hash(key),
      prefix: plan.prefix,
    });
    const saved = (
      await this.ledger.pool.query<{ name: string | null; usable: boolean }>(
        "SELECT name,expires_at>clock_timestamp()+interval '5 seconds' AS usable FROM llm_prompt_cache WHERE key=$1",
        [cacheKey],
      )
    ).rows[0];
    if (saved?.usable) return saved.name ?? undefined;
    if (saved && !saved.name) return undefined; // A rejected or uncertain create is never resent.
    const tokens = await this.countGemini(config, key, plan.prefix);
    if (tokens < 4096) return undefined;
    const id = randomUUID(),
      request = {
        model: `models/${config.model}`,
        ...plan.prefix,
        ttl: `${ttlSeconds}s`,
      };
    const claimed = (
      await this.ledger.pool.query(
        `INSERT INTO llm_prompt_cache(key,call_id) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET call_id=$2,name=NULL,expires_at=NULL,tokens=NULL
       WHERE llm_prompt_cache.name IS NOT NULL AND llm_prompt_cache.expires_at<=clock_timestamp()+interval '5 seconds' RETURNING key`,
        [cacheKey, id],
      )
    ).rowCount;
    if (!claimed) return undefined;
    const stored = {
      role: "prompt-cache",
      requestedVersion: config.version,
      pricingDate: config.pricingDate,
      ...(configurationVersion === null ? {} : { configurationVersion }),
      request,
      connection: {
        provider: "gemini",
        api: "cached-contents",
        baseUrl: config.baseUrl,
        inputMiss: 0,
        inputHit: 0,
        output: 0,
        cacheStorage: config.cacheStorage,
      },
    };
    try {
      return await this.ledger.modelLimits.run(
        {
          name: `gemini:${config.model}`,
          key,
          request,
          maxOutput: 0,
          cached: false,
        },
        async (quota) => {
          await this.ledger.reserve(
            id,
            hash(stored),
            Math.ceil(tokens * ttlSeconds * config.cacheStorage!),
            stored,
            tokens,
            "gemini-count-tokens",
          );
          return this.ledger.track(id, async () => {
            const started = performance.now();
            quota.sent();
            const response = await this.#post(
              config.baseUrl,
              "cachedContents",
              key,
              request,
            );
            if (!response.ok) {
              if (response.status === 400) {
                const rejection = z
                  .object({
                    error: z.object({
                      code: z.literal(400),
                      status: z.string(),
                      message: z.string(),
                    }),
                  })
                  .safeParse(await response.json());
                if (rejection.success) {
                  await this.ledger.settle(
                    id,
                    0,
                    {
                      error: "キャッシュ作成が拒否されました",
                      rejection: rejection.data,
                    },
                    Math.round(performance.now() - started),
                  );
                  quota.used(0);
                  return undefined;
                }
              }
              throw new Error(
                `キャッシュ作成の結果を確認できません: HTTP ${response.status}。予約枠は保持します`,
              );
            }
            const cache = z
              .object({
                name: z.string().startsWith("cachedContents/"),
                createTime: z.iso.datetime(),
                expireTime: z.iso.datetime(),
                usageMetadata: z.object({
                  totalTokenCount: z.number().int().nonnegative(),
                }),
              })
              .parse(await response.json());
            const tokenSeconds =
              (cache.usageMetadata.totalTokenCount *
                (Date.parse(cache.expireTime) - Date.parse(cache.createTime))) /
              1000;
            z.number().nonnegative().finite().parse(tokenSeconds);
            await this.ledger.settle(
              id,
              Math.ceil(tokenSeconds * config.cacheStorage!),
              {
                id: cache.name,
                model: config.model,
                content: JSON.stringify(cache),
                finishReason: "stop",
                usage: {
                  prompt_tokens: 0,
                  completion_tokens: 0,
                  prompt_cache_hit_tokens: 0,
                  prompt_cache_miss_tokens: 0,
                  cache_storage_token_seconds: tokenSeconds,
                },
              },
              Math.round(performance.now() - started),
            );
            quota.used(cache.usageMetadata.totalTokenCount);
            await this.ledger.pool.query(
              "UPDATE llm_prompt_cache SET name=$3,expires_at=$4,tokens=$5 WHERE key=$1 AND call_id=$2",
              [
                cacheKey,
                id,
                cache.name,
                cache.expireTime,
                cache.usageMetadata.totalTokenCount,
              ],
            );
            return cache.name;
          });
        },
      );
    } catch (error) {
      await this.ledger.pool.query(
        "DELETE FROM llm_prompt_cache WHERE key=$1 AND call_id=$2 AND NOT EXISTS(SELECT 1 FROM llm_call WHERE id=$2)",
        [cacheKey, id],
      );
      throw error;
    }
  }
}
