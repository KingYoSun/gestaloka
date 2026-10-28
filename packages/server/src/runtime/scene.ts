import { RuntimeExecutions } from "./executions.js";
import {
  InformationReference,
  type Information,
  type Presentation,
  type InspectionManifest,
} from "@gestaloka/contracts";
import {
  captureSceneInformation,
  recordPresentations,
} from "../inspection/record.js";
import { McpOrigin } from "../http/mcp-origin.js";
import { RuntimeControl, RuntimeStopped } from "./control.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { parseOutput } from "../llm/prompt.js";
import { ExecutionLimit } from "../execution-budget.js";
import type pg from "pg";
import type { ChatMessage } from "../llm/client.js";
import type { Dependency } from "../world/store.js";
import {
  Query,
  IntentResult,
  type Interaction,
  SupersededWorker,
  type WorldProposal,
} from "./agent.js";
import {
  ConstructionStateError,
  type Construction,
  type WorldConstruction,
} from "./construction.js";
import {
  SceneBackground,
  SceneContext,
  ContextNeed,
  SceneStep,
  sceneAnchors,
  sceneAgenda,
  sceneId,
  sceneView,
  presentationEvidence,
  type RecordedSceneEvent,
  type SceneIntent,
  type SceneView,
} from "./scene-data.js";

const BackgroundDecision = z.discriminatedUnion("type", [
  SceneBackground,
  SceneContext,
  z
    .object({ type: z.literal("query"), requests: z.array(Query).min(1) })
    .strict(),
  z.object({ type: z.literal("pause"), reason: z.string() }).strict(),
]);
const Narrative = z
  .object({
    text: z.string().min(1),
    information: z.array(InformationReference).optional(),
  })
  .strict();
async function scenePrompt(file: string, information = true) {
  const files = [file, ...(information ? ["presentation-information.md"] : [])];
  return (
    await Promise.all(
      files.map((name) =>
        readFile(
          new URL(`../../../../prompts/${name}`, import.meta.url),
          "utf8",
        ),
      ),
    )
  ).join("\n\n");
}
type Work = {
  id: string;
  kind: "background" | "resolve" | "intent" | "result";
  messages: ChatMessage[];
  target: "default" | "resolution";
};
export type SceneData = {
  recordingVersion?: "inspection-record-v1" | "inspection-record-v2";
  informationBasis?: Record<string, Information>;
  presentations?: Presentation[];
  resultInformation?: z.infer<typeof InformationReference>[];
  reflectionResponseId?: string;
  commandId: string;
  requestId?: string;
  worldId: string;
  at: number;
  startedAt: number;
  purpose: string;
  character?: NonNullable<InspectionManifest["declaredContext"]>["character"];
  roots: string[];
  originalAgenda: Construction["agenda"];
  basis: Dependency[];
  backgroundMessages?: ChatMessage[];
  background?: SceneBackground;
  contextNeed?: z.infer<typeof ContextNeed>;
  contextRequests?: {
    inputId: string;
    at: number;
    reason: string;
    remainingActions: Record<string, string>;
  }[];
  views: Record<string, SceneView>;
  events: RecordedSceneEvent[];
  pending: Record<string, SceneIntent>;
  intentions: Record<string, SceneIntent>;
  choices: SceneIntent[];
  actions: {
    id: string;
    text: string;
    state: "running" | "complete" | "boundary";
    submittedAt?: string;
    completedAt?: string;
  }[];
  nextDecisions: string[];
  previous: Record<string, SceneIntent>;
  work?: Work;
  operationId?: string;
  projection?: WorldProposal;
  result?: string;
  nextPurpose?: string;
  resumeState?: SceneRow["state"];
  error?: string;
  limitReached?: boolean;
  suspended?: boolean;
};
export type SceneRow = {
  id: string;
  construction_id: string;
  user_id?: string | null;
  actor_id: string;
  state:
    | "preparing"
    | "ready"
    | "active"
    | "acting"
    | "reflecting"
    | "result"
    | "paused";
  claim: string | null;
  data: SceneData;
};

