import { createHash } from "node:crypto";
import {
  Change,
  WorldNode,
  WorldEdge,
  BelongingRole,
} from "@gestaloka/contracts";
export {
  Change,
  WorldNode,
  WorldEdge,
  RelationKind,
  BelongingRole,
} from "@gestaloka/contracts";

// 同じ入力から同じ同一性を導出する。再送や再構築で重複を作らないために使う。
export const derivedId = (value: string) => {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export const isPlaceSeriesMembership = (edge: WorldEdge) =>
  edge.kind === "status" &&
  edge.role === "content" &&
  edge.text === "place-series";

export const respawnHome = "respawn-home";
export const isRespawnHome = (edge: WorldEdge) =>
  edge.kind === "status" &&
  edge.role === "content" &&
  edge.text === respawnHome;

// 世界内時間は世界生成の間だけ使う。生成を終えた世界の時点は現実の時刻(エポックミリ秒)とする。
const generating = new Set(["generating", "ready", "running", "paused"]);
export const inGeneration = (state: string) => generating.has(state);
export const worldNow = (
  world: { state: string; at: number | string },
  now = Date.now(),
) =>
  inGeneration(world.state)
    ? Number(world.at)
    : Math.max(Number(world.at), now);

// プレイ中の差分は確定の時点で成立させる。申請時やクライアントが付けた時点はここでそろえる。
export const atTime = (
  changes: Change,
  at: number,
  keepLength = false,
): Change => ({
  ...changes,
  nodes: changes.nodes.map((n) =>
    n.kind === "event" ? { ...n, period: { ...n.period, from: at } } : n,
  ),
  // keepLengthでは、終了時点のある関係を、続く長さを保って確定の時点へ移す。
  edges: changes.edges.map((e) => ({
    ...e,
    period: {
      ...e.period,
      from: at,
      ...(keepLength && e.period.until !== undefined
        ? { until: e.period.until - e.period.from + at }
        : {}),
    },
  })),
});

// 持つ物品と役割つきhasの現在の集合から導出する要約。正本は関係で、要約は確定時に作り直す。
// 持つ物品の要約は、既存の要約の同一性を保つためholdの名で導出する。
export type SummaryKind = "hold" | BelongingRole;
export const summaryId = (subject: string, kind: SummaryKind) =>
  derivedId(`summary:${subject}:${kind}`);
const summaryTitle = {
  hold: "保持している物品",
  use: "利用できる保管先",
  skill: "技能",
};
export const summaryText = (role: SummaryKind, targets: readonly WorldNode[]) =>
  [
    summaryTitle[role],
    ...(targets.length
      ? targets.map(
          (target) =>
            `- ${target.text}${target.kind === "existence" && target.count ? ` ×${target.count}` : ""}〔${target.id}〕`,
        )
      : ["(なし)"]),
  ].join("\n");

export function normalizeChange(change: Change, at: number): Change {
  return {
    ...change,
    edges: change.edges.map((edge) => {
      if (edge.kind !== "see") return edge;
      const through =
        edge.observation?.through ?? Math.min(edge.period.until ?? at, at);
      if (through < edge.period.from || through > at)
        throw new Error("観測・受容した範囲が確定時点と整合しません");
      return {
        ...edge,
        observation: {
          aspect: edge.observation?.aspect ?? edge.text ?? "",
          through,
          sourceIds: [
            ...new Set([edge.target, ...(edge.observation?.sourceIds ?? [])]),
          ].sort(),
          pathIds: [...new Set(edge.observation?.pathIds ?? [])].sort(),
        },
      };
    }),
  };
}

export function requestedChange(change: Change, at: number): Change {
  return {
    ...change,
    edges: change.edges.map((edge) => {
      const { observation, ...base } = edge;
      if (!observation) return edge;
      if (
        observation.aspect === (edge.text ?? "") &&
        observation.through === Math.min(edge.period.until ?? at, at) &&
        observation.sourceIds.length === 1 &&
        observation.sourceIds[0] === edge.target &&
        observation.pathIds.length === 0
      )
        return base;
      const { versions: _versions, ...scope } = observation;
      void _versions;
      return { ...base, observation: scope };
    }),
  };
}

export function validateConnection(
  edge: WorldEdge,
  source: WorldNode,
  target: WorldNode,
) {
  const valid = (() => {
    if (edge.kind === "required")
      return (
        (source.kind === "script" && target.kind === "condition") ||
        (source.kind === "condition" && target.kind !== "condition")
      );
    if (source.kind === "condition" || target.kind === "condition")
      return false;
    switch (edge.kind) {
      case "has":
        return (
          source.kind === "existence" &&
          (edge.role === undefined
            ? target.kind !== "event"
            : target.kind === (edge.role === "use" ? "existence" : "script"))
        );
      case "effect":
        return source.kind !== "script" && target.kind === "existence";
      case "happen":
        return source.kind === "existence" && target.kind === "event";
      case "see":
        return source.kind === "existence";
      case "interpret":
      case "status":
        return edge.role === "content"
          ? source.kind === "existence" && target.kind === "script"
          : source.kind === "script";
    }
  })();
  if (!valid)
    throw new Error(`接続形式が不正です: ${edge.kind}/${edge.role ?? ""}`);
}

export function bindingScripts(edges: readonly WorldEdge[]) {
  return [
    ...new Map(
      edges
        .filter((edge) => edge.kind === "interpret" || edge.kind === "status")
        .map((edge) => [
          `${edge.kind}:${edge.role === "content" ? edge.target : edge.source}`,
          {
            kind: edge.kind as "interpret" | "status",
            id: edge.role === "content" ? edge.target : edge.source,
          },
        ]),
    ).values(),
  ];
}

export function validateBindings(
  kind: "interpret" | "status",
  id: string,
  edges: readonly WorldEdge[],
) {
  const contents = edges.filter(
    (edge) =>
      edge.kind === kind && edge.role === "content" && edge.target === id,
  );
  const abouts = edges.filter(
    (edge) => edge.kind === kind && edge.role === "about" && edge.source === id,
  );
  if (abouts.length && !contents.length)
    throw new Error(
      `${kind}/aboutの記述に主体からのcontent接続がありません: ${id}`,
    );
  if (kind !== "interpret") return;
  if (contents.length && !abouts.length)
    throw new Error(`interpretには主体・内容・対象の接続が必要です: ${id}`);
  const intervals = abouts
    .map((edge) => edge.period)
    .sort((a, b) => a.from - b.from);
  for (const content of contents) {
    let cursor = content.period.from;
    for (const interval of intervals) {
      if (interval.from > cursor) break;
      cursor = Math.max(cursor, interval.until ?? Infinity);
    }
    if (cursor < (content.period.until ?? Infinity))
      throw new Error(`解釈が成立する期間にabout接続の欠落があります: ${id}`);
  }
}
