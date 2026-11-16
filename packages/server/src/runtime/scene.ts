import { npcActors, trackNpcScene } from "./npc-mode.js";
import { RuntimeExecutions } from "./executions.js";
import { sceneSources } from "./scene-sources.js";
import { SharedScenes, SceneSelection } from "./shared-scenes.js";
import { ContactChanged, type ContactDecision } from "./player-contact.js";
import { SceneDrafts, type SceneDraft } from "./scene-drafts.js";
import type { SharedTurn } from "./shared-turns.js";
import {
  type NpcModeCommand,
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
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { parseOutput } from "../llm/prompt.js";
import { ExecutionBudget, ExecutionLimit } from "../execution-budget.js";
import type pg from "pg";
import type { ChatMessage } from "../llm/client.js";
import {
  WorldConflict,
  type Dependency,
  type Receipt,
} from "../world/store.js";
import {
  BelongingRejected,
  belongingOps,
  changeBelongings,
  readBelongings,
  type BelongingOp,
} from "../world/belongings.js";
import { locationRecords } from "../world/locations.js";
import {
  Query,
  IntentResult,
  type Interaction,
  SupersededWorker,
  type WorldProposal,
  type WorldAgent,
} from "./agent.js";
import {
  ConstructionStateError,
  type Construction,
  type WorldConstruction,
} from "./construction.js";
import {
  SceneBackground,
  OpeningBackground,
  remainingQuestions,
  SceneContext,
  ContextNeed,
  SceneStep,
  ObservedStep,
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
  type SceneSources,
} from "./scene-data.js";

const BackgroundChoices = [
  z
    .object({ type: z.literal("query"), requests: z.array(Query).min(1) })
    .strict(),
  z.object({ type: z.literal("pause"), reason: z.string() }).strict(),
] as const;
function backgroundDecision(withSources: boolean, observing: boolean) {
  const fact = OpeningBackground.shape.facts.element.omit({
    sourceRelationIds: true,
  });
  const belief = SceneBackground.shape.beliefs
    .unwrap()
    .element.omit({ sourceRelationIds: true });
  const source = { sourceRelationIds: z.array(z.uuid()) };
  const fields = {
    facts: z.array(withSources ? fact.extend(source) : fact),
    beliefs: z.array(withSources ? belief.extend(source) : belief).default([]),
  };
  return z.discriminatedUnion("type", [
    observing
      ? z.object({ type: z.literal("observation"), limits: z.string().min(1) })
      : OpeningBackground.extend(fields),
    SceneContext.extend(fields),
    ...BackgroundChoices,
  ]);
}
const Narrative = z
  .object({
    text: z.string().min(1),
    information: z.array(InformationReference).optional(),
  })
  .strict();
async function scenePrompt(file: string, information = true) {
  const files = [
    file,
    ...(file === "scene-play.md" ? ["skills/belongings.md"] : []),
    ...(information ? ["presentation-information.md"] : []),
  ];
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
function backgroundPaused(content?: string) {
  if (!content) return false;
  try {
    return z
      .object({ type: z.literal("pause") })
      .safeParse(parseOutput(content)).success;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}
export type SceneData = {
  turns?: true;
  soloBot?: boolean;
  npcSoloTurn?: string;
  soloProposal?: string;
  deferredSoloAction?: { id: string; text: string; submittedAt: string };
  turn?: SharedTurn;
  ending?: SceneEnding;
  drafts?: SceneDraft[];
  departures?: Record<string, number>;
  waitingFor?: string[];
  shared?: true;
  externalActors?: string[];
  peerConditions?: Awaited<
    ReturnType<WorldAgent["playerConditions"]>
  >["players"];
  encounter?: { inputId: string };
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
  belongingCommits?: number;
  backgroundMessages?: ChatMessage[];
  background?: SceneBackground;
  sources?: SceneSources;
  contextNeed?: z.infer<typeof ContextNeed> & { worldChanged?: true };
  observationContext?: {
    inputId: string;
    limits: string;
    conditions?: unknown[];
    observers?: string[];
  };
  contextRequests?: {
    inputId: string;
    at: number;
    evidence?: "world" | "observation";
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
  // Published in the same transaction as the next save of the source events.
  contactDecisions?: ContactDecision[];
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
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_npc_scene (
      session_id uuid NOT NULL,actor_id uuid NOT NULL,scene_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,
      event_start integer NOT NULL DEFAULT 0,choice_start integer NOT NULL DEFAULT 0,include_opening boolean NOT NULL DEFAULT true,
      event_end integer,choice_end integer,handled boolean NOT NULL DEFAULT false,PRIMARY KEY(session_id,actor_id,scene_id));
      CREATE INDEX IF NOT EXISTS world_npc_scene_by_scene ON world_npc_scene(scene_id);`);
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
      'commandId',data->'commandId','at',data->'at','startedAt',data->'startedAt','shared',data->'shared','soloProposal',data->'soloProposal',
      'background',jsonb_build_object('synopsis',data#>'{background,synopsis}', 'synopsisInformation',data#>'{background,synopsisInformation}',
        'perceptions',CASE WHEN $2::uuid IS NULL THEN data#>'{background,perceptions}' ELSE (SELECT coalesce(jsonb_agg(p),'[]') FROM jsonb_array_elements(coalesce(data#>'{background,perceptions}','[]')) p WHERE p->>'observerId'=$2::text) END),
      'events','[]'::jsonb,'actions',CASE WHEN data ? 'shared' THEN
        (SELECT coalesce(jsonb_agg(a),'[]') FROM (SELECT a FROM jsonb_array_elements(data->'actions') WITH ORDINALITY r(a,n) WHERE coalesce(a->>'actorId',actor_id::text)=$2::text ORDER BY n DESC LIMIT 1) own)
        ELSE CASE WHEN jsonb_array_length(data->'actions')>0 THEN jsonb_build_array(data->'actions'->-1) ELSE '[]'::jsonb END END,
      'result',data->'result','resultInformation',data->'resultInformation',
      'participantResults',CASE WHEN $2::uuid IS NOT NULL THEN jsonb_build_object($2::text,data->'participantResults'->$2::text) ELSE data->'participantResults' END,
      'departures',data->'departures','waitingFor',data->'waitingFor','encounter',data->'encounter',
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
      if (row.contactDecisions) {
        await this.shared.lock(c, row.construction_id);
        await this.shared.contacts.deliver(c, row, row.contactDecisions);
      }
      if (
        row.data.turns &&
        row.state === "active" &&
        !row.data.turn &&
        !row.data.encounter
      ) {
        await this.shared.lock(c, row.construction_id);
        if ((await this.shared.turns.routeIdle(c, row)) === "closing") {
          row.state = "reflecting";
          row.data.ending = "dissolved";
        }
      }
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
      await trackNpcScene(c, row);
      if (
        !row.data.turns &&
        row.state === "active" &&
        !row.data.encounter &&
        !row.data.soloProposal &&
        (
          await c.query(
            "SELECT 1 FROM world_player_contact WHERE target_scene=$1 AND queued_text IS NOT NULL LIMIT 1",
            [row.id],
          )
        ).rowCount
      )
        await this.#enqueue(c, row.id);
      if (
        !row.data.shared &&
        !row.data.encounter &&
        ["ready", "active"].includes(row.state) &&
        (await npcActors(c, row.data.worldId, [row.actor_id])).length
      )
        await this.#enqueue(c, row.id);
      await c.query(
        `INSERT INTO world_event(subject_id,construction_id,role,event_key)
        SELECT subject_id,construction_id,role,gen_random_uuid()::text FROM world_access WHERE construction_id=$1`,
        [row.construction_id],
      );
    };
    if (client) await save(client);
    else await this.#transaction(save);
    delete row.contactDecisions;
  }
  async npcCommand(
    db: pg.PoolClient,
    world: string,
    actor: string,
    input: z.infer<typeof NpcModeCommand>,
    kind: "bot" | "human",
  ) {
    await this.shared.lock(db, world);
    const c = await this.construction.get(world, db);
    const current = await this.latest(world, db, false, actor);
    if (input.command === "away" || input.command === "return") {
      const active = input.command === "away";
      const changed = await db.query(
        `UPDATE world_controlled_actor SET npc_active=$3,npc_session=CASE WHEN $3 THEN $4 ELSE npc_session END
        WHERE world_id=$1 AND actor_id=$2 AND npc_active<>$3 RETURNING npc_session`,
        [c.world_id, actor, active, input.requestId],
      );
      if (!changed.rowCount) return;
      if (active) {
        await db.query(
          "UPDATE world_scene_presence SET active=false WHERE world_id=$1 AND actor_id=$2 AND active",
          [world, actor],
        );
        if (
          current &&
          current.state !== "result" &&
          current.data.departures?.[actor] === undefined &&
          !current.data.waitingFor?.length
        ) {
          await db.query(
            `INSERT INTO world_npc_scene(session_id,actor_id,scene_id,event_start,choice_start,include_opening)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
            [
              input.requestId,
              actor,
              current.id,
              current.data.events.length,
              current.data.choices.length,
              !current.data.background,
            ],
          );
          if (current.data.shared) {
            await this.shared.turns.departed(db, current, [actor]);
            await this.shared.turns.handoff(
              db,
              current,
              actor,
              input.requestId,
            );
          }
          if (
            !current.data.shared &&
            ["ready", "active"].includes(current.state)
          )
            await this.#enqueue(db, current.id);
        }
      } else {
        await db.query(
          `UPDATE world_npc_scene n SET event_end=jsonb_array_length(s.data->'events'),choice_end=jsonb_array_length(s.data->'choices')
          FROM world_scene s WHERE n.scene_id=s.id AND n.actor_id=$1 AND n.session_id=$2 AND s.state NOT IN ('preparing','acting') AND n.event_end IS NULL`,
          [actor, changed.rows[0].npc_session],
        );
      }
      return;
    }
    if (!("sceneId" in input))
      throw new ConstructionStateError("シーンを指定してください");
    const row = (
      await db.query<SceneRow>(
        `SELECT s.* FROM world_scene s JOIN world_npc_scene n ON s.id=n.scene_id
      JOIN world_controlled_actor a ON a.actor_id=n.actor_id AND a.npc_session=n.session_id
      WHERE s.id=$1 AND s.construction_id=$2 AND a.actor_id=$3 AND NOT a.npc_active AND NOT n.handled FOR UPDATE OF s`,
        [input.sceneId, world, actor],
      )
    ).rows[0];
    if (
      !row ||
      !["active", "ready"].includes(row.state) ||
      row.data.encounter ||
      row.data.soloProposal ||
      row.data.departures?.[actor] !== undefined ||
      !row.data.background?.participants.includes(actor)
    )
      throw new ConstructionStateError(
        "登場中のシーンの状態を再取得してください",
      );
    const d = row.data;
    if (input.command === "join") {
      if (
        current &&
        current.id !== row.id &&
        current.state !== "result" &&
        !current.data.waitingFor?.length &&
        current.data.departures?.[actor] === undefined
      )
        throw new ConstructionStateError(
          "現在参加しているシーンから退出してください",
        );
      if (actor !== row.actor_id || d.shared) {
        if (!d.shared) {
          await this.shared.open(
            db,
            world,
            row.actor_id,
            row.id,
            d.at,
            d.commandId,
            d.soloBot ? "bot" : "human",
          );
          await db.query(
            "UPDATE world_shared_scene SET phase='settled' WHERE scene_id=$1",
            [row.id],
          );
          await db.query(
            "UPDATE world_scene_member SET state='joined' WHERE scene_id=$1",
            [row.id],
          );
          d.shared = true;
          d.turns = true;
          delete d.peerConditions;
        }
        d.externalActors = [
          ...new Set([...(d.externalActors ?? [row.actor_id]), actor]),
        ];
        await db.query(
          `INSERT INTO world_scene_member(scene_id,world_id,actor_id,request_id,last_request_id,state,kind)
           VALUES($1,$2,$3,$4,$4,'joined',$5) ON CONFLICT(scene_id,actor_id) DO UPDATE SET state='joined',kind=excluded.kind,last_request_id=excluded.last_request_id`,
          [row.id, world, actor, input.requestId, kind],
        );
        await db.query(
          `INSERT INTO world_actor_scene(world_id,actor_id,scene_id) VALUES($1,$2,$3) ON CONFLICT(world_id,actor_id) DO UPDATE SET scene_id=excluded.scene_id`,
          [world, actor, row.id],
        );
        await this.shared.notice(
          db,
          world,
          actor,
          row.id,
          "participation_settled",
        );
      }
    } else {
      const name =
        (await this.agent.store.context(d.worldId).node(actor, d.at))?.text ??
        "その人物";
      const text = name + "はその場を離れた。";
      const event = {
        id: sceneId(input.requestId + ":departure"),
        actorId: actor,
        text,
        period: { from: d.at, until: d.at },
        receipts: [
          ...new Set([row.actor_id, ...(d.externalActors ?? []), actor]),
        ]
          .filter((a) => d.departures?.[a] === undefined)
          .map((observerId) => ({ observerId, text })),
      };
      d.events.push(event);
      (d.departures ??= {})[actor] = d.events.length;
      if (d.shared) await this.shared.turns.departed(db, row, [actor]);
      await db.query(
        "UPDATE world_scene_member SET state='left' WHERE scene_id=$1 AND actor_id=$2",
        [row.id, actor],
      );
      if (row.actor_id === actor && !d.shared) {
        row.state = "reflecting";
        d.ending = "departed";
        await this.#enqueue(db, row.id);
      }
      if (d.shared) {
        for (const member of await this.shared.members(row.id, db))
          await this.shared.notice(
            db,
            world,
            member.actor_id,
            row.id,
            "participant_left",
          );
        if (
          !(await this.shared.members(row.id, db)).some(
            (m) => m.state === "joined",
          )
        ) {
          row.state = "reflecting";
          d.ending = "departed";
          await this.#enqueue(db, row.id, true);
        }
      }
    }
    delete d.pending[actor];
    d.nextDecisions = d.nextDecisions.filter((id) => id !== actor);
    await db.query(
      "UPDATE world_npc_scene SET handled=true WHERE actor_id=$1 AND scene_id=$2 AND session_id=(SELECT npc_session FROM world_controlled_actor WHERE world_id=$3 AND actor_id=$1)",
      [actor, row.id, d.worldId],
    );
    const wasActive = row.state === "active";
    await this.#save(row, db);
    if (wasActive && row.state === "reflecting")
      await this.#enqueue(db, row.id, true);
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
        ...(shared
          ? { shared: true as const, turns: true as const }
          : { soloBot: kind === "bot" }),
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
    const c = await this.construction.get(world, client, true);
    if (command === "react")
      await client.query(
        "SELECT s.id FROM world_player_contact c JOIN world_scene s ON s.id=c.target_scene WHERE c.id=$1 AND c.world_id=$2 AND c.listener=$3 FOR UPDATE OF s",
        [input.opportunityId, world, actorId ?? c.participant_id],
      );
    const row = await this.latest(
      world,
      client,
      false,
      actorId ?? c.participant_id ?? undefined,
      sceneId,
    );
    const actor = actorId ?? row?.actor_id;
    if (!row || !actor || (row.actor_id !== actor && !row.data.shared))
      throw new ConstructionStateError("現在のシーンを取得してください");
    if (command === "react") {
      const answer = await this.shared.contacts.answer(
        client,
        row,
        actor,
        input.opportunityId!,
        input.requestId,
        input.actionText ?? null,
        kind,
      );
      if (answer === "accepted") return row;
      if (answer === "act") command = "act";
    }
    if (row.data.encounter)
      throw new ConstructionStateError("参加要請への回答を待っています");
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
    if (command === "react" || (command === "vote" && !row.data.soloProposal))
      throw new ConstructionStateError("共有シーンを指定してください");
    if (command === "start") {
      if (row.state !== "ready")
        throw new ConstructionStateError("あらすじの準備完了を待ってください");
      if (
        row.data.turns &&
        (await this.shared.turns.control(row.id, client)).flow === "closing"
      )
        throw new ConstructionStateError("シーンは終了処理中です");
      row.state = "active";
    } else if (command === "resume") {
      if (row.state !== "paused")
        throw new ConstructionStateError("保留中のシーンを指定してください");
      row.state = row.data.resumeState!;
      // Older scenes could request the same observation again without advancing.
      // Detach that redundant read, preserving the original call and its reservation.
      const d = row.data,
        input = d.actions.at(-1);
      const requests = d.contextRequests?.slice(-2) ?? [];
      const inputId = d.turn?.id ?? input?.id;
      if (
        row.state === "acting" &&
        d.work?.kind === "background" &&
        input?.state === "running" &&
        d.observationContext &&
        d.observationContext.inputId === inputId &&
        d.contextNeed?.evidence === "observation" &&
        !d.contextNeed.worldChanged &&
        requests.length === 2 &&
        requests.every(
          (r) =>
            r.evidence === "observation" &&
            r.inputId === (d.turn?.inputs[0]?.id ?? input.id) &&
            r.at === d.at &&
            isDeepStrictEqual(
              r.remainingActions,
              d.contextNeed!.remainingActions,
            ),
        )
      ) {
        delete d.work;
        delete d.contextNeed;
        delete d.backgroundMessages;
      }
      const workState =
        row.data.work &&
        (await this.agent.model.ledger.state(row.data.work.id));
      if (workState === "pending")
        throw new ConstructionStateError(
          "送信済み要求の結果が未確定です。自動では再送しません",
        );
      // Older shared turns kept the completed boundary call during reflection.
      if (
        row.state === "reflecting" &&
        d.work?.kind === "resolve" &&
        workState === "complete"
      )
        delete d.work;
      const committedState =
        d.work?.kind === "background"
          ? await this.agent.store.receipt(
              d.worldId,
              this.#initializationCommit(row),
            )
          : d.work?.kind === "resolve"
            ? await this.agent.store.receipt(
                d.worldId,
                this.#belongingsCommit(row),
              )
            : undefined;
      if (
        row.data.work &&
        !committedState &&
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
        const previous = (
          await client.query(
            "SELECT response ? 'rejection' AS rejected,response->>'content' AS content FROM llm_call WHERE id=$1",
            [row.data.work.id],
          )
        ).rows[0];
        if (
          row.data.contextNeed &&
          row.data.work.kind === "background" &&
          backgroundPaused(previous?.content)
        ) {
          // Re-read the world for the outstanding action instead of replaying stale query results.
          delete row.data.work;
          delete row.data.backgroundMessages;
        } else if (previous?.rejected) delete row.data.work;
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
      const action =
        command === "vote"
          ? row.data.deferredSoloAction
          : command === "act" || command === "leave"
            ? {
                id: input.requestId,
                text:
                  command === "leave"
                    ? "この場から退出する"
                    : input.actionText!,
                submittedAt: new Date().toISOString(),
              }
            : undefined;
      const proposal = row.data.soloProposal;
      if (proposal) {
        if (command !== "vote" && command !== "finish")
          throw new ConstructionStateError("終了提案に回答してください");
        if (command === "vote") {
          await this.shared.turns.answer(
            client,
            row.id,
            actor,
            input.proposalId!,
            input.continue!,
          );
          if (!input.continue) row.data.ending = "unanimous";
        }
        await client.query(
          "UPDATE world_scene_end_vote SET state='closed' WHERE id=$1",
          [proposal],
        );
        delete row.data.soloProposal;
        delete row.data.deferredSoloAction;
      }
      if (command === "finish" || (command === "vote" && !input.continue))
        row.state = "reflecting";
      else if (action) {
        const legacy =
          row.data.soloBot === undefined && !row.data.shared && kind === "bot";
        if (!row.data.shared)
          row.data.soloBot = command === "vote" || kind === "bot";
        if (legacy && (await this.#savedConclusion(client, row))) {
          row.data.soloProposal = await this.shared.turns.propose(client, row, [
            actor,
          ]);
          row.data.deferredSoloAction = action;
        } else
          this.#startAction(row, actor, {
            ...action,
            ...(command === "leave" ? { leave: true } : {}),
          });
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
  #startAction(
    row: SceneRow,
    actor: string,
    action: { id: string; text: string; submittedAt?: string; leave?: true },
  ) {
    row.state = "acting";
    row.data.actions.push({
      ...(row.data.shared ? { actorId: actor } : {}),
      ...action,
      state: "running",
    });
    const intent = {
      actorId: actor,
      actionText: action.text,
      continuing: row.data.pending[actor]?.actionText === action.text,
    };
    row.data.pending[actor] = intent;
    row.data.intentions[actor] = intent;
    row.data.choices.push(intent);
  }
  async #savedConclusion(client: pg.PoolClient, row: SceneRow) {
    const completed = row.data.actions
      .filter((a) => a.state === "complete")
      .map((a) => a.id);
    const calls = await client.query<{ content: string }>(
      `SELECT DISTINCT ON (response_id) response->>'content' AS content FROM llm_call
       WHERE response_id=ANY($1::uuid[]) AND request->>'role'='scene-resolve' AND state='complete'
       AND response->>'finishReason'='stop' ORDER BY response_id,created_at DESC,id DESC`,
      [completed],
    );
    return calls.rows.some(({ content }) => {
      try {
        const step = sceneResponse(presentationEvidence(parseOutput(content)));
        return (
          step.type === "scene" &&
          step.concluded === true &&
          !step.liveContacts?.some((c) => c.receipt !== null)
        );
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof z.ZodError)
          return false;
        throw error;
      }
    });
  }
  #budget(row: SceneRow) {
    return row.state === "preparing"
      ? row.id
      : row.state === "acting"
        ? (row.data.turn?.id ??
          row.data.npcSoloTurn ??
          row.data.actions.at(-1)!.id)
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
        kind === "background" ? "resolution" : work.target,
        row.data.sources !== undefined && file === "scene-background.md",
      );
    if (response.finishReason !== "stop")
      throw new SceneResponseError("シーンのモデル応答が未完了です");
    // 確定後・保存前に止まった行動解決の再開では、確定済みの変更を文脈の変化と見なさない。
    if (kind === "resolve")
      this.#adopt(
        row,
        await this.agent.store.receipt(
          row.data.worldId,
          this.#belongingsCommit(row),
        ),
      );
    if (kind === "resolve" || kind === "intent")
      await this.agent.store
        .context(row.data.worldId, row.data.basis)
        .validate();
    return {
      content: response.content,
      value: presentationEvidence(parseOutput(response.content)),
    };
  }
  // 保存済みの確定回数から識別を導く。確定後に同じ入力を解決し直しても、同じ確定として扱う。
  #belongingsCommit(row: SceneRow) {
    return sceneId(`${row.id}:belongings:${row.data.belongingCommits ?? 0}`);
  }
  #initializationCommit(row: SceneRow) {
    return sceneId(`${row.id}:locations:${row.data.work!.id}`);
  }
  // このシーン自身の物品・技能の確定で進んだ版を、シーンの依存へ引き継ぐ。
  #adopt(row: SceneRow, receipt?: Receipt) {
    for (const dependency of row.data.basis) {
      const moved = receipt?.versions?.[dependency.key];
      if (moved?.before === dependency.version)
        dependency.version = moved.after;
    }
  }
  async #locations(
    row: SceneRow,
    actors = row.data.background?.participants ?? [
      row.actor_id,
      ...(row.data.externalActors ?? []),
    ],
  ) {
    this.#adopt(
      row,
      await this.agent.store.receipt(
        row.data.worldId,
        this.#belongingsCommit(row),
      ),
    );
    if (row.data.work?.kind === "background")
      this.#adopt(
        row,
        await this.agent.store.receipt(
          row.data.worldId,
          this.#initializationCommit(row),
        ),
      );
    const d = row.data,
      context = this.agent.store.context(d.worldId, d.basis),
      locations: Record<
        string,
        Awaited<ReturnType<typeof locationRecords>>
      > = {};
    d.at = Math.max(
      d.at,
      (await this.construction.get(row.construction_id)).at,
    );
    for (const actor of actors) {
      locations[actor] = await locationRecords(context, actor);
      d.at = Math.max(d.at, ...locations[actor].map((r) => r.at));
    }
    d.basis = context.dependencies;
    if (row.state === "preparing" && !d.background) d.startedAt = d.at;
    return locations;
  }
  async #state(
    row: SceneRow,
    at: number,
    ops: BelongingOp[],
    initialization = false,
  ) {
    const d = row.data,
      context = this.agent.store.context(d.worldId, d.basis),
      nodes: { id: string; text: string; kind: "existence" }[] = [];
    const references = new Set(
      ops.flatMap((op) =>
        Object.entries(op)
          .filter(([key]) => !["type", "text", "label", "basis"].includes(key))
          .flatMap(([, value]) => value),
      ),
    );
    for (const node of d.background!.creations)
      if (references.has(node.id) && !(await context.node(node.id)))
        nodes.push({ ...node, kind: "existence" as const });
    const commitId = initialization
        ? this.#initializationCommit(row)
        : this.#belongingsCommit(row),
      prior = await this.agent.store.receipt(d.worldId, commitId);
    if (!ops.length && !nodes.length && !prior) return at;
    const receipt =
      prior ??
      (await ExecutionBudget.commit(async () =>
        changeBelongings(
          this.agent.store,
          await this.agent.store.claim(
            d.worldId,
            sceneId(`${row.id}:belongings`),
          ),
          {
            commitId,
            at,
            ops,
            nodes,
            dependencies: context.dependencies,
          },
        ),
      ));
    this.#adopt(row, receipt);
    if (!initialization) d.belongingCommits = (d.belongingCommits ?? 0) + 1;
    return Math.max(at, receipt.at);
  }
  async #initializeLocations(row: SceneRow, opening: boolean) {
    const locations = await this.#locations(row),
      facts = new Map(
        row.data
          .background!.facts.filter(
            (f) =>
              f.location &&
              row.data.background!.participants.includes(f.subjectId),
          )
          .map((f) => [f.subjectId, f]),
      );
    const ops: BelongingOp[] = [...facts.values()]
      .filter((f) => opening || !locations[f.subjectId]?.length)
      .map((f) => ({
        type: "locate",
        subjectId: f.subjectId,
        text: f.text,
        aboutIds: f.aboutIds,
      }));
    row.data.at = await this.#state(row, row.data.at, ops, true);
  }

  // 行動の解決へ渡す、登場人物の確定済みの携行品・保管先の在庫・技能。観測には加えない。
  async #belongings(row: SceneRow) {
    const context = this.agent.store.context(row.data.worldId),
      belongings: Record<
        string,
        Awaited<ReturnType<typeof readBelongings>>
      > = {};
    for (const id of row.data.background!.participants) {
      const known = await readBelongings(context, id);
      if (known.items.length || known.storages.length || known.skills.length)
        belongings[id] = known;
    }
    return Object.keys(belongings).length ? { belongings } : {};
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
      const context = await this.agent.context(request, row.data.basis, true);
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
        row.construction_id === process.env.SCENE_DEFAULT_PARTICIPATION_WORLD_ID
          ? "default"
          : "resolution",
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
          true,
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
    const state = await this.shared.select(row.id, plan, row.data.purpose);
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
      delete d.observationContext;
      d.contextNeed ??= {
        evidence: "world",
        worldChanged: true,
        reason:
          "共有世界の更新後の状態を確認し、未実行の行動に必要な背景だけを補う。追加が不要なら空のcontextを返す。",
        remainingActions: Object.fromEntries(
          Object.values(d.pending).map((i) => [i.actorId, i.actionText]),
        ),
      };
    }
    d.basis = [];
    delete d.peerConditions;
    delete d.backgroundMessages;
    if (row.state !== "reflecting") delete d.work;
    await this.#save(row, undefined, row.claim!);
  }
  async #background(row: SceneRow) {
    const currentLocations = await this.#locations(row);
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
      established = !d.contextNeed ? d.background : undefined,
      request = {
        ...this.#request(row),
        actionText: d.contextNeed?.reason ?? d.purpose,
      };
    const observing =
      !!d.contextNeed &&
      (d.contextNeed.evidence ?? "observation") === "observation";
    if (
      !d.background &&
      !d.backgroundMessages &&
      !d.work &&
      row.construction_id === process.env.SCENE_HANDOFF_WORLD_ID
    )
      d.sources ??= {};
    const schema = backgroundDecision(!!d.sources, observing);
    // An unfinished pre-upgrade request still advertises the old output contract.
    if (
      d.backgroundMessages &&
      JSON.parse(d.backgroundMessages[0]!.content).backgroundVersion !== 3
    ) {
      if (
        d.work &&
        (await this.agent.model.ledger.state(d.work.id)) === "pending"
      )
        throw new Error("送信済み要求の結果が未確定です。");
      delete d.backgroundMessages;
      delete d.work;
    }
    if (!d.backgroundMessages) {
      const context = await this.agent.context(request, d.basis, true);
      d.basis = context.dependencies;
      await this.#peerConditions(
        row,
        context.controlledActorIds,
        context.initialContext.flatMap(({ request }) =>
          request.kind === "node" ? [request.id] : [],
        ),
      );
      request.at = d.at;
      d.backgroundMessages = [
        {
          role: "user",
          content: JSON.stringify({
            request: { ...request, at: d.at },
            backgroundVersion: 3,
            initialContext: context.initialContext,
            currentLocations,
            controlledActorIds: [
              ...new Set([
                ...context.controlledActorIds,
                ...d.peerConditions!.map((p) => p.actorId),
              ]),
            ],
            otherPlayers: d.peerConditions,
            sleepingPlayerIds: await this.#sleepingPlayers(
              row,
              context.controlledActorIds,
            ),
            acceptedPlayerIds: d.externalActors ?? [row.actor_id],
            ...(established
              ? {
                  establishedScene: {
                    background: established,
                    events: d.events,
                  },
                }
              : {}),
            ...(d.drafts?.length ? { priorScenes: d.drafts } : {}),
            ...(d.contextNeed
              ? {
                  needsContext: {
                    ...d.contextNeed,
                    evidence: observing ? "observation" : "world",
                  },
                  stagedScene: {
                    purpose: d.purpose,
                    input: d.turn?.continuingActor
                      ? d.pending[d.turn.continuingActor]?.actionText
                      : d.actions.at(-1)?.text,
                    background: d.background,
                    events: d.events,
                    intentions: Object.values(d.pending),
                  },
                }
              : {}),
            responseSchema: z.toJSONSchema(schema, { io: "input" }),
          }),
        },
      ];
    }
    for (;;) {
      if (!d.work) {
        d.work = {
          id: randomUUID(),
          kind: "background",
          target:
            row.construction_id ===
            process.env.SCENE_DEFAULT_BACKGROUND_WORLD_ID
              ? "default"
              : "resolution",
          messages: [
            {
              role: "system",
              content:
                (await scenePrompt("scene-background.md")) +
                (d.sources
                  ? "\nfactsとbeliefsの各項目にsourceRelationIdsを付け、その記述を裏付ける照会済み関係のIDを列挙してください。既存状態を根拠にする場合はそのcontent関係を含めます。新しく具体化した内容に根拠を創作せず、該当がなければ空配列を返します。"
                  : ""),
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
        answer = schema.parse(response.value);
      if (answer.type === "pause") throw new Error(answer.reason);
      if (answer.type === "query") {
        const read = await this.agent.read(
          { request, dependencies: d.basis },
          answer.requests,
          true,
        );
        d.basis = read.dependencies;
        await this.#peerConditions(
          row,
          read.controlledActorIds,
          answer.requests.flatMap((q) => (q.kind === "node" ? [q.id] : [])),
        );
        request.at = d.at;
        d.backgroundMessages.push(
          { role: "assistant", content: response.content },
          {
            role: "user",
            content: JSON.stringify({
              requests: answer.requests,
              results: read.results,
              currentAt: d.at,
              controlledActorIds: [
                ...new Set([
                  ...read.controlledActorIds,
                  ...d.peerConditions!.map((p) => p.actorId),
                ]),
              ],
              otherPlayers: d.peerConditions,
              sleepingPlayerIds: await this.#sleepingPlayers(
                row,
                read.controlledActorIds,
              ),
            }),
          },
        );
        delete d.work;
        await this.#save(row, undefined, row.claim!);
        continue;
      }
      if (answer.type === "observation") {
        const observers = Object.keys(d.contextNeed!.remainingActions);
        d.observationContext = {
          inputId: d.turn?.id ?? d.actions.at(-1)!.id,
          limits: answer.limits,
          conditions: d.backgroundMessages
            .filter((m) => m.role === "user")
            .flatMap((m) => {
              const page = JSON.parse(m.content);
              return (
                page.initialContext ??
                (page.requests ?? []).map((request: unknown, i: number) => ({
                  request,
                  result: page.results[i],
                }))
              );
            }),
          ...(observers.length ? { observers } : {}),
        };
        delete d.work;
        delete d.backgroundMessages;
        delete d.contextNeed;
        await this.#save(row, undefined, row.claim!);
        return;
      }
      let decision: SceneBackground;
      const cited =
        d.sources && (answer.type === "context" || answer.type === "background")
          ? sceneSources(d.backgroundMessages, [
              ...answer.facts,
              ...answer.beliefs,
            ])
          : undefined;
      if (d.contextNeed) {
        if (answer.type !== "context")
          throw new SceneResponseError(
            "進行中の背景は追記として補ってください",
          );
        const prior = d.background!;
        const inspected = new Set<string>();
        for (const message of d.backgroundMessages) {
          if (message.role !== "user") continue;
          const page = JSON.parse(message.content);
          const reads: {
            request: z.infer<typeof Query>;
            result: { node?: { id: string } } | null;
          }[] =
            page.initialContext ??
            (page.requests ?? []).map(
              (request: z.infer<typeof Query>, i: number) => ({
                request,
                result: page.results[i],
              }),
            );
          for (const { request, result } of reads)
            if (request.kind === "node" && result?.node?.id === request.id)
              inspected.add(request.id);
        }
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
          unknowns: remainingQuestions(prior, answer, inspected),
        };
      } else if (answer.type === "background") {
        decision = answer;
        if (established) {
          const added = new Set(
            answer.participants.filter(
              (id) => !established.participants.includes(id),
            ),
          );
          decision = {
            ...established,
            participants: [...established.participants, ...added],
            facts: [
              ...established.facts,
              ...answer.facts.filter((f) => added.has(f.subjectId)),
            ],
            beliefs: [
              ...established.beliefs,
              ...answer.beliefs.filter((f) => added.has(f.subjectId)),
            ],
            perceptions: [
              ...established.perceptions,
              ...answer.perceptions.filter((p) => added.has(p.observerId)),
            ],
            creations: [...established.creations, ...answer.creations],
          };
        }
      } else throw new SceneResponseError("開始時の背景が必要です");
      if (!d.contextNeed) {
        const sleeping = await this.#sleepingPlayers(
          row,
          decision.participants,
        );
        decision.perceptions = decision.perceptions.filter(
          (p) =>
            !sleeping.includes(p.observerId) ||
            established?.perceptions.includes(p),
        );
        const missingViews = (d.externalActors ?? []).filter(
          (id) =>
            !sleeping.includes(id) &&
            !decision.perceptions.some((p) => p.observerId === id),
        );
        if (missingViews.length)
          throw new SceneResponseError(
            `参加確定済みの人物の視点がありません: ${missingViews.join(", ")}`,
          );
      }
      const missing = (d.externalActors ?? [row.actor_id]).filter(
        (id) => !decision.participants.includes(id),
      );
      if (missing.length)
        throw new SceneResponseError(
          `背景情報に参加確定済みの人物が含まれていません: ${missing.join(", ")}`,
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
        ].filter(
          (id) =>
            !(d.externalActors ?? [row.actor_id]).includes(id) &&
            !d.background?.participants.includes(id),
        ),
        true,
      );
      if (controlled.size)
        throw new SceneResponseError(
          "他プレイヤーをNPCの登場主体にできません。共有世界に確定済みの行動・返答は背景として参照してください",
        );
      const initialized = await this.agent.store.receipt(
        d.worldId,
        this.#initializationCommit(row),
      );
      const initializedIds = new Set(
        initialized?.changes.nodes
          .filter((n) => n.kind === "existence")
          .map((n) => n.id),
      );
      const creations = new Set(decision.creations.map((n) => n.id)),
        context = this.agent.store.context(d.worldId, d.basis),
        known = new Set<string>();
      const subjects = new Set([
          ...decision.participants,
          ...decision.unknowns.flatMap((q) =>
            typeof q !== "string" && q.targetId ? [q.targetId] : [],
          ),
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
        ...subjects,
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
          if (
            node &&
            !d.background?.creations.some((n) => n.id === id) &&
            !initializedIds.has(id)
          )
            throw new SceneResponseError(
              "既存の同一性を作り直すことはできません",
            );
          if (node) known.add(id);
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
          true,
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
            ? await this.agent.view(d.worldId, id, d.at, d.purpose)
            : await this.agent.intentView(d.worldId, id, d.at, d.purpose);
      await this.agent.store.context(d.worldId, d.basis).validate();
      d.background = decision;
      await this.#initializeLocations(row, !d.contextNeed && !established);
      if (cited) Object.assign(d.sources!, cited);
      delete d.work;
      delete d.backgroundMessages;
      const extending = !!d.contextNeed;
      delete d.contextNeed;
      if (!extending && !established) row.state = "ready";
      await this.#save(row, undefined, row.claim!);
      if (
        d.turns &&
        row.state === "ready" &&
        (await this.shared.turns.control(row.id)).flow === "closing"
      )
        await this.#transaction((db) => this.shared.wake(db, row.id));
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
  async #peerConditions(row: SceneRow, ids: string[], places: string[]) {
    const d = row.data;
    const known = new Map((d.peerConditions ?? []).map((p) => [p.actorId, p]));
    const read = await this.agent.playerConditions(
      d.worldId,
      ids.filter((id) => id !== row.actor_id && !known.has(id)),
      places,
      row.actor_id,
      d.at,
      d.basis,
    );
    for (const player of read.players) known.set(player.actorId, player);
    d.peerConditions = [...known.values()];
    d.at = Math.max(
      d.at,
      ...d.peerConditions.flatMap((p) =>
        p.locations.map((location) => location.at),
      ),
    );
    if (row.state === "preparing" && !d.background) d.startedAt = d.at;
    d.basis = read.dependencies;
  }
  async #sleepingPlayers(row: SceneRow, ids: string[]) {
    const d = row.data;
    const acting = d.turn?.inputs.map((input) => input.actorId) ?? [
      row.actor_id,
    ];
    const candidates = [
      ...new Set([
        ...ids,
        ...(d.externalActors ?? []),
        ...(d.peerConditions ?? []).map((p) => p.actorId),
      ]),
    ].filter((id) => !acting.includes(id));
    if (!candidates.length) return [];
    const players = await this.agent.controlledActors(
      d.worldId,
      candidates,
      true,
    );
    const awake = new Set(
      await this.shared.active(row.construction_id, [...players]),
    );
    return [...players].filter((id) => !awake.has(id));
  }
  async #chooseIntent(row: SceneRow, actor: string) {
    const d = row.data,
      bg = d.background!;
    const own = [
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
      : (await this.agent.intentView(d.worldId, actor, d.startedAt, d.purpose))
          .conditions;
    const locations = await this.#locations(row, [actor]),
      view = sceneView(
        d.views[actor]!,
        bg,
        d.events,
        own,
        d.at,
        d.choices.filter((i) => i.actorId === actor).map((i) => i.actionText),
      );
    view.conditions.push(
      ...locations[actor]!.map((location) => ({
        text: location.text,
        about: location.aboutIds,
        at: location.at,
      })),
    );
    const value = await this.#ask(
      row,
      "intent",
      "actor-intent.md",
      view,
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
    delete d.work;
    return choice.actionText;
  }
  async #action(row: SceneRow) {
    const d = row.data,
      turn = d.turn;
    const npcTurnId = turn?.npcActor ? turn.id : d.npcSoloTurn;
    if (npcTurnId && !d.actions.some((a) => a.id === npcTurnId)) {
      const actor = turn?.npcActor ?? row.actor_id;
      const active = turn
        ? (
            await this.pool.query(
              "SELECT 1 FROM world_controlled_actor WHERE world_id=$1 AND actor_id=$2 AND npc_active AND npc_session=$3",
              [d.worldId, actor, turn.id],
            )
          ).rowCount
        : (await npcActors(this.pool, d.worldId, [actor])).length;
      if (!active || d.departures?.[actor] !== undefined) {
        delete d.work;
        if (turn) return this.#completeTurn(row, []);
        row.state = "active";
        delete d.npcSoloTurn;
        await this.#save(row, undefined, row.claim!);
        return false;
      }
      const text = await this.#chooseIntent(row, actor);
      if (turn) {
        const seen = d.events
          .filter((e) => e.receipts.some((r) => r.observerId === actor))
          .map((e) => e.id);
        turn.inputs.push({ id: npcTurnId, actorId: actor, text, seen });
      }
      d.actions.push({
        id: npcTurnId,
        actorId: actor,
        text,
        state: "running",
      });
      await this.#save(row, undefined, row.claim!);
    }
    const continuing = turn?.continuingActor;
    if (turn && !turn.inputs.length && !continuing)
      return this.#completeTurn(row, []);
    if (
      continuing &&
      (!d.pending[continuing]?.continuing ||
        (await this.agent.controlledActors(d.worldId, [continuing], true)).has(
          continuing,
        ))
    )
      return this.#completeTurn(row, []);
    const action = continuing
        ? {
            id: turn!.id,
            text: d.pending[continuing]!.actionText,
            actorId: continuing,
            leave: false,
            state: "running",
          }
        : (d.turn
            ? d.actions.find((a) => a.id === d.turn!.inputs[0]!.id)
            : d.actions.at(-1))!,
      actor = action.actorId ?? row.actor_id,
      controlled = continuing
        ? [continuing]
        : d.turn
          ? d.turn.inputs.map((i) => i.actorId)
          : [actor];
    for (;;) {
      if (d.contextNeed) await this.#background(row);
      if (!d.peerConditions) {
        const seed = await this.agent.context(
          this.#request(row),
          d.basis,
          true,
        );
        d.basis = seed.dependencies;
        await this.#peerConditions(
          row,
          seed.controlledActorIds,
          seed.initialContext.flatMap(({ request }) =>
            request.kind === "node" ? [request.id] : [],
          ),
        );
      }
      const bg = d.background!;
      const away = new Set(
        await npcActors(this.pool, d.worldId, bg.participants),
      );
      const external = (d.externalActors ?? []).filter((id) => !away.has(id));
      const sleeping = new Set(
        await this.#sleepingPlayers(row, bg.participants),
      );
      if (d.peerConditions?.length) {
        const peers = await this.agent.controlledActors(
          d.worldId,
          d.peerConditions.map((p) => p.actorId),
          true,
        );
        d.peerConditions = d.peerConditions.filter((p) => peers.has(p.actorId));
      }
      if (!d.work) {
        const next = sceneContinuations(
          d.originalAgenda,
          bg.participants.filter(
            (id) =>
              !d.intentions[id] &&
              !d.nextDecisions.includes(id) &&
              !external.includes(id) &&
              !sleeping.has(id) &&
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
        !controlled.some(
          (id) => d.pending[id] || d.nextDecisions.includes(id),
        ) &&
        ![...away].some((id) => d.pending[id] || d.nextDecisions.includes(id))
      ) {
        if (d.turn) return this.#completeTurn(row, []);
        delete d.npcSoloTurn;
        action.state = "complete";
        row.state = "active";
        await this.#save(row, undefined, row.claim!);
        return false;
      }
      d.nextDecisions = d.nextDecisions.filter((id) => !sleeping.has(id));
      if (d.nextDecisions.length) {
        if (
          (
            await this.agent.controlledActors(
              d.worldId,
              [d.nextDecisions[0]!],
              true,
            )
          ).has(d.nextDecisions[0]!)
        ) {
          const returning = await this.pool.query(
            "SELECT 1 FROM world_npc_scene WHERE scene_id=$1 AND actor_id=$2 AND NOT handled LIMIT 1",
            [row.id, d.nextDecisions[0]],
          );
          if (!returning.rowCount) break;
          d.nextDecisions.shift();
          continue;
        }
        await this.#chooseIntent(row, d.nextDecisions[0]!);
        d.nextDecisions.shift();
        await this.#save(row, undefined, row.claim!);
        continue;
      }
      const observation =
        d.observationContext?.inputId === (d.turn?.id ?? action.id)
          ? d.observationContext
          : undefined;
      // Replayed calls must use the same snapshot, including the originating contact.
      const savedInput =
          d.work?.kind === "resolve"
            ? JSON.parse(d.work.messages[1]!.content)
            : undefined,
        currentLocations =
          savedInput?.currentLocations ?? (await this.#locations(row)),
        received: Awaited<ReturnType<SharedScenes["contacts"]["received"]>> =
          savedInput
            ? (savedInput.receivedContacts ?? [])
            : await this.shared.contacts.received(row.id, controlled);
      for (const receipt of received) d.at = Math.max(d.at, receipt.at);
      const intents = Object.values(d.pending).filter(
          (i) => !sleeping.has(i.actorId),
        ),
        livePlayers: ContactDecision["player"][] = savedInput
          ? (savedInput.livePlayers ?? [])
          : away.has(actor)
            ? []
            : await this.shared.contacts.states(
                row,
                [
                  ...new Set([
                    ...(d.peerConditions ?? []).map((p) => p.actorId),
                    ...received.map((r) => r.speaker),
                  ]),
                ].filter((id) => !bg.participants.includes(id)),
              );
      d.at = Math.max(d.at, ...livePlayers.map((p) => p.at));
      const value = await this.#ask(
          row,
          "resolve",
          "scene-play.md",
          {
            background: bg,
            currentLocations,
            ...(livePlayers.length ? { livePlayers } : {}),
            ...(received.length ? { receivedContacts: received } : {}),
            ...(d.peerConditions?.length
              ? {
                  otherPlayers: d.peerConditions.map((p) => ({
                    ...p,
                    controlledByPlayer: true,
                    contactChannel: bg.participants.includes(p.actorId)
                      ? "participant"
                      : sleeping.has(p.actorId)
                        ? null
                        : livePlayers.some((live) => live.actorId === p.actorId)
                          ? "liveContacts"
                          : "callsToPlayers",
                  })),
                }
              : {}),
            sleepingPlayerIds: [...sleeping],
            ...(observation
              ? {
                  observationLimits: observation.limits,
                  observationConditions: observation.conditions ?? [],
                  observationObservers: observation.observers ?? controlled,
                }
              : {}),
            sceneHistory: d.events,
            controlledView: d.views[actor],
            ...(await this.#belongings(row)),
            request: {
              at: d.at,
              controlledActorId: actor,
              ...(d.soloBot || d.npcSoloTurn
                ? { scenePurpose: d.purpose }
                : {}),
              ...(d.turn
                ? {
                    controlledActorIds: controlled,
                    playerActorIds: external,
                    humanInput: d.turn.sourceKind === "human" && !d.turn.reply,
                    controlledInputs: d.turn.inputs,
                    reactionTo:
                      d.turn.reply && !d.turn.idleInput
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
            responseSchema: z.toJSONSchema(
              observation ? ObservedStep : SceneStep,
              { io: "output" },
            ),
          },
          livePlayers.length ? "default" : "resolution",
        ),
        step = sceneResponse(
          value.value,
          !!observation && (!savedInput || !!savedInput.observationObservers),
        );
      if (step.type === "boundary") {
        if (observation)
          throw new SceneResponseError(
            "取得済みの観測範囲で本人が知覚した結果を返してください。",
          );
        break;
      }
      if (observation) {
        if (
          step.needsContext ||
          !step.events.some((e) =>
            e.receipts.some((r) =>
              (observation.observers ?? controlled).includes(r.observerId),
            ),
          )
        )
          throw new SceneResponseError(
            "照会済みの観測範囲から本人に届いた結果をreceiptsに返してください。識別できなかった場合もその範囲を示し、同じ観測を再照会しません。",
          );
        delete d.observationContext;
      }
      if (step.needsContext)
        for (const id of d.turn
          ? Object.keys(step.needsContext.remainingActions)
          : [actor])
          if (step.decisions[id] === "finished") step.decisions[id] = "pending";
      const actors = new Set(intents.map((i) => i.actorId));
      const contacts = new Map<string, string[]>();
      const live: ContactDecision[] = [];
      for (const event of step.events)
        event.receipts = event.receipts.filter(
          (r) => !sleeping.has(r.observerId),
        );
      step.arrivals = step.arrivals.filter((a) => !sleeping.has(a.observerId));
      step.newDecisions = step.newDecisions.filter((id) => !sleeping.has(id));
      for (const call of step.liveContacts ?? []) {
        const player = livePlayers.find((p) => p.actorId === call.observerId);
        const event = step.events[call.eventIndex];
        const eventId = sceneId(
          `${row.id}:event:${d.events.length + call.eventIndex}`,
        );
        if (
          !player ||
          !event ||
          !controlled.includes(event.actorId) ||
          (call.receipt !== null && !player.available) ||
          live.some(
            (c) =>
              c.player.actorId === call.observerId && c.eventId === eventId,
          )
        )
          throw new SceneResponseError(
            "接触を試みた本人の出来事、対象プレイヤーと到達の有無を照合してください",
          );
        live.push({
          player,
          eventId,
          inputId:
            d.turn?.inputs.find((i) => i.actorId === event.actorId)?.id ??
            action.id,
          speaker: event.actorId,
          text: call.receipt,
        });
        if (call.receipt !== null)
          event.receipts.push({
            observerId: player.actorId,
            text: call.receipt,
          });
      }
      for (const call of step.callsToPlayers ?? []) {
        if (sleeping.has(call.observerId)) continue;
        const event = step.events[call.eventIndex];
        if (
          d.shared ||
          livePlayers.some((p) => p.actorId === call.observerId) ||
          !event ||
          !d.peerConditions?.some(
            (p) =>
              p.actorId === call.observerId &&
              p.states.some(
                (state) => state.relationId === call.positionRelationId,
              ),
          ) ||
          event.receipts.some((r) => r.observerId === call.observerId)
        )
          throw new SceneResponseError(
            "参加要請には呼びかけの出来事と、参照した他プレイヤー本人への到達が必要です",
          );
        const lines = contacts.get(call.observerId) ?? [];
        lines.push(call.text);
        contacts.set(call.observerId, lines);
        event.receipts.push({ observerId: call.observerId, text: call.text });
      }
      if (
        Object.keys(step.decisions).sort().join() !== [...actors].sort().join()
      )
        throw new SceneResponseError("シーンで未解決の意図が省略されています");
      const returnsControl = d.turn
        ? controlled.every(
            (id) =>
              step.decisions[id] === "finished" ||
              step.decisions[id] === "decide",
          )
        : step.decisions[actor] === "finished" ||
          step.decisions[actor] === "decide" ||
          step.newDecisions.includes(actor);
      // Keep the scene open for a response to the delivered call.
      if (live.some((c) => c.text !== null)) delete step.concluded;
      for (const e of step.events) {
        if (
          !actors.has(e.actorId) ||
          e.locations?.some(
            (location) => !bg.participants.includes(location.subjectId),
          ) ||
          e.receipts.some(
            (p) =>
              (!bg.participants.includes(p.observerId) &&
                !step.liveContacts?.some(
                  (c) =>
                    c.receipt !== null &&
                    step.events[c.eventIndex] === e &&
                    c.observerId === p.observerId,
                ) &&
                !(step.callsToPlayers ?? []).some(
                  (c) =>
                    step.events[c.eventIndex] === e &&
                    c.observerId === p.observerId,
                )) ||
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
      let nextAt = d.at + step.elapsedMs;
      if (!Number.isSafeInteger(nextAt))
        throw new SceneResponseError("シーンの経過時点が不正です");
      const receivers = sceneArrivals(
        d.events,
        step.arrivals,
        bg.participants,
        actor,
        d.events.at(-1)?.period.until ?? d.at,
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
      // 表示する出来事を保存する前に確定する。競合すれば出来事ごと最新の状態から解決し直す。
      {
        try {
          const positions = new Map(
            step.events.flatMap((e) =>
              e.locations.map(
                (location) => [location.subjectId, location] as const,
              ),
            ),
          );
          nextAt = await this.#state(row, nextAt, [
            ...belongingOps(step.belongings ?? []),
            ...[...positions.values()].map((location) => ({
              type: "locate" as const,
              ...location,
            })),
          ]);
        } catch (error) {
          if (
            error instanceof WorldConflict ||
            !(error instanceof Error) ||
            (!(error instanceof BelongingRejected) &&
              error.constructor !== Error)
          )
            throw error;
          throw new SceneResponseError(
            `状態更新を確定できません: ${error.message}`,
          );
        }
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
        // Only an in-flight legacy resolve was asked to defer afterObservation verbatim.
        const remaining =
          typeof status === "object"
            ? status.pending
            : observation && savedInput?.afterObservation?.[id];
        if (remaining && !step.departures.some((exit) => exit.actorId === id)) {
          d.pending[id] = {
            ...d.pending[id]!,
            actionText: remaining,
            continuing: true,
          };
          step.decisions[id] = "pending";
          delete step.concluded;
        } else if (status !== "pending") delete d.pending[id];
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
      if (live.length) row.contactDecisions = live;
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
      // 他プレイヤーの入力へ引き継いだ後の不足条件は、その入力を受けて判断し直す。
      // 同じ応答の背景要求を持ち越して、相手の返答をNPCとして生成しない。
      if (contacts.size || live.some((c) => c.text !== null))
        delete step.needsContext;
      if (
        step.needsContext &&
        (!returnsControl ||
          Object.keys(step.needsContext.remainingActions).some(
            (id) => away.has(id) && d.pending[id],
          ))
      ) {
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
      }
      if (contacts.size) {
        d.encounter = { inputId: action.id };
        await this.#transaction(async (db) => {
          await this.shared.lock(db, row.construction_id);
          await this.#save(row, db, row.claim!);
          await this.shared.contact(db, row, contacts);
        });
        return false;
      }
      if (d.contextNeed) {
        await this.#save(row, undefined, row.claim!);
        continue;
      }
      if (d.turn) {
        const targets = [
          ...new Set([
            ...step.newDecisions,
            ...Object.entries(step.decisions)
              .filter(([, status]) => status === "decide")
              .map(([id]) => id),
          ]),
        ].filter(
          (id) =>
            external.includes(id) &&
            !sleeping.has(id) &&
            (!controlled.includes(id) ||
              step.events.some(
                (e) =>
                  e.actorId !== id &&
                  e.receipts.some((p) => p.observerId === id),
              ) ||
              step.arrivals.some(
                (a) =>
                  a.observerId === id && d.events[a.eventIndex]?.actorId !== id,
              )),
        );
        d.nextDecisions = d.nextDecisions.filter(
          (id) => !external.includes(id),
        );
        if (
          step.concluded ||
          targets.length ||
          ((continuing || controlled.every((id) => !d.pending[id])) &&
            !d.nextDecisions.some((id) => away.has(id))) ||
          (await this.shared.turns.control(row.id)).flow === "inactive"
        ) {
          const recipients =
            d.turn.sourceKind === "human" && !d.turn.reply
              ? d.events
                  .slice(d.turn.eventStart)
                  .flatMap((e) => e.receipts.map((p) => p.observerId))
                  .filter((id) => !controlled.includes(id))
              : targets;
          return this.#completeTurn(
            row,
            recipients.filter((id) => !away.has(id) && !sleeping.has(id)),
            !!step.concluded,
          );
        }
      }
      if (
        !d.turn &&
        !d.nextDecisions.some((id) => away.has(id)) &&
        (step.decisions[actor] === "finished" ||
          step.decisions[actor] === "decide" ||
          step.newDecisions.includes(actor))
      ) {
        action.state = "complete";
        row.state = "active";
        d.nextDecisions = d.nextDecisions.filter((id) => id !== actor);
        const npcTurn = !!d.npcSoloTurn;
        delete d.npcSoloTurn;
        if (npcTurn && step.concluded) {
          row.state = "reflecting";
          d.ending = "concluded";
          await this.#save(row, undefined, row.claim!);
          return true;
        }
        if (d.soloBot && step.concluded) {
          await this.#transaction(async (db) => {
            await this.shared.lock(db, row.construction_id);
            d.soloProposal = await this.shared.turns.propose(db, row, [actor]);
            await this.#save(row, db, row.claim!);
          });
        } else await this.#save(row, undefined, row.claim!);
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
    delete d.work;
    if (d.turn) return this.#completeTurn(row, [], true);
    d.nextPurpose = action.text;
    action.state = "boundary";
    row.state = "reflecting";
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
      await this.#locations(row);
      const anchors = sceneAnchors(
          d.background!,
          d.events,
          d.startedAt,
          row.id,
          true,
        ),
        context = this.agent.store.context(d.worldId, d.basis);
      const nodes: typeof anchors.nodes = [];
      for (const node of anchors.nodes)
        if (node.kind !== "existence" || !(await context.node(node.id)))
          nodes.push(node);
      anchors.nodes = nodes;
      d.basis = context.dependencies;
      const locationScripts = new Set(
        Object.values(d.sources ?? {})
          .filter(
            (s) =>
              s.edge.kind === "status" &&
              s.edge.role === "content" &&
              s.edge.text === "location",
          )
          .map((s) => s.edge.target),
      );
      const sources = Object.fromEntries(
        Object.entries(d.sources ?? {}).filter(
          ([, s]) =>
            s.edge.kind !== "status" ||
            (s.edge.text !== "location" && !locationScripts.has(s.edge.source)),
        ),
      );
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
              ...(d.sources ? { sources } : {}),
              background: d.background!,
              events: d.events,
              anchors,
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
        receivedContacts: await this.shared.contacts.received(row.id, [viewer]),
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
        await this.shared.turns.cancelIdleOffer(client, row.id);
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
      !(error instanceof ContactChanged) &&
      !(error instanceof WorldConflict) &&
      !(error instanceof SceneResponseError) &&
      !(error instanceof SyntaxError) &&
      !(error instanceof z.ZodError)
    )
      return false;
    // Resume from durable progress, discarding only the unaccepted response.
    const validationErrors =
      error instanceof z.ZodError ? error.issues : error.message;
    const saved = (
      await this.pool.query<SceneRow>(
        "SELECT * FROM world_scene WHERE id=$1 AND claim=$2",
        [row.id, row.claim],
      )
    ).rows[0];
    if (error instanceof ContactChanged) {
      if (!saved) throw new SupersededWorker("シーンの実行が引き継がれました");
      delete row.contactDecisions;
      Object.assign(row, saved);
      delete row.data.work;
      await this.#save(row, undefined, row.claim!);
      return true;
    }
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
        content: JSON.stringify({ validationErrors }),
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
          !row.data.turns &&
          row.state === "active" &&
          !row.data.encounter &&
          !row.data.soloProposal &&
          !(await npcActors(client, row.data.worldId, [row.actor_id])).length
        ) {
          const reply = await this.shared.contacts.nextReply(client, row.id);
          if (reply) {
            row.data.soloBot = reply.kind === "bot";
            row.data.requestId = row.data.commandId = reply.requestId;
            this.#startAction(row, reply.actor, {
              id: reply.requestId,
              text: reply.actionText,
            });
          }
        }
        if (
          !row.data.shared &&
          !row.data.encounter &&
          ["ready", "active"].includes(row.state) &&
          (await npcActors(client, row.data.worldId, [row.actor_id])).length
        ) {
          if (row.data.soloProposal) {
            await client.query(
              "UPDATE world_scene_end_vote SET state='closed' WHERE id=$1",
              [row.data.soloProposal],
            );
            delete row.data.soloProposal;
            row.state = "reflecting";
          } else {
            row.data.npcSoloTurn = randomUUID();
            row.state = "acting";
          }
        }
        if (row.data.encounter) {
          const encounter = row.data.encounter;
          const invitation = await this.shared.get(row.id, client);
          // A deadline may run late; a wake can settle an expired invitation too.
          if (
            invitation?.phase === "inviting" &&
            (await this.shared.settle(client, invitation)).phase === "inviting"
          )
            return row;
          const joined = (await this.shared.members(row.id, client)).filter(
            (m) => m.state === "joined" && m.actor_id !== row.actor_id,
          );
          if (joined.length) {
            row.data.shared = true;
            row.data.turns = true;
            row.data.externalActors = [
              row.actor_id,
              ...joined.map((m) => m.actor_id),
            ];
            for (const member of joined) {
              row.data.background!.participants.push(member.actor_id);
              row.data.views[member.actor_id] = await this.agent.view(
                row.data.worldId,
                member.actor_id,
                row.data.at,
                row.data.purpose,
              );
            }
            const action = row.data.actions.find(
              (a) => a.id === encounter.inputId,
            )!;
            await this.shared.turns.publish(
              client,
              row,
              {
                id: action.id,
                sourceKind: row.data.soloBot ? "bot" : "human",
                reply: false,
              },
              joined.map((m) => m.actor_id),
            );
            delete row.data.peerConditions;
            action.state = "complete";
            action.completedAt = new Date().toISOString();
            row.state = "active";
            row.data.nextDecisions = row.data.nextDecisions.filter(
              (id) => id !== row.actor_id,
            );
          } else {
            await client.query(
              "DELETE FROM world_scene_member WHERE scene_id=$1",
              [row.id],
            );
            await client.query(
              "DELETE FROM world_shared_scene WHERE scene_id=$1",
              [row.id],
            );
          }
          delete row.data.encounter;
          await this.#save(row, client);
        }
        if (
          row.data.turns &&
          (["active", "acting"].includes(row.state) ||
            (row.state === "ready" &&
              (await this.shared.turns.control(row.id, client)).flow ===
                "closing")) &&
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
          if (
            row.data.background &&
            !row.data.operationId &&
            row.data.externalActors?.some(
              (id) => !row.data.background!.participants.includes(id),
            )
          )
            await this.agent.model.run(
              this.#budget(row),
              () => this.#background(row),
              row.data.worldId,
              row.user_id ?? undefined,
              { role: "user", actorId: row.actor_id },
            );
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
        if (row.contactDecisions) {
          const prior = await this.pool.query<SceneRow>(
            "SELECT * FROM world_scene WHERE id=$1 AND claim=$2",
            [row.id, claim],
          );
          if (!prior.rows[0]) return;
          delete row.contactDecisions;
          Object.assign(row, prior.rows[0]);
        }
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
    for (const { id } of (
      await this.pool.query<{
        id: string;
      }>(`SELECT s.id FROM world_scene s JOIN world_shared_scene h ON h.scene_id=s.id
      WHERE s.data ? 'turns' AND ((s.state='active' AND h.flow IN ('open','manual','closing'))
        OR (s.state='ready' AND h.flow='closing'))`)
    ).rows)
      await this.shared.transaction((db) => this.shared.wake(db, id));
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
