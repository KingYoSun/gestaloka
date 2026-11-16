import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { InformationReference } from "@gestaloka/contracts";
import { Change, WorldEdge, derivedId } from "../world/model.js";
import type { WorldAgent } from "./agent.js";
import type { WorldProposal } from "./agent.js";
import type { Construction } from "./construction.js";
import { randomUUID } from "node:crypto";
import { LocationOp } from "../world/locations.js";

export class SceneResponseError extends Error {}

const id = z.uuid(),
  text = z.string().min(1);
const Fact = z
  .object({
    subjectId: id,
    text,
    aboutIds: z.array(id),
    location: z.boolean().optional(),
    sourceRelationIds: z.array(id).optional(),
    at: z.number().int().nonnegative().safe().optional(),
  })
  .strict();
const Question = z.object({ question: text, targetId: id.nullable() }).strict();
export const SceneBackground = z
  .object({
    type: z.literal("background"),
    synopsis: text,
    synopsisInformation: z.array(InformationReference).optional(),
    participants: z.array(id).min(1),
    facts: z.array(Fact),
    perceptions: z.array(
      z
        .object({ observerId: id, text, sourceIds: z.array(id).min(1) })
        .strict(),
    ),
    unknowns: z.array(z.union([Question, text])),
    creations: z.array(z.object({ id, text }).strict()).default([]),
    beliefs: z.array(Fact.extend({ aboutIds: z.array(id).min(1) })).default([]),
  })
  .strict();
export type SceneBackground = z.infer<typeof SceneBackground>;
export const OpeningBackground = SceneBackground.extend({
  unknowns: z.array(Question),
});
export const SceneContext = SceneBackground.omit({
  synopsis: true,
  synopsisInformation: true,
  perceptions: true,
  unknowns: true,
}).extend({
  type: z.literal("context"),
  participants: z.array(id),
  resolvedUnknowns: z.array(
    z
      .object({ question: text, factIndex: z.number().int().nonnegative() })
      .strict(),
  ),
});
export function remainingQuestions(
  background: SceneBackground,
  context: z.infer<typeof SceneContext>,
  inspected: ReadonlySet<string>,
) {
  return background.unknowns.filter(
    (q) =>
      typeof q === "string" ||
      q.targetId === null ||
      !inspected.has(q.targetId) ||
      !context.resolvedUnknowns.some(
        (r) =>
          r.question === q.question &&
          context.facts[r.factIndex]?.subjectId === q.targetId,
      ),
  );
}
export const ContextNeed = z
  .object({
    evidence: z.enum(["observation", "world"]).default("observation"),
    reason: text,
    remainingActions: z.record(id, z.string()),
  })
  .strict();
export function presentationEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(presentationEvidence);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, presentationEvidence(v)]),
  );
  for (const [body, field] of [
    ["synopsis", "synopsisInformation"],
    ["text", "information"],
  ] as const) {
    if (typeof result[body] !== "string" || !Array.isArray(result[field]))
      continue;
    result[field] = result[field].map((reference: unknown) =>
      reference && typeof reference === "object" && !("evidence" in reference)
        ? { ...reference, evidence: result[body] }
        : reference,
    );
  }
  return result;
}
export const SceneEvent = z
  .object({
    actorId: id,
    text,
    locations: z
      .array(Fact.omit({ sourceRelationIds: true, at: true, location: true }))
      .optional(),
    receipts: z.array(
      z
        .object({
          observerId: id,
          text,
          at: z.number().int().nonnegative().safe().optional(),
          information: z.array(InformationReference).optional(),
        })
        .strict(),
    ),
  })
  .strict();
const Period = z
  .object({
    from: z.number().int().nonnegative().safe(),
    until: z.number().int().nonnegative().safe(),
  })
  .strict();
