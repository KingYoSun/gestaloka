import type { Change, WorldEdge, WorldNode } from "@gestaloka/contracts";
import { WorldConflict, type WorldContext } from "../world/store.js";

const latest = Number.MAX_SAFE_INTEGER;

export function editableStatus(edge: WorldEdge, node?: WorldNode) {
  return (
    edge.kind === "status" &&
    edge.role === "content" &&
    edge.text !== "location" &&
    edge.text !== "operator" &&
    node?.kind === "script" &&
    node.type !== "draw-source" &&
    !node.spawn
  );
}

export type StatusReview = {
  subjects: string[];
  scripts: string[];
  requestedEnds: string[];
  relatedEnds: string[];
  onlyStateCreation: boolean;
};
// 出来事、その作用・観測、人物に残る状態は対抗行動の結果としてまとめて確定する。
export function isOppositionResult(changes: Change, review?: StatusReview) {
  return (
    changes.nodes.every(
      (n) => n.kind === "event" || review?.scripts.includes(n.id),
    ) &&
    changes.edges.every(
      (e) =>
        e.kind === "effect" ||
        e.kind === "happen" ||
        e.kind === "see" ||
        (e.kind === "status" &&
          review?.scripts.includes(e.role === "content" ? e.target : e.source)),
    )
  );
}

// 所在などの専用操作とは別に、プレイヤーが直接変更する人物の状態を特定する。
export async function directStatusReview(
  context: WorldContext,
  people: ReadonlySet<string>,
  changes: Change,
  ended: WorldEdge[],
): Promise<StatusReview | undefined> {
  const status = [...changes.edges, ...ended].filter(
    (e) => e.kind === "status",
  );
  const scriptOf = (e: WorldEdge) =>
    e.role === "content" ? e.target : e.source;
  const ids = new Set([
    ...changes.revisions.filter((n) => n.kind === "script").map((n) => n.id),
    ...status.map(scriptOf),
  ]);
  const subjects = new Set<string>(),
    scripts = new Set<string>();
  for (const id of ids) {
    const added = changes.nodes.find((n) => n.id === id);
    const node = added ?? (await context.node(id));
    const bindings = [
      ...status.filter((e) => e.target === id),
      ...(added ? [] : await context.relations(id, "status", "in", latest)),
    ];
    for (const e of bindings) {
      if (!people.has(e.source) || !editableStatus(e, node)) continue;
      subjects.add(e.source);
      scripts.add(id);
    }
  }
  if (!subjects.size) return;
  const ends = ended.filter(
    (e) =>
      e.kind === "status" &&
      e.role === "content" &&
      subjects.has(e.source) &&
      scripts.has(e.target),
  );
  const endingScripts = new Set(ends.map((e) => e.target));
  if (ends.some((e) => e.period.until !== undefined))
    throw new WorldConflict("終了対象の状態はすでに終了しています");
  return {
    subjects: [...subjects],
    scripts: [...scripts],
    requestedEnds: ends.map((e) => e.id),
    relatedEnds: ended
      .filter(
        (e) =>
          e.kind === "status" &&
          e.role === "about" &&
          endingScripts.has(e.source),
      )
      .map((e) => e.id),
    onlyStateCreation:
      changes.nodes.every((n) => scripts.has(n.id)) &&
      changes.edges.every(
        (e) =>
          e.kind === "status" &&
          scripts.has(scriptOf(e)) &&
          (e.role !== "content" || subjects.has(e.source)),
      ),
  };
}

// 終了申請で指定された人物状態は候補。GMが本文を照合して選んだ関係だけを終える。
// 最後のcontentが終わるときは、同じ記述のaboutも同時に閉じる。
export async function settleStateEnds(
  context: WorldContext,
  changes: Change,
  selected: readonly string[] | undefined,
  subjects: readonly string[],
  review?: StatusReview,
): Promise<Change> {
  const proposed = new Set([
    ...(review?.requestedEnds ?? []),
    ...(review?.relatedEnds ?? []),
  ]);
  // 旧版で抽選まで済んだ申請にはGMの終了リストがない。その場合だけ、当時の申請を使う。
  const stateEnds = selected ?? review?.requestedEnds ?? [];
  const ends = new Set([
    ...changes.endEdges.filter((id) => !proposed.has(id)),
    ...stateEnds,
  ]);
  for (const id of stateEnds) {
    const edge = await context.edge(id);
    if (
      !edge ||
      edge.period.until !== undefined ||
      !subjects.includes(edge.source) ||
      !editableStatus(edge, await context.node(edge.target))
    )
      throw new WorldConflict("終了対象の状態が判定後に変わりました");
    const bindings = [
      ...(await context.relations(edge.target, "status", "in", latest)),
      ...changes.edges,
    ];
    if (
      bindings.some(
        (e) =>
          e.kind === "status" &&
          e.role === "content" &&
          e.target === edge.target &&
          !ends.has(e.id),
      )
    )
      continue;
    for (const ref of await context.relations(
      edge.target,
      "status",
      "out",
      latest,
    ))
      if (ref.role === "about") ends.add(ref.id);
  }
  return { ...changes, endEdges: [...ends] };
}
