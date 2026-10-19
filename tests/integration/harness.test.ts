import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { connectDatabases } from "@gestaloka/server";
import { LlmClient } from "@gestaloka/server/llm";
import { WorldAgent } from "@gestaloka/server/agent";
import { WorldStore } from "@gestaloka/server/world";

const d = connectDatabases(),
  worlds: string[] = [],
  operations: string[] = [],
  budgets: string[] = [];
const empty = () => ({ nodes: [], edges: [], revisions: [], endEdges: [] });
beforeAll(() => d.verify());
afterAll(async () => {
  await d.postgres.query("DELETE FROM world_operation WHERE id=ANY($1)", [
    operations,
  ]);
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
  for (const child of Object.values(value)) {
    const found = findProposal(child);
    if (found) return found;
  }
  return undefined;
}
test.each([false, true])(
  "実際のdshで確定を重複適用せず、確定後の通信失敗=%sでもreceiptを保つ",
  async (failAfterCommit) => {
    const worldId = randomUUID(),
      actor = randomUUID(),
      script = randomUUID(),
      edge = randomUUID(),
      budgetId = randomUUID();
    worlds.push(worldId);
    budgets.push(budgetId);
    let stage = 0;
    const candidate = {
      type: "propose",
      changes: {
        ...empty(),
        nodes: [{ id: script, kind: "script", text: "試験で確定する状態" }],
        edges: [
          {
            id: edge,
            kind: "status",
            role: "content",
            source: actor,
            target: script,
            period: { from: 1 },
          },
        ],
      },
      summary: "試験の確定",
      resolvedUntil: 1,
      wakeups: [],
      settledIntentions: [{ actorId: actor, reason: "状態を確定した" }],
    };
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url, options) => {
        expect(String(url)).toBe(
          "https://api.deepseek.com/anthropic/v1/messages",
        );
        const body = JSON.parse(String(options?.body));
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
            return call("world_read", {
              requests: [{ kind: "node", id: actor }],
            });
          case 1:
            expect(
              await new WorldStore(d.graph).context(worldId).node(script),
            ).toBeUndefined();
            return call("world_propose", candidate);
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
            return call("world_commit", {
              proposalId: findProposal(body),
              reason: "同じ要求の再確認",
            });
          default:
            if (failAfterCommit) throw new Error("応答を喪失した");
            return sse(body.model, [{ type: "text", text: "完了しました" }]);
        }
      });
    const model = new LlmClient(
      d.postgres,
      {
        DEEPSEEK_API_KEY: "unused",
        LLM_BUDGET_ID: budgetId,
        LLM_REASONING_EFFORT: "none",
      },
      transport,
    );
    const agent = new WorldAgent(d.postgres, d.graph, d.checkpointer, model);
    await agent.setup();
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
      phase: "interaction",
      at: 0,
      until: 10,
      rootIds: [actor],
      actionText: "",
      intentions: [
        { actorId: actor, actionText: "状態を確かめる", continuing: false },
      ],
    });
    operations.push(id);
    expect(await agent.run(id)).toEqual(candidate);
    expect(stage).toBe(5);
    expect(await store.context(worldId).node(script)).toMatchObject({
      id: script,
    });
    const calls = transport.mock.calls.length;
    expect(await agent.run(id)).toEqual(candidate);
    expect(transport).toHaveBeenCalledTimes(calls);
    expect(await model.ledger.summary()).toMatchObject({
      calls: 5,
      unsettled: failAfterCommit ? 1 : 0,
    });
  },
  90000,
);
