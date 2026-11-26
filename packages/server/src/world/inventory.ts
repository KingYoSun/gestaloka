import { createHash } from "node:crypto";
import type { ManagedTransaction } from "neo4j-driver";
import {
  summaryId,
  type Change,
  type WorldEdge,
  type WorldNode,
} from "./model.js";
import {
  bundleDiscount,
  discountDeltas,
  InventoryBundleError,
  parseBundle,
  saveBundles,
  type Bundle,
  type BundleChange,
} from "./inventory-bundles.js";

type Item = Extract<WorldNode, { kind: "existence" }>;
export const defaultInventoryLimits = {
  carrySlots: 30,
  skillSlots: 50,
  storageSlots: 150,
  bundleSlots: 15,
  unitsPerSlot: 30,
};
export type InventoryLimits = typeof defaultInventoryLimits;
export const unitsPerSlot = (item: Item, standard: number) =>
  item.unitsPerSlot ?? standard;
export function itemSlots(item: Item, standard: number) {
  const perSlot = unitsPerSlot(item, standard);
  return item.count === undefined || perSlot === "unlimited"
    ? 1
    : Math.ceil(item.count / perSlot);
}

export type Capacity = {
  holderId: string;
  usedSlots: number;
  limitSlots: number;
  projectedSlots: number;
};
export type CapacityItem = {
  itemId: string;
  requestedCount: number;
  maxAcceptableCount: number;
};

export class SkillCapacityExceeded extends Error {
  readonly code = "SKILL_CAPACITY_EXCEEDED";
  constructor(readonly capacity: Capacity) {
    super(
      `技能の空き枠が足りません（現在${capacity.usedSlots}/${capacity.limitSlots}枠、習得後${capacity.projectedSlots}枠）。元技能を選んで発展・統合できます。`,
    );
  }
}

export async function usedSkillSlots(
  tx: ManagedTransaction,
  worldId: string,
  holderId: string,
) {
  // 旧版の要約に件数がないときだけ、その人物の現在の関係から読む。
  const { records } = await tx.run(
    `MATCH (s:WorldNode {worldId:$worldId,id:$summary})
     RETURN coalesce(s.skillSlots, COUNT { (:WorldNode {worldId:$worldId,id:$holderId})-[h:has {role:'skill'}]->() WHERE h.validTo IS NULL }) AS used`,
    { worldId, holderId, summary: summaryId(holderId, "skill") },
  );
  return Number(records[0]?.get("used") ?? 0);
}

export function skillCapacityError(
  holderId: string,
  usedSlots: number,
  limitSlots: number,
  delta: number,
) {
  const projectedSlots = usedSlots + delta;
  if (delta > 0 && projectedSlots > limitSlots)
    return new SkillCapacityExceeded({
      holderId,
      usedSlots,
      limitSlots,
      projectedSlots,
    });
}

export function skillDeltas(
  edges: WorldEdge[],
  ended: readonly (WorldEdge | undefined)[],
) {
  const deltas = new Map<string, number>();
  const add = (edge: WorldEdge, delta: number) => {
    if (
      edge.kind === "has" &&
      edge.role === "skill" &&
      edge.period.until === undefined
    )
      deltas.set(edge.source, (deltas.get(edge.source) ?? 0) + delta);
  };
  for (const edge of edges) add(edge, 1);
  for (const edge of ended) if (edge) add(edge, -1);
  return deltas;
}

export async function checkSkillChange(
  tx: ManagedTransaction,
  worldId: string,
  edges: WorldEdge[],
  ended: readonly WorldEdge[],
  limit: number,
) {
  for (const [holder, delta] of skillDeltas(edges, ended)) {
    if (delta <= 0) continue;
    const error = skillCapacityError(
      holder,
      await usedSkillSlots(tx, worldId, holder),
      limit,
      delta,
    );
    if (error) throw error;
  }
}

export class InventoryCapacityExceeded extends Error {
  item?: CapacityItem;
  constructor(readonly capacity: Capacity) {
    super(
      `保管できる枠を超えています（${capacity.projectedSlots}/${capacity.limitSlots}枠）。`,
    );
  }
}

