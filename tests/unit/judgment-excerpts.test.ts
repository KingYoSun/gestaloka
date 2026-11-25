import { expect, test, vi } from "vitest";
import { buildJudgmentExcerpts } from "../../packages/server/src/llm/judgment-excerpts.js";

type State = { fragments: { text: string; context: [string, string] }[] };
type Question = { instructions: string };

test("400文字をUnicodeの文字数で判定し、長い文を重ねて原文どおりに戻す", async () => {
  const short = "🥝".repeat(399);
  const limit = short + "🍊";
  const longer = limit + "🍋";
  const fragments: string[] = [];
  const decide = vi.fn(
    async (state: unknown, questions: Record<string, Question>) => {
      const rows = (state as State).fragments;
      let i = 0;
      return Object.fromEntries(
        Object.entries(questions).map(([id, question]) => {
          const { text } = rows[i++]!;
          fragments.push(text);
          expect(question.instructions).toContain(JSON.stringify(text));
          expect([...text].length).toBeLessThanOrEqual(320);
          return [id, 0.45];
        }),
      );
    },
  );
  const result = await buildJudgmentExcerpts(
    [short, limit, longer, longer],
    decide,
  );
  expect(result).toEqual(
    new Map([
      [limit, limit],
      [longer, longer],
    ]),
  );
  expect(fragments).toContain([...longer].slice(256).join(""));
  expect(fragments.filter((text) => [...text].length === 320)).toHaveLength(1);
  expect(decide).toHaveBeenCalledTimes(1);
});

test("途中の発動条件と末尾の例外を、前後一文とともに順番を変えず抜き出す", async () => {
  const filler = "記録を写して棚に置いた。".repeat(40);
  const beforeRule = "稽古場で以下のことを確かめた。";
  const rule = "空気を伝わる音を、耳に届く前に遮れる。";
  const afterRule = "この結果は記録係が見届けた。";
  const beforeException = "翌日には紙筒も用意した。";
  const exception = "ただし紙筒を通る音には働かない。";
  const title = "静寂通し：";
  const text =
    title +
    filler +
    beforeRule +
    rule +
    afterRule +
    filler +
    beforeException +
    exception;
  const result = await buildJudgmentExcerpts(
    [text],
    async (state, questions) => {
      const rows = (state as State).fragments;
      return Object.fromEntries(
        Object.keys(questions).map((id, index) => [
          id,
          [rule, exception].includes(rows[index]!.text) ? 0.45 : 0.449,
        ]),
      );
    },
  );
  expect(result.get(text)).toBe(
    title +
      "\n…\n" +
      beforeRule +
      rule +
      afterRule +
      "\n…\n" +
      beforeException +
      exception,
  );
});

test("選ぶ箇所がゼロの資料だけを完了扱いにし、回答が足りない資料は再試行できる", async () => {
  const none = "鍵".repeat(400);
  const missing = "灯".repeat(400);
  const result = await buildJudgmentExcerpts(
    [none, missing],
    async (state, questions) => {
      const rows = (state as State).fragments;
      return Object.fromEntries(
        Object.keys(questions).flatMap((id, index) =>
          rows[index]!.text.startsWith("鍵") ? [[id, 0.01]] : [],
        ),
      );
    },
  );
  expect(result).toEqual(new Map([[none, null]]));
  const failure = vi.fn(async () => {
    throw new Error("判断APIが使えない");
  });
  expect(await buildJudgmentExcerpts([none], failure)).toEqual(new Map());
});

test("断片と引用を含むリクエストを約30KiBずつ分ける", async () => {
  const texts = Array.from(
    { length: 32 },
    (_, i) => `${i}番の記録。` + `資料${i}`.repeat(150),
  );
  const batches: number[] = [];
  const result = await buildJudgmentExcerpts(
    texts,
    async (state, questions, batch) => {
      batches.push(batch);
      const payload = {
        state,
        questions: Object.fromEntries(
          Object.entries(questions).map(([id, value]) => [
            id,
            { type: "noul", ...value },
          ]),
        ),
      };
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(
        30 * 1024,
      );
      return Object.fromEntries(Object.keys(questions).map((id) => [id, 0.2]));
    },
  );
  expect(batches.length).toBeGreaterThan(1);
  expect(batches).toEqual(Array.from({ length: batches.length }, (_, i) => i));
  expect(result.size).toBe(texts.length);
  expect(texts.every((text) => result.get(text) === null)).toBe(true);
});
