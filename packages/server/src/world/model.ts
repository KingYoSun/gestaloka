import { z } from "zod";

const Time = z.number().int().nonnegative().safe();
const Period = z
  .object({ from: Time, until: Time.optional() })
  .strict()
  .refine(
    (period) => period.until === undefined || period.until >= period.from,
    "期間の終点は始点以降にしてください",
  );
const Content = { id: z.uuid(), text: z.string() };

export const WorldNode = z.discriminatedUnion("kind", [
  z.object({ ...Content, kind: z.literal("existence") }).strict(),
  z.object({ ...Content, kind: z.literal("script") }).strict(),
  z.object({ ...Content, kind: z.literal("event"), period: Period }).strict(),
]);
export type WorldNode = z.infer<typeof WorldNode>;
export const RelationKind = z.enum([
  "has",
  "effect",
  "happen",
  "see",
  "interpret",
  "status",
]);
export type RelationKind = z.infer<typeof RelationKind>;
export const WorldEdge = z
  .object({
    id: z.uuid(),
    kind: RelationKind,
    source: z.uuid(),
    target: z.uuid(),
    role: z.enum(["content", "about"]).optional(),
    text: z.string().optional(),
    period: Period,
  })
  .strict()
  .refine(
    (edge) =>
      edge.kind === "status" || edge.kind === "interpret"
        ? edge.role !== undefined
        : edge.role === undefined,
    "status/interpretだけがcontent/aboutの役割を持ちます",
  );
export type WorldEdge = z.infer<typeof WorldEdge>;

export const Change = z
  .object({
    nodes: z.array(WorldNode),
    revisions: z.array(WorldNode).default([]),
    edges: z.array(WorldEdge),
    endEdges: z.array(z.uuid()),
  })
  .strict()
  .refine(
    (change) =>
      new Set([...change.nodes, ...change.revisions].map((node) => node.id))
        .size ===
        change.nodes.length + change.revisions.length &&
      new Set([...change.edges.map((edge) => edge.id), ...change.endEdges])
        .size ===
        change.edges.length + change.endEdges.length,
    "一つの差分で同じ同一性を重複して変更できません",
  );
export type Change = z.infer<typeof Change>;

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
