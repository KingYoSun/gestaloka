from __future__ import annotations

import hashlib
import subprocess
from dataclasses import dataclass
from pathlib import Path
from contextlib import nullcontext
from typing import Literal

import yaml
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.prompts import PromptRegistry, SUPPORTED_MODEL_LANES, SUPPORTED_PROMPT_SCHEMAS
from app.models.entities import (
    Actor,
    EvalCaseResult,
    EvalRun,
    LLMRun,
    OutboxEvent,
    ReleaseGateReport,
    Session as GameSession,
    SPLedgerEntry,
    Turn,
)
from app.modules.economy_sp.service import ALLOWED_SP_REASON_CODES
from app.modules.gm_council.service import CouncilRequest, GMCouncilService
from app.modules.graph_projection.service import ProjectionService
from app.modules.llm_harness.service import ModelRouter, PromptRouteOverride, TurnResolutionOutcome
from app.modules.observability.service import CanaryProbeResult, ObservabilityService
from app.modules.world_pack.service import PackRegistry, branch_labels_from_followup_branches
from app.modules.world_memory.service import (
    MemoryRetrievalTrace,
    MemoryService,
    build_retrieval_query_text,
    retrieval_trace_to_dict,
)
from app.modules.world_state.rules import QuestRuleEngine, QuestRuleInput, normalize_world_tags
from app.modules.world_state.service import default_next_choices, important_inventory_affordances, narrative_state_bands


@dataclass(frozen=True)
class EvalCaseInput:
    case_id: str
    prompt_id: str
    world_id: str
    player_name: str
    npc_name: str
    input_text: str
    relevant_memories: list[str]
    relation_context: list[str]
    graph_context_status: str
    expect_success: bool
    expect_final_lane: str
    expect_fallback: bool
    expect_failure_reason: str | None
    input_mode: Literal["choice", "free_text"] = "free_text"
    choice_id: str | None = None
    expected_world_tags: list[str] | None = None
    quest_context: dict[str, object] | None = None
    expect_progress_after: int | None = None
    expect_reward_issued: bool | None = None
    expect_standing_after: float | None = None
    expect_retrieval_status: str | None = None
    expect_retrieval_hit_substring: str | None = None
    expect_retrieval_min_hits: int | None = None
    expect_outcome_band: str | None = None
    expect_scene_move: str | None = None
    expect_consequence_tags: list[str] | None = None
    session_state_overrides: dict[str, object] | None = None
    source_turn_id: str | None = None
    precomputed_retrieved_memories: list[str] | None = None
    precomputed_retrieval_trace: MemoryRetrievalTrace | None = None


@dataclass(frozen=True)
class EvalDataset:
    dataset_id: str
    prompt_id: str
    expected_output_schema: str
    cases: list[EvalCaseInput]


@dataclass(frozen=True)
class ReleaseConfig:
    name: str
    source_path: Path
    content_hash: str
    routes: dict[str, PromptRouteOverride]

    def diff(self, other: "ReleaseConfig") -> list[dict[str, object]]:
        route_ids = sorted(set(self.routes) | set(other.routes))
        changes: list[dict[str, object]] = []
        for route_id in route_ids:
            current = self.routes.get(route_id)
            candidate = other.routes.get(route_id)
            if current == candidate:
                continue
            changes.append(
                {
                    "route_id": route_id,
                    "current": _route_to_dict(current),
                    "candidate": _route_to_dict(candidate),
                }
            )
        return changes


def _route_to_dict(route: PromptRouteOverride | None) -> dict[str, object] | None:
    if route is None:
        return None
    return {
        "prompt_id": route.prompt_id,
        "default_lane": route.default_lane,
        "model_ids": route.model_ids,
    }


