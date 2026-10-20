import { createHash } from "node:crypto";
import { z } from "zod";
import { Change } from "../world/model.js";
import type { WorldAgent } from "./agent.js";
import type { WorldProposal } from "./agent.js";
import type { Construction } from "./construction.js";
import { randomUUID } from "node:crypto";

const id = z.uuid(),
  text = z.string().min(1);
const Fact = z.object({ subjectId: id, text, aboutIds: z.array(id) }).strict();
export const SceneBackground = z
  .object({
    type: z.literal("background"),
    synopsis: text,
    participants: z.array(id).min(1),
    facts: z.array(Fact),
    perceptions: z.array(
      z
        .object({ observerId: id, text, sourceIds: z.array(id).min(1) })
        .strict(),
    ),
    unknowns: z.array(text),
    creations: z.array(z.object({ id, text }).strict()).default([]),
    beliefs: z.array(Fact.extend({ aboutIds: z.array(id).min(1) })).default([]),
  })
  .strict();
export type SceneBackground = z.infer<typeof SceneBackground>;
export const SceneEvent = z
  .object({
    actorId: id,
    text,
    receipts: z.array(z.object({ observerId: id, text }).strict()),
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
};
export const SceneStep = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("scene"),
      events: z.array(SceneEvent),
      decisions: z.record(id, z.enum(["pending", "finished", "decide"])),
      newDecisions: z.array(id),
      elapsedMs: z.number().int().nonnegative().safe().default(0),
    })
    .strict(),
  z.object({ type: z.literal("boundary"), reason: text }).strict(),
]);
export const CompletedScene = z
  .object({
    background: SceneBackground,
    events: z.array(SceneEvent.extend({ id, period: Period })),
    anchors: Change,
  })
  .strict();
export type CompletedScene = z.infer<typeof CompletedScene>;
export type SceneView = Awaited<ReturnType<WorldAgent["view"]>>;
export type SceneIntent = {
  actorId: string;
  actionText: string;
  continuing: boolean;
};
export const sceneId = (value: string) => {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
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
            period: e.period,
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
): Change {
  const nodes: Change["nodes"] = background.creations.map((n) => ({
      ...n,
      kind: "existence",
    })),
    edges: Change["edges"] = [];
  for (const kind of ["status", "interpret"] as const) {
    const facts = kind === "status" ? background.facts : background.beliefs;
    for (const [i, f] of facts.entries()) {
      const script = sceneId(`${id}:${kind}:${i}`);
      nodes.push({ id: script, kind: "script", text: f.text });
      edges.push({
        id: sceneId(`${script}:content`),
        kind,
        role: "content",
        source: f.subjectId,
        target: script,
        period: { from: at },
      });
      for (const target of f.aboutIds)
        edges.push({
          id: sceneId(`${script}:${target}`),
          kind,
          role: "about",
          source: script,
          target,
          period: { from: at },
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
      const path = sceneId(`${e.id}:${p.observerId}:effect`);
      edges.push({
        id: path,
        kind: "effect",
        source: e.id,
        target: p.observerId,
        period: e.period,
      });
      edges.push({
        id: sceneId(`${e.id}:${p.observerId}:see`),
        kind: "see",
        source: p.observerId,
        target: e.id,
        text: p.text,
        period: e.period,
        observation: {
          aspect: p.text,
          through: e.period.until,
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
  if (
    [...extra.nodes, ...extra.revisions].some((n) => nodes.has(n.id)) ||
    extra.edges.some((e) => edges.has(e.id))
  )
    throw new Error("表示済みシーンの内容を改訂・再発行できません");
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
      ...anchors.edges.map((e) =>
        e.kind === "status" &&
        ended.has(e.role === "content" ? e.target : e.source)
          ? { ...e, period: { ...e.period, until: at } }
          : e,
      ),
      ...extra.edges,
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
