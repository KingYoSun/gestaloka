import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldStore } from "@gestaloka/server/world";
import { WorldBudget } from "../../packages/server/src/llm/world-budget.js";

const d = connectDatabases(),
  worlds: string[] = [],
  operations: string[] = [],
  budgets: string[] = [],
  scopes: string[] = [];
const empty = () => ({ nodes: [], edges: [], revisions: [], endEdges: [] });
beforeAll(() => d.verify());
afterAll(async () => {
  await d.postgres.query("DELETE FROM world_budget WHERE world_id=ANY($1)", [
    worlds,
  ]);
  await d.postgres.query("DELETE FROM llm_model_use WHERE scope=ANY($1)", [
    scopes,
  ]);
  await d.postgres.query("DELETE FROM world_operation WHERE id=ANY($1)", [
    operations,
  ]);
  await d.postgres.query(
    "DELETE FROM world_controlled_actor WHERE world_id=ANY($1)",
    [worlds],
  );
  await d.postgres.query("DELETE FROM llm_call WHERE budget_id=ANY($1)", [
    budgets,
  ]);
  await d.postgres.query("DELETE FROM llm_budget WHERE id=ANY($1)", [budgets]);
  for (const worldId of worlds)
    await d.graph.executeQuery(
      "MATCH(n) WHERE n.worldId=$worldId DETACH DELETE n",
      { worldId },
    );
  await d.close();
});
function sse(model: string, blocks: unknown[]) {
  const frames: unknown[] = [
    {
      type: "message_start",
      message: {
        id: randomUUID(),
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
  ];
  for (const [index, block] of blocks.entries()) {
    const value = block as {
      type: string;
      name?: string;
      input?: unknown;
      text?: string;
    };
    frames.push(
      {
        type: "content_block_start",
        index,
        content_block:
          value.type === "tool_use"
            ? {
                type: "tool_use",
                id: randomUUID(),
                name: value.name,
                input: {},
              }
            : { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index,
        delta:
          value.type === "tool_use"
            ? {
                type: "input_json_delta",
                partial_json: JSON.stringify(value.input),
              }
            : { type: "text_delta", text: value.text },
      },
      { type: "content_block_stop", index },
    );
  }
  frames.push(
    {
      type: "message_delta",
      delta: {
        stop_reason: blocks.some(
          (b) => (b as { type: string }).type === "tool_use",
        )
          ? "tool_use"
          : "end_turn",
        stop_sequence: null,
      },
      usage: { output_tokens: 3 },
    },
    { type: "message_stop" },
  );
  return new Response(
    frames
      .map(
        (frame) =>
          `event: ${(frame as { type: string }).type}\ndata: ${JSON.stringify(frame)}\n\n`,
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
function findProposal(value: unknown): string | undefined {
  if (typeof value === "string") {
    try {
      return findProposal(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object") return undefined;
  if ("proposalId" in value && typeof value.proposalId === "string")
    return value.proposalId;
  for (const child of Object.values(value).reverse()) {
    const found = findProposal(child);
    if (found) return found;
  }
  return undefined;
}
test.each([
  { failAfterCommit: false, repairCommit: false },
  { failAfterCommit: true, repairCommit: false },
  { failAfterCommit: false, repairCommit: true },
  { failAfterCommit: false, repairCommit: false, conflictDuringRead: true },
  { failAfterCommit: false, repairCommit: false, transportFailure: true },
  { failAfterCommit: false, repairCommit: false, transientFailure: true },
  { failAfterCommit: false, repairCommit: false, participant: true },
])(
  "実際のdshで二重適用を防ぐ: 確定後通信失敗 $failAfterCommit / 修正 $repairCommit / 競合 $conflictDuringRead / 永続通信失敗 $transportFailure / 一時通信失敗 $transientFailure / 参加生成 $participant",
  async ({
    failAfterCommit,
    repairCommit,
    conflictDuringRead,
    transportFailure,
    transientFailure,
    participant,
  }) => {
    const worldId = randomUUID(),
      actor = randomUUID(),
      script = randomUUID(),
      edge = randomUUID(),
      budgetId = randomUUID();
    const joined = randomUUID();
    worlds.push(worldId);
    budgets.push(budgetId);
    const scope = createHash("sha256")
      .update(`deepseek:deepseek-flash:${budgetId}`)
      .digest("hex");
    scopes.push(scope);
    let stage = 0;
    const candidate = {
      type: "propose",
      changes: {
        ...empty(),
        nodes: [
          ...(participant
            ? [{ id: joined, kind: "existence", text: "参加する存在" }]
            : []),
          { id: script, kind: "script", text: "試験で確定する状態" },
        ],
        edges: [
          {
            id: edge,
            kind: "status",
            role: "content",
            source: participant ? joined : actor,
            target: script,
            period: { from: 1 },
          },
          ...(participant
            ? [
                {
                  id: randomUUID(),
                  kind: "status",
                  role: "about",
                  source: script,
                  target: actor,
                  period: { from: 1 },
                },
              ]
            : []),
        ],
      },
      summary: "試験の確定",
      resolvedUntil: 1,
      wakeups: [],
      settledIntentions: participant
        ? []
        : [{ actorId: actor, reason: "状態を確定した" }],
      ...(participant ? { newParticipantId: joined } : {}),
    };
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, options) => {
        expect(
          (
            await d.postgres.query(
              "SELECT count(*)::int AS count FROM llm_model_use WHERE scope=$1 AND active_until>clock_timestamp()",
              [scope],
            )
          ).rows[0].count,
        ).toBe(1);
        expect(String(url)).toBe(
          "https://api.deepseek.com/anthropic/v1/messages",
        );
        const body = JSON.parse(String(options?.body));
        expect(new Headers(options?.headers).get("connection")).toBe("close");
        if (
          transportFailure ||
          (transientFailure && transport.mock.calls.length === 1)
        )
          throw new Error("socket closed", {
            cause: { code: "UND_ERR_SOCKET" },
          });
        const names = body.tools.map((t: { name: string }) => t.name);
        expect(names).toContain("mcp__world__world_commit");
        expect(names.join(" ")).not.toMatch(
          /bash|pwsh|read_image|working_directory/,
        );
        const call = (name: string, input: unknown) =>
          sse(body.model, [
            { type: "tool_use", name: `mcp__world__${name}`, input },
          ]);
        switch (stage++) {
          case 0:
            if (conflictDuringRead) {
              const store = new WorldStore(d.graph);
              await store.commit(
                await store.claim(worldId, randomUUID()),
                store.context(worldId),
                {
                  commitId: randomUUID(),
                  at: 0,
                  changes: {
                    ...empty(),
                    revisions: [
                      {
                        id: actor,
                        kind: "existence",
                        text: "並行更新後の試験対象",
                      },
                    ],
                  },
                },
              );
            }
            return call("world_read", {
              requests: [{ kind: "node", id: actor }],
            });
          case 1:
            if (conflictDuringRead)
              expect(JSON.stringify(body)).toContain("並行更新後の試験対象");
            expect(
              await new WorldStore(d.graph).context(worldId).node(script),
            ).toBeUndefined();
            return call(
              "world_propose",
              repairCommit
                ? {
                    ...candidate,
                    changes: {
                      ...candidate.changes,
                      edges: [
                        ...candidate.changes.edges,
                        {
                          id: randomUUID(),
                          kind: "see",
                          source: actor,
                          target: script,
                          text: "存在しない作用経路を修正する試験",
                          period: { from: 1 },
                          observation: {
                            aspect: "状態",
                            through: 1,
                            sourceIds: [script],
                            pathIds: [randomUUID()],
                          },
                        },
                      ],
                    },
                  }
                : candidate,
            );
          case 2:
            {
              const results = body.messages
                .flatMap((m: { content: { type: string }[] }) => m.content)
                .filter((c: { type: string }) => c.type === "tool_result");
              const review = JSON.stringify(results.at(-1));
              expect(review).not.toMatch(
                /指定されたJSONだけ|type=commit|type=revise|type=pause/,
              );
              expect(review).toContain("world_propose");
              expect(review).toContain("world_commit");
              expect(review).toContain("未解決の意図と継続を保持");
            }
            expect(
              await new WorldStore(d.graph).context(worldId).node(script),
            ).toBeUndefined();
            return call("world_commit", {
              proposalId: findProposal(body),
              reason: "候補と根拠を照合した",
            });
          case 3:
            if (repairCommit) {
              expect(
                await new WorldStore(d.graph).context(worldId).node(script),
              ).toBeUndefined();
              expect(JSON.stringify(body.messages.at(-1))).toContain(
                "観測した作用経路が同じ世界に存在しません",
              );
              return call("world_propose", candidate);
            }
            return call("world_commit", {
              proposalId: findProposal(body),
              reason: "同じ要求の再確認",
            });
          case 4:
            if (repairCommit)
              return call("world_commit", {
                proposalId: findProposal(body),
                reason: "修正候補の根拠を照合した",
              });
            break;
          case 5:
            return call("world_commit", {
              proposalId: findProposal(body),
              reason: "同じ確定の再確認",
            });
        }
        if (failAfterCommit) throw new Error("応答を喪失した");
        return sse(body.model, [{ type: "text", text: "完了しました" }]);
      });
    const model = new LlmClient(
      d.postgres,
      {
        DEEPSEEK_API_KEY: budgetId,
        LLM_MODEL_LIMITS: JSON.stringify({
          "deepseek:deepseek-flash": { concurrency: 1 },
        }),
        LLM_BUDGET_ID: budgetId,
        LLM_REASONING_EFFORT: "none",
      },
      transport,
    );
    const agent = new WorldAgent(d.postgres, d.graph, d.checkpointer, model);
    await agent.setup();
    await WorldBudget.create(d.postgres, worldId, 100);
    const store = new WorldStore(d.graph),
      lease = await store.claim(worldId, randomUUID());
    await store.commit(lease, store.context(worldId), {
      commitId: randomUUID(),
      at: 0,
      changes: {
        ...empty(),
        nodes: [{ id: actor, kind: "existence", text: "試験対象" }],
      },
    });
    const id = await agent.create({
      worldId,
      phase: participant ? "participant" : "interaction",
      at: 0,
      until: 10,
      rootIds: [actor],
      actionText: "",
      intentions: participant
        ? []
        : [{ actorId: actor, actionText: "状態を確かめる", continuing: false }],
    });
    operations.push(id);
    if (transportFailure) {
      await expect(agent.run(id)).rejects.toThrow("UND_ERR_SOCKET");
      expect(transport).toHaveBeenCalledTimes(2);
      expect(await store.context(worldId).node(script)).toBeUndefined();
      expect(await model.ledger.summary()).toMatchObject({
        calls: 2,
        unsettled: 2,
      });
      expect(
        (
          await d.postgres.query(
            "SELECT llm_used FROM execution_budget WHERE id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ llm_used: 2 });
      expect(
        (
          await d.postgres.query(
            "SELECT state,epoch FROM world_operation WHERE id=$1",
            [id],
          )
        ).rows[0],
      ).toMatchObject({ state: "paused", epoch: 1 });
      return;
    }
    expect(await agent.run(id)).toEqual(candidate);
    if (participant)
      expect(await agent.controlledActors(worldId, [joined])).toEqual(
        new Set([joined]),
      );
    expect(
      (
        await d.postgres.query(
          "SELECT epoch FROM world_operation WHERE id=$1",
          [id],
        )
      ).rows[0].epoch,
    ).toBe(conflictDuringRead || transientFailure ? 1 : 0);
    expect(stage).toBe(repairCommit ? 7 : 5);
    expect(await store.context(worldId).node(script)).toMatchObject({
      id: script,
    });
    const calls = transport.mock.calls.length;
    expect(await agent.run(id)).toEqual(candidate);
    expect(transport).toHaveBeenCalledTimes(calls);
    expect(await model.ledger.summary()).toMatchObject({
      calls: (repairCommit ? 7 : 5) + (transientFailure ? 1 : 0),
      unsettled: failAfterCommit || transientFailure ? 1 : 0,
    });
    expect(
      (
        await d.postgres.query(
          "SELECT llm_used FROM execution_budget WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toMatchObject({
      llm_used: (repairCommit ? 7 : 5) + (transientFailure ? 1 : 0),
    });
  },
  90000,
);