type InventoryNode = {
  item?: Item;
  parent?: string;
  used: number;
  discount: number;
  bundle?: Bundle;
  storage: boolean;
};

export const inventoryStackKey = (
  item: Item,
  standard: number,
  parent?: string,
) =>
  item.count && parent
    ? createHash("sha256")
        .update(
          JSON.stringify([
            parent,
            item.text,
            item.seriesId ?? null,
            unitsPerSlot(item, standard),
            ...(item.summons ? [item.summons] : []),
          ]),
        )
        .digest("hex")
    : null;

async function inventorySnapshot(
  tx: ManagedTransaction,
  worldId: string,
  actors: string[] = [],
) {
  const { records } = await tx.run(
    `MATCH (n:WorldNode {worldId:$worldId,kind:'existence'})
     WITH n, EXISTS { MATCH ()-[u:has {role:'use'}]->(n) WHERE u.validTo IS NULL } AS storage
     OPTIONAL MATCH (p:WorldNode {kind:'existence'})-[h:has]->(n)
     WHERE h.role IS NULL AND h.validTo IS NULL
     WITH n,p,storage WHERE p IS NOT NULL OR storage OR n.id IN $actors
     OPTIONAL MATCH (b:InventoryBundle {worldId:$worldId,id:n.inventoryBundleId,storageId:p.id})
     RETURN n.id AS id, n.data AS data, p.id AS parent, storage,
       b {.id,.storageId,.label,.itemCount,.normalSlots} AS bundle`,
    { worldId, actors },
  );
  return new Map(
    records.map((row) => [
      row.get("id") as string,
      {
        item: JSON.parse(row.get("data")) as Item,
        parent: row.get("parent") as string | null,
        storage: row.get("storage") as boolean,
        bundle: row.get("bundle") as Bundle | null,
      },
    ]),
  );
}

function snapshotTotals(
  items: Awaited<ReturnType<typeof inventorySnapshot>>,
  stackSize: number,
  standard = false,
) {
  const total = new Map<string, number>();
  const bundles = new Map<string, Bundle>();
  for (const { item, parent, bundle } of items.values()) {
    const slots = itemSlots(
      standard ? { ...item, unitsPerSlot: undefined } : item,
      stackSize,
    );
    const seen = new Set([item.id]);
    for (let p = parent; p && !seen.has(p); p = items.get(p)?.parent ?? null) {
      total.set(p, (total.get(p) ?? 0) + slots);
      seen.add(p);
    }
    if (bundle) {
      const tally = bundles.get(bundle.id) ?? {
        ...bundle,
        itemCount: 0,
        normalSlots: 0,
      };
      tally.itemCount++;
      tally.normalSlots += slots;
      bundles.set(bundle.id, tally);
    }
  }
  const discounts = new Map<string, number>();
  for (const bundle of bundles.values())
    discounts.set(
      bundle.storageId,
      (discounts.get(bundle.storageId) ?? 0) + bundleDiscount(bundle),
    );
  return { total, bundles: [...bundles.values()], discounts };
}

export async function inventoryAudit(
  tx: ManagedTransaction,
  worldId: string,
  actors: string[],
  minCount: number,
  standard: boolean,
) {
  const { limits, enabled } = await inventoryState(tx, worldId);
  const items = await inventorySnapshot(tx, worldId, actors);
  const { total, discounts } = snapshotTotals(
    items,
    limits.unitsPerSlot,
    standard,
  );
  const people = new Set(actors);
  return {
    limits,
    enabled,
    holders: [...items.values()]
      .filter(({ item, storage }) => storage || people.has(item.id))
      .map(({ item, storage }) => {
        const limitSlots = storage
          ? (item.storageLimitSlots ?? limits.storageSlots)
          : limits.carrySlots;
        const usedSlots =
          (total.get(item.id) ?? 0) - (discounts.get(item.id) ?? 0);
        return {
          id: item.id,
          label: item.text,
          kind: storage ? "storage" : "person",
          usedSlots,
          limitSlots,
          freeSlots: Math.max(0, limitSlots - usedSlots),
          excessSlots: Math.max(0, usedSlots - limitSlots),
        };
      }),
    largeStacks: [...items.values()]
      .filter(({ item, parent }) => parent && (item.count ?? 0) >= minCount)
      .map(({ item, parent }) => ({
        id: item.id,
        label: item.text,
        holderId: parent,
        count: item.count,
        seriesId: item.seriesId,
        unitsPerSlot: standard
          ? limits.unitsPerSlot
          : unitsPerSlot(item, limits.unitsPerSlot),
        slots: itemSlots(
          standard ? { ...item, unitsPerSlot: undefined } : item,
          limits.unitsPerSlot,
        ),
      })),
  };
}

