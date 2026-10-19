import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import type { Driver } from "neo4j-driver";
import { entrypoint, task } from "@langchain/langgraph";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";
import { WorldStore, Change } from "../world/store.js";
import {
  bindingScripts,
  validateBindings,
  validateConnection,
} from "../world/model.js";
import type { DeepSeekClient, ChatMessage } from "../llm/deepseek.js";

const Proposal = z
  .object({
    changes: Change,
    playerId: z.uuid(),
    rootIds: z.array(z.uuid()).min(1),
    report: z.string(),
  })
  .strict()
  .superRefine((proposal, context) => {
    for (const binding of bindingScripts(proposal.changes.edges)) {
      try {
        validateBindings(binding.kind, binding.id, proposal.changes.edges);
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "invalid binding",
        });
      }
    }
    const nodes = new Map(
      proposal.changes.nodes.map((node) => [node.id, node]),
    );
    for (const edge of proposal.changes.edges) {
      const source = nodes.get(edge.source),
        target = nodes.get(edge.target);
      try {
        if (
          edge.kind === "see" &&
          !(edge.observation?.aspect || edge.text)?.trim()
        )
          throw new Error(
            "seeには対象全体ではなく実際に観測した内容を記述してください",
          );
        if (!source || !target)
          throw new Error("初期候補に接続先のノードがありません");
        validateConnection(edge, source, target);
      } catch (error) {
        context.addIssue({
          code: "custom",
          path: ["changes", "edges", proposal.changes.edges.indexOf(edge)],
          message:
            error instanceof Error ? error.message : "invalid connection",
        });
      }
    }
    const existences = new Set(
      proposal.changes.nodes
        .filter((node) => node.kind === "existence")
        .map((node) => node.id),
    );
    if (
      !existences.has(proposal.playerId) ||
      proposal.rootIds.some((id) => !existences.has(id))
    )
      context.addIssue({
        code: "custom",
        message: "playerIdとrootIdsは作成するexistenceを参照してください",
      });
    if (proposal.changes.revisions.length || proposal.changes.endEdges.length)
      context.addIssue({
        code: "custom",
        message: "空の世界への初期生成では既存状態を変更できません",
      });
  });
type Build = {
  run_id: string;
  world_id: string;
  commit_id: string;
  initial_prompt: string;
  result: z.infer<typeof Proposal> | null;
  state: string;
};
const callId = (runId: string, attempt: number) => {
  const hex = createHash("sha256")
    .update(`${runId}:initial:${attempt}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export class WorldBuilder {
  readonly store: WorldStore;
  constructor(
    readonly pool: pg.Pool,
    graph: Driver,
    readonly checkpointer: PostgresSaver,
    readonly model: DeepSeekClient,
  ) {
    this.store = new WorldStore(graph);
  }

  async setup() {
    await this.store.setup();
    await this.checkpointer.setup();
    await this.model.ledger.setup();
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_build (
      run_id uuid PRIMARY KEY, world_id uuid UNIQUE NOT NULL, commit_id uuid UNIQUE NOT NULL,
      initial_prompt text NOT NULL, state text NOT NULL DEFAULT 'creating', result jsonb,
      created_at timestamptz NOT NULL DEFAULT now());`);
  }

  async create(initialPrompt: string) {
    const runId = randomUUID();
    await this.pool.query(
      "INSERT INTO world_build (run_id, world_id, commit_id, initial_prompt) VALUES ($1,$2,$3,$4)",
      [runId, randomUUID(), randomUUID(), initialPrompt],
    );
    return runId;
  }

  async generate(runId: string) {
    z.uuid().parse(runId);
    const record = await this.pool.query<Build>(
      "SELECT * FROM world_build WHERE run_id = $1",
      [runId],
    );
    const build = record.rows[0];
    if (!build) throw new Error("構築セッションが見つかりません");
    if (build.state === "ready") return build;
    const lease = await this.store.claim(build.world_id, runId);
    const system = await readFile(
      new URL("../../../../prompts/initial-world.md", import.meta.url),
      "utf8",
    );
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          initialPrompt: build.initial_prompt,
          responseSchema: z.toJSONSchema(Proposal, { io: "input" }),
        }),
      },
    ];
    const ask = task(
      "initial-world-proposal",
      async (input: { id: string; messages: ChatMessage[] }) =>
        this.model.complete(input.id, "initial-generation", input.messages),
    );
    const commit = task(
      "initial-world-commit",
      async (proposal: z.infer<typeof Proposal>) => {
        await this.store.commit(lease, this.store.context(build.world_id), {
          commitId: build.commit_id,
          at: 0,
          changes: proposal.changes,
        });
        await this.pool.query(
          "UPDATE world_build SET state = 'ready', result = $2 WHERE run_id = $1",
          [runId, JSON.stringify(proposal)],
        );
        return proposal;
      },
    );
    const generate = entrypoint(
      { name: "initial-world", checkpointer: this.checkpointer },
      async () => {
        for (let attempt = 0; ; attempt++) {
          const response = await ask({
            id: callId(runId, attempt),
            messages: [...messages],
          });
          if (response.finishReason !== "stop")
            throw new Error(
              "初期生成の応答が未完了です。世界は確定していません",
            );
          let proposal;
          try {
            proposal = Proposal.parse(JSON.parse(response.content));
          } catch (error) {
            messages.push(
              { role: "assistant", content: response.content },
              {
                role: "user",
                content: JSON.stringify({
                  validationErrors:
                    error instanceof z.ZodError ? error.issues : "invalid JSON",
                }),
              },
            );
            continue;
          }
          await commit(proposal);
          return proposal;
        }
      },
    );
    try {
      await generate.invoke({}, { configurable: { thread_id: runId } });
    } catch (error) {
      await this.pool.query(
        "UPDATE world_build SET state = 'paused' WHERE run_id = $1 AND state <> 'ready'",
        [runId],
      );
      throw error;
    }
    const result = await this.pool.query<Build>(
      "SELECT * FROM world_build WHERE run_id = $1",
      [runId],
    );
    return result.rows[0]!;
  }
}
