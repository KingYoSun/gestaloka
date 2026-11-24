import { createHash } from "node:crypto";
import { int, type ManagedTransaction } from "neo4j-driver";
import type { z } from "zod";
import type { InventoryBundleCommand } from "@gestaloka/contracts";
import { changeScope, matchesChangeScope } from "./change-scope.js";
import { derivedId, type WorldNode } from "./model.js";
import {
  InventoryCapacityExceeded,
  itemSlots,
  type InventoryLimits,
} from "./inventory.js";

export type BundleCommand = z.infer<typeof InventoryBundleCommand>;
export type Bundle = {
  id: string;
  storageId: string;
  label: string;
  itemCount: number;
  normalSlots: number;
};
export type BundleChange = { before: Bundle; after: Bundle };

export class InventoryBundleError extends Error {
  readonly code = "INVENTORY_BUNDLE_INVALID";
}

function authorizedMembers<T>(approved: T, actual: T): T {
  if (!matchesChangeScope(changeScope(approved), actual))
    throw new InventoryBundleError("許可されたバンドルの範囲と一致しません");
  return actual;
}

export function parseBundle(value: Bundle): Bundle {
  return {
    ...value,
    itemCount: Number(value.itemCount),
    normalSlots: Number(value.normalSlots),
  };
}

export const bundleDiscount = ({ normalSlots, itemCount }: Bundle) =>
  itemCount ? normalSlots - 1 : 0;

export function discountDeltas(changes: BundleChange[]) {
  const deltas = new Map<string, number>();
  for (const { before, after } of changes) {
    const id = after.storageId;
    deltas.set(
      id,
      (deltas.get(id) ?? 0) + bundleDiscount(after) - bundleDiscount(before),
    );
  }
  return deltas;
}

export async function saveBundles(
  tx: ManagedTransaction,
  worldId: string,
  changes: BundleChange[],
) {
  if (!changes.length) return;
  await tx.run(
    `UNWIND $bundles AS row
     MERGE (b:InventoryBundle {worldId:$worldId,id:row.id})
     SET b.storageId=row.storageId,b.label=row.label,b.normalSlots=row.normalSlots,b.itemCount=row.itemCount
     FOREACH (_ IN CASE WHEN row.itemCount=0 THEN [1] ELSE [] END | DELETE b)`,
    {
      worldId,
      bundles: changes.map(({ after }) => ({
        ...after,
        normalSlots: int(after.normalSlots),
        itemCount: int(after.itemCount),
      })),
    },
  );
  await tx.run(
    `UNWIND $rows AS row
     MATCH (n:WorldNode {worldId:$worldId,id:row.id})
     SET n.inventoryDiscount=coalesce(n.inventoryDiscount,0)+row.delta
     WITH row
     UNWIND ['inventory:'+row.id,'relations:'+row.id+':has:out'] AS key
     MERGE (g:WorldGuard {worldId:$worldId,key:key})
     SET g.version=coalesce(g.version,0)+1`,
    {
      worldId,
      rows: [...discountDeltas(changes)].map(([id, delta]) => ({
        id,
        delta: int(delta),
      })),
    },
  );
}

export async function readBundle(
  tx: ManagedTransaction,
  worldId: string,
  id: string,
  actor: string,
) {
  const { records } = await tx.run(
    `MATCH (b:InventoryBundle {worldId:$worldId,id:$id})
     MATCH (:WorldNode {worldId:$worldId,id:$actor})-[u:has {role:'use'}]->
       (:WorldNode {worldId:$worldId,id:b.storageId})
     WHERE u.validTo IS NULL
     RETURN b {.id,.storageId,.label,.itemCount,.normalSlots} AS bundle LIMIT 1`,
    { worldId, id, actor },
  );
  if (records[0]) return parseBundle(records[0].get("bundle"));
}

