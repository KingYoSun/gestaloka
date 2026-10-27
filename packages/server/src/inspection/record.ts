import type { Presentation, Information } from "@gestaloka/contracts";
import { z } from "zod";
import type { SceneRow } from "../runtime/scene.js";
import { sceneId } from "../runtime/scene-data.js";

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
