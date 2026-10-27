import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import {
  InspectionManifest,
  InspectionSelection,
  InspectionScene,
  type Presentation,
} from "@gestaloka/contracts";
import type { SceneRow } from "../runtime/scene.js";
import { sceneId } from "../runtime/scene-data.js";
import { canonical } from "../llm/prompt.js";
import { AccessError } from "../http/access.js";
import { measure } from "./measure.js";

type Database = Pick<pg.Pool, "query">;
export const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export class InspectionStore {
  static async setup(db: Database) {
    await db.query(`CREATE TABLE IF NOT EXISTS inspection_manifest(id text PRIMARY KEY,world_id uuid NOT NULL,actor_id uuid NOT NULL,user_id uuid,captured_at timestamptz NOT NULL DEFAULT now(),data jsonb NOT NULL,measurement jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS inspection_weights(version text PRIMARY KEY,definition jsonb NOT NULL);
      CREATE INDEX IF NOT EXISTS inspection_manifest_history ON inspection_manifest(world_id,captured_at,id);
      CREATE TABLE IF NOT EXISTS inspection_evidence(manifest_id text NOT NULL REFERENCES inspection_manifest(id) ON DELETE CASCADE,position integer NOT NULL,value jsonb NOT NULL,PRIMARY KEY(manifest_id,position));
      CREATE TABLE IF NOT EXISTS inspection_evaluation(id uuid PRIMARY KEY,manifest_id text NOT NULL REFERENCES inspection_manifest(id) ON DELETE CASCADE,configuration jsonb NOT NULL,status text NOT NULL DEFAULT 'queued',result jsonb,created_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE inspection_evaluation ADD COLUMN IF NOT EXISTS lease_until timestamptz;
      CREATE TABLE IF NOT EXISTS inspection_schedule(world_id uuid PRIMARY KEY,version integer NOT NULL,configuration jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS inspection_batch(id uuid PRIMARY KEY,world_id uuid NOT NULL,configuration_version integer NOT NULL,configuration jsonb NOT NULL,at timestamptz NOT NULL,targets jsonb NOT NULL,status text NOT NULL DEFAULT 'queued',result jsonb);
      CREATE INDEX IF NOT EXISTS inspection_batch_world ON inspection_batch(world_id,at,id);`);
    await db.query(
      "CREATE TABLE IF NOT EXISTS inspection_checkpoint(world_id uuid NOT NULL,scene_id uuid NOT NULL,configuration_version integer NOT NULL,revision bigint NOT NULL,PRIMARY KEY(world_id,scene_id,configuration_version))",
    );
  }
  static async select(
    db: Database,
    input: z.input<typeof InspectionSelection>,
  ) {
    const selection = InspectionSelection.parse(input);
    await this.weights(db, selection.weights);
    // One statement fixes scene membership, prior history and ledger rows at one MVCC snapshot.
    const result = (
      await db.query<{
        selected: RawScene[];
        prior: Presentation[];
        prior_missing: string[];
      }>(
        `
      WITH endpoint AS (SELECT created_at,id FROM world_scene WHERE id=$4 AND construction_id=$1 AND actor_id=$2 AND user_id IS NOT DISTINCT FROM $3::uuid),
      chosen AS (SELECT s.* FROM world_scene s,endpoint e WHERE s.construction_id=$1 AND s.actor_id=$2 AND s.user_id IS NOT DISTINCT FROM $3::uuid AND (s.created_at,s.id)<=(e.created_at,e.id) ORDER BY s.created_at DESC,s.id DESC LIMIT $5),
      first AS (SELECT created_at,id FROM chosen ORDER BY created_at,id LIMIT 1),
      prior AS (SELECT s.* FROM world_scene s,first f WHERE s.construction_id=$1 AND s.actor_id=$2 AND s.user_id IS NOT DISTINCT FROM $3::uuid AND (s.created_at,s.id)<(f.created_at,f.id))
      SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('row',to_jsonb(s),'calls',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',c.id,'responseId',c.response_id,'model',coalesce(c.response->>'model',c.request->'request'->>'model'),'configurationVersion',c.request->'configurationVersion',
        'task',c.request->>'role','status',c.state||':'||c.delivery,'nanoUsd',c.charged_nano::text,'reservedNanoUsd',c.reserved_nano::text,'elapsedMs',c.elapsed_ms,
        'inputTokens',c.response#>'{usage,prompt_tokens}','outputTokens',c.response#>'{usage,completion_tokens}') ORDER BY c.created_at,c.id) FROM llm_call c
        WHERE c.response_id=ANY(ARRAY[s.id,(s.data->>'reflectionResponseId')::uuid]||(SELECT coalesce(array_agg((a->>'id')::uuid),'{}'::uuid[]) FROM jsonb_array_elements(s.data->'actions') a))
        AND c.request->>'role' IS DISTINCT FROM 'narrative-inspection'), '[]'::jsonb)) ORDER BY s.created_at,s.id) FROM chosen s),'[]'::jsonb) AS selected,
      coalesce((SELECT jsonb_agg(p.value ORDER BY s.created_at,s.id,p.ordinality) FROM prior s CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.data->'presentations','[]')) WITH ORDINALITY p),'[]'::jsonb) AS prior,
      coalesce((SELECT jsonb_agg(s.id ORDER BY s.created_at,s.id) FROM prior s WHERE s.data->>'recordingVersion' IS NULL),'[]'::jsonb) AS prior_missing`,
        [
          selection.worldId,
          selection.actorId,
          selection.userId,
          selection.endSceneId,
          selection.n,
        ],
      )
    ).rows[0]!;
    if (!result.selected.length)
      throw new AccessError(
        404,
        "INSPECTION_SCENE_NOT_FOUND",
        "指定した本人のシーンが見つかりません",
      );
    const scenes = result.selected.map(({ row, calls }) => {
      const d = row.data;
      const scene = {
        id: row.id,
        state: row.state,
        createdAt: new Date(row.created_at).toISOString(),
        inputs: d.actions.map((a) => ({
          ...a,
          submittedAt: a.submittedAt ?? null,
          completedAt: a.completedAt ?? null,
        })),
        presentations: d.presentations ?? legacyPresentations(row),
        calls,
        administratorEvidence: {
          background: d.background ?? null,
          events: d.events,
          dependencies: d.basis,
          projection: d.projection ?? null,
        },
        recording: d.recordingVersion ? "recorded" : "legacy",
      };
      return InspectionScene.parse({ ...scene, revision: digest(scene) });
    });
    const content = {
      recordVersion: "inspection-record-v1" as const,
      selection,
      requestedScenes: selection.n,
      actualScenes: scenes.length,
      prior: result.prior,
      priorMissingScenes: [
        ...new Set([
          ...result.prior_missing,
          ...result.prior
            .filter((p) => p.information === null)
            .map((p) => p.sceneId),
        ]),
      ],
      scenes,
    };
    const manifest = InspectionManifest.parse({
      ...content,
      id: digest(content),
      capturedAt: new Date().toISOString(),
    });
    const measurement = measure(manifest);
    await db.query(
      "INSERT INTO inspection_manifest(id,world_id,actor_id,user_id,data,measurement) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [
        manifest.id,
        selection.worldId,
        selection.actorId,
        selection.userId,
        JSON.stringify(manifest),
        JSON.stringify(measurement),
      ],
    );
    await db.query(
      "INSERT INTO inspection_evidence(manifest_id,position,value) SELECT $1,(ordinality-1)::int,value FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY ON CONFLICT DO NOTHING",
      [manifest.id, JSON.stringify(entries(manifest))],
    );
    return this.read(db, selection.worldId, manifest.id);
  }
  static async manifest(db: Database, worldId: string, id: string) {
    const row = (
      await db.query<{ data: InspectionManifest }>(
        "SELECT data FROM inspection_manifest WHERE id=$1 AND world_id=$2",
        [id, worldId],
      )
    ).rows[0];
    if (!row)
      throw new AccessError(
        404,
        "INSPECTION_MANIFEST_NOT_FOUND",
        "保存済みmanifestが見つかりません。復元前・削除後のIDは利用できません",
      );
    return InspectionManifest.parse(row.data);
  }
  static async weights(
    db: Database,
    weights: z.infer<typeof InspectionSelection>["weights"],
  ) {
    if (
      weights.version === "unit-v1" &&
      Object.values(weights.values).some((w) => w !== 1)
    )
      throw new AccessError(
        409,
        "INSPECTION_WEIGHTS_CHANGED",
        "unit-v1は全区分1です。別の重み版を指定してください",
      );
    await db.query(
      "INSERT INTO inspection_weights(version,definition) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [weights.version, weights],
    );
    const saved = (
      await db.query(
        "SELECT definition FROM inspection_weights WHERE version=$1",
        [weights.version],
      )
    ).rows[0].definition;
    if (digest(saved) !== digest(weights))
      throw new AccessError(
        409,
        "INSPECTION_WEIGHTS_CHANGED",
        "同じ重み版の定義は変更できません。別の版を指定してください",
      );
  }
  static async read(db: Database, worldId: string, id: string, after = 0) {
    const row = (
      await db.query(
        `SELECT (data-'prior'-'scenes')||jsonb_build_object('sceneOrder',(SELECT jsonb_agg(jsonb_build_object('id',s.value->'id','revision',s.value->'revision','state',s.value->'state') ORDER BY s.ordinality) FROM jsonb_array_elements(data->'scenes') WITH ORDINALITY s)) AS manifest,measurement-'scenes'-'diffs' AS measurement,
      (SELECT count(*)::int FROM inspection_evidence WHERE manifest_id=$1) AS total
      FROM inspection_manifest WHERE id=$1 AND world_id=$2`,
        [id, worldId],
      )
    ).rows[0];
    if (!row)
      throw new AccessError(
        404,
        "INSPECTION_MANIFEST_NOT_FOUND",
        "保存済みmanifestが見つかりません。復元前・削除後のIDは利用できません",
      );
    const evidence = (
      await db.query(
        "SELECT value FROM inspection_evidence WHERE manifest_id=$1 AND position>=$2 ORDER BY position LIMIT 51",
        [id, after],
      )
    ).rows;
    const page = evidence.slice(0, 50).map((r) => r.value);
    if (after > row.total)
      throw new AccessError(
        409,
        "INSPECTION_CURSOR_INVALID",
        "同じmanifestの続きの位置を指定してください",
      );
    return {
      manifest: row.manifest,
      measurement: row.measurement,
      items: page,
      next: evidence.length > 50 ? after + page.length : null,
      fetched: {
        offset: after,
        count: page.length,
        total: row.total,
        complete: after === 0 && page.length === row.total,
      },
      retention:
        "DBとバックアップに保存されたmanifestは不変。削除・復元で失われたIDは404。後日のグラフ状態は追加しない。",
    };
  }
}
type RawScene = {
  row: SceneRow & { created_at: string };
  calls: z.infer<typeof InspectionScene>["calls"];
};
function legacyPresentations(row: SceneRow): Presentation[] {
  const d = row.data,
    parts: {
      key: string;
      kind: Presentation["kind"];
      text: string;
      at: number;
    }[] = [];
  if (d.background)
    parts.push({
      key: "synopsis",
      kind: "synopsis",
      text: d.background.synopsis,
      at: d.startedAt,
    });
  for (const e of d.events)
    for (const p of e.receipts)
      if (p.observerId === row.actor_id)
        parts.push({
          key: e.id,
          kind: "response",
          text: p.text,
          at: e.period.until,
        });
  if (row.state === "result" && d.result)
    parts.push({ key: "result", kind: "result", text: d.result, at: d.at });
  return parts.map((p, ordinal) => ({
    id: sceneId(`${row.id}:presentation:${p.key}`),
    sceneId: row.id,
    inputId: null,
    kind: p.kind,
    text: p.text,
    at: p.at,
    ordinal,
    providedAt: null,
    information: null,
  }));
}
export function entries(m: InspectionManifest) {
  const items: {
    id: string;
    section: string;
    sceneId: string | null;
    inputId: string | null;
    value: unknown;
  }[] = [];
  const add = (
    id: string,
    section: string,
    sceneId: string | null,
    inputId: string | null,
    value: unknown,
  ) => items.push({ id, section, sceneId, inputId, value });
  for (const p of m.prior) add(p.id, "prior", p.sceneId, p.inputId, p);
  for (const s of m.scenes) {
    add(s.id, "scene", s.id, null, {
      id: s.id,
      revision: s.revision,
      state: s.state,
      createdAt: s.createdAt,
      recording: s.recording,
    });
    for (const a of s.inputs) add(a.id, "input", s.id, a.id, a);
    for (const p of s.presentations)
      add(p.id, "presentation", s.id, p.inputId, p);
    for (const c of s.calls) add(c.id, "call", s.id, c.responseId, c);
    add(`${s.id}:background`, "administrator", s.id, null, {
      background: s.administratorEvidence.background,
      dependencies: s.administratorEvidence.dependencies,
    });
    for (const [i, event] of s.administratorEvidence.events.entries())
      add(`${s.id}:event:${i}`, "administrator", s.id, null, event);
    add(
      `${s.id}:projection`,
      "administrator",
      s.id,
      null,
      s.administratorEvidence.projection,
    );
  }
  const measurement = measure(m);
  for (const s of measurement.scenes)
    add(`${s.id}:measurement`, "measure-scene", s.id, null, s);
  for (const d of measurement.diffs)
    add(`${d.presentationId}:diff`, "measure-diff", d.sceneId, d.inputId, d);
  return items;
}
