import type { Change } from "@gestaloka/contracts";
import type pg from "pg";
import { derivedId } from "../world/model.js";
import type { WorldContext } from "../world/store.js";

export const permanentDeath = "permanent-death";
const deathEdgeId = (actor: string) => derivedId(`${permanentDeath}:${actor}`);

export async function respawnPolicy(
  db: Pick<pg.Pool, "query">,
  worldId: string,
) {
  const { respawn_enabled, death_place_id } = (
    await db.query<{ respawn_enabled: boolean; death_place_id: string | null }>(
      "SELECT respawn_enabled,death_place_id FROM world_construction WHERE id=$1",
      [worldId],
    )
  ).rows[0]!;
  return respawn_enabled ? { placeId: death_place_id } : null;
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
