from __future__ import annotations

import hashlib
import signal
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from contextlib import nullcontext
from typing import Callable, Literal

import yaml
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.prompts import PromptRegistry, SUPPORTED_MODEL_LANES, SUPPORTED_PROMPT_SCHEMAS
from app.models.entities import (
    Actor,
    Event,
    EvalCaseResult,
    EvalRun,
    LLMRun,
    OutboxEvent,
    ReleaseGateReport,
    Session as GameSession,
    SPLedgerEntry,
    Turn,
)
from app.modules.admin_ops.service import create_observability_snapshot
from app.modules.economy_sp.service import ALLOWED_SP_REASON_CODES
from app.modules.gm_council.service import CouncilRequest, GMCouncilService
from app.modules.graph_projection.service import ProjectionService
from app.modules.llm_harness.service import ModelRouter, PromptRouteOverride, TurnResolutionOutcome
from app.modules.observability.service import CanaryProbeResult, ObservabilityService
from app.modules.world_pack.service import (
    PackRegistry,
    branch_labels_from_followup_branches,
    get_pack_registry,
    resolve_world_pack,
    serialize_followup_branches,
)
from app.modules.world_memory.service import (
    MemoryRetrievalTrace,
    MemoryService,
    build_retrieval_query_text,
    retrieval_trace_to_dict,
)
from app.modules.world_state.consequence import normalize_consequence_tags
from app.modules.world_state.rules import normalize_world_tags
from app.modules.world_state.service import default_next_choices, important_inventory_affordances, narrative_state_bands
from app.modules.world_state.health import shared_world_health


def _bundled_pack_regression_datasets() -> list[str]:
    repo_root = next(
        (
            parent
            for parent in Path(__file__).resolve().parents
            if (parent / "AGENTS.md").exists() and (parent / "evals" / "datasets").is_dir()
        ),
        Path.cwd(),
    )
    dataset_dir = repo_root / "evals" / "datasets"
    discovered = sorted(path.stem for path in dataset_dir.glob("turn_resolution_*_regression.yaml"))
    preferred = ["turn_resolution_gestaloka_regression"]
    return [*preferred, *[dataset_id for dataset_id in discovered if dataset_id not in preferred]]


PACK_REGRESSION_DATASETS = _bundled_pack_regression_datasets()
PRODUCT_CUTOVER_REQUIRED_CHECKS = [
    "turn_resolution_smoke",
    "turn_resolution_failure_injection",
    "shadow_replay",
    "shared_world_health",
    *PACK_REGRESSION_DATASETS,
]


@dataclass(frozen=True)
class EvalCaseInput:
    case_id: str
    prompt_id: str
    world_id: str
    pack_id: str
    world_template_id: str
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


@dataclass(frozen=True)
class ReleaseChecklistCheckResult:
    payload: dict[str, object]
    elapsed_seconds: float
    status: str
    check_name: str = ""
    label: str = ""
    blocked_reason: str | None = None
    execution_mode: str | None = None
    case_count: int | None = None
    timeout_seconds: float | None = None


