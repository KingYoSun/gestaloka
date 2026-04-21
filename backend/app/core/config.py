from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./gestaloka.db"
    alembic_database_url: str = "sqlite:///./gestaloka.db"
    public_ws_base_url: str = "ws://localhost:8000"
    oidc_issuer_url: str = "http://localhost:8080/realms/gestaloka"
    oidc_public_issuer_url: str = "http://localhost:8080/realms/gestaloka"
    oidc_client_id: str = "gestaloka-frontend"
    oidc_audience: str = "account"
    oidc_dev_mode: bool = False
    dev_oidc_sub: str = "local-player"
    dev_oidc_email: str = "demo@example.com"
    dev_oidc_name: str = "Demo Player"
    prompt_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[3] / "prompts")
    model_provider: str = "stub"
    model_lite_id: str = "gemini-3.1-flash-lite"
    model_main_id: str = "gemini-3-flash"
    model_pro_id: str = "gemini-3.1-pro"
    graph_projection_backend: str = "recording"
    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