class EvalHarnessService:
    def __init__(
        self,
        settings: Settings,
        prompt_registry: PromptRegistry,
        projection_service: ProjectionService,
        memory_service: MemoryService,
        observability_service: ObservabilityService | None = None,
        *,
        pack_registry: PackRegistry | None = None,
        session_factory: sessionmaker[Session] | None = None,
    ) -> None:
        self.settings = settings
        self.prompt_registry = prompt_registry
        self.projection_service = projection_service
        self.memory_service = memory_service
        self.observability_service = observability_service
        self.pack_registry = pack_registry
        self.session_factory = session_factory
        self.datasets = self._load_datasets(settings.eval_dataset_dir)

    def router_for_config(self, config_name: str) -> ModelRouter:
        release_config = self.load_release_config(config_name)
        return ModelRouter(
            self.settings,
            self.prompt_registry,
            pack_registry=self.pack_registry,
            session_factory=self.session_factory,
            route_overrides=release_config.routes,
            config_name=release_config.name,
            observability_service=self.observability_service,
        )

    def runtime_router(self) -> ModelRouter:
        return self.router_for_config(self.settings.release_runtime_config_name)

    def load_release_config(self, config_name: str) -> ReleaseConfig:
        config_path = self.settings.release_config_dir / f"{config_name}.yaml"
        if not config_path.exists():
            raise FileNotFoundError(f"Release config not found: {config_path}")
        raw_text = config_path.read_text(encoding="utf-8")
        raw = yaml.safe_load(raw_text) or {}
        routes_raw = raw.get("routes")
        if not isinstance(routes_raw, dict) or not routes_raw:
            raise ValueError(f"Release config {config_path.name} is missing routes")

        routes: dict[str, PromptRouteOverride] = {}
        for route_id, route_payload in routes_raw.items():
            if not isinstance(route_payload, dict):
                raise ValueError(f"Route {route_id} in {config_path.name} must be a mapping")
            prompt_id = str(route_payload.get("prompt_id", "")).strip()
            default_lane = str(route_payload.get("default_lane", "")).strip()
            model_ids_raw = route_payload.get("model_ids") or {}
            if not prompt_id:
                raise ValueError(f"Route {route_id} in {config_path.name} is missing prompt_id")
            self.prompt_registry.get(prompt_id)
            if default_lane not in SUPPORTED_MODEL_LANES:
                raise ValueError(f"Route {route_id} in {config_path.name} uses unsupported lane {default_lane}")
            if not isinstance(model_ids_raw, dict):
                raise ValueError(f"Route {route_id} in {config_path.name} must define model_ids")
            model_ids = {str(key): str(value) for key, value in model_ids_raw.items()}
            unknown_lanes = set(model_ids) - SUPPORTED_MODEL_LANES
            if unknown_lanes:
                raise ValueError(f"Route {route_id} in {config_path.name} uses unsupported model ids {unknown_lanes}")
            routes[route_id] = PromptRouteOverride(
                prompt_id=prompt_id,
                default_lane=default_lane,
                model_ids=model_ids,
            )

        return ReleaseConfig(
            name=str(raw.get("name") or config_name),
            source_path=config_path,
            content_hash=hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
            routes=routes,
        )

    def run_dataset(
        self,
        db: Session,
        dataset_name: str,
        *,
        trigger_type: Literal["manual", "nightly", "pre_promote"] = "manual",
        runtime_role: str | None = None,
    ) -> dict[str, object]:
        dataset = self._require_dataset(dataset_name)
        return self._run_cases(
            db,
            source_type="dataset",
            dataset_name=dataset_name,
            cases=dataset.cases,
            trigger_type=trigger_type,
            runtime_role=runtime_role or self.settings.app_runtime_role,
        )

    def run_shadow_replay(
        self,
        db: Session,
        *,
        limit: int = 5,
        trigger_type: Literal["manual", "nightly", "pre_promote"] = "manual",
        runtime_role: str | None = None,
    ) -> dict[str, object]:
        cases = self._shadow_replay_cases(db, limit=limit)
        return self._run_cases(
            db,
            source_type="shadow_replay",
            dataset_name=None,
            cases=cases,
            trigger_type=trigger_type,
            runtime_role=runtime_role or self.settings.app_runtime_role,
        )

    def run_release_checklist(
        self,
        db: Session,
        *,
        trigger_type: Literal["manual", "nightly", "pre_promote"] = "manual",
        runtime_role: str | None = None,
        shadow_limit: int | None = None,
    ) -> dict[str, object]:
        resolved_runtime_role = runtime_role or self.settings.app_runtime_role
        smoke = self.run_dataset(
            db,
            "turn_resolution_smoke",
            trigger_type=trigger_type,
            runtime_role=resolved_runtime_role,
        )
        failure = self.run_dataset(
            db,
            "turn_resolution_failure_injection",
            trigger_type=trigger_type,
            runtime_role=resolved_runtime_role,
        )
        shadow = self.run_shadow_replay(
            db,
            limit=shadow_limit or self.settings.release_shadow_limit,
            trigger_type=trigger_type,
            runtime_role=resolved_runtime_role,
        )

        current_config = self.load_release_config("current")
        candidate_config = self.load_release_config("candidate")
        canary_probe = self._probe_canary_health()
        slo_snapshot = self._build_slo_snapshot(db, runtime_role=resolved_runtime_role, canary_probe=canary_probe)
        blocked_reasons = self._blocked_reasons(
            smoke_summary=smoke["summary"],
            failure_summary=failure["summary"],
            shadow_summary=shadow["summary"],
            slo_snapshot=slo_snapshot,
        )
        verdict = "passed" if not blocked_reasons else "blocked"

        report = ReleaseGateReport(
            smoke_run_id=smoke["id"],
            failure_run_id=failure["id"],
            shadow_run_id=shadow["id"],
            verdict=verdict,
            blocked_reasons=blocked_reasons,
            slo_snapshot=slo_snapshot,
            trigger_type=trigger_type,
        )
        db.add(report)
        db.flush()

        if self.observability_service is not None:
            self.observability_service.record_release_gate(
                report_id=report.id,
                verdict=verdict,
                blocked_reasons=blocked_reasons,
                trigger_type=trigger_type,
            )
            with self.observability_service.langfuse_trace(
                seed_id=report.id,
                name="release_checklist",
                input_payload={
                    "report_id": report.id,
                    "trigger_type": trigger_type,
                    "runtime_role": resolved_runtime_role,
                },
                metadata={
                    "runtime_role": resolved_runtime_role,
                    "trigger_type": trigger_type,
                    "report_id": report.id,
                },
                tags=[resolved_runtime_role, trigger_type],
            ) as trace_link:
                observation = getattr(trace_link, "observation", None)
                if observation is not None:
                    try:
                        observation.update(
                            output={
                                "verdict": verdict,
                                "blocked_reasons": blocked_reasons,
                                "runs": {
                                    "smoke": smoke["id"],
                                    "failure": failure["id"],
                                    "shadow": shadow["id"],
                                },
                            },
                            metadata={
                                "runtime_role": resolved_runtime_role,
                                "trigger_type": trigger_type,
                                "report_id": report.id,
                                "langfuse_delivery": "ok" if trace_link.status == "ok" else trace_link.status,
                            },
                        )
                    except Exception:
                        trace_link.status = "degraded"
            report.langfuse_trace_id = trace_link.trace_id
            report.langfuse_trace_url = trace_link.trace_url
            report.langfuse_status = trace_link.status

        return self._report_to_dict(db, report, current_config=current_config, candidate_config=candidate_config)

    def list_runs(self, db: Session, limit: int = 12) -> dict[str, object]:
        runs = list(
            db.execute(select(EvalRun).order_by(EvalRun.started_at.desc(), EvalRun.id.desc()).limit(limit)).scalars()
        )
        return {
            "items": [
                {
                    "id": run.id,
                    "source_type": run.source_type,
                    "dataset_name": run.dataset_name,
                    "trigger_type": run.trigger_type,
                    "runtime_role": run.runtime_role,
                    "status": run.status,
                    "summary": run.summary,
                    "started_at": run.started_at.isoformat(),
                    "completed_at": run.completed_at.isoformat() if run.completed_at else None,
                    "langfuse_trace_id": run.langfuse_trace_id,
                    "langfuse_trace_url": run.langfuse_trace_url,
                    "langfuse_status": run.langfuse_status,
                }
                for run in runs
            ]
        }

    def get_run_detail(self, db: Session, run_id: str) -> dict[str, object]:
        run = db.execute(select(EvalRun).where(EvalRun.id == run_id)).scalar_one()
        results = list(
            db.execute(
                select(EvalCaseResult)
                .where(EvalCaseResult.eval_run_id == run_id)
                .order_by(EvalCaseResult.case_id.asc(), EvalCaseResult.variant.asc())
            ).scalars()
        )
        return {
            "id": run.id,
            "source_type": run.source_type,
            "dataset_name": run.dataset_name,
            "trigger_type": run.trigger_type,
            "runtime_role": run.runtime_role,
            "status": run.status,
            "summary": run.summary,
            "started_at": run.started_at.isoformat(),
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "langfuse_trace_id": run.langfuse_trace_id,
            "langfuse_trace_url": run.langfuse_trace_url,
            "langfuse_status": run.langfuse_status,
            "results": [
                {
                    "id": result.id,
                    "variant": result.variant,
                    "case_id": result.case_id,
                    "prompt_id": result.prompt_id,
                    "model_id": result.model_id,
                    "lane": result.lane,
                    "used_fallback": result.used_fallback,
                    "schema_valid": result.schema_valid,
                    "same_world_invariant": result.same_world_invariant,
                    "graph_context_status": result.graph_context_status,
                    "passed": result.passed,
                    "failure_reason": result.failure_reason,
                    "raw_output": result.raw_output,
                }
                for result in results
            ],
        }

    def get_release_checklist(self, db: Session, report_id: str) -> dict[str, object]:
        report = db.execute(select(ReleaseGateReport).where(ReleaseGateReport.id == report_id)).scalar_one()
        return self._report_to_dict(
            db,
            report,
            current_config=self.load_release_config("current"),
            candidate_config=self.load_release_config("candidate"),
        )

    def latest_release_checklist(self, db: Session) -> dict[str, object]:
        report = db.execute(
            select(ReleaseGateReport).order_by(ReleaseGateReport.created_at.desc(), ReleaseGateReport.id.desc()).limit(1)
        ).scalar_one_or_none()
        if report is None:
            return {
                "report_id": None,
                "verdict": "blocked",
                "blocked_reasons": ["No release checklist report exists"],
                "trigger_type": "manual",
                "checks": {
                    "smoke": {"present": False, "current_passed": False, "candidate_passed": False, "run_id": None},
                    "failure_injection": {"present": False, "current_passed": False, "candidate_passed": False, "run_id": None},
                    "shadow_replay": {"present": False, "current_passed": False, "candidate_passed": False, "run_id": None},
                },
                "runs": {"smoke": None, "failure_injection": None, "shadow_replay": None},
                "latest_runs": {"smoke": None, "failure_injection": None, "shadow_replay": None},
                "slo_snapshot": {
                    "runtime_role": self.settings.app_runtime_role,
                    "canary_health": self._probe_canary_health().__dict__,
                    "projection_lag_seconds": 0.0,
                    "outbox_pending_count": 0,
                    "outbox_failed_count": 0,
                    "llm_schema_valid_rate": 0.0,
                    "llm_fallback_rate": 0.0,
                },
                "diff_summary": self.load_release_config("current").diff(self.load_release_config("candidate")),
                "shadow_failures": [],
                "runbook": self._runbook(),
                "created_at": None,
                "canary_promote_status": "blocked",
                "langfuse_trace_id": None,
                "langfuse_trace_url": None,
                "langfuse_status": "disabled",
                "langfuse_delivery": "disabled",
            }
        return self._report_to_dict(
            db,
            report,
            current_config=self.load_release_config("current"),
            candidate_config=self.load_release_config("candidate"),
        )

    def latest_gate_report(self, db: Session) -> dict[str, object]:
        return self.latest_release_checklist(db)

    def _report_to_dict(
        self,
        db: Session,
        report: ReleaseGateReport,
        *,
        current_config: ReleaseConfig,
        candidate_config: ReleaseConfig,
    ) -> dict[str, object]:
        smoke = db.execute(select(EvalRun).where(EvalRun.id == report.smoke_run_id)).scalar_one()
        failure = db.execute(select(EvalRun).where(EvalRun.id == report.failure_run_id)).scalar_one()
        shadow = db.execute(select(EvalRun).where(EvalRun.id == report.shadow_run_id)).scalar_one()
        shadow_results = list(
            db.execute(
                select(EvalCaseResult)
                .where(EvalCaseResult.eval_run_id == shadow.id)
                .order_by(EvalCaseResult.case_id.asc(), EvalCaseResult.variant.asc())
            ).scalars()
        )
        checks = {
            "smoke": self._extract_gate_check(smoke),
            "failure_injection": self._extract_gate_check(failure),
            "shadow_replay": self._extract_gate_check(shadow),
        }
        return {
            "report_id": report.id,
            "verdict": report.verdict,
            "blocked_reasons": report.blocked_reasons,
            "trigger_type": report.trigger_type,
            "checks": checks,
            "runs": {
                "smoke": smoke.id,
                "failure_injection": failure.id,
                "shadow_replay": shadow.id,
            },
            "latest_runs": {
                "smoke": smoke.id,
                "failure_injection": failure.id,
                "shadow_replay": shadow.id,
            },
            "slo_snapshot": report.slo_snapshot,
            "diff_summary": current_config.diff(candidate_config),
            "shadow_failures": [
                {
                    "case_id": item.case_id,
                    "variant": item.variant,
                    "lane": item.lane,
                    "graph_context_status": item.graph_context_status,
                    "retrieval_status": item.raw_output.get("retrieval_trace", {}).get("status"),
                    "retrieval_hit_count": len(item.raw_output.get("retrieval_trace", {}).get("retrieved_memory_ids", [])),
                    "failure_reason": item.failure_reason,
                }
                for item in shadow_results
                if not item.passed
                or item.graph_context_status != "ready"
                or item.raw_output.get("retrieval_trace", {}).get("status") != "ready"
            ],
            "runbook": self._runbook(),
            "created_at": report.created_at.isoformat(),
            "canary_promote_status": "ready" if report.verdict == "passed" else "blocked",
            "langfuse_trace_id": report.langfuse_trace_id,
            "langfuse_trace_url": report.langfuse_trace_url,
            "langfuse_status": report.langfuse_status,
            "langfuse_delivery": "ok" if report.langfuse_status == "ok" else report.langfuse_status,
        }

    def _run_cases(
        self,
        db: Session,
        *,
        source_type: Literal["dataset", "shadow_replay"],
        dataset_name: str | None,
        cases: list[EvalCaseInput],
        trigger_type: Literal["manual", "nightly", "pre_promote"],
        runtime_role: str,
    ) -> dict[str, object]:
        current_config = self.load_release_config("current")
        candidate_config = self.load_release_config("candidate")
        run = EvalRun(
            source_type=source_type,
            dataset_name=dataset_name,
            trigger_type=trigger_type,
            runtime_role=runtime_role,
            current_config_name=current_config.name,
            current_config_hash=current_config.content_hash,
            candidate_config_name=candidate_config.name,
            candidate_config_hash=candidate_config.content_hash,
            git_sha=self._git_sha(),
            status="running",
            summary={},
        )
        db.add(run)
        db.flush()

        trace_context = (
            self.observability_service.langfuse_trace(
                seed_id=run.id,
                name="eval_run",
                input_payload={
                    "eval_run_id": run.id,
                    "source_type": source_type,
                    "dataset_name": dataset_name,
                    "trigger_type": trigger_type,
                    "runtime_role": runtime_role,
                },
                metadata={
                    "runtime_role": runtime_role,
                    "trigger_type": trigger_type,
                    "eval_run_id": run.id,
                    "dataset_name": dataset_name,
                },
                tags=[runtime_role, trigger_type, source_type],
            )
            if self.observability_service is not None
            else nullcontext(type("NullTraceLink", (), {"trace_id": None, "trace_url": None, "status": "disabled", "observation": None})())
        )

        with trace_context as trace_link:
            if self.observability_service is not None:
                self.observability_service.record_eval_run(
                    eval_run_id=run.id,
                    dataset_name=dataset_name,
                    trigger_type=trigger_type,
                    runtime_role=runtime_role,
                )

            routers = {
                "current": GMCouncilService(
                    self.settings,
                    ModelRouter(
                        self.settings,
                        self.prompt_registry,
                        pack_registry=self.pack_registry,
                        session_factory=self.session_factory,
                        route_overrides=current_config.routes,
                        config_name=current_config.name,
                        observability_service=self.observability_service,
                    ),
                ),
                "candidate": GMCouncilService(
                    self.settings,
                    ModelRouter(
                        self.settings,
                        self.prompt_registry,
                        pack_registry=self.pack_registry,
                        session_factory=self.session_factory,
                        route_overrides=candidate_config.routes,
                        config_name=candidate_config.name,
                        observability_service=self.observability_service,
                    ),
                ),
            }

            case_payloads: list[dict[str, object]] = []
            for variant, council_service in routers.items():
                for case in cases:
                    retrieved_memories, retrieval_trace = self._resolve_case_retrieval(case)
                    outcome = council_service.resolve_turn(
                        CouncilRequest(
                            world_id=case.world_id,
                            turn_id=case.source_turn_id,
                            player_name=case.player_name,
                            npc_name=case.npc_name,
                            input_text=case.input_text,
                            input_mode=case.input_mode,
                            relevant_memories=retrieved_memories,
                            relation_context=case.relation_context,
                            graph_context_status=case.graph_context_status,
                            session_state=self._session_state_for_case(case),
                            selected_choice=(
                                next(
                                    (
                                        item
                                        for item in (self._session_state_for_case(case).get("next_choices") or [])
                                        if isinstance(item, dict) and item.get("choice_id") == case.choice_id
                                    ),
                                    None,
                                )
                                if case.input_mode == "choice" and case.choice_id is not None
                                else None
                            ),
                        ),
                    )
                    payload = self._persist_case_result(
                        db,
                        run_id=run.id,
                        variant=variant,
                        case=case,
                        outcome=outcome,
                        retrieved_memories=retrieved_memories,
                        retrieval_trace=retrieval_trace,
                    )
                    case_payloads.append(payload)

            run.summary = self._build_run_summary(source_type, dataset_name, cases, case_payloads)
            run.status = "completed"
            run.completed_at = run.updated_at
            observation = getattr(trace_link, "observation", None)
            if observation is not None:
                try:
                    observation.update(
                        output=run.summary,
                        metadata={
                            "runtime_role": runtime_role,
                            "trigger_type": trigger_type,
                            "eval_run_id": run.id,
                            "dataset_name": dataset_name,
                        },
                    )
                except Exception:
                    trace_link.status = "degraded"
        run.langfuse_trace_id = trace_link.trace_id
        run.langfuse_trace_url = trace_link.trace_url
        run.langfuse_status = trace_link.status
        db.flush()
        return self.get_run_detail(db, run.id)

    def _persist_case_result(
        self,
        db: Session,
        *,
        run_id: str,
        variant: str,
        case: EvalCaseInput,
        outcome: TurnResolutionOutcome,
        retrieved_memories: list[str],
        retrieval_trace: MemoryRetrievalTrace,
    ) -> dict[str, object]:
        final_attempt = outcome.attempts[-1]
        final_payload = outcome.final_payload.model_dump() if outcome.final_payload is not None else None
        used_fallback = outcome.used_fallback
        schema_valid = outcome.succeeded
        same_world_invariant = bool(
            final_payload is not None and final_payload.get("event_payload", {}).get("world_id") == case.world_id
        )
        domain_evaluation = self._evaluate_domain_case(case, final_payload)
        passed = self._case_passed(
            case,
            outcome,
            schema_valid=schema_valid,
            same_world_invariant=same_world_invariant,
            domain_passed=bool(domain_evaluation["passed"]),
            retrieval_trace=retrieval_trace,
            retrieved_memories=retrieved_memories,
        )
        raw_output = {
            "source_turn_id": case.source_turn_id,
            "input_text": case.input_text,
            "relevant_memories": case.relevant_memories,
            "retrieved_memories": retrieved_memories,
            "retrieval_trace": retrieval_trace_to_dict(retrieval_trace),
            "relation_context": case.relation_context,
            "role_runs": [
                {
                    "council_role": role_run.council_role,
                    "stage_index": role_run.stage_index,
                    "approval_status": role_run.approval_status,
                    "final_lane": role_run.final_lane,
                    "failure_reason": role_run.failure_reason,
                    "attempts": [
                        {
                            "prompt_id": attempt.prompt_id,
                            "schema_version": attempt.schema_version,
                            "model_lane": attempt.model_lane,
                            "model_id": attempt.model_id,
                            "provider_name": attempt.provider_name,
                            "provider_response_id": attempt.provider_response_id,
                            "langfuse_trace_id": attempt.langfuse_trace_id,
                            "langfuse_observation_id": attempt.langfuse_observation_id,
                            "langfuse_trace_url": attempt.langfuse_trace_url,
                            "langfuse_status": attempt.langfuse_status,
                            "status": attempt.status,
                            "output_schema_status": attempt.output_schema_status,
                            "output_payload": attempt.output_payload,
                        }
                        for attempt in role_run.attempts
                    ],
                }
                for role_run in outcome.role_runs
            ],
            "attempts": [
                {
                    "prompt_id": attempt.prompt_id,
                    "schema_version": attempt.schema_version,
                    "model_lane": attempt.model_lane,
                    "model_id": attempt.model_id,
                    "provider_name": attempt.provider_name,
                    "provider_response_id": attempt.provider_response_id,
                    "langfuse_trace_id": attempt.langfuse_trace_id,
                    "langfuse_observation_id": attempt.langfuse_observation_id,
                    "langfuse_trace_url": attempt.langfuse_trace_url,
                    "langfuse_status": attempt.langfuse_status,
                    "status": attempt.status,
                    "output_schema_status": attempt.output_schema_status,
                    "output_payload": attempt.output_payload,
                }
                for attempt in outcome.attempts
            ],
            "final_payload": final_payload,
            "failure_reason": outcome.failure_reason,
            "domain_evaluation": domain_evaluation,
        }
        result = EvalCaseResult(
            eval_run_id=run_id,
            variant=variant,
            case_id=case.case_id,
            prompt_id=case.prompt_id,
            model_id=final_attempt.model_id,
            lane=outcome.final_lane,
            used_fallback=used_fallback,
            schema_valid=schema_valid,
            same_world_invariant=same_world_invariant,
            graph_context_status=case.graph_context_status,
            passed=passed,
            failure_reason=outcome.failure_reason,
            raw_output=raw_output,
        )
        db.add(result)
        db.flush()
        return {
            "variant": variant,
            "case_id": case.case_id,
            "lane": outcome.final_lane,
            "used_fallback": used_fallback,
            "schema_valid": schema_valid,
            "same_world_invariant": same_world_invariant,
            "graph_context_status": case.graph_context_status,
            "retrieval_status": retrieval_trace.status,
            "retrieval_hit_count": len(retrieval_trace.retrieved_memory_ids),
            "retrieval_required": bool(case.expect_retrieval_min_hits or case.expect_retrieval_hit_substring),
            "passed": passed,
            "failure_reason": outcome.failure_reason,
        }

    def _case_passed(
        self,
        case: EvalCaseInput,
        outcome: TurnResolutionOutcome,
        *,
        schema_valid: bool,
        same_world_invariant: bool,
        domain_passed: bool,
        retrieval_trace: MemoryRetrievalTrace,
        retrieved_memories: list[str],
    ) -> bool:
        used_fallback = outcome.used_fallback
        retrieval_passed = self._retrieval_passed(case, retrieval_trace, retrieved_memories)
        if case.expect_success:
            return (
                outcome.succeeded
                and schema_valid
                and same_world_invariant
                and domain_passed
                and retrieval_passed
                and case.graph_context_status == "ready"
                and outcome.final_lane == case.expect_final_lane
                and used_fallback == case.expect_fallback
            )

        return (
            not outcome.succeeded
            and outcome.final_lane == case.expect_final_lane
            and used_fallback == case.expect_fallback
            and outcome.failure_reason == case.expect_failure_reason
        )

    @staticmethod
    def _retrieval_passed(
        case: EvalCaseInput,
        retrieval_trace: MemoryRetrievalTrace,
        retrieved_memories: list[str],
    ) -> bool:
        if case.expect_retrieval_status is not None and retrieval_trace.status != case.expect_retrieval_status:
            return False
        if case.expect_retrieval_min_hits is not None and len(retrieval_trace.retrieved_memory_ids) < case.expect_retrieval_min_hits:
            return False
        if case.expect_retrieval_hit_substring is not None and not any(
            case.expect_retrieval_hit_substring in item for item in retrieved_memories
        ):
            return False
        return True

    def _evaluate_domain_case(self, case: EvalCaseInput, final_payload: dict[str, object] | None) -> dict[str, object]:
        if final_payload is None:
            return {"passed": True, "checks": {}, "rule_outcome": None}

        world_tags = normalize_world_tags([str(item) for item in final_payload.get("world_tags") or []])
        checks: dict[str, bool] = {}
        if case.expected_world_tags is not None:
            checks["world_tags_match"] = world_tags == normalize_world_tags(case.expected_world_tags)

        rule_outcome_payload: dict[str, object] | None = None
        if case.quest_context is not None:
            progress_target = int(case.quest_context.get("progress_target", 2))
            rule_outcome = QuestRuleEngine.evaluate(
                QuestRuleInput(
                    world_tags=world_tags,
                    current_progress=int(case.quest_context.get("current_progress", 0)),
                    progress_target=progress_target,
                    current_standing=float(case.quest_context.get("current_standing", 0.0)),
                    reward_already_issued=bool(case.quest_context.get("reward_already_issued", False)),
                    reward_enabled=bool(case.quest_context.get("reward_enabled", True)),
                )
            )
            rule_outcome_payload = {
                "world_tags": rule_outcome.world_tags,
                "quest_progress_delta": rule_outcome.quest_progress_delta,
                "next_progress": rule_outcome.next_progress,
                "standing_delta": rule_outcome.standing_delta,
                "next_standing": rule_outcome.next_standing,
                "completed": rule_outcome.completed,
                "should_issue_reward": rule_outcome.should_issue_reward,
                "summary": rule_outcome.summary,
            }
            if case.expect_progress_after is not None:
                checks["quest_progress_after"] = rule_outcome.next_progress == case.expect_progress_after
            if case.expect_reward_issued is not None:
                checks["reward_after_completion_only"] = rule_outcome.should_issue_reward == case.expect_reward_issued
            if case.expect_standing_after is not None:
                checks["standing_after"] = abs(rule_outcome.next_standing - case.expect_standing_after) < 1e-6
            current_progress = int(case.quest_context.get("current_progress", 0))
            reward_precondition = current_progress + rule_outcome.quest_progress_delta >= progress_target
            if not reward_precondition:
                checks["no_premature_reward"] = not rule_outcome.should_issue_reward

        if case.expect_outcome_band is not None:
            checks["outcome_band_match"] = str(final_payload.get("outcome_band") or "") == case.expect_outcome_band

        if case.expect_scene_move is not None:
            checks["scene_move_match"] = str(final_payload.get("scene_move") or "") == case.expect_scene_move

        if case.expect_consequence_tags is not None:
            actual_tags = {str(item) for item in final_payload.get("consequence_tags") or []}
            checks["consequence_tags_match"] = set(case.expect_consequence_tags) <= actual_tags

        return {
            "passed": all(checks.values()) if checks else True,
            "checks": checks,
            "rule_outcome": rule_outcome_payload,
        }

    def _build_run_summary(
        self,
        source_type: str,
        dataset_name: str | None,
        cases: list[EvalCaseInput],
        results: list[dict[str, object]],
    ) -> dict[str, object]:
        summary: dict[str, object] = {
            "source_type": source_type,
            "dataset_name": dataset_name,
            "case_count": len(cases),
            "variants": {},
            "comparison": {},
        }
        for variant in ("current", "candidate"):
            scoped = [item for item in results if item["variant"] == variant]
            passed = sum(1 for item in scoped if item["passed"])
            failed_case_ids = [str(item["case_id"]) for item in scoped if not item["passed"]]
            gate_passed = self._gate_passed(source_type, dataset_name, scoped)
            summary["variants"][variant] = {
                "total": len(scoped),
                "passed": passed,
                "failed": len(scoped) - passed,
                "failed_case_ids": failed_case_ids,
                "retrieval_ready": sum(1 for item in scoped if item["retrieval_status"] == "ready"),
                "retrieval_degraded": sum(1 for item in scoped if item["retrieval_status"] != "ready"),
                "gate_passed": gate_passed,
            }

        current_summary = summary["variants"]["current"]
        candidate_summary = summary["variants"]["candidate"]
        summary["comparison"] = {
            "passed_delta": candidate_summary["passed"] - current_summary["passed"],
            "current_failed_case_ids": current_summary["failed_case_ids"],
            "candidate_failed_case_ids": candidate_summary["failed_case_ids"],
        }
        return summary

    @staticmethod
    def _gate_passed(source_type: str, dataset_name: str | None, scoped: list[dict[str, object]]) -> bool:
        if not scoped:
            return False
        if source_type == "shadow_replay":
            return all(
                item["passed"]
                and item["schema_valid"]
                and item["same_world_invariant"]
                and item["graph_context_status"] == "ready"
                and item["retrieval_status"] == "ready"
                and (not item["retrieval_required"] or int(item["retrieval_hit_count"]) >= 1)
                for item in scoped
            )
        if dataset_name == "turn_resolution_smoke":
            return all(item["passed"] and item["schema_valid"] and item["same_world_invariant"] for item in scoped)
        if dataset_name == "turn_resolution_failure_injection":
            return all(item["passed"] for item in scoped)
        return all(item["passed"] for item in scoped)

    def _blocked_reasons(
        self,
        *,
        smoke_summary: dict[str, object],
        failure_summary: dict[str, object],
        shadow_summary: dict[str, object],
        slo_snapshot: dict[str, object],
    ) -> list[str]:
        blocked: list[str] = []
        if not bool(smoke_summary["variants"]["current"]["gate_passed"]) or not bool(smoke_summary["variants"]["candidate"]["gate_passed"]):
            blocked.append("smoke gate failed")
        if not bool(failure_summary["variants"]["current"]["gate_passed"]) or not bool(failure_summary["variants"]["candidate"]["gate_passed"]):
            blocked.append("failure injection gate failed")
        if not bool(shadow_summary["variants"]["current"]["gate_passed"]) or not bool(shadow_summary["variants"]["candidate"]["gate_passed"]):
            blocked.append("shadow replay gate failed")
        if int(slo_snapshot["outbox_failed_count"]) > 0:
            blocked.append("failed_outbox > 0")
        if float(slo_snapshot["projection_lag_seconds"]) > 5.0:
            blocked.append("projection_lag_seconds > 5")
        if slo_snapshot["canary_health"]["status"] != "healthy":
            blocked.append("canary health != healthy")
        if not bool(slo_snapshot["sp_reason_invariant_ok"]):
            blocked.append("sp execution budget invariant failed")
        return blocked

    def _build_slo_snapshot(
        self,
        db: Session,
        *,
        runtime_role: str,
        canary_probe: CanaryProbeResult,
    ) -> dict[str, object]:
        failed_outbox_count = int(db.execute(select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "failed")).scalar_one())
        pending_outbox_count = int(db.execute(select(func.count(OutboxEvent.id)).where(OutboxEvent.status == "pending")).scalar_one())
        oldest_pending = db.execute(
            select(OutboxEvent.created_at)
            .where(OutboxEvent.status == "pending")
            .order_by(OutboxEvent.created_at.asc(), OutboxEvent.id.asc())
            .limit(1)
        ).scalar_one_or_none()
        projection_lag_seconds = 0.0
        if oldest_pending is not None:
            projection_lag_seconds = max((self._now() - oldest_pending).total_seconds(), 0.0)

        llm_total = int(db.execute(select(func.count(LLMRun.id))).scalar_one())
        llm_valid = int(db.execute(select(func.count(LLMRun.id)).where(LLMRun.output_schema_status == "valid")).scalar_one())
        turn_count = int(db.execute(select(func.count(func.distinct(LLMRun.turn_id)))).scalar_one())
        fallback_groups = db.execute(
            select(LLMRun.turn_id, LLMRun.stage_index, LLMRun.council_role, func.count(LLMRun.id))
            .group_by(LLMRun.turn_id, LLMRun.stage_index, LLMRun.council_role)
        ).all()
        fallback_turns = len({row[0] for row in fallback_groups if int(row[3]) > 1})

        snapshot = {
            "runtime_role": runtime_role,
            "canary_health": canary_probe.__dict__,
            "projection_lag_seconds": projection_lag_seconds,
            "outbox_pending_count": pending_outbox_count,
            "outbox_failed_count": failed_outbox_count,
            "llm_schema_valid_rate": (llm_valid / llm_total) if llm_total else 0.0,
            "llm_fallback_rate": (fallback_turns / turn_count) if turn_count else 0.0,
            "sp_reason_invariant_ok": True,
            "invalid_sp_reason_codes": [],
        }
        reason_codes = {
            row[0]
            for row in db.execute(select(SPLedgerEntry.reason_code).distinct()).all()
            if row[0] is not None
        }
        invalid_reason_codes = sorted(reason_codes - ALLOWED_SP_REASON_CODES)
        snapshot["sp_reason_invariant_ok"] = not invalid_reason_codes
        snapshot["invalid_sp_reason_codes"] = invalid_reason_codes
        if self.observability_service is not None:
            self.observability_service.sync_outbox_metrics(
                pending_count=pending_outbox_count,
                failed_count=failed_outbox_count,
                lag_seconds=projection_lag_seconds,
            )
            self.observability_service.sync_llm_rates(
                schema_valid_rate=float(snapshot["llm_schema_valid_rate"]),
                fallback_rate=float(snapshot["llm_fallback_rate"]),
            )
        return snapshot

    def _extract_gate_check(self, run: EvalRun | None) -> dict[str, object]:
        if run is None:
            return {"present": False, "current_passed": False, "candidate_passed": False, "run_id": None}
        summary = run.summary or {}
        variants = summary.get("variants", {})
        current = variants.get("current", {})
        candidate = variants.get("candidate", {})
        return {
            "present": True,
            "current_passed": bool(current.get("gate_passed")),
            "candidate_passed": bool(candidate.get("gate_passed")),
            "run_id": run.id,
        }

    def _load_datasets(self, dataset_dir: Path) -> dict[str, EvalDataset]:
        if not dataset_dir.exists():
            raise FileNotFoundError(f"Eval dataset directory not found: {dataset_dir}")
        datasets: dict[str, EvalDataset] = {}
        for dataset_path in sorted(dataset_dir.glob("*.yaml")):
            raw = yaml.safe_load(dataset_path.read_text(encoding="utf-8")) or {}
            dataset_id = str(raw.get("dataset_id", "")).strip()
            prompt_id = str(raw.get("prompt_id", "")).strip()
            expected_output_schema = str(raw.get("expected_output_schema", "")).strip()
            if not dataset_id:
                raise ValueError(f"Dataset file is missing dataset_id: {dataset_path.name}")
            if dataset_id in datasets:
                raise ValueError(f"Duplicate eval dataset detected: {dataset_id}")
            prompt = self.prompt_registry.get(prompt_id)
            if expected_output_schema not in SUPPORTED_PROMPT_SCHEMAS:
                raise ValueError(f"Dataset {dataset_id} references unknown schema {expected_output_schema}")
            if prompt.expected_output_schema != expected_output_schema:
                raise ValueError(
                    f"Dataset {dataset_id} expects schema {expected_output_schema}, prompt {prompt_id} uses {prompt.expected_output_schema}"
                )
            case_ids: set[str] = set()
            cases: list[EvalCaseInput] = []
            for raw_case in raw.get("cases") or []:
                case_id = str(raw_case.get("case_id", "")).strip()
                if not case_id:
                    raise ValueError(f"Dataset {dataset_id} includes a case without case_id")
                if case_id in case_ids:
                    raise ValueError(f"Dataset {dataset_id} includes duplicate case_id {case_id}")
                case_ids.add(case_id)
                cases.append(
                    EvalCaseInput(
                        case_id=case_id,
                        prompt_id=prompt_id,
                        world_id=str(raw_case.get("world_id", "")).strip(),
                        player_name=str(raw_case.get("player_name", "")).strip(),
                        npc_name=str(raw_case.get("npc_name", "")).strip(),
                        input_text=str(raw_case.get("input_text", "")).strip(),
                        input_mode=str(raw_case.get("input_mode", "free_text")).strip() or "free_text",
                        choice_id=(
                            str(raw_case.get("choice_id")).strip()
                            if raw_case.get("choice_id") is not None
                            else None
                        ),
                        relevant_memories=[str(item) for item in raw_case.get("relevant_memories") or []],
                        relation_context=[str(item) for item in raw_case.get("relation_context") or []],
                        graph_context_status=str(raw_case.get("graph_context_status", "ready")).strip() or "ready",
                        expect_success=bool(raw_case.get("expect_success", True)),
                        expect_final_lane=str(raw_case.get("expect_final_lane", prompt.model_lane)).strip(),
                        expect_fallback=bool(raw_case.get("expect_fallback", False)),
                        expect_failure_reason=(
                            str(raw_case.get("expect_failure_reason")).strip()
                            if raw_case.get("expect_failure_reason") is not None
                            else None
                        ),
                        expected_world_tags=[str(item) for item in raw_case.get("expected_world_tags") or []] or None,
                        quest_context=dict(raw_case.get("quest_context") or {}) or None,
                        expect_progress_after=(
                            int(raw_case.get("expect_progress_after"))
                            if raw_case.get("expect_progress_after") is not None
                            else None
                        ),
                        expect_reward_issued=(
                            bool(raw_case.get("expect_reward_issued"))
                            if raw_case.get("expect_reward_issued") is not None
                            else None
                        ),
                        expect_standing_after=(
                            float(raw_case.get("expect_standing_after"))
                            if raw_case.get("expect_standing_after") is not None
                            else None
                        ),
                        expect_retrieval_status=(
                            str(raw_case.get("expect_retrieval_status")).strip()
                            if raw_case.get("expect_retrieval_status") is not None
                            else None
                        ),
                        expect_retrieval_hit_substring=(
                            str(raw_case.get("expect_retrieval_hit_substring")).strip()
                            if raw_case.get("expect_retrieval_hit_substring") is not None
                            else None
                        ),
                    expect_retrieval_min_hits=(
                        int(raw_case.get("expect_retrieval_min_hits"))
                        if raw_case.get("expect_retrieval_min_hits") is not None
                        else None
                    ),
                    expect_outcome_band=(
                        str(raw_case.get("expect_outcome_band")).strip()
                        if raw_case.get("expect_outcome_band") is not None
                        else None
                    ),
                    expect_scene_move=(
                        str(raw_case.get("expect_scene_move")).strip()
                        if raw_case.get("expect_scene_move") is not None
                        else None
                    ),
                    expect_consequence_tags=[
                        str(item)
                        for item in (raw_case.get("expect_consequence_tags") or [])
                        if str(item)
                    ]
                    or None,
                    session_state_overrides=dict(raw_case.get("session_state_overrides") or {}) or None,
                    )
                )
            if not cases:
                raise ValueError(f"Dataset {dataset_id} does not define any cases")
            datasets[dataset_id] = EvalDataset(
                dataset_id=dataset_id,
                prompt_id=prompt_id,
                expected_output_schema=expected_output_schema,
                cases=cases,
            )
        if not datasets:
            raise ValueError(f"No eval datasets found in {dataset_dir}")
        return datasets

    def _shadow_replay_cases(self, db: Session, *, limit: int) -> list[EvalCaseInput]:
        resolved_turns = list(db.execute(select(Turn).order_by(Turn.created_at.desc(), Turn.id.desc())).scalars())
        cases: list[EvalCaseInput] = []
        for turn in resolved_turns:
            if turn.resolved_output.get("status") != "resolved":
                continue
            session = db.execute(
                select(GameSession).where(GameSession.id == turn.session_id, GameSession.world_id == turn.world_id)
            ).scalar_one_or_none()
            if session is None:
                continue
            player_actor = (
                db.execute(
                    select(Actor)
                    .where(Actor.id == session.player_actor_id, Actor.world_id == turn.world_id)
                    .limit(1)
                )
                .scalars()
                .first()
            )
            npc_actor = (
                db.execute(
                    select(Actor)
                    .where(Actor.world_id == turn.world_id, Actor.actor_type == "npc")
                    .order_by(Actor.created_at.asc(), Actor.id.asc())
                    .limit(1)
                )
                .scalars()
                .first()
            )
            if player_actor is None or npc_actor is None:
                continue
            graph_context = self.projection_service.resolve_relation_context(
                db,
                world_id=turn.world_id,
                primary_actor_id=npc_actor.id,
                counterpart_actor_id=player_actor.id,
                location_id=player_actor.current_location_id,
            )
            query_text = build_retrieval_query_text(
                turn.input_text,
                session_state=self._session_state_for_case(
                    EvalCaseInput(
                        case_id="shadow-bootstrap",
                        prompt_id="session.turn_resolution",
                        world_id=turn.world_id,
                        player_name=player_actor.display_name,
                        npc_name=npc_actor.display_name,
                        input_text=turn.input_text,
                        relevant_memories=[],
                        relation_context=graph_context.context.prompt_lines(),
                        graph_context_status=graph_context.status,
                        expect_success=True,
                        expect_final_lane=turn.model_lane,
                        expect_fallback=bool(turn.resolved_output.get("used_fallback", turn.model_lane == "pro_lane")),
                        expect_failure_reason=None,
                    )
                ),
                relation_context=graph_context.context.prompt_lines(),
            )
            retrieval = self.memory_service.search(
                db,
                world_id=turn.world_id,
                query_text=query_text,
                actor_id=npc_actor.id,
                location_id=player_actor.current_location_id,
            )
            cases.append(
                EvalCaseInput(
                    case_id=f"shadow-{turn.id}",
                    prompt_id="session.turn_resolution",
                    world_id=turn.world_id,
                    player_name=player_actor.display_name,
                    npc_name=npc_actor.display_name,
                    input_text=turn.input_text,
                    relevant_memories=[item.text for item in retrieval.memories],
                    relation_context=graph_context.context.prompt_lines(),
                    graph_context_status=graph_context.status,
                    expect_success=True,
                    expect_final_lane=turn.model_lane,
                    expect_fallback=bool(turn.resolved_output.get("used_fallback", turn.model_lane == "pro_lane")),
                    expect_failure_reason=None,
                    expect_retrieval_status="ready",
                    expect_retrieval_min_hits=1 if retrieval.trace.retrieved_memory_ids else 0,
                    source_turn_id=turn.id,
                    precomputed_retrieved_memories=[item.text for item in retrieval.memories],
                    precomputed_retrieval_trace=retrieval.trace,
                )
            )
            if len(cases) >= limit:
                break
        return cases

    def _resolve_case_retrieval(self, case: EvalCaseInput) -> tuple[list[str], MemoryRetrievalTrace]:
        if case.precomputed_retrieval_trace is not None:
            return case.precomputed_retrieved_memories or [], case.precomputed_retrieval_trace

        query_text = build_retrieval_query_text(
            case.input_text,
            session_state=self._session_state_for_case(case),
            relation_context=case.relation_context,
        )
        corpus = self.memory_service.search_corpus(query_text=query_text, texts=case.relevant_memories)
        return corpus.texts, corpus.trace

    def _probe_canary_health(self) -> CanaryProbeResult:
        if self.observability_service is None:
            return CanaryProbeResult(status="not_configured", url=None, http_status=None, detail="Observability disabled")
        return self.observability_service.probe_canary_health()

    def _require_dataset(self, dataset_name: str) -> EvalDataset:
        try:
            return self.datasets[dataset_name]
        except KeyError as exc:
            raise KeyError(f"Unknown eval dataset: {dataset_name}") from exc

    @staticmethod
    def _session_state_for_case(case: EvalCaseInput) -> dict[str, object]:
        quest_progress = int((case.quest_context or {}).get("current_progress", 0))
        progress_target = int((case.quest_context or {}).get("progress_target", 2))
        current_standing = float((case.quest_context or {}).get("current_standing", 0.0))
        world_pack = dict((case.quest_context or {}).get("world_pack") or {})
        followup_branches = dict(world_pack.get("followup_branches") or {})
        if not followup_branches:
            followup_branches = {
                "formal_path": {"branch_key": "watch_oath", "label": "Watch Oath", "anchor_npcs": []},
                "undercurrent_path": {"branch_key": "lantern_whispers", "label": "Lantern Whispers", "anchor_npcs": []},
            }
        stage_key = str((case.quest_context or {}).get("stage_key") or world_pack.get("starter_stage_key") or "starter_watch")
        starter_stage_key = str(world_pack.get("starter_stage_key") or "starter_watch")
        followup_stage_key = str(world_pack.get("followup_stage_key") or "watch_path_followup")
        opening_chapter_key = str(world_pack.get("opening_chapter_key") or "founders_watch_opening")
        followup_chapter_key = str(world_pack.get("followup_chapter_key") or "watch_path_followup")
        chapter_key = followup_chapter_key if stage_key == followup_stage_key else opening_chapter_key
        base_state: dict[str, object] = {
            "world_id": case.world_id,
            "location": {"id": "eval-location", "name": "Founders Reach", "description": "Eval fixture"},
            "world_pack": {
                "starter_stage_key": starter_stage_key,
                "followup_stage_key": followup_stage_key,
                "opening_chapter_key": opening_chapter_key,
                "followup_chapter_key": followup_chapter_key,
                "reward_effect_kind": str(world_pack.get("reward_effect_kind") or "unlock_followup_watch_path"),
                "starter_location_key": str(world_pack.get("starter_location_key") or "square"),
                "starter_location_name": str(world_pack.get("starter_location_name") or "Founders Reach"),
                "lore_location_key": str(world_pack.get("lore_location_key") or "archive_steps"),
                "lore_location_name": str(world_pack.get("lore_location_name") or "Archive Steps"),
                "followup_location_key": str(world_pack.get("followup_location_key") or "watch_path"),
                "followup_location_name": str(world_pack.get("followup_location_name") or "Watch Path"),
                "world_name": str(world_pack.get("world_name") or "Founders Reach"),
                "reward_name": str(world_pack.get("reward_name") or "Lantern Sigil"),
                "faction_name": str(world_pack.get("faction_name") or "Founders Watch"),
                "followup_branches": followup_branches,
                "branch_labels": dict(world_pack.get("branch_labels") or branch_labels_from_followup_branches(followup_branches)),
            },
            "chapter": {
                "id": "eval-chapter",
                "key": chapter_key,
                "status": "active",
                "summary": "Eval chapter fixture",
            },
            "current_scene": {
                "id": "eval-scene",
                "summary": "Eval scene fixture around the current request.",
                "pressure_summary": "Eval pressure fixture.",
                "location": {"id": "eval-location", "name": "Founders Reach", "description": "Eval fixture"},
                "focus_actor": {"actor_id": "eval-npc", "display_name": case.npc_name},
            },
            "recent_scene_history": ["Eval scene fixture around the current request."],
            "character": {"actor_id": "eval-actor", "rank": "Wayfarer", "hp": 10, "focus": 5, "status_json": {}},
            "quests": [
                {
                    "assignment_id": "eval-quest",
                    "quest_template_id": "starter_watch_request",
                    "title": str((case.quest_context or {}).get("title") or "First Watch Request"),
                    "description": "Eval fixture quest",
                    "status": str((case.quest_context or {}).get("status") or "active"),
                    "stage_key": stage_key,
                    "unlock_requirements": dict((case.quest_context or {}).get("unlock_requirements") or {}),
                    "progress": quest_progress,
                    "progress_target": progress_target,
                    "latest_summary": "",
                    "reward_item_id": (case.quest_context or {}).get("reward_item_id"),
                    "state_json": {},
                }
            ],
            "factions": [
                {
                    "faction_id": "founders_watch",
                    "name": "Founders Watch",
                    "description": "Eval fixture faction",
                    "standing": current_standing,
                    "band": "neutral",
                }
            ],
            "inventory": list((case.quest_context or {}).get("inventory_items") or []),
        }
        overrides = case.session_state_overrides or {}
        for key, value in overrides.items():
            base_state[key] = value
        character = base_state.get("character") or {}
        factions = list(base_state.get("factions") or [])
        inventory = list(base_state.get("inventory") or [])
        base_state["narrative_state_bands"] = narrative_state_bands(character, factions)
        base_state["important_inventory_affordances"] = important_inventory_affordances(inventory)
        base_state["next_choices"] = default_next_choices(base_state)
        return base_state

    @staticmethod
    def _git_sha() -> str:
        try:
            return (
                subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
                or "unknown"
            )
        except Exception:
            return "unknown"

    @staticmethod
    def _runbook() -> dict[str, str]:
        return {
            "canary_up": "docker compose up --build backend-canary",
            "rollback": "docker compose rm -sf backend-canary",
            "promote": "cp config/release/candidate.yaml config/release/current.yaml && docker compose up -d --build backend",
        }

    @staticmethod
    def _now():
        from datetime import datetime, timezone

        return datetime.now(timezone.utc)
