import type pg from "pg";
import type { PgBoss } from "pg-boss";
import { InspectionSchedule } from "@gestaloka/contracts";
import { InspectionStore, digest } from "./store.js";
import { runEvaluation } from "./evaluate.js";
import { sceneId } from "../runtime/scene-data.js";

export class InspectionWorker {
  constructor(
    readonly pool: pg.Pool,
    readonly queue: PgBoss,
    readonly master: string,
    readonly transport: typeof fetch = fetch,
  ) {}
  async work() {
    await InspectionStore.setup(this.pool);
    await this.queue.createQueue("narrative-inspection", {
      retryLimit: 0,
      expireInSeconds: 900,
      heartbeatSeconds: 30,
    });
    await this.queue.schedule("narrative-inspection", "* * * * *", {});
    await this.queue.work("narrative-inspection", async () => {
      await this.tick();
    });
  }
  async tick(now = new Date()) {
    const schedules = (
      await this.pool.query(
        "SELECT world_id,version,configuration FROM inspection_schedule WHERE configuration->>'enabled'='true' ORDER BY world_id",
      )
    ).rows;
    for (const row of schedules) {
      const config = InspectionSchedule.parse(row.configuration);
      let after: { created_at: Date; id: string } | undefined;
      for (;;) {
        const endpoints = (
          await this.pool.query(
            `SELECT s.id,s.actor_id,s.user_id,s.created_at,s.inspection_revision FROM world_scene s
          LEFT JOIN inspection_checkpoint p ON p.world_id=s.construction_id AND p.scene_id=s.id AND p.configuration_version=$2
          WHERE s.construction_id=$1 AND s.created_at>=$3 AND s.created_at<=$4 AND (p.revision IS NULL OR p.revision<>s.inspection_revision)
          AND ($5::timestamptz IS NULL OR (s.created_at,s.id)>($5,$6::uuid)) ORDER BY s.created_at,s.id LIMIT 50`,
            [
              row.world_id,
              row.version,
              new Date(now.getTime() - config.periodHours * 3600000),
              now,
              after?.created_at ?? null,
              after?.id ?? null,
            ],
          )
        ).rows;
        for (const end of endpoints) {
          await InspectionStore.select(this.pool, {
            worldId: row.world_id,
            userId: end.user_id,
            actorId: end.actor_id,
            endSceneId: end.id,
            n: config.n,
            weights: config.weights,
            lowThreshold: config.lowThreshold,
          });
          await this.pool.query(
            "INSERT INTO inspection_checkpoint(world_id,scene_id,configuration_version,revision) VALUES($1,$2,$3,$4) ON CONFLICT(world_id,scene_id,configuration_version) DO UPDATE SET revision=excluded.revision",
            [row.world_id, end.id, row.version, end.inspection_revision],
          );
        }
        if (endpoints.length < 50) break;
        after = endpoints.at(-1);
      }
      const at = new Date(
          Math.floor(now.getTime() / (config.intervalMinutes * 60000)) *
            config.intervalMinutes *
            60000,
        ),
        batchId = sceneId(
          `inspection:${row.world_id}:${row.version}:${at.toISOString()}`,
        );
      // Latest version of each endpoint; stable hash ordering samples all eligible windows independently of score.
      const candidates = (
        await this.pool.query(
          `SELECT id FROM (SELECT DISTINCT ON (actor_id,user_id,data#>>'{selection,endSceneId}') id,captured_at
        FROM inspection_manifest WHERE world_id=$1 AND captured_at>=$2 AND data#>>'{selection,n}'=$3
        AND data#>'{selection,weights}'=$4::jsonb ORDER BY actor_id,user_id,data#>>'{selection,endSceneId}',captured_at DESC,id DESC) m`,
          [
            row.world_id,
            new Date(now.getTime() - config.periodHours * 3600000),
            String(config.n),
            JSON.stringify(config.weights),
          ],
        )
      ).rows
        .map((r) => String(r.id))
        .sort((a, b) =>
          digest([batchId, a]).localeCompare(digest([batchId, b])),
        );
      const targets = candidates.slice(
        0,
        config.evaluation ? config.sampleCount : 0,
      );
      await this.pool.query(
        "INSERT INTO inspection_batch(id,world_id,configuration_version,configuration,at,targets,result) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
        [
          batchId,
          row.world_id,
          row.version,
          config,
          at,
          JSON.stringify(targets),
          JSON.stringify({
            selectionRule: "batch-id-hash-order-v1",
            eligible: candidates.length,
            selected: targets.length,
            unselected: candidates.length - targets.length,
            targetIds: targets,
          }),
        ],
      );
    }
    const batches = (
      await this.pool.query(
        "SELECT * FROM inspection_batch WHERE status='queued' ORDER BY at,id LIMIT 50",
      )
    ).rows;
    for (const batch of batches) {
      const config = InspectionSchedule.parse(batch.configuration),
        targets = batch.targets as string[];
      if (config.evaluation)
        for (const manifestId of targets) {
          const id = sceneId(`${batch.id}:${manifestId}`);
          await this.pool.query(
            "INSERT INTO inspection_evaluation(id,manifest_id,configuration) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [id, manifestId, config.evaluation],
          );
          await runEvaluation(
            this.pool,
            id,
            this.master,
            this.transport,
            `inspection-batch:${batch.id}`,
          );
        }
      const evaluations = (
        await this.pool.query(
          "SELECT e.id,e.status,e.result FROM inspection_evaluation e WHERE e.id=ANY($1::uuid[]) ORDER BY e.id",
          [targets.map((m) => sceneId(`${batch.id}:${m}`))],
        )
      ).rows;
      const waiting = evaluations.some(
        (e) => e.status === "queued" || e.status === "running",
      );
      await this.pool.query(
        "UPDATE inspection_batch SET status=$2,result=$3 WHERE id=$1",
        [
          batch.id,
          waiting ? "queued" : "complete",
          JSON.stringify({
            ...batch.result,
            evaluated: evaluations.filter((e) => e.status === "complete")
              .length,
            unevaluated:
              batch.result.eligible -
              evaluations.filter((e) => e.status === "complete").length,
            evaluations,
          }),
        ],
      );
    }
    const queued = (
      await this.pool.query(
        "SELECT id FROM inspection_evaluation WHERE status='queued' OR (status='running' AND lease_until<now()) ORDER BY created_at,id LIMIT 50",
      )
    ).rows;
    for (const row of queued)
      await runEvaluation(this.pool, row.id, this.master, this.transport);
  }
}
