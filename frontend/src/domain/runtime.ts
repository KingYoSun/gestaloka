import type {
  AppRoute,
  InventorySummary,
  LocationOpsItem,
  PackContext,
  PackScope,
  SessionState,
  TurnResponse,
} from "../types";

export function resolveRoute(): AppRoute {
  return "game";
}

export function formatPackScope(scope?: PackScope[] | null): string {
  if (!scope?.length) {
    return "unknown pack / unknown template";
  }
  return scope
    .map((item) => `${item.pack_display_name} / ${item.world_template_display_name}`)
    .join(" | ");
}

export function formatPackContext(context?: PackContext | null): string {
  if (!context) {
    return "unknown pack / unknown template";
  }
  const worldSuffix = context.world_id ? ` / ${context.world_id}` : "";
  return `${context.pack_display_name} / ${context.world_template_display_name}${worldSuffix}`;
}

export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    query.set(key, String(value));
  });
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export function packScopeMatches(scope: PackScope[] | undefined | null, packId: string, templateId: string): boolean {
  if (!packId && !templateId) {
    return true;
  }
  return (scope ?? []).some((item) => packContextMatches(item, packId, templateId));
}

export function packContextMatches(
  context: Pick<PackContext, "pack_id" | "world_template_id"> | undefined | null,
  packId: string,
  templateId: string,
): boolean {
  if (!packId && !templateId) {
    return true;
  }
  if (!context) {
    return false;
  }
  if (packId && context.pack_id !== packId) {
    return false;
  }
  if (templateId && context.world_template_id !== templateId) {
    return false;
  }
  return true;
}

export function traceMatchesOpsScope(attributes: Record<string, unknown>, packId: string, templateId: string): boolean {
  if (!packId && !templateId) {
    return true;
  }
  const tracePackId = typeof attributes.pack_id === "string" ? attributes.pack_id : undefined;
  const traceTemplateId = typeof attributes.world_template_id === "string" ? attributes.world_template_id : undefined;
  if (tracePackId || traceTemplateId) {
    return packContextMatches(
      {
        pack_id: tracePackId ?? "",
        world_template_id: traceTemplateId ?? "",
      },
      packId,
      templateId,
    );
  }
  const packIds = typeof attributes["eval.pack_ids"] === "string" ? attributes["eval.pack_ids"].split(",") : [];
  const templateIds =
    typeof attributes["eval.world_template_ids"] === "string" ? attributes["eval.world_template_ids"].split(",") : [];
  if (packIds.length || templateIds.length) {
    return (!packId || packIds.includes(packId)) && (!templateId || templateIds.includes(templateId));
  }
  return true;
}

export function packFailureSeverityRank(severity: string): number {
  if (severity === "critical") {
    return 0;
  }
  if (severity === "error") {
    return 1;
  }
  if (severity === "warning") {
    return 2;
  }
  return 3;
}

export function deriveImportantInventoryAffordances(inventory: InventorySummary[]): SessionState["important_inventory_affordances"] {
  return inventory
    .filter((item) => item.effect_kind)
    .map((item) => ({
      item_id: item.id,
      name: item.name,
      usable: item.usable,
      effect_kind: item.effect_kind,
      summary:
        item.effect_kind ? `${item.name} can unlock the next route.` : `${item.name} carries a special affordance.`,
    }));
}

