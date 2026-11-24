import type pg from "pg";
import type { StorageAction } from "@gestaloka/contracts";
import { AccessError } from "../http/access.js";
import {
  checkBelongingCapacity,
  planBelongings,
  type BelongingOp,
} from "../world/belongings.js";
import { directPlaces } from "../world/locations.js";
import { checkVehicleTravel, isVehicle } from "./vehicles.js";
import { derivedId, type Change } from "../world/model.js";
import type {
  ItemReservations,
  PickupAllocation,
  Receipt,
  StorageEffect,
  WorldStore,
} from "../world/store.js";
import type { PlayApplications } from "./play-applications.js";
import { RuntimeControl } from "./control.js";
import { commitPlayChange, directChangeScope } from "./play-change-scope.js";

export const isStorageAction = (input: {
  command: string;
}): input is StorageAction => input.command.startsWith("storage-");

const reject = (message: string): never => {
  throw new AccessError(409, "STORAGE_UNAVAILABLE", message);
};

const page = <T extends { id: string }>(items: T[]) => ({
  items: items.slice(0, 20),
  next: items.length > 20 ? items[19]!.id : null,
});

async function notifyPickup(
  db: Pick<pg.Pool, "query">,
  applications: PlayApplications,
  world: string,
  receipt: Receipt,
) {
  const effect = receipt.storageEffect;
  if (effect?.type !== "claim") return;
  await applications.notice(
    db,
    world,
    receipt.commitId + ":pickup",
    [effect.sender, effect.receiver],
    `${effect.receiver}が${receipt.committedAt}に「${effect.label}」を${effect.count}個受け取りました（保管先 ${effect.storageId}）`,
  );
}

// 受領履歴はグラフ確定時に配信待ちになる。通知がSQLに確定してから待ち印を外す。
export async function deliverPickups(
  pool: pg.Pool,
  store: WorldStore,
  applications: PlayApplications,
  world?: string,
) {
  const graph = world
    ? (
        await pool.query<{ world_id: string }>(
          "SELECT world_id FROM world_construction WHERE id=$1",
          [world],
        )
      ).rows[0]?.world_id
    : undefined;
  if (world && !graph) return;
  const { records } = await store.driver.executeQuery(
    "MATCH(r:WorldPickup {noticePending:true" +
      (graph ? ",worldId:$graph" : "") +
      "}) RETURN r.worldId AS graph,r.commitId AS id LIMIT 20",
    graph ? { graph } : {},
    { routing: "READ" },
  );
  for (const row of records) {
    const id: string = row.get("id"),
      graphId: string = row.get("graph");
    const origin =
      world ??
      (
        await pool.query<{ world_id: string }>(
          "SELECT world_id FROM bot_request WHERE id=$1",
          [id],
        )
      ).rows[0]?.world_id;
    if (!origin) continue;
    const receipt = await store.receipt(graphId, id);
    if (!receipt) continue;
    if (
      !(await RuntimeControl.runWhenActive(pool, (db) =>
        notifyPickup(db, applications, origin, receipt),
      ))
    )
      return;
    // 通知を確定してから配信待ちを外す。間に停止した場合、再開後の通知は同じIDで重ならない。
    if (
      !(await RuntimeControl.runWhenActive(pool, () =>
        store.driver.executeQuery(
          "MATCH(r:WorldReceipt {worldId:$graphId,commitId:$id}) REMOVE r.noticePending",
          { graphId, id },
        ),
      ))
    )
      return;
  }
}

export async function planRelocation(
  db: Pick<pg.Pool, "query">,
  world: string,
  context: ReturnType<WorldStore["context"]>,
  actor: string,
  storageId: string,
  placeId: string,
  at: number,
  request: string,
) {
  const site = await context.installation(storageId);
  if (site && (await isVehicle(context, storageId))) {
    const vehicleResult = await checkVehicleTravel(
      db,
      world,
      context,
      actor,
      storageId,
      placeId,
    );
    const plan = await planBelongings(context, request, at, [
      {
        type: "locate",
        subjectId: storageId,
        text: "乗り物で移動する",
        aboutIds: [placeId],
      },
    ]);
    return {
      ...plan,
      vehicleResult,
      storageEffect: {
        type: "relocate" as const,
        storageId,
        managerId: site.manager,
        placeId,
      },
    };
  }
  if (site?.manager !== actor || !site.policy.relocatable)
    return reject("この保管先を移設する権限がありません");
  const [here] = await directPlaces(context, actor);
  if (
    here !== site.place ||
    !(await directPlaces(context, storageId)).includes(site.place)
  )
    return reject("保管先の現在の設置場所に移動してください");
  const destination = await context.node(placeId);
  if (
    destination?.kind !== "existence" ||
    placeId === storageId ||
    (
      await db.query(
        "SELECT 1 FROM world_controlled_actor WHERE world_id=$1 AND actor_id=$2",
        [context.worldId, placeId],
      )
    ).rowCount
  )
    return reject("移設先の場所を指定してください");
  const { records } = await context.driver.executeQuery(
    ` MATCH(p:WorldNode {worldId:$world,id:$id})
       WHERE p.fixedPlace OR (NOT p:InstalledStorage AND NOT EXISTS { MATCH ()-[h:has]->(p) WHERE h.validTo IS NULL AND h.role IS NULL }
         AND (EXISTS { MATCH (p)-[r:status {role:'content'}]->() WHERE r.validTo IS NULL AND r.data CONTAINS '"text":"route"' }
          OR EXISTS { MATCH (p)<-[a:status {role:'about'}]-()<- [c:status {role:'content'}]-() WHERE a.data CONTAINS '"text":"direct-place"' AND c.data CONTAINS '"text":"location"' }))
       RETURN p.id LIMIT 1`,
    { world: context.worldId, id: placeId },
    { routing: "READ" },
  );
  if (!records.length) return reject("移設先の場所を指定してください");
  const plan = await planBelongings(context, request, at, [
    {
      type: "locate",
      subjectId: storageId,
      text: destination.text,
      aboutIds: [placeId],
    },
  ]);
  return {
    ...plan,
    storageEffect: {
      type: "relocate" as const,
      storageId,
      managerId: actor,
      placeId,
    },
  };
}

