import type pg from "pg";
import { z } from "zod";
import {
  InspectionSchedule,
  InspectionHistoryQuery,
} from "@gestaloka/contracts";
import { AccessError } from "../http/access.js";
import { unitWeights, type Measurement } from "./measure.js";
import { digest, InspectionStore } from "./store.js";

type Database = Pick<pg.Pool, "query">;
export async function inspectionSettings(db: Database, worldId: string) {
  const row = (
    await db.query(
      "SELECT version,configuration FROM inspection_schedule WHERE world_id=$1",
      [worldId],
    )
  ).rows[0];
  return (
    row ?? {
      version: 0,
      configuration: {
        enabled: false,
        intervalMinutes: 60,
        periodHours: 24,
        n: 3,
        lowThreshold: 0,
        weights: unitWeights,
        evaluation: null,
        sampleCount: 0,
      },
    }
  );
}
export async function configureInspection(
  db: Database,
  worldId: string,
  configuration: z.infer<typeof InspectionSchedule>,
  expectedVersion: number,
) {
  await InspectionStore.weights(db, configuration.weights);
  const result =
    expectedVersion === 0
      ? await db.query(
          "INSERT INTO inspection_schedule(world_id,version,configuration) VALUES($1,1,$2) ON CONFLICT DO NOTHING RETURNING version,configuration",
          [worldId, configuration],
        )
      : await db.query(
          "UPDATE inspection_schedule SET version=version+1,configuration=$2,updated_at=now() WHERE world_id=$1 AND version=$3 RETURNING version,configuration",
          [worldId, configuration, expectedVersion],
        );
  if (!result.rowCount)
    throw new AccessError(
      409,
      "SETTINGS_CHANGED",
      "現在の検品設定を読み直してください",
    );
  return result.rows[0];
}
export async function inspectionHistory(
  db: Database,
  input: z.infer<typeof InspectionHistoryQuery>,
) {
  const q = InspectionHistoryQuery.parse(input),
    values: unknown[] = [q.worldId, q.from, q.to],
    conditions = [
      "m.world_id=$1",
      "m.captured_at>=$2::timestamptz",
      "m.captured_at<$3::timestamptz",
    ];
  for (const [field, expression] of [
    ["userId", "m.user_id"],
    ["actorId", "m.actor_id"],
    ["n", "m.data#>>'{selection,n}'"],
    ["metricVersion", "m.data#>>'{selection,metricVersion}'"],
    ["weightVersion", "m.data#>>'{selection,weights,version}'"],
  ] as const) {
    if (q[field] === undefined) continue;
    if (q[field] === null) conditions.push(`${expression} IS NULL`);
    else {
      values.push(q[field]);
      conditions.push(`${expression}::text=$${values.length}::text`);
    }
  }
  if (q.model !== undefined || q.configurationVersion !== undefined) {
    values.push(q.model ?? null, q.configurationVersion ?? null);
    conditions.push(
      `EXISTS(SELECT 1 FROM jsonb_array_elements(m.data->'scenes') s CROSS JOIN LATERAL jsonb_array_elements(s->'calls') c WHERE ($${values.length - 1}::text IS NULL OR c->>'model'=$${values.length - 1}) AND ($${values.length}::int IS NULL OR (c->>'configurationVersion')::int=$${values.length}))`,
    );
  }
  const rows = (
    await db.query(
      `SELECT m.id,m.captured_at AS at,m.data->'selection' AS selection,m.measurement-'diffs'-'scenes' AS measurement,
    (SELECT jsonb_agg(jsonb_build_object('id',s->'id','inputs',(SELECT jsonb_agg(a->'id') FROM jsonb_array_elements(s->'inputs') a),'calls',s->'calls')) FROM jsonb_array_elements(m.data->'scenes') s) AS sources,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'status',e.status,'configuration',e.configuration,'result',e.result) ORDER BY e.created_at,e.id),'[]') FROM inspection_evaluation e WHERE e.manifest_id=m.id) AS evaluations
    FROM inspection_manifest m WHERE ${conditions.join(" AND ")} ORDER BY m.captured_at,m.id`,
      values,
    )
  ).rows as HistoryRow[];
  const summary = summarizeHistory(rows);
  const page = rows.slice(q.after ?? 0, (q.after ?? 0) + 50).map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    selection: r.selection,
    measurement: r.measurement,
    evaluations: r.evaluations,
  }));
  const batches = (
    await db.query(
      'SELECT id,at,configuration_version AS "configurationVersion",status,result FROM inspection_batch WHERE world_id=$1 AND at>=$2 AND at<$3 ORDER BY at DESC,id LIMIT 50',
      [q.worldId, q.from, q.to],
    )
  ).rows.map((r) => ({ ...r, at: r.at.toISOString() }));
  return {
    kind: "inspection-history",
    summary,
    items: page,
    batches,
    next:
      (q.after ?? 0) + page.length < rows.length
        ? (q.after ?? 0) + page.length
        : null,
    units: {
      distribution: "同条件のnシーン窓",
      totals:
        "期間内に採取した窓に含まれる重複しないシーン・入力・call。窓前のシーンを含む。",
    },
  };
}
type HistoryRow = {
  id: string;
  at: Date;
  selection: Record<string, unknown>;
  measurement: Omit<Measurement, "metricVersion"> & { metricVersion: string };
  sources: {
    id: string;
    inputs: string[] | null;
    calls: {
      id: string;
      model: string | null;
      configurationVersion: number | null;
      nanoUsd: string | null;
    }[];
  }[];
  evaluations: unknown[];
};
export function summarizeHistory(rows: HistoryRow[]) {
  const groups = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const versions = [
      ...new Set(
        row.sources.flatMap((s) =>
          s.calls.map((c) => JSON.stringify([c.model, c.configurationVersion])),
        ),
      ),
    ].sort();
    const key = digest({
      metricVersion: row.selection.metricVersion,
      weights: row.selection.weights,
      n: row.selection.n,
      versions,
    });
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([seriesId, group]) => {
    const values = group
      .flatMap((r) =>
        r.measurement.total.value === null ? [] : [r.measurement.total.value],
      )
      .sort((a, b) => a - b);
    const scenes = new Set<string>(),
      inputs = new Set<string>(),
      calls = new Map<string, string | null>();
    for (const r of group)
      for (const s of r.sources) {
        scenes.add(s.id);
        for (const a of s.inputs ?? []) inputs.add(a);
        for (const c of s.calls) calls.set(c.id, c.nanoUsd);
      }
    const quantile = (p: number) =>
      values.length ? values[Math.floor((values.length - 1) * p)]! : null;
    return {
      seriesId,
      manifestIds: group.map((r) => r.id),
      metricVersion: group[0]!.selection.metricVersion,
      weights: group[0]!.selection.weights,
      n: group[0]!.selection.n,
      generation: [
        ...new Set(
          group.flatMap((r) =>
            r.sources.flatMap((s) =>
              s.calls.map((c) =>
                JSON.stringify([c.model, c.configurationVersion]),
              ),
            ),
          ),
        ),
      ]
        .sort()
        .map((value) => {
          const [model, configurationVersion] = JSON.parse(value);
          return { model, configurationVersion };
        }),
      windows: group.length,
      measuredWindows: values.length,
      missingWindows: group.length - values.length,
      mean: values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
      median: quantile(0.5),
      p10: quantile(0.1),
      distribution: values,
      uniqueScenes: scenes.size,
      uniqueInputs: inputs.size,
      uniqueCalls: calls.size,
      calculatedNanoUsd:
        calls.size > 0 && [...calls.values()].every((v) => v !== null)
          ? [...calls.values()].reduce((n, v) => n + BigInt(v!), 0n).toString()
          : null,
      longestLowRun: Math.max(
        0,
        ...group.map((r) => r.measurement.longestLowRun),
      ),
      coverage: group.map((r) => ({
        manifestId: r.id,
        ...r.measurement.total.coverage,
      })),
      semanticSeries: group.flatMap((r) =>
        r.evaluations.map((e) => ({ manifestId: r.id, evaluation: e })),
      ),
    };
  });
}
