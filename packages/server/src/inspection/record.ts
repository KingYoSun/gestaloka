import {
  InitialPresentation,
  KnowledgePage,
  type Presentation,
  type Information,
} from "@gestaloka/contracts";
import type pg from "pg";
import { z } from "zod";
import type { SceneRow } from "../runtime/scene.js";
import { sceneId } from "../runtime/scene-data.js";

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
) {
  const information = page.items
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
    information?: Information[],
  ) => {
    const id = sceneId(`${row.id}:presentation:${key}`);
    if (records.some((p) => p.id === id)) return;
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
        information &&
        information.every(
          (r) => z.uuid().safeParse(r.id).success && text.includes(r.evidence),
        )
          ? information
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
function resolve(r: Information, row: SceneRow, eventId?: string): Information {
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
