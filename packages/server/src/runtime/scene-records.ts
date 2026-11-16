import { z } from "zod";
import type { ReceivedContact } from "./player-contact.js";
import type { RecordedSceneEvent, SceneIntent } from "./scene-data.js";

export const SceneRecordQuery = z
  .object({
    kind: z.literal("scene-records"),
    source: z.enum(["history", "contacts"]),
    id: z.uuid().optional(),
    actorId: z.uuid().optional(),
    observerId: z.uuid().optional(),
    inputId: z.uuid().optional(),
    text: z.string().min(1).optional(),
    from: z.number().int().nonnegative().safe().optional(),
    through: z.number().int().nonnegative().safe().optional(),
    offset: z.number().int().nonnegative().safe().default(0),
  })
  .strict();
export type SceneRecords = {
  history: RecordedSceneEvent[];
  contacts: ReceivedContact[];
};
type Input = {
  initialContext?:
    | {
        request: { kind: string; id?: string };
        result: unknown;
      }[]
    | undefined;
  request: {
    [key: string]: unknown;
    controlledActorId: string;
    controlledInputId: string;
    controlledInputs?: { id: string }[];
    intentions: SceneIntent[];
    reactionTo?: {
      inputId: string;
      seenEventIds: Record<string, string[]>;
    } | null;
  };
};

/** Only the prompt is selected; original records remain available to the resolver. */
export function scenePlayContext<T extends Input>(
  input: T,
  records: SceneRecords,
) {
  const { request } = input,
    actors = new Set([
      request.controlledActorId,
      ...request.intentions.map((i) => i.actorId),
    ]),
    inputs = new Set([
      request.controlledInputId,
      ...(request.controlledInputs ?? []).map((i) => i.id),
      ...request.intentions.flatMap((i) => (i.inputId ? [i.inputId] : [])),
      ...(request.reactionTo ? [request.reactionTo.inputId] : []),
    ]),
    latestEvent = new Map(records.history.map((e) => [e.actorId, e.id])),
    origins = new Set(request.intentions.map((i) => i.originEventId)),
    unlinked = new Set(
      request.intentions
        .filter((i) => i.continuing && !i.originEventId && !i.inputId)
        .map((i) => i.actorId),
    ),
    latestContact = new Map(
      records.contacts.map((r) => [`${r.listener}:${r.speaker}`, r.at]),
    );
  return {
    ...input,
    initialContext: input.initialContext?.filter(
      (entry) => entry.request.kind === "node",
    ),
    sceneHistory: records.history
      .filter(
        (e) =>
          latestEvent.get(e.actorId) === e.id ||
          origins.has(e.id) ||
          unlinked.has(e.actorId) ||
          (e.inputId && inputs.has(e.inputId)),
      )
      .map(({ id, actorId, inputId, text, period, locations, receipts }) => ({
        id,
        actorId,
        inputId,
        text,
        period,
        locations,
        receipts: receipts.map((r) => ({
          observerId: r.observerId,
          at: r.at,
          ...(actors.has(r.observerId) ? { text: r.text } : {}),
        })),
      })),
    receivedContacts: records.contacts.filter(
      (r) =>
        latestContact.get(`${r.listener}:${r.speaker}`) === r.at ||
        (r.replyInputId && inputs.has(r.replyInputId)),
    ),
    availableRecords: {
      history: {
        count: records.history.length,
        actorIds: [...latestEvent.keys()],
      },
      contacts: {
        count: records.contacts.length,
        actorIds: [...new Set(records.contacts.map((r) => r.speaker))],
      },
    },
  };
}

/** Search the frozen, unmodified source, newest first; next is not a result cap. */
export function readSceneRecords(
  records: SceneRecords,
  query: z.infer<typeof SceneRecordQuery>,
) {
  const normalized = (s: string) => s.normalize("NFKC").toLowerCase(),
    terms = query.text ? normalized(query.text).split(/\s+/u) : [],
    matches = [...records[query.source]].reverse().filter((record) => {
      const event = "period" in record,
        id = event ? record.id : record.eventId,
        actor = event ? record.actorId : record.speaker,
        at = event ? record.period.from : record.at,
        input = event ? record.inputId : record.replyInputId,
        text = event
          ? [record.text, ...record.receipts.map((r) => r.text)].join("\n")
          : record.text;
      return (
        (!query.id || id === query.id) &&
        (!query.actorId || actor === query.actorId) &&
        (!query.observerId ||
          (event
            ? record.receipts.some((r) => r.observerId === query.observerId)
            : record.listener === query.observerId)) &&
        (!query.inputId || input === query.inputId) &&
        (query.from === undefined || at >= query.from) &&
        (query.through === undefined || at <= query.through) &&
        terms.every((term) => normalized(text).includes(term))
      );
    }),
    end = query.offset + 12;
  return {
    items: matches.slice(query.offset, end),
    next: end < matches.length ? end : null,
    total: matches.length,
  };
}
