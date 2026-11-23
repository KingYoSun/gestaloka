import type pg from "pg";
import type { z } from "zod";
import { PlayUsageQuery, PlayUsageReport } from "@gestaloka/contracts";
import type { WorldStore } from "../world/store.js";

type Row = {
  id: string;
  date: string;
  user_id: string | null;
  command: string | null;
  completed: boolean;
  spent: boolean;
  rolls: { roll?: number; repeated?: boolean; success?: boolean }[] | null;
  batch: number | null;
  partial: boolean;
};
type Usage = z.infer<typeof PlayUsageReport>["rows"][number];

/**
 * 申請記録を日本時間の日・利用者・コマンド別に数える。要求IDごとに1行なので再送は重ならない。
 * 受付時刻のない旧記録は、SPの回復時刻か完了時の日次枠から日だけを決め、日の一部だけを含む期間からは欠測として除く。
 */
export async function readPlayUsage(
  db: Pick<pg.Pool, "query">,
  store: Pick<WorldStore, "receipts">,
  input: z.infer<typeof PlayUsageQuery>,
) {
  const q = PlayUsageQuery.parse(input);
  const graph = (
    await db.query<{ world_id: string | null }>(
      "SELECT world_id FROM world_construction WHERE id=$1",
      [q.worldId],
    )
  ).rows[0]?.world_id;
  const rows = (
    await db.query<Row>(
      `WITH r AS (SELECT id,result IS NOT NULL AS completed,sp_user IS NOT NULL AS spent,creation_rolls AS rolls,received_at,
        COALESCE(command,result->'action'->>'command') AS command,COALESCE(user_id,sp_user) AS user_id,
        CASE WHEN jsonb_typeof(result->'outcome'->'proposals')='array' THEN jsonb_array_length(result->'outcome'->'proposals') END AS batch,
        COALESCE(received_at,COALESCE(sp_reset,(result->'dailySp'->>'resetsAt')::timestamptz)-interval '1 day') AS at
        FROM bot_request WHERE world_id=$1 AND (creation_rolls IS NOT NULL OR sp_user IS NOT NULL
        OR COALESCE(command,result->'action'->>'command') IN ('create','create-batch')))
      SELECT id,completed,spent,rolls,command,user_id,batch,to_char(at AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD') AS date,
        received_at IS NULL AND NOT (at>=$2 AND at+interval '1 day'<=$3) AS partial
      FROM r WHERE CASE WHEN received_at IS NULL THEN at<$3 AND at+interval '1 day'>$2 ELSE at>=$2 AND at<$3 END`,
      [q.worldId, q.from, q.to],
    )
  ).rows;
  const counted = rows.filter((r) => !r.partial),
    ids = counted.map((r) => r.id);
  const calls = new Map(
    graph
      ? (
          await db.query<{ id: string; calls: number }>(
            `SELECT operation_id AS id,count(*)::int AS calls FROM llm_call WHERE world_id=$1
            AND created_at>=$2::timestamptz-interval '1 day' AND created_at<$3::timestamptz+interval '1 day'
            AND operation_id=ANY($4::uuid[]) GROUP BY operation_id`,
            [graph, q.from, q.to, ids],
          )
        ).rows.map((r) => [r.id, r.calls])
      : [],
  );
  const receipts = new Map(
    (graph
      ? await store.receipts(
          graph,
          counted.filter((r) => r.completed).map((r) => r.id),
        )
      : []
    ).map((r) => [r.commitId, r.changes]),
  );
  const groups = new Map<string, Usage>();
  for (const r of counted) {
    const key = JSON.stringify([r.date, r.user_id, r.command]);
    let g = groups.get(key);
    if (!g)
      groups.set(
        key,
        (g = {
          date: r.date,
          userId: r.user_id,
          command: r.command,
          requests: 0,
          completed: 0,
          rolledIncomplete: 0,
          notRolled: 0,
          originals: 0,
          originalsUnknown: 0,
          batchSizes: {},
          rolls: { fresh: 0, reused: 0, unrolled: 0, succeeded: 0 },
          results: { succeeded: 0, partial: 0, failed: 0 },
          spentSp: 0,
          gmCalls: 0,
          changes: { receipts: 0, existences: 0, items: 0, skills: 0 },
        }),
      );
    g.requests++;
    if (r.completed) g.completed++;
    else if (r.rolls || r.spent) g.rolledIncomplete++;
    else g.notRolled++;
    // 元案は申請者が出した案の数。技能ごとに分けた出目の数では数えない。
    if (r.command !== "create-batch") g.originals++;
    else if (r.batch === null) g.originalsUnknown++;
    else {
      g.originals += r.batch;
      g.batchSizes[r.batch] = (g.batchSizes[r.batch] ?? 0) + 1;
    }
    for (const roll of r.rolls ?? []) {
      if (roll.roll === undefined) g.rolls.unrolled++;
      else if (roll.repeated) g.rolls.reused++;
      else g.rolls.fresh++;
      if (roll.success) g.rolls.succeeded++;
    }
    if (r.rolls?.length) {
      const won = r.rolls.filter((roll) => roll.success).length;
      g.results[
        won === r.rolls.length ? "succeeded" : won ? "partial" : "failed"
      ]++;
    }
    if (r.spent) g.spentSp++;
    g.gmCalls += calls.get(r.id) ?? 0;
    const changes = receipts.get(r.id);
    if (changes) {
      const held = new Set(
        changes.edges
          .filter((e) => e.kind === "has" && !e.role)
          .map((e) => e.target),
      );
      const existences = changes.nodes.filter((n) => n.kind === "existence");
      g.changes.receipts++;
      g.changes.existences += existences.length;
      g.changes.items += existences.filter((n) => held.has(n.id)).length;
      g.changes.skills += changes.edges.filter(
        (e) => e.role === "skill",
      ).length;
    }
  }
  return PlayUsageReport.parse({
    timeZone: "Asia/Tokyo",
    rows: [...groups.values()].sort((a, b) =>
      JSON.stringify([a.date, a.userId, a.command]).localeCompare(
        JSON.stringify([b.date, b.userId, b.command]),
      ),
    ),
    missing: { timeOfDay: rows.length - counted.length },
  });
}
