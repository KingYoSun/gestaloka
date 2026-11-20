import { randomInt } from "node:crypto";
import type {
  Appearance,
  Change,
  WorldEdge,
  WorldNode,
} from "@gestaloka/contracts";
import {
  derivedId,
  type WorldContext,
  type WorldStore,
} from "../world/store.js";
import { directPlaces } from "../world/locations.js";

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

type Rule = NonNullable<Extract<WorldNode, { kind: "script" }>["spawn"]>;
// 当たりを抽選し、発生数を返す。外れは0。
function draw(rule: Rule, limit = Infinity) {
  if (randomInt(0x100000000) / 0x100000000 >= rule.probability) return 0;
  return Math.min(
    limit,
    "count" in rule
      ? rule.count
      : rule.minCount +
          Math.floor(Math.random() * (rule.maxCount - rule.minCount + 1)),
  );
}
// 出現を出来事として記録し、個体以外をその場に残る発見物にする。
export function recordAppearances(
  changes: Change,
  request: string,
  event: Omit<Extract<WorldNode, { kind: "event" }>, "kind" | "period">,
  places: string[],
  at: number,
  appearances: Appearance[],
) {
  const ground = derivedId(request + ":ground");
  const link = (edge: Omit<WorldEdge, "id" | "period">) =>
    changes.edges.push({
      ...edge,
      id: derivedId(
        request + ":" + edge.kind + ":" + edge.source + ":" + edge.target,
      ),
      period: { from: at },
    });
  changes.nodes.push({
    ...event,
    kind: "event",
    ...(appearances.length ? { appearances } : {}),
    period: { from: at },
  });
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
  for (const { id, kind, species, description, count } of appearances) {
    if (kind === "instant-npc") continue;
    const text = species + "：" + description;
    changes.nodes.push(
      kind === "event"
        ? { kind, id, text, period: { from: at } }
        : kind === "existence" && count
          ? { kind, id, text, count }
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
  return link;
}
// 個体の発生用ノードへspawn-deathで結ばれた発生用ノードを抽選し、個体のいた場所に残す。
export async function deathDrops(
  ctx: WorldContext,
  request: string,
  ruleId: string | undefined,
  places: string[],
) {
  const drops: Appearance[] = [];
  if (ruleId && places.length)
    for (const edge of await ctx.relations(ruleId, "status", "in", latest)) {
      const node = about(edge, "spawn-death")
        ? await ctx.node(edge.source)
        : undefined;
      if (node?.kind !== "script" || !node.spawn) continue;
      const { kind, species, description } = node.spawn;
      if (kind === "instant-npc") continue;
      // 物品は発生数を個数に持つ1つの物品として残し、物品のノードを増やさない。
      const count = draw(node.spawn),
        item = kind === "existence";
      for (let i = item ? Math.min(count, 1) : count; i--;)
        drops.push({
          id: derivedId(request + ":" + node.id + ":" + i),
          kind,
          species,
          description,
          ...(item ? { count } : {}),
        });
    }
  return drops;
}

export async function searchAppearances(
  store: WorldStore,
  ctx: WorldContext,
  actor: string,
  members: string[],
  request: string,
  at: number,
  material: unknown,
  present: { name: string; places: string[] }[],
  multiplier: number,
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
  const places = await directPlaces(ctx, actor);
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
    // その場に残っている同種の個体と合わせて、発生数に世界ごとの倍率を掛けた数を超えない。
    const limit = ("count" in rule ? rule.count : rule.maxCount) * multiplier,
      staying =
        rule.kind === "instant-npc"
          ? present.filter(
              (p) =>
                p.name === rule.species &&
                p.places.some((x) => places.includes(x)),
            ).length
          : 0;
    if (staying >= limit) continue;
    for (let i = 0, count = draw(rule, limit - staying); i < count; i++)
      appearances.push({
        id: derivedId(request + ":" + ruleId + ":" + i),
        kind: rule.kind,
        species: rule.species,
        description: rule.description,
        ...(rule.kind === "instant-npc" ? { ruleId } : {}),
      });
  }
  if (!appearances.length) {
    await ctx.validate();
    return [];
  }
  const changes: Change = { nodes: [], edges: [], endEdges: [], revisions: [] };
  const event = derivedId(request + ":appearance");
  const link = recordAppearances(
    changes,
    request,
    {
      id: event,
      text: appearances.map((a) => a.species).join("、") + "が現れた",
    },
    places,
    at,
    appearances,
  );
  link({ kind: "happen", source: actor, target: event });
  for (const member of members)
    link({ kind: "see", source: member, target: event });
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
