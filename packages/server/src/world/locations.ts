import type { WorldContext } from "./store.js";
import { derivedId, type Change } from "./model.js";
type Context = Pick<WorldContext, "locations" | "node" | "relations">;

export { LocationOp } from "@gestaloka/contracts";

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
