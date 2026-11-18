import { type WorldContext, type Dependency } from "../world/store.js";

type Row = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const object = (v: unknown): v is Row =>
  !!v && typeof v === "object" && !Array.isArray(v);

// Resolve only references in this result. Rule definitions and edges can also occur in
// older saved responses, observation paths, and optimistic-concurrency keys.
export async function playerMaterial(
  ctx: WorldContext,
  material: unknown,
  dependencies: Dependency[],
  target?: { id: string; kind: "subject" | "history" },
) {
  const ids = new Set<string>(),
    edges = new Set<string>(),
    hidden = new Set<string>();
  const links: { id: string; source: string; target: string }[] = [];
  const keyId = (key: string) => key.split(":")[1] ?? "";
  const collect = (v: unknown, key = "") => {
    if (typeof v === "string") {
      if (uuid.test(v)) {
        ids.add(v);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const child of v) collect(child, key);
      return;
    }
    if (!object(v)) return;
    if (typeof v.id === "string") {
      if (v.spawn) hidden.add(v.id);
      if (typeof v.source === "string" && typeof v.target === "string")
        links.push({ id: v.id, source: v.source, target: v.target });
    }
    for (const [k, value] of Object.entries(v)) {
      if (key === "versions") {
        ids.add(keyId(k));
      }
      collect(value, k);
    }
  };
  // Observation pathIds can only reference effect edges, whose endpoints cannot be spawn scripts.
  collect(material);
  for (const d of dependencies) {
    ids.add(keyId(d.key));
    if (d.key.startsWith("edge:")) edges.add(keyId(d.key));
  }
  if (target) ids.add(target.id);
  const edgeRefs = await Promise.all(
    [...edges].filter((id) => uuid.test(id)).map((id) => ctx.edge(id)),
  );
  collect(edgeRefs);
  if (ids.size) {
    const result = await ctx.driver.executeQuery(
      "UNWIND $ids AS id MATCH (n:WorldNode {worldId:$world,id:id,kind:'script'}) RETURN n.id AS id,n.data AS data",
      { world: ctx.worldId, ids: [...ids] },
    );
    for (const r of result.records)
      if (JSON.parse(r.get("data")).spawn) hidden.add(r.get("id"));
  }
  if (target && hidden.has(target.id)) {
    if (target.kind === "subject") return undefined;
    material = [];
  }
  if (!hidden.size) return { material, dependencies };
  const hiddenRef = (v: unknown) => typeof v === "string" && hidden.has(v);
  for (const edge of links)
    if (hidden.has(edge.source) || hidden.has(edge.target)) hidden.add(edge.id);
  function project(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(project).filter((x) => x !== undefined);
    if (!object(v)) return hiddenRef(v) ? undefined : v;
    if (
      v.spawn ||
      hiddenRef(v.id) ||
      hiddenRef(v.source) ||
      hiddenRef(v.target) ||
      (object(v.node) && hiddenRef(v.node.id)) ||
      (object(v.relation) && hiddenRef(v.relation.id))
    )
      return undefined;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([key]) => !hidden.has(keyId(key)))
        .map(([key, x]) => [key, project(x)])
        .filter(([, x]) => x !== undefined),
    );
  }
  return {
    material: project(material),
    dependencies: dependencies.filter((d) => !hidden.has(keyId(d.key))),
  };
}
