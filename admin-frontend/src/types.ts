export type PackItem = {
  pack_id: string;
  version: string;
  engine_api_version: string;
  display_name: string;
  visibility: "public" | "private";
  publish_status: "playable" | "draft" | "archived";
  semantic_tags: string[];
  root_dir?: string;
  world_templates: TemplateItem[];
};

export type TemplateItem = {
  pack_id?: string;
  pack_display_name?: string;
  template_id: string;
  display_name: string;
  summary: string;
  visibility?: "public" | "private" | null;
  publish_status?: "playable" | "draft" | "archived" | null;
  effective_visibility: "public" | "private";
  effective_publish_status: "playable" | "draft" | "archived";
};

export type PackCatalog = {
  status: string;
  pack_dir: string;
  engine_api_version: string;
  pack_count: number;
  template_count: number;
  failure_count: number;
  items: PackItem[];
  failures: Array<{ error: string; message: string; severity: string; pack_id?: string }>;
};

export type Overview = {
  status: string;
  packs: { status: string; pack_count: number; template_count: number; failure_count: number };
  projection: { backend: string; graph_read_mode: string; graph_runtime_status: string; pending: number; failed: number };
  sp: { total_accounts: number; total_ledger_entries: number; choice_turn_cost: number; free_text_turn_cost: number };
  release: { verdict: string; canary_promote_status: string; created_at: string | null };
};

export type AdminUser = {
  user_sub: string;
  email: string;
  display_name: string;
  role: "admin" | "operator" | "viewer";
  status: "active" | "disabled";
  permissions: Record<string, unknown>;
  source?: string;
};

export type LLMSettings = {
  provider: string;
  base_url_secret_ref: string;
  api_key_secret_ref: string;
  embedding_provider: string;
  embedding_base_url_secret_ref: string;
  embedding_api_key_secret_ref: string;
  admin_debug_enabled: boolean;
  effective_provider?: string;
  effective_embedding_provider?: string;
};

export type ModelLanes = {
  supported_lanes: string[];
  model_ids: Record<string, string>;
};

export type PromptListItem = {
  prompt_id: string;
  owner_module: string;
  schema_version: string;
  model_lane: string;
  expected_output_schema: string;
  eval_dataset_ref: string;
  override_enabled: boolean;
};

export type PromptDetail = PromptListItem & {
  world_invariants: string[];
  instructions: string;
  override: { enabled: boolean; instructions: string };
};

export type SPOverview = {
  default_balance: number;
  choice_turn_cost: number;
  free_text_turn_cost: number;
  total_accounts: number;
  total_ledger_entries: number;
  recent_adjustments: Array<{ id: string; user_sub: string; delta: number; reason_code: string; balance_after: number }>;
};

export type ReleaseSummary = {
  report_id: string | null;
  verdict: string;
  blocked_reasons: string[];
  trigger_type: string;
  canary_promote_status: string;
  created_at: string | null;
  cutover_status?: { promote_ready: boolean; missing_or_failed_checks: string[] };
};

export type ReleaseProgress = {
  status: string;
  current_check: string | null;
  started_at: string | null;
  updated_at: string | null;
  elapsed_seconds: number;
  completed_report_id: string | null;
  error: string | null;
};
