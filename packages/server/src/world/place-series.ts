import type { Change } from "@gestaloka/contracts";
import { derivedId, isPlaceSeriesMembership } from "./model.js";
import { WorldConflict, type WorldContext } from "./store.js";

const membershipId = (place: string) =>
  derivedId("place-series:member:" + place);

// 場所から所属関係を直接引き、同じ系統に属するほかの場所は読まない。
export async function readPlaceSeries(
  context: Pick<WorldContext, "edges" | "nodes">,
  places: readonly string[],
  at: number,
) {
  const edges = await context.edges(places.map(membershipId));
  const active = [...edges.values()].filter(
    (edge) =>
      isPlaceSeriesMembership(edge) &&
      edge.id === membershipId(edge.source) &&
      edge.period.from <= at &&
      at < (edge.period.until ?? Infinity),
  );
  const groups = await context.nodes(active.map((edge) => edge.target));
  const names = new Map<string, string>();
  for (const { source, target } of active) {
    const group = groups.get(target);
    if (group?.kind === "script" && group.type === "place-series")
      names.set(source, group.text);
  }
  return names;
}

export async function recordPlaceSeries(
  context: WorldContext,
  changes: Change,
  place: string,
  name: string,
  at: number,
) {
  const id = derivedId(context.worldId + ":place-series:" + name);
  const existing = await context.node(id);
  if (!existing)
    changes.nodes.push({
      id,
      kind: "script",
      type: "place-series",
      text: name,
    });
  else if (
    existing.kind !== "script" ||
    existing.type !== "place-series" ||
    existing.text !== name
  )
    throw new WorldConflict("同じIDの場所の系統を確認できません");
  changes.edges.push({
    id: membershipId(place),
    source: place,
    target: id,
    kind: "status",
    role: "content",
    text: "place-series",
    period: { from: at },
  });
}
