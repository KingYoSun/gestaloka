export type AppRoute = "game";

export type AuthMe = {
  sub: string;
  email: string;
  name: string;
  preferred_username: string;
};

export type HealthPayload = {
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
    initial_bonus_sp: number;
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

export type LangfuseStatus = {
  stack: string;
  enabled: boolean;
  base_url: string | null;
  runtime_status: string;
  last_error: string | null;
};

export type SessionInfo = {
  session_id: string;
  world_id: string;
  world_name: string;
  pack_id: string;
  world_template_id: string;
  world_context: WorldContext;
  player_actor_id: string;
  player_profile: PlayerProfile;
  npc_actor_id: string;
  location_id: string;
  websocket_url: string;
};

export type NarrativePreferences = {
  perspective: "first_person" | "third_person";
  tone: "lyrical" | "logical";
  density: "concise" | "ornate";
  dialogue_style: "dialogue_forward" | "literary";
};

export type PlayLanguagePreset =
  | "ja"
  | "en"
  | "zh-Hans"
  | "zh-Hant"
  | "ko"
  | "es"
  | "fr"
  | "de"
  | "pt-BR"
  | "it"
  | "id"
  | "th"
  | "vi"
  | "ar"
  | "hi";

export type PlayLanguage = {
  mode: "preset" | "custom";
  preset: PlayLanguagePreset | null;
  custom: string;
  prompt_name: string;
};

export type PlayerProfile = {
  actor_id: string;
  world_id: string;
  display_name: string;
  gender: "male" | "female" | "unspecified" | "other";
  background: string;
  free_text: string;
  narrative_preferences: NarrativePreferences;
  play_language: PlayLanguage;
  locked: boolean;
  locked_at: string | null;
  profile_setup_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WorldPackItem = {
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

export type WorldPackCatalog = {
  status: string;
  engine_api_version: string;
  pack_count: number;
  template_count: number;
  items: WorldPackItem[];
};

export type PlayableWorldItem = {
  world_id: string;
  display_name: string;
  summary: string;
  health_url: string;
  status: string;
  pack_context: PackScope;
};

export type PlayableWorldCatalog = {
  status: string;
  engine_api_version: string;
  world_count: number;
  items: PlayableWorldItem[];
};

export type OpsWorldPackItem = WorldPackItem & {
  root_dir: string;
};

export type OpsWorldPackFailure = {
  error: string;
  message: string;
  severity: string;
  pack_id?: string;
  path?: string;
};

export type OpsWorldPackCatalog = {
  status: string;
  pack_dir: string;
  engine_api_version: string;
  pack_count: number;
  template_count: number;
  failure_count: number;
  failures: OpsWorldPackFailure[];
  items: OpsWorldPackItem[];
};

export type WorldContext = {
  world_id: string;
  world_name: string;
  pack_id: string;
  pack_display_name: string;
  world_template_id: string;
  world_template_display_name: string;
  semantic_tags: string[];
};

export type PackScope = {
  pack_id: string;
  pack_display_name: string;
  world_template_id: string;
  world_template_display_name: string;
};

export type PackContext = PackScope & {
  world_id: string;
};

export type OpsWorldItem = {
  world_context: WorldContext;
  status: string;
  active_session_count: number;
  updated_at: string;
};

export type ChapterSummaryValue = {
  id: string;
  key: string;
  status: string;
  quest_assignment_id?: string | null;
  chapter_kind?: "ambient" | "prologue" | "body" | "epilogue" | string;
  sequence_index?: number;
  summary: string;
  crossroads_summary?: string;
  branch_hint?: string;
};

export type ChapterSummary = ChapterSummaryValue | null;

export type SceneSummaryValue = {
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

export type CurrentSceneSummary = SceneSummaryValue | null;

export type CharacterSummary = {
  actor_id: string;
  rank: string;
  hp: number;
  focus: number;
  status_json: Record<string, unknown>;
};

export type NarrativeChoice = {
  choice_id: "safe" | "progress" | "explore";
  posture: "safe" | "progress" | "explore";
  label: string;
  summary: string;
  canonical_input_text: string;
  action_kind: "narrative" | "use_reward_item" | "travel";
  travel_target_key?: string | null;
};

export type QuestSummary = {
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
  available_actions?: string[];
  chapters?: Array<{
    id: string;
    key: string;
    status: string;
    chapter_kind: string;
    sequence_index: number;
    summary: string;
  }>;
};

export type QuestDisplayState = {
  mode: "exploration" | "quest" | string;
  label: string;
};

export type FactionSummary = {
  faction_id: string;
  name: string;
  description: string;
  standing: number;
  band: string;
};

export type InventorySummary = {
  id: string;
  template_key: string;
  name: string;
  description: string;
  status: string;
  usable: boolean;
  effect_kind: string | null;
};

export type RelationshipSummary = {
  actor_id: string;
  display_name: string;
  band: string;
  summary: string;
};

export type LocalFigureSummary = {
  actor_id: string;
  display_name: string;
  summary: string;
};

export type NPCLocationSummary = {
  actor_id: string;
  display_name: string;
  location_id: string | null;
  location_name: string;
  summary: string;
};

export type CurrentLocationSummary = {
  id: string;
  key: string;
  name: string;
  description: string;
} | null;

export type NearbyRouteSummary = {
  route_key: string;
  summary: string;
  destination_name: string;
  destination_key: string;
  available: boolean;
};

export type ConsequenceThreadSummary = {
  id: string;
  title: string;
  summary: string;
  pressure_band: string;
  counterpart_actor_id?: string | null;
  counterpart_name?: string | null;
  thread_type?: string;
  status?: string;
};

export type SessionState = {
  world_id: string;
  world_context?: WorldContext;
  location: CurrentLocationSummary;
  current_location: CurrentLocationSummary;
  character: CharacterSummary;
  player_profile: PlayerProfile | null;
  quests: QuestSummary[];
  quest_journal: QuestSummary[];
  quest_display_state: QuestDisplayState;
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

export type TurnResponse = {
  turn_id: string;
  world_context?: WorldContext;
  action_type: "narrative" | "use_reward_item" | "travel" | "accept_quest" | "decline_quest" | "leave_quest" | "resume_quest";
  input_mode: "choice" | "free_text";
  event_id: string;
  memory_ids: string[];
  narrative: string;
  npc_reaction: string;
  sp_delta: number;
  sp_balance: number;
  paid_sp: number;
  bonus_sp: number;
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
  failure?: {
    reason: string | null;
    rejection_role: string | null;
    final_lane: string | null;
    used_fallback: boolean;
    council_trace: Array<Record<string, unknown>>;
    retryable_choice_id: "safe" | "progress" | "explore" | null;
  };
};

export type TurnAcceptedResponse = {
  status: "accepted";
  turn_id: string;
  session_id: string;
  world_context?: WorldContext;
};

export type StoryHistoryItem = {
  event_id: string;
  turn_id: string | null;
  canonical_sequence: number | null;
  occurred_at: string;
  input_mode: string;
  narrative: string;
  reaction: string;
  consequence: string;
  scene_summary: string;
};

export type StoryHistoryResponse = {
  items: StoryHistoryItem[];
  next_before_sequence: number | null;
};

export type EventItem = {
  id: string;
  turn_id: string | null;
  narrative: string;
  event_type: string;
  location_id: string | null;
  payload: Record<string, unknown>;
};

export type MemoryItem = {
  id: string;
  scope: string;
  text: string;
  actor_id: string | null;
  location_id: string | null;
  salience: number;
};

export type SPLedgerItem = {
  id: string;
  user_sub: string;
  world_id: string | null;
  actor_id: string | null;
  delta: number;
  paid_delta: number;
  bonus_delta: number;
  reason_code: string;
  reference_type: string;
  reference_id: string;
  balance_after: number;
  paid_balance_after: number;
  bonus_balance_after: number;
  created_by_sub: string | null;
  note: string | null;
  created_at: string;
  world_context?: WorldContext | null;
};

export type SPWallet = {
  user_sub: string;
  balance: number;
  paid_sp: number;
  bonus_sp: number;
  initial_bonus_sp: number;
  turn_cost: number;
  choice_turn_cost: number;
  free_text_turn_cost: number;
  budget_scope?: string;
  recent_entries: SPLedgerItem[];
};

export type ProjectionStatus = {
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

export type EmbeddingStatus = {
  provider: string;
  model: string;
  dimension: number;
  ready_count: number;
  pending_count: number;
  failed_count: number;
  runtime_status: string;
  runtime_error: string | null;
};

export type MemorySearchResponse = {
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

export type MemoryReindexResult = {
  world_id: string | null;
  queued: number;
  processed: number;
  processed_memory_ids: string[];
  pending_count: number;
  failed_count: number;
  completed_at: string;
};

export type GraphSummary = {
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

export type RelationshipOpsItem = {
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

export type ConsequenceThreadOpsItem = {
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

export type ChapterOpsItem = {
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

export type RoutePressureOpsItem = {
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

export type ChapterBranchOpsItem = {
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

export type SceneOpsItem = {
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

export type NPCRoutineOpsItem = {
  actor_id: string;
  display_name: string;
  location_id: string | null;
  routine_state: Record<string, unknown>;
  updated_at: string;
};

export type AmbientBeatOpsItem = {
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

export type LocationOpsItem = {
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

export type TravelLogItem = {
  event_id: string;
  turn_id: string;
  narrative?: string;
  travel_summary?: string;
  location_id: string | null;
  created_at: string;
};

export type WorldTickItem = {
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

export type RebuildSummary = {
  world_id: string;
  world_context: WorldContext;
  records: number;
  completed_at: string;
  vertex_count: number;
  edge_count: number;
};

export type SPOverview = {
  default_balance: number;
  initial_bonus_sp: number;
  turn_cost: number;
  choice_turn_cost: number;
  free_text_turn_cost: number;
  total_paid_sp: number;
  total_bonus_sp: number;
  total_accounts: number;
  total_ledger_entries: number;
  recent_adjustments: SPLedgerItem[];
};

export type SPAdjustmentResponse = {
  ledger_entry_id: string;
  user_sub: string;
  delta: number;
  paid_delta: number;
  bonus_delta: number;
  balance: number;
  paid_sp: number;
  bonus_sp: number;
};

export type EvalRunVariantSummary = {
  total: number;
  passed: number;
  failed: number;
  failed_case_ids: string[];
  gate_passed: boolean;
};

export type EvalRunItem = {
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

export type EvalRunCaseResult = {
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

export type EvalRunDetail = EvalRunItem & {
  results: EvalRunCaseResult[];
};

export type ReleaseSLOSnapshot = {
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

export type RouteDiff = {
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

export type GateCheck = {
  present: boolean;
  current_passed: boolean;
  candidate_passed: boolean;
  run_id: string | null;
  pack_scope?: PackScope[];
};

export type ReleaseGateReport = {
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
    retrieval_required?: boolean;
    failure_categories?: string[];
    failure_diagnostics?: string;
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

export type CouncilRoleSummary = {
  council_role: string;
  stage_index: number;
  approval_status: string | null;
  prompt_id: string;
  model_id: string;
  model_lane: string;
  provider_name: string | null;
  provider_response_id: string | null;
  prompt_cache_hit_tokens?: number | null;
  prompt_cache_miss_tokens?: number | null;
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
    prompt_cache_hit_tokens?: number | null;
    prompt_cache_miss_tokens?: number | null;
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

export type CouncilTurnTrace = {
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

export type ObservabilitySummary = {
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

export type ObservabilitySnapshotItem = {
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

export type ObservabilitySnapshotList = {
  items: ObservabilitySnapshotItem[];
};

export type ActivityMessage = {
  event: string;
  data: Record<string, unknown> & { world_context: WorldContext };
};

export type APIError = Error & {
  status?: number;
  body?: unknown;
  requiresReauth?: boolean;
};
