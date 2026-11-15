import type { WorldContext } from "./store.js";

// 所在は明示されたstatusだけから読む。自由記述やabout先の種類では判定しない。
export async function readLocations(
  context: WorldContext,
  actor: string,
  at: number,
) {
  const records = (await context.history(actor, "status", "out", at)).filter(
      (e) => e.role === "content" && e.text === "location",
    ),
    latest = Math.max(...records.map((e) => e.period.from)),
    texts = await Promise.all(
      records
        .filter(
          (e) =>
            e.period.from === latest &&
            (e.period.until === undefined || at < e.period.until),
        )
        .map(async (e) => (await context.node(e.target, at))?.text),
    );
  return [...new Set(texts.filter((t): t is string => t !== undefined))].sort();
}
