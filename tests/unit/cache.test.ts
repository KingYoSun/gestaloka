import { expect, test } from "vitest";
import { preparePrompt } from "../../packages/server/src/llm/prompt.js";
import { prepareDicePrompt } from "../../packages/server/src/llm/dice-prompt.js";
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

test("技能を追加しても以前の技能の境界を再利用でき、判定に渡す本文は同じ", () => {
  const skills = Array.from({ length: 29 }, (_, index) => ({
    id: `skill-${index}`,
    text: "応用できる条件と手順。".repeat(15),
    basis: "記録に基づいて習得した",
    since: index,
  }));
  const skillInput = (length: number, partition: boolean) =>
    cacheMessages(
      prepareDicePrompt(
        [
          { role: "system", content: "判定の指示" },
          {
            role: "user",
            content: JSON.stringify({
              premise: "世界の前提",
              actor: "actor",
              text: "技能を使う",
              nodes: [
                {
                  node: { id: "actor" },
                  belongings: {
                    items: [],
                    storages: [],
                    skills: skills.slice(0, length),
                  },
                },
              ],
            }),
          },
        ],
        true,
        partition,
      )!,
    );
  const contents = (length: number, partition: boolean) =>
    skillInput(length, partition).at(-1)!.content;
  const first = contents(28, true),
    appended = contents(29, true);
  expect(appended.slice(0, 3)).toEqual(first.slice(0, 3));
  expect(first[2]?.cacheBoundary).toBe(true);
  expect(appended[2]?.cacheBoundary).toBe(true);
  expect(appended.filter(({ cacheBoundary }) => cacheBoundary)).toHaveLength(4);
  expect(appended.at(-1)).not.toHaveProperty("cacheBoundary");
  expect(appended.map(({ text }) => text).join("")).toBe(
    contents(29, false)
      .map(({ text }) => text)
      .join(""),
  );
  expect(skillInput(29, true)[0]).toEqual(skillInput(29, false)[0]);
});
