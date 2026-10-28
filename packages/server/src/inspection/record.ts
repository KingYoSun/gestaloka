import {
  InitialPresentation,
  KnowledgePage,
  type Presentation,
  type Information,
  type InformationReference,
} from "@gestaloka/contracts";
import type pg from "pg";
import { z } from "zod";
import type { SceneRow } from "../runtime/scene.js";
import { sceneAnchors, sceneId } from "../runtime/scene-data.js";
import { canonical } from "../llm/prompt.js";
import { createHash } from "node:crypto";
import type { WorldStore, WorldNode, WorldEdge } from "../world/store.js";

export function canonicalInformation(
  value: WorldNode | WorldEdge,
  origin: Information["origin"],
  evidence: string,
): Information {
  let content = value;
  if ("observation" in value && value.observation) {
    const { versions, ...observation } = value.observation;
    void versions;
    content = { ...value, observation };
  }
  const state = canonical(content);
  return {
    kind: "source" in value ? "edge" : "node",
    id: value.id,
    aspect: value.kind,
    state,
    version: createHash("sha256").update(state).digest("hex"),
    at: "period" in value ? (value.period?.from ?? 0) : 0,
    origin,
    evidence,
    canonical: true,
  };
}
export async function captureSceneInformation(
  row: SceneRow,
  store: WorldStore,
) {
  const d = row.data;
  if (!d.background) return;
  const anchors = sceneAnchors(d.background, d.events, d.startedAt, row.id),
    context = store.context(d.worldId),
    basis = (d.informationBasis ??= {});
  const selections = [
    ...(d.background.synopsisInformation ?? []).map((r) => resolve(r, row)),
    ...d.events.flatMap((e) =>
      e.receipts
        .filter((p) => p.observerId === row.actor_id)
        .flatMap((p) =>
          (p.information ?? []).map((r) => resolve(r, row, e.id)),
        ),
    ),
    ...(d.resultInformation ?? []).map((r) => resolve(r, row)),
  ];
  for (const r of selections) {
    if (basis[r.id] || !z.uuid().safeParse(r.id).success) continue;
    if (d.presentations?.some((p) => p.id === r.id)) continue;
    const prior = d.presentations
      ?.flatMap((p) => p.information ?? [])
      .find((p) => p.id === r.id && p.canonical);
    if (prior) {
      basis[r.id] = prior;
      continue;
    }
    const staged = [...anchors.nodes, ...anchors.edges].find(
        (n) => n.id === r.id,
      ),
      actual =
        staged ??
        (await context.node(r.id, d.at)) ??
        (await context.edge(r.id));
    if (actual)
      basis[r.id] = canonicalInformation(
        actual,
        staged ? "generated" : "reference",
        r.evidence ?? "",
      );
  }
  await context.validate();
}

export async function setupInitialPresentations(db: Pick<pg.Pool, "query">) {
  await db.query(`CREATE TABLE IF NOT EXISTS player_initial_presentation(id uuid PRIMARY KEY,construction_id uuid NOT NULL,actor_id uuid NOT NULL,user_id uuid,provided_at timestamptz NOT NULL,data jsonb NOT NULL);
    CREATE INDEX IF NOT EXISTS player_initial_presentation_actor ON player_initial_presentation(construction_id,actor_id,user_id,provided_at,id);`);
}
export async function recordInitialPresentation(
  db: Pick<pg.Pool, "query">,
  constructionId: string,
  userId: string,
  page: z.infer<typeof KnowledgePage>,
  targets: ReadonlyMap<string, string>,
  store?: WorldStore,
) {
  let information: Information[] = page.items
    .filter((i) => i.text)
    .flatMap((i) =>
      [
        { kind: "edge" as const, id: i.id },
        { kind: "node" as const, id: targets.get(i.id)! },
      ].map((reference) => ({
        ...reference,
        aspect: i.kind,
        state: i.text,
        version: null,
        at: i.from,
        origin: "reference" as const,
        evidence: i.text,
      })),
    );
  if (store) {
    const context = store.context(
      (
        await db.query<{ world_id: string }>(
          "SELECT world_id FROM world_construction WHERE id=$1",
          [constructionId],
        )
      ).rows[0]!.world_id,
    );
    information = [];
    for (const item of page.items.filter((i) => i.text)) {
      const edge = await context.edge(item.id),
        node = await context.node(targets.get(item.id)!, page.at);
      if (edge)
        information.push(canonicalInformation(edge, "reference", item.text));
      if (node)
        information.push(canonicalInformation(node, "reference", item.text));
    }
    await context.validate();
  }
  const id = sceneId(
    `${constructionId}:${userId}:${page.viewerId}:initial:${JSON.stringify({ at: page.at, information })}`,
  );
  const data = InitialPresentation.parse({
    id,
    text: page.items.map((i) => i.text).join("\n"),
    at: page.at,
    providedAt: null,
    information,
  });
  await db.query(
    `INSERT INTO player_initial_presentation(id,construction_id,actor_id,user_id,provided_at,data)
    SELECT $1,$2,$3,$4,stamp,jsonb_set($5::jsonb,'{providedAt}',to_jsonb(to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    FROM (SELECT clock_timestamp() AS stamp) t WHERE NOT EXISTS(SELECT 1 FROM world_scene WHERE construction_id=$2 AND actor_id=$3)
    ON CONFLICT DO NOTHING`,
    [id, constructionId, page.viewerId, userId, JSON.stringify(data)],
  );
}

