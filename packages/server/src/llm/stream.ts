import { z } from "zod";
import { UncertainResponse } from "./budget.js";
import { outsideJsonWhitespace } from "./prompt.js";

export const JSON_WHITESPACE_ERROR =
  "JSON文字列外の空白連続が64文字を超えたため応答を中断しました";

/** Drain complete buffered events after cancellation, without another read. */
export async function* streamEvents(
  response: Response,
  onData: () => void,
  stopped = () => false,
) {
  if (!response.body) throw new Error("LLM応答のストリームがありません");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (!stopped()) {
      const chunk = await reader.read();
      if (chunk.done) return;
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
        if (data) yield data;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const ChatEvent = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().nullish() }).optional(),
        finish_reason: z.string().nullish(),
      }),
    )
    .max(1)
    .default([]),
  usage: z.unknown().optional(),
  error: z.unknown().optional(),
});

export async function streamedChat(
  response: Response,
  onData: () => void,
  onWhitespace: () => void,
) {
  const outside = outsideJsonWhitespace();
  let id: string | undefined,
    model: string | undefined,
    finish: string | undefined,
    usage: unknown,
    content = "",
    run = 0,
    interrupted = false;
  for await (const data of streamEvents(response, onData, () => interrupted)) {
    if (data.trim() === "[DONE]") break;
    const event = ChatEvent.parse(JSON.parse(data));
    id ??= event.id;
    model ??= event.model;
    if (event.error && !interrupted)
      throw new UncertainResponse(
        { type: "stream", id, model, error: event.error },
        "LLM応答中にAPIエラーが発生しました。予約枠は保持します",
      );
    const choice = event.choices[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    // OpenRouter repeats finish_reason on its final accounting frame. Also
    // accept OpenAI's empty choices variant, never interim usage estimates.
    if (event.usage != null && (!event.choices.length || choice?.finish_reason))
      usage = event.usage;
    const text = choice?.delta?.content ?? "";
    content += text; // Retain every received character, including this fragment.
    if (!interrupted)
      for (const character of text) {
        run = outside(character) ? run + 1 : 0;
        if (run > 64) {
          interrupted = true;
          onWhitespace();
          break;
        }
      }
  }
  return {
    id,
    model,
    choices: [
      {
        finish_reason: interrupted
          ? "json_whitespace"
          : (finish ?? "incomplete"),
        message: { content },
      },
    ],
    usage,
  };
}