export type RecordedSceneEvent = z.infer<typeof SceneEvent> & {
  id: string;
  period: z.infer<typeof Period>;
  inputId?: string;
};
const ActionEvent = SceneEvent.extend({
  locations: z.array(LocationOp.omit({ type: true })).min(1),
}).refine((e) => e.locations.some((p) => p.subjectId === e.actorId), {
  path: ["locations"],
  message: "行動主体の結果時点の所在地が必要です",
});
export const SceneStep = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("scene"),
      events: z
        .array(
          z.union([
            ActionEvent,
            z
              .object({
                eventId: id,
                receipts: SceneEvent.shape.receipts.min(1),
              })
              .strict(),
          ]),
        )
        .min(1),
      departures: z
        .array(
          z
            .object({ actorId: id, eventIndex: z.number().int().nonnegative() })
            .strict(),
        )
        .default([]),
      concluded: z.literal(true).optional(),
      decisions: z.record(
        id,
        z.union([
          z.enum(["finished", "decide"]),
          z.object({ pending: text }).strict(),
        ]),
      ),
      elapsedMs: z.number().int().nonnegative().safe().default(0),
      belongings: z
        .array(z.string())
        .optional()
        .describe(
          "今回成立した出来事による物品・保管先・技能の操作。1件を表すJSONを1要素に書く",
        ),
    })
    .strict(),
]);
const LegacyBoundary = z
  .object({ type: z.literal("boundary"), reason: text })
  .strict();

/** Read old, unaccepted model work at the protocol boundary, never as a new output contract. */
export function legacySceneResponse(
  value: unknown,
  history: RecordedSceneEvent[] = [],
  intentions: { actorId: string; actionText: string }[] = [],
) {
  if (!value || typeof value !== "object") return value;
  const v = structuredClone(value) as {
    type: string;
    events: (
      | z.infer<typeof SceneEvent>
      | { eventId: string; receipts: z.infer<typeof SceneEvent>["receipts"] }
    )[];
    callsToPlayers?: { eventIndex: number; observerId: string; text: string }[];
    liveContacts?: {
      eventIndex: number;
      observerId: string;
      receipt: string | null;
    }[];
    arrivals?: { eventIndex: number; observerId: string; text: string }[];
    decisions: Record<string, string | { pending: string }>;
    needsContext?: z.infer<typeof ContextNeed> | null;
    [key: string]: unknown;
  };
  if (v.type !== "scene") return v;
  for (const c of [...(v.callsToPlayers ?? []), ...(v.liveContacts ?? [])]) {
    const message = "text" in c ? c.text : c.receipt;
    if (message && v.events[c.eventIndex])
      v.events[c.eventIndex]!.receipts.push({
        observerId: c.observerId,
        text: message,
      });
  }
  for (const a of v.arrivals ?? []) {
    const event = history[a.eventIndex];
    if (!event)
      throw new SceneResponseError("保存済み受容の出来事がありません");
    v.events.push({
      eventId: event.id,
      receipts: [{ observerId: a.observerId, text: a.text }],
    });
  }
  for (const [actor, status] of Object.entries(v.decisions ?? {}))
    if (
      status === "pending" ||
      (status === "finished" &&
        v.needsContext?.remainingActions?.[actor]?.trim())
    )
      v.decisions[actor] = {
        pending:
          v.needsContext?.remainingActions?.[actor] ??
          intentions.find((i) => i.actorId === actor)?.actionText ??
          "選んだ行為の未実行部分を続ける",
      };
  for (const key of [
    "callsToPlayers",
    "liveContacts",
    "arrivals",
    "needsContext",
    "responseCoverage",
  ])
    delete v[key];
  return v;
}
export function sceneResponse(
  value: unknown,
  legacy = false,
  history: RecordedSceneEvent[] = [],
  intentions: { actorId: string; actionText: string }[] = [],
) {
  const reader = legacy
    ? z.discriminatedUnion("type", [
        SceneStep.options[0].extend({
          newDecisions: z.array(id).default([]),
          events: z.array(
            z.union([
              SceneEvent.extend({
                locations: z.array(LocationOp.omit({ type: true })).default([]),
              }),
              z
                .object({
                  eventId: id,
                  receipts: SceneEvent.shape.receipts.min(1),
                })
                .strict(),
            ]),
          ),
        }),
        LegacyBoundary,
      ])
    : SceneStep;
  const step = reader.parse(
    legacy ? legacySceneResponse(value, history, intentions) : value,
  );
  if (step.type !== "scene") return step;
  return {
    ...step,
    newDecisions:
      "newDecisions" in step && Array.isArray(step.newDecisions)
        ? (step.newDecisions as string[])
        : [],
    events: step.events.filter(
      (e): e is z.infer<typeof ActionEvent> => "actorId" in e,
    ),
    arrivals: step.events.flatMap((e) =>
      "eventId" in e
        ? e.receipts.map((p) => ({ eventId: e.eventId, ...p }))
        : [],
    ),
  };
}

