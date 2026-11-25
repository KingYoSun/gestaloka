import { WorldConflict, type WorldContext } from "../world/store.js";

type RecordValue = Record<string, unknown>;

function entries(value: unknown, visit: (record: RecordValue) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) entries(child, visit);
    return;
  }
  const row = value as RecordValue;
  visit(row);
  for (const child of Object.values(row)) entries(child, visit);
}

export function completeJudgmentPreview(materials: unknown[]) {
  let complete = true;
  entries(materials, (row) => {
    if (row.judgmentTruncated === true) complete = false;
  });
  return complete;
}

export function judgmentLabels(materials: unknown[]) {
  const labels = new Map<string, string>();
  entries(materials, (row) => {
    if (typeof row.id !== "string") return;
    if (typeof row.label === "string") labels.set(row.id, row.label);
    if (row.kind === "existence" && typeof row.text === "string")
      labels.set(row.id, row.text);
  });
  return labels;
}

function restore(
  value: unknown,
  nodes: ReadonlyMap<
    string,
    { text: string; kind: string; name?: string | undefined }
  >,
  edges: ReadonlyMap<string, { text?: string | undefined }>,
): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((child) => restore(child, nodes, edges));
  const { judgmentNodeId, judgmentEdgeId, ...record } = value as RecordValue;
  delete record.judgmentTruncated;
  delete record.judgmentTextLength;
  delete record.judgmentBasisLength;
  delete record.judgmentExcerptPending;
  delete record.judgmentTextPending;
  delete record.judgmentBasisPending;
  delete record.judgmentLocation;
  const node =
    typeof judgmentNodeId === "string" ? nodes.get(judgmentNodeId) : undefined;
  if (node && "kind" in record) return node;
  if (node && "label" in record) record.label = node.text;
  if (node && "text" in record) record.text = node.text;
  if (node && "name" in record && node.name) record.name = node.name;
  if (typeof judgmentEdgeId === "string" && record.basis != null) {
    const edge = edges.get(judgmentEdgeId);
    if (edge) record.basis = edge.text ?? null;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      restore(child, nodes, edges),
    ]),
  );
}

export const stripJudgmentPreview = (materials: unknown[]) =>
  restore(materials, new Map(), new Map()) as unknown[];

export function judgmentLoader(context: WorldContext) {
  const nodes = new Map<
    string,
    NonNullable<Awaited<ReturnType<WorldContext["node"]>>>
  >();
  const edges = new Map<
    string,
    NonNullable<Awaited<ReturnType<WorldContext["edge"]>>>
  >();
  return async (materials: unknown[]) => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    entries(materials, ({ judgmentNodeId, judgmentEdgeId, basis }) => {
      if (typeof judgmentNodeId === "string" && !nodes.has(judgmentNodeId))
        nodeIds.add(judgmentNodeId);
      if (
        typeof judgmentEdgeId === "string" &&
        basis != null &&
        !edges.has(judgmentEdgeId)
      )
        edgeIds.add(judgmentEdgeId);
    });
    const [readNodes, readEdges] = await Promise.all([
      context.nodes(nodeIds),
      context.edges(edgeIds),
    ]);
    if (readNodes.size !== nodeIds.size || readEdges.size !== edgeIds.size)
      throw new WorldConflict("選別した判定資料が変わりました");
    for (const [id, node] of readNodes) nodes.set(id, node);
    for (const [id, edge] of readEdges) edges.set(id, edge);
    await context.validate();
    return restore(materials, nodes, edges) as unknown[];
  };
}
