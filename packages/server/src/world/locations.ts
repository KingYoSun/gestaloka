import type { WorldContext } from "./store.js";
import { derivedId, type Change } from "./model.js";
type Context = Pick<WorldContext, "locations" | "node" | "relations">;

export { LocationOp } from "@gestaloka/contracts";

/** 有効な経路で、content と about の両側に同じ端点が揃うもの。 */
export function routeEndpoints(edges: Change["edges"]) {
  const routes = new Map<
    string,
    { sources: Set<string>; targets: Set<string> }
  >();
  for (const edge of edges) {
    if (
      edge.kind !== "status" ||
      edge.period.until !== undefined ||
      edge.role !== "content" ||
      edge.text !== "route"
    )
      continue;
    if (!routes.has(edge.target))
      routes.set(edge.target, { sources: new Set(), targets: new Set() });
    routes.get(edge.target)!.sources.add(edge.source);
  }
  for (const edge of edges)
    if (
      edge.kind === "status" &&
      edge.role === "about" &&
      edge.period.until === undefined
    )
      routes.get(edge.source)?.targets.add(edge.target);
  const ids = new Set<string>();
  for (const { sources, targets } of routes.values())
    if (
      sources.size >= 2 &&
      sources.size === targets.size &&
      [...sources].every((id) => targets.has(id))
    )
      for (const id of sources) ids.add(id);
  return ids;
}

export function generatedFixedPlaces(
  changes: Change,
  declared: readonly string[],
  actor?: string | null,
) {
  const places = routeEndpoints(changes.edges);
  for (const id of declared) places.add(id);
  for (const edge of changes.edges)
    if (edge.kind === "has" && !edge.role) places.delete(edge.target);
  return changes.nodes
    .filter((n) => n.kind === "existence" && n.id !== actor && places.has(n.id))
    .map((n) => n.id);
}

const LATEST = Number.MAX_SAFE_INTEGER;

// 最新の始点を持つ所在記録のうち、終わっていないもの。
export async function locationRecords(context: Context, actor: string) {
  const { latest, active } = await context.locations(actor);
  return Promise.all(
    active
      .filter((e) => e.period.from === latest)
      .map(async (e) => {
        const about = (
          await context.relations(e.target, "status", "out", LATEST)
        ).filter((a) => a.role === "about");
        const direct = about.filter((a) => a.text === "direct-place");
        return {
          id: e.id,
          at: e.period.from,
          text: (await context.node(e.target, LATEST))!.text,
          aboutIds: about.map((a) => a.target).sort(),
          directPlaceId: direct.length === 1 ? direct[0]!.target : null,
        };
      }),
  );
}
export async function directPlaces(context: Context, actor: string) {
  const records = await locationRecords(context, actor);
  const ids = new Set(records.map((r) => r.directPlaceId));
  const [id] = ids;
  return ids.size === 1 && id ? [id] : [];
}

export function addRoute(
  changes: Change,
  requestId: string,
  at: number,
  source: { id: string; text: string },
  place: { id: string; text: string },
  text: string,
) {
  const route = derivedId(`${requestId}:route`);
  changes.nodes.push(
    { id: place.id, kind: "existence", text: place.text },
    { id: route, kind: "script", text },
  );
  for (const endpoint of [source, place])
    changes.edges.push(
      {
        id: derivedId(`${route}:content:${endpoint.id}`),
        kind: "status",
        role: "content",
        text: "route",
        source: endpoint.id,
        target: route,
        period: { from: at },
      },
      {
        id: derivedId(`${route}:about:${endpoint.id}`),
        kind: "status",
        role: "about",
        text: endpoint.text,
        source: route,
        target: endpoint.id,
        period: { from: at },
      },
    );
}
