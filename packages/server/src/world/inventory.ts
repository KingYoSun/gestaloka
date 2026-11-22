import { createHash } from "node:crypto";
import type { ManagedTransaction } from "neo4j-driver";
import type { Change, WorldEdge, WorldNode } from "./model.js";

type Item = Extract<WorldNode, { kind: "existence" }>;
export const defaultInventoryLimits = {
  carrySlots: 30,
  storageSlots: 150,
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
     RETURN n.id AS id, n.data AS data, p.id AS parent, storage`,
    { worldId, actors },
  );
  return new Map(
    records.map((row) => [
      row.get("id") as string,
      {
        item: JSON.parse(row.get("data")) as Item,
        parent: row.get("parent") as string | null,
        storage: row.get("storage") as boolean,
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
  for (const { item, parent } of items.values()) {
    const slots = itemSlots(
      standard ? { ...item, unitsPerSlot: undefined } : item,
      stackSize,
    );
    const seen = new Set([item.id]);
    for (let p = parent; p && !seen.has(p); p = items.get(p)?.parent ?? null) {
      total.set(p, (total.get(p) ?? 0) + slots);
      seen.add(p);
    }
  }
  return total;
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
  const totals = snapshotTotals(items, limits.unitsPerSlot, standard);
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
        const usedSlots = totals.get(item.id) ?? 0;
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
     RETURN g.inventoryCacheUnits AS cacheUnits, coalesce(g.inventoryEnabled,false) AS enabled,
       g.inventoryCarrySlots AS carrySlots,g.inventoryStorageSlots AS storageSlots,g.inventoryUnitsPerSlot AS unitsPerSlot`,
    { worldId },
  );
  const row = records[0];
  return {
    enabled: Boolean(row?.get("enabled")),
    cacheUnits: Number(row?.get("cacheUnits") ?? 0),
    limits: {
      carrySlots: Number(
        row?.get("carrySlots") ?? defaultInventoryLimits.carrySlots,
      ),
      storageSlots: Number(
        row?.get("storageSlots") ?? defaultInventoryLimits.storageSlots,
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
    const total = snapshotTotals(items, limits.unitsPerSlot);
    await tx.run(
      `UNWIND $rows AS row MATCH (n:WorldNode {worldId:$worldId,id:row.id})
       SET n.inventorySlots=row.slots,n.inventoryStackKey=row.stack`,
      {
        worldId,
        rows: [...new Set([...total.keys(), ...items.keys()])].map((id) => ({
          id,
          slots: total.get(id) ?? 0,
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
    await tx.run(
      "MATCH (g:WorldGuard {worldId:$worldId,key:'inventory'}) SET g.inventoryCacheUnits=$stackSize",
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
       RETURN n.data AS data, p.id AS parent, coalesce(n.inventorySlots,0) AS used,
       EXISTS { MATCH ()-[u:has {role:'use'}]->(n) WHERE u.validTo IS NULL } AS storage LIMIT 1`,
      { worldId, id },
    );
    const row = records[0];
    const result = row
      ? {
          item: JSON.parse(row.get("data")) as Item,
          parent: row.get("parent") ?? undefined,
          used: Number(row.get("used")),
          storage: row.get("storage") as boolean,
        }
      : { used: 0, storage: false };
    before.set(id, result);
    return result;
  };
  const nextParent = async (id: string) =>
    parent.has(id) ? parent.get(id) : (await read(id)).parent;
  const deltas = new Map<string, number>();
  const stack = new Map<string, string | null>();
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
    if (prior.parent === to) {
      const delta = itemSlots(next, limits.unitsPerSlot) - oldSlots;
      if (delta) await add(to, delta, new Set([id]));
    } else {
      await add(prior.parent, -(oldSlots + prior.used), new Set([id]));
      await add(
        to,
        itemSlots(next, limits.unitsPerSlot) + prior.used,
        new Set([id]),
      );
    }
    stack.set(id, inventoryStackKey(next, limits.unitsPerSlot, to));
  }
  const registering = new Set(
    change.edges
      .filter(
        (e) =>
          e.kind === "has" && e.role === "use" && e.period.until === undefined,
      )
      .map((e) => e.target),
  );
  if (enforce) {
    const growing = [...deltas].filter(([, delta]) => delta > 0);
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
      const projectedSlots = old.used + delta;
      if (
        limitSlots !== undefined &&
        projectedSlots > Math.max(limitSlots, old.used)
      )
        throw new InventoryCapacityExceeded({
          holderId,
          usedSlots: old.used,
          limitSlots,
          projectedSlots,
        });
    }
  }
  const slots = new Map<string, number>();
  for (const [id, delta] of deltas)
    if (delta) slots.set(id, (await read(id)).used + delta);
  return { slots, stack };
}

export async function saveInventory(
  tx: ManagedTransaction,
  worldId: string,
  { slots, stack }: Awaited<ReturnType<typeof inventoryChange>>,
) {
  if (slots.size)
    await tx.run(
      `UNWIND $rows AS row MATCH (n:WorldNode {worldId:$worldId,id:row.id})
       SET n.inventorySlots=row.slots`,
      { worldId, rows: [...slots].map(([id, slots]) => ({ id, slots })) },
    );
  if (stack.size)
    await tx.run(
      `UNWIND $rows AS row MATCH (n:WorldNode {worldId:$worldId,id:row.id})
       SET n.inventoryStackKey=row.stack`,
      { worldId, rows: [...stack].map(([id, stack]) => ({ id, stack })) },
    );
}