/** Add a new receiver to an existing, still-staged occurrence without re-emitting it. */
export function sceneArrivals(
  events: RecordedSceneEvent[],
  arrivals: {
    eventId: string;
    observerId: string;
    text: string;
    information?: z.infer<typeof InformationReference>[] | undefined;
  }[],
  participants: string[],
  actorId: string,
  at: number,
) {
  const seen = new Set(
      events.flatMap((e, i) => e.receipts.map((p) => `${i}:${p.observerId}`)),
    ),
    additions: {
      event: RecordedSceneEvent;
      receipt: RecordedSceneEvent["receipts"][number];
    }[] = [];
  for (const { eventId, ...receipt } of arrivals) {
    const event = events.find((e) => e.id === eventId);
    if (
      !event ||
      receipt.observerId === actorId ||
      !participants.includes(receipt.observerId)
    )
      throw new SceneResponseError(
        "到達の参照先・受容者・時点がシーンと一致しません",
      );
    const key = `${events.indexOf(event)}:${receipt.observerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push({ event, receipt });
  }
  for (const { event, receipt } of additions)
    event.receipts.push({ ...receipt, at });
  return [...new Set(additions.map((a) => a.receipt.observerId))];
}
export const SceneEnding = z.enum([
  "requested",
  "concluded",
  "departed",
  "unanimous",
  "dissolved",
]);
export type SceneEnding = z.infer<typeof SceneEnding>;
export const SceneSources = z.record(
  id,
  z.object({
    edge: WorldEdge,
    sourceText: text.optional(),
    targetText: text.optional(),
  }),
);
export type SceneSources = z.infer<typeof SceneSources>;
export const CompletedScene = z
  .object({
    background: SceneBackground,
    events: z.array(
      SceneEvent.extend({ id, period: Period, inputId: id.optional() }),
    ),
    anchors: Change,
    sources: SceneSources.optional(),
    ending: SceneEnding.optional(),
  })
  .strict();
export type CompletedScene = z.infer<typeof CompletedScene>;
export type SceneView = Awaited<ReturnType<WorldAgent["view"]>> & {
  conditions?: Awaited<ReturnType<WorldAgent["intentView"]>>["conditions"];
};
export type SceneIntent = {
  inputId?: string;
  actorId: string;
  actionText: string;
  continuing: boolean;
};
export const sceneId = derivedId;
export function sceneContinuations(
  agenda: Construction["agenda"],
  participants: string[],
  actor: string,
  at: number,
) {
  const pending: Record<string, SceneIntent> = {},
    nextDecisions: string[] = [];
  for (const w of agenda) {
    if (
      !w.actorId ||
      w.deferred ||
      w.actorId === actor ||
      w.at > at ||
      !participants.includes(w.actorId)
    )
      continue;
    if (w.mode === "resolve" && w.actionText && w.planUntil === undefined)
      pending[w.actorId] = {
        actorId: w.actorId,
        actionText: w.actionText,
        continuing: true,
      };
    else if (w.mode === "intent") nextDecisions.push(w.actorId);
  }
  return { pending, nextDecisions };
}
export function sceneView(
  base: SceneView,
  background: SceneBackground,
  events: RecordedSceneEvent[],
  ownIntentions: string[],
  at: number,
  ownChoices: string[] = [],
) {
  return {
    ...base,
    at,
    conditions: [
      ...(base.conditions ?? []),
      ...background.facts
        .filter((fact) => fact.subjectId === base.observerId)
        .map((fact) => ({
          text: fact.text,
          about: fact.aboutIds,
          at: fact.at ?? base.at,
        })),
    ],
    observations: [
      ...base.observations,
      ...background.perceptions
        .filter((p) => p.observerId === base.observerId)
        .map((p) => ({
          id: sceneId(`background:${base.observerId}:${p.text}`),
          target: p.sourceIds[0]!,
          text: p.text,
          period: { from: base.at },
        })),
      ...events.flatMap((e) =>
        e.receipts
          .filter((p) => p.observerId === base.observerId)
          .map((p) => ({
            id: sceneId(`receipt:${e.id}:${base.observerId}`),
            target: e.id,
            text: p.text,
            period: p.at === undefined ? e.period : { from: p.at, until: p.at },
          })),
      ),
    ],
    interpretations: [
      ...base.interpretations,
      ...background.beliefs
        .filter((b) => b.subjectId === base.observerId)
        .map((b) => ({ text: b.text, about: b.aboutIds })),
    ],
    ...(ownIntentions.length ? { ownIntentions } : {}),
    ...(ownChoices.length ? { ownChoices } : {}),
  };
}
export function sceneAnchors(
  background: SceneBackground,
  events: RecordedSceneEvent[],
  at: number,
  id: string,
  locationsCommitted = false,
): Change {
  const nodes: Change["nodes"] = background.creations.map((n) => ({
      ...n,
      kind: "existence",
    })),
    edges: Change["edges"] = [];
  for (const kind of ["status", "interpret"] as const) {
    const facts = kind === "status" ? background.facts : background.beliefs;
    for (const [i, f] of facts.entries()) {
      if (locationsCommitted && kind === "status" && f.location) continue;
      const script = sceneId(`${id}:${kind}:${i}`),
        period = { from: f.at ?? at };
      nodes.push({ id: script, kind: "script", text: f.text });
      edges.push({
        id: sceneId(`${script}:content`),
        kind,
        role: "content",
        source: f.subjectId,
        target: script,
        period,
      });
      for (const target of f.aboutIds)
        edges.push({
          id: sceneId(`${script}:${target}`),
          kind,
          role: "about",
          source: script,
          target,
          period,
        });
    }
  }
  const period = { from: at, until: at };
  for (const [i, p] of background.perceptions.entries())
    edges.push({
      id: sceneId(`${id}:perception:${i}`),
      kind: "see",
      source: p.observerId,
      target: p.sourceIds[0]!,
      text: p.text,
      period,
      observation: {
        aspect: p.text,
        through: at,
        sourceIds: p.sourceIds,
        pathIds: [],
      },
    });
  for (const e of events) {
    nodes.push({ id: e.id, kind: "event", text: e.text, period: e.period });
    edges.push({
      id: sceneId(`${e.id}:happen`),
      kind: "happen",
      source: e.actorId,
      target: e.id,
      period: e.period,
    });
    for (const p of e.receipts) {
      const path = sceneId(`${e.id}:${p.observerId}:effect`),
        receptionPeriod =
          p.at === undefined ? e.period : { from: p.at, until: p.at };
      edges.push({
        id: path,
        kind: "effect",
        source: e.id,
        target: p.observerId,
        period: receptionPeriod,
      });
      edges.push({
        id: sceneId(`${e.id}:${p.observerId}:see`),
        kind: "see",
        source: p.observerId,
        target: e.id,
        text: p.text,
        period: receptionPeriod,
        observation: {
          aspect: p.text,
          through: receptionPeriod.until,
          sourceIds: [e.id],
          pathIds: [path],
        },
      });
    }
  }
  return Change.parse({ nodes, edges, revisions: [], endEdges: [] });
}
export function mergeSceneChanges(
  anchors: Change,
  extra: Change,
  at: number,
): Change {
  const nodes = new Set(anchors.nodes.map((n) => n.id)),
    edges = new Map(anchors.edges.map((e) => [e.id, e]));
  if ([...extra.nodes, ...extra.revisions].some((n) => nodes.has(n.id)))
    throw new Error("表示済みシーンの内容を改訂・再発行できません");
  const precise = new Map<string, number>(),
    additions: Change["edges"] = [];
  for (const e of extra.edges) {
    const original = edges.get(e.id);
    if (!original) {
      additions.push(e);
      continue;
    }
    const until = e.period.until;
    if (
      original.kind !== "status" ||
      original.period.until !== undefined ||
      until === undefined ||
      until > at ||
      e.period.from !== original.period.from ||
      !isDeepStrictEqual({ ...e, period: original.period }, original)
    )
      throw new Error("表示済みシーンの内容を改訂・再発行できません");
    const script =
        original.role === "content" ? original.target : original.source,
      prior = precise.get(script);
    if (prior !== undefined && prior !== until)
      throw new Error("同じ状態へ異なる終了時点を指定できません");
    precise.set(script, until);
  }
  const ended = new Set<string>();
  for (const id of extra.endEdges) {
    const e = edges.get(id);
    if (!e) continue;
    if (e.kind !== "status")
      throw new Error("表示済みの発生・受容は終了できません");
    ended.add(e.role === "content" ? e.target : e.source);
  }
  return Change.parse({
    nodes: [...anchors.nodes, ...extra.nodes],
    revisions: extra.revisions,
    edges: [
      ...anchors.edges.map((e) => {
        if (e.kind !== "status") return e;
        const script = e.role === "content" ? e.target : e.source,
          until = precise.get(script) ?? (ended.has(script) ? at : undefined);
        if (until === undefined) return e;
        if (
          precise.has(script) &&
          e.period.until !== undefined &&
          e.period.until !== until
        )
          throw new Error("既に終わった状態の時点を変更できません");
        return { ...e, period: { ...e.period, until } };
      }),
      ...additions,
    ],
    endEdges: extra.endEdges.filter((id) => !edges.has(id)),
  });
}

export function sceneAgenda(
  original: Construction["agenda"],
  actor: string,
  at: number,
  projection: WorldProposal,
  intentions: Record<string, SceneIntent>,
  nextDecisions: string[],
): Construction["agenda"] {
  const agenda = original
    .filter((w) => w.actorId !== actor)
    .map((w) => ({
      ...w,
      ...(w.at < at ? { at, id: randomUUID() } : {}),
      ...(w.previousActions ? { previousActions: [...w.previousActions] } : {}),
    }));
  for (const id of projection.deferredIntentions ?? []) {
    const text = intentions[id]!.actionText,
      prior = agenda.find((w) => w.actorId === id);
    if (prior?.mode === "intent")
      prior.previousActions = [
        ...new Set([...(prior.previousActions ?? []), text]),
      ];
    else if (prior?.mode === "resolve")
      prior.actionText = [...new Set([prior.actionText ?? "", text])]
        .filter(Boolean)
        .join("\n\n");
    else
      agenda.push({
        id: randomUUID(),
        at,
        actorId: id,
        mode: "resolve",
        deferred: true,
        actionText: text,
      });
  }
  const wakeups = [
    ...projection.wakeups,
    ...nextDecisions
      .filter((id) => !projection.wakeups.some((w) => w.actorId === id))
      .map((actorId) => ({ actorId, at, mode: "intent" as const })),
  ];
  for (const w of wakeups) {
    const prior = agenda.find((a) => a.actorId === w.actorId),
      text = intentions[w.actorId]?.actionText;
    if (prior && w.mode === "intent") {
      const previous = [
        ...(prior.previousActions ?? []),
        ...(prior.actionText ? [prior.actionText] : []),
        ...(text ? [text] : []),
      ];
      prior.id = randomUUID();
      prior.at = w.at;
      prior.mode = "intent";
      prior.previousActions = [...new Set(previous)];
      delete prior.actionText;
      delete prior.deferred;
    } else
      agenda.push({
        id: randomUUID(),
        ...w,
        ...(w.mode === "resolve"
          ? { actionText: text ?? "" }
          : text
            ? { previousActions: [text] }
            : {}),
      });
  }
  return agenda;
}
