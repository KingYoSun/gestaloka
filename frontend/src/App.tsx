import { FormEvent, useEffect, useRef, useState } from "react";
import keycloak from "./lib/keycloak";

type AppRoute = "game" | "admin";

type AuthMe = {
  sub: string;
  email: string;
  name: string;
  preferred_username: string;
};

type HealthPayload = {
  status: string;
  database: string;
  projection: {
    backend: string;
    space: string;
    pending_outbox: number;
    failed_outbox: number;
    projected_outbox: number;
    projection_records: number;
    graph_read_mode: string;
    last_error: string | null;
  };
  projection_runtime: {
    graph_runtime_status: string;
    graph_runtime_error: string | null;
  };
  sp: {
    default_balance: number;
    turn_cost: number;
    choice_turn_cost: number;
    free_text_turn_cost: number;
    budget_scope?: string;
    economy_status: string;
  };
  embedding: {
    provider: string;
    model: string;
    dimension: number;
    pending_count: number;
    failed_count: number;
    runtime_status: string;
  };
  world_packs: {
    status: string;
    engine_api_version: string;
    pack_count: number;
    template_count: number;
    failure_count: number;
  };
  observability: {
    runtime_role: string;
    projection_lag_seconds: number;
    outbox_pending_count: number;
    outbox_failed_count: number;
    llm_schema_valid_rate: number;
    llm_fallback_rate: number;
    canary_health: {
      status: string;
      graph_runtime_status: string | null;
      release_gate_verdict: string | null;
    };
  };
  release_gate: {
    report_id: string | null;
    verdict: string;
    blocked_reasons: string[];
    created_at: string | null;
    canary_promote_status: string;
  };
  llm_observability: {
    stack: string;
    enabled: boolean;
    base_url: string | null;
    runtime_status: string;
    last_error: string | null;
  };
  oidc_mode: string;
};

type LangfuseStatus = {
  stack: string;
  enabled: boolean;
  base_url: string | null;
  runtime_status: string;
  last_error: string | null;
};

type SessionInfo = {
  session_id: string;
  world_id: string;
  world_name: string;
  pack_id: string;
  world_template_id: string;
  world_context: WorldContext;
  player_actor_id: string;
  npc_actor_id: string;
  location_id: string;
  websocket_url: string;
};

type WorldPackItem = {
  pack_id: string;
  version: string;
  engine_api_version: string;
  display_name: string;
  visibility: "public" | "private";
  publish_status: "playable" | "draft" | "archived";
  semantic_tags: string[];
  content_refs?: Record<string, string>;
  world_templates: Array<{
    template_id: string;
    display_name: string;
    summary: string;
    visibility?: "public" | "private" | null;
    publish_status?: "playable" | "draft" | "archived" | null;
    effective_visibility: "public" | "private";
    effective_publish_status: "playable" | "draft" | "archived";
  }>;
};

type WorldPackCatalog = {
  status: string;
  engine_api_version: string;
  pack_count: number;
  template_count: number;
  items: WorldPackItem[];
};

type PlayableWorldItem = {
  world_id: string;
  display_name: string;
  summary: string;
  health_url: string;
  status: string;
  pack_context: PackScope;
};

type PlayableWorldCatalog = {
  status: string;
  engine_api_version: string;
  world_count: number;
  items: PlayableWorldItem[];
};

type OpsWorldPackItem = WorldPackItem & {
  root_dir: string;
};

type OpsWorldPackFailure = {
  error: string;
  message: string;
  severity: string;
  pack_id?: string;
  path?: string;
};

type OpsWorldPackCatalog = {
  status: string;
  pack_dir: string;
  engine_api_version: string;
  pack_count: number;
  template_count: number;
  failure_count: number;
  failures: OpsWorldPackFailure[];
  items: OpsWorldPackItem[];
};

type WorldContext = {
  world_id: string;
  world_name: string;
  pack_id: string;
  pack_display_name: string;
  world_template_id: string;
  world_template_display_name: string;
  semantic_tags: string[];
};

type PackScope = {
  pack_id: string;
  pack_display_name: string;
  world_template_id: string;
  world_template_display_name: string;
};

type PackContext = PackScope & {
  world_id: string;
};

type OpsWorldItem = {
  world_context: WorldContext;
  status: string;
  active_session_count: number;
  updated_at: string;
};

type ChapterSummaryValue = {
  id: string;
  key: string;
  status: string;
  summary: string;
  crossroads_summary?: string;
  branch_hint?: string;
};

type ChapterSummary = ChapterSummaryValue | null;

type SceneSummaryValue = {
  id: string;
  summary: string;
  pressure_summary: string;
  location: {
    id: string;
    name: string;
    description: string;
  } | null;
  focus_actor: {
    actor_id: string;
    display_name: string;
  } | null;
};

type CurrentSceneSummary = SceneSummaryValue | null;

type CharacterSummary = {
  actor_id: string;
  rank: string;
  hp: number;
  focus: number;
  status_json: Record<string, unknown>;
};

type NarrativeChoice = {
  choice_id: "safe" | "progress" | "explore";
  posture: "safe" | "progress" | "explore";
  label: string;
  summary: string;
  canonical_input_text: string;
  action_kind: "narrative" | "use_reward_item" | "travel";
  travel_target_key?: string | null;
};

type QuestSummary = {
  assignment_id: string;
  quest_template_id: string;
  title: string;
  description: string;
  status: string;
  stage_key: string;
  unlock_requirements: Record<string, unknown>;
  progress: number;
  progress_target: number;
  latest_summary: string;
  reward_item_id: string | null;
  state_json: Record<string, unknown>;
};

type FactionSummary = {
  faction_id: string;
  name: string;
  description: string;
  standing: number;
  band: string;
};

type InventorySummary = {
  id: string;
  template_key: string;
  name: string;
  description: string;
  status: string;
  usable: boolean;
  effect_kind: string | null;
};

type RelationshipSummary = {
  actor_id: string;
  display_name: string;
  band: string;
  summary: string;
};

type LocalFigureSummary = {
  actor_id: string;
  display_name: string;
  summary: string;
};

type NPCLocationSummary = {
  actor_id: string;
  display_name: string;
  location_id: string | null;
  location_name: string;
  summary: string;
};

type CurrentLocationSummary = {
  id: string;
  key: string;
  name: string;
  description: string;
} | null;

type NearbyRouteSummary = {
  route_key: string;
  summary: string;
  destination_name: string;
  destination_key: string;
  available: boolean;
};

type ConsequenceThreadSummary = {
  id: string;
  title: string;
  summary: string;
  pressure_band: string;
  counterpart_actor_id?: string | null;
  counterpart_name?: string | null;
  thread_type?: string;
  status?: string;
};

type SessionState = {
  world_id: string;
  world_context?: WorldContext;
  location: CurrentLocationSummary;
  current_location: CurrentLocationSummary;
  character: CharacterSummary;
  quests: QuestSummary[];
  factions: FactionSummary[];
  inventory: InventorySummary[];
  chapter: ChapterSummary;
  current_scene: CurrentSceneSummary;
  recent_scene_history: string[];
  recent_branch_echoes: string[];
  local_figures: LocalFigureSummary[];
  nearby_routes: NearbyRouteSummary[];
  recent_travel_history: string[];
  plaza_figures: LocalFigureSummary[];
  recent_world_beats: string[];
  ambient_murmurs: string[];
  npc_locations: NPCLocationSummary[];
  recent_offstage_beats: string[];
  offstage_murmurs: string[];
  relationships: RelationshipSummary[];
  active_consequence_threads: ConsequenceThreadSummary[];
  recent_consequence_history: string[];
  next_choices: NarrativeChoice[];
  narrative_state_bands: Record<string, string>;
  important_inventory_affordances: Array<{
    item_id: string;
    name: string;
    usable: boolean;
    effect_kind: string | null;
    summary: string;
  }>;
};

type TurnResponse = {
  turn_id: string;
  world_context?: WorldContext;
  action_type: "narrative" | "use_reward_item" | "travel";
  input_mode: "choice" | "free_text";
  event_id: string;
  memory_ids: string[];
  narrative: string;
  npc_reaction: string;
  sp_delta: number;
  sp_balance: number;
  sp_ledger_id: string;
  interpreted_intent: Record<string, unknown>;
  next_choices: NarrativeChoice[];
  consequence_summary: string;
  scene_tone: string;
  scene_summary: string;
  location_updates: Array<{
    actor_id: string;
    location_id: string;
    name: string;
    summary: string;
  }>;
  current_location: CurrentLocationSummary;
  travel_summary: string | null;
  quest_updates: Array<QuestSummary & { world_tags?: string[]; summary?: string }>;
  faction_updates: Array<FactionSummary & { delta?: number }>;
  inventory_updates: Array<InventorySummary & { action?: string }>;
  relationship_updates: Array<RelationshipSummary & { delta?: number }>;
  consequence_updates: Array<ConsequenceThreadSummary & { action?: string }>;
  scene_updates: Array<SceneSummaryValue & { action?: string }>;
  chapter_updates: ChapterSummaryValue[];
  branch_updates: Array<{
    action: string;
    route_key?: string | null;
    label?: string;
    summary: string;
    branch_hint?: string;
    crossroads_summary?: string;
  }>;
  ambient_updates: Array<{
    event_id: string;
    actor_id: string;
    display_name: string;
    beat_kind: string;
    summary: string;
  }>;
  recent_world_beats: string[];
  recent_offstage_beats: string[];
  crossroads_summary: string;
  idle_updates: Array<{
    event_id: string;
    actor_id: string;
    display_name: string;
    beat_kind: string;
    summary: string;
    moved?: boolean;
  }>;
};

type EventItem = {
  id: string;
  narrative: string;
  event_type: string;
  location_id: string | null;
  payload: Record<string, unknown>;
};

type MemoryItem = {
  id: string;
  scope: string;
  text: string;
  actor_id: string | null;
  location_id: string | null;
  salience: number;
};

type SPLedgerItem = {
  id: string;
  user_sub: string;
  world_id: string | null;
  actor_id: string | null;
  delta: number;
  reason_code: string;
  reference_type: string;
  reference_id: string;
  balance_after: number;
  created_by_sub: string | null;
  note: string | null;
  created_at: string;
  world_context?: WorldContext | null;
};

type SPWallet = {
  user_sub: string;
  balance: number;
  turn_cost: number;
  choice_turn_cost: number;
  free_text_turn_cost: number;
  budget_scope?: string;
  recent_entries: SPLedgerItem[];
};

type ProjectionStatus = {
  backend: string;
  space: string;
  pending: number;
  failed: number;
  projected: number;
  last_error: string | null;
  graph_read_mode: string;
  graph_runtime_status: string;
  recent_failures: Array<{
    id: string;
    event_id: string;
    world_id: string;
    world_context?: WorldContext | null;
    projection_type: string;
    last_error: string | null;
    attempts: number;
  }>;
};

type EmbeddingStatus = {
  provider: string;
  model: string;
  dimension: number;
  ready_count: number;
  pending_count: number;
  failed_count: number;
  runtime_status: string;
  runtime_error: string | null;
};

type MemorySearchResponse = {
  world_id: string;
  world_context: WorldContext;
  query: string;
  hits: Array<{
    id: string;
    text: string;
    scope: string;
    actor_id: string | null;
    location_id: string | null;
    salience: number;
    score: number;
  }>;
  trace: {
    status: string;
    query_text_hash: string;
    retrieved_memory_ids: string[];
    top_scores: number[];
    used_fallback: boolean;
  };
};

type MemoryReindexResult = {
  world_id: string | null;
  queued: number;
  processed: number;
  processed_memory_ids: string[];
  pending_count: number;
  failed_count: number;
  completed_at: string;
};

type GraphSummary = {
  world_id: string;
  world_context: WorldContext;
  vertex_count: number;
  edge_count: number;
  label_counts: Record<string, number>;
  recent_records: Array<{
    entity_key: string;
    projection_type: string;
    kind: string;
    label: string;
  }>;
  state_changes: Array<{
    entity_key: string;
    label: string;
    kind: string;
  }>;
  neighborhood_summary: string[];
};

type RelationshipOpsItem = {
  world_id: string;
  relationship_id: string;
  from_actor_id: string;
  from_actor_name: string;
  to_actor_id: string;
  to_actor_name: string;
  relationship_type: string;
  strength: number;
  band: string;
};

type ConsequenceThreadOpsItem = {
  id: string;
  world_id: string;
  owner_actor_id: string;
  owner_actor_name: string;
  counterpart_actor_id: string | null;
  counterpart_actor_name: string | null;
  thread_type: string;
  status: string;
  pressure_band: string;
  title: string;
  summary: string;
  updated_at: string;
  resolved_at: string | null;
};

type ChapterOpsItem = {
  id: string;
  world_id: string;
  owner_actor_id: string;
  owner_actor_name: string;
  chapter_key: string;
  status: string;
  summary: string;
  branch_key?: string | null;
  crossroads_status?: string;
  crossroads_summary?: string;
  committed_at?: string | null;
  updated_at: string;
  resolved_at: string | null;
};

type RoutePressureOpsItem = {
  world_id: string;
  owner_actor_id: string;
  owner_actor_name: string;
  chapter_key: string;
  route_key: string;
  label: string;
  pressure: number;
  band: string;
  last_signal: string;
  updated_at: string;
};

type ChapterBranchOpsItem = {
  chapter_id: string;
  owner_actor_id: string;
  owner_actor_name: string;
  chapter_key: string;
  status: string;
  branch_key: string | null;
  crossroads_status: string;
  crossroads_summary: string;
  committed_at: string | null;
  updated_at: string;
};

type SceneOpsItem = {
  id: string;
  world_id: string;
  owner_actor_id: string;
  owner_actor_name: string;
  chapter_track_id: string;
  scene_phase: string;
  status: string;
  stakes_summary: string;
  pressure_summary: string;
  updated_at: string;
  closed_at: string | null;
};

type NPCRoutineOpsItem = {
  actor_id: string;
  display_name: string;
  location_id: string | null;
  routine_state: Record<string, unknown>;
  updated_at: string;
};

type AmbientBeatOpsItem = {
  event_id: string;
  world_id: string;
  turn_id: string;
  session_id: string;
  beat_kind: string;
  display_name: string | null;
  actor_id: string | null;
  visible_summary: string | null;
  relationship_updates: Array<Record<string, unknown>>;
  consequence_updates: Array<Record<string, unknown>>;
  created_at: string;
};

