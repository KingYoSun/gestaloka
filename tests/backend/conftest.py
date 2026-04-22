from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.container import build_container
from app.core.config import Settings
from app.main import create_app
from app.models.base import Base


REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def test_settings(tmp_path: Path) -> Settings:
    db_path = tmp_path / "gestaloka-test.db"
    sqlite_url = f"sqlite:///{db_path}"
    return Settings(
        database_url=sqlite_url,
        alembic_database_url=sqlite_url,
        oidc_dev_mode=True,
        graph_projection_backend="recording",
        model_provider="stub",
        prompt_dir=REPO_ROOT / "prompts",
        eval_dataset_dir=REPO_ROOT / "evals" / "datasets",
        release_config_dir=REPO_ROOT / "config" / "release",
        otel_metrics_port=0,
        cors_origins=["http://testserver"],
    )


@pytest.fixture()
def container(test_settings: Settings):
    built = build_container(test_settings)
    engine = built.session_factory.kw["bind"]
    Base.metadata.create_all(bind=engine)
    return built


@pytest.fixture()
def client(container):
    app = create_app(container)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer dev-local-token"}
