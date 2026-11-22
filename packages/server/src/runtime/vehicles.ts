import type pg from "pg";
import { AccessError } from "../http/access.js";
import type { BelongingOp } from "../world/belongings.js";
import { directPlaces } from "../world/locations.js";
import { derivedId, type Change } from "../world/model.js";
import type { WorldContext } from "../world/store.js";

type Db = Pick<pg.Pool, "query">;
export type Locate = Extract<BelongingOp, { type: "locate" }>;
export const latest = Number.MAX_SAFE_INTEGER;
export const vehiclePageSize = 20;
export const destinationOf = (op: Locate) =>
  op.directPlaceId ?? (op.aboutIds.length === 1 ? op.aboutIds[0] : undefined);

export function vehicleError(code: string, message: string): never {
  throw new AccessError(409, code, message);
}

export async function isVehicle(context: WorldContext, id: string) {
  return (await context.marked(id, "status", "vehicle")).length > 0;
}

export async function vehicleOperator(
  context: Pick<WorldContext, "marked" | "relations">,
  vehicleId: string,
) {
  const [edge] = await context.marked(vehicleId, "status", "operator");
  if (!edge) return undefined;
  const about = (
    await context.relations(edge.target, "status", "out", latest)
  ).filter((relation) => relation.role === "about");
  return (
    about[0] && {
      actorId: about[0].target,
      edges: [edge.id, ...about.map((a) => a.id)],
    }
  );
}

export function assignOperator(
  changes: Change,
  request: string,
  at: number,
  vehicleId: string,
  actorId: string,
) {
  const script = derivedId(`${request}:operator`);
  changes.nodes.push({ id: script, kind: "script", text: "専用の操縦権" });
  changes.edges.push(
    {
      id: derivedId(`${script}:content`),
      kind: "status",
      role: "content",
      text: "operator",
      source: vehicleId,
      target: script,
      period: { from: at },
    },
    {
      id: derivedId(`${script}:about`),
      kind: "status",
      role: "about",
      source: script,
      target: actorId,
      period: { from: at },
    },
  );
}

export async function vehiclePosition(
  context: WorldContext,
  vehicleId: string,
) {
  const holding = await context.holding(vehicleId);
  const containers: string[] = [];
  if (holding) {
    let current = holding;
    for (;;) {
      if (current.source === vehicleId || containers.includes(current.source))
        vehicleError(
          "LOCATION_CYCLE",
          "所持先が循環しているため所在地を確認できません",
        );
      containers.push(current.source);
      const next = await context.holding(current.source);
      if (!next) break;
      current = next;
    }
  }
  const root = containers.at(-1);
  const [location] = await directPlaces(context, root ?? vehicleId);
  return { holding, containers, root, placeId: location ?? root };
}

export async function ride(context: WorldContext, actor: string) {
  const [vehicleId] = await directPlaces(context, actor);
  if (!vehicleId || !(await isVehicle(context, vehicleId))) return undefined;
  const { placeId } = await vehiclePosition(context, vehicleId);
  return { vehicleId, directPlaceId: vehicleId, outerPlaceId: placeId ?? null };
}

export async function vehicleNpc(db: Db, world: string, id: string) {
  const { rows } = await db.query<{ controller: string | null }>(
    "SELECT controller FROM bot_npc WHERE world_id=$1 AND actor_id=$2",
    [world, id],
  );
  return rows[0];
}

export async function holdingActor(
  db: Db,
  world: string,
  context: WorldContext,
  actor: string,
  position: Awaited<ReturnType<typeof vehiclePosition>>,
) {
  for (const id of position.containers) {
    const access = await context.storageAccess(id, actor);
    if (access.registered) {
      if (!access.allowed)
        vehicleError(
          "STORAGE_NOT_REGISTERED",
          "乗り物を取り出せる保管先を指定してください",
        );
      return actor;
    }
  }
  const { root } = position;
  if (!root) return undefined;
  if (root === actor || (await vehicleNpc(db, world, root))) return root;
  const { rowCount } = await db.query(
    "SELECT 1 FROM world_controlled_actor WHERE world_id=$1 AND actor_id=$2",
    [context.worldId, root],
  );
  return rowCount ? root : undefined;
}

export function requireVehicleHere(
  place: string | null | undefined,
  vehiclePlace: string | undefined,
) {
  if (!vehiclePlace || place !== vehiclePlace)
    vehicleError("VEHICLE_NOT_HERE", "乗り物と同じ場所で操作してください");
}

