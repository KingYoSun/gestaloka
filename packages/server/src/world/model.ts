import { Change, WorldNode, WorldEdge } from "@gestaloka/contracts";
export {
  Change,
  WorldNode,
  WorldEdge,
  RelationKind,
} from "@gestaloka/contracts";

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
    switch (edge.kind) {
      case "has":
        return source.kind === "existence" && target.kind !== "event";
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
