from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_project_path(*parts: str) -> Path:
    workspace_path = Path("/workspace").joinpath(*parts)
    repo_path = Path(__file__).resolve().parents[3].joinpath(*parts)
    for candidate in (workspace_path, repo_path):
        if candidate.exists():
            return candidate
    return workspace_path if Path("/workspace").exists() else repo_path


class Settings(BaseSettings):
    app_env: str = "development"
    app_runtime_role: str = "primary"
    database_url: str = "sqlite:///./gestaloka.db"
    alembic_database_url: str = "sqlite:///./gestaloka.db"
    public_ws_base_url: str = "ws://localhost:8000"
    graph_projection_backend: str = "recording"
    nebula_host: str = "nebula-graphd"
    nebula_port: int = 9669
    nebula_space: str = "gestaloka_v2"
    nebula_user: str = "root"
    nebula_password: str = "nebula"
    ops_admin_subs: str = ""
    sp_default_balance: int = 30
    sp_initial_bonus_balance: int = 30
    turn_sp_cost: int = 1
    choice_turn_sp_cost: int = 1
    free_text_turn_sp_cost: int = 3
    oidc_issuer_url: str = "http://localhost:8080/realms/gestaloka"
    oidc_public_issuer_url: str = "http://localhost:8080/realms/gestaloka"
    oidc_client_id: str = "gestaloka-frontend"
    oidc_allowed_client_ids: str = "gestaloka-admin-frontend"
    oidc_audience: str = "account"
    oidc_dev_mode: bool = False
    dev_oidc_sub: str = "local-player"
    dev_oidc_email: str = "demo@example.com"
    dev_oidc_name: str = "Demo Player"
    prompt_dir: Path = Field(default_factory=lambda: _default_project_path("prompts"))
    pack_dir: Path = Field(default_factory=lambda: _default_project_path("packs"))
    eval_dataset_dir: Path = Field(default_factory=lambda: _default_project_path("evals", "datasets"))
    release_config_dir: Path = Field(default_factory=lambda: _default_project_path("config", "release"))
    release_runtime_config_name: str = "current"
    release_scheduler_cron: str = "0 3 * * *"
    release_shadow_limit: int = 5
    release_check_timeout_seconds: float = 300.0
    release_check_total_budget_seconds: float = 900.0
    world_idle_interval_seconds: int = 60
    world_idle_grace_seconds: int = 60
    model_provider: str = "openai_compatible"
    embedding_provider: str = "openai_compatible"
    gemini_api_key: str = ""
    gemini_timeout_seconds: float = 30.0
    gemini_max_retries: int = 2
    gemini_temperature_lite: float = 0.2
    gemini_temperature_main: float = 0.3
    gemini_temperature_pro: float = 0.1
    gemini_embedding_model: str = "gemini-embedding-001"
    openai_compat_api_key: str = ""
    openai_compat_base_url: str = ""
    openai_compat_timeout_seconds: float = 30.0
    openai_compat_max_retries: int = 2
    openai_compat_response_format: str = "json_schema"
    openai_compat_context_cache_enabled: bool = True
    openai_compat_explicit_context_cache_enabled: bool = False
    openai_compat_context_cache_ttl_seconds: int = 3600
    openai_compat_embedding_api_key: str = ""
    openai_compat_embedding_base_url: str = ""
    openai_compat_embedding_model: str = ""
    openai_compat_send_embedding_dimensions: bool = True
    memory_embedding_dim: int = 768
    memory_embedding_timeout_seconds: float = 8.0
    memory_embedding_max_retries: int = 1
    memory_retrieval_limit: int = 8
    memory_retrieval_min_score: float = 0.1
    model_lite_id: str = ""
    model_main_id: str = ""
    model_pro_id: str = ""
    otel_service_name: str = "gestaloka-backend"
    otel_exporter_otlp_endpoint: str = ""
    otel_metrics_host: str = "0.0.0.0"
    otel_metrics_port: int = 0
    langfuse_enabled: bool = False
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = ""
    langfuse_internal_base_url: str = ""
    langfuse_project: str = ""
    langfuse_env: str = "development"
    canary_health_url: str = ""
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174"]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def ops_admin_sub_list(self) -> list[str]:
        return [item.strip() for item in self.ops_admin_subs.split(",") if item.strip()]

    @property
    def oidc_allowed_client_id_list(self) -> list[str]:
        allowed = [self.oidc_client_id, *self.oidc_allowed_client_ids.split(",")]
        deduped: list[str] = []
        for item in allowed:
            client_id = item.strip()
            if client_id and client_id not in deduped:
                deduped.append(client_id)
        return deduped

    @property
    def openai_compat_embedding_effective_api_key(self) -> str:
        return self.openai_compat_embedding_api_key or self.openai_compat_api_key

    @property
    def openai_compat_embedding_effective_base_url(self) -> str:
        return self.openai_compat_embedding_base_url or self.openai_compat_base_url

    @model_validator(mode="after")
    def normalize_paths(self) -> "Settings":
        if not self.prompt_dir.exists():
            self.prompt_dir = _default_project_path("prompts")
        if "pack_dir" not in self.model_fields_set and not self.pack_dir.exists():
            self.pack_dir = _default_project_path("packs")
        if not self.eval_dataset_dir.exists():
            self.eval_dataset_dir = _default_project_path("evals", "datasets")
        if not self.release_config_dir.exists():
            self.release_config_dir = _default_project_path("config", "release")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
