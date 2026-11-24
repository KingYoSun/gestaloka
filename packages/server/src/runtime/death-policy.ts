import type { Change } from "@gestaloka/contracts";
import type pg from "pg";
import { derivedId } from "../world/model.js";
import type { WorldContext } from "../world/store.js";

export const permanentDeath = "permanent-death";
const deathEdgeId = (actor: string) => derivedId(`${permanentDeath}:${actor}`);

export async function respawnPolicy(
  db: Pick<pg.Pool, "query">,
  worldId: string,
  actorIds: readonly string[] = [],
) {
  const { respawn_enabled, death_place_id, disabled_actor_ids } = (
    await db.query<{
      respawn_enabled: boolean;
      death_place_id: string | null;
      disabled_actor_ids: string[];
    }>(
      `SELECT c.respawn_enabled,c.death_place_id,ARRAY(
        SELECT actor_id FROM world_join
        WHERE construction_id=c.id AND respawn_disabled AND actor_id=ANY($2::uuid[])
        UNION
        SELECT actor_id FROM world_controlled_actor
        WHERE world_id=c.world_id AND respawn_disabled AND actor_id=ANY($2::uuid[])
      ) AS disabled_actor_ids FROM world_construction c WHERE c.id=$1`,
      [worldId, actorIds],
    )
  ).rows[0]!;
  return respawn_enabled
    ? {
        placeId: death_place_id,
        ...(actorIds.length && { disabledActorIds: disabled_actor_ids }),
      }
    : null;
}

export async function isPermanentlyDead(context: WorldContext, actor: string) {
  const edge = await context.edge(deathEdgeId(actor));
  return (
    edge?.kind === "status" &&
    edge.role === "content" &&
    edge.source === actor &&
    edge.text === permanentDeath &&
    edge.period.until === undefined
  );
}

export function recordPermanentDeath(
  change: Change,
  actor: string,
  at: number,
) {
  const script = derivedId(`${permanentDeath}:${actor}:script`);
  change.nodes.push({ id: script, kind: "script", text: "死亡している。" });
  change.edges.push({
    id: deathEdgeId(actor),
    kind: "status",
    role: "content",
    source: actor,
    target: script,
    text: permanentDeath,
    period: { from: at },
  });
}
