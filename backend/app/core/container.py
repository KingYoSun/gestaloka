from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.core.db import create_session_factory
from app.core.prompts import PromptRegistry
from app.modules.economy_sp.service import EconomyService
from app.modules.eval_harness.service import EvalHarnessService
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
    eval_service: EvalHarnessService
    economy_service: EconomyService
    projection_service: ProjectionService


def build_container(settings: Settings | None = None) -> AppContainer:
    resolved_settings = settings or get_settings()
    session_factory = create_session_factory(resolved_settings)
    projection_service = ProjectionService(resolved_settings)
    prompt_registry = PromptRegistry(resolved_settings.prompt_dir, resolved_settings.eval_dataset_dir)
    eval_service = EvalHarnessService(resolved_settings, prompt_registry, projection_service)
    model_router = eval_service.runtime_router()
    economy_service = EconomyService(resolved_settings)
    return AppContainer(
        settings=resolved_settings,
        session_factory=session_factory,
        oidc_adapter=build_oidc_adapter(resolved_settings),
        prompt_registry=prompt_registry,
        model_router=model_router,
        eval_service=eval_service,
        economy_service=economy_service,
        projection_service=projection_service,
    )
