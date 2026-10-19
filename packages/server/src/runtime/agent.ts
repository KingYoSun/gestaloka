import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import type { Driver } from "neo4j-driver";
import { entrypoint, task } from "@langchain/langgraph";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";
import {
  WorldStore,
  WorldConflict,
  Change,
  RelationKind,
  type Dependency,
} from "../world/store.js";
import {
  bindingScripts,
  validateBindings,
  validateConnection,
} from "../world/model.js";
import type { DeepSeekClient, ChatMessage } from "../llm/deepseek.js";

const Time = z.number().int().nonnegative().safe();
export const Interaction = z
  .object({
    worldId: z.uuid(),
    phase: z.enum(["interaction", "schedule", "participant"]),
    at: Time,
    until: Time,
    rootIds: z.array(z.uuid()).min(1),
    actorId: z.uuid().optional(),
    actionText: z.string(),
  })
  .strict()
  .refine((request) => request.until >= request.at);
type Interaction = z.infer<typeof Interaction>;
const Query = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("observations"), id: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal("history"),
      id: z.uuid(),
      relation: RelationKind,
      direction: z.enum(["in", "out"]),
      from: Time.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("edge"), id: z.uuid() }).strict(),
  z
    .object({ kind: z.literal("node"), id: z.uuid(), at: Time.optional() })
    .strict(),
  z
    .object({
      kind: z.literal("relations"),
      id: z.uuid(),
      relation: RelationKind,
      direction: z.enum(["in", "out"]),
      at: Time.optional(),
      through: Time.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("effects"), id: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal("skill"),
      name: z.enum(["context", "generation"]),
    })
    .strict(),
]);
const Proposal = z
  .object({
    type: z.literal("propose"),
    changes: Change,
    summary: z.string(),
    resolvedUntil: Time,
    continuation: z.string().optional(),
    newParticipantId: z.uuid().optional(),
    wakeups: z.array(
      z
        .object({
          actorId: z.uuid(),
          at: Time,
          mode: z.enum(["intent", "resolve"]),
        })
        .strict(),
    ),
  })
  .strict();
