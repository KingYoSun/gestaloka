import { expect, test, vi } from "vitest";
import { streamedChat } from "../../packages/server/src/llm/stream.js";
import { chatStream } from "../support/chat-stream.js";

// Newly authored examples; captured production records stay under artifacts/.
const normal = [
  {
    name: "会話と未選択候補",
    content: JSON.stringify({
      text: "架空の会話  の続き",
      choices: ["先に確かめる", "今は保留する"],
    }),
  },
  {
    name: "書式の45空白",
    content: "{" + " ".repeat(45) + '"text":"架空の例"}',
  },
  {
    name: "引用符と逆斜線",
    content: JSON.stringify({
      text: '架空の "引用" と \\ の続き',
      choices: [],
    }),
  },
  { name: "Unicodeエスケープ", content: '{"text":"\\u67b6\\u7a7a\\n次の行"}' },
  {
    name: "入れ子の整形",
    content: JSON.stringify(
      {
        text: "架空の記録",
        entries: [{ text: "架空の観測" }],
        concluded: null,
      },
      null,
      2,
    ),
  },
];
const limited = [
  {
    name: "文字列の後",
    content: '{"text":"架空の会話"' + " ".repeat(5000),
    interrupted: true,
  },
  {
    name: "値の前の混在空白",
    content: '{"text":' + " \t\r\n".repeat(1000),
    interrupted: true,
  },
  {
    name: "配列要素の前",
    content: '{"choices":["架空A",' + "\t".repeat(5000),
    interrupted: true,
  },
  {
    name: "文字列内の長い出力",
    content: '{"text":"' + "架空".repeat(1000),
    interrupted: false,
  },
  {
    name: "空白以外の反復",
    content: '{"entries":[' + '{"text":"架空"},'.repeat(1000),
    interrupted: false,
  },
];

test.each(normal)(
  "架空正常応答 $name を同じ本文・文字列・選択の値で受信する",
  async ({ content }) => {
    const input = chatStream(content),
      abort = vi.fn();
    const result = await streamedChat(input.response, () => {}, abort);
    expect(abort).not.toHaveBeenCalled();
    expect(result.choices[0]!.message.content).toBe(content);
    expect(JSON.parse(result.choices[0]!.message.content)).toEqual(
      JSON.parse(content),
    );
    expect(result.choices[0]!.finish_reason).toBe("stop");
    expect(result.usage).toMatchObject({
      prompt_tokens: 30,
      completion_tokens: 20,
    });
  },
);

test.each(limited)(
  "架空上限応答 $name の空白連続を受信中に判別する",
  async ({ content, interrupted }) => {
    const input = chatStream(content, { finish: "length" }),
      abort = vi.fn();
    const result = await streamedChat(input.response, () => {}, abort);
    expect(abort).toHaveBeenCalledTimes(interrupted ? 1 : 0);
    if (interrupted) {
      expect(input.cancelled()).toBe(true);
      expect(result.usage).toBeUndefined();
      expect(result.choices[0]!.finish_reason).toBe("json_whitespace");
      const received = result.choices[0]!.message.content;
      expect(received.length).toBeLessThan(content.length);
      expect(content.startsWith(received)).toBe(true);
    } else {
      expect(result.choices[0]!.message.content).toBe(content);
      expect(result.choices[0]!.finish_reason).toBe("length");
    }
  },
);

test.each([" ", "\t", "\r", "\n", " \t\r\n"])(
  "文字列外の%jは64文字まで許可し、断片をまたぐ65文字目で中断する",
  async (ws) => {
    for (const length of [64, 65]) {
      const content = '{"text":"本文"' + ws.repeat(65).slice(0, length) + "}",
        input = chatStream(content, { fragment: 1 }),
        abort = vi.fn();
      await streamedChat(input.response, () => {}, abort);
      expect(abort).toHaveBeenCalledTimes(length === 65 ? 1 : 0);
    }
  },
);

test("引用符・逆斜線・Unicode・本文内空白と改行を、推論と分離して保持する", async () => {
  const value = {
      text:
        '日本語🌙 "引用" \\ の続き' + " ".repeat(512) + "\n\t\r".repeat(128),
      choices: ["話を続ける", "まだ選ばない"],
    },
    content = JSON.stringify(value),
    abort = vi.fn(),
    input = chatStream(content, {
      fragment: 7,
      networkBytes: 3,
      reasoning: "推論専用" + " ".repeat(512),
    });
  const result = await streamedChat(input.response, () => {}, abort);
  expect(abort).not.toHaveBeenCalled();
  expect(result.choices[0]!.message.content).toBe(content);
  expect(JSON.parse(result.choices[0]!.message.content)).toEqual(value);
  expect(JSON.stringify(result)).not.toContain("推論専用");
});

test.each([false, true])(
  "同一受信バッファの中断後の最終使用量も受け取る（空choices=%s）",
  async (emptyUsageChoice) => {
    const content = '{"text":"選択は未定"' + " ".repeat(256) + "}",
      input = chatStream(content, { buffered: true, emptyUsageChoice }),
      abort = vi.fn();
    const result = await streamedChat(input.response, () => {}, abort);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(result.choices[0]!.message.content).toBe(content);
    expect(result.usage).toMatchObject({
      completion_tokens: 20,
      total_tokens: 50,
    });
  },
);

test("途中の使用量推定は最終使用量として返さない", async () => {
  const input = chatStream('{"text":"本文"' + " ".repeat(512), {
    accounting: "interim",
  });
  const result = await streamedChat(
    input.response,
    () => {},
    () => {},
  );
  expect(result.usage).toBeUndefined();
});