export async function editBundle(
  tx: ManagedTransaction,
  worldId: string,
  actor: string,
  input: BundleCommand,
  limits: InventoryLimits,
  enabled: boolean,
  requireHere: () => Promise<void>,
) {
  const { storageId, action, requestId } = input;
  const args = { worldId, actor, storageId, requestId };
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const prior = (
    await tx.run(
      `MATCH (r:InventoryBundleRequest {worldId:$worldId,id:$requestId,actor:$actor})
     RETURN r.hash AS hash,r.result AS result`,
      args,
    )
  ).records[0];
  if (prior) {
    if (prior.get("hash") !== hash)
      throw new InventoryBundleError(
        "同じ要求IDには同じ操作を指定してください",
      );
    return JSON.parse(prior.get("result")) as {
      bundleId: string;
      itemCount: number;
      normalSlots: number;
    };
  }
  const storage = (
    await tx.run(
      `MATCH (:WorldNode {worldId:$worldId,id:$actor})-[u:has {role:'use'}]->
       (s:WorldNode {worldId:$worldId,id:$storageId})
     WHERE u.validTo IS NULL
     RETURN s.data AS data,coalesce(s.inventorySlots,0)-coalesce(s.inventoryDiscount,0) AS used LIMIT 1`,
      args,
    )
  ).records[0];
  if (!storage)
    throw new InventoryBundleError("本人が登録した保管先を指定してください");
  await requireHere();
  const before =
    action === "create"
      ? {
          id: derivedId(`bundle:${actor}:${requestId}`),
          storageId,
          label: input.label,
          itemCount: 0,
          normalSlots: 0,
        }
      : await readBundle(tx, worldId, input.bundleId, actor);
  if (!before || before.storageId !== storageId)
    throw new InventoryBundleError(
      "その保管先にあるバンドルを指定してください",
    );
  const after = { ...before };
  if (action === "dissolve") {
    after.itemCount = 0;
    after.normalSlots = 0;
    const members = authorizedMembers(
      { storageId: before.storageId, bundleId: before.id },
      { storageId, bundleId: input.bundleId },
    );
    await tx.run(
      `MATCH (n:WorldNode {worldId:$worldId,inventoryBundleId:$bundleId})
       SET n.inventoryLooseHolder=$storageId REMOVE n.inventoryBundleId`,
      { ...args, ...members },
    );
  } else {
    const ids =
      action === "release" ? [input.itemId] : [...new Set(input.itemIds)];
    if (action !== "release" && ids.length !== input.itemIds.length)
      throw new InventoryBundleError("同じ品は一度だけ指定してください");
    if (action !== "release" && ids.length > limits.bundleSlots)
      throw new InventoryBundleError(
        `バンドルに入れられるのは通常の使用枠で${limits.bundleSlots}枠分までです`,
      );
    const { records } = await tx.run(
      `UNWIND $ids AS id
       MATCH (n:WorldNode {worldId:$worldId,id:id,inventoryHolder:$storageId})
       OPTIONAL MATCH (b:InventoryBundle {worldId:$worldId,id:n.inventoryBundleId})
       RETURN n.id AS id,n.data AS data,coalesce(n.inventorySlots,0) AS contents,b.id AS bundleId`,
      { ...args, ids },
    );
    if (records.length !== ids.length)
      throw new InventoryBundleError(
        "その保管先の直下にある品を指定してください",
      );
    const sign = action === "release" ? -1 : 1;
    for (const row of records) {
      if (
        action === "release"
          ? row.get("bundleId") !== before.id
          : row.get("bundleId") || Number(row.get("contents")) > 0
      )
        throw new InventoryBundleError(
          action === "release"
            ? "バンドルに入っている品を指定してください"
            : "中に品を持つ物品や、バンドルに入っている品は追加できません",
        );
      after.normalSlots +=
        sign *
        itemSlots(
          JSON.parse(row.get("data")) as Extract<
            WorldNode,
            { kind: "existence" }
          >,
          limits.unitsPerSlot,
        );
    }
    after.itemCount += sign * ids.length;
    if (action !== "release" && after.normalSlots > limits.bundleSlots)
      throw new InventoryBundleError(
        `バンドルに入れられるのは通常の使用枠で${limits.bundleSlots}枠分までです`,
      );
    const members = authorizedMembers(
      {
        ids: records.map((row) => row.get("id") as string).sort(),
        bundleId: action === "release" ? null : before.id,
        loose: action === "release" ? before.storageId : null,
      },
      {
        ids: ids.sort(),
        bundleId:
          action === "release"
            ? null
            : action === "create"
              ? before.id
              : input.bundleId,
        loose: action === "release" ? storageId : null,
      },
    );
    await tx.run(
      `UNWIND $ids AS id MATCH(n:WorldNode {worldId:$worldId,id:id})
       SET n.inventoryBundleId=$bundleId,n.inventoryLooseHolder=$loose`,
      { ...args, ...members },
    );
  }
  const usedSlots = Number(storage.get("used"));
  const limitSlots =
    JSON.parse(storage.get("data")).storageLimitSlots ?? limits.storageSlots;
  const projectedSlots =
    usedSlots + bundleDiscount(before) - bundleDiscount(after);
  if (enabled && projectedSlots > Math.max(usedSlots, limitSlots))
    throw new InventoryCapacityExceeded({
      holderId: storageId,
      usedSlots,
      limitSlots,
      projectedSlots,
    });
  await saveBundles(tx, worldId, [{ before, after }]);
  const result = {
    bundleId: before.id,
    itemCount: after.itemCount,
    normalSlots: after.normalSlots,
  };
  await tx.run(
    `CREATE (:InventoryBundleRequest {worldId:$worldId,id:$requestId,actor:$actor,hash:$hash,result:$result})`,
    { ...args, hash, result: JSON.stringify(result) },
  );
  return result;
}
