import { legacySceneResponse } from "../../packages/server/src/runtime/scene-data.js";
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
      if (content.type === "scene") {
        for (const event of content.events ?? [])
          event.locations ??= [
            {
              subjectId: event.actorId,
              text:
                input.currentLocations?.[event.actorId]?.[0]?.text ??
                "試験の場",
              aboutIds:
                input.currentLocations?.[event.actorId]?.[0]?.aboutIds ?? [],
            },
          ];
        choice.message.content = JSON.stringify(content);
      }
      if (input.playVersion === 4) {
        if (content.type === "scene") {
          const current = legacySceneResponse(
            content,
            input.sceneHistory,
            input.request.intentions,
          ) as Record<string, unknown>;
          delete current.newDecisions;
          choice.message.content = JSON.stringify(current);
        } else if (content.type === "boundary") {
          const actor = input.request.intentions[0].actorId;
          choice.message.content = JSON.stringify({
            type: "scene",
            events: [
              {
                actorId: actor,
                text: "場面が一区切りとなった",
                locations: [
                  {
                    subjectId: actor,
                    text:
                      input.currentLocations?.[actor]?.[0]?.text ?? "試験の場",
                    aboutIds:
                      input.currentLocations?.[actor]?.[0]?.aboutIds ?? [],
                  },
                ],
                receipts: [
                  { observerId: actor, text: "次の行動を選べる場面となった" },
                ],
              },
            ],
            decisions: Object.fromEntries(
              input.request.intentions.map((i: { actorId: string }) => [
                i.actorId,
                "decide",
              ]),
            ),
            concluded: true,
          });
        }
      }
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
