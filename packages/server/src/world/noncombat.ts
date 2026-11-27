import type { Construction } from "../runtime/construction.js";
import { readPlaceSeries } from "./place-series.js";
import type { WorldContext } from "./store.js";

export type CombatPolicy = Pick<
  Construction,
  "combat_mode" | "non_combat_areas" | "non_combat_place_series"
>;

/** 判定する場所から、明示された親だけを上にたどる。 */
export async function isNonCombatPlace(
  context: Pick<WorldContext, "partParents" | "edges" | "nodes">,
  {
    combat_mode,
    non_combat_areas: areas,
    non_combat_place_series: series,
  }: CombatPolicy,
  places: readonly string[],
  at: number,
) {
  if (combat_mode === "pve") return false;
  if (series.length) {
    const memberships = await readPlaceSeries(context, places, at);
    for (const name of memberships.values())
      if (series.includes(name)) return true;
  }
  if (!areas.length) return false;
  const protectedPlaces = new Set(
    areas.flatMap(({ rootId, memberPlaceIds }) => [rootId, ...memberPlaceIds]),
  );
  const visited = new Set(places);
  for (const place of visited) {
    if (protectedPlaces.has(place)) return true;
    for (const parent of await context.partParents(place, at))
      visited.add(parent);
  }
  return false;
}
