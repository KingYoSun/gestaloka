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
// 物品と出現NPCは、発生数を持つ一つの出現にまとめる。
function appear(key: string, rule: Rule, count: number): Appearance[] {
  const { kind, species, description } = rule,
    counted = kind === "existence" || kind === "instant-npc";
  return Array.from(
    { length: counted ? Math.min(count, 1) : count },
    (_, i) => ({
      id: derivedId(key + ":" + i),
      kind,
      species,
      description,
      ...(counted ? { count } : {}),
    }),
  );
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
  deaths: number,
) {
  const drops: Appearance[] = [];
  if (ruleId && places.length)
    for (const edge of await ctx.relations(ruleId, "status", "in", latest)) {
      const node = about(edge, "spawn-death")
        ? await ctx.node(edge.source)
        : undefined;
      if (node?.kind !== "script" || !node.spawn) continue;
      if (node.spawn.kind === "instant-npc") continue;
      let count = 0;
      for (let i = 0; i < deaths; i++) count += draw(node.spawn);
      drops.push(...appear(request + ":" + node.id, node.spawn, count));
    }
  return drops;
}

const appearanceAnnouncement = (appearances: Appearance[]) =>
  appearances
    .map((a) =>
      a.kind === "instant-npc" && (a.count ?? 1) > 1
        ? `${a.species} ×${a.count}`
        : a.species,
    )
    .join("、") + "が現れた";

function appearanceResult(appearances: Appearance[], text: string) {
  return {
    appearances,
    ...(text !== appearanceAnnouncement(appearances)
      ? { appearanceText: text }
      : {}),
  };
}

export async function searchAppearances(
  store: WorldStore,
  ctx: WorldContext,
  actor: string,
  members: string[],
  request: string,
  at: number,
  material: unknown,
  present: { name: string; places: string[]; count?: number }[],
  multiplier: number,
) {
  const prior = await store.receipt(ctx.worldId, request);
  if (prior) {
    const event = prior.changes.nodes.find(
      (n) => n.kind === "event" && n.appearances,
    );
    if (event?.kind === "event" && event.appearances?.length)
      return appearanceResult(event.appearances, event.text);
    return;
  }
  const hits = new Set<string>(),
    rules = new Set<string>();
  materialIds(material, hits);
  for (const hit of hits) {
    for (const edge of await ctx.relations(hit, "status", "in", latest))
      if (about(edge, "spawn-hit")) rules.add(edge.source);
  }
  if (!rules.size) return;
  const held = new Set(
    (await ctx.relations(actor, "has", "out", latest))
      .filter((e) => !e.role)
      .map((e) => e.target),
  );
  const places = await directPlaces(ctx, actor);
  const appearances: Appearance[] = [];
  const descriptions: string[] = [];
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
          ? present
              .filter(
                (p) =>
                  p.name === rule.species &&
                  p.places.some((x) => places.includes(x)),
              )
              .reduce((count, p) => count + (p.count ?? 1), 0)
          : 0;
    if (staying >= limit) continue;
    const spawned = appear(
      request + ":" + ruleId,
      rule,
      draw(rule, limit - staying),
    );
    if (!spawned.length) continue;
    for (const appearance of spawned)
      appearances.push({
        ...appearance,
        ...(rule.kind === "instant-npc" ? { ruleId } : {}),
      });
    const candidates: string[] = [];
    const descriptionIds = new Set(
      conditions
        .filter((edge) => about(edge, "spawn-description"))
        .map((edge) => edge.target),
    );
    for (const id of descriptionIds) {
      const candidate = await ctx.node(id);
      if (
        candidate?.kind === "script" &&
        !Array.isArray(candidate.viewers) &&
        candidate.text.trim()
      )
        candidates.push(candidate.text);
    }
    if (candidates.length)
      descriptions.push(candidates[randomInt(candidates.length)]!);
  }
  if (!appearances.length) {
    await ctx.validate();
    return;
  }
  const changes: Change = { nodes: [], edges: [], endEdges: [], revisions: [] };
  const event = derivedId(request + ":appearance");
  const text = [appearanceAnnouncement(appearances), ...descriptions].join(
    "\n\n",
  );
  const link = await recordAppearances(
    ctx,
    changes,
    request,
    { id: event, text },
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
  return appearanceResult(appearances, text);
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