export async function inventoryState(tx: ManagedTransaction, worldId: string) {
  const { records } = await tx.run(
    `MATCH (g:WorldGuard {worldId:$worldId,key:'inventory'})
     RETURN CASE WHEN g.inventoryReady OR NOT coalesce(g.inventoryHolderIndexed,false)
       OR NOT coalesce(g.inventoryBundlesIndexed,false)
       THEN null ELSE g.inventoryCacheUnits END AS cacheUnits,
       coalesce(g.inventoryEnabled,false) AS enabled,
       g.inventoryCarrySlots AS carrySlots,g.inventoryStorageSlots AS storageSlots,g.inventoryBundleSlots AS bundleSlots,
       g.inventoryUnitsPerSlot AS unitsPerSlot,g.skillSlots AS skillSlots`,
    { worldId },
  );
  const row = records[0];
  return {
    enabled: Boolean(row?.get("enabled")),
    cacheUnits: Number(row?.get("cacheUnits") ?? 0),
    limits: {
      skillSlots: Number(
        row?.get("skillSlots") ?? defaultInventoryLimits.skillSlots,
      ),
      carrySlots: Number(
        row?.get("carrySlots") ?? defaultInventoryLimits.carrySlots,
      ),
      storageSlots: Number(
        row?.get("storageSlots") ?? defaultInventoryLimits.storageSlots,
      ),
      bundleSlots: Number(
        row?.get("bundleSlots") ?? defaultInventoryLimits.bundleSlots,
      ),
      unitsPerSlot: Number(
        row?.get("unitsPerSlot") ?? defaultInventoryLimits.unitsPerSlot,
      ),
    },
  };
}

export async function initializeInventory(
  tx: ManagedTransaction,
  worldId: string,
) {
  const { limits, enabled, cacheUnits } = await inventoryState(tx, worldId);
  if (cacheUnits !== limits.unitsPerSlot) {
    const items = await inventorySnapshot(tx, worldId);
    const { total, bundles, discounts } = snapshotTotals(
      items,
      limits.unitsPerSlot,
    );
    await tx.run(
      `UNWIND $rows AS row MATCH (n:WorldNode {worldId:$worldId,id:row.id})
       SET n.inventorySlots=row.slots,n.inventoryStackKey=row.stack,n.inventoryHolder=row.holder,
           n.inventoryDiscount=row.discount,n.inventoryLooseHolder=row.loose`,
      {
        worldId,
        rows: [...new Set([...total.keys(), ...items.keys()])].map((id) => ({
          id,
          slots: total.get(id) ?? 0,
          discount: discounts.get(id) ?? null,
          holder: items.get(id)?.parent ?? null,
          loose: items.get(id)?.bundle ? null : (items.get(id)?.parent ?? null),
          stack: items.has(id)
            ? inventoryStackKey(
                items.get(id)!.item,
                limits.unitsPerSlot,
                items.get(id)!.parent ?? undefined,
              )
            : null,
        })),
      },
    );
    if (bundles.length)
      await tx.run(
        `UNWIND $rows AS row MATCH (b:InventoryBundle {worldId:$worldId,id:row.id})
         SET b.normalSlots=row.normalSlots,b.itemCount=row.itemCount`,
        {
          worldId,
          rows: bundles.map(({ id, normalSlots, itemCount }) => ({
            id,
            normalSlots,
            itemCount,
          })),
        },
      );
    await tx.run(
      `MATCH (g:WorldGuard {worldId:$worldId,key:'inventory'})
       SET g.inventoryCacheUnits=$stackSize,g.inventoryHolderIndexed=true,g.inventoryBundlesIndexed=true REMOVE g.inventoryReady`,
      { worldId, stackSize: limits.unitsPerSlot },
    );
  }
  return { limits, enabled };
}

