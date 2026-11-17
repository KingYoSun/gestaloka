import type { WorldContext } from "./store.js";
type Context = Pick<WorldContext, "history" | "node" | "relations">;

export { LocationOp } from "@gestaloka/contracts";

export async function locationRecords(
  context: Context,
  actor: string,
  at = Number.MAX_SAFE_INTEGER,
) {
  const records = (await context.history(actor, "status", "out", at)).filter(
      (e) => e.role === "content" && e.text === "location",
    ),
    latest = Math.max(...records.map((e) => e.period.from));
  return Promise.all(
    records
      .filter(
        (e) =>
          e.period.from === latest &&
          (e.period.until === undefined || at < e.period.until),
      )
      .map(async (e) => ({
        id: e.id,
        at: e.period.from,
        text: (await context.node(e.target, at))!.text,
        aboutIds: (await context.relations(e.target, "status", "out", at))
          .filter((a) => a.role === "about")
          .map((a) => a.target)
          .sort(),
      })),
  );
}

// 所在は明示されたstatusだけから読む。自由記述やabout先の種類では判定しない。
export async function readLocations(
  context: Context,
  actor: string,
  at = Number.MAX_SAFE_INTEGER,
) {
  return [
    ...new Set((await locationRecords(context, actor, at)).map((r) => r.text)),
  ].sort();
}