type LocationOpsItem = {
  id: string;
  key: string;
  name: string;
  description: string;
  route_summaries?: Array<{
    route_key: string;
    destination_name: string;
    status: string;
    travel_summary: string;
  }>;
  routes?: Array<{
    route_key: string;
    destination_name: string;
    status: string;
    travel_summary: string;
    to_location_name?: string;
  }>;
};

type TravelLogItem = {
  event_id: string;
  turn_id: string;
  narrative?: string;
  travel_summary?: string;
  location_id: string | null;
  created_at: string;
};

type WorldTickItem = {
  tick_id: string;
  world_id: string;
  tick_kind: string;
  status: string;
  seed_turn_id: string | null;
  location_id: string | null;
  summary: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type RebuildSummary = {
  world_id: string;
  world_context: WorldContext;
  records: number;
  completed_at: string;
  vertex_count: number;
  edge_count: number;
};

type SPOverview = {
  default_balance: number;
  turn_cost: number;
  choice_turn_cost: number;
  free_text_turn_cost: number;
  total_accounts: number;
  total_ledger_entries: number;
  recent_adjustments: SPLedgerItem[];
};

type SPAdjustmentResponse = {
  ledger_entry_id: string;
  user_sub: string;
  delta: number;
  balance: number;
};

type EvalRunVariantSummary = {
  total: number;
  passed: number;
  failed: number;
  failed_case_ids: string[];
  gate_passed: boolean;
};

type EvalRunItem = {
  id: string;
  source_type: string;
  dataset_name: string | null;
  trigger_type: string;
  runtime_role: string;
  status: string;
  langfuse_trace_id?: string | null;
  langfuse_trace_url?: string | null;
  langfuse_status?: string;
  summary: {
    case_count: number;
    pack_scope?: PackScope[];
    variants?: {
      current?: EvalRunVariantSummary;
      candidate?: EvalRunVariantSummary;
    };
    comparison?: {
      passed_delta: number;
      current_failed_case_ids: string[];
      candidate_failed_case_ids: string[];
    };
  };
  started_at: string;
  completed_at: string | null;
};

type EvalRunCaseResult = {
  id: string;
  variant: string;
  case_id: string;
  prompt_id: string;
  model_id: string;
  lane: string;
  used_fallback: boolean;
  schema_valid: boolean;
  same_world_invariant: boolean;
  graph_context_status: string;
  passed: boolean;
  failure_reason: string | null;
  pack_context?: PackContext | null;
};

type EvalRunDetail = EvalRunItem & {
  results: EvalRunCaseResult[];
};

type ReleaseSLOSnapshot = {
  runtime_role: string;
  canary_health: {
    status: string;
    url: string | null;
    http_status: number | null;
    detail: string | null;
    graph_runtime_status: string | null;
    release_gate_verdict: string | null;
    projection_lag_seconds: number | null;
    outbox_pending_count: number | null;
    outbox_failed_count: number | null;
    llm_schema_valid_rate: number | null;
    llm_fallback_rate: number | null;
  };
  projection_lag_seconds: number;
  outbox_pending_count: number;
  outbox_failed_count: number;
  llm_schema_valid_rate: number;
  llm_fallback_rate: number;
};

type RouteDiff = {
  route_id: string;
  current: {
    prompt_id: string;
    default_lane: string;
    model_ids: Record<string, string>;
  } | null;
  candidate: {
    prompt_id: string;
    default_lane: string;
    model_ids: Record<string, string>;
  } | null;
};

type GateCheck = {
  present: boolean;
  current_passed: boolean;
  candidate_passed: boolean;
  run_id: string | null;
  pack_scope?: PackScope[];
};

type ReleaseGateReport = {
  report_id: string | null;
  verdict: string;
  blocked_reasons: string[];
  trigger_type: string;
  canary_promote_status: string;
  cutover_status?: {
    promote_ready: boolean;
    required_checks: string[];
    missing_or_failed_checks: string[];
    blocked_reasons: string[];
    bundled_pack_regressions: string[];
    manual_confirmation: string;
  };
  langfuse_trace_id?: string | null;
  langfuse_trace_url?: string | null;
  langfuse_status?: string;
  langfuse_delivery?: string;
  checks: {
    smoke: GateCheck;
    failure_injection: GateCheck;
    shadow_replay: GateCheck;
    pack_regressions: Record<string, GateCheck>;
  };
  runs: {
    smoke: string | null;
    failure_injection: string | null;
    shadow_replay: string | null;
    pack_regressions: Record<string, string | null>;
  };
  latest_runs?: {
    smoke: string | null;
    failure_injection: string | null;
    shadow_replay: string | null;
    pack_regressions: Record<string, string | null>;
  };
  slo_snapshot: ReleaseSLOSnapshot;
  diff_summary: RouteDiff[];
  shadow_failures: Array<{
    case_id: string;
    variant: string;
    lane: string;
    pack_context?: PackContext | null;
    graph_context_status: string;
    retrieval_status?: string;
    retrieval_hit_count?: number;
    failure_reason: string | null;
  }>;
  runbook: {
    canary_up: string;
    canary_probe?: string;
    pre_promote_checklist?: string;
    nightly_gate?: string;
    promote_condition?: string;
    rollback: string;
    promote: string;
  };
  created_at: string | null;
};

type CouncilRoleSummary = {
  council_role: string;
  stage_index: number;
  approval_status: string | null;
  prompt_id: string;
  model_id: string;
  model_lane: string;
  provider_name: string | null;
  provider_response_id: string | null;
  output_schema_status: string;
  langfuse_trace_id?: string | null;
  langfuse_observation_id?: string | null;
  langfuse_trace_url?: string | null;
  langfuse_status?: string;
  failure_reason: string | null;
  attempts?: Array<{
    id: string;
    model_lane: string;
    model_id: string;
    provider_name: string | null;
    provider_response_id: string | null;
    approval_status: string | null;
    output_schema_status: string;
    langfuse_trace_id?: string | null;
    langfuse_observation_id?: string | null;
    langfuse_trace_url?: string | null;
    langfuse_status?: string;
    output_payload: Record<string, unknown>;
    created_at: string;
  }>;
};

type CouncilTurnTrace = {
  turn_id: string;
  session_id: string;
  world_id: string;
  world_context?: WorldContext | null;
  input_text: string;
  model_lane: string;
  resolution_mode: string;
  resolved_output: Record<string, unknown>;
  created_at: string;
  langfuse_trace_id?: string | null;
  langfuse_trace_url?: string | null;
  langfuse_status?: string;
  roles: CouncilRoleSummary[];
};

type ObservabilitySummary = {
  snapshot_id?: string | null;
  primary: {
    runtime_role: string;
    graph_runtime_status: string;
    graph_read_mode: string;
    projection_lag_seconds: number;
    outbox_pending_count: number;
    outbox_failed_count: number;
    llm_schema_valid_rate: number;
    llm_fallback_rate: number;
  };
  canary: {
    status: string;
    url: string | null;
    http_status: number | null;
    detail: string | null;
    graph_runtime_status: string | null;
    release_gate_verdict: string | null;
    projection_lag_seconds: number | null;
    outbox_pending_count: number | null;
    outbox_failed_count: number | null;
    llm_schema_valid_rate: number | null;
    llm_fallback_rate: number | null;
  };
  langfuse: LangfuseStatus;
  recent_traces: Array<{
    name: string;
    attributes: Record<string, unknown>;
  }>;
  metrics: Record<string, number>;
};

type ObservabilitySnapshotItem = {
  id: string;
  snapshot_kind: string;
  runtime_role: string;
  pack_id: string | null;
  pack_display_name: string | null;
  world_template_id: string | null;
  world_template_display_name: string | null;
  release_gate_report_id: string | null;
  primary_slo: {
    projection_lag_seconds?: number;
    outbox_failed_count?: number;
    llm_schema_valid_rate?: number;
    llm_fallback_rate?: number;
  };
  canary_health: {
    status?: string;
    release_gate_verdict?: string | null;
  };
  trace_count: number;
  created_at: string;
};

type ObservabilitySnapshotList = {
  items: ObservabilitySnapshotItem[];
};

type ActivityMessage = {
  event: string;
  data: Record<string, unknown> & { world_context: WorldContext };
};

type APIError = Error & {
  status?: number;
  body?: unknown;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

function resolveRoute(): AppRoute {
  return window.location.pathname.startsWith("/admin") ? "admin" : "game";
}

function formatPackScope(scope?: PackScope[] | null): string {
  if (!scope?.length) {
    return "unknown pack / unknown template";
  }
  return scope
    .map((item) => `${item.pack_display_name} / ${item.world_template_display_name}`)
    .join(" | ");
}

function formatPackContext(context?: PackContext | null): string {
  if (!context) {
    return "unknown pack / unknown template";
  }
  const worldSuffix = context.world_id ? ` / ${context.world_id}` : "";
  return `${context.pack_display_name} / ${context.world_template_display_name}${worldSuffix}`;
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
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

function packScopeMatches(scope: PackScope[] | undefined | null, packId: string, templateId: string): boolean {
  if (!packId && !templateId) {
    return true;
  }
  return (scope ?? []).some((item) => packContextMatches(item, packId, templateId));
}

function packContextMatches(
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

function traceMatchesOpsScope(attributes: Record<string, unknown>, packId: string, templateId: string): boolean {
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

function packFailureSeverityRank(severity: string): number {
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

function deriveImportantInventoryAffordances(inventory: InventorySummary[]): SessionState["important_inventory_affordances"] {
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

function mergeTurnResponseIntoSessionState(current: SessionState | null, response: TurnResponse): SessionState | null {
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

function locationRouteSummaries(item: LocationOpsItem): Array<{
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

async function apiFetch<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown = null;
    let message = `Request failed: ${response.status}`;
    if (contentType.includes("application/json")) {
      body = (await response.json()) as unknown;
      if (typeof body === "object" && body !== null && "detail" in body) {
        const detail = (body as { detail?: unknown }).detail;
        if (typeof detail === "string") {
          message = detail;
        }
      }
    } else {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }
    const error = new Error(message) as APIError;
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return (await response.json()) as T;
}

function formatError(error: unknown): string {
  const typed = error as APIError;
  if (typed.status === 409 && typed.body && typeof typed.body === "object") {
    const body = typed.body as {
      detail?: string;
      balance?: number;
      required?: number;
      turn_cost?: number;
    };
    if (typeof body.detail === "string") {
      return `${body.detail} (balance: ${body.balance ?? "?"}, required: ${body.required ?? body.turn_cost ?? "?"})`;
    }
  }
  if (typed.message) {
    return typed.message;
  }
  return String(error);
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => resolveRoute());
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState("");
  const [me, setMe] = useState<AuthMe | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [wallet, setWallet] = useState<SPWallet | null>(null);
  const [worldId, setWorldId] = useState("");
  const [opsWorldId, setOpsWorldId] = useState("");
  const [playableWorlds, setPlayableWorlds] = useState<PlayableWorldItem[]>([]);
  const [worldCatalogStatus, setWorldCatalogStatus] = useState("unknown");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [turnInputMode, setTurnInputMode] = useState<"choice" | "free_text">("choice");
  const [freeTextInput, setFreeTextInput] = useState("広場で旅人を助け、周囲の様子を確かめる");
  const [latestNarrative, setLatestNarrative] = useState("");
  const [latestReaction, setLatestReaction] = useState("");
  const [latestConsequenceSummary, setLatestConsequenceSummary] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [activity, setActivity] = useState<ActivityMessage[]>([]);
  const [projectionStatus, setProjectionStatus] = useState<ProjectionStatus | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);
  const [graphSummary, setGraphSummary] = useState<GraphSummary | null>(null);
  const [relationshipOps, setRelationshipOps] = useState<RelationshipOpsItem[]>([]);
  const [consequenceThreadOps, setConsequenceThreadOps] = useState<ConsequenceThreadOpsItem[]>([]);
  const [chapterOps, setChapterOps] = useState<ChapterOpsItem[]>([]);
  const [routePressureOps, setRoutePressureOps] = useState<RoutePressureOpsItem[]>([]);
  const [chapterBranchOps, setChapterBranchOps] = useState<ChapterBranchOpsItem[]>([]);
  const [sceneOps, setSceneOps] = useState<SceneOpsItem[]>([]);
  const [locationOps, setLocationOps] = useState<LocationOpsItem[]>([]);
  const [travelLogOps, setTravelLogOps] = useState<TravelLogItem[]>([]);
  const [npcRoutineOps, setNpcRoutineOps] = useState<NPCRoutineOpsItem[]>([]);
  const [ambientBeatOps, setAmbientBeatOps] = useState<AmbientBeatOpsItem[]>([]);
  const [worldTickOps, setWorldTickOps] = useState<WorldTickItem[]>([]);
  const [npcLocationOps, setNpcLocationOps] = useState<NPCLocationSummary[]>([]);
  const [offstageBeatOps, setOffstageBeatOps] = useState<AmbientBeatOpsItem[]>([]);
  const [opsWorlds, setOpsWorlds] = useState<OpsWorldItem[]>([]);
  const [opsPackCatalog, setOpsPackCatalog] = useState<OpsWorldPackCatalog | null>(null);
  const [opsPackFilter, setOpsPackFilter] = useState("");
  const [opsTemplateFilter, setOpsTemplateFilter] = useState("");
  const [observability, setObservability] = useState<ObservabilitySummary | null>(null);
  const [observabilitySnapshots, setObservabilitySnapshots] = useState<ObservabilitySnapshotItem[]>([]);
  const [spOverview, setSpOverview] = useState<SPOverview | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<SPLedgerItem[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvalRunItem[]>([]);
  const [evalRunDetail, setEvalRunDetail] = useState<EvalRunDetail | null>(null);
  const [releaseGate, setReleaseGate] = useState<ReleaseGateReport | null>(null);
  const [councilTurns, setCouncilTurns] = useState<CouncilTurnTrace[]>([]);
  const [opsState, setOpsState] = useState("idle");
  const [lastRebuild, setLastRebuild] = useState<RebuildSummary | null>(null);
  const [lastMemoryReindex, setLastMemoryReindex] = useState<MemoryReindexResult | null>(null);
  const [lastAdjustment, setLastAdjustment] = useState<SPAdjustmentResponse | null>(null);
  const [memorySearchQuery, setMemorySearchQuery] = useState("旅人を助けた");
  const [memorySearchResult, setMemorySearchResult] = useState<MemorySearchResponse | null>(null);
  const [ledgerUserFilter, setLedgerUserFilter] = useState("");
  const [ledgerWorldFilter, setLedgerWorldFilter] = useState("");
  const [adjustUserSub, setAdjustUserSub] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("-1");
  const [adjustReason, setAdjustReason] = useState("admin_adjustment");
  const [adjustWorldId, setAdjustWorldId] = useState("");
  const [adjustNote, setAdjustNote] = useState("Phase E admin adjustment");
  const [error, setError] = useState("");
  const [turnPending, setTurnPending] = useState(false);
  const [rebuildPending, setRebuildPending] = useState(false);
  const [memorySearchPending, setMemorySearchPending] = useState(false);
  const [memoryReindexPending, setMemoryReindexPending] = useState(false);
  const [adjustPending, setAdjustPending] = useState(false);
  const [evalPending, setEvalPending] = useState(false);
  const [checklistPending, setChecklistPending] = useState(false);
  const [idlePassPending, setIdlePassPending] = useState(false);
  const [socketState, setSocketState] = useState("idle");
  const socketRef = useRef<WebSocket | null>(null);

  const statusText = !ready ? "initializing" : authenticated ? "authenticated" : "signed-out";
  const activeWorldId = route === "admin" ? (opsWorldId || session?.world_id || worldId) : (session?.world_id ?? worldId);
  const activeQuest = sessionState?.quests.find((item) => item.status === "active") ?? sessionState?.quests[0] ?? null;
  const selectedWorld = playableWorlds.find((item) => item.world_id === worldId) ?? null;
  const worldCatalogUnavailable = worldCatalogStatus === "error";
  const visibleOpsWorlds = opsWorlds.filter((item) => {
    const context = item.world_context;
    return (
      (!opsPackFilter || context.pack_id === opsPackFilter) &&
      (!opsTemplateFilter || context.world_template_id === opsTemplateFilter)
    );
  });
  const opsTemplateOptions = (
    opsPackFilter
      ? (opsPackCatalog?.items.find((item) => item.pack_id === opsPackFilter)?.world_templates ?? [])
      : (opsPackCatalog?.items.flatMap((item) => item.world_templates) ?? [])
  ).filter(
    (template, index, templates) =>
      templates.findIndex((item) => item.template_id === template.template_id) === index,
  );
  const activeWorldContext =
    graphSummary?.world_context ??
    opsWorlds.find((item) => item.world_context.world_id === activeWorldId)?.world_context ??
    sessionState?.world_context ??
    session?.world_context ??
    null;
  const opsScopeLabel = `${opsPackFilter || "all packs"} / ${opsTemplateFilter || "all templates"}`;
  const opsCatalogStatus = opsPackCatalog?.status ?? health?.world_packs?.status ?? "unknown";
  const opsCatalogPackCount = opsPackCatalog?.pack_count ?? health?.world_packs?.pack_count ?? 0;
  const opsCatalogTemplateCount = opsPackCatalog?.template_count ?? health?.world_packs?.template_count ?? 0;
  const opsCatalogFailureCount = opsPackCatalog?.failure_count ?? health?.world_packs?.failure_count ?? 0;
  const selectedAdminWorldLabel = activeWorldContext
    ? `${activeWorldContext.world_name} / ${activeWorldContext.pack_display_name} / ${activeWorldContext.world_template_display_name}`
    : (activeWorldId || "none");
  const sortedOpsPackFailures = [...(opsPackCatalog?.failures ?? [])].sort((left, right) => {
    const severityDelta = packFailureSeverityRank(left.severity) - packFailureSeverityRank(right.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return `${left.pack_id ?? ""}${left.error}`.localeCompare(`${right.pack_id ?? ""}${right.error}`);
  });
  const filteredReleasePackRegressions = Object.entries(releaseGate?.checks?.pack_regressions ?? {}).filter(([, check]) =>
    packScopeMatches(check.pack_scope, opsPackFilter, opsTemplateFilter),
  );
  const filteredShadowFailures = (releaseGate?.shadow_failures ?? []).filter((item) =>
    packContextMatches(item.pack_context, opsPackFilter, opsTemplateFilter),
  );
  const filteredRecentTraces = (observability?.recent_traces ?? []).filter((item) =>
    traceMatchesOpsScope(item.attributes, opsPackFilter, opsTemplateFilter),
  );
  const visibleObservabilitySnapshots = observabilitySnapshots.filter((item) =>
    packContextMatches(
      {
        pack_id: item.pack_id ?? "",
        world_template_id: item.world_template_id ?? "",
      },
      opsPackFilter,
      opsTemplateFilter,
    ),
  );
  const suggestedChoices = sessionState?.next_choices ?? [];
  const latestRetrievalTrace = (councilTurns[0]?.resolved_output?.retrieval_trace ?? null) as
    | {
        status?: string;
        query_text_hash?: string;
        retrieved_memory_ids?: string[];
        top_scores?: number[];
        used_fallback?: boolean;
      }
    | null;

  useEffect(() => {
    const handlePopState = () => setRoute(resolveRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    void refreshHealth();

    keycloak
      .init({
        onLoad: "check-sso",
        pkceMethod: "S256",
      })
      .then((isAuthenticated: boolean) => {
        setAuthenticated(isAuthenticated);
        setToken(keycloak.token ?? "");
      })
      .catch((initError: unknown) => {
        setError(String(initError));
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!authenticated || !token) {
      setMe(null);
      setWallet(null);
      setPlayableWorlds([]);
      setWorldCatalogStatus("unknown");
      setSessionState(null);
      setProjectionStatus(null);
      setEmbeddingStatus(null);
      setGraphSummary(null);
      setRelationshipOps([]);
      setConsequenceThreadOps([]);
      setChapterOps([]);
      setRoutePressureOps([]);
      setChapterBranchOps([]);
      setSceneOps([]);
      setLocationOps([]);
      setTravelLogOps([]);
      setNpcRoutineOps([]);
      setAmbientBeatOps([]);
      setWorldTickOps([]);
      setNpcLocationOps([]);
      setOffstageBeatOps([]);
      setOpsWorlds([]);
      setOpsPackCatalog(null);
      setOpsPackFilter("");
      setOpsTemplateFilter("");
      setObservability(null);
      setObservabilitySnapshots([]);
      setSpOverview(null);
      setLedgerEntries([]);
      setEvalRuns([]);
      setEvalRunDetail(null);
      setReleaseGate(null);
      setCouncilTurns([]);
      setMemorySearchResult(null);
      setOpsState("idle");
      return;
    }

    void Promise.all([
      apiFetch<AuthMe>("/auth/me", token),
      apiFetch<SPWallet>("/economy/sp/me", token),
      apiFetch<PlayableWorldCatalog>("/worlds/playable", token),
    ])
      .then(([mePayload, walletPayload, worldPayload]) => {
        setMe(mePayload);
        setWallet(walletPayload);
        setPlayableWorlds(worldPayload.items);
        setWorldCatalogStatus(worldPayload.status);
        if (worldPayload.status === "error") {
          setError("Playable world catalog unavailable");
        }
        const firstPlayableWorld = worldPayload.items.find((item) => item.status === "playable") ?? worldPayload.items[0];
        setWorldId((current) =>
          worldPayload.items.some((item) => item.world_id === current) ? current : (firstPlayableWorld?.world_id ?? ""),
        );
        setLedgerUserFilter((current) => current || walletPayload.user_sub);
        setAdjustUserSub((current) => current || walletPayload.user_sub);
      })
      .catch((requestError: unknown) => setError(formatError(requestError)));
  }, [authenticated, token]);

  useEffect(() => {
    if (!playableWorlds.length || playableWorlds.some((item) => item.world_id === worldId)) {
      return;
    }
    setWorldId(playableWorlds[0].world_id);
  }, [playableWorlds, worldId]);

  useEffect(() => {
    setAdjustWorldId(session?.world_id ?? worldId);
  }, [session, worldId]);

  useEffect(() => {
    if (opsWorldId && visibleOpsWorlds.some((item) => item.world_context.world_id === opsWorldId)) {
      return;
    }
    const sessionWorldIsVisible = visibleOpsWorlds.some((item) => item.world_context.world_id === session?.world_id);
    const nextWorldId = !opsWorlds.length
      ? (session?.world_id ?? "")
      : ((sessionWorldIsVisible ? session?.world_id : visibleOpsWorlds[0]?.world_context.world_id) || "");
    if (nextWorldId !== opsWorldId) {
      setOpsWorldId(nextWorldId);
      setLedgerWorldFilter(nextWorldId);
      setAdjustWorldId(nextWorldId);
    }
  }, [opsWorldId, opsPackFilter, opsTemplateFilter, opsWorlds, session?.world_id]);

  useEffect(() => {
    if (!session || !token) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      if (!session) {
        setSessionState(null);
      }
      setSocketState("idle");
      return;
    }

    setSocketState("connecting");
    const socket = new WebSocket(`${session.websocket_url}?token=${encodeURIComponent(token)}`);
    socket.onopen = () => setSocketState("open");
    socket.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as ActivityMessage;
      setActivity((current) => [parsed, ...current].slice(0, 40));
      if (parsed.event === "turn.resolved") {
        const data = parsed.data as Partial<TurnResponse>;
        if (data.narrative) {
          setLatestNarrative(data.narrative);
        }
        if (data.npc_reaction) {
          setLatestReaction(data.npc_reaction);
        }
        if (data.consequence_summary) {
          setLatestConsequenceSummary(data.consequence_summary);
        }
        if (data.scene_summary && !latestConsequenceSummary) {
          setLatestConsequenceSummary(data.scene_summary);
        }
      }
      if (parsed.event === "graph.projection.updated") {
        void refreshAdminData(
          token,
          session.world_id,
          ledgerUserFilter,
          ledgerWorldFilter || session.world_id,
          session.session_id,
        );
      }
      if (parsed.event === "idle.updated") {
        void Promise.all([
          refreshWorldState(session, token),
          refreshAdminData(
            token,
            session.world_id,
            ledgerUserFilter,
            ledgerWorldFilter || session.world_id,
            session.session_id,
          ),
        ]);
      }
    };
    socket.onerror = () => {
      setSocketState("error");
      setError("WebSocket connection failed");
    };
    socket.onclose = () => {
      setSocketState("closed");
    };
    socketRef.current = socket;

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [session, token, ledgerUserFilter, ledgerWorldFilter]);

  async function refreshHealth() {
    try {
      const payload = await apiFetch<HealthPayload>("/health");
      setHealth(payload);
    } catch {
      setHealth(null);
    }
  }

  async function refreshWallet(currentToken: string) {
    const payload = await apiFetch<SPWallet>("/economy/sp/me", currentToken);
    setWallet(payload);
    return payload;
  }

  async function refreshWorldState(currentSession: SessionInfo, currentToken: string) {
    const [eventsResponse, memoriesResponse, stateResponse] = await Promise.all([
      apiFetch<{ items: EventItem[] }>(`/worlds/${currentSession.world_id}/events`, currentToken),
      apiFetch<{ items: MemoryItem[] }>(`/worlds/${currentSession.world_id}/memories`, currentToken),
      apiFetch<SessionState>(`/sessions/${currentSession.session_id}/state`, currentToken),
    ]);
    setEvents(eventsResponse.items);
    setMemories(memoriesResponse.items);
    setSessionState(stateResponse);
  }

  async function refreshAdminData(
    currentToken: string,
    currentWorldId?: string,
    currentLedgerUserFilter?: string,
    currentLedgerWorldFilter?: string,
    currentSessionId?: string,
    currentPackFilter = opsPackFilter,
    currentTemplateFilter = opsTemplateFilter,
  ) {
    if (!currentToken) {
      setProjectionStatus(null);
      setEmbeddingStatus(null);
      setGraphSummary(null);
      setRelationshipOps([]);
      setConsequenceThreadOps([]);
      setChapterOps([]);
      setRoutePressureOps([]);
      setChapterBranchOps([]);
      setSceneOps([]);
      setObservability(null);
      setObservabilitySnapshots([]);
      setSpOverview(null);
      setLedgerEntries([]);
      setCouncilTurns([]);
      setMemorySearchResult(null);
      setOpsState("idle");
      return;
    }

    try {
      const scopeQuery = {
        pack_id: currentPackFilter,
        world_template_id: currentTemplateFilter,
      };
      const scopedSessionId = currentSessionId && session?.world_id === currentWorldId ? currentSessionId : undefined;
      const [
        statusPayload,
        embeddingPayload,
        observabilityPayload,
        overviewPayload,
        ledgerPayload,
        evalRunsPayload,
        gatePayload,
        councilPayload,
        worldsPayload,
        packCatalogPayload,
      ] = await Promise.all([
        apiFetch<ProjectionStatus>("/ops/projection/status", currentToken),
        apiFetch<EmbeddingStatus>("/ops/memories/status", currentToken),
        apiFetch<ObservabilitySummary>(`/ops/observability/summary${buildQuery(scopeQuery)}`, currentToken),
        apiFetch<SPOverview>("/ops/sp/overview", currentToken),
        apiFetch<{ items: SPLedgerItem[] }>(
          `/ops/sp/ledger?limit=20${currentLedgerUserFilter ? `&user_sub=${encodeURIComponent(currentLedgerUserFilter)}` : ""}${currentLedgerWorldFilter ? `&world_id=${encodeURIComponent(currentLedgerWorldFilter)}` : ""}`,
          currentToken,
        ),
        apiFetch<{ items: EvalRunItem[] }>(`/ops/evals/runs${buildQuery({ limit: 8, ...scopeQuery })}`, currentToken),
        apiFetch<ReleaseGateReport>(`/ops/release/checklists/latest${buildQuery(scopeQuery)}`, currentToken),
        apiFetch<{ items: CouncilTurnTrace[] }>(
          `/ops/council/turns${buildQuery({ limit: 8, world_id: currentWorldId, session_id: scopedSessionId })}`,
          currentToken,
        ),
        apiFetch<{ items: OpsWorldItem[] }>(`/ops/worlds${buildQuery(scopeQuery)}`, currentToken),
        apiFetch<OpsWorldPackCatalog>("/ops/world-packs", currentToken),
      ]);
      const snapshotsPayload = await apiFetch<ObservabilitySnapshotList>(
        `/ops/observability/snapshots${buildQuery({ limit: 12, ...scopeQuery })}`,
        currentToken,
      );
      setProjectionStatus(statusPayload);
      setEmbeddingStatus(embeddingPayload);
      setObservability(observabilityPayload);
      setObservabilitySnapshots(snapshotsPayload.items);
      setSpOverview(overviewPayload);
      setLedgerEntries(ledgerPayload.items);
      setEvalRuns(evalRunsPayload.items);
      const latestEvalRunId = evalRunsPayload.items[0]?.id;
      setEvalRunDetail(
        latestEvalRunId
          ? await apiFetch<EvalRunDetail>(`/ops/evals/runs/${latestEvalRunId}${buildQuery(scopeQuery)}`, currentToken)
          : null,
      );
      setReleaseGate(gatePayload);
      setCouncilTurns(councilPayload.items);
      setOpsWorlds(worldsPayload.items);
      setOpsPackCatalog(packCatalogPayload);
      setOpsState("ready");
    } catch (requestError) {
      const typedError = requestError as APIError;
      if (typedError.status === 403) {
        setOpsState("restricted");
        setProjectionStatus(null);
        setEmbeddingStatus(null);
        setGraphSummary(null);
        setRelationshipOps([]);
        setConsequenceThreadOps([]);
        setChapterOps([]);
        setRoutePressureOps([]);
        setChapterBranchOps([]);
        setSceneOps([]);
        setLocationOps([]);
        setTravelLogOps([]);
        setNpcRoutineOps([]);
        setAmbientBeatOps([]);
        setWorldTickOps([]);
        setNpcLocationOps([]);
        setOffstageBeatOps([]);
        setOpsWorlds([]);
        setOpsPackCatalog(null);
        setObservability(null);
        setObservabilitySnapshots([]);
        setSpOverview(null);
        setLedgerEntries([]);
        setEvalRuns([]);
        setEvalRunDetail(null);
        setReleaseGate(null);
        setCouncilTurns([]);
        setMemorySearchResult(null);
        return;
      }
      setOpsState("unavailable");
      setProjectionStatus(null);
      setEmbeddingStatus(null);
      setGraphSummary(null);
      setRelationshipOps([]);
      setConsequenceThreadOps([]);
      setChapterOps([]);
      setRoutePressureOps([]);
      setChapterBranchOps([]);
      setSceneOps([]);
      setNpcRoutineOps([]);
      setAmbientBeatOps([]);
      setOpsPackCatalog(null);
      setObservability(null);
      setObservabilitySnapshots([]);
      setSpOverview(null);
      setLedgerEntries([]);
      setEvalRuns([]);
      setEvalRunDetail(null);
      setReleaseGate(null);
      setCouncilTurns([]);
      setMemorySearchResult(null);
      return;
    }

    if (!currentWorldId) {
      setGraphSummary(null);
      setRelationshipOps([]);
      setConsequenceThreadOps([]);
      setChapterOps([]);
      setRoutePressureOps([]);
      setChapterBranchOps([]);
      setSceneOps([]);
      setLocationOps([]);
      setTravelLogOps([]);
      setNpcRoutineOps([]);
      setAmbientBeatOps([]);
      setWorldTickOps([]);
      setNpcLocationOps([]);
      setOffstageBeatOps([]);
      setOpsWorlds([]);
      return;
    }

    try {
      const [
        summaryPayload,
        relationshipPayload,
        threadPayload,
        chapterPayload,
        chapterBranchPayload,
        routePressurePayload,
        scenePayload,
        locationPayload,
        travelLogPayload,
        npcRoutinePayload,
        ambientBeatPayload,
        worldTickPayload,
        npcLocationPayload,
        offstageBeatPayload,
      ] = await Promise.all([
        apiFetch<GraphSummary>(`/ops/worlds/${currentWorldId}/graph-summary`, currentToken),
        apiFetch<{ items: RelationshipOpsItem[] }>(`/ops/worlds/${currentWorldId}/relationships`, currentToken),
        apiFetch<{ items: ConsequenceThreadOpsItem[] }>(`/ops/worlds/${currentWorldId}/consequence-threads`, currentToken),
        apiFetch<{ items: ChapterOpsItem[] }>(`/ops/worlds/${currentWorldId}/chapters`, currentToken),
        apiFetch<{ items: ChapterBranchOpsItem[] }>(`/ops/worlds/${currentWorldId}/chapter-branches`, currentToken),
        apiFetch<{ items: RoutePressureOpsItem[] }>(`/ops/worlds/${currentWorldId}/route-pressures`, currentToken),
        apiFetch<{ items: SceneOpsItem[] }>(`/ops/worlds/${currentWorldId}/scenes`, currentToken),
        apiFetch<{ items: LocationOpsItem[] }>(`/ops/worlds/${currentWorldId}/locations`, currentToken),
        apiFetch<{ items: TravelLogItem[] }>(`/ops/worlds/${currentWorldId}/travel-log`, currentToken),
        apiFetch<{ items: NPCRoutineOpsItem[] }>(`/ops/worlds/${currentWorldId}/npc-routines`, currentToken),
        apiFetch<{ items: AmbientBeatOpsItem[] }>(`/ops/worlds/${currentWorldId}/ambient-beats`, currentToken),
        apiFetch<{ items: WorldTickItem[] }>(`/ops/worlds/${currentWorldId}/world-ticks`, currentToken),
        apiFetch<{ items: NPCLocationSummary[] }>(`/ops/worlds/${currentWorldId}/npc-locations`, currentToken),
        apiFetch<{ items: AmbientBeatOpsItem[] }>(`/ops/worlds/${currentWorldId}/offstage-beats`, currentToken),
      ]);
      setGraphSummary(summaryPayload);
      setRelationshipOps(relationshipPayload.items);
      setConsequenceThreadOps(threadPayload.items);
      setChapterOps(chapterPayload.items);
      setChapterBranchOps(chapterBranchPayload.items);
      setRoutePressureOps(routePressurePayload.items);
      setSceneOps(scenePayload.items);
      setLocationOps(locationPayload.items);
      setTravelLogOps(travelLogPayload.items);
      setNpcRoutineOps(npcRoutinePayload.items);
      setAmbientBeatOps(ambientBeatPayload.items);
      setWorldTickOps(worldTickPayload.items);
      setNpcLocationOps(npcLocationPayload.items);
      setOffstageBeatOps(offstageBeatPayload.items);
    } catch (requestError) {
      const typedError = requestError as APIError;
      if (typedError.status === 403) {
        setOpsState("restricted");
      } else {
        setOpsState("unavailable");
      }
      setGraphSummary(null);
      setRelationshipOps([]);
      setConsequenceThreadOps([]);
      setChapterOps([]);
      setRoutePressureOps([]);
      setChapterBranchOps([]);
      setSceneOps([]);
      setLocationOps([]);
      setTravelLogOps([]);
      setNpcRoutineOps([]);
      setAmbientBeatOps([]);
      setWorldTickOps([]);
      setNpcLocationOps([]);
      setOffstageBeatOps([]);
      setOpsWorlds([]);
    }
  }

  function navigate(nextRoute: AppRoute) {
    const path = nextRoute === "admin" ? "/admin" : "/";
    window.history.pushState({}, "", path);
    setRoute(nextRoute);
  }

  async function handleLogin() {
    await keycloak.login();
  }

  async function handleLogout() {
    await keycloak.logout({ redirectUri: `${window.location.origin}/` });
  }

  async function handleStartSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("Sign in before starting a world session");
      return;
    }
    if (worldCatalogUnavailable) {
      setError("Playable world catalog is unavailable");
      return;
    }
    if (!selectedWorld || selectedWorld.status !== "playable") {
      setError("Choose a playable world before starting a session");
      return;
    }

    try {
      setError("");
      setActivity([]);
      setLatestNarrative("");
      setLatestReaction("");
      setLatestConsequenceSummary("");
      setLastRebuild(null);
      const created = await apiFetch<SessionInfo>("/sessions", token, {
        method: "POST",
        body: JSON.stringify({
          world_id: worldId,
        }),
      });
      setSession(created);
      setOpsWorldId(created.world_id);
      setLedgerWorldFilter(created.world_id);
      setAdjustWorldId(created.world_id);
      await Promise.all([
        refreshWorldState(created, token),
        refreshWallet(token),
        refreshAdminData(token, created.world_id, ledgerUserFilter || me?.sub, created.world_id, created.session_id),
        refreshHealth(),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  async function submitTurnRequest(
    payload:
      | { input_mode: "choice"; choice_id: "safe" | "progress" | "explore" }
      | { input_mode: "free_text"; input_text: string },
  ) {
    if (!token || !session) {
      setError("Start a session first");
      return;
    }

    try {
      setTurnPending(true);
      setError("");
      const response = await apiFetch<TurnResponse>("/turns", token, {
        method: "POST",
        body: JSON.stringify({
          session_id: session.session_id,
          ...payload,
        }),
      });
      setLatestNarrative(response.narrative);
      setLatestReaction(response.npc_reaction);
      setLatestConsequenceSummary(response.consequence_summary);
      setTurnInputMode("choice");
      setSessionState((current) => mergeTurnResponseIntoSessionState(current, response));
      setWallet((current) =>
        current
          ? {
              ...current,
              balance: response.sp_balance,
            }
          : current,
      );
      setTurnPending(false);
      await refreshWorldState(session, token);
      const backgroundRefresh = Promise.all([
        refreshWallet(token),
        refreshAdminData(
          token,
          session.world_id,
          ledgerUserFilter || me?.sub,
          ledgerWorldFilter || session.world_id,
          session.session_id,
        ),
        refreshHealth(),
      ]).catch((requestError: unknown) => {
        setError(formatError(requestError));
      });
      void backgroundRefresh;
      return;
    } catch (requestError) {
      setError(formatError(requestError));
      setTurnPending(false);
      await Promise.all([
        refreshWallet(token),
        refreshAdminData(
          token,
          session.world_id,
          ledgerUserFilter || me?.sub,
          ledgerWorldFilter || session.world_id,
          session.session_id,
        ),
        refreshHealth(),
      ]);
      return;
    }
  }

  async function handleTurnSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitTurnRequest({ input_mode: "free_text", input_text: freeTextInput });
  }

  async function handleChoiceSubmit(choiceId: "safe" | "progress" | "explore") {
    await submitTurnRequest({ input_mode: "choice", choice_id: choiceId });
  }

  async function handleRebuildGraph() {
    if (!token || !activeWorldId) {
      setError("Choose a world before rebuilding the graph");
      return;
    }

    try {
      setRebuildPending(true);
      setError("");
      const rebuilt = await apiFetch<RebuildSummary>("/ops/projection/rebuild", token, {
        method: "POST",
        body: JSON.stringify({ world_id: activeWorldId }),
      });
      setLastRebuild(rebuilt);
      setActivity((current) => [
        { event: "ops.projection.rebuild", data: rebuilt },
        ...current,
      ].slice(0, 40));
      await Promise.all([
        refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id),
        refreshHealth(),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setRebuildPending(false);
    }
  }

  async function handleIdlePass() {
    if (!token || !activeWorldId) {
      setError("Choose a world before triggering an idle pass");
      return;
    }

    try {
      setIdlePassPending(true);
      setError("");
      const response = await apiFetch<{
        world_id: string;
        tick: {
          tick_id: string;
          status: string;
          summary: string;
          location_id: string | null;
          langfuse_status: string;
        };
        idle_updates: Array<Record<string, unknown>>;
        world_context: WorldContext;
      }>(`/ops/worlds/${activeWorldId}/idle-pass`, token, { method: "POST" });
      setActivity((current) => [
        { event: "ops.idle-pass", data: response },
        ...current,
      ].slice(0, 40));
      await Promise.all([
        session ? refreshWorldState(session, token) : Promise.resolve(),
        refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setIdlePassPending(false);
    }
  }

  async function runMemorySearch(currentToken: string, currentWorldId: string) {
    const response = await apiFetch<MemorySearchResponse>(
      `/ops/worlds/${currentWorldId}/memory-search?query=${encodeURIComponent(memorySearchQuery)}&limit=6`,
      currentToken,
    );
    setMemorySearchResult(response);
  }

  async function handleMemorySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !activeWorldId) {
      setError("Choose a world before running memory search");
      return;
    }

    try {
      setMemorySearchPending(true);
      setError("");
      await runMemorySearch(token, activeWorldId);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setMemorySearchPending(false);
    }
  }

  async function handleMemoryReindex() {
    if (!token || !activeWorldId) {
      setError("Choose a world before reindexing memories");
      return;
    }

    try {
      setMemoryReindexPending(true);
      setError("");
      const response = await apiFetch<MemoryReindexResult>("/ops/memories/reindex", token, {
        method: "POST",
        body: JSON.stringify({ world_id: activeWorldId, limit: 100 }),
      });
      setLastMemoryReindex(response);
      await refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
      await runMemorySearch(token, activeWorldId);
      await refreshHealth();
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setMemoryReindexPending(false);
    }
  }

  async function handleLedgerRefresh(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    try {
      setError("");
      await refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter, session?.session_id);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  async function handleAdjustmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("Sign in before applying adjustments");
      return;
    }

    try {
      setAdjustPending(true);
      setError("");
      const response = await apiFetch<SPAdjustmentResponse>("/ops/sp/adjustments", token, {
        method: "POST",
        body: JSON.stringify({
          user_sub: adjustUserSub,
          delta: Number(adjustDelta),
          reason_code: adjustReason,
          world_id: adjustWorldId || null,
          actor_id: null,
          note: adjustNote || null,
        }),
      });
      setLastAdjustment(response);
      await Promise.all([
        refreshWallet(token),
        refreshAdminData(
          token,
          activeWorldId,
          ledgerUserFilter || adjustUserSub,
          ledgerWorldFilter || adjustWorldId,
          session?.session_id,
        ),
        refreshHealth(),
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setAdjustPending(false);
    }
  }

  async function handleEvalRun(source: "dataset" | "shadow_replay", datasetName?: string) {
    if (!token) {
      setError("Sign in before running evals");
      return;
    }

    try {
      setEvalPending(true);
      setError("");
      const run = await apiFetch<EvalRunItem & { results?: unknown[] }>("/ops/evals/run", token, {
        method: "POST",
        body: JSON.stringify(
          source === "dataset"
            ? { source, dataset_name: datasetName }
            : { source, limit: 5 },
        ),
      });
      setEvalRuns((current) => [run, ...current.filter((item) => item.id !== run.id)].slice(0, 8));
      setEvalRunDetail(
        await apiFetch<EvalRunDetail>(
          `/ops/evals/runs/${run.id}${buildQuery({ pack_id: opsPackFilter, world_template_id: opsTemplateFilter })}`,
          token,
        ),
      );
      await refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setEvalPending(false);
    }
  }

  async function handleReleaseChecklistRun() {
    if (!token) {
      setError("Sign in before running release checklists");
      return;
    }

    try {
      setChecklistPending(true);
      setError("");
      await apiFetch<ReleaseGateReport>("/ops/release/checklists/run", token, {
        method: "POST",
        body: JSON.stringify({ trigger_type: "manual" }),
      });
      await refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
      await refreshHealth();
    } catch (requestError) {
      setError(formatError(requestError));
    } finally {
      setChecklistPending(false);
    }
  }

  useEffect(() => {
    if (route !== "admin" || !token) {
      return;
    }
    void refreshAdminData(token, activeWorldId, ledgerUserFilter, ledgerWorldFilter || activeWorldId, session?.session_id);
    if (activeWorldId) {
      void runMemorySearch(token, activeWorldId);
    }
  }, [route, token, activeWorldId, session?.session_id, opsPackFilter, opsTemplateFilter]);

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">GESTALOKA v2</p>
            <h1>Same-world release gate runtime</h1>
            <p className="lede">
              OIDC login, one-world turn play, SP debit rules, Nebula projection monitoring, and eval-driven
              release gating now share the same v2 runtime surface.
            </p>
          </div>
          <nav className="route-nav">
            <button data-testid="nav-game" className={route === "game" ? "nav-pill active" : "nav-pill"} onClick={() => navigate("game")}>
              Game
            </button>
            <button data-testid="nav-admin" className={route === "admin" ? "nav-pill active" : "nav-pill"} onClick={() => navigate("admin")}>
              Admin
            </button>
          </nav>
        </div>
      </header>

      <section className="grid">
        <article className="card">
          <h2>1. Login</h2>
          <p data-testid="auth-status">Status: {statusText}</p>
          <p data-testid="api-health">
            API health: {health?.status ?? "unreachable"} / DB: {health?.database ?? "unknown"}
          </p>
          <p data-testid="socket-status">Socket: {socketState}</p>
          <p data-testid="sp-balance">
            SP balance: {wallet?.balance ?? "unknown"} / Choice cost:{" "}
            {wallet?.choice_turn_cost ?? health?.sp?.choice_turn_cost ?? wallet?.turn_cost ?? health?.sp?.turn_cost ?? "?"} / Free text cost:{" "}
            {wallet?.free_text_turn_cost ?? health?.sp?.free_text_turn_cost ?? "?"}
          </p>
          <p data-testid="sp-budget-note">
            SP is execution budget only. It is not in-world currency and does not buy quest, faction, or item power.
          </p>
          {me ? (
            <dl className="meta">
              <div>
                <dt>Name</dt>
                <dd>{me.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{me.email}</dd>
              </div>
              <div>
                <dt>Sub</dt>
                <dd>{me.sub}</dd>
              </div>
            </dl>
          ) : (
            <p>Use the demo Keycloak user to enter the v2 slice.</p>
          )}
          <div className="actions">
            <button data-testid="sign-in" onClick={handleLogin} disabled={!ready || authenticated}>
              Sign in
            </button>
            <button data-testid="sign-out" onClick={handleLogout} disabled={!authenticated}>
              Sign out
            </button>
          </div>
        </article>

        <article className="card">
          <h2>2. World start</h2>
          <form onSubmit={handleStartSession} className="stack">
            <label>
              World
              <select
                data-testid="world-select"
                value={worldId}
                onChange={(event) => setWorldId(event.target.value)}
                disabled={worldCatalogUnavailable || !playableWorlds.length}
              >
                <option value="" disabled>
                  Select a world
                </option>
                {playableWorlds.map((item) => (
                  <option key={item.world_id} value={item.world_id} disabled={item.status !== "playable"}>
                    {item.display_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              data-testid="start-session"
              type="submit"
              disabled={!authenticated || worldCatalogUnavailable || !selectedWorld || selectedWorld.status !== "playable"}
            >
              Start session
            </button>
          </form>
          <p data-testid="world-catalog-status">World catalog: {worldCatalogStatus}</p>
          {session ? (
            <dl className="meta">
              <div>
                <dt>World</dt>
                <dd>
                  {session.world_name} ({session.world_id})
                </dd>
              </div>
              <div>
                <dt>Pack</dt>
                <dd data-testid="session-pack">
                  {session.world_context.pack_display_name} ({session.pack_id}) / {session.world_context.world_template_display_name}
                </dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{session.session_id}</dd>
              </div>
              <div>
                <dt>Guide NPC</dt>
                <dd>{session.npc_actor_id}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd data-testid="session-location">{session.location_id}</dd>
              </div>
            </dl>
          ) : (
            <p>No session started yet.</p>
          )}
        </article>

        {route === "game" ? (
          <>
            <article className="card">
              <h2>3. Character summary</h2>
              {sessionState ? (
                <dl className="meta" data-testid="character-summary">
                  <div>
                    <dt>Rank</dt>
                    <dd>{sessionState.character.rank}</dd>
                  </div>
                  <div>
                    <dt>Vitality</dt>
                    <dd data-testid="state-band-vitality">{sessionState.narrative_state_bands.vitality}</dd>
                  </div>
                  <div>
                    <dt>Clarity</dt>
                    <dd data-testid="state-band-clarity">{sessionState.narrative_state_bands.clarity}</dd>
                  </div>
                  <div>
                    <dt>Standing tone</dt>
                    <dd data-testid="state-band-standing">{sessionState.narrative_state_bands.standing}</dd>
                  </div>
                </dl>
              ) : (
                <p>No character sheet yet.</p>
              )}
            </article>

            <article className="card">
              <h2>4. Active quest</h2>
              {activeQuest ? (
                <div data-testid="active-quest">
                  <p>
                    <strong>{activeQuest.title}</strong>
                  </p>
                  <p data-testid="quest-progress">
                    Progress: {activeQuest.progress}/{activeQuest.progress_target}
                  </p>
                  <p data-testid="quest-stage">Stage: {activeQuest.stage_key}</p>
                  <p>{activeQuest.latest_summary}</p>
                  <p>Status: {activeQuest.status}</p>
                  <p data-testid="quest-unlock-requirements">
                    Unlocks: {Object.keys(activeQuest.unlock_requirements).length ? JSON.stringify(activeQuest.unlock_requirements) : "starter"}
                  </p>
                </div>
              ) : (
                <p>No active quest.</p>
              )}
            </article>

            <article className="card">
              <h2>5. Faction standing</h2>
              <ul className="stream" data-testid="faction-standing">
                {sessionState?.factions.map((item) => (
                  <li key={item.faction_id}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.standing.toFixed(2)} / {item.band}
                    </span>
                  </li>
                )) ?? <li>Faction standing unavailable.</li>}
              </ul>
            </article>

            <article className="card">
              <h2>6. Current scene</h2>
              <div data-testid="current-place-summary">
                <p>
                  <strong>Current place</strong>
                </p>
                <p>{sessionState?.current_location?.name ?? "No place is active yet."}</p>
                <p>{sessionState?.current_location?.description ?? "The scene has not opened onto a stable place yet."}</p>
              </div>
              {sessionState?.chapter ? (
                <div data-testid="current-chapter-summary">
                  <p>
                    <strong>{sessionState.chapter.summary}</strong>
                  </p>
                  <p>Chapter status: {sessionState.chapter.status}</p>
                  {sessionState.chapter.crossroads_summary ? <p>{sessionState.chapter.crossroads_summary}</p> : null}
                  {sessionState.chapter.branch_hint &&
                  sessionState.chapter.branch_hint !== sessionState.chapter.crossroads_summary ? (
                    <p>{sessionState.chapter.branch_hint}</p>
                  ) : null}
                </div>
              ) : (
                <p>No chapter frame yet.</p>
              )}
              {sessionState?.current_scene ? (
                <div data-testid="current-scene-summary">
                  <p>
                    <strong>{sessionState.current_scene.summary}</strong>
                  </p>
                  <p>{sessionState.current_scene.pressure_summary}</p>
                  <p>
                    Scene focus: {sessionState.current_scene.focus_actor?.display_name ?? "The scene"} /{" "}
                    {sessionState.current_scene.location?.name ?? "unknown location"}
                  </p>
                </div>
              ) : (
                <p>No active scene frame yet.</p>
              )}
              <h3>Recent scene echoes</h3>
              <ul className="stream" data-testid="recent-scene-history">
                {sessionState?.recent_scene_history.length ? (
                  sessionState.recent_scene_history.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>echo</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No scene echoes are visible yet.</li>
                )}
              </ul>
              <h3>Recent branch echoes</h3>
              <ul className="stream" data-testid="recent-branch-echoes">
                {sessionState?.recent_branch_echoes.length ? (
                  sessionState.recent_branch_echoes.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>branch</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No branch echo has gathered into focus yet.</li>
                )}
              </ul>
            </article>

            <article className="card">
              <h2>7. Relationship summary</h2>
              <ul className="stream" data-testid="relationship-summary">
                {sessionState?.relationships.length ? (
                  sessionState.relationships.map((item) => (
                    <li key={item.actor_id}>
                      <strong>{item.display_name}</strong>
                      <span>{item.summary}</span>
                      <span>{item.band}</span>
                    </li>
                  ))
                ) : (
                  <li>No relationship pressure is visible yet.</li>
                )}
              </ul>
              <h3>Undercurrents</h3>
              <ul className="stream" data-testid="undercurrents-stream">
                {sessionState?.active_consequence_threads.length ? (
                  sessionState.active_consequence_threads.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No unresolved undercurrents are pulling at the scene.</li>
                )}
              </ul>
              <h3>Recent consequence history</h3>
              <ul className="stream" data-testid="recent-consequence-history">
                {sessionState?.recent_consequence_history.length ? (
                  sessionState.recent_consequence_history.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>recent</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No recent consequence history yet.</li>
                )}
              </ul>
            </article>

            <article className="card">
              <h2>8. Around you</h2>
              <ul className="stream" data-testid="local-figures-stream">
                {sessionState?.local_figures.length ? (
                  sessionState.local_figures.map((item) => (
                    <li key={item.actor_id}>
                      <strong>{item.display_name}</strong>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No nearby figures have settled into focus yet.</li>
                )}
              </ul>
              <h3>Who is elsewhere</h3>
              <ul className="stream" data-testid="npc-locations-stream">
                {sessionState?.npc_locations.length ? (
                  sessionState.npc_locations.map((item) => (
                    <li key={`${item.actor_id}-${item.location_id ?? "none"}`}>
                      <strong>{item.display_name}</strong>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No wider district movement is visible yet.</li>
                )}
              </ul>
              <h3>Nearby routes</h3>
              <ul className="stream" data-testid="nearby-routes-stream">
                {sessionState?.nearby_routes.length ? (
                  sessionState.nearby_routes.map((item) => (
                    <li key={item.route_key}>
                      <strong>{item.destination_name}</strong>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No clear route is presenting itself yet.</li>
                )}
              </ul>
              <h3>Recent travel echoes</h3>
              <ul className="stream" data-testid="recent-travel-history">
                {sessionState?.recent_travel_history.length ? (
                  sessionState.recent_travel_history.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>echo</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No travel echo is lingering yet.</li>
                )}
              </ul>
            </article>

            <article className="card">
              <h2>9. Recent world beats</h2>
              <ul className="stream" data-testid="recent-world-beats">
                {sessionState?.recent_world_beats.length ? (
                  sessionState.recent_world_beats.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>beat</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No wider district beat has risen yet.</li>
                )}
              </ul>
              <h3>Ambient murmurs</h3>
              <ul className="stream" data-testid="ambient-murmurs-stream">
                {sessionState?.ambient_murmurs.length ? (
                  sessionState.ambient_murmurs.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>murmur</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No rumor has started moving through the current district.</li>
                )}
              </ul>
              <h3>Recent offstage beats</h3>
              <ul className="stream" data-testid="recent-offstage-beats">
                {sessionState?.recent_offstage_beats.length ? (
                  sessionState.recent_offstage_beats.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>offstage</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No offstage shift is echoing back yet.</li>
                )}
              </ul>
              <h3>Offstage murmurs</h3>
              <ul className="stream" data-testid="offstage-murmurs-stream">
                {sessionState?.offstage_murmurs.length ? (
                  sessionState.offstage_murmurs.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <strong>murmur</strong>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>No offstage rumor has reached you yet.</li>
                )}
              </ul>
            </article>

            <article className="card">
              <h2>10. Inventory</h2>
              <ul className="stream" data-testid="inventory-stream">
                {sessionState?.inventory.length ? (
                  sessionState.inventory.map((item) => (
                    <li key={item.id}>
                      <strong>{item.name}</strong>
                      <span>{item.template_key}</span>
                      <span>
                        {item.status}
                        {item.effect_kind ? ` / ${item.effect_kind}` : ""}
                      </span>
                    </li>
                  ))
                ) : (
                  <li>No reward items yet.</li>
                )}
              </ul>
              <h3>Important affordances</h3>
              <ul className="stream" data-testid="inventory-affordances">
                {sessionState?.important_inventory_affordances.length ? (
                  sessionState.important_inventory_affordances.map((item) => (
                    <li key={item.item_id}>
                      <strong>{item.name}</strong>
                      <span>{item.summary}</span>
                      <span>{item.usable ? "usable" : "spent"}</span>
                    </li>
                  ))
                ) : (
                  <li>No major item affordances are visible yet.</li>
                )}
              </ul>
            </article>

            <article className="card wide">
              <h2>11. Suggested choices</h2>
              <p data-testid="last-consequence-summary">
                {latestConsequenceSummary || "The scene is waiting for your next line."}
              </p>
              <div className="stack">
                <div className="actions">
                  <button
                    type="button"
                    data-testid="toggle-choice-mode"
                    onClick={() => setTurnInputMode("choice")}
                    disabled={!session}
                  >
                    Choice mode
                  </button>
                  <button
                    type="button"
                    data-testid="toggle-free-text"
                    onClick={() => setTurnInputMode("free_text")}
                    disabled={!session}
                  >
                    Free text mode
                  </button>
                </div>
                <ul className="stream" data-testid="choice-list">
                  {suggestedChoices.length ? (
                    suggestedChoices.map((choice) => (
                      <li key={choice.choice_id}>
                        <strong>{choice.label}</strong>
                        <span>{choice.summary}</span>
                        <span>{choice.posture}</span>
                        <button
                          type="button"
                          data-testid={`choice-${choice.choice_id}`}
                          onClick={() => void handleChoiceSubmit(choice.choice_id)}
                          disabled={!session || turnPending}
                        >
                          {turnPending ? "Submitting..." : "Choose"}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li>No suggested choices yet.</li>
                  )}
                </ul>
              </div>
              {turnInputMode === "free_text" ? (
                <form onSubmit={handleTurnSubmit} className="stack">
                  <label>
                    Free text action
                    <textarea
                      data-testid="turn-input"
                      rows={4}
                      value={freeTextInput}
                      onChange={(event) => setFreeTextInput(event.target.value)}
                    />
                  </label>
                  <button data-testid="submit-turn" type="submit" disabled={!session || turnPending}>
                    {turnPending ? "Submitting..." : "Submit free text turn"}
                  </button>
                </form>
              ) : null}
              <div className="result">
                <h3>Latest narrative</h3>
                <p data-testid="latest-narrative">{latestNarrative || "No turn resolved yet."}</p>
                <h3>Latest NPC reaction</h3>
                <p data-testid="latest-reaction">{latestReaction || "No NPC reaction yet."}</p>
              </div>
            </article>

            <article className="card">
              <h2>12. Results</h2>
              <h3>Events</h3>
              <ul className="stream" data-testid="events-stream">
                {events.map((item) => (
                  <li key={item.id}>
                    <strong>{item.event_type}</strong>
                    <span>{item.narrative}</span>
                    <span>location: {item.location_id ?? "none"}</span>
                  </li>
                ))}
              </ul>
              <h3>Memories</h3>
              <ul className="stream" data-testid="memories-stream">
                {memories.map((item) => (
                  <li key={item.id}>
                    <strong>{item.scope}</strong>
                    <span>{item.text}</span>
                    <span>location: {item.location_id ?? "none"}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card wide">
              <h2>Realtime stream</h2>
              <ul className="stream" data-testid="ops-stream">
                {activity.map((item, index) => {
                  const context = item.data.world_context as WorldContext | undefined;
                  return (
                    <li key={`${item.event}-${index}`}>
                      <strong>{item.event}</strong>
                      <span>
                        {context?.pack_display_name ?? "unknown"} /{" "}
                        {context?.world_template_display_name ?? "unknown"}
                      </span>
                      <span>{JSON.stringify(item.data)}</span>
                    </li>
                  );
                })}
              </ul>
            </article>

            <section hidden aria-hidden="true">
              <p data-testid="ops-status">Ops access: {opsState}</p>
              <p data-testid="sp-admin-separation-note">
                SP execution ledger is separate from world progression. Reward item use and follow-up quest unlocks are tracked below, not as paid power.
              </p>
              <ul className="stream" data-testid="location-route-stream">
                {locationOps.length ? (
                  locationOps.map((item) => (
                    <li key={`hidden-location-${item.id}`}>
                      <strong>{item.name}</strong>
                      <span>{item.description}</span>
                      <span>
                        {locationRouteSummaries(item)
                          .map((route) => `${route.route_key}:${route.status}->${route.destination_name}`)
                          .join(" | ")}
                      </span>
                    </li>
                  ))
                ) : (
                  <li>No location state loaded.</li>
                )}
              </ul>
              <ul className="stream" data-testid="travel-log-stream">
                {travelLogOps.length ? (
                  travelLogOps.map((item) => (
                    <li key={`hidden-travel-${item.event_id}`}>
                      <strong>{item.turn_id}</strong>
                      <span>{item.travel_summary ?? item.narrative ?? "No travel summary"}</span>
                      <span>{item.location_id ?? "no location"}</span>
                    </li>
                  ))
                ) : (
                  <li>No travel log loaded.</li>
                )}
              </ul>
              <ul className="stream" data-testid="npc-routine-stream">
                {npcRoutineOps.length ? (
                  npcRoutineOps.map((item) => (
                    <li key={`hidden-routine-${item.actor_id}`}>
                      <strong>{item.display_name}</strong>
                      <span>{item.location_id ?? "no location"}</span>
                      <span>{JSON.stringify(item.routine_state)}</span>
                    </li>
                  ))
                ) : (
                  <li>No NPC routine state loaded.</li>
                )}
              </ul>
              <ul className="stream" data-testid="ambient-beat-stream">
                {ambientBeatOps.length ? (
                  ambientBeatOps.map((item) => (
                    <li key={`hidden-ambient-${item.event_id}`}>
                      <strong>{item.display_name ?? "Unknown figure"}</strong>
                      <span>{item.beat_kind}</span>
                      <span>{item.visible_summary ?? "No visible summary"}</span>
                    </li>
                  ))
                ) : (
                  <li>No ambient beat log loaded.</li>
                )}
              </ul>
              <ul className="stream" data-testid="scene-timeline-stream">
                {sceneOps.length ? (
                  sceneOps.map((item) => (
                    <li key={`hidden-scene-${item.id}`}>
                      <strong>{item.scene_phase}</strong>
                      <span>{item.status}</span>
                      <span>{item.stakes_summary}</span>
                      <span>{item.pressure_summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No scene timeline data loaded.</li>
                )}
              </ul>
            </section>
          </>
        ) : (
          <>
            <article className="card wide">
              <h2>Ops scope and projection runtime</h2>
              <p data-testid="ops-status">Ops access: {opsState}</p>
              <dl className="scope-summary" data-testid="ops-scope-compact-summary">
                <div>
                  <dt>Scope</dt>
                  <dd data-testid="ops-scope-summary">{opsScopeLabel}</dd>
                </div>
                <div>
                  <dt>Filtered worlds</dt>
                  <dd>{visibleOpsWorlds.length}</dd>
                </div>
                <div>
                  <dt>Selected world</dt>
                  <dd data-testid="ops-selected-world-summary">{selectedAdminWorldLabel}</dd>
                </div>
                <div>
                  <dt>Catalog health</dt>
                  <dd data-testid="ops-catalog-health">
                    {opsCatalogStatus} / packs {opsCatalogPackCount} / templates {opsCatalogTemplateCount} / failures{" "}
                    {opsCatalogFailureCount}
                  </dd>
                </div>
              </dl>
              <label>
                Pack Filter
                <select
                  data-testid="ops-pack-filter"
                  value={opsPackFilter}
                  onChange={(event) => {
                    setOpsPackFilter(event.target.value);
                    setOpsTemplateFilter("");
                  }}
                  disabled={!opsPackCatalog?.items.length}
                >
                  <option value="">All packs</option>
                  {(opsPackCatalog?.items ?? []).map((item) => (
                    <option key={item.pack_id} value={item.pack_id}>
                      {item.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Template Filter
                <select
                  data-testid="ops-template-filter"
                  value={opsTemplateFilter}
                  onChange={(event) => setOpsTemplateFilter(event.target.value)}
                  disabled={!opsTemplateOptions.length}
                >
                  <option value="">All templates</option>
                  {opsTemplateOptions.map((item) => (
                    <option key={item.template_id} value={item.template_id}>
                      {item.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Admin World
                <select
                  data-testid="ops-world-select"
                  value={activeWorldId}
                  onChange={(event) => {
                    setOpsWorldId(event.target.value);
                    setLedgerWorldFilter(event.target.value);
                    setAdjustWorldId(event.target.value);
                  }}
                  disabled={!visibleOpsWorlds.length}
                >
                  {visibleOpsWorlds.length ? (
                    visibleOpsWorlds.map((item) => (
                      <option key={item.world_context.world_id} value={item.world_context.world_id}>
                        {item.world_context.world_name} / {item.world_context.pack_display_name}
                      </option>
                    ))
                  ) : (
                    <option value={activeWorldId}>{activeWorldId || "No matching worlds"}</option>
                  )}
                </select>
              </label>
              <p data-testid="ops-pack-catalog-summary">
                Pack catalog:{" "}
                <strong data-testid="ops-pack-catalog-status">
                  {opsCatalogStatus}
                </strong>{" "}
                / total packs {opsCatalogPackCount} / templates {opsCatalogTemplateCount} / API{" "}
                {opsPackCatalog?.engine_api_version ?? health?.world_packs?.engine_api_version ?? "unknown"} / failures{" "}
                {opsCatalogFailureCount} / filtered worlds {visibleOpsWorlds.length}
              </p>
              <ul className="stream" data-testid="ops-pack-failure-stream">
                {sortedOpsPackFailures.length ? (
                  sortedOpsPackFailures.map((item, index) => (
                    <li key={`${item.error}-${item.pack_id ?? "pack-dir"}-${index}`}>
                      <strong>
                        {item.severity}: {item.error}
                      </strong>
                      <span>{item.pack_id ?? "pack directory"}</span>
                      <span>{item.message}</span>
                      <span>{item.path ?? "path unavailable"}</span>
                    </li>
                  ))
                ) : (
                  <li>No pack catalog failures.</li>
                )}
              </ul>
              <ul className="stream" data-testid="ops-pack-catalog-stream">
                {(opsPackCatalog?.items ?? []).map((item) => (
                  <li key={item.pack_id}>
                    <strong>{item.display_name}</strong>
                    <span>
                      {item.pack_id} / {item.version} / {item.engine_api_version}
                    </span>
                    <span>
                      visibility: {item.visibility} / publish: {item.publish_status}
                    </span>
                    <span>
                      templates ({item.world_templates.length}):{" "}
                      {item.world_templates
                        .map(
                          (template) =>
                            `${template.display_name} (${template.effective_visibility}/${template.effective_publish_status})`,
                        )
                        .join(", ")}
                    </span>
                    <span>tags: {item.semantic_tags.join(", ") || "none"}</span>
                    <span>
                      failure state:{" "}
                      {sortedOpsPackFailures.filter((failure) => failure.pack_id === item.pack_id).length || "clear"}
                    </span>
                  </li>
                ))}
              </ul>
              <p data-testid="active-world-context">
                Pack: {activeWorldContext?.pack_display_name ?? "unknown"} / Template:{" "}
                {activeWorldContext?.world_template_display_name ?? "unknown"} / World:{" "}
                {activeWorldContext?.world_name ?? activeWorldId}
              </p>
              <p>
                Backend: {projectionStatus?.backend ?? health?.projection?.backend ?? "unknown"} / Graph read:{" "}
                {projectionStatus?.graph_read_mode ?? health?.projection?.graph_read_mode ?? "unknown"} / Runtime:{" "}
                <span data-testid="graph-runtime-status">
                  {projectionStatus?.graph_runtime_status ?? health?.projection_runtime?.graph_runtime_status ?? "unknown"}
                </span>
              </p>
              <p>
                Space: {projectionStatus?.space ?? health?.projection?.space ?? "unknown"} / Pending:{" "}
                {projectionStatus?.pending ?? health?.projection?.pending_outbox ?? "unknown"} / Failed:{" "}
                {projectionStatus?.failed ?? health?.projection?.failed_outbox ?? "unknown"} / Projected:{" "}
                {projectionStatus?.projected ?? health?.projection?.projected_outbox ?? "unknown"}
              </p>
              <p data-testid="observability-summary">
                Global SLO: lag {observability?.primary.projection_lag_seconds ?? health?.observability?.projection_lag_seconds ?? 0}s / schema valid{" "}
                {((observability?.primary.llm_schema_valid_rate ?? health?.observability?.llm_schema_valid_rate ?? 0) * 100).toFixed(0)}% /
                fallback {((observability?.primary.llm_fallback_rate ?? health?.observability?.llm_fallback_rate ?? 0) * 100).toFixed(0)}%
              </p>
              <p data-testid="canary-health-status">
                Global canary: {observability?.canary.status ?? health?.observability?.canary_health?.status ?? "unknown"} / graph{" "}
                {observability?.canary.graph_runtime_status ?? health?.observability?.canary_health?.graph_runtime_status ?? "unknown"} /
                gate {observability?.canary.release_gate_verdict ?? health?.observability?.canary_health?.release_gate_verdict ?? "unknown"}
              </p>
              <h3>Operations health timeline</h3>
              <ul className="stream" data-testid="observability-snapshot-timeline">
                {visibleObservabilitySnapshots.length ? (
                  visibleObservabilitySnapshots.map((item) => (
                    <li key={item.id}>
                      <strong>
                        {item.snapshot_kind} / {item.pack_display_name ?? "all packs"} /{" "}
                        {item.world_template_display_name ?? "all templates"}
                      </strong>
                      <span>{item.created_at}</span>
                      <span>
                        lag {item.primary_slo.projection_lag_seconds ?? 0}s / failed{" "}
                        {item.primary_slo.outbox_failed_count ?? 0}
                      </span>
                      <span>
                        schema {((item.primary_slo.llm_schema_valid_rate ?? 0) * 100).toFixed(0)}% / fallback{" "}
                        {((item.primary_slo.llm_fallback_rate ?? 0) * 100).toFixed(0)}%
                      </span>
                      <span>
                        canary {item.canary_health.status ?? "unknown"} / gate{" "}
                        {item.canary_health.release_gate_verdict ?? "unknown"}
                      </span>
                    </li>
                  ))
                ) : (
                  <li>No observability snapshots match this scope.</li>
                )}
              </ul>
              <p data-testid="embedding-status-summary">
                Embedding: {embeddingStatus?.provider ?? health?.embedding?.provider ?? "unknown"} / model:{" "}
                {embeddingStatus?.model ?? health?.embedding?.model ?? "unknown"} / dim:{" "}
                {embeddingStatus?.dimension ?? health?.embedding?.dimension ?? "unknown"} / pending:{" "}
                {embeddingStatus?.pending_count ?? health?.embedding?.pending_count ?? 0} / failed:{" "}
                {embeddingStatus?.failed_count ?? health?.embedding?.failed_count ?? 0} / status:{" "}
                {embeddingStatus?.runtime_status ?? health?.embedding?.runtime_status ?? "unknown"}
              </p>
              <p data-testid="langfuse-status-summary">
                LLM observability: {observability?.langfuse?.stack ?? health?.llm_observability?.stack ?? "langfuse"} / enabled:{" "}
                {String(observability?.langfuse?.enabled ?? health?.llm_observability?.enabled ?? false)} / status:{" "}
                {observability?.langfuse?.runtime_status ?? health?.llm_observability?.runtime_status ?? "unknown"} / base:{" "}
                {observability?.langfuse?.base_url ?? health?.llm_observability?.base_url ?? "unknown"}
              </p>
              {(observability?.langfuse?.last_error ?? health?.llm_observability?.last_error) ? (
                <p data-testid="langfuse-last-error">
                  Langfuse note: {observability?.langfuse?.last_error ?? health?.llm_observability?.last_error}
                </p>
              ) : null}
              <p data-testid="sp-admin-separation-note">
                SP execution ledger is separate from world progression. Reward item use and follow-up quest unlocks are tracked below, not as paid power.
              </p>
              <p data-testid="graph-vertex-count">
                Graph vertices: {graphSummary?.vertex_count ?? 0} / edges:{" "}
                <span data-testid="graph-edge-count">{graphSummary?.edge_count ?? 0}</span>
              </p>
              <p>
                Factions: <span data-testid="graph-faction-count">{graphSummary?.label_counts?.Faction ?? 0}</span> / Quests:{" "}
                <span data-testid="graph-quest-count">{graphSummary?.label_counts?.Quest ?? 0}</span> / Items:{" "}
                <span data-testid="graph-item-count">{graphSummary?.label_counts?.Item ?? 0}</span>
              </p>
              <div className="actions">
                <button
                  data-testid="refresh-admin"
                  onClick={() =>
                    void refreshAdminData(
                      token,
                      activeWorldId,
                      ledgerUserFilter,
                      ledgerWorldFilter || activeWorldId,
                      session?.session_id,
                    )
                  }
                  disabled={!token}
                >
                  Refresh admin
                </button>
                <button
                  data-testid="rebuild-graph"
                  onClick={handleRebuildGraph}
                  disabled={!token || rebuildPending || opsState !== "ready"}
                >
                  {rebuildPending ? "Rebuilding..." : "Rebuild graph"}
                </button>
                <button
                  data-testid="trigger-idle-pass"
                  onClick={() => void handleIdlePass()}
                  disabled={!token || idlePassPending || opsState !== "ready" || !activeWorldId}
                >
                  {idlePassPending ? "Running idle pass..." : "Trigger idle pass"}
                </button>
              </div>
              {lastRebuild ? (
                <p data-testid="rebuild-result">
                  Rebuilt {lastRebuild.records} records at {lastRebuild.completed_at}
                </p>
              ) : null}
              <h3>Neighborhood summary</h3>
              <ul className="stream" data-testid="graph-summary-stream">
                {(graphSummary?.neighborhood_summary ?? []).map((item) => (
                  <li key={item}>
                    <strong>context</strong>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <h3>Quest and faction projection changes</h3>
              <ul className="stream" data-testid="quest-state-changes-stream">
                {(graphSummary?.state_changes ?? []).map((item) => (
                  <li key={item.entity_key}>
                    <strong>{item.label}</strong>
                    <span>{item.kind}</span>
                    <span>{item.entity_key}</span>
                  </li>
                ))}
              </ul>
              <h3>Current world progression</h3>
              <ul className="stream" data-testid="progression-stream">
                {sessionState ? (
                  <>
                    {sessionState.quests.map((item) => (
                      <li key={item.assignment_id}>
                        <strong>{item.title}</strong>
                        <span>
                          {item.stage_key} / {item.status} / {item.progress}/{item.progress_target}
                        </span>
                      </li>
                    ))}
                    {sessionState.inventory.map((item) => (
                      <li key={item.id}>
                        <strong>{item.name}</strong>
                        <span>
                          {item.status}
                          {item.effect_kind ? ` / ${item.effect_kind}` : ""}
                        </span>
                      </li>
                    ))}
                  </>
                ) : (
                  <li>No active world progression state loaded.</li>
                )}
              </ul>
              <h3>Relationship ops</h3>
              <ul className="stream" data-testid="relationship-ops-stream">
                {relationshipOps.length ? (
                  relationshipOps.map((item) => (
                    <li key={item.relationship_id}>
                      <strong>
                        {`${item.from_actor_name} -> ${item.to_actor_name}`}
                      </strong>
                      <span>{item.relationship_type}</span>
                      <span>{item.strength.toFixed(2)} / {item.band}</span>
                    </li>
                  ))
                ) : (
                  <li>No relationship ops data loaded.</li>
                )}
              </ul>
              <h3>Consequence threads</h3>
              <ul className="stream" data-testid="consequence-thread-stream">
                {consequenceThreadOps.length ? (
                  consequenceThreadOps.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <span>
                        {item.thread_type} / {item.status} / {item.pressure_band}
                      </span>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No consequence thread data loaded.</li>
                )}
              </ul>
              <h3>Chapter timeline</h3>
              <ul className="stream" data-testid="chapter-timeline-stream">
                {chapterOps.length ? (
                  chapterOps.map((item) => (
                    <li key={item.id}>
                      <strong>{item.chapter_key}</strong>
                      <span>{item.status}</span>
                      <span>{item.summary}</span>
                      {item.crossroads_summary ? <span>{item.crossroads_summary}</span> : null}
                    </li>
                  ))
                ) : (
                  <li>No chapter timeline data loaded.</li>
                )}
              </ul>
              <h3>Chapter branch status</h3>
              <ul className="stream" data-testid="chapter-branch-stream">
                {chapterBranchOps.length ? (
                  chapterBranchOps.map((item) => (
                    <li key={item.chapter_id}>
                      <strong>{item.chapter_key}</strong>
                      <span>{item.crossroads_status}</span>
                      <span>{item.branch_key ?? "uncommitted"}</span>
                      <span>{item.crossroads_summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No chapter branch data loaded.</li>
                )}
              </ul>
              <h3>Route pressures</h3>
              <ul className="stream" data-testid="route-pressure-stream">
                {routePressureOps.length ? (
                  routePressureOps.map((item) => (
                    <li key={`${item.owner_actor_id}-${item.chapter_key}-${item.route_key}`}>
                      <strong>{item.owner_actor_name}</strong>
                      <span>{item.chapter_key}</span>
                      <span>
                        {item.route_key} / {item.band} / {item.pressure.toFixed(2)}
                      </span>
                      <span>{item.last_signal}</span>
                    </li>
                  ))
                ) : (
                  <li>No route pressure data loaded.</li>
                )}
              </ul>
              <h3>Scene timeline</h3>
              <ul className="stream" data-testid="scene-timeline-stream">
                {sceneOps.length ? (
                  sceneOps.map((item) => (
                    <li key={item.id}>
                      <strong>{item.scene_phase}</strong>
                      <span>{item.status}</span>
                      <span>{item.stakes_summary}</span>
                      <span>{item.pressure_summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No scene timeline data loaded.</li>
                )}
              </ul>
              <h3>Locations and route states</h3>
              <ul className="stream" data-testid="location-route-stream">
                {locationOps.length ? (
                  locationOps.map((item) => (
                    <li key={item.id}>
                      <strong>{item.name}</strong>
                      <span>{item.description}</span>
                      <span>
                        {locationRouteSummaries(item)
                          .map((route) => `${route.route_key}:${route.status}->${route.destination_name}`)
                          .join(" | ")}
                      </span>
                    </li>
                  ))
                ) : (
                  <li>No location state loaded.</li>
                )}
              </ul>
              <h3>Travel log</h3>
              <ul className="stream" data-testid="travel-log-stream">
                {travelLogOps.length ? (
                  travelLogOps.map((item) => (
                    <li key={item.event_id}>
                      <strong>{item.turn_id}</strong>
                      <span>{item.travel_summary ?? item.narrative ?? "No travel summary"}</span>
                      <span>{item.location_id ?? "no location"}</span>
                    </li>
                  ))
                ) : (
                  <li>No travel log loaded.</li>
                )}
              </ul>
              <h3>NPC routine state</h3>
              <ul className="stream" data-testid="npc-routine-stream">
                {npcRoutineOps.length ? (
                  npcRoutineOps.map((item) => (
                    <li key={item.actor_id}>
                      <strong>{item.display_name}</strong>
                      <span>{item.location_id ?? "no location"}</span>
                      <span>{JSON.stringify(item.routine_state)}</span>
                    </li>
                  ))
                ) : (
                  <li>No NPC routine state loaded.</li>
                )}
              </ul>
              <h3>NPC current locations</h3>
              <ul className="stream" data-testid="npc-location-stream">
                {npcLocationOps.length ? (
                  npcLocationOps.map((item) => (
                    <li key={`${item.actor_id}-${item.location_id ?? "none"}`}>
                      <strong>{item.display_name}</strong>
                      <span>{item.location_name}</span>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No NPC location summary loaded.</li>
                )}
              </ul>
              <h3>Ambient beat log</h3>
              <ul className="stream" data-testid="ambient-beat-stream">
                {ambientBeatOps.length ? (
                  ambientBeatOps.map((item) => (
                    <li key={item.event_id}>
                      <strong>{item.display_name ?? "Unknown figure"}</strong>
                      <span>{item.beat_kind}</span>
                      <span>{item.visible_summary ?? "No visible summary"}</span>
                    </li>
                  ))
                ) : (
                  <li>No ambient beat log loaded.</li>
                )}
              </ul>
              <h3>World tick log</h3>
              <ul className="stream" data-testid="world-tick-stream">
                {worldTickOps.length ? (
                  worldTickOps.map((item) => (
                    <li key={item.tick_id}>
                      <strong>{item.tick_kind}</strong>
                      <span>
                        {activeWorldContext?.pack_display_name ?? "unknown pack"} /{" "}
                        {activeWorldContext?.world_template_display_name ?? "unknown template"}
                      </span>
                      <span>{item.status}</span>
                      <span>{item.summary}</span>
                    </li>
                  ))
                ) : (
                  <li>No world tick log loaded.</li>
                )}
              </ul>
              <h3>Offstage beat log</h3>
              <ul className="stream" data-testid="offstage-beat-stream">
                {offstageBeatOps.length ? (
                  offstageBeatOps.map((item) => (
                    <li key={item.event_id}>
                      <strong>{item.display_name ?? "Unknown figure"}</strong>
                      <span>{item.beat_kind ?? "beat"}</span>
                      <span>{item.visible_summary ?? "No visible summary"}</span>
                    </li>
                  ))
                ) : (
                  <li>No offstage beat log loaded.</li>
                )}
              </ul>
              <h3>Recent runtime failures</h3>
              <ul className="stream" data-testid="recent-failures-stream">
                {(projectionStatus?.recent_failures ?? []).map((item) => (
                  <li key={item.id}>
                    <strong>{item.projection_type}</strong>
                    <span>
                      {item.world_context?.pack_display_name ?? "unknown"} /{" "}
                      {item.world_context?.world_template_display_name ?? "unknown"}
                    </span>
                    <span>{item.world_context?.world_name ?? item.world_id}</span>
                    <span>{item.last_error ?? "no error text"}</span>
                  </li>
                ))}
              </ul>
              <h3>Council trace</h3>
              <ul className="stream" data-testid="council-trace-stream">
                {councilTurns.length ? (
                  councilTurns.map((item) => (
                    <li key={item.turn_id}>
                      <strong>{item.input_text}</strong>
                      <span>
                        {item.world_context?.pack_display_name ?? "unknown"} /{" "}
                        {item.world_context?.world_template_display_name ?? "unknown"}
                      </span>
                      <span>
                        {item.resolution_mode} / final lane {item.model_lane}
                      </span>
                      <span>
                        trace:{" "}
                        {item.langfuse_trace_url ? (
                          <a
                            data-testid={`council-trace-link-${item.turn_id}`}
                            href={item.langfuse_trace_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            open
                          </a>
                        ) : (
                          item.langfuse_status ?? "disabled"
                        )}
                      </span>
                      <span>
                        {item.roles
                          .map(
                            (role) =>
                              `${role.stage_index}.${role.council_role}:${role.approval_status ?? "unknown"}/${role.model_lane}/${role.output_schema_status}`,
                          )
                          .join(" | ")}
                      </span>
                    </li>
                  ))
                ) : (
                  <li>No council turns recorded yet.</li>
                )}
              </ul>
              <h3>Memory retrieval diagnostics</h3>
              <div data-testid="memory-retrieval-trace">
                <p>
                  Latest retrieval: {latestRetrievalTrace?.status ?? "unknown"} / fallback:{" "}
                  {String(latestRetrievalTrace?.used_fallback ?? false)}
                </p>
                <p>
                  Hits: {(latestRetrievalTrace?.retrieved_memory_ids ?? []).join(", ") || "none"} / Scores:{" "}
                  {(latestRetrievalTrace?.top_scores ?? []).join(", ") || "none"}
                </p>
              </div>
              <form className="stack compact-form" onSubmit={handleMemorySearch}>
                <label>
                  Memory query
                  <input
                    data-testid="memory-search-query"
                    value={memorySearchQuery}
                    onChange={(event) => setMemorySearchQuery(event.target.value)}
                  />
                </label>
                <div className="actions">
                  <button data-testid="run-memory-search" type="submit" disabled={!token || memorySearchPending || opsState !== "ready"}>
                    {memorySearchPending ? "Searching..." : "Search memory"}
                  </button>
                  <button
                    data-testid="reindex-memories"
                    type="button"
                    onClick={() => void handleMemoryReindex()}
                    disabled={!token || memoryReindexPending || opsState !== "ready"}
                  >
                    {memoryReindexPending ? "Reindexing..." : "Reindex memories"}
                  </button>
                </div>
              </form>
              {lastMemoryReindex ? (
                <p data-testid="memory-reindex-result">
                  Reindexed {lastMemoryReindex.processed}/{lastMemoryReindex.queued} memories at {lastMemoryReindex.completed_at}
                </p>
              ) : null}
              <p data-testid="memory-search-world-context">
                Memory search pack: {memorySearchResult?.world_context.pack_display_name ?? activeWorldContext?.pack_display_name ?? "unknown"} /{" "}
                {memorySearchResult?.world_context.world_template_display_name ?? activeWorldContext?.world_template_display_name ?? "unknown"}
              </p>
              <ul className="stream" data-testid="memory-search-stream">
                {(memorySearchResult?.hits ?? []).map((item) => (
                  <li key={item.id}>
                    <strong>{item.scope}</strong>
                    <span>{item.text}</span>
                    <span>score {item.score.toFixed(4)}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card wide">
              <h2>Eval harness and release gate</h2>
              <p data-testid="release-scope-summary">Scope diagnostics: {opsScopeLabel}</p>
              <p data-testid="release-gate-verdict">
                Global gate verdict: {releaseGate?.verdict ?? "unknown"} / Canary promote:{" "}
                {releaseGate?.canary_promote_status ?? "unknown"}
              </p>
              <p data-testid="release-cutover-readiness">
                Product cutover: {releaseGate?.cutover_status?.promote_ready ? "ready" : "blocked"} / missing checks:{" "}
                {(releaseGate?.cutover_status?.missing_or_failed_checks ?? []).join(", ") || "none"}
              </p>
              <p>
                Trigger: {releaseGate?.trigger_type ?? "unknown"} / Created: {releaseGate?.created_at ?? "not yet run"}
              </p>
              <p data-testid="release-trace-link">
                Release trace:{" "}
                {releaseGate?.langfuse_trace_url ? (
                  <a href={releaseGate.langfuse_trace_url} target="_blank" rel="noreferrer">
                    open
                  </a>
                ) : (
                  releaseGate?.langfuse_status ?? "disabled"
                )}{" "}
                / delivery: {releaseGate?.langfuse_delivery ?? "unknown"}
              </p>
              <div className="actions">
                <button
                  data-testid="run-eval-smoke"
                  onClick={() => void handleEvalRun("dataset", "turn_resolution_smoke")}
                  disabled={!token || evalPending || opsState !== "ready"}
                >
                  {evalPending ? "Running..." : "Run smoke"}
                </button>
                <button
                  data-testid="run-eval-failure"
                  onClick={() => void handleEvalRun("dataset", "turn_resolution_failure_injection")}
                  disabled={!token || evalPending || opsState !== "ready"}
                >
                  {evalPending ? "Running..." : "Run failure injection"}
                </button>
                <button
                  data-testid="run-eval-shadow"
                  onClick={() => void handleEvalRun("shadow_replay")}
                  disabled={!token || evalPending || opsState !== "ready"}
                >
                  {evalPending ? "Running..." : "Run shadow replay"}
                </button>
                <button
                  data-testid="run-release-checklist"
                  onClick={() => void handleReleaseChecklistRun()}
                  disabled={!token || checklistPending || opsState !== "ready"}
                >
                  {checklistPending ? "Running..." : "Run release checklist"}
                </button>
              </div>
              <h3>Blocked reasons</h3>
              <ul className="stream" data-testid="release-blocked-reasons">
                {(releaseGate?.blocked_reasons ?? []).map((item) => (
                  <li key={item}>
                    <strong>blocked</strong>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <h3>Latest checks</h3>
              <ul className="stream" data-testid="release-checks-stream">
                <li>
                  <strong>smoke</strong>
                  <span>
                    present={String(releaseGate?.checks?.smoke?.present ?? false)} / current=
                    {String(releaseGate?.checks?.smoke?.current_passed ?? false)} / candidate=
                    {String(releaseGate?.checks?.smoke?.candidate_passed ?? false)}
                  </span>
                </li>
                <li>
                  <strong>failure_injection</strong>
                  <span>
                    present={String(releaseGate?.checks?.failure_injection?.present ?? false)} / current=
                    {String(releaseGate?.checks?.failure_injection?.current_passed ?? false)} / candidate=
                    {String(releaseGate?.checks?.failure_injection?.candidate_passed ?? false)}
                  </span>
                </li>
                <li>
                  <strong>shadow_replay</strong>
                  <span>
                    present={String(releaseGate?.checks?.shadow_replay?.present ?? false)} / current=
                    {String(releaseGate?.checks?.shadow_replay?.current_passed ?? false)} / candidate=
                    {String(releaseGate?.checks?.shadow_replay?.candidate_passed ?? false)}
                  </span>
                </li>
              </ul>
              <h3>Bundled pack regressions</h3>
              <ul className="stream" data-testid="release-pack-regressions-stream">
                {filteredReleasePackRegressions.length ? (
                  filteredReleasePackRegressions.map(([datasetName, check]) => (
                    <li key={datasetName}>
                      <strong>{datasetName}</strong>
                      <span>{formatPackScope(check.pack_scope)}</span>
                      <span>
                        present={String(check.present)} / current={String(check.current_passed)} / candidate=
                        {String(check.candidate_passed)}
                      </span>
                    </li>
                  ))
                ) : (
                  <li>No pack regressions match this scope.</li>
                )}
              </ul>
              <h3>Shadow replay failures</h3>
              <ul className="stream" data-testid="shadow-failures-stream">
                {filteredShadowFailures.length ? (
                  filteredShadowFailures.map((item) => (
                    <li key={`${item.case_id}-${item.variant}`}>
                      <strong>{item.case_id}</strong>
                      <span>{formatPackContext(item.pack_context)}</span>
                      <span>{item.variant}</span>
                      <span>{item.graph_context_status}</span>
                      <span>{item.retrieval_status ?? "unknown"} / hits {item.retrieval_hit_count ?? 0}</span>
                      <span>{item.failure_reason ?? "none"}</span>
                    </li>
                  ))
                ) : (
                  <li>No shadow failures match this scope.</li>
                )}
              </ul>
              <h3>Canary and SLO</h3>
              <ul className="stream" data-testid="release-slo-stream">
                <li>
                  <strong>global canary</strong>
                  <span>{releaseGate?.slo_snapshot?.canary_health?.status ?? "unknown"}</span>
                  <span>{releaseGate?.slo_snapshot?.canary_health?.detail ?? "no detail"}</span>
                </li>
                <li>
                  <strong>global primary</strong>
                  <span>lag {releaseGate?.slo_snapshot?.projection_lag_seconds ?? 0}s</span>
                  <span>pending {releaseGate?.slo_snapshot?.outbox_pending_count ?? 0}</span>
                  <span>failed {releaseGate?.slo_snapshot?.outbox_failed_count ?? 0}</span>
                </li>
                <li>
                  <strong>llm</strong>
                  <span>schema {(((releaseGate?.slo_snapshot?.llm_schema_valid_rate ?? 0) as number) * 100).toFixed(0)}%</span>
                  <span>fallback {(((releaseGate?.slo_snapshot?.llm_fallback_rate ?? 0) as number) * 100).toFixed(0)}%</span>
                </li>
              </ul>
              <h3>Runbook</h3>
              <ul className="stream" data-testid="release-runbook">
                <li>
                  <strong>canary up</strong>
                  <span>{releaseGate?.runbook?.canary_up ?? "make canary-up"}</span>
                </li>
                <li>
                  <strong>canary probe</strong>
                  <span>{releaseGate?.runbook?.canary_probe ?? "make canary-probe"}</span>
                </li>
                <li>
                  <strong>pre-promote checklist</strong>
                  <span>{releaseGate?.runbook?.pre_promote_checklist ?? "make release-checklist"}</span>
                </li>
                <li>
                  <strong>nightly gate</strong>
                  <span>{releaseGate?.runbook?.nightly_gate ?? "make nightly-eval"}</span>
                </li>
                <li>
                  <strong>promote condition</strong>
                  <span>{releaseGate?.runbook?.promote_condition ?? "verdict == passed and canary_promote_status == ready"}</span>
                </li>
                <li>
                  <strong>promote</strong>
                  <span>{releaseGate?.runbook?.promote ?? "blocked until gate passes"}</span>
                </li>
                <li>
                  <strong>rollback</strong>
                  <span>{releaseGate?.runbook?.rollback ?? "make canary-down"}</span>
                </li>
              </ul>
              <h3>Current vs candidate diff</h3>
              <ul className="stream" data-testid="release-diff-stream">
                {(releaseGate?.diff_summary ?? []).map((item) => (
                  <li key={item.route_id}>
                    <strong>{item.route_id}</strong>
                    <span>current: {item.current?.model_ids.main_lane ?? "none"}</span>
                    <span>candidate: {item.candidate?.model_ids.main_lane ?? "none"}</span>
                  </li>
                ))}
              </ul>
              <h3>Latest eval runs</h3>
              <ul className="stream" data-testid="eval-runs-stream">
                {evalRuns.map((item) => (
                  <li key={item.id}>
                    <strong>{item.dataset_name ?? item.source_type}</strong>
                    <span>{formatPackScope(item.summary.pack_scope)}</span>
                    <span>{item.status}</span>
                    <span>
                      {item.trigger_type} / {item.runtime_role}
                    </span>
                    <span>
                      trace:{" "}
                      {item.langfuse_trace_url ? (
                        <a
                          data-testid={`eval-trace-link-${item.id}`}
                          href={item.langfuse_trace_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          open
                        </a>
                      ) : (
                        item.langfuse_status ?? "disabled"
                      )}
                    </span>
                    <span>
                      current {item.summary.variants?.current?.passed ?? 0}/{item.summary.variants?.current?.total ?? 0}
                    </span>
                    <span>
                      candidate {item.summary.variants?.candidate?.passed ?? 0}/
                      {item.summary.variants?.candidate?.total ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
              <h3>Latest eval case results</h3>
              <ul className="stream" data-testid="eval-case-results-stream">
                {(evalRunDetail?.results ?? []).slice(0, 12).map((item) => (
                  <li key={`${item.id}-${item.variant}`}>
                    <strong>{item.case_id}</strong>
                    <span>{formatPackContext(item.pack_context)}</span>
                    <span>
                      {item.variant} / {item.lane}
                    </span>
                    <span>
                      schema={String(item.schema_valid)} / same-world={String(item.same_world_invariant)}
                    </span>
                    <span>
                      graph={item.graph_context_status} / passed={String(item.passed)}
                    </span>
                    <span>{item.failure_reason ?? "none"}</span>
                  </li>
                ))}
              </ul>
              <h3>Recent traces</h3>
              <ul className="stream" data-testid="observability-traces-stream">
                {filteredRecentTraces.length ? (
                  filteredRecentTraces.slice(0, 8).map((item, index) => (
                    <li key={`${item.name}-${index}`}>
                      <strong>{item.name}</strong>
                      <span>{JSON.stringify(item.attributes)}</span>
                    </li>
                  ))
                ) : (
                  <li>No traces match this scope.</li>
                )}
              </ul>
            </article>

            <article className="card">
              <h2>SP overview</h2>
              <p data-testid="sp-world-context">
                Pack dimension: {activeWorldContext?.pack_display_name ?? "unknown"} /{" "}
                {activeWorldContext?.world_template_display_name ?? "all templates"}
              </p>
              <p data-testid="sp-overview">
                Accounts: {spOverview?.total_accounts ?? 0} / Ledger rows: {spOverview?.total_ledger_entries ?? 0}
              </p>
              <p>
                Default balance: {spOverview?.default_balance ?? health?.sp?.default_balance ?? "?"} / Choice cost:{" "}
                <span data-testid="turn-cost">
                  {spOverview?.choice_turn_cost ?? health?.sp?.choice_turn_cost ?? spOverview?.turn_cost ?? health?.sp?.turn_cost ?? "?"}
                </span>{" "}
                / Free text cost: {spOverview?.free_text_turn_cost ?? health?.sp?.free_text_turn_cost ?? "?"}
              </p>
              {lastAdjustment ? (
                <p data-testid="last-adjustment">
                  Last adjustment: {lastAdjustment.delta} to {lastAdjustment.user_sub}, balance {lastAdjustment.balance}
                </p>
              ) : null}
              <h3>Recent adjustments</h3>
              <ul className="stream" data-testid="recent-adjustments-stream">
                {(spOverview?.recent_adjustments ?? []).map((item) => (
                  <li key={item.id}>
                    <strong>{item.reason_code}</strong>
                    <span>{item.user_sub}</span>
                    <span>{item.delta}</span>
                    <span>{item.world_context?.pack_display_name ?? "unknown"}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card wide">
              <h2>Ledger filters</h2>
              <form className="stack compact-form" onSubmit={handleLedgerRefresh}>
                <label>
                  User sub
                  <input
                    data-testid="ledger-user-filter"
                    value={ledgerUserFilter}
                    onChange={(event) => setLedgerUserFilter(event.target.value)}
                  />
                </label>
                <label>
                  World ID
                  <input
                    data-testid="ledger-world-filter"
                    value={ledgerWorldFilter}
                    onChange={(event) => setLedgerWorldFilter(event.target.value)}
                  />
                </label>
                <button data-testid="refresh-ledger" type="submit" disabled={!token}>
                  Refresh ledger
                </button>
              </form>
              <ul className="stream" data-testid="admin-ledger">
                {ledgerEntries.map((item) => (
                  <li key={item.id}>
                    <strong>{item.reason_code}</strong>
                    <span>{item.user_sub}</span>
                    <span>
                      delta {item.delta} / balance {item.balance_after}
                    </span>
                    <span>{item.world_context?.pack_display_name ?? item.world_id ?? "unknown"}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="card wide">
              <h2>Adjustment form</h2>
              <form className="stack compact-form" onSubmit={handleAdjustmentSubmit}>
                <label>
                  User sub
                  <input
                    data-testid="adjust-user-sub"
                    value={adjustUserSub}
                    onChange={(event) => setAdjustUserSub(event.target.value)}
                  />
                </label>
                <label>
                  Delta
                  <input
                    data-testid="adjust-delta"
                    value={adjustDelta}
                    onChange={(event) => setAdjustDelta(event.target.value)}
                  />
                </label>
                <label>
                  Reason code
                  <input
                    data-testid="adjust-reason"
                    value={adjustReason}
                    onChange={(event) => setAdjustReason(event.target.value)}
                  />
                </label>
                <label>
                  World ID
                  <input
                    data-testid="adjust-world-id"
                    value={adjustWorldId}
                    onChange={(event) => setAdjustWorldId(event.target.value)}
                  />
                </label>
                <label>
                  Note
                  <textarea
                    data-testid="adjust-note"
                    rows={3}
                    value={adjustNote}
                    onChange={(event) => setAdjustNote(event.target.value)}
                  />
                </label>
                <button data-testid="submit-adjustment" type="submit" disabled={!token || adjustPending}>
                  {adjustPending ? "Applying..." : "Apply adjustment"}
                </button>
              </form>
            </article>
          </>
        )}
      </section>

      {error ? (
        <aside className="error" data-testid="error-banner">
          {error}
        </aside>
      ) : null}
    </main>
  );
}

export default App;
