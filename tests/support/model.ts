import { randomUUID } from "node:crypto";

export const modelEnvironment = (budgetId: string) => ({
  LLM_MODEL: "gemini-3.8-flash",
  GEMINI_API_KEY: "unused",
  LLM_BUDGET_ID: budgetId,
  LLM_BUDGET_USD: "40",
});
export function fixtureBody(options?: RequestInit) {
  const body = JSON.parse(String(options?.body));
  for (const message of body.messages ?? [])
    if (Array.isArray(message.content))
      message.content = message.content
        .map((part: { text: string }) => part.text)
        .join("");
  return body;
}
// Existing scenarios isolate proposal execution. Commit-review behavior has dedicated tests.
export function approvedTransport(transport: typeof fetch): typeof fetch {
  return async (url, options) => {
    if (String(url).endsWith(":countTokens"))
      return Response.json({ totalTokens: 370 });
    const body = fixtureBody(options);
    const input = JSON.parse(
      body.messages.find((m: { role: string }) => m.role === "user").content,
    );
    const result = input.commitReview?.candidate
      ? new Response(
          JSON.stringify({
            id: randomUUID(),
            model: "gemini-3.8-flash",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    type: "commit",
                    reason: "この試験の候補を受理する",
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        )
      : await transport(url, { ...options, body: JSON.stringify(body) });
    const data = await result.json();
    // These fixtures test world execution, not the model's semantic judgement.
    for (const choice of data.choices ?? []) {
      let content;
      try {
        content = JSON.parse(choice.message.content);
      } catch {
        continue;
      }
      if (
        content.type !== "scene" ||
        content.responseCoverage ||
        !input.request?.controlledActionText
      )
        continue;
      const actor = input.request.controlledActorId;
      const evidence = content.events.flatMap(
        (
          e: { receipts: { observerId: string; text: string }[] },
          eventIndex: number,
        ) =>
          e.receipts.flatMap((r, receiptIndex) =>
            r.observerId === actor
              ? [{ eventIndex, receiptIndex, quote: r.text }]
              : [],
          ),
      );
      content.responseCoverage = [
        {
          requestPart: input.request.controlledActionText,
          outcome:
            evidence.length &&
            ["finished", "decide"].includes(content.decisions[actor])
              ? "delivered"
              : "pending",
          evidence,
          explanation: "試験で指定した行動の完了状態と提示を使用する",
        },
      ];
      choice.message.content = JSON.stringify(content);
    }
    if (data.usage)
      data.usage.total_tokens ??=
        data.usage.prompt_tokens + data.usage.completion_tokens;
    return new Response(JSON.stringify(data), {
      status: result.status,
      headers: result.headers,
    });
  };
}
