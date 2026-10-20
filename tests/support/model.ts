import { randomUUID } from "node:crypto";

export const modelEnvironment = (budgetId: string) => ({
  LLM_MODEL: "gemini-3.8-flash",
  GEMINI_API_KEY: "unused",
  LLM_BUDGET_ID: budgetId,
  LLM_BUDGET_USD: "40",
});
// Existing scenarios isolate proposal execution. Commit-review behavior has dedicated tests.
export function approvedTransport(transport: typeof fetch): typeof fetch {
  return async (url, options) => {
    const body = JSON.parse(String(options?.body));
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
      : await transport(url, options);
    const data = await result.json();
    if (data.usage)
      data.usage.total_tokens ??=
        data.usage.prompt_tokens + data.usage.completion_tokens;
    return new Response(JSON.stringify(data), {
      status: result.status,
      headers: result.headers,
    });
  };
}