export type WorldProposal = z.infer<typeof Proposal>;
const Decision = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("query"), requests: z.array(Query).min(1) })
    .strict(),
  Proposal,
  z.object({ type: z.literal("pause"), reason: z.string() }).strict(),
]);
type Operation = {
  id: string;
  run_id: string;
  commit_id: string;
  request: Interaction;
  system_prompt: string;
  state: string;
  claim_key: string | null;
  epoch: number;
  step: number;
  messages: ChatMessage[] | null;
  dependencies: Dependency[];
  candidate: WorldProposal | null;
  result: WorldProposal | null;
};
export class OperationPaused extends Error {}
export class SupersededWorker extends Error {}
class CandidateRejected extends Error {}
const callId = (id: string, epoch: number, step: number) => {
  const hex = createHash("sha256")
    .update(`${id}:${epoch}:${step}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export class WorldAgent {
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
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_operation (
      id uuid PRIMARY KEY, run_id uuid NOT NULL, commit_id uuid UNIQUE NOT NULL,
      request jsonb NOT NULL, system_prompt text NOT NULL, state text NOT NULL DEFAULT 'queued',
      claim_key uuid, graph_generation integer, epoch integer NOT NULL DEFAULT 0, step integer NOT NULL DEFAULT 0,
      messages jsonb, dependencies jsonb NOT NULL DEFAULT '[]', candidate jsonb, result jsonb,
      pause_reason text, created_at timestamptz NOT NULL DEFAULT now());`);
  }

  async create(input: Interaction, runId = randomUUID()) {
    const request = Interaction.parse(input),
      id = randomUUID();
    z.uuid().parse(runId);
    const system = await readFile(
      new URL("../../../../prompts/world-update.md", import.meta.url),
      "utf8",
    );
    await this.pool.query(
      "INSERT INTO world_operation (id,run_id,commit_id,request,system_prompt) VALUES ($1,$2,$3,$4,$5)",
      [id, runId, randomUUID(), JSON.stringify(request), system],
    );
    return id;
  }

  async #activate(id: string, expected?: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Operation>(
        "SELECT * FROM world_operation WHERE id = $1 FOR UPDATE",
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new Error("世界更新の実行情報が見つかりません");
      if (expected !== undefined && row.claim_key !== expected)
        throw new SupersededWorker("実行は別のワーカーへ引き継がれています");
      const claim = expected ?? randomUUID();
      const lease = await this.store.claim(row.request.worldId, row.run_id);
      await client.query(
        "UPDATE world_operation SET claim_key=$2, graph_generation=$3, state=CASE WHEN state='complete' THEN state ELSE 'running' END WHERE id=$1",
        [id, claim, lease.generation],
      );
      await client.query("COMMIT");
      return { row, claim, lease };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #save(row: Operation, claim: string) {
    const result = await this.pool.query(
      `UPDATE world_operation SET epoch=$3, step=$4, messages=$5, dependencies=$6, candidate=$7
      WHERE id=$1 AND claim_key=$2`,
      [
        row.id,
        claim,
        row.epoch,
        row.step,
        JSON.stringify(row.messages),
        JSON.stringify(row.dependencies),
        JSON.stringify(row.candidate),
      ],
    );
    if (result.rowCount !== 1)
      throw new SupersededWorker("古い試行の進捗は保存できません");
  }

  async #finish(row: Operation, claim: string) {
    if (!row.candidate) throw new Error("確定済みの候補記録が見つかりません");
    const result = await this.pool.query(
      "UPDATE world_operation SET state='complete', result=$3, pause_reason=NULL WHERE id=$1 AND claim_key=$2",
      [row.id, claim, JSON.stringify(row.candidate)],
    );
    if (result.rowCount !== 1)
      throw new SupersededWorker("古い試行から結果は公開できません");
    return row.candidate;
  }

  async #queries(row: Operation, requests: z.infer<typeof Query>[]) {
    const context = this.store.context(row.request.worldId, row.dependencies);
    await context.validate();
    const results: unknown[] = [];
    for (const query of requests) {
      const at =
        "at" in query ? (query.at ?? row.request.until) : row.request.until;
      if (at > row.request.until)
        throw new CandidateRejected("要求区間より後の時点は照会できません");
      switch (query.kind) {
        case "observations":
          results.push(await context.observations(query.id, row.request.until));
          break;
        case "edge":
          results.push((await context.edge(query.id)) ?? null);
          break;
        case "node":
          results.push({
            node: (await context.node(query.id, at)) ?? null,
            knownAt: await context.latestTime(query.id),
            stateSubjects: await context.history(
              query.id,
              "status",
              "in",
              row.request.until,
            ),
            interpreters: await context.history(
              query.id,
              "interpret",
              "in",
              row.request.until,
            ),
          });
          break;
        case "history": {
          const history = await context.history(
            query.id,
            query.relation,
            query.direction,
            row.request.until,
            query.from ?? 0,
          );
          const peers = [];
          for (const id of new Set(
            history.map((edge) =>
              query.direction === "out" ? edge.target : edge.source,
            ),
          ))
            peers.push((await context.node(id, row.request.until)) ?? null);
          results.push({ history, peers });
          break;
        }
        case "relations": {
          const through = query.through ?? at;
          if (through > row.request.until)
            throw new CandidateRejected("要求区間より後の関係は照会できません");
          results.push(
            await context.relations(
              query.id,
              query.relation,
              query.direction,
              at,
              through,
            ),
          );
          break;
        }
        case "effects":
          results.push(
            await context.effects(query.id, row.request.at, row.request.until),
          );
          break;
        case "skill":
          results.push(
            await readFile(
              new URL(
                `../../../../prompts/skills/${query.name}.md`,
                import.meta.url,
              ),
              "utf8",
            ),
          );
          break;
      }
    }
    return { results, dependencies: context.dependencies };
  }

  async #validateProposal(row: Operation, proposal: WorldProposal) {
    const { request } = row;
    if (
      proposal.resolvedUntil < request.at ||
      proposal.resolvedUntil > request.until
    )
      throw new CandidateRejected("実際の到達時点が要求区間に含まれていません");
    const context = this.store.context(request.worldId, row.dependencies);
    const consulted = new Set(
      row.dependencies.map((dependency) => dependency.key),
    );
    for (const node of proposal.changes.revisions) {
      if (!consulted.has(`node:${node.id}`))
        throw new CandidateRejected(
          `改訂前にnode照会で既存内容を確認してください: ${node.id}`,
        );
      const current = await context.node(node.id);
      const latest = await context.latestTime(node.id);
      if (
        !current ||
        current.kind !== node.kind ||
        latest === undefined ||
        latest > proposal.resolvedUntil
      )
        throw new CandidateRejected(
          `既存の同一性・種別・履歴を維持できない改訂です: ${node.id}`,
        );
    }
    for (const id of proposal.changes.endEdges) {
      const edge = await context.edge(id);
      if (
        !edge ||
        (!consulted.has(`edge:${id}`) &&
          !consulted.has(`relations:${edge.source}:${edge.kind}:out`) &&
          !consulted.has(`relations:${edge.target}:${edge.kind}:in`))
      )
        throw new CandidateRejected(
          `終了前にedgeまたはrelations照会で既存内容を確認してください: ${id}`,
        );
      if (
        edge.period.until !== undefined ||
        proposal.resolvedUntil < edge.period.from
      )
        throw new CandidateRejected(`関係の既存期間を維持できません: ${id}`);
    }
    const oldEndings = [];
    for (const id of proposal.changes.endEdges)
      oldEndings.push((await context.edge(id))!);
    for (const binding of bindingScripts([
      ...proposal.changes.edges,
      ...oldEndings,
    ])) {
      const old = [
        ...(await context.history(
          binding.id,
          binding.kind,
          "in",
          Number.MAX_SAFE_INTEGER,
        )),
        ...(await context.history(
          binding.id,
          binding.kind,
          "out",
          Number.MAX_SAFE_INTEGER,
        )),
      ];
      const edges = [
        ...new Map(
          old.map((edge) => [
            edge.id,
            proposal.changes.endEdges.includes(edge.id)
              ? {
                  ...edge,
                  period: { ...edge.period, until: proposal.resolvedUntil },
                }
              : edge,
          ]),
        ).values(),
        ...proposal.changes.edges,
      ];
      try {
        validateBindings(binding.kind, binding.id, edges);
      } catch (error) {
        throw new CandidateRejected(
          error instanceof Error ? error.message : "invalid binding",
        );
      }
    }
    const nodes = new Map(
      proposal.changes.nodes.map((node) => [node.id, node]),
    );
    const anchors = new Set<string>();
    for (const node of proposal.changes.nodes) {
      if (await context.node(node.id))
        throw new CandidateRejected(
          `新規ノードのIDが既に使われています: ${node.id}`,
        );
    }
    for (const edge of proposal.changes.edges) {
      if (await context.edge(edge.id))
        throw new CandidateRejected(
          `新規エッジのIDが既に使われています: ${edge.id}`,
        );
    }
    for (const id of new Set(
      proposal.changes.edges.flatMap((edge) => [edge.source, edge.target]),
    )) {
      if (!nodes.has(id)) {
        const existing = await context.node(id, proposal.resolvedUntil);
        if (!existing)
          throw new CandidateRejected("同じ世界の接続先が見つかりません");
        nodes.set(id, existing);
        anchors.add(id);
      }
    }
    for (const edge of proposal.changes.edges) {
      try {
        validateConnection(
          edge,
          nodes.get(edge.source)!,
          nodes.get(edge.target)!,
        );
      } catch (error) {
        throw new CandidateRejected(
          error instanceof Error ? error.message : "invalid connection",
        );
      }
    }
    const connected = new Set(anchors);
    for (let changed = true; changed;) {
      changed = false;
      for (const edge of proposal.changes.edges) {
        if (connected.has(edge.source) || connected.has(edge.target)) {
          if (!connected.has(edge.source) || !connected.has(edge.target))
            changed = true;
          connected.add(edge.source);
          connected.add(edge.target);
        }
      }
    }
    if (proposal.changes.nodes.some((node) => !connected.has(node.id)))
      throw new CandidateRejected(
        "新しいノード集合が既存世界へ接続していません",
      );
    if (
      request.phase === "participant" &&
      !proposal.changes.nodes.some(
        (node) =>
          node.id === proposal.newParticipantId && node.kind === "existence",
      )
    )
      throw new CandidateRejected(
        "参加者には新しいexistenceを指定してください",
      );
    for (const wakeup of proposal.wakeups) {
      const actor =
        nodes.get(wakeup.actorId) ??
        (await context.node(wakeup.actorId, proposal.resolvedUntil));
      if (
        actor?.kind !== "existence" ||
        wakeup.at < proposal.resolvedUntil ||
        (request.phase !== "schedule" && wakeup.at <= request.at)
      )
        throw new CandidateRejected("再起動の主体・時点が不正です");
    }
    return context.dependencies;
  }

  async run(id: string, resumeInput?: string): Promise<WorldProposal> {
    z.uuid().parse(id);
    const activated = await this.#activate(id);
    const { row, claim } = activated;
    let { lease } = activated;
    if (row.state === "complete" && row.result) return row.result;
    if (
      row.state === "paused" &&
      (resumeInput !== undefined ||
        (await this.model.ledger.state(callId(id, row.epoch, row.step))) !==
          "complete")
    ) {
      row.epoch++;
      row.step = 0;
      if (row.messages)
        row.messages.push({
          role: "user",
          content: JSON.stringify({ resume: true, input: resumeInput ?? null }),
        });
      await this.#save(row, claim);
    }
    const ask = task(
      "world-thought",
      async (input: { id: string; messages: ChatMessage[] }) =>
        this.model.complete(input.id, "world-update", input.messages),
    );
    const query = task(
      "world-query",
      async (input: { row: Operation; requests: z.infer<typeof Query>[] }) =>
        this.#queries(input.row, input.requests),
    );
    const commit = task(
      "world-commit",
      async (input: { dependencies: Dependency[]; candidate: WorldProposal }) =>
        this.store.commit(
          lease,
          this.store.context(row.request.worldId, input.dependencies),
          {
            commitId: row.commit_id,
            at: input.candidate.resolvedUntil,
            changes: input.candidate.changes,
          },
        ),
    );
    const workflow = entrypoint(
      { name: "world-operation", checkpointer: this.checkpointer },
      async () => {
        for (;;) {
          const receipt = await this.store.receipt(
            row.request.worldId,
            row.commit_id,
          );
          if (receipt) return this.#finish(row, claim);
          try {
            await this.store
              .context(row.request.worldId, row.dependencies)
              .validate();
            if (!row.messages) {
              const requests: z.infer<typeof Query>[] = [];
              for (const root of new Set([
                ...row.request.rootIds,
                ...(row.request.actorId ? [row.request.actorId] : []),
              ])) {
                requests.push(
                  { kind: "node", id: root },
                  {
                    kind: "relations",
                    id: root,
                    relation: "status",
                    direction: "out",
                  },
                  {
                    kind: "relations",
                    id: root,
                    relation: "status",
                    direction: "in",
                  },
                  {
                    kind: "relations",
                    id: root,
                    relation: "has",
                    direction: "out",
                  },
                  { kind: "effects", id: root },
                  { kind: "observations", id: root },
                  {
                    kind: "history",
                    id: root,
                    relation: "see",
                    direction: "out",
                  },
                  {
                    kind: "history",
                    id: root,
                    relation: "happen",
                    direction: "out",
                  },
                  {
                    kind: "relations",
                    id: root,
                    relation: "interpret",
                    direction: "out",
                  },
                );
              }
              const seed = await query({ row, requests });
              row.dependencies = seed.dependencies;
              row.messages = [
                { role: "system", content: row.system_prompt },
                {
                  role: "user",
                  content: JSON.stringify({
                    request: row.request,
                    initialContext: seed.results,
                    responseSchema: z.toJSONSchema(Decision, { io: "input" }),
                  }),
                },
              ];
              await this.#save(row, claim);
            }
            if (row.candidate) {
              await commit({
                candidate: row.candidate,
                dependencies: row.dependencies,
              });
              return this.#finish(row, claim);
            }
            const response = await ask({
              id: callId(id, row.epoch, row.step),
              messages: row.messages,
            });
            if (response.finishReason !== "stop")
              throw new OperationPaused("モデル応答が未完了のため保留します");
            row.messages.push({ role: "assistant", content: response.content });
            row.step++;
            let decision;
            try {
              decision = Decision.parse(JSON.parse(response.content));
            } catch (error) {
              row.messages.push({
                role: "user",
                content: JSON.stringify({
                  validationErrors:
                    error instanceof z.ZodError ? error.issues : "invalid JSON",
                }),
              });
              await this.#save(row, claim);
              continue;
            }
            if (decision.type === "pause") {
              await this.#save(row, claim);
              throw new OperationPaused(decision.reason);
            }
            try {
              if (decision.type === "query") {
                const output = await query({
                  row,
                  requests: decision.requests,
                });
                row.dependencies = output.dependencies;
                row.messages.push({
                  role: "user",
                  content: JSON.stringify({
                    requests: decision.requests,
                    results: output.results,
                  }),
                });
              } else {
                row.dependencies = await this.#validateProposal(row, decision);
                row.candidate = decision;
              }
            } catch (error) {
              if (
                !(error instanceof CandidateRejected) &&
                !(error instanceof z.ZodError)
              )
                throw error;
              row.messages.push({
                role: "user",
                content: JSON.stringify({
                  validationErrors:
                    error instanceof Error
                      ? error.message
                      : "invalid candidate",
                }),
              });
            }
            await this.#save(row, claim);
          } catch (error) {
            if (!(error instanceof WorldConflict)) throw error;
            row.epoch++;
            row.step = 0;
            row.messages = null;
            row.candidate = null;
            row.dependencies = [];
            await this.#save(row, claim);
            const renewed = await this.#activate(id, claim);
            lease = renewed.lease;
          }
        }
      },
    );
    try {
      return await workflow.invoke(
        {},
        { configurable: { thread_id: `${id}:${claim}` } },
      );
    } catch (error) {
      await this.pool.query(
        "UPDATE world_operation SET state='paused',pause_reason=$3 WHERE id=$1 AND claim_key=$2 AND state<>'complete'",
        [id, claim, error instanceof Error ? error.message : "paused"],
      );
      throw error;
    }
  }

  async view(worldId: string, observerId: string, at: number) {
    const context = this.store.context(worldId);
    if ((await context.node(observerId, at))?.kind !== "existence")
      throw new Error("観測主体が見つかりません");
    const observations = await context.history(observerId, "see", "out", at);
    const interpretations = [];
    for (const relation of await context.relations(
      observerId,
      "interpret",
      "out",
      at,
    )) {
      if (relation.role !== "content") continue;
      const content = await context.node(relation.target, at);
      if (content?.kind !== "script") continue;
      interpretations.push({
        text: content.text,
        about: (await context.relations(content.id, "interpret", "out", at))
          .filter((edge) => edge.role === "about")
          .map((edge) => edge.target),
      });
    }
    await context.validate();
    return {
      observerId,
      at,
      observations: observations.map((edge) => ({
        id: edge.id,
        target: edge.target,
        text: edge.observation?.aspect || edge.text || null,
        period: edge.period,
      })),
      interpretations,
    };
  }

  async intent(worldId: string, observerId: string, at: number, id: string) {
    const view = await this.view(worldId, observerId, at);
    const system = await readFile(
      new URL("../../../../prompts/actor-intent.md", import.meta.url),
      "utf8",
    );
    const ask = task("actor-intent", async () =>
      this.model.complete(id, "intent", [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(view) },
      ]),
    );
    const workflow = entrypoint(
      { name: "actor-intent", checkpointer: this.checkpointer },
      async () => ask(),
    );
    const response = await workflow.invoke(
      {},
      { configurable: { thread_id: `${id}:intent` } },
    );
    if (response.finishReason !== "stop")
      throw new OperationPaused("行動意図の応答が未完了です");
    return z
      .object({ actionText: z.string().min(1) })
      .strict()
      .parse(JSON.parse(response.content)).actionText;
  }
}
