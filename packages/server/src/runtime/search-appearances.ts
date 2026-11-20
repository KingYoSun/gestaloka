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
// 抽選で当たった発生数を出現にする。物品は発生数を個数に持つ1つの物品にまとめ、物品のノードを増やさない。
function appear(key: string, rule: Rule, count: number): Appearance[] {
  const { kind, species, description } = rule,
    item = kind === "existence";
  return Array.from({ length: item ? Math.min(count, 1) : count }, (_, i) => ({
    id: derivedId(key + ":" + i),
    kind,
    species,
    description,
    ...(item ? { count } : {}),
  }));
}
// 出現を出来事として記録し、個体以外をその場に残る発見物にする。その場に、呼称が同じ
// 個数つきの発見物があれば、現れた物品をそこへ足して物品を増やさない。状態が付いた発見物にも
// 足し、複数あれば個数の多いものを選ぶ。足した出現のidは、足した先の物品のidに書き換える。
export async function recordAppearances(
  ctx: WorldContext,
  changes: Change,
  request: string,
  event: Omit<Extract<WorldNode, { kind: "event" }>, "kind" | "period">,
  places: string[],
  at: number,
  appearances: Appearance[],
) {
  const stacks = new Map<string, Extract<WorldNode, { kind: "existence" }>>();
  if (appearances.some((a) => a.kind === "existence"))
    for (const place of places)
      for (const id of await groundItems(ctx, place)) {
        const node = await ctx.node(id);
        const known = node && stacks.get(node.text);
        if (
          node?.kind === "existence" &&
          node.count &&
          ((await ctx.latestTime(id)) ?? 0) <= at &&
          (!known ||
            node.count > known.count! ||
            (node.count === known.count && node.id < known.id))
        )
          stacks.set(node.text, node);
      }
  const added = new Map<string, Extract<WorldNode, { kind: "existence" }>>();
  for (const a of appearances) {
    const stack =
      a.kind === "existence" && stacks.get(a.species + "：" + a.description);
    if (!stack || !a.count) continue;
    a.id = stack.id;
    const node = added.get(stack.id) ?? stack;
    added.set(stack.id, { ...node, count: node.count! + a.count });
  }
  changes.revisions.push(...added.values());
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
  if (appearances.some((a) => a.kind !== "instant-npc" && !added.has(a.id))) {
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
    if (kind === "instant-npc" || added.has(id)) continue;
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
      if (node.spawn.kind === "instant-npc") continue;
      drops.push(
        ...appear(request + ":" + node.id, node.spawn, draw(node.spawn)),
      );
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
    for (const appearance of appear(
      request + ":" + ruleId,
      rule,
      draw(rule, limit - staying),
    ))
      appearances.push({
        ...appearance,
        ...(rule.kind === "instant-npc" ? { ruleId } : {}),
      });
  }
  if (!appearances.length) {
    await ctx.validate();
    return [];
  }
  const changes: Change = { nodes: [], edges: [], endEdges: [], revisions: [] };
  const event = derivedId(request + ":appearance");
  const link = await recordAppearances(
    ctx,
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