/** Capture the same projection used by WorldAccess, before publishing invalidation. */
export function recordPresentations(
  row: SceneRow,
  providedAt = new Date().toISOString(),
) {
  const d = row.data;
  if (!d.recordingVersion) return;
  const records = (d.presentations ??= []);
  const add = (
    key: string,
    kind: Presentation["kind"],
    text: string,
    inputId: string | null,
    at: number,
    information?: InformationReference[],
  ) => {
    const id = sceneId(`${row.id}:presentation:${key}`);
    if (records.some((p) => p.id === id)) return;
    const selections = information?.flatMap((r) => {
      const source =
        kind === "result" && d.recordingVersion === "inspection-record-v2"
          ? records.find((p) => p.id === r.id)
          : undefined;
      return (
        source?.information?.map((original) => ({
          ...original,
          evidence: r.evidence ?? text,
        })) ?? [r]
      );
    });
    const resolved = selections?.map((r) =>
      d.recordingVersion === "inspection-record-v2"
        ? d.informationBasis?.[r.id]
          ? { ...d.informationBasis[r.id]!, evidence: text }
          : null
        : (r as Information),
    );
    records.push({
      id,
      sceneId: row.id,
      inputId,
      kind,
      text,
      at,
      providedAt,
      ordinal: records.length,
      information:
        resolved &&
        resolved.every(
          (r) =>
            r && z.uuid().safeParse(r.id).success && text.includes(r.evidence),
        )
          ? (resolved as Information[])
          : null,
    });
  };
  if (d.background)
    add(
      "synopsis",
      "synopsis",
      d.background.synopsis,
      null,
      d.startedAt,
      d.background.synopsisInformation?.map((r) => resolve(r, row)),
    );
  for (const e of d.events)
    for (const p of e.receipts)
      if (p.observerId === row.actor_id)
        add(
          e.id,
          "response",
          p.text,
          e.inputId ?? null,
          e.period.until,
          p.information?.map((r) => resolve(r, row, e.id)),
        );
  if (row.state === "result" && d.result)
    add("result", "result", d.result, null, d.at, d.resultInformation);
  const a = d.actions.at(-1);
  if (a && a.state !== "running" && !a.completedAt) a.completedAt = providedAt;
}
function resolve(
  r: InformationReference,
  row: SceneRow,
  eventId?: string,
): InformationReference {
  let id = r.id;
  if (id === "$event" && eventId) id = eventId;
  if (id === "$receipt" && eventId)
    id = sceneId(`${eventId}:${row.actor_id}:see`);
  const match = /^\$(perception|status|interpret):(\d+)$/.exec(id);
  if (match)
    id = sceneId(
      match[1] === "perception"
        ? `${row.id}:perception:${match[2]}`
        : `${row.id}:${match[1]}:${match[2]}`,
    );
  return { ...r, id };
}
