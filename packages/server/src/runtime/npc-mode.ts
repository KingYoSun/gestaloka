import type pg from "pg";
import type { z } from "zod";
import type { NpcReport } from "@gestaloka/contracts";
import type { SceneRow } from "./scene.js";

type Db = Pick<pg.Pool, "query">;
export async function npcActors(db: Db, world: string, actors: string[]) {
  return (
    await db.query<{ actor_id: string }>(
      "SELECT actor_id FROM world_controlled_actor WHERE world_id=$1 AND actor_id=ANY($2::uuid[]) AND npc_active",
      [world, actors],
    )
  ).rows.map((r) => r.actor_id);
}

// Keep offsets into the same durable scene history that the worker commits.
export async function trackNpcScene(db: Db, row: SceneRow) {
  const d = row.data;
  await db.query(
    `INSERT INTO world_npc_scene(session_id,actor_id,scene_id)
     SELECT npc_session,actor_id,$3 FROM world_controlled_actor
     WHERE world_id=$1 AND actor_id=ANY($2::uuid[]) AND npc_active ON CONFLICT DO NOTHING`,
    [d.worldId, d.background?.participants ?? [row.actor_id], row.id],
  );
  if (["active", "ready", "paused", "result"].includes(row.state)) {
    await db.query(
      `UPDATE world_npc_scene n SET event_end=$2,choice_end=$3
      FROM world_controlled_actor a WHERE n.scene_id=$1 AND n.event_end IS NULL
      AND a.world_id=$4 AND a.actor_id=n.actor_id AND (NOT a.npc_active OR a.npc_session<>n.session_id)`,
      [row.id, d.events.length, d.choices.length, d.worldId],
    );
  }
}

export async function npcReport(
  db: Db,
  world: string,
  actor: string,
): Promise<z.infer<typeof NpcReport>> {
  const mode = (
    await db.query<{ npc_active: boolean; npc_session: string | null }>(
      `SELECT a.npc_active,a.npc_session FROM world_controlled_actor a JOIN world_construction c ON c.world_id=a.world_id WHERE c.id=$1 AND a.actor_id=$2`,
      [world, actor],
    )
  ).rows[0];
  const scenes: z.infer<typeof NpcReport>["scenes"] = [];
  if (mode?.npc_session) {
    const rows = await db.query<
      SceneRow & {
        event_start: number;
        choice_start: number;
        event_end: number | null;
        choice_end: number | null;
        include_opening: boolean;
        handled: boolean;
      }
    >(
      `SELECT s.*,n.event_start,n.choice_start,n.event_end,n.choice_end,n.include_opening,n.handled FROM world_npc_scene n JOIN world_scene s ON s.id=n.scene_id
       WHERE n.actor_id=$1 AND n.session_id=$2 AND s.construction_id=$3 ORDER BY s.created_at,s.id`,
      [actor, mode.npc_session, world],
    );
    for (const row of rows.rows) {
      const d = row.data;
      const log: z.infer<typeof NpcReport>["scenes"][number]["log"] = [
        ...(row.include_opening
          ? (d.background?.perceptions ?? [])
              .filter((p) => p.observerId === actor)
              .map((p) => ({ kind: "observation" as const, text: p.text }))
          : []),
        ...d.choices
          .slice(row.choice_start, row.choice_end ?? undefined)
          .filter((i) => i.actorId === actor)
          .map((i) => ({ kind: "intent" as const, text: i.actionText })),
        ...d.events
          .slice(row.event_start, row.event_end ?? undefined)
          .flatMap((e) =>
            e.receipts
              .filter((p) => p.observerId === actor)
              .map((p) => ({ kind: "observation" as const, text: p.text })),
          ),
      ];
      const inScene =
        !mode.npc_active &&
        !row.handled &&
        d.background?.participants.includes(actor) &&
        d.departures?.[actor] === undefined &&
        !["result", "reflecting"].includes(row.state) &&
        !d.waitingFor?.length;
      scenes.push({
        sceneId: row.id,
        log,
        handoff: inScene
          ? ["ready", "active"].includes(row.state) &&
            !d.encounter &&
            !d.soloProposal
            ? "available"
            : "processing"
          : null,
      });
    }
  }
  const highlights = scenes.flatMap((scene, index) => {
    const action = scene.log.findLast((entry) => entry.kind === "intent")?.text;
    const observation = scene.log.findLast(
      (entry) => entry.kind === "observation",
    )?.text;
    return action || observation
      ? [
          `シーン${index + 1}：${[action && "行動「" + action + "」", observation && "見聞「" + observation + "」"].filter(Boolean).join("。")}`,
        ]
      : [];
  });
  return {
    active: !!mode?.npc_active,
    scenes,
    summary: scenes.length
      ? [`${scenes.length}件のシーンに登場しました。`, ...highlights].join("\n")
      : "離席中の活動記録はありません。",
  };
}
