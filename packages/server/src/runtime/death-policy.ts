import type { Change } from "@gestaloka/contracts";
import type pg from "pg";
import { directPlaces } from "../world/locations.js";
import { derivedId, respawnHome } from "../world/model.js";
import {
  WorldConflict,
  spUseProhibition,
  type WorldContext,
  type WorldStore,
} from "../world/store.js";

export const permanentDeath = "permanent-death";
const deathEdgeId = (actor: string) => derivedId(`${permanentDeath}:${actor}`);

export type RespawnHome = { placeId: string; name: string };

async function homeRecords(context: WorldContext, actor: string) {
  return Promise.all(
    (await context.marked(actor, "status", respawnHome)).map(async (edge) => ({
      edge,
      about: (
        await context.relations(
          edge.target,
          "status",
          "out",
          Number.MAX_SAFE_INTEGER,
        )
      ).filter((relation) => relation.role === "about"),
    })),
  );
}

export async function respawnHomePlace(context: WorldContext, actor: string) {
  const [record] = await homeRecords(context, actor);
  const target = record?.about.find((edge) => edge.text === "direct-place");
  const place = target && (await context.node(target.target));
  return place?.kind === "existence" ? place : undefined;
}

export async function setRespawnHome(
  store: WorldStore,
  context: WorldContext,
  actor: string,
  request: string,
  at: number,
): Promise<RespawnHome | undefined> {
  const script = derivedId(`${request}:${respawnHome}`);
  const prior = await store.receipt(context.worldId, request);
  if (prior) {
    const node = prior.changes.nodes.find((entry) => entry.id === script);
    const place = prior.changes.edges.find((edge) => edge.source === script);
    if (!node || !place)
      throw new WorldConflict("同じ要求IDに異なる内容は使用できません");
    return { placeId: place.target, name: node.text };
  }

  const [placeId] = await directPlaces(context, actor);
  const place = placeId && (await context.node(placeId));
  if (!place || place.kind !== "existence") return;
  const records = await homeRecords(context, actor);
  const period = { from: at };
  await store.commit(await store.claim(context.worldId, request), context, {
    commitId: request,
    at,
    respawnHomeActor: actor,
    changes: {
      nodes: [{ id: script, kind: "script", text: place.text, viewers: [] }],
      endEdges: records.flatMap(({ edge, about }) => [
        edge.id,
        ...about.map((relation) => relation.id),
      ]),
      edges: [
        {
          id: derivedId(`${script}:content`),
          kind: "status",
          role: "content",
          text: respawnHome,
          source: actor,
          target: script,
          period,
        },
        {
          id: derivedId(`${script}:about`),
          kind: "status",
          role: "about",
          text: "direct-place",
          source: script,
          target: place.id,
          period,
        },
      ],
    },
  });
  return { placeId: place.id, name: place.text };
}

export async function respawnPolicy(
  db: Pick<pg.Pool, "query">,
  worldId: string,
  actorIds: readonly string[] = [],
) {
  const { respawn_enabled, death_place_id, disabled_actor_ids } = (
    await db.query<{
      respawn_enabled: boolean;
      death_place_id: string | null;
      disabled_actor_ids: string[];
    }>(
      `SELECT c.respawn_enabled,c.death_place_id,ARRAY(
        SELECT actor_id FROM world_join
        WHERE construction_id=c.id AND respawn_disabled AND actor_id=ANY($2::uuid[])
        UNION
        SELECT actor_id FROM world_controlled_actor
        WHERE world_id=c.world_id AND respawn_disabled AND actor_id=ANY($2::uuid[])
      ) AS disabled_actor_ids FROM world_construction c WHERE c.id=$1`,
      [worldId, actorIds],
    )
  ).rows[0]!;
  return respawn_enabled
    ? {
        placeId: death_place_id,
        ...(actorIds.length && { disabledActorIds: disabled_actor_ids }),
      }
    : null;
}

export async function isPermanentlyDead(context: WorldContext, actor: string) {
  const edge = await context.edge(deathEdgeId(actor));
  return (
    edge?.kind === "status" &&
    edge.role === "content" &&
    edge.source === actor &&
    edge.text === permanentDeath &&
    edge.period.until === undefined
  );
}

export function recordPermanentDeath(
  change: Change,
  actor: string,
  at: number,
) {
  const script = derivedId(`${permanentDeath}:${actor}:script`);
  change.nodes.push({ id: script, kind: "script", text: "死亡している。" });
  change.edges.push({
    id: deathEdgeId(actor),
    kind: "status",
    role: "content",
    source: actor,
    target: script,
    text: permanentDeath,
    period: { from: at },
  });
}

export function recordDeathSpProhibition(
  change: Change,
  request: string,
  players: readonly string[],
  at: number,
) {
  const seconds = Number(process.env.DEATH_SP_LOCK_SECONDS?.trim() || 43_200);
  const until = at + seconds * 1000;
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    !Number.isFinite(new Date(until).getTime())
  )
    throw new Error("DEATH_SP_LOCK_SECONDS に有効な秒数を指定してください");
  if (!seconds) return [];
  return players.map((player) => {
    const script = derivedId(`${request}:${player}:${spUseProhibition}`);
    const id = derivedId(`${script}:content`);
    change.nodes.push({ id: script, kind: "script", text: "SP使用禁止" });
    change.edges.push({
      id,
      kind: "status",
      role: "content",
      source: player,
      target: script,
      text: spUseProhibition,
      period: { from: at, until },
    });
    return id;
  });
}
