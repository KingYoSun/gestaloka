import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { CostQuery, CostReport } from "@gestaloka/contracts";
import { AccessError } from "../http/access.js";

const totals = `count(*)::int AS calls,
  coalesce(sum(charged_nano) FILTER(WHERE state='complete'),0)::text AS "calculatedNanoUsd",
  coalesce(sum(reserved_nano) FILTER(WHERE state<>'complete' AND delivery<>'unknown'),0)::text AS "reservedNanoUsd",
  coalesce(sum(reserved_nano) FILTER(WHERE state<>'complete' AND delivery='unknown'),0)::text AS "unknownNanoUsd",
  count(*) FILTER(WHERE state<>'complete' AND delivery<>'unknown')::int AS "reservedCalls",
  count(*) FILTER(WHERE state<>'complete' AND delivery='unknown')::int AS "unknownCalls"`;

/** The ledger is the sole source of amounts; reports never recompute old charges. */
export async function readCosts(
  db: Pick<pg.Pool, "query">,
  input: z.infer<typeof CostQuery>,
) {
  const q = CostQuery.parse(input),
    values: unknown[] = [q.from, q.to],
    conditions = [
      "c.created_at >= $1::timestamptz",
      "c.created_at < $2::timestamptz",
    ];
  for (const [key, expression] of [
    ["provider", "c.request->'connection'->>'provider'"],
    ["worldId", "b.run_id"],
    ["userId", "c.user_id"],
    ["task", "c.request->>'role'"],
    ["responseId", "c.response_id"],
    ["operationId", "c.operation_id"],
    ["callId", "c.id"],
  ] as const) {
    if (q[key] === undefined) continue;
    if (q[key] === null) conditions.push(`${expression} IS NULL`);
    else {
      values.push(q[key]);
      conditions.push(`${expression}=$${values.length}`);
    }
  }
  if (q.model !== undefined) {
    values.push(q.model);
    conditions.push(
      `(c.request->'request'->>'model'=$${values.length} OR c.response->>'model'=$${values.length})`,
    );
  }
  const source = `WITH selected AS (SELECT c.*,b.run_id AS construction_id FROM llm_call c
    LEFT JOIN world_build b ON b.world_id=c.world_id WHERE ${conditions.join(" AND ")})`;
  if (q.view === "summary")
    return CostReport.parse({
      currency: "USD",
      basis: "calculated",
      next: null,
      totals: (
        await db.query(`${source} SELECT ${totals} FROM selected`, values)
      ).rows[0],
    });

  const scope = createHash("sha256")
    .update(JSON.stringify({ ...q, after: undefined }))
    .digest("hex");
  let cursor: { at: string; id?: string | undefined } | undefined;
  if (q.after) {
    const parsed = z
      .object({
        scope: z.literal(scope),
        at: z.iso.datetime(),
        id: z.uuid().optional(),
      })
      .safeParse(
        (() => {
          try {
            return JSON.parse(Buffer.from(q.after!, "base64url").toString());
          } catch {
            return null;
          }
        })(),
      );
    if (!parsed.success || (q.view === "calls" && !parsed.data.id))
      throw new AccessError(
        409,
        "CURSOR_INVALID",
        "同じ条件で費用を再取得してください",
      );
    cursor = parsed.data;
  }
  const encode = (at: Date | string, id?: string) =>
    Buffer.from(
      JSON.stringify({
        scope,
        at: typeof at === "string" ? at : at.toISOString(),
        ...(id ? { id } : {}),
      }),
    ).toString("base64url");
  if (q.view === "timeline") {
    values.push(q.interval, cursor?.at ?? null);
    const rows = (
      await db.query(
        `${source}, bucketed AS (SELECT *,date_trunc($${values.length - 1},created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS at FROM selected)
      SELECT at,${totals} FROM bucketed WHERE ($${values.length}::timestamptz IS NULL OR at>$${values.length}) GROUP BY at ORDER BY at LIMIT 51`,
        values,
      )
    ).rows;
    return CostReport.parse({
      currency: "USD",
      basis: "calculated",
      timeline: rows
        .slice(0, 50)
        .map((r) => ({ ...r, at: r.at.toISOString() })),
      next: rows.length > 50 ? encode(rows[49].at) : null,
    });
  }
  values.push(cursor?.at ?? null, cursor?.id ?? null);
  const rows = (
    await db.query(
      `${source} SELECT id,created_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,construction_id,world_id,user_id,response_id,operation_id,
    request->'connection'->>'provider' AS provider,request->'request'->>'model' AS requested_model,
    response->>'model' AS response_model,request->>'role' AS task,request->'configurationVersion' AS configuration_version,
    request->>'pricingDate' AS pricing_date,state,delivery,charged_nano,reserved_nano,elapsed_ms,
    CASE WHEN response IS NULL THEN NULL ELSE jsonb_build_object(
      'input',response->'usage'->'prompt_tokens','cachedInput',response->'usage'->'prompt_cache_hit_tokens',
      'cacheMissInput',response->'usage'->'prompt_cache_miss_tokens','output',response->'usage'->'completion_tokens',
      'cacheWrite5m',response->'usage'->'cache_write_5m_tokens','cacheWrite1h',response->'usage'->'cache_write_1h_tokens',
      'reasoning',response->'usage'->'reasoning_tokens') END AS usage,
    CASE WHEN request->'connection' IS NULL THEN NULL ELSE jsonb_build_object(
      'input',request->'connection'->'inputMiss','cachedInput',request->'connection'->'inputHit','output',request->'connection'->'output',
      'cacheWrite5m',request->'connection'->'cacheWrite5m','cacheWrite1h',request->'connection'->'cacheWrite1h') END AS rates
    FROM selected WHERE ($${values.length - 1}::timestamptz IS NULL OR (created_at,id)>($${values.length - 1},$${values.length}::uuid))
    ORDER BY created_at,id LIMIT 51`,
      values,
    )
  ).rows;
  return CostReport.parse({
    currency: "USD",
    basis: "calculated",
    next: rows.length > 50 ? encode(rows[49].cursor_at, rows[49].id) : null,
    calls: rows.slice(0, 50).map((r) => ({
      id: r.id,
      createdAt: r.created_at.toISOString(),
      worldId: r.construction_id,
      graphWorldId: r.world_id,
      userId: r.user_id,
      responseId: r.response_id,
      operationId: r.operation_id,
      provider: r.provider,
      requestedModel: r.requested_model,
      responseModel: r.response_model,
      task: r.task,
      configurationVersion: r.configuration_version,
      pricingDate: r.pricing_date,
      status:
        r.state === "complete"
          ? "calculated"
          : r.delivery === "unknown"
            ? "unknown"
            : "reserved",
      calculatedNanoUsd: r.charged_nano,
      reservationNanoUsd: r.reserved_nano,
      elapsedMs: r.elapsed_ms,
      usage: r.usage,
      ratesNanoUsdPerToken: r.rates,
    })),
  });
}
