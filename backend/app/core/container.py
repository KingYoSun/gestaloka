from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.core.db import create_session_factory
from app.core.prompts import PromptRegistry
from app.modules.economy_sp.service import EconomyService
from app.modules.eval_harness.service import EvalHarnessService
from app.modules.gm_council.service import GMCouncilService
from app.modules.graph_projection.service import ProjectionService
from app.modules.identity.oidc import BaseOIDCAdapter, build_oidc_adapter
from app.modules.llm_harness.service import ModelRouter
from app.modules.observability.service import ObservabilityService
from app.modules.world_memory.service import MemoryService


@dataclass
class AppContainer:
    settings: Settings
    session_factory: sessionmaker[Session]
    oidc_adapter: BaseOIDCAdapter
    prompt_registry: PromptRegistry
    model_router: ModelRouter
    council_service: GMCouncilService
    eval_service: EvalHarnessService
    economy_service: EconomyService
    projection_service: ProjectionService
    observability_service: ObservabilityService
    memory_service: MemoryService


def build_container(settings: Settings | None = None) -> AppContainer:
    resolved_settings = settings or get_settings()
    if (
        resolved_settings.model_provider == "gemini_developer_api"
        or resolved_settings.embedding_provider == "gemini_developer_api"
    ) and not resolved_settings.gemini_api_key:
        raise ValueError(
            "GEMINI_API_KEY is required when MODEL_PROVIDER=gemini_developer_api "
            "or EMBEDDING_PROVIDER=gemini_developer_api"
        )
    session_factory = create_session_factory(resolved_settings)
    observability_service = ObservabilityService(resolved_settings)
    engine = session_factory.kw["bind"]
    observability_service.instrument_sqlalchemy(engine)
    projection_service = ProjectionService(resolved_settings, observability_service)
    memory_service = MemoryService(resolved_settings, observability_service)
    prompt_registry = PromptRegistry(resolved_settings.prompt_dir, resolved_settings.eval_dataset_dir)
    eval_service = EvalHarnessService(
        resolved_settings,
        prompt_registry,
        projection_service,
        memory_service,
        observability_service,
    )
    model_router = eval_service.runtime_router()
    council_service = GMCouncilService(resolved_settings, model_router)
    economy_service = EconomyService(resolved_settings)
    return AppContainer(
        settings=resolved_settings,
        session_factory=session_factory,
        oidc_adapter=build_oidc_adapter(resolved_settings),
        prompt_registry=prompt_registry,
        model_router=model_router,
        council_service=council_service,
        eval_service=eval_service,
        economy_service=economy_service,
        projection_service=projection_service,
        observability_service=observability_service,
        memory_service=memory_service,
    )
