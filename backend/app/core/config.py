from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    sp_default_balance: int = 10
    turn_sp_cost: int = 1
    oidc_issuer_url: str = "http://localhost:8080/realms/gestaloka"
    oidc_public_issuer_url: str = "http://localhost:8080/realms/gestaloka"
    oidc_client_id: str = "gestaloka-frontend"
    oidc_audience: str = "account"
    oidc_dev_mode: bool = False
    dev_oidc_sub: str = "local-player"
    dev_oidc_email: str = "demo@example.com"
    dev_oidc_name: str = "Demo Player"
    prompt_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[3] / "prompts")
    eval_dataset_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[3] / "evals" / "datasets")
    release_config_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[3] / "config" / "release")
    release_runtime_config_name: str = "current"
    release_scheduler_cron: str = "0 3 * * *"
    release_shadow_limit: int = 5
    model_provider: str = "stub"
    embedding_provider: str = "stub"
    gemini_api_key: str = ""
    gemini_timeout_seconds: float = 30.0
    gemini_max_retries: int = 2
    gemini_temperature_lite: float = 0.2
    gemini_temperature_main: float = 0.3
    gemini_temperature_pro: float = 0.1
    gemini_embedding_model: str = "gemini-embedding-001"
    memory_embedding_dim: int = 768
    memory_retrieval_limit: int = 8
    memory_retrieval_min_score: float = 0.1
    model_lite_id: str = "gemini-2.5-flash-lite"
    model_main_id: str = "gemini-3-flash-preview"
    model_pro_id: str = "gemini-3.1-pro-preview"
    otel_service_name: str = "gestaloka-backend"
    otel_exporter_otlp_endpoint: str = ""
    otel_metrics_host: str = "0.0.0.0"
    otel_metrics_port: int = 0
    canary_health_url: str = ""
    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def ops_admin_sub_list(self) -> list[str]:
        return [item.strip() for item in self.ops_admin_subs.split(",") if item.strip()]

    @model_validator(mode="after")
    def normalize_paths(self) -> "Settings":
        if not self.prompt_dir.exists() and self.prompt_dir == Path("/workspace/prompts"):
            self.prompt_dir = Path(__file__).resolve().parents[3] / "prompts"
        if not self.eval_dataset_dir.exists() and self.eval_dataset_dir == Path("/workspace/evals/datasets"):
            self.eval_dataset_dir = Path(__file__).resolve().parents[3] / "evals" / "datasets"
        if not self.release_config_dir.exists() and self.release_config_dir == Path("/workspace/config/release"):
            self.release_config_dir = Path(__file__).resolve().parents[3] / "config" / "release"
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