export function mergeTurnResponseIntoSessionState(current: SessionState | null, response: TurnResponse): SessionState | null {
  if (!current) {
    return current;
  }

  const quests = [...current.quests];
  for (const update of response.quest_updates) {
    const index = quests.findIndex((item) => item.assignment_id === update.assignment_id);
    if (index >= 0) {
      quests[index] = { ...quests[index], ...update };
    } else {
      quests.push(update);
    }
  }
  const questJournal = [...(current.quest_journal ?? [])];
  for (const update of response.quest_updates) {
    const index = questJournal.findIndex((item) => item.assignment_id === update.assignment_id);
    if (index >= 0) {
      questJournal[index] = { ...questJournal[index], ...update };
    } else {
      questJournal.push(update);
    }
  }
  const liveQuest = questJournal.find((item) => item.status === "active");

  const factions = [...current.factions];
  for (const update of response.faction_updates) {
    const index = factions.findIndex((item) => item.faction_id === update.faction_id);
    if (index >= 0) {
      factions[index] = { ...factions[index], ...update };
    } else {
      factions.push(update);
    }
  }

  const inventory = [...current.inventory];
  for (const update of response.inventory_updates) {
    const index = inventory.findIndex((item) => item.id === update.id);
    if (index >= 0) {
      inventory[index] = { ...inventory[index], ...update };
    } else {
      inventory.push(update);
    }
  }

  const relationships = [...current.relationships];
  for (const update of response.relationship_updates) {
    const index = relationships.findIndex((item) => item.actor_id === update.actor_id);
    if (index >= 0) {
      relationships[index] = { ...relationships[index], ...update };
    } else {
      relationships.push(update);
    }
  }

  const threadMap = new Map(current.active_consequence_threads.map((item) => [item.id, item]));
  for (const update of response.consequence_updates) {
    if (update.status === "resolved") {
      threadMap.delete(update.id);
      continue;
    }
    threadMap.set(update.id, {
      counterpart_actor_id: null,
      counterpart_name: null,
      thread_type: undefined,
      ...threadMap.get(update.id),
      ...update,
    });
  }

  const recentConsequenceHistory = response.consequence_summary
    ? [response.consequence_summary, ...current.recent_consequence_history.filter((item) => item !== response.consequence_summary)].slice(0, 3)
    : current.recent_consequence_history;
  const recentSceneHistory = response.scene_summary
    ? [response.scene_summary, ...current.recent_scene_history.filter((item) => item !== response.scene_summary)].slice(0, 3)
    : current.recent_scene_history;
  const recentBranchEchoes = response.branch_updates?.length
    ? response.branch_updates
        .map((item) => item.summary)
        .filter((item, index, items) => Boolean(item) && items.indexOf(item) === index)
        .slice(0, 3)
    : current.recent_branch_echoes;
  const recentWorldBeats = response.recent_world_beats?.length
    ? response.recent_world_beats
    : current.recent_world_beats;
  const recentOffstageBeats = response.recent_offstage_beats?.length
    ? response.recent_offstage_beats
    : current.recent_offstage_beats;
  const ambientMurmurs = response.ambient_updates?.length
    ? response.ambient_updates
        .filter((item) => item.beat_kind === "murmur" || item.beat_kind === "question")
        .map((item) => item.summary)
        .slice(0, 3)
    : current.ambient_murmurs;
  const offstageMurmurs = response.idle_updates?.length
    ? response.idle_updates
        .filter((item) => item.beat_kind === "murmur" || item.beat_kind === "question" || item.beat_kind === "relocate")
        .map((item) => item.summary)
        .slice(0, 3)
    : current.offstage_murmurs;
  const currentScene = response.scene_updates.length ? response.scene_updates[response.scene_updates.length - 1] : current.current_scene;
  const currentChapterBase = response.chapter_updates.length ? response.chapter_updates[response.chapter_updates.length - 1] : current.chapter;
  const currentChapter = currentChapterBase
    ? {
        ...currentChapterBase,
        crossroads_summary: response.crossroads_summary || currentChapterBase.crossroads_summary || "",
        branch_hint:
          response.branch_updates?.[response.branch_updates.length - 1]?.branch_hint ??
          currentChapterBase.branch_hint ??
          response.crossroads_summary ??
          "",
      }
    : currentChapterBase;
  const currentLocation = response.current_location ?? current.current_location ?? current.location;

  return {
    ...current,
    location: currentLocation,
    current_location: currentLocation,
    quests,
    quest_journal: questJournal,
    quest_display_state: liveQuest ? { mode: "quest", label: liveQuest.title } : current.quest_display_state,
    factions,
    inventory,
    chapter: currentChapter,
    current_scene: currentScene,
    recent_scene_history: recentSceneHistory,
    recent_branch_echoes: recentBranchEchoes,
    recent_travel_history: response.travel_summary
      ? [response.travel_summary, ...current.recent_travel_history.filter((item) => item !== response.travel_summary)].slice(0, 3)
      : current.recent_travel_history,
    recent_world_beats: recentWorldBeats,
    ambient_murmurs: ambientMurmurs,
    npc_locations: current.npc_locations,
    recent_offstage_beats: recentOffstageBeats,
    offstage_murmurs: offstageMurmurs,
    relationships,
    active_consequence_threads: Array.from(threadMap.values()),
    recent_consequence_history: recentConsequenceHistory,
    next_choices: response.next_choices.length ? response.next_choices : current.next_choices,
    important_inventory_affordances: deriveImportantInventoryAffordances(inventory),
  };
}

export function locationRouteSummaries(item: LocationOpsItem): Array<{
  route_key: string;
  destination_name: string;
  status: string;
  travel_summary: string;
}> {
  if (item.route_summaries?.length) {
    return item.route_summaries;
  }
  return (item.routes ?? []).map((route) => ({
    route_key: route.route_key,
    destination_name: route.destination_name ?? route.to_location_name ?? "Unknown destination",
    status: route.status,
    travel_summary: route.travel_summary,
  }));
}
