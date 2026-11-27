import type pg from "pg";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { WorldGraphQuery, Change } from "@gestaloka/contracts";
import { WorldStore, WorldConflict } from "../world/store.js";
import { inventoryAudit, SkillCapacityExceeded } from "../world/inventory.js";
import { atTime, inGeneration, worldNow } from "../world/model.js";
import { AccessError } from "./access.js";
import type { WorldPlayers } from "../runtime/players.js";
export class WorldManagement {
  readonly store: WorldStore;
  constructor(players: WorldPlayers) {
    this.store = players.construction.agent.store;
  }
  async world(db: Pick<pg.Pool, "query">, id: string) {
    const r = (
      await db.query(
        "SELECT world_id,at,state FROM world_construction WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!r?.world_id)
      throw new AccessError(
        404,
        "WORLD_NOT_FOUND",
        "確定した世界が見つかりません",
      );
    return {
      id: r.world_id as string,
      at: Number(r.at),
      state: r.state as string,
    };
  }
  async read(
    db: Pick<pg.Pool, "query">,
    id: string,
    q: z.infer<typeof WorldGraphQuery>,
  ) {
    const world = await this.world(db, id),
      context = this.store.context(world.id);
    if (q.kind === "node")
      return {
        worldId: id,
        graphWorldId: world.id,
        node: (await context.node(q.id, q.at)) ?? null,
        dependencies: context.dependencies,
      };
    if (q.kind === "edge")
      return {
        edge: (await context.edge(q.id)) ?? null,
        dependencies: context.dependencies,
      };
    const graph = this.store.driver;
    if (q.kind === "inventory") {
      const { rows } = await db.query<{ actor_id: string }>(
        "SELECT actor_id FROM world_controlled_actor WHERE world_id=$1 UNION SELECT actor_id FROM bot_npc WHERE world_id=$2",
        [world.id, id],
      );
      const pending = await db.query(
        `SELECT count(*)::int AS count FROM blueprint_quest
         WHERE world=$1 AND NOT (data ? 'storageLimitSlots')
         AND (data->>'phase'='build' OR (data->>'phase'='craft' AND data->'template'->'installation' IS NOT NULL))`,
        [id],
      );
      const session = graph.session();
      try {
        return {
          ...(await session.executeRead((tx) =>
            inventoryAudit(
              tx,
              world.id,
              rows.map((r) => r.actor_id),
              q.minCount,
              q.standard ?? false,
            ),
          )),
          pendingLegacyStorages: pending.rows[0].count,
        };
      } finally {
        await session.close();
      }
    }
    if (q.kind === "nodes") {
      const r = await graph.executeQuery(
        "MATCH(n:WorldNode {worldId:$world}) WHERE n.skillSummaryUntil IS NULL AND ($after IS NULL OR n.id>$after) RETURN n.id AS id ORDER BY id LIMIT 51",
        { world: world.id, after: q.after ?? null },
      );
      const ids = r.records.map((r) => r.get("id") as string),
        items = [];
      for (const id of ids.slice(0, 50)) items.push(await context.node(id));
      return {
        items,
        dependencies: context.dependencies,
        next: ids.length > 50 ? ids[49] : null,
      };
    }
    if (q.kind === "receipts") {
      const r = await graph.executeQuery(
        "MATCH(r:WorldReceipt {worldId:$world}) WHERE $after IS NULL OR r.commitId>$after RETURN r.commitId AS id,r.data AS data ORDER BY id LIMIT 51",
        { world: world.id, after: q.after ?? null },
      );
      return {
        items: r.records.slice(0, 50).map((r) => JSON.parse(r.get("data"))),
        next: r.records.length > 50 ? r.records[49]!.get("id") : null,
      };
    }
    const items =
      q.kind === "relations"
        ? await context.relations(
            q.id,
            q.relation,
            q.direction,
            q.at,
            q.through ?? q.at,
            { after: q.after, limit: 51 },
          )
        : await context.history(
            q.id,
            q.relation,
            q.direction,
            q.through,
            q.from,
            { after: q.after, limit: 51 },
          );
    return {
      items: items.slice(0, 50),
      dependencies: context.dependencies,
      next:
        items.length > 50
          ? q.kind === "relations"
            ? items[49]!.id
            : { from: items[49]!.period.from, id: items[49]!.id }
          : null,
    };
  }
  async edit(
    db: pg.PoolClient,
    actor: string,
    id: string,
    requestId: string,
    input: {
      at: number;
      dependencies: { key: string; version: number }[];
      changes: unknown;
      reason: string;
    },
  ) {
    const world = await this.world(db, id),
      management = {
        editorId: actor,
        reason: input.reason,
        requestHash: createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex"),
      };
    const prior = await this.store.receipt(world.id, requestId);
    // 生成を終えた世界はプレイ中なので、送られた時点ではなく確定の時刻で記録する。
    const live = !inGeneration(world.state),
      at = live ? worldNow(world) : input.at;
    // Receipts are checked before dependency/time validation on a retransmission.
    if (!prior && !live && input.at < world.at)
      throw new AccessError(
        409,
        "WORLD_TIME_CHANGED",
        "現在以降の時点で改訂し、共有済みの履歴を保持してください",
      );
    const parsed = Change.parse(input.changes),
      changes = live ? atTime(parsed, at) : parsed,
      basis = new Set(input.dependencies.map((d) => d.key));
    if (
      new Set(input.dependencies.map((d) => d.key)).size !==
        input.dependencies.length ||
      changes.revisions.some((n) => !basis.has(`node:${n.id}`)) ||
      changes.endEdges.some((id) => !basis.has(`edge:${id}`))
    )
      throw new AccessError(
        409,
        "WORLD_BASIS_REQUIRED",
        "改訂するノード・終了する関係を読み取り、その依存版を指定してください",
      );
    if (
      !prior &&
      (changes.edges.some((e) => e.period.from < at) ||
        changes.nodes.some((n) => n.kind === "event" && n.period.from < at))
    )
      throw new AccessError(
        409,
        "WORLD_HISTORY_REQUIRED",
        "新しい関係と出来事は改訂時点以降に成立させてください",
      );
    try {
      const receipt = await this.store.commit(
        await this.store.claim(world.id, requestId),
        this.store.context(world.id, input.dependencies),
        {
          commitId: requestId,
          at,
          changes,
          management,
        },
      );
      return { worldId: id, ...receipt };
    } catch (error) {
      if (error instanceof SkillCapacityExceeded)
        throw new AccessError(409, error.code, error.message, undefined, error);
      if (error instanceof WorldConflict)
        throw new AccessError(409, "WORLD_CHANGED", error.message);
      if (error instanceof Error && error.constructor === Error)
        throw new AccessError(409, "WORLD_EDIT_REJECTED", error.message);
      throw error;
    }
  }
}
