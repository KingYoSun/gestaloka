import { WorldEdge } from "../world/model.js";
import type { ChatMessage } from "../llm/client.js";
import { SceneResponseError, type SceneSources } from "./scene-data.js";

/** Capture only records actually returned by graph reads in this background pass. */
export function sceneSources(
  messages: ChatMessage[],
  facts: { subjectId: string; sourceRelationIds?: string[] | undefined }[],
): SceneSources {
  const wanted = new Set(facts.flatMap((f) => f.sourceRelationIds ?? []));
  const edges = new Map<string, WorldEdge>(),
    labels = new Map<string, string>();
  function visit(v: unknown) {
    if (!v || typeof v !== "object") return;
    if ("id" in v && typeof v.id === "string") {
      if (wanted.has(v.id) && "source" in v && "target" in v)
        edges.set(v.id, WorldEdge.parse(v));
      if (
        "kind" in v &&
        ["existence", "event", "script"].includes(String(v.kind)) &&
        "text" in v &&
        typeof v.text === "string"
      )
        labels.set(v.id, v.text);
    }
    for (const child of Object.values(v)) visit(child);
  }
  if (wanted.size)
    for (const m of messages) {
      if (m.role !== "user") continue;
      const page = JSON.parse(m.content);
      if (page.initialContext)
        for (const item of page.initialContext) visit(item.result);
      else visit(page.results);
    }
  return Object.fromEntries(
    [...wanted].map((id) => {
      const edge = edges.get(id);
      if (!edge) throw new SceneResponseError(`未照会の関係IDです: ${id}`);
      return [
        id,
        {
          edge,
          sourceText: labels.get(edge.source),
          targetText: labels.get(edge.target),
        },
      ];
    }),
  );
}
