import type { WorldContext } from "./store.js";
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
