import { type SceneRecords } from "./scene-records.js";
import { SharedScenes } from "./shared-scenes.js";
import { type ContactDecision } from "./player-contact.js";
import type { SceneDraft } from "./scene-sessions.js";
import type { SharedTurn } from "./shared-turns.js";
import {
  InformationReference,
  type Information,
  type Presentation,
  type InspectionManifest,
} from "@gestaloka/contracts";
import { z } from "zod";
import type pg from "pg";
import { type ChatMessage } from "../llm/client.js";
import { type Dependency } from "../world/store.js";
import { type WorldProposal, type WorldAgent } from "./agent.js";
import { type Construction, type WorldConstruction } from "./construction.js";
import {
  SceneBackground,
  ContextNeed,
  type RecordedSceneEvent,
  type SceneIntent,
  type SceneView,
  type SceneEnding,
  type SceneSources,
} from "./scene-data.js";
type Narrative = {
  text: string;
  information?: z.infer<typeof InformationReference>[];
};
type Work = {
  id: string;
  actorId?: string;
  formatAttempts?: number;
  repairConclusion?: boolean;
  kind: "background" | "resolve" | "intent" | "result";
  messages: ChatMessage[];
  target: "default" | "resolution";
  records?: SceneRecords;
};
export type SceneData = {
  playVersion?: 4;
  turns?: true;
  awaiting?: string[];
  soloBot?: boolean;
  npcSoloTurn?: string;
  soloProposal?: string;
  deferredSoloAction?: { id: string; text: string; submittedAt: string };
  turn?: SharedTurn;
  ending?: SceneEnding;
  drafts?: SceneDraft[];
  handoff?: true;
  splitActors?: string[];
  finishActors?: string[];
  sessionIds?: Record<string, string>;
  lastInputId?: string;
  carriedInputs?: Record<string, SceneData["actions"][number]>;
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
  participantResults?: Record<string, Narrative>;
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
  get sessions() {
    return this.shared.sessions;
  }
  constructor(readonly construction: WorldConstruction) {
    this.queueName = `${construction.queueName}-scenes`;
    this.shared = new SharedScenes(construction);
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
  }
  async latest(
    world: string,
    client: Pick<pg.Pool, "query"> = this.pool,
    compact = false,
    actorId?: string,
    sceneId?: string,
  ) {
    const current = sceneId
      ? {
          scene_id: actorId
            ? await this.sessions.resolve(sceneId, actorId, client)
            : sceneId,
        }
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
}
