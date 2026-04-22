from __future__ import annotations

import hashlib
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import yaml
from sqlalchemy import func, select
from sqlalchemy.orm import Session

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
    Turn,
)
from app.modules.graph_projection.service import ProjectionService
from app.modules.llm_harness.service import ModelRouter, PromptRouteOverride, TurnResolutionOutcome
from app.modules.observability.service import CanaryProbeResult, ObservabilityService
from app.modules.world_memory.service import search_memories


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
    source_turn_id: str | None = None


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
        observability_service: ObservabilityService | None = None,
    ) -> None:
        self.settings = settings
        self.prompt_registry = prompt_registry
        self.projection_service = projection_service
        self.observability_service = observability_service
        self.datasets = self._load_datasets(settings.eval_dataset_dir)

    def router_for_config(self, config_name: str) -> ModelRouter:
        release_config = self.load_release_config(config_name)
        return ModelRouter(
            self.settings,
            self.prompt_registry,
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
                    "failure_reason": item.failure_reason,
                }
                for item in shadow_results
                if not item.passed or item.graph_context_status != "ready"
            ],
            "runbook": self._runbook(),
            "created_at": report.created_at.isoformat(),
            "canary_promote_status": "ready" if report.verdict == "passed" else "blocked",
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

        if self.observability_service is not None:
            self.observability_service.record_eval_run(
                eval_run_id=run.id,
                dataset_name=dataset_name,
                trigger_type=trigger_type,
                runtime_role=runtime_role,
            )

        routers = {
            "current": ModelRouter(
                self.settings,
                self.prompt_registry,
                route_overrides=current_config.routes,
                config_name=current_config.name,
                observability_service=self.observability_service,
            ),
            "candidate": ModelRouter(
                self.settings,
                self.prompt_registry,
                route_overrides=candidate_config.routes,
                config_name=candidate_config.name,
                observability_service=self.observability_service,
            ),
        }

        case_payloads: list[dict[str, object]] = []
        for variant, router in routers.items():
            for case in cases:
                outcome = router.resolve_turn(
                    world_id=case.world_id,
                    turn_id=case.source_turn_id,
                    player_name=case.player_name,
                    npc_name=case.npc_name,
                    input_text=case.input_text,
                    relevant_memories=case.relevant_memories,
                    relation_context=case.relation_context,
                    graph_context_status=case.graph_context_status,
                    prompt_id=case.prompt_id,
                )
                payload = self._persist_case_result(
                    db,
                    run_id=run.id,
                    variant=variant,
                    case=case,
                    outcome=outcome,
                )
                case_payloads.append(payload)

        run.summary = self._build_run_summary(source_type, dataset_name, cases, case_payloads)
        run.status = "completed"
        run.completed_at = run.updated_at
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
    ) -> dict[str, object]:
        final_attempt = outcome.attempts[-1]
        final_payload = outcome.final_payload.model_dump() if outcome.final_payload is not None else None
        used_fallback = len(outcome.attempts) > 1
        schema_valid = outcome.succeeded
        same_world_invariant = bool(
            final_payload is not None and final_payload.get("event_payload", {}).get("world_id") == case.world_id
        )
        passed = self._case_passed(case, outcome, schema_valid=schema_valid, same_world_invariant=same_world_invariant)
        raw_output = {
            "source_turn_id": case.source_turn_id,
            "input_text": case.input_text,
            "relevant_memories": case.relevant_memories,
            "relation_context": case.relation_context,
            "attempts": [
                {
                    "prompt_id": attempt.prompt_id,
                    "schema_version": attempt.schema_version,
                    "model_lane": attempt.model_lane,
                    "model_id": attempt.model_id,
                    "status": attempt.status,
                    "output_schema_status": attempt.output_schema_status,
                    "output_payload": attempt.output_payload,
                }
                for attempt in outcome.attempts
            ],
            "final_payload": final_payload,
            "failure_reason": outcome.failure_reason,
        }
        result = EvalCaseResult(
            eval_run_id=run_id,
            variant=variant,
            case_id=case.case_id,
            prompt_id=final_attempt.prompt_id,
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
    ) -> bool:
        used_fallback = len(outcome.attempts) > 1
        if case.expect_success:
            return (
                outcome.succeeded
                and schema_valid
                and same_world_invariant
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
                item["passed"] and item["schema_valid"] and item["same_world_invariant"] and item["graph_context_status"] == "ready"
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
        fallback_turns = int(
            db.execute(
                select(func.count())
                .select_from(
                    select(LLMRun.turn_id)
                    .group_by(LLMRun.turn_id)
                    .having(func.count(LLMRun.id) > 1)
                    .subquery()
                )
            ).scalar_one()
        )

        snapshot = {
            "runtime_role": runtime_role,
            "canary_health": canary_probe.__dict__,
            "projection_lag_seconds": projection_lag_seconds,
            "outbox_pending_count": pending_outbox_count,
            "outbox_failed_count": failed_outbox_count,
            "llm_schema_valid_rate": (llm_valid / llm_total) if llm_total else 0.0,
            "llm_fallback_rate": (fallback_turns / turn_count) if turn_count else 0.0,
        }
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
            player_actor = db.execute(
                select(Actor).where(Actor.id == session.player_actor_id, Actor.world_id == turn.world_id)
            ).scalar_one_or_none()
            npc_actor = db.execute(
                select(Actor)
                .where(Actor.world_id == turn.world_id, Actor.actor_type == "npc")
                .order_by(Actor.created_at.asc(), Actor.id.asc())
            ).scalar_one_or_none()
            if player_actor is None or npc_actor is None:
                continue
            relevant_memories = [
                item.text for item in search_memories(db, world_id=turn.world_id, query=turn.input_text, actor_id=npc_actor.id)
            ]
            graph_context = self.projection_service.resolve_relation_context(
                db,
                world_id=turn.world_id,
                primary_actor_id=npc_actor.id,
                counterpart_actor_id=player_actor.id,
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
                    relevant_memories=relevant_memories,
                    relation_context=graph_context.context.prompt_lines(),
                    graph_context_status=graph_context.status,
                    expect_success=True,
                    expect_final_lane=turn.model_lane,
                    expect_fallback=turn.model_lane == "pro_lane",
                    expect_failure_reason=None,
                    source_turn_id=turn.id,
                )
            )
            if len(cases) >= limit:
                break
        return cases

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