export class WorldScenes {
  readonly queueName: string;
  constructor(readonly construction: WorldConstruction) {
    this.queueName = `${construction.queueName}-scenes`;
  }
  get pool() {
    return this.construction.pool;
  }
  get agent() {
    return this.construction.agent;
  }
  async setup() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_scene (
      id uuid PRIMARY KEY, construction_id uuid NOT NULL REFERENCES world_construction(id) ON DELETE CASCADE,
      actor_id uuid NOT NULL,state text NOT NULL,data jsonb NOT NULL,claim uuid,
      created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS world_scene_latest ON world_scene(construction_id,created_at DESC,id DESC);`);
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS world_scene_actor_latest ON world_scene(construction_id,actor_id,created_at DESC,id DESC)",
    );
    await this.pool
      .query(`UPDATE world_construction c SET state='finished',claim=NULL,error=NULL
      WHERE c.state IN ('playing','play_paused') AND EXISTS(SELECT 1 FROM world_scene s WHERE s.construction_id=c.id AND s.actor_id=c.participant_id)
      AND NOT EXISTS(SELECT 1 FROM world_run r WHERE r.construction_id=c.id AND r.state IN ('running','paused'))`);
    await this.pool.query(
      "ALTER TABLE world_scene ADD COLUMN IF NOT EXISTS user_id uuid",
    );
    await this.pool.query(
      "ALTER TABLE world_scene ADD COLUMN IF NOT EXISTS inspection_revision bigint NOT NULL DEFAULT 0",
    );
    await this.construction.queue.createQueue(this.queueName, {
      retryLimit: 2,
      retryDelay: 5,
      expireInSeconds: 900,
      heartbeatSeconds: 30,
    });
  }
  async latest(
    world: string,
    client: Pick<pg.Pool, "query"> = this.pool,
    compact = false,
    actorId?: string,
  ) {
    return (
      (
        await client.query<SceneRow>(
          compact
            ? `SELECT id,construction_id,actor_id,state,claim,jsonb_build_object(
              'commandId',data->'commandId','at',data->'at','startedAt',data->'startedAt',
              'background',jsonb_build_object('synopsis',data#>'{background,synopsis}'),
              'events','[]'::jsonb,'actions',CASE WHEN jsonb_array_length(data->'actions')>0 THEN jsonb_build_array(data->'actions'->-1) ELSE '[]'::jsonb END,
              'result',data->'result','nextPurpose',data->'nextPurpose','limitReached',data->'limitReached') AS data
              FROM world_scene WHERE construction_id=$1 AND ($2::uuid IS NULL OR actor_id=$2) ORDER BY created_at DESC,id DESC LIMIT 1`
            : "SELECT * FROM world_scene WHERE construction_id=$1 AND ($2::uuid IS NULL OR actor_id=$2) ORDER BY created_at DESC,id DESC LIMIT 1",
          [world, actorId ?? null],
        )
      ).rows[0] ?? null
    );
  }
  async #transaction<T>(fn: (client: pg.PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async #enqueue(client: pg.PoolClient, id: string) {
    await McpOrigin.capture(client, "scene", id);
    await this.construction.queue.send(
      this.queueName,
      { id },
      { db: { executeSql: (text, values) => client.query(text, values) } },
    );
  }
  async #save(row: SceneRow, client?: pg.PoolClient, expected?: string) {
    if (row.data.recordingVersion === "inspection-record-v2")
      await captureSceneInformation(row, this.agent.store);
    recordPresentations(row);
    const save = async (c: pg.PoolClient) => {
      const result = await c.query(
        "UPDATE world_scene SET state=$2,data=$3,claim=$4,inspection_revision=inspection_revision+1 WHERE id=$1 AND ($5::uuid IS NULL OR claim=$5)",
        [
          row.id,
          row.state,
          JSON.stringify(row.data),
          row.claim,
          expected ?? null,
        ],
      );
      if (result.rowCount !== 1)
        throw new SupersededWorker("シーンの実行が引き継がれました");
      await c.query(
        `INSERT INTO world_event(subject_id,construction_id,role,event_key)
        SELECT subject_id,construction_id,role,gen_random_uuid()::text FROM world_access WHERE construction_id=$1`,
        [row.construction_id],
      );
    };
    return client ? save(client) : this.#transaction(save);
  }
  async open(
    world: string,
    purpose: string,
    client: pg.PoolClient,
    requestId: string,
    actorId?: string,
  ) {
    await RuntimeControl.check(client, {}, true);
    const c = await this.construction.get(world, client, true);
    const actor = actorId ?? c.participant_id;
    const prior = actor ? await this.latest(world, client, true, actor) : null;
    if (
      !["finished", "playing", "play_paused"].includes(c.state) ||
      !actor ||
      (prior && prior.state !== "result") ||
      (actor === c.participant_id && c.state !== "finished")
    )
      throw new ConstructionStateError(
        "前の処理を終えてからシーンを準備してください",
      );
    const row: SceneRow = {
      id: requestId,
      construction_id: world,
      actor_id: actor,
      state: "preparing",
      claim: null,
      data: {
        recordingVersion: "inspection-record-v2",
        reflectionResponseId: sceneId(`${requestId}:reflection`),
        commandId: requestId,
        requestId,
        worldId: c.world_id!,
        at: c.at,
        startedAt: c.at,
        purpose,
        character:
          (
            await client.query(
              "SELECT jsonb_build_object('presetId',j.preset_id,'version',j.preset_version,'settings',o.request->>'actionText','registrationAt',j.at) AS value FROM world_join j JOIN world_operation o ON o.id=j.operation_id WHERE j.construction_id=$1 AND j.actor_id=$2 ORDER BY j.id LIMIT 1",
              [world, actor],
            )
          ).rows[0]?.value ?? null,
        roots: [...new Set([actor, ...c.root_ids])],
        originalAgenda: c.agenda,
        basis: [],
        views: {},
        events: [],
        pending: {},
        intentions: {},
        choices: [],
        actions: [],
        nextDecisions: [],
        previous: {},
      },
    };
    await client.query(
      "INSERT INTO world_scene(id,construction_id,actor_id,state,data) VALUES($1,$2,$3,$4,$5)",
      [row.id, world, row.actor_id, row.state, JSON.stringify(row.data)],
    );
    await client.query(
      "INSERT INTO world_controlled_actor(world_id,actor_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [c.world_id, actor],
    );
    await this.#enqueue(client, row.id);
    return row;
  }
  async command(
    world: string,
    command: "start" | "finish" | "resume" | "act",
    client: pg.PoolClient,
    input: { requestId: string; actionText?: string },
    actorId?: string,
  ) {
    await RuntimeControl.check(client, {}, true);
    const c = await this.construction.get(world, client, true),
      row = await this.latest(
        world,
        client,
        false,
        actorId ?? c.participant_id ?? undefined,
      );
    if (!row || (actorId && row.actor_id !== actorId))
      throw new ConstructionStateError("現在のシーンを取得してください");
    if (command === "start") {
      if (row.state !== "ready")
        throw new ConstructionStateError("あらすじの準備完了を待ってください");
      row.state = "active";
    } else if (command === "resume") {
      if (row.state !== "paused")
        throw new ConstructionStateError("保留中のシーンを指定してください");
      row.state = row.data.resumeState!;
      if (
        row.data.work &&
        (await this.agent.model.ledger.state(row.data.work.id)) === "pending"
      )
        throw new ConstructionStateError(
          "送信済み要求の結果が未確定です。自動では再送しません",
        );
      if (row.data.work && !row.data.limitReached && !row.data.suspended) {
        row.data.work = {
          ...row.data.work,
          id: randomUUID(),
          messages: [
            ...row.data.work.messages,
            {
              role: "user",
              content: JSON.stringify({ validationError: row.data.error }),
            },
          ],
        };
      }
      delete row.data.error;
      delete row.data.limitReached;
      delete row.data.suspended;
    } else {
      if (row.state !== "active")
        throw new ConstructionStateError(
          "シーンが操作可能になってから入力してください",
        );
      row.data.requestId = input.requestId;
      if (command === "finish") row.state = "reflecting";
      else {
        row.state = "acting";
        row.data.actions.push({
          id: input.requestId,
          text: input.actionText!,
          state: "running",
          submittedAt: new Date().toISOString(),
        });
        const intent = {
          actorId: row.actor_id,
          actionText: input.actionText!,
          continuing:
            row.data.pending[row.actor_id]?.actionText === input.actionText,
        };
        row.data.pending[row.actor_id] = intent;
        row.data.intentions[row.actor_id] = intent;
        row.data.choices.push(intent);
      }
    }
    row.data.commandId = input.requestId;
    row.claim = null;
    await this.#save(row, client);
    if (!["active", "ready"].includes(row.state))
      await this.#enqueue(client, row.id);
    return row;
  }
  #budget(row: SceneRow) {
    return row.state === "preparing"
      ? row.id
      : row.state === "acting"
        ? row.data.actions.at(-1)!.id
        : sceneId(`${row.id}:reflection`);
  }

  async #ask(
    row: SceneRow,
    kind: Work["kind"],
    file: string,
    input: unknown,
    target: Work["target"] = "default",
  ) {
    if (!row.data.work) {
      row.data.work = {
        id: randomUUID(),
        kind,
        target,
        messages: [
          {
            role: "system",
            content: await scenePrompt(file, kind !== "intent"),
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
      };
      await this.#save(row, undefined, row.claim!);
    }
    const work = row.data.work,
      response = await this.agent.model.complete(
        work.id,
        `scene-${kind}`,
        work.messages,
        work.target,
      );
    if (response.finishReason !== "stop")
      throw new Error("シーンのモデル応答が未完了です");
    return {
      content: response.content,
      value: presentationEvidence(parseOutput(response.content)),
    };
  }
  #request(row: SceneRow): z.infer<typeof Interaction> {
    return {
      worldId: row.data.worldId,
      at: row.data.at,
      until: row.data.at,
      phase: "observation",
      rootIds: row.data.roots,
      actorId: row.actor_id,
      actionText: row.data.purpose,
    };
  }
  async #background(row: SceneRow) {
    const d = row.data,
      request = {
        ...this.#request(row),
        actionText: d.contextNeed?.reason ?? d.purpose,
      };
    if (!d.backgroundMessages) {
      const context = await this.agent.context(request, d.basis);
      d.basis = context.dependencies;
      d.backgroundMessages = [
        {
          role: "user",
          content: JSON.stringify({
            request,
            initialContext: context.initialContext,
            controlledActorIds: context.controlledActorIds,
            ...(d.contextNeed
              ? {
                  needsContext: d.contextNeed,
                  stagedScene: {
                    background: d.background,
                    events: d.events,
                    intentions: Object.values(d.pending),
                  },
                }
              : {}),
            responseSchema: z.toJSONSchema(BackgroundDecision, { io: "input" }),
          }),
        },
      ];
    }
    for (;;) {
      if (!d.work) {
        d.work = {
          id: randomUUID(),
          kind: "background",
          target: "resolution",
          messages: [
            {
              role: "system",
              content: await scenePrompt("scene-background.md"),
            },
            ...d.backgroundMessages,
          ],
        };
        await this.#save(row, undefined, row.claim!);
      }
      const response = await this.#ask(
          row,
          "background",
          "scene-background.md",
          {},
        ),
        answer = BackgroundDecision.parse(response.value);
      let decision = answer;
      if (decision.type === "pause") throw new Error(decision.reason);
      if (decision.type === "query") {
        const read = await this.agent.read(
          { request, dependencies: d.basis },
          decision.requests,
        );
        d.basis = read.dependencies;
        d.backgroundMessages.push(
          { role: "assistant", content: response.content },
          {
            role: "user",
            content: JSON.stringify({
              requests: decision.requests,
              results: read.results,
              controlledActorIds: read.controlledActorIds,
            }),
          },
        );
        delete d.work;
        await this.#save(row, undefined, row.claim!);
        continue;
      }
      if (d.contextNeed) {
        if (answer.type !== "context")
          throw new Error("進行中の背景は追記として補ってください");
        const prior = d.background!;
        decision = {
          ...prior,
          participants: [
            ...new Set([...prior.participants, ...answer.participants]),
          ],
          facts: [
            ...prior.facts,
            ...answer.facts.map((f) => ({ ...f, at: d.at })),
          ],
          beliefs: [
            ...prior.beliefs,
            ...answer.beliefs.map((f) => ({ ...f, at: d.at })),
          ],
          creations: [...prior.creations, ...answer.creations],
          unknowns: prior.unknowns.filter(
            (u) => !answer.resolvedUnknowns.includes(u),
          ),
        };
        if (
          !answer.facts.length &&
          !answer.beliefs.length &&
          !answer.creations.length &&
          decision.participants.length === prior.participants.length
        )
          throw new Error(
            "不足文脈を補う変更がありません。世界の条件を確認してください",
          );
      }
      if (decision.type !== "background")
        throw new Error("開始時の背景が必要です");
      if (!decision.participants.includes(row.actor_id))
        throw new Error("背景情報に操作する本人が含まれていません");
      const controlled = await this.agent.controlledActors(
        d.worldId,
        [
          ...new Set([
            ...decision.participants,
            ...decision.facts.map((f) => f.subjectId),
            ...decision.beliefs.map((f) => f.subjectId),
            ...decision.perceptions.map((p) => p.observerId),
          ]),
        ].filter((id) => id !== row.actor_id),
      );
      if (controlled.size)
        throw new Error(
          "他プレイヤーをNPCの登場主体にできません。共有世界に確定済みの行動・返答は背景として参照してください",
        );
      const creations = new Set(decision.creations.map((n) => n.id)),
        context = this.agent.store.context(d.worldId, d.basis),
        known = new Set<string>();
      const refs = new Set([
        ...decision.participants,
        ...decision.facts.flatMap((f) => [f.subjectId, ...f.aboutIds]),
        ...decision.beliefs.flatMap((f) => [f.subjectId, ...f.aboutIds]),
        ...decision.perceptions.flatMap((p) => [p.observerId, ...p.sourceIds]),
      ]);
      for (const id of refs) {
        const node = await context.node(id, d.at);
        if (creations.has(id)) {
          if (node) throw new Error("既存の同一性を作り直すことはできません");
        } else {
          if (!node) throw new Error(`背景情報の参照が取得できません: ${id}`);
          known.add(id);
        }
      }
      for (const p of decision.perceptions)
        if (!decision.participants.includes(p.observerId))
          throw new Error("観測主体が登場人物ではありません");
      const graph = sceneAnchors(decision, [], d.at, row.id),
        connected = new Set(known);
      for (let changed = true; changed;) {
        changed = false;
        for (const e of graph.edges)
          if (connected.has(e.source) || connected.has(e.target)) {
            if (!connected.has(e.source) || !connected.has(e.target))
              changed = true;
            connected.add(e.source);
            connected.add(e.target);
          }
      }
      if (graph.nodes.some((n) => !connected.has(n.id)))
        throw new Error("背景情報が既存世界に接続していません");
      d.basis = context.dependencies;
      const actual = decision.participants.filter((id) => !creations.has(id));
      if (actual.length) {
        const context = await this.agent.context(
          { ...request, rootIds: actual },
          d.basis,
        );
        d.basis = context.dependencies;
      }
      for (const id of decision.participants)
        d.views[id] ??= creations.has(id)
          ? { observerId: id, at: d.at, observations: [], interpretations: [] }
          : await this.agent.view(d.worldId, id, d.at);
      await this.agent.store.context(d.worldId, d.basis).validate();
      d.background = decision;
      delete d.work;
      delete d.backgroundMessages;
      const extending = !!d.contextNeed;
      delete d.contextNeed;
      if (!extending) row.state = "ready";
      await this.#save(row, undefined, row.claim!);
      return;
    }
  }
  async #action(row: SceneRow) {
    const d = row.data,
      action = d.actions.at(-1)!;
    for (;;) {
      if (d.contextNeed) await this.#background(row);
      const bg = d.background!;
      if (!d.pending[row.actor_id] && !d.nextDecisions.includes(row.actor_id)) {
        action.state = "complete";
        row.state = "active";
        await this.#save(row, undefined, row.claim!);
        return false;
      }
      if (d.nextDecisions.length) {
        if (
          (
            await this.agent.controlledActors(d.worldId, [d.nextDecisions[0]!])
          ).has(d.nextDecisions[0]!)
        )
          break;
        const actor = d.nextDecisions[0]!,
          own = [
            ...(d.previous[actor] ? [d.previous[actor]!.actionText] : []),
            ...d.originalAgenda
              .filter((w) => w.actorId === actor)
              .flatMap((w) => [
                ...(w.previousActions ?? []),
                ...(w.actionText ? [w.actionText] : []),
              ]),
          ];
        const value = await this.#ask(
          row,
          "intent",
          "actor-intent.md",
          sceneView(
            d.views[actor]!,
            bg,
            d.events,
            own,
            d.at,
            d.choices
              .filter((i) => i.actorId === actor)
              .map((i) => i.actionText),
          ),
        );
        const choice = {
          actorId: actor,
          actionText: IntentResult.parse(value.value).actionText,
          continuing: false,
        };
        d.pending[actor] = choice;
        d.intentions[actor] = choice;
        d.choices.push(choice);
        d.nextDecisions.shift();
        delete d.work;
        await this.#save(row, undefined, row.claim!);
        continue;
      }
      const intents = Object.values(d.pending),
        value = await this.#ask(row, "resolve", "scene-play.md", {
          background: bg,
          sceneHistory: d.events,
          request: {
            at: d.at,
            controlledActorId: row.actor_id,
            controlledActionText: action.text,
            intentions: intents,
          },
          responseSchema: z.toJSONSchema(SceneStep, { io: "input" }),
        }),
        step = SceneStep.parse(value.value);
      if (step.type === "boundary") break;
      const actors = new Set(intents.map((i) => i.actorId));
      if (
        Object.keys(step.decisions).sort().join() !== [...actors].sort().join()
      )
        throw new Error("シーンで未解決の意図が省略されています");
      const returnsControl =
        step.decisions[row.actor_id] === "finished" ||
        step.decisions[row.actor_id] === "decide" ||
        step.newDecisions.includes(row.actor_id);
      for (const e of step.events) {
        if (
          !actors.has(e.actorId) ||
          e.receipts.some((p) => !bg.participants.includes(p.observerId)) ||
          new Set(e.receipts.map((p) => p.observerId)).size !==
            e.receipts.length
        )
          throw new Error("シーンの行動主体または受容先が不正です");
      }
      for (const id of step.newDecisions)
        if (!bg.participants.includes(id) || actors.has(id))
          throw new Error("本人の判断の割当が不正です");
      const nextAt = d.at + step.elapsedMs;
      if (!Number.isSafeInteger(nextAt))
        throw new Error("シーンの経過時点が不正です");
      for (const e of step.events)
        d.events.push({
          ...e,
          inputId: action.id,
          id: sceneId(`${row.id}:event:${d.events.length}`),
          period: { from: d.at, until: nextAt },
        });
      d.at = nextAt;
      d.previous = { ...d.pending };
      for (const [id, status] of Object.entries(step.decisions)) {
        if (status !== "pending") delete d.pending[id];
        else d.pending[id]!.continuing = true;
      }
      d.nextDecisions = [
        ...new Set([
          ...step.newDecisions,
          ...Object.entries(step.decisions)
            .filter(
              ([id, status]) => id !== row.actor_id && status === "decide",
            )
            .map(([id]) => id),
        ]),
      ];
      delete d.work;
      if (step.needsContext && !returnsControl) {
        const need = {
          ...step.needsContext,
          remainingActions: Object.fromEntries(
            Object.entries(step.needsContext.remainingActions).filter(
              ([id]) => d.pending[id],
            ),
          ),
        };
        for (const [id, text] of Object.entries(need.remainingActions)) {
          d.pending[id] = {
            ...d.pending[id]!,
            actionText: text,
            continuing: true,
          };
        }
        d.contextNeed = need;
        (d.contextRequests ??= []).push({
          inputId: action.id,
          at: d.at,
          ...need,
        });
        await this.#save(row, undefined, row.claim!);
        continue;
      }
      if (
        step.decisions[row.actor_id] === "finished" ||
        step.decisions[row.actor_id] === "decide" ||
        step.newDecisions.includes(row.actor_id)
      ) {
        action.state = "complete";
        row.state = "active";
        d.nextDecisions = d.nextDecisions.filter((id) => id !== row.actor_id);
        await this.#save(row, undefined, row.claim!);
        return false;
      }
      if (!d.nextDecisions.length && !step.events.length && !step.elapsedMs)
        break;
      await this.#save(row, undefined, row.claim!);
    }
    d.nextPurpose = action.text;
    action.state = "boundary";
    row.state = "reflecting";
    delete d.work;
    await this.#save(row, undefined, row.claim!);
    return true;
  }
  async #reflect(row: SceneRow) {
    const d = row.data;
    if (!d.operationId) {
      d.operationId = await this.agent.create(
        {
          worldId: d.worldId,
          phase: "resolution",
          at: d.startedAt,
          until: d.at,
          rootIds: [...new Set([...d.roots, ...d.background!.participants])],
          controlledActorId: row.actor_id,
          actionText: "",
          intentions: Object.values(d.intentions).map((i) => ({
            ...i,
            continuing: true,
          })),
          completedScene: {
            background: d.background!,
            events: d.events,
            anchors: sceneAnchors(d.background!, d.events, d.startedAt, row.id),
          },
        },
        row.id,
        this.pool,
        d.basis,
      );
      await this.#save(row, undefined, row.claim!);
    }
    if (!d.projection) {
      d.projection = await this.agent.run(d.operationId);
      await this.#save(row, undefined, row.claim!);
    }
    if (!d.result) {
      const source = await this.resultSource(row);
      const value = await this.#ask(row, "result", "scene-result.md", {
        confirmed: source,
        presented: d.presentations ?? [],
        responseSchema: z.toJSONSchema(Narrative, { io: "input" }),
      });
      const narrative = Narrative.parse(value.value);
      d.result = narrative.text;
      if (narrative.information) d.resultInformation = narrative.information;
    }
    delete d.work;
    row.state = "result";
    await this.#transaction(async (client) => {
      const current = await this.construction.get(
        row.construction_id,
        client,
        true,
      );
      const agenda = sceneAgenda(
        current.agenda,
        row.actor_id,
        d.at,
        d.projection!,
        d.intentions,
        d.nextDecisions,
      );
      await this.#save(row, client, row.claim!);
      await client.query(
        "INSERT INTO construction_log(construction_id,operation_id,at,result) VALUES($1,$2,$3,$4) ON CONFLICT(operation_id) DO NOTHING",
        [
          row.construction_id,
          d.operationId,
          d.at,
          JSON.stringify(d.projection),
        ],
      );
      await client.query(
        "UPDATE world_construction SET at=greatest(at,$2),agenda=$3 WHERE id=$1",
        [row.construction_id, d.at, JSON.stringify(agenda)],
      );
    });
  }
  async resultSource(row: SceneRow) {
    const d = row.data,
      operation = (
        await this.pool.query<{ commit_id: string }>(
          "SELECT commit_id FROM world_operation WHERE id=$1",
          [d.operationId],
        )
      ).rows[0];
    const receipt = operation
      ? await this.agent.store.receipt(d.worldId, operation.commit_id)
      : undefined;
    if (!receipt) throw new Error("世界への確定記録がまだありません");
    const observations = receipt.changes.edges
      .filter((e) => e.kind === "see" && e.source === row.actor_id)
      .map((e) => ({
        id: e.id,
        targetId: e.target,
        text: e.text ?? e.observation?.aspect ?? "",
      }));
    const interpretations = [];
    for (const e of receipt.changes.edges.filter(
      (e) =>
        e.kind === "interpret" &&
        e.role === "content" &&
        e.source === row.actor_id,
    )) {
      const script =
        receipt.changes.nodes.find((n) => n.id === e.target) ??
        (await this.agent.store.context(d.worldId).node(e.target, d.at));
      if (script?.kind === "script")
        interpretations.push({
          id: e.id,
          targetId: script.id,
          text: script.text,
        });
    }
    return {
      synopsis: d.background!.synopsis,
      observations,
      interpretations,
      unfinishedAction: d.projection!.deferredIntentions?.includes(row.actor_id)
        ? d.intentions[row.actor_id]?.actionText
        : null,
    };
  }
  async tick(id: string, jobId?: string) {
    return RuntimeExecutions.run(this.pool, "scene", id, jobId, () =>
      this.#tick(id),
    );
  }
  async #tick(id: string) {
    const claim = randomUUID(),
      row = await this.#transaction(async (client) => {
        const row = (
          await client.query<SceneRow>(
            "SELECT * FROM world_scene WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!row) throw new Error("シーンが見つかりません");
        if (!["preparing", "acting", "reflecting"].includes(row.state))
          return row;
        row.claim = claim;
        await this.#save(row, client);
        return row;
      });
    if (row.claim !== claim) return;
    try {
      await RuntimeControl.check(this.pool, {
        userId: row.user_id ?? undefined,
        worldId: row.data.worldId,
        role: "user",
        actorId: row.actor_id,
      });
      if (row.state === "preparing")
        await this.agent.model.run(
          this.#budget(row),
          () => this.#background(row),
          row.data.worldId,
          row.user_id ?? undefined,
          { role: "user", actorId: row.actor_id },
        );
      else if (row.state === "acting") {
        if (
          await this.agent.model.run(
            this.#budget(row),
            () => this.#action(row),
            row.data.worldId,
            row.user_id ?? undefined,
            { role: "user", actorId: row.actor_id },
          )
        )
          await this.agent.model.run(
            this.#budget(row),
            () => this.#reflect(row),
            row.data.worldId,
            row.user_id ?? undefined,
            { role: "user", actorId: row.actor_id },
          );
      } else
        await this.agent.model.run(
          this.#budget(row),
          () => this.#reflect(row),
          row.data.worldId,
          row.user_id ?? undefined,
          { role: "user", actorId: row.actor_id },
        );
    } catch (error) {
      if (error instanceof SupersededWorker) return;
      row.data.resumeState = row.state;
      row.data.limitReached = error instanceof ExecutionLimit;
      row.data.suspended = error instanceof RuntimeStopped;
      row.data.error =
        error instanceof Error ? error.message : "シーンを保留しました";
      row.state = "paused";
      await this.#save(row, undefined, claim);
      throw error;
    }
  }
  async work() {
    return this.construction.queue.work<{ id: string }>(
      this.queueName,
      { localConcurrency: 2, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        for (const job of jobs)
          try {
            await this.tick(job.data.id, job.id);
          } catch (error) {
            console.error(
              JSON.stringify({
                sceneId: job.data.id,
                error: error instanceof Error ? error.message : "paused",
              }),
            );
          }
      },
    );
  }
}
