import type pg from "pg";
import type { z } from "zod";
import { JobQuery, JobKind } from "@gestaloka/contracts";
import { AccessError } from "../http/access.js";
import { RuntimeExecutions } from "./executions.js";
import { sceneId } from "./scene-data.js";
import type { WorldPlayers } from "./players.js";
import { RuntimeControl } from "./control.js";

const sources = `WITH logical AS (
  SELECT 'construction' AS kind,c.id,c.id AS world_id,b.world_id AS graph_world_id,c.user_id,c.participant_id AS actor_id,c.state,c.at,c.error,
    CASE WHEN c.world_id IS NULL THEN c.id WHEN c.state IN ('playing','play_paused') THEN coalesce(c.budget_id,c.id) ELSE coalesce((c.current->>'id')::uuid,c.id) END AS response_id,
    (c.current->>'operationId')::uuid AS operation_id,b.commit_id,NULL::uuid AS action_id,NULL::text AS phase
  FROM world_construction c JOIN world_build b ON b.run_id=c.id
  UNION ALL
  SELECT 'scene',s.id,s.construction_id,b.world_id,s.user_id,s.actor_id,s.state,(s.data->>'at')::bigint,s.data->>'error',NULL,
    (s.data->>'operationId')::uuid,NULL,(s.data->'actions'->-1->>'id')::uuid,CASE WHEN s.state='paused' THEN s.data->>'resumeState' ELSE s.state END
  FROM world_scene s JOIN world_build b ON b.run_id=s.construction_id
  UNION ALL
  SELECT 'join',j.id,j.construction_id,b.world_id,j.subject_id,j.actor_id,j.state,j.at,j.error,j.id,j.operation_id,NULL,NULL,NULL
  FROM world_join j JOIN world_build b ON b.run_id=j.construction_id)
`;
type Database = Pick<pg.Pool, "query">;
export async function readJobs(
  db: Database,
  q: z.infer<typeof JobQuery>,
  entry?: { kind: z.infer<typeof JobKind>; id: string },
) {
  await RuntimeExecutions.reconcile(db);
  const rows = (
    await db.query(
      `${sources} SELECT l.*,o.run_id,coalesce(o.commit_id,l.commit_id) AS committed_id,
    coalesce(r.job_id,j.id) AS job_id,r.state AS execution_state,r.deliveries,r.error_code,r.started_at,r.finished_at,
    j.name AS queue,j.state AS job_state,j.retry_count,j.started_on,j.created_on
    FROM logical l LEFT JOIN world_operation o ON o.id=l.operation_id LEFT JOIN runtime_execution r ON r.kind=l.kind AND r.id=l.id
    LEFT JOIN LATERAL(SELECT id,name,state,retry_count,started_on,created_on FROM pgboss.job WHERE
      (r.job_id IS NOT NULL AND id=r.job_id) OR (r.job_id IS NULL AND data->>'id'=l.id::text)
      ORDER BY created_on DESC,id DESC LIMIT 1) j ON true
    WHERE ($1::text IS NULL OR l.kind=$1) AND ($2::uuid IS NULL OR l.world_id=$2) AND ($3::uuid IS NULL OR l.user_id=$3)
      AND ($4::uuid IS NULL OR l.id<$4) AND ($5::uuid IS NULL OR l.id=$5)
    ORDER BY l.id DESC LIMIT 51`,
      [
        entry?.kind ?? q.kind ?? null,
        q.worldId ?? null,
        q.userId ?? null,
        q.before ?? null,
        entry?.id ?? null,
      ],
    )
  ).rows;
  if (entry && !rows.length)
    throw new AccessError(404, "JOB_NOT_FOUND", "処理が見つかりません");
  const selected = rows.slice(0, 50).map((r) => {
    return {
      ...r,
      responseId:
        r.kind === "scene"
          ? ["preparing", "ready"].includes(r.phase)
            ? r.id
            : ["acting", "active"].includes(r.phase)
              ? (r.action_id ?? r.id)
              : sceneId(`${r.id}:reflection`)
          : r.response_id,
    };
  });
  const usageRows = (
    await db.query(
      `SELECT e.id,e.llm_used,e.llm_limit,coalesce(sum(c.charged_nano),0)::text AS calculated,
    coalesce(sum(c.reserved_nano) FILTER(WHERE c.state<>'complete'),0)::text AS unsettled FROM execution_budget e
    LEFT JOIN llm_call c ON c.response_id=e.id WHERE e.id=ANY($1::uuid[]) GROUP BY e.id`,
      [selected.map((r) => r.responseId)],
    )
  ).rows;
  const usageMap = new Map(usageRows.map((r) => [r.id, r]));
  const items = selected.map((r) => {
    const { responseId } = r,
      usage = usageMap.get(responseId);
    return {
      kind: r.kind,
      id: r.id,
      worldId: r.world_id,
      graphWorldId: r.graph_world_id,
      userId: r.user_id,
      actorId: r.actor_id,
      state: r.state,
      at: Number(r.at),
      error: r.error,
      errorCode: r.error_code,
      runId: r.run_id ?? r.id,
      operationId: r.operation_id,
      commitId: r.committed_id,
      responseId,
      executionState: r.execution_state ?? null,
      deliveries: r.deliveries ?? 0,
      job:
        r.job_id || r.job_state
          ? {
              id: r.job_id,
              queue: r.queue ?? null,
              state: r.job_state ?? null,
              retries: r.retry_count ?? null,
            }
          : null,
      startedAt: r.started_at?.toISOString() ?? null,
      finishedAt: r.finished_at?.toISOString() ?? null,
      calls: usage ? { used: usage.llm_used, limit: usage.llm_limit } : null,
      calculatedNanoUsd: usage?.calculated ?? "0",
      unsettledNanoUsd: usage?.unsettled ?? "0",
    };
  });
  return { items, next: rows.length > 50 ? rows[49].id : null };
}
export async function resumeJob(
  db: pg.PoolClient,
  players: WorldPlayers,
  kind: z.infer<typeof JobKind>,
  id: string,
  requestId: string,
) {
  await RuntimeControl.check(db, {}, true);
  const found = (await readJobs(db, {}, { kind, id })).items[0]!;
  const live = (
    await db.query(
      "SELECT id FROM runtime_execution r WHERE r.kind=$1 AND r.id=$2 AND r.state IN ('running','waiting') AND EXISTS(SELECT 1 FROM pgboss.job j WHERE j.id=r.job_id AND j.state='active')",
      [kind, id],
    )
  ).rowCount;
  if (live)
    throw new AccessError(
      409,
      "JOB_RUNNING",
      "処理中のジョブが終わるか中断されるまで待ってください",
    );
  if (
    !["paused", "play_paused"].includes(found.state) &&
    found.executionState !== "interrupted"
  )
    throw new AccessError(
      409,
      "STATE_CONFLICT",
      "保留または中断した処理を指定してください",
    );
  const authority =
    found.kind === "construction"
      ? {
          role:
            found.state === "playing" || found.state === "play_paused"
              ? ("user" as const)
              : ("admin" as const),
        }
      : {
          role: "user" as const,
          ...(found.kind === "scene" ? { actorId: found.actorId! } : {}),
        };
  await RuntimeControl.check(
    db,
    {
      ...authority,
      userId: found.userId ?? undefined,
      worldId: found.graphWorldId,
    },
    true,
  );
  if (kind === "join") {
    await db.query(
      "UPDATE world_join SET state='paused',claim=NULL WHERE id=$1",
      [id],
    );
    return {
      ...(await players.resume(found.userId!, id, db)),
      kind,
      worldId: found.worldId,
    };
  }
  const construction = players.construction;
  if (kind === "construction") {
    await db.query(
      "UPDATE world_construction SET state=CASE WHEN state='playing' THEN 'play_paused' ELSE 'paused' END,claim=NULL,suspended=true WHERE id=$1 AND state NOT IN ('paused','play_paused')",
      [id],
    );
    await construction.command(id, "resume", undefined, db);
  } else {
    await db.query(
      "UPDATE world_scene SET data=CASE WHEN state='paused' THEN data ELSE jsonb_set(jsonb_set(data,'{resumeState}',to_jsonb(state)),'{suspended}','true') END,state='paused',claim=NULL WHERE id=$1",
      [id],
    );
    const { WorldScenes } = await import("./scene.js");
    await new WorldScenes(construction).command(
      found.worldId,
      "resume",
      db,
      { requestId },
      found.actorId!,
    );
  }
  return { kind, id, worldId: found.worldId, state: "queued" };
}