export async function storageCommand(
  db: pg.PoolClient,
  store: WorldStore,
  applications: PlayApplications,
  world: string,
  w: { id: string; at: number },
  actor: string,
  input: StorageAction,
) {
  const context = store.context(w.id),
    request = input.requestId;
  const finish = async (receipt: Receipt) => {
    await notifyPickup(db, applications, world, receipt);
    return {
      ...receipt.storageEffect,
      at: receipt.committedAt,
      commitId: receipt.commitId,
    };
  };
  const prior = await store.receipt(w.id, request);
  if (prior?.storageEffect) return finish(prior);
  const [here] = await directPlaces(context, actor);
  const read = async (query: string, params: Record<string, unknown> = {}) =>
    (
      await store.driver.executeQuery(
        query,
        { world: w.id, actor, ...params },
        { routing: "READ" },
      )
    ).records;
  if (input.command === "storage-list") {
    if (!here) return page([]);
    const rows = await read(
      "MATCH(n:InstalledStorage {worldId:$world,place:$here}) WHERE n.id>$after RETURN n.id AS id,n.data AS data,n.manager AS manager,n.policy AS policy ORDER BY n.id LIMIT 21",
      { here, after: input.after ?? "" },
    );
    return page(
      rows.map((r) => ({
        id: r.get("id") as string,
        label: JSON.parse(r.get("data")).text,
        managerId: r.get("manager"),
        installation: JSON.parse(r.get("policy")),
      })),
    );
  }
  const storageId = input.storageId,
    site = await context.installation(storageId);
  if (!site) return reject("設置済みの保管先を指定してください");
  if (input.command === "storage-history") {
    // 宛先と依頼者それぞれの索引から1ページを読み、当事者本人の履歴だけを返す。
    const rows = await read(
      `CALL () {
      MATCH(r:WorldPickup {worldId:$world,storageId:$storageId,sender:$actor}) WHERE r.commitId>$after RETURN r ORDER BY r.commitId LIMIT 21
      UNION
      MATCH(r:WorldPickup {worldId:$world,storageId:$storageId,receiver:$actor}) WHERE r.commitId>$after RETURN r ORDER BY r.commitId LIMIT 21
    } RETURN r.commitId AS id,r.pickup AS data ORDER BY id LIMIT 21`,
      { storageId, after: input.after ?? "" },
    );
    return page(
      rows.map((r) => ({
        id: r.get("id") as string,
        ...JSON.parse(r.get("data")),
      })),
    );
  }
  if (input.command === "storage-relocate") {
    const plan = await planRelocation(
      db,
      world,
      context,
      actor,
      storageId,
      input.placeId,
      w.at,
      request,
    );
    const scope = directChangeScope(plan.changes);
    return finish(
      await commitPlayChange(
        store,
        await store.claim(w.id, request),
        context,
        { commitId: request, ...plan, playerAction: true },
        scope,
        true,
      ),
    );
  }
  if (
    here !== site.place ||
    !(await directPlaces(context, storageId)).includes(site.place)
  )
    return reject("保管先の現在の設置場所に移動してください");
  if (input.command === "storage-offers") {
    const rows = await read(
      `CALL () {
      MATCH(r:WorldItemReservation {worldId:$world,storageId:$storageId,recipient:'public'}) WHERE r.id>$after RETURN r ORDER BY r.id LIMIT 21
      UNION
      MATCH(r:WorldItemReservation {worldId:$world,storageId:$storageId,recipient:$actor}) WHERE r.id>$after RETURN r ORDER BY r.id LIMIT 21
      UNION
      MATCH(r:WorldItemReservation {worldId:$world,storageId:$storageId,sender:$actor}) WHERE r.id>$after RETURN r ORDER BY r.id LIMIT 21
    } RETURN r.id AS id,r.itemId AS itemId,r.label AS label,r.recipient AS recipient,r.sender AS sender,r.quantity AS qty ORDER BY id LIMIT 21`,
      { storageId, after: input.after ?? "" },
    );
    return page(
      rows.map((r) => ({
        id: r.get("id") as string,
        itemId: r.get("itemId"),
        label: r.get("label"),
        count: Number(r.get("qty")),
        senderId: r.get("sender"),
        recipientId:
          r.get("recipient") === "public" ? null : r.get("recipient"),
      })),
    );
  }

  let changes: Change = { nodes: [], edges: [], endEdges: [], revisions: [] };
  let scope = directChangeScope(changes);
  let at = w.at;
  let effect: StorageEffect;
  const reservations: ItemReservations = { release: [] };
  if (input.command === "storage-post") {
    if (actor !== site.manager)
      return reject("この保管先の管理者が掲示してください");
    const item = await context.node(input.itemId);
    if (
      item?.kind !== "existence" ||
      !(
        await context.relations(
          input.itemId,
          "has",
          "in",
          Number.MAX_SAFE_INTEGER,
        )
      ).some((e) => !e.role && e.source === storageId)
    )
      return reject("保管先にある実物を指定してください");
    await context.assertMovable(item.id);
    const total = input.allocations.reduce((sum, r) => sum + r.count, 0);
    if (total > (item.count ?? 1) - (await context.reserved(item.id)))
      return reject("取り置き可能な個数を超えています");
    const recipients = new Set<string>();
    for (const entry of input.allocations) {
      if (
        !site.policy.pickup.includes(entry.recipientId ? "addressed" : "public")
      )
        return reject("この保管先で許可された受領対象を選んでください");
      if (entry.recipientId) recipients.add(entry.recipientId);
    }
    if (
      recipients.size &&
      (
        await db.query(
          "SELECT actor_id FROM world_controlled_actor WHERE world_id=$1 AND actor_id=ANY($2::uuid[])",
          [w.id, [...recipients]],
        )
      ).rowCount !== recipients.size
    )
      return reject("同じ世界で操作される人物を受取人に指定してください");
    reservations.allocations = input.allocations.map((slot, i) => ({
      id: derivedId(request + ":allocation:" + i),
      itemId: item.id,
      count: slot.count,
      storageId,
      sender: actor,
      recipient: slot.recipientId ?? "public",
      label: item.text,
    }));
    effect = {
      type: "post",
      storageId,
      allocationIds: reservations.allocations.map((e) => e.id),
    };
  } else {
    const withdrawing = input.command === "storage-withdraw";
    const row = (
      await read(
        `MATCH(r:WorldItemReservation {worldId:$world,id:$id,storageId:$storageId})
      WHERE CASE WHEN $withdraw THEN r.sender=$actor ELSE r.recipient IN ['public',$actor] END
      RETURN r.itemId AS itemId,r.quantity AS qty,r.sender AS sender,r.recipient AS recipient,r.label AS label`,
        { id: input.allocationId, storageId, withdraw: withdrawing },
      )
    )[0];
    if (!row) return reject("利用できる受け渡し枠を指定してください");
    const slot: PickupAllocation = {
      id: input.allocationId,
      itemId: row.get("itemId"),
      storageId,
      count: Number(row.get("qty")),
      sender: row.get("sender"),
      recipient: row.get("recipient"),
      label: row.get("label"),
    };
    // 個数変更と予約更新で共用する依存版。
    await context.reserved(slot.itemId);
    reservations.release.push(slot.id);
    if (withdrawing) {
      effect = { type: "withdraw", storageId, allocationId: slot.id };
    } else {
      if (input.count > slot.count) return reject("枠の残数を超えています");
      const item = await context.node(slot.itemId);
      if (item?.kind !== "existence" || item.text !== slot.label)
        return reject("品の状態が変わりました");
      await context.assertMovable(slot.itemId);
      const operations: BelongingOp[] = [
        {
          type: "move",
          item: slot.itemId,
          from: storageId,
          to: actor,
          ...(item.count ? { count: input.count } : {}),
          basis: "現地での無償受領",
        },
      ];
      const plan = await planBelongings(context, request, at, operations);
      scope = directChangeScope(plan.changes);
      await checkBelongingCapacity(
        context,
        request,
        plan.at,
        plan.changes,
        operations,
      );
      changes = plan.changes;
      at = plan.at;
      const remaining = slot.count - input.count;
      if (remaining) reservations.allocations = [{ ...slot, count: remaining }];
      effect = {
        type: "claim",
        storageId,
        allocationId: slot.id,
        sender: slot.sender,
        receiver: actor,
        itemId: item.id,
        label: slot.label,
        count: input.count,
        remaining,
      };
    }
  }
  const receipt = await commitPlayChange(
    store,
    await store.claim(w.id, request),
    context,
    {
      commitId: request,
      at,
      changes,
      playerAction: true,
      storageEffect: effect,
    },
    scope,
    true,
    reservations,
  );
  return finish(receipt);
}
