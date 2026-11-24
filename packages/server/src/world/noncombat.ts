import type { NonCombatAreas } from "@gestaloka/contracts";
import type { WorldContext } from "./store.js";

export type NonCombatArea = NonCombatAreas[number];

/** 判定する場所から、明示された親だけを上にたどる。 */
export async function isNonCombatPlace(
  context: Pick<WorldContext, "partParents">,
  areas: readonly NonCombatArea[],
  places: readonly string[],
  at: number,
) {
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
