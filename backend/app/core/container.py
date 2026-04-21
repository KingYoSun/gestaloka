from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.core.db import create_session_factory
from app.core.prompts import PromptRegistry
from app.modules.graph_projection.service import ProjectionService
from app.modules.identity.oidc import BaseOIDCAdapter, build_oidc_adapter
from app.modules.llm_harness.service import ModelRouter


@dataclass
class AppContainer:
    settings: Settings
    session_factory: sessionmaker[Session]
    oidc_adapter: BaseOIDCAdapter
    prompt_registry: PromptRegistry
    model_router: ModelRouter
    projection_service: ProjectionService


def build_container(settings: Settings | None = None) -> AppContainer:
    resolved_settings = settings or get_settings()
    session_factory = create_session_factory(resolved_settings)
    prompt_registry = PromptRegistry(resolved_settings.prompt_dir)
    model_router = ModelRouter(resolved_settings, prompt_registry)
    projection_service = ProjectionService(resolved_settings)
    return AppContainer(
        settings=resolved_settings,
        session_factory=session_factory,
        oidc_adapter=build_oidc_adapter(resolved_settings),
        prompt_registry=prompt_registry,
        model_router=model_router,
        projection_service=projection_service,
    )
