import type pg from "pg";
import type { WorldStore } from "../world/store.js";
import {
  sceneAnchors,
  type SceneBackground,
  type RecordedSceneEvent,
} from "./scene-data.js";
import type { SceneRow } from "./scene.js";

/** Immutable causal prefixes; the canonical graph is written only by scene reflection. */
export type SceneDraft = {
  sceneId: string;
  at: number;
  startedAt: number;
  background: SceneBackground;
  events: RecordedSceneEvent[];
};

export class SceneDrafts {
  constructor(
    readonly pool: pg.Pool,
    readonly store: WorldStore,
  ) {}

  async setup() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS world_scene_dependency (
      child_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,
      parent_id uuid NOT NULL REFERENCES world_scene(id) ON DELETE CASCADE,
      PRIMARY KEY(child_id,parent_id));
      CREATE INDEX IF NOT EXISTS world_scene_dependency_parent ON world_scene_dependency(parent_id);`);
  }

  async inherit(db: pg.PoolClient, child: SceneRow, prior: SceneRow) {
    const exit = prior.data.departures?.[child.actor_id];
    const drafts = [...(prior.data.drafts ?? [])];
    if (exit !== undefined || prior.data.waitingFor?.length) {
      const events = prior.data.events.slice(
        0,
        exit ?? prior.data.events.length,
      );
      drafts.push({
        sceneId: prior.id,
        at: events.at(-1)?.period.until ?? prior.data.startedAt,
        startedAt: prior.data.startedAt,
        background: prior.data.background!,
        events,
      });
    }
    child.data.drafts = drafts;
    child.data.at = child.data.startedAt = Math.max(
      child.data.at,
      ...drafts.map((d) => d.at),
    );
    for (const d of drafts)
      await db.query(
        "INSERT INTO world_scene_dependency(child_id,parent_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [child.id, d.sceneId],
      );
  }

  run<T>(row: SceneRow, work: () => Promise<T>) {
    return this.store.withDrafts(
      row.data.worldId,
      (row.data.drafts ?? []).map((d) => ({
        at: d.startedAt,
        changes: sceneAnchors(d.background, d.events, d.startedAt, d.sceneId),
      })),
      work,
    );
  }

  async waitingFor(row: SceneRow) {
    const parents = (
      await this.pool.query<{
        id: string;
        commit_id: string | null;
      }>(
        `SELECT s.id,o.commit_id FROM world_scene_dependency d JOIN world_scene s ON s.id=d.parent_id
      LEFT JOIN world_operation o ON o.id=(s.data->>'operationId')::uuid WHERE d.child_id=$1 ORDER BY s.created_at,s.id`,
        [row.id],
      )
    ).rows;
    const waiting: string[] = [];
    for (const p of parents) {
      const receipt = p.commit_id
        ? await this.store.receipt(row.data.worldId, p.commit_id)
        : undefined;
      if (!receipt) waiting.push(p.id);
    }
    return waiting;
  }

  async dependents(db: pg.PoolClient, parent: string) {
    return (
      await db.query<{ id: string; shared: boolean }>(
        `SELECT s.id,s.data ? 'shared' AS shared FROM world_scene_dependency d JOIN world_scene s ON s.id=d.child_id
      WHERE d.parent_id=$1 AND s.state='reflecting'`,
        [parent],
      )
    ).rows;
  }
}
