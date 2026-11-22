import { z } from "zod";
import { visibleTo } from "../world/belongings.js";
import { directPlaces } from "../world/locations.js";
import { derivedId } from "../world/model.js";
import type { WorldContext } from "../world/store.js";
import { groundPlacement } from "./search-appearances.js";

const latest = Number.MAX_SAFE_INTEGER;
const text = z.string().trim().min(1);

export const DrawReview = z
  .object({ accepted: z.boolean(), reason: text })
  .strict();
export const DrawReward = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item"), label: text }).strict(),
  z.object({ kind: z.literal("skill"), text }).strict(),
]);

export const drawScriptId = (target: string) =>
  derivedId(`${target}:draw-source`);
export const drawEdgeId = (target: string) =>
  derivedId(`${target}:draw-source:content`);

export async function drawSource(context: WorldContext, target: string) {
  const edge = await context.edge(drawEdgeId(target));
  if (
    edge?.kind !== "status" ||
    edge.role !== "content" ||
    edge.source !== target ||
    edge.target !== drawScriptId(target) ||
    edge.period.until !== undefined
  )
    return;
  const script = await context.node(edge.target);
  if (script?.kind === "script" && script.type === "draw-source") return script;
}

export async function drawInReach(
  context: WorldContext,
  actor: string,
  target: string,
) {
  if (target === actor) return false;
  const places = await directPlaces(context, actor);
  if (places.includes(target)) return true;

  const holder = (await context.relations(target, "has", "in", latest)).find(
    (edge) => !edge.role,
  )?.source;
  if (holder === actor) return true;
  if (!places.length || !visibleTo(await context.node(target), actor, true))
    return false;
  if (holder) {
    return (
      places.includes(holder) &&
      !(await context.relations(holder, "has", "in", latest)).some(
        (edge) => edge.role === "use",
      ) &&
      !(await context.installation(holder))
    );
  }
  const installed = await context.installation(target);
  if (installed) return places.includes(installed.place);
  if (
    (await directPlaces(context, target)).some((place) =>
      places.includes(place),
    )
  )
    return true;
  for (const placement of await groundPlacement(context, target))
    if (
      (await context.relations(placement.source, "status", "in", latest)).some(
        (edge) =>
          edge.role === "content" &&
          edge.text === "ground" &&
          places.includes(edge.source),
      )
    )
      return true;
  return false;
}
