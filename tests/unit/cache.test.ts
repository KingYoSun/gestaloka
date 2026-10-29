import { expect, test } from "vitest";
import { preparePrompt } from "../../packages/server/src/llm/prompt.js";
import {
  cacheMessages,
  geminiCachePlan,
  renderCachedPrompt,
} from "../../packages/server/src/llm/cache.js";

const prepare = (action: string, history: unknown[] = []) =>
  preparePrompt(
    [
      { role: "system", content: "JSONで返す共通の指示" },
      {
        role: "user",
        content: JSON.stringify({
          background: { facts: ["同じ背景"] },
          sceneHistory: history,
          request: { action },
          responseSchema: { type: "object" },
        }),
      },
    ],
    false,
    false,
    false,
  );

test("同じ境界計画を3社へ変換し、動的な入力の後ろへ書込境界を置かない", () => {
  const prompt = prepare("最初の問い"),
    messages = cacheMessages(prompt);
  expect(
    messages.flatMap((m) => m.content).filter((b) => b.cacheBoundary).length,
  ).toBeLessThanOrEqual(4);
  expect(messages.at(-1)!.content.at(-1)).not.toHaveProperty("cacheBoundary");
  const anthropic = renderCachedPrompt(
    prompt,
    "anthropic",
    "messages",
    "claude-sonnet-5-5",
  );
  expect(JSON.stringify(anthropic)).toContain("cache_control");
  for (const api of ["responses", "chat-completions"] as const) {
    const openai = renderCachedPrompt(prompt, "openai", api, "gpt-6.1-terra");
    expect(openai).toMatchObject({
      prompt_cache_options: { mode: "explicit", ttl: "30m" },
    });
    expect(JSON.stringify(openai)).toContain("prompt_cache_breakpoint");
    expect(JSON.stringify(openai)).not.toContain("cacheBoundary");
  }
  expect(
    renderCachedPrompt(prompt, "openai", "responses", "gpt-5.5"),
  ).not.toHaveProperty("prompt_cache_options");
});

test("Geminiは履歴と現在の問いが増えても同じ背景を再利用し、内容を落とさない", () => {
  const first = geminiCachePlan(prepare("最初の問い"));
  const next = geminiCachePlan(prepare("次の問い", [{ text: "起きた出来事" }]));
  expect(next.prefix).toEqual(first.prefix);
  expect(JSON.stringify(first.prefix)).not.toContain("最初の問い");
  expect(JSON.stringify(next.tail)).toContain("起きた出来事");
  const original = cacheMessages(prepare("最初の問い"))
    .at(-1)!
    .content.map((b) => b.text)
    .join("");
  expect(
    first.prefix.contents
      .map((c) => c.parts.map((p) => p.text).join(""))
      .join("") + first.tail.map((m) => m.content).join(""),
  ).toBe(original);
});
