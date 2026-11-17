import { randomInt } from "node:crypto";
import type { Appearance, Change, WorldEdge } from "@gestaloka/contracts";
import {
  derivedId,
  type WorldContext,
  type WorldStore,
} from "../world/store.js";
import { locationRecords } from "../world/locations.js";

const latest = Number.MAX_SAFE_INTEGER;
const about = (edge: WorldEdge, text: string) =>
  edge.role === "about" && edge.text === text;

// Only references exposed in the search result are hits. Neither free text nor
// internal dependency/version keys identify a node the player discovered.
function materialIds(value: unknown, ids: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) materialIds(item, ids);
  } else if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(row)) {
      if (["aboutIds", "sourceIds"].includes(key) && Array.isArray(child)) {
        for (const id of child) if (typeof id === "string") ids.add(id);
      } else if (
        ["source", "target"].includes(key) &&
        typeof child === "string"
      )
        ids.add(child);
      else if (
        key === "id" &&
        typeof child === "string" &&
        !("source" in row) &&
        !("aboutIds" in row)
      )
        ids.add(child);
      else materialIds(child, ids);
    }
  }
}

export async function searchAppearances(
  store: WorldStore,
  ctx: WorldContext,
  actor: string,
  members: string[],
  request: string,
  at: number,
  material: unknown,
) {
  const prior = await store.receipt(ctx.worldId, request);
  if (prior) {
    const event = prior.changes.nodes.find(
      (n) => n.kind === "event" && n.appearances,
    );
    return event?.kind === "event" ? (event.appearances ?? []) : [];
  }
  const hits = new Set<string>(),
    rules = new Set<string>();
  materialIds(material, hits);
  for (const hit of hits) {
    for (const edge of await ctx.relations(hit, "status", "in", latest))
      if (about(edge, "spawn-hit")) rules.add(edge.source);
  }
  if (!rules.size) return [];
  const held = new Set(
    (await ctx.relations(actor, "has", "out", latest))
      .filter((e) => e.role === "hold")
      .map((e) => e.target),
  );
  const places = [
    ...new Set((await locationRecords(ctx, actor)).flatMap((l) => l.aboutIds)),
  ];
  const appearances: Appearance[] = [];
  for (const ruleId of rules) {
    const node = await ctx.node(ruleId);
    if (node?.kind !== "script" || !node.spawn) continue;
    const rule = node.spawn,
      conditions = await ctx.relations(ruleId, "status", "out", latest);
    if (
      !conditions.every((edge) => {
        if (about(edge, "spawn-hold")) return held.has(edge.target);
        if (about(edge, "spawn-at")) return places.includes(edge.target);
        return true;
      })
    )
      continue;
    if (!places.length && rule.kind !== "instant-npc") continue;
    if (randomInt(0x100000000) / 0x100000000 >= rule.probability) continue;
    for (let i = 0; i < rule.count; i++)
      appearances.push({
        id: derivedId(request + ":" + ruleId + ":" + i),
        kind: rule.kind,
        species: rule.species,
        description: rule.description,
      });
  }
  if (!appearances.length) {
    await ctx.validate();
    return [];
  }
  const changes: Change = { nodes: [], edges: [], endEdges: [], revisions: [] };
  const event = derivedId(request + ":appearance"),
    ground = derivedId(request + ":ground");
  const link = (edge: Omit<WorldEdge, "id" | "period">) =>
    changes.edges.push({
      ...edge,
      id: derivedId(
        request + ":" + edge.kind + ":" + edge.source + ":" + edge.target,
      ),
      period: { from: at },
    });
  changes.nodes.push({
    id: event,
    kind: "event",
    text: appearances.map((a) => a.species).join("、") + "が現れた",
    appearances,
    period: { from: at },
  });
  link({ kind: "happen", source: actor, target: event });
  for (const member of members)
    link({ kind: "see", source: member, target: event });
  if (appearances.some((a) => a.kind !== "instant-npc")) {
    changes.nodes.push({
      id: ground,
      kind: "script",
      text: "この場に残っている発見物",
    });
    for (const place of places)
      link({
        kind: "status",
        role: "content",
        text: "ground",
        source: place,
        target: ground,
      });
  }
  for (const { id, kind, species, description } of appearances) {
    if (kind === "instant-npc") continue;
    const text = species + "：" + description;
    changes.nodes.push(
      kind === "event"
        ? { kind, id, text, period: { from: at } }
        : { kind, id, text },
    );
    link({
      kind: "status",
      role: "about",
      text: "ground-item",
      source: ground,
      target: id,
    });
  }
  await store.commit(await store.claim(ctx.worldId, request), ctx, {
    commitId: request,
    at,
    changes,
  });
  return appearances;
}
export async function groundItems(ctx: WorldContext, place: string) {
  const ids = new Set<string>();
  for (const edge of await ctx.relations(place, "status", "out", latest)) {
    if (edge.role !== "content" || edge.text !== "ground") continue;
    for (const e of await ctx.relations(edge.target, "status", "out", latest))
      if (about(e, "ground-item")) ids.add(e.target);
  }
  return ids;
}
export async function groundPlacement(ctx: WorldContext, id: string) {
  return (await ctx.relations(id, "status", "in", latest)).filter((e) =>
    about(e, "ground-item"),
  );
}
