import { z } from "zod";
import type { ChatMessage } from "../llm/client.js";
import { Query } from "./agent.js";
import { SceneRecordQuery } from "./scene-records.js";
import { SceneContext, SceneStep } from "./scene-data.js";

export const SceneQueries = z
  .object({
    type: z.literal("query"),
    requests: z.array(z.union([Query, SceneRecordQuery])).min(1),
  })
  .strict();

/** Bound references to records supplied to this work; queries can extend them. */
export function sceneDecision(
  intentions: { actorId: string }[],
  conclusion?: boolean,
  messages: ChatMessage[] = [],
) {
  const events = new Set<string>(),
    observers = new Set(intentions.map((i) => i.actorId));
  let actor: string | undefined,
    leaving: string[] = [];
  const nodes = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(nodes);
    else if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      if (v.kind === "existence" && typeof v.id === "string")
        observers.add(v.id);
      Object.values(v).forEach(nodes);
    }
  };
  const history = (
    items: {
      id: string;
      actorId: string;
      receipts: { observerId: string }[];
    }[],
  ) => {
    for (const event of items) {
      events.add(event.id);
      observers.add(event.actorId);
      event.receipts.forEach((r) => observers.add(r.observerId));
    }
  };
  for (const message of messages) {
    if (message.role !== "user") continue;
    let value;
    try {
      value = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!value || typeof value !== "object") continue;
    actor ??= value.request?.controlledActorId;
    if (value.request) leaving = value.request.leavingActorIds ?? [];
    (value.background?.participants ?? []).forEach((id: string) =>
      observers.add(id),
    );
    (value.otherPlayers ?? []).forEach((p: { actorId: string }) =>
      observers.add(p.actorId),
    );
    (value.receivedContacts ?? []).forEach(
      (r: { speaker: string; listener: string }) => {
        observers.add(r.speaker);
        observers.add(r.listener);
      },
    );
    history(value.sceneHistory ?? []);
    nodes(value.initialContext);
    nodes(value.results);
    (value.requests ?? []).forEach(
      (q: { kind: string; source?: string }, i: number) => {
        if (q.kind === "scene-records" && q.source === "history")
          history(value.results[i].items);
      },
    );
  }
  if (actor) observers.add(actor);
  const step = SceneStep.options[0],
    [action, arrival] = step.shape.events.element.options;
  const receiverIds = [...observers],
    arrivalIds = receiverIds.filter((id) => id !== actor);
  const actionSchema = action.safeExtend({
    actorId: intentions.length
      ? z.enum(intentions.map((i) => i.actorId))
      : action.shape.actorId,
    receipts: receiverIds.length
      ? z.array(
          action.shape.receipts.element.extend({
            observerId: z.enum(receiverIds),
          }),
        )
      : action.shape.receipts,
  });
  const event =
    events.size && arrivalIds.length
      ? z.union([
          actionSchema,
          arrival.extend({
            eventId: z.enum([...events]),
            receipts: z
              .array(
                arrival.shape.receipts.element.extend({
                  observerId: z.enum(arrivalIds),
                }),
              )
              .min(1),
          }),
        ])
      : actionSchema;
  const output = step.extend({
    events: z.array(event).min(1),
    decisions: z.strictObject(
      Object.fromEntries(
        intentions.map(({ actorId }) => [
          actorId,
          step.shape.decisions.valueType,
        ]),
      ),
    ),
    ...(conclusion === undefined ? {} : { concluded: z.literal(conclusion) }),
    ...(leaving.length
      ? {
          departures: z.array(
            step.shape.departures
              .unwrap()
              .element.extend({ actorId: z.enum(leaving) }),
          ),
        }
      : {}),
  });
  const scene = leaving.length ? output : output.omit({ departures: true });
  const contexts = (
    ["facts", "beliefs", "creations", "participants"] as const
  ).map((key) => {
    const field = SceneContext.shape[key];
    return SceneContext.extend({
      [key]: (field instanceof z.ZodDefault ? field.unwrap() : field).min(1),
    });
  });
  return z.union([
    scene,
    ...(conclusion === undefined ? contexts : []),
    SceneQueries,
  ]);
}
