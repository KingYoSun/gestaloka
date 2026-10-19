import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { connectDatabases } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldConstruction } from "@gestaloka/server/construction";

export async function fixtureRuntime(): Promise<{
  databases: ReturnType<typeof connectDatabases>;
  runtime: WorldConstruction;
}> {
  const scope = process.env.E2E_SCOPE;
  if (!scope) throw new Error("E2E_SCOPEが必要です");
  const databases = connectDatabases();
  await databases.verify();
  databases.queue.on("error", console.error);
  await databases.queue.start();
  let sequence = 0;
  const model = new LlmClient(
    databases.postgres,
    { DEEPSEEK_API_KEY: "unused", LLM_BUDGET_ID: `e2e-${scope}` },
    async (_url, options) => {
      await delay(100);
      const input = JSON.parse(String(options?.body));
      const user = JSON.parse(
        input.messages.find(
          (message: { role: string }) => message.role === "user",
        ).content,
      );
      const empty = () => ({
        nodes: [],
        edges: [],
        revisions: [],
        endEdges: [],
      });
      let content: unknown;
      if (user.initialPrompt) {
        const actor = randomUUID(),
          place = randomUUID(),
          state = randomUUID();
        content = {
          playerId: actor,
          rootIds: [place],
          report: "INITIAL_ADMIN_ONLY",
          changes: {
            ...empty(),
            nodes: [
              { id: actor, kind: "existence", text: "PRIVATE_TRIAL" },
              { id: place, kind: "existence", text: "PRIVATE_PLACE" },
              { id: state, kind: "script", text: "この場所に属する" },
            ],
            edges: [
              {
                id: randomUUID(),
                kind: "status",
                role: "content",
                source: actor,
                target: state,
                period: { from: 0 },
              },
              {
                id: randomUUID(),
                kind: "status",
                role: "about",
                source: state,
                target: place,
                period: { from: 0 },
              },
              {
                id: randomUUID(),
                kind: "see",
                source: actor,
                target: place,
                text: "試遊の主体だけが知覚したこと",
                period: { from: 0 },
              },
            ],
          },
        };
      } else if (user.observerId) content = { actionText: "周囲を見渡す" };
      else {
        const request = user.request,
          until = request.until ?? request.at + 1000;
        const result = {
          type: "propose",
          changes: empty(),
          summary: "INTERNAL_GM_ONLY",
          resolvedUntil: until,
          wakeups: [] as unknown[],
        };
        if (request.phase === "participant") {
          const actor = randomUUID(),
            state = randomUUID(),
            place = request.rootIds[0];
          content = {
            ...result,
            newParticipantId: actor,
            changes: {
              ...empty(),
              nodes: [
                { id: actor, kind: "existence", text: "PRIVATE_HUMAN" },
                { id: state, kind: "script", text: "ここに暮らす" },
              ],
              edges: [
                {
                  id: randomUUID(),
                  kind: "status",
                  role: "content",
                  source: actor,
                  target: state,
                  period: { from: request.at },
                },
                {
                  id: randomUUID(),
                  kind: "status",
                  role: "about",
                  source: state,
                  target: place,
                  period: { from: request.at },
                },
                {
                  id: randomUUID(),
                  kind: "see",
                  source: actor,
                  target: place,
                  text: "あなたが初めて知覚した景色",
                  period: { from: request.at },
                },
                ...Array.from({ length: 300 }, (_, index) => ({
                  id: randomUUID(),
                  kind: "see",
                  source: actor,
                  target: place,
                  text: `過去の観測 ${index}\n\n${"見えたことを記録した。".repeat((index % 4) + 1)}`,
                  period: { from: Math.max(0, request.at - index - 1) },
                })),
              ],
            },
          };
        } else if (
          request.controlledActorId &&
          request.phase !== "observation"
        ) {
          const actor = request.controlledActorId;
          content = {
            ...result,
            changes: {
              ...empty(),
              edges: [
                {
                  id: randomUUID(),
                  kind: "see",
                  source: actor,
                  target: actor,
                  text: `公開された経験 ${++sequence}`,
                  period: { from: request.at, until },
                },
              ],
            },
            wakeups: [{ actorId: actor, at: until + 1, mode: "intent" }],
          };
        } else content = result;
        const proposal = content as typeof result;
        content = {
          ...proposal,
          settledIntentions: (request.intentions ?? [])
            .filter(
              (intent: { actorId: string }) =>
                !proposal.wakeups.some(
                  (wakeup) =>
                    (wakeup as { actorId: string }).actorId === intent.actorId,
                ),
            )
            .map((intent: { actorId: string }) => ({
              actorId: intent.actorId,
              reason: "試験で指定した意図の処理を終了した",
            })),
        };
      }
      return new Response(
        JSON.stringify({
          id: randomUUID(),
          model: "deepseek-flash",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify(content),
                reasoning_content: "PRIVATE_REASONING",
              },
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 1,
          },
        }),
      );
    },
  );
  const runtime = new WorldConstruction(
    new WorldBuilder(
      databases.postgres,
      databases.graph,
      databases.checkpointer,
      model,
    ),
    new WorldAgent(
      databases.postgres,
      databases.graph,
      databases.checkpointer,
      model,
    ),
    databases.queue,
    `e2e-${scope}`,
  );
  await runtime.setup();
  return { databases, runtime };
}