export async function checkRoute(
  context: WorldContext,
  mover: string,
  from: string | undefined,
  to: string | undefined,
) {
  if (!from || !to || from === to) return;
  const required = (
    await Promise.all(
      (await context.routesBetween(from, to)).map((route) =>
        context.relations(route, "status", "out", latest),
      ),
    )
  )
    .flat()
    .filter((e) => e.role === "about" && e.text === "route-requires");
  if (!required.length) return;
  const capabilities = (
    await Promise.all(
      (await context.marked(mover, "status", "capability")).map((edge) =>
        context.relations(edge.target, "status", "out", latest),
      ),
    )
  ).flat();
  const has = new Set(
    capabilities.filter((e) => e.role === "about").map((e) => e.target),
  );
  if (required.some((e) => !has.has(e.target)))
    vehicleError(
      "ROUTE_REQUIREMENT_UNMET",
      "この区間を通るための能力が足りません",
    );
}

function arrival(subjectId: string, placeId: string, text: string): Locate {
  return { type: "locate", subjectId, aboutIds: [placeId], text };
}

export function vehicleLocate(
  actor: string,
  vehicleId: string,
  destinationId?: string,
) {
  return arrival(
    destinationId ? vehicleId : actor,
    destinationId ?? vehicleId,
    destinationId ? "乗り物で移動する" : "乗り物に乗る",
  );
}

export async function checkVehicleTravel(
  db: Db,
  world: string,
  context: WorldContext,
  actor: string,
  vehicleId: string,
  to: string,
) {
  const { rows } = await db.query<{ actor_id: string }>(
    "SELECT actor_id FROM bot_companion WHERE world_id=$1 AND npc_id=$2",
    [world, vehicleId],
  );
  const selfDriving =
    actor === vehicleId && (await vehicleNpc(db, world, vehicleId));
  if (
    !selfDriving &&
    rows[0]?.actor_id !== actor &&
    ((await vehicleOperator(context, vehicleId))?.actorId !== actor ||
      !(await directPlaces(context, actor)).includes(vehicleId))
  )
    vehicleError(
      "VEHICLE_CONTROL_REQUIRED",
      "操縦権を持って乗車するか、同行中の乗り物を指定してください",
    );
  const { placeId, holding } = await vehiclePosition(context, vehicleId);
  if (holding)
    vehicleError("VEHICLE_NOT_DEPLOYED", "乗り物を現地に出してください");
  if (!placeId || (await context.node(to))?.kind !== "existence")
    vehicleError("VEHICLE_PLACE_REQUIRED", "現在地と移動先を確認してください");
  await checkLocationCycle(context, vehicleId, to);
  await checkRoute(context, vehicleId, placeId, to);
  return { vehicleId, fromId: placeId, destinationId: to };
}

async function checkLocationCycle(
  context: WorldContext,
  subject: string,
  to: string,
) {
  const seen = new Set([subject]);
  let place: string | undefined = to;
  while (place) {
    if (seen.has(place))
      vehicleError("LOCATION_CYCLE", "所在が自分自身を指す移動はできません");
    seen.add(place);
    [place] = await directPlaces(context, place);
  }
}

export async function checkLocation(
  db: Db,
  world: string,
  context: WorldContext,
  actor: string,
  op: Locate,
): Promise<{
  travel?: Awaited<ReturnType<typeof checkVehicleTravel>>;
  board?: { vehicleId: string; directPlaceId: string; outerPlaceId: string };
  leave?: { vehicleId: string; directPlaceId: string };
  deploy?: Locate;
  release?: string;
}> {
  const to = destinationOf(op);
  const [from] = await directPlaces(context, op.subjectId);
  if (await isVehicle(context, op.subjectId)) {
    if (!to) vehicleError("VEHICLE_PLACE_REQUIRED", "移動先を指定してください");
    return {
      travel: await checkVehicleTravel(
        db,
        world,
        context,
        actor,
        op.subjectId,
        to,
      ),
    };
  }
  if (to && (await isVehicle(context, to))) {
    await checkLocationCycle(context, op.subjectId, to);
    const position = await vehiclePosition(context, to);
    if (from !== to) requireVehicleHere(from, position.placeId);
    const holding = position.holding;
    if (holding) {
      const holder = await holdingActor(db, world, context, actor, position);
      if (holder && holder !== actor)
        vehicleError(
          "VEHICLE_NOT_DEPLOYED",
          "所持者が乗り物を現地に出してください",
        );
    }
    return {
      board: {
        vehicleId: to,
        directPlaceId: to,
        outerPlaceId: position.placeId!,
      },
      ...(holding
        ? {
            deploy: arrival(to, position.placeId!, "乗り物を現地に出す"),
            release: holding.id,
          }
        : {}),
    };
  }
  if (from && (await isVehicle(context, from))) {
    const { placeId } = await vehiclePosition(context, from);
    requireVehicleHere(to, placeId);
    return { leave: { vehicleId: from, directPlaceId: placeId! } };
  }
  await checkRoute(context, op.subjectId, from, to);
  return {};
}