// Propagate the difference for each changed node through the final containment
// tree. A moved container contributes its old subtotal, then any changes to
// that subtotal travel through its new parent.
export async function inventoryChange(
  tx: ManagedTransaction,
  worldId: string,
  change: Change,
  ended: readonly WorldEdge[],
  actors: (ids: string[]) => Promise<Set<string>>,
  limits: InventoryLimits,
  enforce: boolean,
) {
  const isHolding = (e: WorldEdge) => e.kind === "has" && !e.role;
  const parent = new Map<string, string | undefined>();
  for (const edge of ended.filter(isHolding))
    parent.set(edge.target, undefined);
  for (const edge of change.edges.filter(
    (e) => isHolding(e) && e.period.until === undefined,
  ))
    parent.set(edge.target, edge.source);
  const items = new Map(
    [...change.nodes, ...change.revisions]
      .filter((node): node is Item => node.kind === "existence")
      .map((node) => [node.id, node]),
  );
  const before = new Map<string, InventoryNode>();
  const read = async (id: string): Promise<InventoryNode> => {
    const cached = before.get(id);
    if (cached) return cached;
    const { records } = await tx.run(
      `MATCH (n:WorldNode {worldId:$worldId,id:$id,kind:'existence'})
       OPTIONAL MATCH (p:WorldNode {kind:'existence'})-[h:has]->(n)
       WHERE h.role IS NULL AND h.validTo IS NULL
       OPTIONAL MATCH (b:InventoryBundle {worldId:$worldId,id:n.inventoryBundleId,storageId:p.id})
       RETURN n.data AS data, p.id AS parent, coalesce(n.inventorySlots,0) AS used,
       coalesce(n.inventoryDiscount,0) AS discount,
       b {.id,.storageId,.label,.itemCount,.normalSlots} AS bundle,
       EXISTS { MATCH ()-[u:has {role:'use'}]->(n) WHERE u.validTo IS NULL } AS storage LIMIT 1`,
      { worldId, id },
    );
    const row = records[0];
    const result = row
      ? {
          item: JSON.parse(row.get("data")) as Item,
          parent: row.get("parent") ?? undefined,
          used: Number(row.get("used")),
          discount: Number(row.get("discount")),
          ...(row.get("bundle")
            ? { bundle: parseBundle(row.get("bundle")) }
            : {}),
          storage: row.get("storage") as boolean,
        }
      : { used: 0, discount: 0, storage: false };
    before.set(id, result);
    return result;
  };
  const nextParent = async (id: string) =>
    parent.has(id) ? parent.get(id) : (await read(id)).parent;
  const deltas = new Map<string, number>();
  const entries = [];
  const bundles = new Map<string, BundleChange>();
  const add = async (
    id: string | undefined,
    delta: number,
    seen: Set<string>,
  ) => {
    while (id) {
      if (seen.has(id))
        throw new Error("入れ物を自分自身やその中身へ移すことはできません");
      seen.add(id);
      deltas.set(id, (deltas.get(id) ?? 0) + delta);
      id = await nextParent(id);
    }
  };
  for (const id of new Set([...parent.keys(), ...items.keys()])) {
    const prior = await read(id);
    const next = items.get(id) ?? prior.item;
    if (!next) continue;
    const to = await nextParent(id);
    const oldSlots = prior.item
      ? itemSlots(prior.item, limits.unitsPerSlot)
      : 0;
    const nextSlots = itemSlots(next, limits.unitsPerSlot);
    const moved = prior.parent !== to;
    if (moved && to) {
      const target = await read(to);
      if (target.bundle && target.parent === (await nextParent(to)))
        throw new InventoryBundleError(
          "バンドルに入っている品の中には物を入れられません",
        );
    }
    if (prior.bundle && (moved || oldSlots !== nextSlots)) {
      const before = prior.bundle;
      const change = bundles.get(before.id) ?? { before, after: { ...before } };
      change.after.normalSlots += moved ? -oldSlots : nextSlots - oldSlots;
      if (moved) change.after.itemCount--;
      bundles.set(before.id, change);
    }
    if (!moved) {
      const delta = nextSlots - oldSlots;
      if (delta) await add(to, delta, new Set([id]));
    } else {
      await add(prior.parent, -(oldSlots + prior.used), new Set([id]));
      await add(to, nextSlots + prior.used, new Set([id]));
    }
    entries.push({
      id,
      holder: to ?? null,
      loose: moved || !prior.bundle ? (to ?? null) : null,
      stack: inventoryStackKey(next, limits.unitsPerSlot, to),
      ...(moved && prior.bundle ? { clearBundle: true } : {}),
    });
  }
  const registering = new Set(
    change.edges
      .filter(
        (e) =>
          e.kind === "has" && e.role === "use" && e.period.until === undefined,
      )
      .map((e) => e.target),
  );
  const bundleChanges = [...bundles.values()];
  for (const { before, after } of bundleChanges)
    if (after.normalSlots > Math.max(before.normalSlots, limits.bundleSlots))
      throw new InventoryBundleError(
        `バンドルに入れられるのは通常の使用枠で${limits.bundleSlots}枠分までです`,
      );
  if (enforce) {
    const discounts = discountDeltas(bundleChanges);
    const growing = [...new Set([...deltas.keys(), ...discounts.keys()])]
      .map(
        (id) => [id, (deltas.get(id) ?? 0) - (discounts.get(id) ?? 0)] as const,
      )
      .filter(([, delta]) => delta > 0);
    const people = growing.length
      ? await actors(growing.map(([id]) => id))
      : new Set<string>();
    for (const [holderId, delta] of growing) {
      const old = await read(holderId);
      const next = items.get(holderId) ?? old.item;
      const limitSlots =
        old.storage || registering.has(holderId)
          ? (next?.storageLimitSlots ?? limits.storageSlots)
          : people.has(holderId)
            ? limits.carrySlots
            : undefined;
      const usedSlots = old.used - old.discount;
      const projectedSlots = usedSlots + delta;
      if (
        limitSlots !== undefined &&
        projectedSlots > Math.max(limitSlots, usedSlots)
      )
        throw new InventoryCapacityExceeded({
          holderId,
          usedSlots,
          limitSlots,
          projectedSlots,
        });
    }
  }
  const slots = new Map<string, number>();
  for (const [id, delta] of deltas)
    if (delta) slots.set(id, (await read(id)).used + delta);
  return { slots, entries, bundleChanges };
}

export async function saveInventory(
  tx: ManagedTransaction,
  worldId: string,
  {
    slots,
    entries,
    bundleChanges,
  }: Awaited<ReturnType<typeof inventoryChange>>,
) {
  if (slots.size)
    await tx.run(
      `UNWIND $rows AS row MATCH (n:WorldNode {worldId:$worldId,id:row.id})
       SET n.inventorySlots=row.slots`,
      { worldId, rows: [...slots].map(([id, slots]) => ({ id, slots })) },
    );
  if (entries.length)
    await tx.run(
      `UNWIND $rows AS row MATCH (n:WorldNode {worldId:$worldId,id:row.id})
       SET n.inventoryStackKey=row.stack,n.inventoryHolder=row.holder,n.inventoryLooseHolder=row.loose
       FOREACH (_ IN CASE WHEN row.clearBundle THEN [1] ELSE [] END | REMOVE n.inventoryBundleId)`,
      { worldId, rows: entries },
    );
  await saveBundles(tx, worldId, bundleChanges);
}