class ReleaseCheckTimeout(BaseException):
    pass


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
        self._release_progress_lock = threading.Lock()
        self._release_progress: dict[str, object] = {
            "status": "idle",
            "current_check": None,
            "started_at": None,
            "updated_at": None,
            "completed_report_id": None,
            "error": None,
        }

    def release_checklist_progress(self) -> dict[str, object]:
        with self._release_progress_lock:
            payload = dict(self._release_progress)
        started_at = payload.get("started_at")
        updated_at = payload.get("updated_at")
        if isinstance(started_at, str):
            end_at = self._now()
            if payload.get("status") != "running" and isinstance(updated_at, str):
                try:
                    end_at = datetime.fromisoformat(updated_at)
                except ValueError:
                    end_at = self._now()
            try:
                elapsed = (end_at - datetime.fromisoformat(started_at)).total_seconds()
            except ValueError:
                elapsed = 0.0
        else:
            elapsed = 0.0
        payload["elapsed_seconds"] = max(elapsed, 0.0)
        return payload

    def _set_release_checklist_progress(
        self,
        *,
        status: str,
        current_check: str | None = None,
        completed_report_id: str | None = None,
        error: str | None = None,
    ) -> dict[str, object]:
        now = self._now().isoformat()
        with self._release_progress_lock:
            started_at = self._release_progress.get("started_at")
            if status == "running" and self._release_progress.get("status") != "running":
                started_at = now
            if status != "running" and started_at is None:
                started_at = now
            self._release_progress = {
                "status": status,
                "current_check": current_check,
                "started_at": started_at,
                "updated_at": now,
                "completed_report_id": completed_report_id,
                "error": error,
            }
            return dict(self._release_progress)

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
                raise ValueError(f"Route {route_id} in {config_path.name} model_ids must be a mapping when defined")
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
        progress_callback: Callable[[dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        resolved_runtime_role = runtime_role or self.settings.app_runtime_role
        per_check_timeout_seconds = self._release_check_timeout_seconds(
            trigger_type,
            max(float(self.settings.release_check_timeout_seconds), 0.0),
        )
        total_budget_seconds = self._release_total_budget_seconds(
            trigger_type,
            max(float(self.settings.release_check_total_budget_seconds), 0.0),
        )
        checklist_started = time.monotonic()
        timeout_reasons: list[str] = []
        check_results: list[ReleaseChecklistCheckResult] = []
        self._set_release_checklist_progress(status="running", current_check="starting")

        def emit(event: str, check_name: str, **payload: object) -> None:
            message = {
                "event": event,
                "check": check_name,
                "elapsed_seconds": round(float(payload.pop("elapsed_seconds", 0.0)), 3),
                **payload,
            }
            if progress_callback is not None:
                progress_callback(message)

        current_config = self.load_release_config("current")
        candidate_config = self.load_release_config("candidate")

        try:
            def timeout_for_check(check_name: str) -> tuple[float, str | None]:
                if total_budget_seconds <= 0:
                    return per_check_timeout_seconds, None
                remaining = total_budget_seconds - (time.monotonic() - checklist_started)
                if remaining <= 0:
                    return 0.0, f"release check {check_name} skipped because release checklist budget was exhausted"
                if per_check_timeout_seconds <= 0:
                    return remaining, None
                return min(per_check_timeout_seconds, remaining), None

            smoke_timeout, smoke_skip_reason = timeout_for_check("turn_resolution_smoke")
            smoke_result = self._run_release_eval_check(
                db,
                check_name="turn_resolution_smoke",
                label="turn_resolution_smoke",
                source_type="dataset",
                dataset_name="turn_resolution_smoke",
                trigger_type=trigger_type,
                runtime_role=resolved_runtime_role,
                current_config=current_config,
                candidate_config=candidate_config,
                timeout_seconds=smoke_timeout,
                skip_reason=smoke_skip_reason,
                runner=lambda: self.run_dataset(
                    db,
                    "turn_resolution_smoke",
                    trigger_type=trigger_type,
                    runtime_role=resolved_runtime_role,
                ),
                emit=emit,
            )
            check_results.append(smoke_result)
            if smoke_result.blocked_reason:
                timeout_reasons.append(smoke_result.blocked_reason)
            smoke = smoke_result.payload

            failure_timeout, failure_skip_reason = timeout_for_check("turn_resolution_failure_injection")
            failure_result = self._run_release_eval_check(
                db,
                check_name="turn_resolution_failure_injection",
                label="turn_resolution_failure_injection",
                source_type="dataset",
                dataset_name="turn_resolution_failure_injection",
                trigger_type=trigger_type,
                runtime_role=resolved_runtime_role,
                current_config=current_config,
                candidate_config=candidate_config,
                timeout_seconds=failure_timeout,
                skip_reason=failure_skip_reason,
                runner=lambda: self.run_dataset(
                    db,
                    "turn_resolution_failure_injection",
                    trigger_type=trigger_type,
                    runtime_role=resolved_runtime_role,
                ),
                emit=emit,
            )
            check_results.append(failure_result)
            if failure_result.blocked_reason:
                timeout_reasons.append(failure_result.blocked_reason)
            failure = failure_result.payload

            shadow_timeout, shadow_skip_reason = timeout_for_check("shadow_replay")
            resolved_shadow_limit = shadow_limit if shadow_limit is not None else self._release_shadow_limit(trigger_type)
            shadow_result = self._run_release_eval_check(
                db,
                check_name="shadow_replay",
                label="shadow_replay",
                source_type="shadow_replay",
                dataset_name=None,
                trigger_type=trigger_type,
                runtime_role=resolved_runtime_role,
                current_config=current_config,
                candidate_config=candidate_config,
                timeout_seconds=shadow_timeout,
                skip_reason=shadow_skip_reason,
                runner=lambda: self.run_shadow_replay(
                    db,
                    limit=resolved_shadow_limit,
                    trigger_type=trigger_type,
                    runtime_role=resolved_runtime_role,
                ),
                emit=emit,
            )
            check_results.append(shadow_result)
            if shadow_result.blocked_reason:
                timeout_reasons.append(shadow_result.blocked_reason)
            shadow = shadow_result.payload

            pack_regressions: dict[str, dict[str, object]] = {}
            for dataset_name in PACK_REGRESSION_DATASETS:
                check_name = f"pack_regression:{dataset_name}"
                pack_timeout, pack_skip_reason = timeout_for_check(check_name)
                result = self._run_release_eval_check(
                    db,
                    check_name=check_name,
                    label=dataset_name,
                    source_type="dataset",
                    dataset_name=dataset_name,
                    trigger_type=trigger_type,
                    runtime_role=resolved_runtime_role,
                    current_config=current_config,
                    candidate_config=candidate_config,
                    timeout_seconds=pack_timeout,
                    skip_reason=pack_skip_reason,
                    runner=lambda dataset_name=dataset_name: self.run_dataset(
                        db,
                        dataset_name,
                        trigger_type=trigger_type,
                        runtime_role=resolved_runtime_role,
                    ),
                    emit=emit,
                )
                check_results.append(result)
                if result.blocked_reason:
                    timeout_reasons.append(result.blocked_reason)
                pack_regressions[dataset_name] = result.payload

            self._set_release_checklist_progress(status="running", current_check="slo_canary_snapshot")
            slo_started = time.monotonic()
            emit("start", "slo_canary_snapshot")
            canary_probe = self._probe_canary_health()
            slo_snapshot = self._build_slo_snapshot(db, runtime_role=resolved_runtime_role, canary_probe=canary_probe)
            slo_elapsed = time.monotonic() - slo_started
            emit("pass", "slo_canary_snapshot", elapsed_seconds=slo_elapsed)
            check_results.append(
                ReleaseChecklistCheckResult(
                    payload={"id": None, "summary": {}},
                    elapsed_seconds=slo_elapsed,
                    status="passed",
                    check_name="slo_canary_snapshot",
                    label="slo_canary_snapshot",
                )
            )

            shared_health = slo_snapshot["shared_world_health"]
            blocked_reasons = self._blocked_reasons(
                smoke_summary=smoke["summary"],
                failure_summary=failure["summary"],
                shadow_summary=shadow["summary"],
                pack_regression_summaries={
                    dataset_name: payload["summary"] for dataset_name, payload in pack_regressions.items()
                },
                slo_snapshot=slo_snapshot,
            )
            for reason in timeout_reasons:
                if reason not in blocked_reasons:
                    blocked_reasons.append(reason)
            verdict = "passed" if not blocked_reasons else "blocked"

            report = ReleaseGateReport(
                smoke_run_id=str(smoke["id"]),
                failure_run_id=str(failure["id"]),
                shadow_run_id=str(shadow["id"]),
                pack_regression_run_ids={
                    dataset_name: payload["id"] for dataset_name, payload in pack_regressions.items()
                },
                verdict=verdict,
                blocked_reasons=blocked_reasons,
                slo_snapshot=slo_snapshot,
                trigger_type=trigger_type,
            )
            report.slo_snapshot = {
                **report.slo_snapshot,
                "check_summaries": self._release_check_summaries(check_results),
                "release_total_budget_seconds": total_budget_seconds,
            }
            db.add(report)
            db.flush()

            if self.observability_service is not None:
                self.observability_service.record_shared_world_health(shared_health)
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
                                        "pack_regressions": {
                                            dataset_name: payload["id"]
                                            for dataset_name, payload in pack_regressions.items()
                                        },
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
                create_observability_snapshot(
                    db,
                    self.settings,
                    snapshot_kind="release_checklist",
                    runtime_role=resolved_runtime_role,
                    release_gate_report_id=report.id,
                    primary_slo={
                        "runtime_role": resolved_runtime_role,
                        "projection_lag_seconds": slo_snapshot["projection_lag_seconds"],
                        "outbox_pending_count": slo_snapshot["outbox_pending_count"],
                        "outbox_failed_count": slo_snapshot["outbox_failed_count"],
                        "llm_schema_valid_rate": slo_snapshot["llm_schema_valid_rate"],
                        "llm_fallback_rate": slo_snapshot["llm_fallback_rate"],
                        "shared_world_health": shared_health,
                    },
                    canary_health=canary_probe.__dict__,
                    langfuse_status=self.observability_service.langfuse_runtime(),
                    metrics=self.observability_service.metric_snapshot(),
                    trace_count=len(self.observability_service.recent_trace_attributes(limit=200)),
                )

            self._set_release_checklist_progress(
                status="completed",
                current_check=None,
                completed_report_id=report.id,
                error=None,
            )
            emit("completed", "release_checklist", report_id=report.id, verdict=verdict)
            return self._report_to_dict(db, report, current_config=current_config, candidate_config=candidate_config)
        except Exception as exc:
            self._set_release_checklist_progress(status="failed", current_check=None, error=str(exc))
            emit("failed", "release_checklist", error=str(exc))
            raise

    def _run_release_eval_check(
        self,
        db: Session,
        *,
        check_name: str,
        label: str,
        source_type: Literal["dataset", "shadow_replay"],
        dataset_name: str | None,
        trigger_type: Literal["manual", "nightly", "pre_promote"],
        runtime_role: str,
        current_config: ReleaseConfig,
        candidate_config: ReleaseConfig,
        timeout_seconds: float,
        skip_reason: str | None,
        runner: Callable[[], dict[str, object]],
        emit: Callable[..., None],
    ) -> ReleaseChecklistCheckResult:
        self._set_release_checklist_progress(status="running", current_check=check_name)
        started = time.monotonic()
        emit("start", check_name)
        if skip_reason is not None:
            timeout_payload = self._synthetic_eval_run(
                db,
                source_type=source_type,
                dataset_name=dataset_name,
                trigger_type=trigger_type,
                runtime_role=runtime_role,
                current_config=current_config,
                candidate_config=candidate_config,
                status="timeout",
                reason=skip_reason,
            )
            emit("timeout", check_name, elapsed_seconds=0.0, run_id=timeout_payload["id"], reason=skip_reason)
            return ReleaseChecklistCheckResult(
                payload=timeout_payload,
                elapsed_seconds=0.0,
                status="timeout",
                check_name=check_name,
                label=label,
                blocked_reason=skip_reason,
                case_count=0,
                timeout_seconds=timeout_seconds,
            )
        try:
            payload = self._run_with_release_timeout(runner, timeout_seconds=timeout_seconds)
        except ReleaseCheckTimeout:
            elapsed = time.monotonic() - started
            reason = f"release check {check_name} timed out after {timeout_seconds:g}s"
            timeout_payload = self._synthetic_eval_run(
                db,
                source_type=source_type,
                dataset_name=dataset_name,
                trigger_type=trigger_type,
                runtime_role=runtime_role,
                current_config=current_config,
                candidate_config=candidate_config,
                status="timeout",
                reason=reason,
            )
            emit("timeout", check_name, elapsed_seconds=elapsed, run_id=timeout_payload["id"], reason=reason)
            return ReleaseChecklistCheckResult(
                payload=timeout_payload,
                elapsed_seconds=elapsed,
                status="timeout",
                check_name=check_name,
                label=label,
                blocked_reason=reason,
                case_count=0,
                timeout_seconds=timeout_seconds,
            )
        except Exception as exc:
            elapsed = time.monotonic() - started
            reason = f"release check {check_name} failed: {exc}"
            failed_payload = self._synthetic_eval_run(
                db,
                source_type=source_type,
                dataset_name=dataset_name,
                trigger_type=trigger_type,
                runtime_role=runtime_role,
                current_config=current_config,
                candidate_config=candidate_config,
                status="failed",
                reason=reason,
            )
            emit("fail", check_name, elapsed_seconds=elapsed, run_id=failed_payload["id"], reason=reason)
            return ReleaseChecklistCheckResult(
                payload=failed_payload,
                elapsed_seconds=elapsed,
                status="failed",
                check_name=check_name,
                label=label,
                blocked_reason=reason,
                case_count=0,
                timeout_seconds=timeout_seconds,
            )

        elapsed = time.monotonic() - started
        if timeout_seconds and elapsed > timeout_seconds:
            reason = f"release check {check_name} timed out after {timeout_seconds:g}s"
            timeout_payload = self._synthetic_eval_run(
                db,
                source_type=source_type,
                dataset_name=dataset_name,
                trigger_type=trigger_type,
                runtime_role=runtime_role,
                current_config=current_config,
                candidate_config=candidate_config,
                status="timeout",
                reason=reason,
            )
            emit("timeout", check_name, elapsed_seconds=elapsed, run_id=timeout_payload["id"], reason=reason)
            return ReleaseChecklistCheckResult(
                payload=timeout_payload,
                elapsed_seconds=elapsed,
                status="timeout",
                check_name=check_name,
                label=label,
                blocked_reason=reason,
                case_count=0,
                timeout_seconds=timeout_seconds,
            )

        summary = payload.get("summary") if isinstance(payload, dict) else {}
        summary = summary if isinstance(summary, dict) else {}
        variants = summary.get("variants")
        variants = variants if isinstance(variants, dict) else {}
        current = variants.get("current")
        candidate = variants.get("candidate")
        current = current if isinstance(current, dict) else {}
        candidate = candidate if isinstance(candidate, dict) else {}
        passed = bool(current.get("gate_passed")) and bool(candidate.get("gate_passed"))
        case_count = summary.get("case_count")
        execution_mode = summary.get("execution_mode")
        emit("pass" if passed else "fail", check_name, elapsed_seconds=elapsed, run_id=payload.get("id"))
        return ReleaseChecklistCheckResult(
            payload=payload,
            elapsed_seconds=elapsed,
            status="passed" if passed else "failed",
            check_name=check_name,
            label=label,
            blocked_reason=None if passed else self._eval_run_failure_reason(payload),
            execution_mode=execution_mode if isinstance(execution_mode, str) else None,
            case_count=int(case_count) if isinstance(case_count, int) else None,
            timeout_seconds=timeout_seconds,
        )

    @staticmethod
    def _run_with_release_timeout(
        runner: Callable[[], dict[str, object]],
        *,
        timeout_seconds: float,
    ) -> dict[str, object]:
        if timeout_seconds <= 0 or threading.current_thread() is not threading.main_thread():
            return runner()

        previous_handler = signal.getsignal(signal.SIGALRM)

        def timeout_handler(signum, frame):  # type: ignore[no-untyped-def]
            del signum, frame
            raise ReleaseCheckTimeout("release check timed out")

        signal.signal(signal.SIGALRM, timeout_handler)
        signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
        try:
            return runner()
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous_handler)

    @staticmethod
    def _eval_run_failure_reason(payload: dict[str, object]) -> str:
        summary = payload.get("summary") if isinstance(payload, dict) else {}
        summary = summary if isinstance(summary, dict) else {}
        reason = summary.get("failure_reason")
        if isinstance(reason, str) and reason:
            return reason
        comparison = summary.get("comparison")
        comparison = comparison if isinstance(comparison, dict) else {}
        failed_ids = comparison.get("candidate_failed_case_ids") or comparison.get("current_failed_case_ids") or []
        if failed_ids:
            return f"failed cases: {', '.join(str(item) for item in failed_ids)}"
        return "release check did not pass"

    @staticmethod
    def _release_check_summaries(results: list[ReleaseChecklistCheckResult]) -> list[dict[str, object]]:
        summaries: list[dict[str, object]] = []
        for result in results:
            payload = result.payload if isinstance(result.payload, dict) else {}
            summary = payload.get("summary")
            summary = summary if isinstance(summary, dict) else {}
            reason = result.blocked_reason or summary.get("failure_reason")
            item: dict[str, object] = {
                "check_id": result.check_name,
                "label": result.label or result.check_name,
                "status": result.status,
                "run_id": payload.get("id"),
                "elapsed_seconds": round(float(result.elapsed_seconds), 3),
                "reason": reason if isinstance(reason, str) and reason else None,
            }
            if result.execution_mode is not None:
                item["execution_mode"] = result.execution_mode
            if result.case_count is not None:
                item["case_count"] = result.case_count
            if result.timeout_seconds is not None:
                item["timeout_seconds"] = round(float(result.timeout_seconds), 3)
            summaries.append(item)
        return summaries

    def _synthetic_eval_run(
        self,
        db: Session,
        *,
        source_type: Literal["dataset", "shadow_replay"],
        dataset_name: str | None,
        trigger_type: Literal["manual", "nightly", "pre_promote"],
        runtime_role: str,
        current_config: ReleaseConfig,
        candidate_config: ReleaseConfig,
        status: str,
        reason: str,
    ) -> dict[str, object]:
        summary = self._synthetic_run_summary(source_type, dataset_name, reason)
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
            status=status,
            summary=summary,
            completed_at=self._now(),
        )
        db.add(run)
        db.flush()
        return self.get_run_detail(db, run.id)

    def _synthetic_run_summary(
        self,
        source_type: str,
        dataset_name: str | None,
        reason: str,
    ) -> dict[str, object]:
        pack_scope = self._pack_scope_for_dataset_name(dataset_name) if dataset_name else []
        variant = {
            "total": 0,
            "passed": 0,
            "failed": 0,
            "failed_case_ids": [],
            "retrieval_ready": 0,
            "retrieval_degraded": 0,
            "gate_passed": False,
        }
        return {
            "source_type": source_type,
            "dataset_name": dataset_name,
            "case_count": 0,
            "execution_mode": "synthetic",
            "pack_scope": pack_scope,
            "variants": {
                "current": dict(variant),
                "candidate": dict(variant),
            },
            "comparison": {
                "passed_delta": 0,
                "current_failed_case_ids": [],
                "candidate_failed_case_ids": [],
            },
            "failure_reason": reason,
        }

    def list_runs(
        self,
        db: Session,
        limit: int = 12,
        *,
        pack_id: str | None = None,
        world_template_id: str | None = None,
    ) -> dict[str, object]:
        stmt = select(EvalRun).order_by(EvalRun.started_at.desc(), EvalRun.id.desc())
        runs = []
        for run in db.execute(stmt).scalars():
            run_summary = run.summary if isinstance(run.summary, dict) else {}
            if not _pack_scope_matches(run_summary.get("pack_scope"), pack_id, world_template_id):
                continue
            runs.append(run)
            if len(runs) >= limit:
                break
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

    def get_run_detail(
        self,
        db: Session,
        run_id: str,
        *,
        pack_id: str | None = None,
        world_template_id: str | None = None,
    ) -> dict[str, object]:
        run = db.execute(select(EvalRun).where(EvalRun.id == run_id)).scalar_one()
        results = list(
            db.execute(
                select(EvalCaseResult)
                .where(EvalCaseResult.eval_run_id == run_id)
                .order_by(EvalCaseResult.case_id.asc(), EvalCaseResult.variant.asc())
            ).scalars()
        )
        filtered_results = [
            result
            for result in results
            if _pack_context_matches(_pack_context_from_raw_output(result.raw_output), pack_id, world_template_id)
        ]
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
                    "pack_context": _pack_context_from_raw_output(result.raw_output),
                    "raw_output": result.raw_output,
                }
                for result in filtered_results
            ],
        }

    def get_release_checklist(
        self,
        db: Session,
        report_id: str,
        *,
        pack_id: str | None = None,
        world_template_id: str | None = None,
    ) -> dict[str, object]:
        report = db.execute(select(ReleaseGateReport).where(ReleaseGateReport.id == report_id)).scalar_one()
        return self._report_to_dict(
            db,
            report,
            current_config=self.load_release_config("current"),
            candidate_config=self.load_release_config("candidate"),
            pack_id=pack_id,
            world_template_id=world_template_id,
        )

    def latest_release_checklist(
        self,
        db: Session,
        *,
        pack_id: str | None = None,
        world_template_id: str | None = None,
    ) -> dict[str, object]:
        report = db.execute(
            select(ReleaseGateReport).order_by(ReleaseGateReport.created_at.desc(), ReleaseGateReport.id.desc()).limit(1)
        ).scalar_one_or_none()
        if report is None:
            shared_health = shared_world_health(db)
            all_checks = {
                "smoke": {"present": False, "current_passed": False, "candidate_passed": False, "run_id": None},
                "failure_injection": {"present": False, "current_passed": False, "candidate_passed": False, "run_id": None},
                "shadow_replay": {"present": False, "current_passed": False, "candidate_passed": False, "run_id": None},
                "shared_world_health": _shared_world_health_check(shared_health),
                "pack_regressions": {
                    dataset_name: {
                        "present": False,
                        "current_passed": False,
                        "candidate_passed": False,
                        "run_id": None,
                        "pack_scope": self._pack_scope_for_dataset_name(dataset_name),
                    }
                    for dataset_name in PACK_REGRESSION_DATASETS
                },
            }
            filtered_checks = _filter_release_checks(all_checks, pack_id, world_template_id)
            filtered_pack_regression_names = set(filtered_checks["pack_regressions"])
            return {
                "report_id": None,
                "verdict": "blocked",
                "blocked_reasons": ["No release checklist report exists"],
                "trigger_type": "manual",
                "checks": filtered_checks,
                "check_summaries": [
                    {
                        "check_id": "release_checklist",
                        "label": "release_checklist",
                        "status": "missing",
                        "run_id": None,
                        "elapsed_seconds": 0.0,
                        "reason": "No release checklist report exists",
                    }
                ],
                "runs": {
                    "smoke": None,
                    "failure_injection": None,
                    "shadow_replay": None,
                    "pack_regressions": {dataset_name: None for dataset_name in filtered_pack_regression_names},
                },
                "latest_runs": {
                    "smoke": None,
                    "failure_injection": None,
                    "shadow_replay": None,
                    "pack_regressions": {dataset_name: None for dataset_name in filtered_pack_regression_names},
                },
                "slo_snapshot": {
                    "runtime_role": self.settings.app_runtime_role,
                    "canary_health": self._probe_canary_health().__dict__,
                    "world_packs": (self.pack_registry or get_pack_registry(self.settings)).health_summary(),
                    "shared_world_health": shared_health,
                    "projection_lag_seconds": 0.0,
                    "outbox_pending_count": 0,
                    "outbox_failed_count": 0,
                    "llm_schema_valid_rate": 0.0,
                    "llm_fallback_rate": 0.0,
                },
                "diff_summary": self.load_release_config("current").diff(self.load_release_config("candidate")),
                "shadow_failures": [],
                "runbook": self._runbook(),
                "cutover_status": self._cutover_status(
                    verdict="blocked",
                    blocked_reasons=["No release checklist report exists"],
                    checks=all_checks,
                ),
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
            pack_id=pack_id,
            world_template_id=world_template_id,
        )

    def latest_gate_report(
        self,
        db: Session,
        *,
        pack_id: str | None = None,
        world_template_id: str | None = None,
    ) -> dict[str, object]:
        return self.latest_release_checklist(db, pack_id=pack_id, world_template_id=world_template_id)

    def _report_to_dict(
        self,
        db: Session,
        report: ReleaseGateReport,
        *,
        current_config: ReleaseConfig,
        candidate_config: ReleaseConfig,
        pack_id: str | None = None,
        world_template_id: str | None = None,
    ) -> dict[str, object]:
        smoke = db.execute(select(EvalRun).where(EvalRun.id == report.smoke_run_id)).scalar_one()
        failure = db.execute(select(EvalRun).where(EvalRun.id == report.failure_run_id)).scalar_one()
        shadow = db.execute(select(EvalRun).where(EvalRun.id == report.shadow_run_id)).scalar_one()
        pack_regression_run_ids = dict(report.pack_regression_run_ids or {})
        pack_regression_runs = {
            dataset_name: db.execute(select(EvalRun).where(EvalRun.id == run_id)).scalar_one_or_none()
            for dataset_name, run_id in pack_regression_run_ids.items()
        }
        shadow_results = list(
            db.execute(
                select(EvalCaseResult)
                .where(EvalCaseResult.eval_run_id == shadow.id)
                .order_by(EvalCaseResult.case_id.asc(), EvalCaseResult.variant.asc())
            ).scalars()
        )
        all_checks = {
            "smoke": self._extract_gate_check(smoke),
            "failure_injection": self._extract_gate_check(failure),
            "shadow_replay": self._extract_gate_check(shadow),
            "shared_world_health": _shared_world_health_check(report.slo_snapshot.get("shared_world_health")),
            "pack_regressions": {
                dataset_name: self._extract_gate_check(
                    pack_regression_runs.get(dataset_name),
                    dataset_name=dataset_name,
                )
                for dataset_name in PACK_REGRESSION_DATASETS
            },
        }
        checks = _filter_release_checks(all_checks, pack_id, world_template_id)
        filtered_pack_regression_names = set(checks["pack_regressions"])
        pack_regression_runs_payload = {
            dataset_name: pack_regression_run_ids.get(dataset_name)
            for dataset_name in PACK_REGRESSION_DATASETS
            if dataset_name in filtered_pack_regression_names
        }
        shadow_failures = []
        for item in shadow_results:
            raw_output = item.raw_output if isinstance(item.raw_output, dict) else {}
            retrieval_trace = raw_output.get("retrieval_trace", {})
            retrieval_trace = retrieval_trace if isinstance(retrieval_trace, dict) else {}
            retrieval_status = retrieval_trace.get("status")
            retrieval_hit_count = len(retrieval_trace.get("retrieved_memory_ids", []))
            retrieval_required = bool(raw_output.get("retrieval_required", False))
            if (
                item.passed
                and item.graph_context_status == "ready"
                and retrieval_status == "ready"
                and (not retrieval_required or retrieval_hit_count >= 1)
            ):
                continue
            failure_categories = self._case_failure_categories_from_result(item)
            shadow_failures.append(
                {
                    "case_id": item.case_id,
                    "variant": item.variant,
                    "lane": item.lane,
                    "pack_context": _pack_context_from_raw_output(raw_output),
                    "graph_context_status": item.graph_context_status,
                    "retrieval_status": retrieval_status,
                    "retrieval_hit_count": retrieval_hit_count,
                    "retrieval_required": retrieval_required,
                    "failure_categories": failure_categories,
                    "failure_diagnostics": ", ".join(failure_categories) or "unclassified failure",
                    "failure_reason": item.failure_reason,
                }
            )
        shadow_failures = [
            item
            for item in shadow_failures
            if _pack_context_matches(item["pack_context"], pack_id, world_template_id)
        ]
        canary_promote_status = "ready" if report.verdict == "passed" else "blocked"
        check_summaries = report.slo_snapshot.get("check_summaries") if isinstance(report.slo_snapshot, dict) else []
        check_summaries = check_summaries if isinstance(check_summaries, list) else []
        return {
            "report_id": report.id,
            "verdict": report.verdict,
            "blocked_reasons": report.blocked_reasons,
            "trigger_type": report.trigger_type,
            "checks": checks,
            "check_summaries": check_summaries,
            "runs": {
                "smoke": smoke.id,
                "failure_injection": failure.id,
                "shadow_replay": shadow.id,
                "pack_regressions": pack_regression_runs_payload,
            },
            "latest_runs": {
                "smoke": smoke.id,
                "failure_injection": failure.id,
                "shadow_replay": shadow.id,
                "pack_regressions": pack_regression_runs_payload,
            },
            "slo_snapshot": report.slo_snapshot,
            "diff_summary": current_config.diff(candidate_config),
            "shadow_failures": shadow_failures,
            "runbook": self._runbook(),
            "cutover_status": self._cutover_status(
                verdict=report.verdict,
                blocked_reasons=report.blocked_reasons,
                checks=all_checks,
            ),
            "created_at": report.created_at.isoformat(),
            "canary_promote_status": canary_promote_status,
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

        pack_scope = self._pack_scope_for_cases(cases)
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
                    "pack_ids": [str(item["pack_id"]) for item in pack_scope],
                    "world_template_ids": [str(item["world_template_id"]) for item in pack_scope],
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
                    pack_scope=pack_scope,
                )

            current_service = GMCouncilService(
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
            )
            candidate_service = GMCouncilService(
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
            )
            configs_identical = (
                current_config.content_hash == candidate_config.content_hash
                or current_config.routes == candidate_config.routes
            )
            execution_mode = "single_config_reused" if configs_identical else "dual_config"

            case_payloads: list[dict[str, object]] = []
            routers = (
                {"current": current_service}
                if configs_identical
                else {
                    "current": current_service,
                    "candidate": candidate_service,
                }
            )
            for variant, council_service in routers.items():
                for case in cases:
                    retrieved_memories, retrieval_trace = self._resolve_case_retrieval(case)
                    outcome = council_service.resolve_public_turn(
                        CouncilRequest(
                            world_id=case.world_id,
                            turn_id=case.source_turn_id,
                            player_name=case.player_name,
                            npc_name=case.npc_name,
                            input_text=case.input_text,
                            input_mode="free_text",
                            relevant_memories=retrieved_memories,
                            relation_context=case.relation_context,
                            graph_context_status=case.graph_context_status,
                            session_state=self._session_state_for_case(case),
                            selected_choice=None,
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
                    if configs_identical and variant == "current":
                        duplicated_payload = self._persist_case_result(
                            db,
                            run_id=run.id,
                            variant="candidate",
                            case=case,
                            outcome=outcome,
                            retrieved_memories=retrieved_memories,
                            retrieval_trace=retrieval_trace,
                            variant_source="current",
                        )
                        case_payloads.append(duplicated_payload)

            run.summary = self._build_run_summary(
                source_type,
                dataset_name,
                cases,
                case_payloads,
                execution_mode=execution_mode,
            )
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
        variant_source: str | None = None,
    ) -> dict[str, object]:
        final_attempt = outcome.attempts[-1]
        final_payload = outcome.final_payload.model_dump() if outcome.final_payload is not None else None
        used_fallback = outcome.used_fallback
        schema_valid = outcome.succeeded
        same_world_invariant = bool(
            final_payload is not None
            and (
                final_payload.get("event_payload", {}).get("world_id") == case.world_id
                or final_payload.get("interpreted_intent", {}).get("source") == "public_ai_gm"
            )
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
            "pack_context": self._pack_context_for_case(case),
            "input_text": case.input_text,
            "relevant_memories": case.relevant_memories,
            "retrieved_memories": retrieved_memories,
            "retrieval_trace": retrieval_trace_to_dict(retrieval_trace),
            "retrieval_required": bool(case.expect_retrieval_min_hits or case.expect_retrieval_hit_substring),
            "relation_context": case.relation_context,
            "expectations": {
                "final_lane": case.expect_final_lane,
                "fallback": case.expect_fallback,
                "retrieval_status": case.expect_retrieval_status,
                "retrieval_min_hits": case.expect_retrieval_min_hits,
                "retrieval_hit_substring": case.expect_retrieval_hit_substring,
            },
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
        if variant_source is not None:
            raw_output["variant_source"] = variant_source
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
            "pack_context": self._pack_context_for_case(case),
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
        actual_consequence_tags = self._domain_consequence_tags(final_payload)
        checks: dict[str, bool] = {}
        if case.expected_world_tags is not None:
            checks["world_tags_match"] = world_tags == normalize_world_tags(case.expected_world_tags)

        # Quest progression is the AI GM's narrative judgment (ADR-003), not a
        # deterministic tag counter, so the domain eval no longer asserts numeric
        # progress/standing outcomes. quest_context still seeds the session_state fixture.
        if case.expect_outcome_band is not None:
            checks["outcome_band_match"] = str(final_payload.get("outcome_band") or "") == case.expect_outcome_band

        if case.expect_scene_move is not None:
            checks["scene_move_match"] = str(final_payload.get("scene_move") or "") == case.expect_scene_move

        if case.expect_consequence_tags is not None:
            actual_tags = set(actual_consequence_tags)
            checks["consequence_tags_match"] = set(case.expect_consequence_tags) <= actual_tags

        return {
            "passed": all(checks.values()) if checks else True,
            "checks": checks,
            "rule_outcome": None,
            "actual_consequence_tags": actual_consequence_tags,
        }

    @staticmethod
    def _domain_consequence_tags(final_payload: dict[str, object]) -> list[str]:
        raw_tags = [str(item) for item in final_payload.get("consequence_tags") or []]
        interpreted_intent = final_payload.get("interpreted_intent")
        if isinstance(interpreted_intent, dict):
            raw_tags.extend(str(item) for item in interpreted_intent.get("consequence_tags") or [])
        return list(normalize_consequence_tags(raw_tags))

    def _release_shadow_limit(self, trigger_type: Literal["manual", "nightly", "pre_promote"]) -> int:
        configured_limit = max(int(self.settings.release_shadow_limit), 0)
        if trigger_type in {"manual", "pre_promote"} and configured_limit > 1:
            return 1
        return configured_limit

    @staticmethod
    def _release_check_timeout_seconds(trigger_type: Literal["manual", "nightly", "pre_promote"], configured_timeout: float) -> float:
        if trigger_type in {"manual", "pre_promote"} and 60.0 <= configured_timeout < 300.0:
            return 300.0
        return configured_timeout

    @staticmethod
    def _release_total_budget_seconds(trigger_type: Literal["manual", "nightly", "pre_promote"], configured_budget: float) -> float:
        if trigger_type in {"manual", "pre_promote"} and 60.0 <= configured_budget < 900.0:
            return 900.0
        return configured_budget

    def _build_run_summary(
        self,
        source_type: str,
        dataset_name: str | None,
        cases: list[EvalCaseInput],
        results: list[dict[str, object]],
        *,
        execution_mode: str,
    ) -> dict[str, object]:
        summary: dict[str, object] = {
            "source_type": source_type,
            "dataset_name": dataset_name,
            "case_count": len(cases),
            "execution_mode": execution_mode,
            "pack_scope": self._pack_scope_for_cases(cases),
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
            return source_type == "shadow_replay"
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
        if dataset_name == "turn_resolution_smoke" or dataset_name in PACK_REGRESSION_DATASETS:
            return all(item["schema_valid"] and item["same_world_invariant"] for item in scoped)
        if dataset_name == "turn_resolution_failure_injection":
            return all(item["passed"] for item in scoped)
        return all(item["passed"] for item in scoped)

    @staticmethod
    def _case_failure_categories_from_result(result: EvalCaseResult) -> list[str]:
        categories: list[str] = []
        raw_output = result.raw_output if isinstance(result.raw_output, dict) else {}
        retrieval_trace = raw_output.get("retrieval_trace", {})
        retrieval_trace = retrieval_trace if isinstance(retrieval_trace, dict) else {}
        expectations = raw_output.get("expectations", {})
        expectations = expectations if isinstance(expectations, dict) else {}
        retrieval_status = retrieval_trace.get("status")
        retrieval_hit_count = len(retrieval_trace.get("retrieved_memory_ids", []))
        retrieval_required = bool(raw_output.get("retrieval_required", False))
        expected_lane = expectations.get("final_lane")
        expected_fallback = expectations.get("fallback")

        if not result.schema_valid:
            categories.append("schema")
        if not result.same_world_invariant:
            categories.append("same-world")
        if result.graph_context_status != "ready":
            categories.append("graph")
        if retrieval_status != "ready" or (retrieval_required and retrieval_hit_count < 1):
            categories.append("retrieval")
        if expected_lane is not None and result.lane != expected_lane:
            categories.append("lane")
        if expected_fallback is not None and result.used_fallback != expected_fallback:
            categories.append("fallback")
        if result.failure_reason and not categories:
            categories.append("model")
        if not result.passed and not categories:
            categories.append("domain")
        return categories

    def _blocked_reasons(
        self,
        *,
        smoke_summary: dict[str, object],
        failure_summary: dict[str, object],
        shadow_summary: dict[str, object],
        pack_regression_summaries: dict[str, dict[str, object]],
        slo_snapshot: dict[str, object],
    ) -> list[str]:
        blocked: list[str] = []
        if not bool(smoke_summary["variants"]["current"]["gate_passed"]) or not bool(smoke_summary["variants"]["candidate"]["gate_passed"]):
            blocked.append("smoke gate failed")
        if not bool(failure_summary["variants"]["current"]["gate_passed"]) or not bool(failure_summary["variants"]["candidate"]["gate_passed"]):
            blocked.append("failure injection gate failed")
        if not bool(shadow_summary["variants"]["current"]["gate_passed"]) or not bool(shadow_summary["variants"]["candidate"]["gate_passed"]):
            blocked.append("shadow replay gate failed")
        for dataset_name, summary in pack_regression_summaries.items():
            if not bool(summary["variants"]["current"]["gate_passed"]) or not bool(summary["variants"]["candidate"]["gate_passed"]):
                blocked.append(f"pack regression {dataset_name} failed")
        if int(slo_snapshot["outbox_failed_count"]) > 0:
            blocked.append("failed_outbox > 0")
        if float(slo_snapshot["projection_lag_seconds"]) > 5.0:
            blocked.append("projection_lag_seconds > 5")
        if slo_snapshot["canary_health"]["status"] != "healthy":
            blocked.append("canary health != healthy")
        world_packs = slo_snapshot.get("world_packs")
        if isinstance(world_packs, dict) and world_packs.get("status") != "ready":
            blocked.append("world pack catalog != ready")
        if not bool(slo_snapshot["sp_reason_invariant_ok"]):
            blocked.append("sp execution budget invariant failed")
        shared_health = slo_snapshot.get("shared_world_health")
        if isinstance(shared_health, dict) and shared_health.get("status") != "ready":
            blocked.append("shared world health != ready")
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
            if oldest_pending.tzinfo is None:
                oldest_pending = oldest_pending.replace(tzinfo=self._now().tzinfo)
            projection_lag_seconds = max((self._now() - oldest_pending).total_seconds(), 0.0)
        if canary_probe.projection_lag_seconds is not None:
            projection_lag_seconds = float(canary_probe.projection_lag_seconds)

        llm_total = int(db.execute(select(func.count(LLMRun.id))).scalar_one())
        llm_valid = int(db.execute(select(func.count(LLMRun.id)).where(LLMRun.output_schema_status == "valid")).scalar_one())
        turn_count = int(db.execute(select(func.count(func.distinct(LLMRun.turn_id)))).scalar_one())
        fallback_groups = db.execute(
            select(LLMRun.turn_id, LLMRun.stage_index, LLMRun.council_role, func.count(LLMRun.id))
            .group_by(LLMRun.turn_id, LLMRun.stage_index, LLMRun.council_role)
        ).all()
        fallback_turns = len({row[0] for row in fallback_groups if int(row[3]) > 1})

        pack_registry = self.pack_registry or get_pack_registry(self.settings)
        snapshot = {
            "runtime_role": runtime_role,
            "canary_health": canary_probe.__dict__,
            "world_packs": pack_registry.health_summary(),
            "shared_world_health": shared_world_health(db),
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
            self.observability_service.sync_shared_world_health(snapshot["shared_world_health"])
        return snapshot

    def _extract_gate_check(self, run: EvalRun | None, *, dataset_name: str | None = None) -> dict[str, object]:
        if run is None:
            return {
                "present": False,
                "current_passed": False,
                "candidate_passed": False,
                "run_id": None,
                "pack_scope": self._pack_scope_for_dataset_name(dataset_name) if dataset_name is not None else [],
            }
        summary = run.summary or {}
        variants = summary.get("variants", {})
        current = variants.get("current", {})
        candidate = variants.get("candidate", {})
        return {
            "present": True,
            "current_passed": bool(current.get("gate_passed")),
            "candidate_passed": bool(candidate.get("gate_passed")),
            "run_id": run.id,
            "pack_scope": summary.get("pack_scope") or [],
        }

    def _pack_scope_for_dataset_name(self, dataset_name: str) -> list[dict[str, object]]:
        dataset = self.datasets.get(dataset_name)
        if dataset is None:
            return []
        return self._pack_scope_for_cases(dataset.cases)

    def _pack_scope_for_cases(self, cases: list[EvalCaseInput]) -> list[dict[str, object]]:
        registry = self.pack_registry or get_pack_registry(self.settings)
        scoped: dict[tuple[str, str], dict[str, object]] = {}
        for case in cases:
            if not case.pack_id or not case.world_template_id:
                continue
            key = (case.pack_id, case.world_template_id)
            if key in scoped:
                continue
            try:
                pack = registry.get_pack(case.pack_id)
                template = pack.template(case.world_template_id)
                scoped[key] = {
                    "pack_id": pack.manifest.pack_id,
                    "pack_display_name": pack.manifest.display_name,
                    "world_template_id": template.template_id,
                    "world_template_display_name": template.display_name,
                }
            except ValueError:
                scoped[key] = {
                    "pack_id": case.pack_id,
                    "pack_display_name": case.pack_id,
                    "world_template_id": case.world_template_id,
                    "world_template_display_name": case.world_template_id,
                }
        return [scoped[key] for key in sorted(scoped)]

    def _pack_context_for_case(self, case: EvalCaseInput) -> dict[str, object]:
        context: dict[str, object] = {
            "world_id": case.world_id,
            "pack_id": case.pack_id,
            "pack_display_name": case.pack_id,
            "world_template_id": case.world_template_id,
            "world_template_display_name": case.world_template_id,
        }
        if not case.pack_id or not case.world_template_id:
            return context
        registry = self.pack_registry or get_pack_registry(self.settings)
        try:
            pack = registry.get_pack(case.pack_id)
            template = pack.template(case.world_template_id)
        except (KeyError, ValueError):
            return context
        return {
            "world_id": case.world_id,
            "pack_id": pack.manifest.pack_id,
            "pack_display_name": pack.manifest.display_name,
            "world_template_id": template.template_id,
            "world_template_display_name": template.display_name,
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
                case = EvalCaseInput(
                    case_id=case_id,
                    prompt_id=prompt_id,
                    world_id=str(raw_case.get("world_id", "")).strip(),
                    pack_id=str(raw_case.get("pack_id", "")).strip(),
                    world_template_id=str(raw_case.get("world_template_id", "")).strip(),
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
                if prompt_id == "session.turn_resolution":
                    if not case.pack_id:
                        raise ValueError(f"Dataset {dataset_id} case {case_id} is missing pack_id")
                    if not case.world_template_id:
                        raise ValueError(f"Dataset {dataset_id} case {case_id} is missing world_template_id")
                cases.append(case)
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
            if turn.action_type != "narrative" or turn.resolution_mode not in {"gm_council", "ai_gm_harness"}:
                continue
            if turn.model_lane not in SUPPORTED_MODEL_LANES:
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
            pack, template = resolve_world_pack(db, turn.world_id)
            source_event = db.execute(
                select(Event)
                .where(Event.world_id == turn.world_id, Event.turn_id == turn.id)
                .order_by(Event.created_at.desc(), Event.id.desc())
                .limit(1)
            ).scalar_one_or_none()
            context_location_id = source_event.location_id if source_event is not None else player_actor.current_location_id
            graph_context = self.projection_service.resolve_relation_context(
                db,
                world_id=turn.world_id,
                primary_actor_id=npc_actor.id,
                counterpart_actor_id=player_actor.id,
                location_id=context_location_id,
            )
            query_text = build_retrieval_query_text(
                turn.input_text,
                session_state=self._session_state_for_case(
                    EvalCaseInput(
                        case_id="shadow-bootstrap",
                        prompt_id="session.turn_resolution",
                        world_id=turn.world_id,
                        pack_id=pack.manifest.pack_id,
                        world_template_id=template.template_id,
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
                location_id=context_location_id,
            )
            cases.append(
                EvalCaseInput(
                    case_id=f"shadow-{turn.id}",
                    prompt_id="session.turn_resolution",
                    world_id=turn.world_id,
                    pack_id=pack.manifest.pack_id,
                    world_template_id=template.template_id,
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

    def _session_state_for_case(self, case: EvalCaseInput) -> dict[str, object]:
        quest_progress = int((case.quest_context or {}).get("current_progress", 0))
        progress_target = int((case.quest_context or {}).get("progress_target", 2))
        current_standing = float((case.quest_context or {}).get("current_standing", 0.0))
        if not case.pack_id or not case.world_template_id:
            raise ValueError(f"Eval case {case.case_id} is missing pack_id/world_template_id")

        registry = self.pack_registry or get_pack_registry(self.settings)
        pack = registry.get_pack(case.pack_id)
        template = pack.template(case.world_template_id)
        world_pack_overrides = dict((case.quest_context or {}).get("world_pack") or {})
        roles = template.roles.model_dump()
        locations = {key: value.model_dump() for key, value in template.locations.items()}
        followup_branches = serialize_followup_branches(template.roles.followup_branches)
        starter_stage_key = str(roles.get("starter_stage_key") or "starter_stage")
        followup_stage_key = str(roles.get("followup_stage_key") or "followup_stage")
        opening_chapter_key = str(roles.get("opening_chapter_key") or "opening_chapter")
        followup_chapter_key = str(roles.get("followup_chapter_key") or "followup_chapter")
        reward_effect_kind = str(roles.get("reward_effect_kind") or "unlock_followup_route")
        starter_location_key = str(roles.get("starter_location_key") or "starter")
        lore_location_key = str(roles.get("lore_location_key") or "lore")
        followup_location_key = str(roles.get("followup_location_key") or "followup")
        starter_location = dict(locations.get(starter_location_key) or {"id": starter_location_key, "name": "Starter"})
        lore_location = dict(locations.get(lore_location_key) or {"id": lore_location_key, "name": "Lore"})
        followup_location = dict(
            locations.get(followup_location_key) or {"id": followup_location_key, "name": "Follow-up"}
        )
        stage_key = str((case.quest_context or {}).get("stage_key") or starter_stage_key)
        chapter_key = followup_chapter_key if stage_key == followup_stage_key else opening_chapter_key
        inventory_items = list((case.quest_context or {}).get("inventory_items") or [])
        current_location_key = str((case.quest_context or {}).get("current_location_key") or "").strip()
        if not current_location_key:
            if stage_key == followup_stage_key and any(str(item.get("status") or "") == "used" for item in inventory_items):
                current_location_key = starter_location_key
            elif stage_key == followup_stage_key and quest_progress > 0:
                current_location_key = followup_location_key
            else:
                current_location_key = starter_location_key
        current_location = dict(locations.get(current_location_key) or starter_location)
        world_name = str(
            world_pack_overrides.get("world_name")
            or (template.world or {}).get("default_name")
            or template.display_name
        )
        reward_name = str(
            world_pack_overrides.get("reward_name")
            or ((template.quest.reward_name if template.quest is not None else "") or "the reward item")
        )
        faction_name = str(world_pack_overrides.get("faction_name") or template.faction.name or "the local faction")
        world_pack = {
            "pack_id": pack.manifest.pack_id,
            "world_template_id": template.template_id,
            "starter_stage_key": starter_stage_key,
            "followup_stage_key": followup_stage_key,
            "opening_chapter_key": opening_chapter_key,
            "followup_chapter_key": followup_chapter_key,
            "reward_effect_kind": reward_effect_kind,
            "starter_location_key": starter_location_key,
            "starter_location_name": str(starter_location.get("name") or starter_location_key),
            "lore_location_key": lore_location_key,
            "lore_location_name": str(lore_location.get("name") or lore_location_key),
            "followup_location_key": followup_location_key,
            "followup_location_name": str(followup_location.get("name") or followup_location_key),
            "world_name": world_name,
            "reward_name": reward_name,
            "faction_name": faction_name,
            "followup_branches": followup_branches,
            "branch_labels": branch_labels_from_followup_branches(followup_branches),
        }
        world_pack.update(world_pack_overrides)
        world_pack["followup_branches"] = dict(world_pack.get("followup_branches") or followup_branches)
        world_pack["branch_labels"] = dict(
            world_pack.get("branch_labels") or branch_labels_from_followup_branches(world_pack["followup_branches"])
        )
        quest_definition = template.followup_quest if stage_key == followup_stage_key else template.quest
        quest_id = quest_definition.id if quest_definition is not None else "eval-dynamic-quest"
        quest_title = quest_definition.title if quest_definition is not None else "Eval Dynamic Quest"
        chapter_summary = (
            f"The opening chapter of {world_name} is still gathering momentum around the opening request."
            if chapter_key == opening_chapter_key
            else f"The follow-up route toward {world_pack['followup_location_name']} is currently active."
        )
        scene_summary = (
            f"The scene around {current_location.get('name') or current_location_key} is still reading the current request."
            if chapter_key == opening_chapter_key
            else f"The scene is turning toward {world_pack['followup_location_name']} and what the unlocked route now asks."
        )
        base_state: dict[str, object] = {
            "world_id": case.world_id,
            "location": {
                "id": str(current_location.get("id") or current_location_key),
                "key": current_location_key,
                "name": str(current_location.get("name") or current_location_key),
                "description": str(current_location.get("description") or "Eval fixture"),
            },
            "current_location": {
                "id": str(current_location.get("id") or current_location_key),
                "key": current_location_key,
                "name": str(current_location.get("name") or current_location_key),
                "description": str(current_location.get("description") or "Eval fixture"),
            },
            "world_pack": world_pack,
            "chapter": {
                "id": "eval-chapter",
                "key": chapter_key,
                "status": "active",
                "summary": chapter_summary,
            },
            "current_scene": {
                "id": "eval-scene",
                "summary": scene_summary,
                "pressure_summary": "Eval pressure fixture.",
                "location": {
                    "id": str(current_location.get("id") or current_location_key),
                    "name": str(current_location.get("name") or current_location_key),
                    "description": str(current_location.get("description") or "Eval fixture"),
                },
                "focus_actor": {"actor_id": "eval-npc", "display_name": case.npc_name},
            },
            "recent_scene_history": [scene_summary],
            "character": {"actor_id": "eval-actor", "rank": "Wayfarer", "hp": 10, "focus": 5, "status_json": {}},
            "quests": [
                {
                    "assignment_id": "eval-quest",
                    "quest_template_id": quest_id,
                    "title": str((case.quest_context or {}).get("title") or quest_title),
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
                    "faction_id": template.faction.id,
                    "name": faction_name,
                    "description": "Eval fixture faction",
                    "standing": current_standing,
                    "band": "neutral",
                }
            ],
            "inventory": inventory_items,
        }
        overrides = case.session_state_overrides or {}
        for key, value in overrides.items():
            base_state[key] = value
        character = base_state.get("character") or {}
        factions = list(base_state.get("factions") or [])
        inventory = list(base_state.get("inventory") or [])
        base_state["narrative_state_bands"] = narrative_state_bands(character, factions)
        base_state["important_inventory_affordances"] = important_inventory_affordances(
            inventory,
            followup_location_name=str(world_pack["followup_location_name"]),
        )
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
    def _cutover_status(
        *,
        verdict: str,
        blocked_reasons: list[str],
        checks: dict[str, object],
    ) -> dict[str, object]:
        pack_regressions = checks.get("pack_regressions") if isinstance(checks, dict) else {}
        pack_regressions = pack_regressions if isinstance(pack_regressions, dict) else {}

        def _passed(check_name: str) -> bool:
            check = checks.get(check_name) if isinstance(checks, dict) else None
            if not isinstance(check, dict):
                return False
            return bool(check.get("present")) and bool(check.get("current_passed")) and bool(check.get("candidate_passed"))

        check_status = {
            "turn_resolution_smoke": _passed("smoke"),
            "turn_resolution_failure_injection": _passed("failure_injection"),
            "shadow_replay": _passed("shadow_replay"),
            "shared_world_health": _passed("shared_world_health"),
        }
        for dataset_name in PACK_REGRESSION_DATASETS:
            check = pack_regressions.get(dataset_name)
            check_status[dataset_name] = (
                isinstance(check, dict)
                and bool(check.get("present"))
                and bool(check.get("current_passed"))
                and bool(check.get("candidate_passed"))
            )
        missing_or_failed = [name for name in PRODUCT_CUTOVER_REQUIRED_CHECKS if not check_status.get(name)]
        return {
            "promote_ready": verdict == "passed" and not missing_or_failed,
            "required_checks": PRODUCT_CUTOVER_REQUIRED_CHECKS,
            "missing_or_failed_checks": missing_or_failed,
            "blocked_reasons": blocked_reasons,
            "bundled_pack_regressions": PACK_REGRESSION_DATASETS,
            "manual_confirmation": "canary_promote_status == ready only when verdict == passed and all required checks pass",
        }

    @staticmethod
    def _runbook() -> dict[str, str]:
        return {
            "canary_up": "make canary-up",
            "canary_probe": "make canary-probe",
            "pre_promote_checklist": "make release-checklist",
            "nightly_gate": "make nightly-eval",
            "promote_condition": "verdict == passed and canary_promote_status == ready",
            "promote": "cp config/release/candidate.yaml config/release/current.yaml && docker compose up -d --build backend",
            "rollback": "make canary-down && docker compose up -d --build backend",
        }

    @staticmethod
    def _now():
        from datetime import datetime, timezone

        return datetime.now(timezone.utc)


def _pack_context_from_raw_output(raw_output: dict | None) -> dict[str, object] | None:
    pack_context = (raw_output or {}).get("pack_context")
    if not isinstance(pack_context, dict):
        return None
    required = {
        "world_id",
        "pack_id",
        "pack_display_name",
        "world_template_id",
        "world_template_display_name",
    }
    if not required <= set(pack_context):
        return None
    return {key: pack_context[key] for key in sorted(required)}


def _filter_release_checks(
    checks: dict[str, object],
    pack_id: str | None,
    world_template_id: str | None,
) -> dict[str, object]:
    if not pack_id and not world_template_id:
        return checks
    pack_regressions = checks.get("pack_regressions")
    filtered_pack_regressions = {
        dataset_name: check
        for dataset_name, check in (pack_regressions.items() if isinstance(pack_regressions, dict) else [])
        if isinstance(check, dict) and _pack_scope_matches(check.get("pack_scope"), pack_id, world_template_id)
    }
    return {
        **checks,
        "pack_regressions": filtered_pack_regressions,
    }


def _shared_world_health_check(health: object) -> dict[str, object]:
    payload = health if isinstance(health, dict) else {}
    passed = payload.get("status") == "ready"
    pack_scope = [
        {
            "pack_id": item.get("pack_id"),
            "pack_display_name": item.get("pack_display_name"),
            "world_template_id": item.get("world_template_id"),
            "world_template_display_name": item.get("world_template_display_name"),
        }
        for item in payload.get("worlds", [])
        if isinstance(item, dict)
    ]
    return {
        "present": bool(payload),
        "current_passed": passed,
        "candidate_passed": passed,
        "run_id": None,
        "status": payload.get("status"),
        "drift_count": payload.get("drift_count", 0),
        "axis_drift_count": payload.get("axis_drift_count", 0),
        "memory_gap_count": payload.get("memory_gap_count", 0),
        "event_integrity_gap_count": payload.get("event_integrity_gap_count", 0),
        "pack_scope": pack_scope,
    }


def _pack_scope_matches(
    pack_scope: object,
    pack_id: str | None,
    world_template_id: str | None,
) -> bool:
    if not pack_id and not world_template_id:
        return True
    if not isinstance(pack_scope, list):
        return False
    return any(
        _pack_context_matches(item if isinstance(item, dict) else None, pack_id, world_template_id)
        for item in pack_scope
    )


def _pack_context_matches(
    pack_context: dict[str, object] | None,
    pack_id: str | None,
    world_template_id: str | None,
) -> bool:
    if not pack_id and not world_template_id:
        return True
    if pack_context is None:
        return False
    if pack_id and pack_context.get("pack_id") != pack_id:
        return False
    if world_template_id and pack_context.get("world_template_id") != world_template_id:
        return False
    return True
