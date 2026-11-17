export function chatStream(
  content: string,
  options: {
    model?: string;
    fragment?: number;
    networkBytes?: number;
    buffered?: boolean;
    accounting?: "final" | "interim";
    usage?: unknown;
    reasoning?: string;
    emptyUsageChoice?: boolean;
    finish?: string;
  } = {},
) {
  const encoder = new TextEncoder(),
    fragment = options.fragment ?? 128,
    id = "saved-stream",
    model = options.model ?? "fixture",
    finish = options.finish ?? "stop",
    usage = options.usage ?? {
      prompt_tokens: 30,
      completion_tokens: 20,
      total_tokens: 50,
      prompt_tokens_details: { cached_tokens: 10 },
      completion_tokens_details: { reasoning_tokens: 5 },
    };
  let cancelled = false;
  function* frames() {
    yield ": OPENROUTER PROCESSING\r\n\r\n";
    if (options.reasoning)
      yield frame({
        choices: [
          {
            delta: {
              reasoning: options.reasoning,
              reasoning_details: [options.reasoning],
            },
          },
        ],
      });
    for (let i = 0; i < content.length; i += fragment)
      yield frame({
        choices: [{ delta: { content: content.slice(i, i + fragment) } }],
        ...(options.accounting === "interim" ? { usage } : {}),
      });
    yield frame({
      choices: [{ delta: { content: "" }, finish_reason: finish }],
    });
    if (!options.accounting || options.accounting === "final")
      yield frame({
        choices: options.emptyUsageChoice
          ? []
          : [{ delta: { content: "" }, finish_reason: finish }],
        usage,
      });
    yield "data: [DONE]\n\n";
  }
  const frame = (data: object) =>
    `data: ${JSON.stringify({ id, model, ...data })}\r\n\r\n`;
  const source = options.buffered
    ? [Array.from(frames()).join("")][Symbol.iterator]()
    : frames();
  let pending = new Uint8Array();
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (!pending.length) {
          const next = source.next();
          if (next.done) {
            controller.close();
            return;
          }
          pending = encoder.encode(next.value);
        }
        const length = options.networkBytes ?? pending.length;
        controller.enqueue(pending.slice(0, length));
        pending = pending.slice(length);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    response: new Response(body, {
      headers: { "content-type": "text/event-stream" },
    }),
    cancelled: () => cancelled,
  };
}
