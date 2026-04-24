from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.container import build_container
from app.core.config import Settings
from app.main import create_app
from app.models.base import Base
import app.modules.observability.service as observability_module


REPO_ROOT = Path(__file__).resolve().parents[2]


class _FakeLangfuseObservation:
    def __init__(
        self,
        *,
        client: "_FakeLangfuseClient",
        as_type: str,
        name: str,
        trace_id: str,
        input_payload: Any,
        metadata: dict[str, Any] | None,
        model: str | None,
        model_parameters: dict[str, Any] | None,
    ) -> None:
        self._client = client
        self.as_type = as_type
        self.name = name
        self.trace_id = trace_id
        self.id = hashlib.sha256(f"{trace_id}:{name}:{as_type}:{len(client.records)}".encode("utf-8")).hexdigest()[:16]
        self.input = input_payload
        self.metadata = metadata or {}
        self.model = model
        self.model_parameters = model_parameters or {}
        self.output: Any | None = None
        self.level = "DEFAULT"
        self.status_message: str | None = None

    def __enter__(self) -> "_FakeLangfuseObservation":
        self._client.records.append(
            {
                "event": "enter",
                "trace_id": self.trace_id,
                "observation_id": self.id,
                "name": self.name,
                "as_type": self.as_type,
                "metadata": dict(self.metadata),
            }
        )
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self._client.records.append(
            {
                "event": "exit",
                "trace_id": self.trace_id,
                "observation_id": self.id,
                "name": self.name,
                "exc_type": getattr(exc_type, "__name__", None),
            }
        )
        return False

    def update(self, **kwargs: Any) -> None:
        self.output = kwargs.get("output", self.output)
        if "metadata" in kwargs and isinstance(kwargs["metadata"], dict):
            self.metadata = {**self.metadata, **kwargs["metadata"]}
        if "level" in kwargs:
            self.level = str(kwargs["level"])
        if "status_message" in kwargs:
            self.status_message = None if kwargs["status_message"] is None else str(kwargs["status_message"])
        self._client.records.append(
            {
                "event": "update",
                "trace_id": self.trace_id,
                "observation_id": self.id,
                "name": self.name,
                "metadata": dict(self.metadata),
                "output": self.output,
            }
        )


class _FakeLangfuseClient:
    def __init__(self, base_url: str, project: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.project = project
        self.records: list[dict[str, Any]] = []
        self.raise_on_flush = False

    def create_trace_id(self, seed: str) -> str:
        return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:32]

    def start_as_current_observation(
        self,
        *,
        as_type: str,
        name: str,
        trace_context: dict[str, Any] | None = None,
        input: Any | None = None,
        metadata: dict[str, Any] | None = None,
        model: str | None = None,
        model_parameters: dict[str, Any] | None = None,
    ) -> _FakeLangfuseObservation:
        trace_id = None
        if trace_context is not None:
            trace_id = trace_context.get("trace_id")
        if not trace_id:
            trace_id = self.create_trace_id(f"{name}:{len(self.records)}")
        return _FakeLangfuseObservation(
            client=self,
            as_type=as_type,
            name=name,
            trace_id=str(trace_id),
            input_payload=input,
            metadata=metadata,
            model=model,
            model_parameters=model_parameters,
        )

    def get_trace_url(self, *, trace_id: str | None = None) -> str | None:
        if trace_id is None:
            return None
        return f"{self.base_url}/project/{self.project}/traces/{trace_id}"

    def flush(self) -> None:
        if self.raise_on_flush:
            raise RuntimeError("fake langfuse flush failed")


class _NullPropagationContext:
    def __enter__(self) -> SimpleNamespace:
        return SimpleNamespace()

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def _fake_propagate_attributes(**_: Any) -> _NullPropagationContext:
    return _NullPropagationContext()


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
        embedding_provider="stub",
        prompt_dir=REPO_ROOT / "prompts",
        eval_dataset_dir=REPO_ROOT / "evals" / "datasets",
        release_config_dir=REPO_ROOT / "config" / "release",
        otel_metrics_port=0,
        cors_origins=["http://testserver"],
        langfuse_enabled=True,
        langfuse_public_key="pk-lf-test",
        langfuse_secret_key="sk-lf-test",
        langfuse_base_url="http://langfuse.test",
        langfuse_internal_base_url="http://langfuse.test",
        langfuse_project="gestaloka-v2",
        langfuse_env="test",
    )


@pytest.fixture()
def container(test_settings: Settings):
    observability_module.propagate_attributes = _fake_propagate_attributes
    built = build_container(test_settings)
    built.observability_service._langfuse_client = _FakeLangfuseClient(
        base_url=test_settings.langfuse_base_url,
        project=test_settings.langfuse_project,
    )
    built.observability_service._clear_langfuse_error()
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
