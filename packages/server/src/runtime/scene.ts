import { RuntimeExecutions } from "./executions.js";
import { SharedScenes, SceneSelection } from "./shared-scenes.js";
import { SceneDrafts, type SceneDraft } from "./scene-drafts.js";
import type { SharedTurn } from "./shared-turns.js";
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
import { WorldConflict, type Dependency } from "../world/store.js";
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
  SceneResponseError,
  sceneResponse,
  legacyCoverageFailure,
  sceneArrivals,
  sceneAnchors,
  sceneAgenda,
  sceneId,
  sceneView,
  sceneContinuations,
  presentationEvidence,
  type RecordedSceneEvent,
  type SceneIntent,
  type SceneView,
  type SceneEnding,
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
  turns?: true;
  turn?: SharedTurn;
  ending?: SceneEnding;
  drafts?: SceneDraft[];
  departures?: Record<string, number>;
  waitingFor?: string[];
  shared?: true;
  externalActors?: string[];
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
  contextNeed?: z.infer<typeof ContextNeed> & { worldChanged?: true };
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
    actorId?: string;
    leave?: true;
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
  participantResults?: Record<string, z.infer<typeof Narrative>>;
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
  readonly shared: SharedScenes;
  readonly drafts: SceneDrafts;
  constructor(readonly construction: WorldConstruction) {
    this.queueName = `${construction.queueName}-scenes`;
    this.shared = new SharedScenes(construction);
    this.drafts = new SceneDrafts(construction.pool, construction.agent.store);
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
    await this.shared.setup();
    await this.drafts.setup();
  }
  async latest(
    world: string,
    client: Pick<pg.Pool, "query"> = this.pool,
    compact = false,
    actorId?: string,
    sceneId?: string,
  ) {
    const current = sceneId
      ? { scene_id: sceneId }
      : actorId
        ? (
            await client.query<{ scene_id: string }>(
              "SELECT scene_id FROM world_actor_scene WHERE world_id=$1 AND actor_id=$2",
              [world, actorId],
            )
          ).rows[0]
        : undefined;
    const where = current
      ? "id=$1 AND construction_id=$3 AND (actor_id=$2 OR EXISTS(SELECT 1 FROM world_scene_member m WHERE m.scene_id=world_scene.id AND m.actor_id=$2))"
      : "construction_id=$1 AND ($2::uuid IS NULL OR actor_id=$2)";
    const fields = compact
      ? `id,construction_id,actor_id,state,claim,jsonb_build_object(
      'commandId',data->'commandId','at',data->'at','startedAt',data->'startedAt','shared',data->'shared',
      'background',jsonb_build_object('synopsis',data#>'{background,synopsis}', 'synopsisInformation',data#>'{background,synopsisInformation}',
        'perceptions',CASE WHEN $2::uuid IS NULL THEN data#>'{background,perceptions}' ELSE (SELECT coalesce(jsonb_agg(p),'[]') FROM jsonb_array_elements(coalesce(data#>'{background,perceptions}','[]')) p WHERE p->>'observerId'=$2::text) END),
      'events','[]'::jsonb,'actions',CASE WHEN data ? 'shared' THEN
        (SELECT coalesce(jsonb_agg(a),'[]') FROM (SELECT a FROM jsonb_array_elements(data->'actions') WITH ORDINALITY r(a,n) WHERE coalesce(a->>'actorId',actor_id::text)=$2::text ORDER BY n DESC LIMIT 1) own)
        ELSE CASE WHEN jsonb_array_length(data->'actions')>0 THEN jsonb_build_array(data->'actions'->-1) ELSE '[]'::jsonb END END,
      'result',data->'result','resultInformation',data->'resultInformation',
      'participantResults',CASE WHEN $2::uuid IS NOT NULL THEN jsonb_build_object($2::text,data->'participantResults'->$2::text) ELSE data->'participantResults' END,
      'departures',data->'departures','waitingFor',data->'waitingFor',
      'nextPurpose',data->'nextPurpose','limitReached',data->'limitReached') AS data`
      : "*";
    return (
      (
        await client.query<SceneRow>(
          `SELECT ${fields} FROM world_scene WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 1`,
          current
            ? [current.scene_id, actorId ?? null, world]
            : [world, actorId ?? null],
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
  async #enqueue(client: pg.PoolClient, id: string, shared = false) {
    await McpOrigin.capture(client, "scene", id);
    if (shared) return this.shared.wake(client, id);
    await this.construction.queue.send(
      this.queueName,
      { id },
      { db: { executeSql: (text, values) => client.query(text, values) } },
    );
  }
  async #save(row: SceneRow, client?: pg.PoolClient, expected?: string) {
    if (row.data.recordingVersion === "inspection-record-v2")
      await this.drafts.run(row, () =>
        captureSceneInformation(row, this.agent.store),
      );
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
    shared = false,
    kind: "human" | "bot" = "human",
  ) {
    await RuntimeControl.check(client, {}, true);
    const c = await this.construction.get(world, client, true);
    const actor = actorId ?? c.participant_id;
    const prior = actor ? await this.latest(world, client, false, actor) : null;
    if (
      !["finished", "playing", "play_paused"].includes(c.state) ||
      !actor ||
      (prior &&
        prior.state !== "result" &&
        prior.data.departures?.[actor] === undefined &&
        !prior.data.waitingFor?.length) ||
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
        ...(shared ? { shared: true as const, turns: true as const } : {}),
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
      "INSERT INTO world_actor_scene(world_id,actor_id,scene_id) VALUES($1,$2,$3) ON CONFLICT(world_id,actor_id) DO UPDATE SET scene_id=excluded.scene_id",
      [world, actor, row.id],
    );
    if (prior && prior.state !== "result") {
      await this.drafts.inherit(client, row, prior);
      await client.query("UPDATE world_scene SET data=$2 WHERE id=$1", [
        row.id,
        JSON.stringify(row.data),
      ]);
    }
    if (shared)
      await this.shared.open(
        client,
        world,
        actor,
        row.id,
        row.data.at,
        requestId,
        kind,
      );
    await client.query(
      "INSERT INTO world_controlled_actor(world_id,actor_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [c.world_id, actor],
    );
    await this.#enqueue(client, row.id, shared);
    return row;
  }
  async command(
    world: string,
    command: "start" | "finish" | "resume" | "act" | "leave" | "react" | "vote",
    client: pg.PoolClient,
    input: {
      requestId: string;
      actionText?: string | null;
      opportunityId?: string;
      proposalId?: string;
      continue?: boolean;
    },
    actorId?: string,
    sceneId?: string,
    kind: "human" | "bot" = "human",
  ) {
    await RuntimeControl.check(client, {}, true);
    const c = await this.construction.get(world, client, true),
      row = await this.latest(
        world,
        client,
        false,
        actorId ?? c.participant_id ?? undefined,
        sceneId,
      );
    const actor = actorId ?? row?.actor_id;
    if (!row || !actor || (row.actor_id !== actor && !row.data.shared))
      throw new ConstructionStateError("現在のシーンを取得してください");
    if (
      !["finish", "resume"].includes(command) &&
      row.data.departures?.[actor] !== undefined
    )
      throw new ConstructionStateError(
        "退出済みです。次のシーンを準備できます",
      );
    if (
      ["start", "finish", "resume"].includes(command) &&
      row.actor_id !== actor
    )
      throw new ConstructionStateError("開始者が操作してください");
    if (command === "leave" && !row.data.shared)
      throw new ConstructionStateError("共有シーンの退出を指定してください");
    if (
      row.data.turns &&
      command !== "start" &&
      !(
        command === "resume" &&
        !["rounds", "inactive"].includes(
          (await this.shared.turns.control(row.id, client)).flow,
        )
      )
    ) {
      await this.shared.turns.submit(client, row, actor, kind, {
        ...input,
        command,
      });
      return (await this.latest(world, client, false, actor, row.id))!;
    }
    if (command === "react" || command === "vote")
      throw new ConstructionStateError("共有シーンを指定してください");
    if (command === "start") {
      if (row.state !== "ready")
        throw new ConstructionStateError("あらすじの準備完了を待ってください");
      row.state = "active";
    } else if (command === "resume") {
      if (row.state !== "paused")
        throw new ConstructionStateError("保留中のシーンを指定してください");
      row.state = row.data.resumeState!;
      const workState =
        row.data.work &&
        (await this.agent.model.ledger.state(row.data.work.id));
      if (workState === "pending")
        throw new ConstructionStateError(
          "送信済み要求の結果が未確定です。自動では再送しません",
        );
      if (
        row.data.work &&
        !row.data.limitReached &&
        !row.data.suspended &&
        !(
          row.data.work.kind === "resolve" &&
          legacyCoverageFailure(row.data.error)
        ) &&
        !(
          row.data.work.kind === "background" &&
          workState === "complete" &&
          row.data.events.some(
            (event) =>
              row.data.error === `背景情報の参照が取得できません: ${event.id}`,
          )
        )
      ) {
        const rejected = (
          await this.pool.query(
            "SELECT response ? 'rejection' AS rejected FROM llm_call WHERE id=$1",
            [row.data.work.id],
          )
        ).rows[0]?.rejected;
        if (rejected) delete row.data.work;
        else
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
          ...(row.data.shared ? { actorId: actor } : {}),
          ...(command === "leave" ? { leave: true as const } : {}),
          id: input.requestId,
          text: command === "leave" ? "この場から退出する" : input.actionText!,
          state: "running",
          submittedAt: new Date().toISOString(),
        });
        const intent = {
          actorId: actor,
          actionText: row.data.actions.at(-1)!.text,
          continuing: row.data.pending[actor]?.actionText === input.actionText,
        };
        row.data.pending[actor] = intent;
        row.data.intentions[actor] = intent;
        row.data.choices.push(intent);
      }
    }
    row.data.commandId = input.requestId;
    row.claim = null;
    await this.#save(row, client);
    if (row.data.shared) {
      await client.query(
        "UPDATE world_scene_member SET last_request_id=$3 WHERE scene_id=$1 AND actor_id=$2",
        [row.id, actorId ?? row.actor_id, input.requestId],
      );
      if (command === "start")
        for (const m of await this.shared.members(row.id, client))
          if (m.state === "joined")
            await this.shared.notice(
              client,
              world,
              m.actor_id,
              row.id,
              "scene_started",
            );
    }
    if (!["active", "ready"].includes(row.state))
      await this.#enqueue(client, row.id, !!row.data.shared);
    return row;
  }
  #budget(row: SceneRow) {
    return row.state === "preparing"
      ? row.id
      : row.state === "acting"
        ? (row.data.turn?.id ?? row.data.actions.at(-1)!.id)
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
      throw new SceneResponseError("シーンのモデル応答が未完了です");
    if (kind === "resolve" || kind === "intent")
      await this.agent.store
        .context(row.data.worldId, row.data.basis)
        .validate();
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
  async #participation(row: SceneRow): Promise<boolean> {
    const current = await this.shared.get(row.id);
    if (!current || current.phase === "merged") return false;
    let plan = current.plan;
    if (!plan) {
      const request = { ...this.#request(row), actionText: row.data.purpose };
      const context = await this.agent.context(request, row.data.basis);
      row.data.basis = context.dependencies;
      const value = await this.#ask(
        row,
        "background",
        "scene-participation.md",
        {
          request,
          initialContext: context.initialContext,
          controlledActorIds: context.controlledActorIds,
          pendingScenes: await this.shared.candidates(
            row.construction_id,
            context.controlledActorIds,
          ),
          responseSchema: z.toJSONSchema(
            z.discriminatedUnion("type", [
              SceneSelection,
              z
                .object({
                  type: z.literal("query"),
                  requests: z.array(Query).min(1),
                })
                .strict(),
              z
                .object({ type: z.literal("pause"), reason: z.string() })
                .strict(),
            ]),
            { io: "input" },
          ),
        },
        "resolution",
      );
      const answer = z
        .discriminatedUnion("type", [
          SceneSelection,
          z
            .object({
              type: z.literal("query"),
              requests: z.array(Query).min(1),
            })
            .strict(),
          z.object({ type: z.literal("pause"), reason: z.string() }).strict(),
        ])
        .parse(value.value);
      if (answer.type === "pause") throw new Error(answer.reason);
      if (answer.type === "query") {
        const read = await this.agent.read(
          { request, dependencies: row.data.basis },
          answer.requests,
        );
        row.data.basis = read.dependencies;
        row.data.work!.messages.push(
          { role: "assistant", content: value.content },
          {
            role: "user",
            content: JSON.stringify({
              requests: answer.requests,
              results: read.results,
              controlledActorIds: read.controlledActorIds,
              pendingScenes: await this.shared.candidates(
                row.construction_id,
                read.controlledActorIds,
              ),
            }),
          },
        );
        row.data.work!.id = randomUUID();
        await this.#save(row, undefined, row.claim!);
        return this.#participation(row);
      }
      plan = answer;
    }
    const state = await this.shared.select(row.id, plan);
    if (state.phase !== "settled") {
      delete row.data.work;
      await this.#save(row, undefined, row.claim!);
      return false;
    }
    row.data.externalActors = (await this.shared.members(row.id))
      .filter((m) => m.state === "joined")
      .map((m) => m.actor_id);
    await this.#refreshContext(row);
    return true;
  }
  async #refreshContext(row: SceneRow) {
    const d = row.data;
    if (row.state === "preparing") {
      const latest = await this.construction.get(row.construction_id);
      d.at = d.startedAt = Math.max(d.at, latest.at);
      d.originalAgenda = latest.agenda;
      d.roots = [...new Set([row.actor_id, ...latest.root_ids])];
      d.views = {};
    } else if (row.state === "acting") {
      d.contextNeed ??= {
        worldChanged: true,
        reason:
          "共有世界の更新後の状態を確認し、未実行の行動に必要な背景だけを補う。追加が不要なら空のcontextを返す。",
        remainingActions: Object.fromEntries(
          Object.values(d.pending).map((i) => [i.actorId, i.actionText]),
        ),
      };
    }
    d.basis = [];
    delete d.backgroundMessages;
    if (row.state !== "reflecting") delete d.work;
    await this.#save(row, undefined, row.claim!);
  }
  async #background(row: SceneRow) {
    // An older worker may have paused with a completed call based on stale reads.
    if (row.data.work && row.data.basis.length)
      await this.agent.store
        .context(row.data.worldId, row.data.basis)
        .validate();
    if (
      row.data.shared &&
      !row.data.background &&
      !row.data.externalActors &&
      !(await this.#participation(row))
    )
      return;
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
            acceptedPlayerIds: d.externalActors ?? [row.actor_id],
            ...(d.drafts?.length ? { priorScenes: d.drafts } : {}),
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
          throw new SceneResponseError(
            "進行中の背景は追記として補ってください",
          );
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
          !d.contextNeed.worldChanged &&
          !answer.facts.length &&
          !answer.beliefs.length &&
          !answer.creations.length &&
          decision.participants.length === prior.participants.length
        )
          throw new SceneResponseError(
            "不足文脈を補う変更がありません。世界の条件を確認してください",
          );
      }
      if (decision.type !== "background")
        throw new SceneResponseError("開始時の背景が必要です");
      if (!decision.participants.includes(row.actor_id))
        throw new SceneResponseError(
          "背景情報に操作する本人が含まれていません",
        );
      const controlled = await this.agent.controlledActors(
        d.worldId,
        [
          ...new Set([
            ...decision.participants,
            ...decision.facts.map((f) => f.subjectId),
            ...decision.beliefs.map((f) => f.subjectId),
            ...decision.perceptions.map((p) => p.observerId),
          ]),
        ].filter((id) => !(d.externalActors ?? [row.actor_id]).includes(id)),
      );
      if (controlled.size)
        throw new SceneResponseError(
          "他プレイヤーをNPCの登場主体にできません。共有世界に確定済みの行動・返答は背景として参照してください",
        );
      const creations = new Set(decision.creations.map((n) => n.id)),
        context = this.agent.store.context(d.worldId, d.basis),
        known = new Set<string>();
      const subjects = new Set([
          ...decision.participants,
          ...decision.facts.map((f) => f.subjectId),
          ...decision.beliefs.map((f) => f.subjectId),
          ...decision.perceptions.map((p) => p.observerId),
        ]),
        invalidSubjects: {
          id: string;
          actualKind: string;
          requiredKind: "existence";
        }[] = [];
      const refs = new Set([
        ...decision.participants,
        ...decision.facts.flatMap((f) => [f.subjectId, ...f.aboutIds]),
        ...decision.beliefs.flatMap((f) => [f.subjectId, ...f.aboutIds]),
        ...decision.perceptions.flatMap((p) => [p.observerId, ...p.sourceIds]),
      ]);
      for (const id of refs) {
        const node =
          (await context.node(id, d.at)) ??
          (d.events.some((event) => event.id === id)
            ? { kind: "event" }
            : null);
        if (creations.has(id)) {
          if (node)
            throw new SceneResponseError(
              "既存の同一性を作り直すことはできません",
            );
        } else {
          if (!node)
            throw new SceneResponseError(
              `背景情報の参照が取得できません: ${id}`,
            );
          known.add(id);
          if (subjects.has(id) && node.kind !== "existence")
            invalidSubjects.push({
              id,
              actualKind: node.kind,
              requiredKind: "existence",
            });
        }
      }
      if (invalidSubjects.length)
        throw new z.ZodError(
          invalidSubjects.map((subject) => ({
            code: "custom",
            path: [subject.id],
            params: subject,
            message:
              "登場主体・状態や解釈の所有者・観測者にはexistenceのIDを使います。既存の対象を照会し、未提示の背景だけを修正してください。既存IDの種類や表示済みの記録は変更しません。",
          })),
        );
      for (const p of decision.perceptions)
        if (!decision.participants.includes(p.observerId))
          throw new SceneResponseError("観測主体が登場人物ではありません");
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
        throw new SceneResponseError("背景情報が既存世界に接続していません");
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
          ? {
              observerId: id,
              at: d.at,
              observations: [],
              interpretations: [],
              ...(id === row.actor_id ? {} : { conditions: [] }),
            }
          : id === row.actor_id
            ? await this.agent.view(d.worldId, id, d.at)
            : await this.agent.intentView(d.worldId, id, d.at);
      await this.agent.store.context(d.worldId, d.basis).validate();
      d.background = decision;
      delete d.work;
      delete d.backgroundMessages;
      const extending = !!d.contextNeed;
      delete d.contextNeed;
      if (!extending) row.state = "ready";
      await this.#save(row, undefined, row.claim!);
      if (row.data.shared && !extending)
        await this.shared.transaction(async (db) => {
          for (const member of await this.shared.members(row.id, db))
            if (member.state === "joined")
              await this.shared.notice(
                db,
                row.construction_id,
                member.actor_id,
                row.id,
                "scene_ready",
              );
        });
      return;
    }
  }
  async #action(row: SceneRow) {
    if (row.data.turn && !row.data.turn.inputs.length)
      return this.#completeTurn(row, []);
    const d = row.data,
      action = (
        d.turn
          ? d.actions.find((a) => a.id === d.turn!.inputs[0]!.id)
          : d.actions.at(-1)
      )!,
      actor = action.actorId ?? row.actor_id,
      controlled = d.turn ? d.turn.inputs.map((i) => i.actorId) : [actor];
    for (;;) {
      if (d.contextNeed) await this.#background(row);
      const bg = d.background!;
      if (!d.work) {
        const next = sceneContinuations(
          d.originalAgenda,
          bg.participants.filter(
            (id) =>
              !d.intentions[id] &&
              !d.nextDecisions.includes(id) &&
              !(d.externalActors ?? []).includes(id) &&
              d.departures?.[id] === undefined,
          ),
          actor,
          d.at,
        );
        Object.assign(d.pending, next.pending);
        Object.assign(d.intentions, next.pending);
        d.nextDecisions.push(...next.nextDecisions);
      }
      if (
        !controlled.some((id) => d.pending[id] || d.nextDecisions.includes(id))
      ) {
        if (d.turn) return this.#completeTurn(row, []);
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
        d.views[actor]!.conditions ??= bg.creations.some((c) => c.id === actor)
          ? []
          : (await this.agent.intentView(d.worldId, actor, d.startedAt))
              .conditions;
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
          "resolution",
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
        value = await this.#ask(
          row,
          "resolve",
          "scene-play.md",
          {
            background: bg,
            sceneHistory: d.events,
            controlledView: d.views[actor],
            request: {
              at: d.at,
              controlledActorId: actor,
              ...(d.turn
                ? {
                    controlledActorIds: controlled,
                    playerActorIds: d.externalActors,
                    humanInput: d.turn.sourceKind === "human" && !d.turn.reply,
                    controlledInputs: d.turn.inputs,
                    reactionTo: d.turn.reply
                      ? {
                          inputId: d.turn.sourceId,
                          seenEventIds: Object.fromEntries(
                            d.turn.inputs.map((i) => [i.actorId, i.seen]),
                          ),
                        }
                      : null,
                  }
                : {}),
              controlledInputId: action.id,
              controlledActionText: action.text,
              leavingActorIds: action.leave ? [actor] : [],
              departedActorIds: Object.keys(d.departures ?? {}),
              intentions: intents,
            },
            responseSchema: z.toJSONSchema(SceneStep, { io: "output" }),
          },
          "resolution",
        ),
        step = sceneResponse(value.value);
      if (step.type === "boundary") break;
      if (step.needsContext)
        for (const id of d.turn
          ? Object.keys(step.needsContext.remainingActions)
          : [actor])
          if (step.decisions[id] === "finished") step.decisions[id] = "pending";
      const actors = new Set(intents.map((i) => i.actorId));
      if (
        Object.keys(step.decisions).sort().join() !== [...actors].sort().join()
      )
        throw new SceneResponseError("シーンで未解決の意図が省略されています");
      const returnsControl = d.turn
        ? controlled.every((id) => step.decisions[id] !== "pending")
        : step.decisions[actor] === "finished" ||
          step.decisions[actor] === "decide" ||
          step.newDecisions.includes(actor);
      for (const e of step.events) {
        if (
          !actors.has(e.actorId) ||
          e.receipts.some(
            (p) =>
              !bg.participants.includes(p.observerId) ||
              d.departures?.[p.observerId] !== undefined,
          ) ||
          new Set(e.receipts.map((p) => p.observerId)).size !==
            e.receipts.length
        )
          throw new SceneResponseError(
            "シーンの行動主体または受容先が不正です",
          );
      }
      for (const id of step.newDecisions)
        if (
          !bg.participants.includes(id) ||
          actors.has(id) ||
          d.departures?.[id] !== undefined
        )
          throw new SceneResponseError("本人の判断の割当が不正です");
      const nextAt = d.at + step.elapsedMs;
      if (!Number.isSafeInteger(nextAt))
        throw new SceneResponseError("シーンの経過時点が不正です");
      const receivers = sceneArrivals(
        d.events,
        step.arrivals,
        bg.participants,
        actor,
        d.at,
      );
      for (const receiver of receivers)
        if (actors.has(receiver)) step.decisions[receiver] = "decide";
        else step.newDecisions.push(receiver);
      step.newDecisions = [...new Set(step.newDecisions)];
      const departureOffset = d.events.length;
      for (const exit of step.departures) {
        if (
          !action.leave ||
          exit.actorId !== actor ||
          !step.events[exit.eventIndex] ||
          step.events
            .slice(exit.eventIndex + 1)
            .some((e) => e.receipts.some((p) => p.observerId === actor))
        )
          throw new SceneResponseError(
            "退出の本人・出来事・受容範囲が一致しません",
          );
      }
      for (const e of step.events)
        d.events.push({
          ...e,
          inputId: d.turn
            ? (d.actions.findLast(
                (a) => (a.actorId ?? row.actor_id) === e.actorId,
              )?.id ?? action.id)
            : action.id,
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
            .filter(([id, status]) => id !== actor && status === "decide")
            .map(([id]) => id),
        ]),
      ];
      for (const exit of step.departures) {
        (d.departures ??= {})[exit.actorId] =
          departureOffset + exit.eventIndex + 1;
        delete d.pending[exit.actorId];
        delete d.intentions[exit.actorId];
        d.nextDecisions = d.nextDecisions.filter((id) => id !== exit.actorId);
      }
      delete d.work;
      if (step.departures.length) {
        if (d.turn)
          return this.#completeTurn(
            row,
            [],
            !!step.concluded,
            step.departures.map((e) => e.actorId),
          );
        action.state = "complete";
        row.state = "active";
        const ended = await this.#transaction(async (db) => {
          await this.#save(row, db, row.claim!);
          await db.query(
            "UPDATE world_scene_member SET state='left' WHERE scene_id=$1 AND actor_id=ANY($2::uuid[])",
            [row.id, step.departures.map((e) => e.actorId)],
          );
          for (const m of await this.shared.members(row.id, db))
            await this.shared.notice(
              db,
              row.construction_id,
              m.actor_id,
              row.id,
              "participant_left",
            );
          if (
            !(await this.shared.members(row.id, db)).some(
              (m) => m.state === "joined",
            )
          ) {
            row.state = "reflecting";
            await this.#save(row, db, row.claim!);
            return true;
          }
          return false;
        });
        return ended;
      }
      if (step.needsContext && !returnsControl) {
        const need = {
          ...step.needsContext,
          remainingActions: Object.fromEntries(
            Object.entries(step.needsContext.remainingActions).filter(
              ([id, text]) => d.pending[id] && text.trim(),
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
      if (d.turn) {
        const external = d.externalActors ?? [],
          targets = [
            ...new Set([
              ...step.newDecisions,
              ...Object.entries(step.decisions)
                .filter(([, status]) => status === "decide")
                .map(([id]) => id),
            ]),
          ].filter(
            (id) =>
              external.includes(id) &&
              (!controlled.includes(id) ||
                step.events.some(
                  (e) =>
                    e.actorId !== id &&
                    e.receipts.some((p) => p.observerId === id),
                ) ||
                step.arrivals.some(
                  (a) =>
                    a.observerId === id &&
                    d.events[a.eventIndex]?.actorId !== id,
                )),
          );
        d.nextDecisions = d.nextDecisions.filter(
          (id) => !external.includes(id),
        );
        if (
          step.concluded ||
          targets.length ||
          controlled.every((id) => !d.pending[id]) ||
          (await this.shared.turns.control(row.id)).flow === "inactive"
        ) {
          const recipients =
            d.turn.sourceKind === "human" && !d.turn.reply
              ? d.events
                  .slice(d.turn.eventStart)
                  .flatMap((e) => e.receipts.map((p) => p.observerId))
                  .filter((id) => !controlled.includes(id))
              : targets;
          return this.#completeTurn(row, recipients, !!step.concluded);
        }
      }
      if (
        !d.turn &&
        (step.decisions[actor] === "finished" ||
          step.decisions[actor] === "decide" ||
          step.newDecisions.includes(actor))
      ) {
        action.state = "complete";
        row.state = "active";
        d.nextDecisions = d.nextDecisions.filter((id) => id !== actor);
        await this.#save(row, undefined, row.claim!);
        return false;
      }
      if (
        !d.nextDecisions.length &&
        !step.events.length &&
        !receivers.length &&
        !step.elapsedMs
      )
        break;
      await this.#save(row, undefined, row.claim!);
    }
    if (d.turn) return this.#completeTurn(row, [], true);
    d.nextPurpose = action.text;
    action.state = "boundary";
    row.state = "reflecting";
    delete d.work;
    await this.#save(row, undefined, row.claim!);
    return true;
  }
  async #completeTurn(
    row: SceneRow,
    targets: string[],
    concluded = false,
    departures: string[] = [],
  ) {
    const d = row.data,
      turn = d.turn!;
    for (const input of turn.inputs) {
      const action = d.actions.find((a) => a.id === input.id);
      if (action) {
        action.state = "complete";
        action.completedAt = new Date().toISOString();
      }
    }
    d.nextDecisions = d.nextDecisions.filter(
      (id) => !(d.externalActors ?? []).includes(id),
    );
    await this.#transaction(async (db) => {
      await this.shared.lock(db, row.construction_id);
      if (departures.length) {
        await db.query(
          "UPDATE world_scene_member SET state='left' WHERE scene_id=$1 AND actor_id=ANY($2::uuid[])",
          [row.id, departures],
        );
        await this.shared.turns.departed(db, row, departures);
        for (const member of await this.shared.members(row.id, db))
          await this.shared.notice(
            db,
            row.construction_id,
            member.actor_id,
            row.id,
            "participant_left",
          );
      }
      row.state = await this.shared.turns.complete(
        db,
        row,
        turn,
        targets,
        concluded,
      );
      const control = await this.shared.turns.control(row.id, db);
      if (control.end_reason) d.ending = control.end_reason;
      delete d.turn;
      if (row.state === "paused") d.resumeState = "active";
      await this.#save(row, db, row.claim!);
      if (row.state === "acting") await this.#enqueue(db, row.id, true);
    });
    return row.state === "reflecting";
  }
  async #reflect(row: SceneRow) {
    const d = row.data;
    if (!d.operationId && d.drafts?.length) {
      d.waitingFor = await this.drafts.waitingFor(row);
      if (d.waitingFor.length) {
        await this.#transaction(async (db) => {
          await this.#save(row, db, row.claim!);
          await db.query(
            "UPDATE world_scene_member SET state='ended' WHERE scene_id=$1 AND state='joined'",
            [row.id],
          );
        });
        return;
      }
      delete d.waitingFor;
    }
    if (!d.operationId) {
      await this.#transaction(async (db) => {
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
              anchors: sceneAnchors(
                d.background!,
                d.events,
                d.startedAt,
                row.id,
              ),
              ...(d.ending ? { ending: d.ending } : {}),
            },
          },
          row.id,
          db,
          d.basis,
        );
        await this.#save(row, db, row.claim!);
      });
    }
    if (!d.projection) {
      d.projection = await this.agent.run(d.operationId!);
      await this.#save(row, undefined, row.claim!);
      await this.#transaction(async (db) => {
        for (const child of await this.drafts.dependents(db, row.id))
          await this.#enqueue(db, child.id, child.shared);
      });
    }
    for (const viewer of [
      ...new Set([row.actor_id, ...(d.externalActors ?? [])]),
    ]) {
      if (
        viewer === row.actor_id ? !!d.result : !!d.participantResults?.[viewer]
      )
        continue;
      const source = await this.resultSource(row, viewer);
      const value = await this.#ask(row, "result", "scene-result.md", {
        confirmed: source,
        presented: viewer === row.actor_id ? (d.presentations ?? []) : [],
        requestedInputs: d.actions
          .filter(
            (a) =>
              (("actorId" in a ? a.actorId : undefined) ?? row.actor_id) ===
              viewer,
          )
          .map(({ id, text }) => ({ id, text })),
        responseSchema: z.toJSONSchema(Narrative, { io: "input" }),
      });
      const narrative = Narrative.parse(value.value);
      if (viewer === row.actor_id) {
        d.result = narrative.text;
        if (narrative.information) d.resultInformation = narrative.information;
      } else (d.participantResults ??= {})[viewer] = narrative;
      if (d.shared) {
        delete d.work;
        await this.#save(row, undefined, row.claim!);
      }
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
      if (d.shared) {
        await client.query(
          "UPDATE world_scene_member SET state='ended' WHERE scene_id=$1",
          [row.id],
        );
        for (const member of await this.shared.members(row.id, client))
          await this.shared.notice(
            client,
            row.construction_id,
            member.actor_id,
            row.id,
            "result",
          );
      }
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
  async resultSource(row: SceneRow, viewer = row.actor_id) {
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
    const exit = d.departures?.[viewer];
    const ownPrefix =
      exit === undefined
        ? null
        : new Set(
            sceneAnchors(
              d.background!,
              d.events.slice(0, exit),
              d.startedAt,
              row.id,
            )
              .edges.filter((e) => e.kind === "see" && e.source === viewer)
              .map((e) => e.id),
          );
    const observations = receipt.changes.edges
      .filter(
        (e) =>
          e.kind === "see" &&
          e.source === viewer &&
          (!ownPrefix || ownPrefix.has(e.id)),
      )
      .map((e) => ({
        id: e.id,
        targetId: e.target,
        text: e.text ?? e.observation?.aspect ?? "",
      }));
    const interpretations = [];
    for (const e of receipt.changes.edges.filter(
      (e) =>
        exit === undefined &&
        e.kind === "interpret" &&
        e.role === "content" &&
        e.source === viewer,
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
      ...(d.ending ? { ending: d.ending } : {}),
      ...(d.shared
        ? {
            connectionAbsences: (
              await this.pool.query<{
                from_event: number;
                through_event: number | null;
              }>(
                "SELECT from_event,through_event FROM world_scene_absence WHERE scene_id=$1 AND actor_id=$2 ORDER BY from_event",
                [row.id, viewer],
              )
            ).rows
              .map((r) => ({
                from: r.from_event,
                through: Math.min(
                  r.through_event ?? d.events.length,
                  exit ?? d.events.length,
                ),
              }))
              .filter((r) => r.through > r.from),
          }
        : {}),
      synopsis:
        viewer === row.actor_id
          ? d.background!.synopsis
          : d
              .background!.perceptions.filter((p) => p.observerId === viewer)
              .map((p) => p.text)
              .join("\n\n"),
      observations,
      interpretations,
      unfinishedAction: d.projection!.deferredIntentions?.includes(viewer)
        ? d.intentions[viewer]?.actionText
        : null,
    };
  }
  async tick(id: string, jobId?: string) {
    return RuntimeExecutions.run(this.pool, "scene", id, jobId, () =>
      this.#tick(id),
    );
  }
  async #repair(row: SceneRow, error: unknown) {
    if (
      !(error instanceof WorldConflict) &&
      !(error instanceof SceneResponseError) &&
      !(error instanceof SyntaxError) &&
      !(error instanceof z.ZodError)
    )
      return false;
    // Resume from durable progress, discarding only the unaccepted response.
    const saved = (
      await this.pool.query<SceneRow>(
        "SELECT * FROM world_scene WHERE id=$1 AND claim=$2",
        [row.id, row.claim],
      )
    ).rows[0];
    if (error instanceof WorldConflict) {
      if (!saved) throw new SupersededWorker("シーンの実行が引き継がれました");
      Object.assign(row, saved);
      if (
        saved.data.work &&
        (await this.agent.model.ledger.state(saved.data.work.id)) === "pending"
      )
        return false;
      await this.#refreshContext(row);
      return true;
    }
    if (!saved?.data.work) return false;
    const response = (
      await this.pool.query<{ response: { content?: string } }>(
        "SELECT response FROM llm_call WHERE id=$1 AND state='complete'",
        [saved.data.work.id],
      )
    ).rows[0]?.response;
    if (typeof response?.content !== "string") return false;
    Object.assign(row, saved);
    delete row.data.error;
    const work = row.data.work!;
    work.id = randomUUID();
    work.messages.push(
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: JSON.stringify({
          validationErrors:
            error instanceof z.ZodError ? error.issues : error.message,
        }),
      },
    );
    await this.#save(row, undefined, row.claim!);
    return true;
  }
  async #tick(id: string) {
    const claim = randomUUID(),
      row = await this.#transaction(async (client) => {
        const subject = (
          await client.query<{ construction_id: string }>(
            "SELECT construction_id FROM world_scene WHERE id=$1",
            [id],
          )
        ).rows[0];
        if (subject) await this.shared.lock(client, subject.construction_id);
        const row = (
          await client.query<SceneRow>(
            "SELECT * FROM world_scene WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!row) throw new Error("シーンが見つかりません");
        if (
          row.data.turns &&
          ["active", "acting"].includes(row.state) &&
          !row.data.turn
        ) {
          const turn = await this.shared.turns.next(client, row);
          if (turn) {
            row.data.turn = turn;
            row.state = "acting";
            for (const input of turn.inputs) {
              row.data.actions.push({
                id: input.id,
                actorId: input.actorId,
                text: input.text,
                state: "running",
                ...(input.leave ? { leave: true as const } : {}),
                submittedAt: new Date().toISOString(),
              });
              const intent = {
                actorId: input.actorId,
                actionText: input.text,
                continuing: false,
              };
              row.data.pending[input.actorId] = intent;
              row.data.intentions[input.actorId] = intent;
              row.data.choices.push(intent);
            }
          } else {
            const control = await this.shared.turns.control(row.id, client);
            row.state =
              control.flow === "closing"
                ? "reflecting"
                : ["inactive", "rounds"].includes(control.flow)
                  ? "paused"
                  : "active";
            if (control.end_reason) row.data.ending = control.end_reason;
            if (row.state === "paused") row.data.resumeState = "active";
            await this.#save(row, client);
          }
        }
        if (!["preparing", "acting", "reflecting"].includes(row.state))
          return row;
        row.claim = claim;
        await this.#save(row, client);
        return row;
      });
    if (row.claim !== claim) return;
    for (;;)
      try {
        await RuntimeControl.check(this.pool, {
          userId: row.user_id ?? undefined,
          worldId: row.data.worldId,
          role: "user",
          actorId: row.actor_id,
        });
        await this.drafts.run(row, async () => {
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
        });
        return;
      } catch (error) {
        if (error instanceof SupersededWorker) return;
        if (await this.#repair(row, error)) continue;
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
    await this.shared.work();
    const handleJobs = async (jobs: { id: string; data: { id: string } }[]) => {
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
    };
    await this.construction.queue.work<{ id: string }>(
      this.shared.sceneQueue,
      { localConcurrency: 2, pollingIntervalSeconds: 0.5 },
      handleJobs,
    );
    return this.construction.queue.work<{ id: string }>(
      this.queueName,
      { localConcurrency: 2, pollingIntervalSeconds: 0.5 },
      handleJobs,
    );
  }
}
