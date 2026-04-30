from __future__ import annotations

import os
import time
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select

from app.core.config import Settings
from app.core.prompts import PromptRegistry
from app.models.entities import (
    EvalCaseResult,
    EvalRun,
    Event,
    Memory,
    OutboxEvent,
    ReleaseGateReport,
    SPLedgerEntry,
    Turn,
    WorldAxisState,
)
from app.modules.eval_harness.cli import main as eval_cli_main
from app.modules.eval_harness.scheduler import run_once, seconds_until_next_run
from app.modules.eval_harness.service import EvalCaseInput, EvalHarnessService, ReleaseConfig
from app.modules.gm_council.service import GMCouncilService
from app.modules.graph_projection.service import ProjectionService
from app.modules.llm_harness.service import PromptRouteOverride
from app.modules.observability.service import CanaryProbeResult
from tests.backend.turn_async_helpers import post_turn_and_wait
from app.modules.world_pack.service import PackCatalogFailure, PackRegistry
from app.modules.world_memory.service import MemoryService


REPO_ROOT = next(parent for parent in Path(__file__).resolve().parents if (parent / "AGENTS.md").exists() and (parent / "backend").is_dir())


def engine_session_payload(*, world_id: str = "gestaloka_reference") -> dict[str, str]:
    return {
        "world_id": world_id,
        "world_name": "GESTALOKA: Nexus Foundation",
        "player_display_name": "Demo Player",
    }


def test_eval_dataset_validation_rejects_duplicate_case_ids(tmp_path: Path):
    dataset_dir = tmp_path / "datasets"
    dataset_dir.mkdir()
    for source_path in (REPO_ROOT / "evals" / "datasets").glob("*.yaml"):
        (dataset_dir / source_path.name).write_text(source_path.read_text(encoding="utf-8"), encoding="utf-8")
    (dataset_dir / "broken.yaml").write_text(
        "\n".join(
            [
                "dataset_id: broken_dataset",
                "prompt_id: session.turn_resolution",
                "expected_output_schema: council_turn_resolution_v1",
                "cases:",
                "  - case_id: duplicated",
                "    world_id: world-alpha",
                "    pack_id: gestaloka_reference",
                "    world_template_id: nexus_foundation",
                "    player_name: Demo Player",
                "    npc_name: Gate Steward Rikka",
                "    input_text: one",
                "  - case_id: duplicated",
                "    world_id: world-alpha",
                "    pack_id: gestaloka_reference",
                "    world_template_id: nexus_foundation",
                "    player_name: Demo Player",
                "    npc_name: Gate Steward Rikka",
                "    input_text: two",
            ]
        ),
        encoding="utf-8",
    )

    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'gestaloka.db'}",
        alembic_database_url=f"sqlite:///{tmp_path / 'gestaloka.db'}",
        prompt_dir=REPO_ROOT / "prompts",
        eval_dataset_dir=dataset_dir,
        release_config_dir=REPO_ROOT / "config" / "release",
        oidc_dev_mode=True,
        otel_metrics_port=0,
    )
    prompt_registry = PromptRegistry(settings.prompt_dir, settings.eval_dataset_dir)

    with pytest.raises(ValueError, match="duplicate case_id"):
        EvalHarnessService(settings, prompt_registry, ProjectionService(settings), MemoryService(settings))


def test_eval_runner_persists_current_and_candidate_results(container):
    with container.session_factory() as db:
        payload = container.eval_service.run_dataset(db, "turn_resolution_smoke")
        db.commit()
        runs = list(db.execute(select(EvalRun)).scalars())
        case_results = list(db.execute(select(EvalCaseResult)).scalars())

    assert payload["summary"]["variants"]["current"]["gate_passed"] is True
    assert payload["summary"]["variants"]["candidate"]["gate_passed"] is True
    assert len(runs) == 1
    assert runs[0].trigger_type == "manual"
    assert runs[0].runtime_role == "primary"
    assert runs[0].langfuse_trace_id
    assert runs[0].langfuse_trace_url == f"http://langfuse.test/project/gestaloka-v2/traces/{runs[0].langfuse_trace_id}"
    assert runs[0].langfuse_status == "ok"
    assert len(case_results) == payload["summary"]["case_count"] * 2
    assert {item.variant for item in case_results} == {"current", "candidate"}
    assert {
        (item.raw_output["pack_context"]["pack_id"], item.raw_output["pack_context"]["world_template_id"])
        for item in case_results
    } == {("gestaloka_reference", "nexus_foundation")}
    assert payload["langfuse_trace_url"] == runs[0].langfuse_trace_url
    with container.session_factory() as db:
        detail = container.eval_service.get_run_detail(db, runs[0].id)
    assert detail["results"][0]["pack_context"]["world_id"]
    eval_trace = next(
        item
        for item in container.observability_service.recent_trace_attributes(limit=200)
        if item["name"] == "eval.run"
    )
    assert eval_trace["attributes"]["eval.pack_ids"] == "gestaloka_reference"
    assert eval_trace["attributes"]["eval.world_template_ids"] == "nexus_foundation"


def test_eval_runner_reuses_identical_current_candidate_config(container, monkeypatch: pytest.MonkeyPatch):
    calls = 0
    original_resolve_turn = GMCouncilService.resolve_turn

    def counted_resolve_turn(self: GMCouncilService, request):  # type: ignore[no-untyped-def]
        nonlocal calls
        calls += 1
        return original_resolve_turn(self, request)

    monkeypatch.setattr(GMCouncilService, "resolve_turn", counted_resolve_turn)

    with container.session_factory() as db:
        payload = container.eval_service.run_dataset(db, "turn_resolution_smoke")
        db.commit()

    assert payload["summary"]["execution_mode"] == "single_config_reused"
    assert calls == payload["summary"]["case_count"]
    assert len(payload["results"]) == payload["summary"]["case_count"] * 2
    candidate_results = [item for item in payload["results"] if item["variant"] == "candidate"]
    assert candidate_results
    assert all(item["raw_output"]["variant_source"] == "current" for item in candidate_results)


def test_eval_runner_executes_both_variants_when_configs_differ(container, monkeypatch: pytest.MonkeyPatch):
    original_load_config = container.eval_service.load_release_config
    calls = 0
    original_resolve_turn = GMCouncilService.resolve_turn

    def different_candidate_hash(config_name: str) -> ReleaseConfig:
        config = original_load_config(config_name)
        if config_name != "candidate":
            return config
        routes = dict(config.routes)
        first_route_id = next(iter(routes))
        first_route = routes[first_route_id]
        routes[first_route_id] = PromptRouteOverride(
            prompt_id=first_route.prompt_id,
            default_lane="pro_lane" if first_route.default_lane != "pro_lane" else "main_lane",
            model_ids=first_route.model_ids,
        )
        return ReleaseConfig(
            name=config.name,
            source_path=config.source_path,
            content_hash=f"{config.content_hash}-changed",
            routes=routes,
        )

    def counted_resolve_turn(self: GMCouncilService, request):  # type: ignore[no-untyped-def]
        nonlocal calls
        calls += 1
        return original_resolve_turn(self, request)

    monkeypatch.setattr(container.eval_service, "load_release_config", different_candidate_hash)
    monkeypatch.setattr(GMCouncilService, "resolve_turn", counted_resolve_turn)

    with container.session_factory() as db:
        payload = container.eval_service.run_dataset(db, "turn_resolution_smoke")
        db.commit()

    assert payload["summary"]["execution_mode"] == "dual_config"
    assert calls == payload["summary"]["case_count"] * 2
    assert len(payload["results"]) == payload["summary"]["case_count"] * 2


def test_failure_injection_control_cases_do_not_call_live_provider(container):
    with container.session_factory() as db:
        payload = container.eval_service.run_dataset(db, "turn_resolution_failure_injection")
        db.commit()

    marker_results = [
        item
        for item in payload["results"]
        if "__force_invalid_main__" in str(item["raw_output"]["input_text"])
        or "__force_safety_reject__" in str(item["raw_output"]["input_text"])
    ]
    assert marker_results
    assert all(item["passed"] for item in marker_results)
    for item in marker_results:
        attempts = [
            attempt
            for role_run in item["raw_output"]["role_runs"]
            for attempt in role_run["attempts"]
        ]
        assert attempts
        assert {attempt["provider_name"] for attempt in attempts} == {"eval_control"}


def test_gestaloka_pack_regression_dataset_runs(container):
    with container.session_factory() as db:
        payload = container.eval_service.run_dataset(db, "turn_resolution_gestaloka_regression")
        db.commit()

    assert payload["summary"]["case_count"] == 2
    assert payload["summary"]["variants"]["current"]["gate_passed"] is True
    assert payload["summary"]["variants"]["candidate"]["gate_passed"] is True


def test_eval_cli_runs_named_dataset(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    calls: list[str] = []

    class FakeSession:
        def __enter__(self) -> "FakeSession":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def commit(self) -> None:
            return None

    class FakeEvalService:
        def run_dataset(self, db: FakeSession, dataset_name: str) -> dict[str, object]:
            calls.append(dataset_name)
            return {"dataset_name": dataset_name}

    class FakeContainer:
        eval_service = FakeEvalService()

        def session_factory(self) -> FakeSession:
            return FakeSession()

    monkeypatch.setenv("OTEL_METRICS_PORT", "9464")
    monkeypatch.setattr("app.modules.eval_harness.cli.build_container", lambda: FakeContainer())
    monkeypatch.setattr(
        "sys.argv",
        ["eval_harness", "dataset", "--dataset", "turn_resolution_gestaloka_regression"],
    )

    eval_cli_main()

    assert calls == ["turn_resolution_gestaloka_regression"]
    assert os.environ["OTEL_METRICS_PORT"] == "0"
    assert "turn_resolution_gestaloka_regression" in capsys.readouterr().out


def test_eval_cli_runs_pack_regressions_summary(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    calls: list[str] = []

    class FakeSession:
        def __enter__(self) -> "FakeSession":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def commit(self) -> None:
            return None

    class FakeEvalService:
        def run_dataset(self, db: FakeSession, dataset_name: str) -> dict[str, object]:
            calls.append(dataset_name)
            return {
                "id": f"run-{dataset_name}",
                "summary": {
                    "case_count": 1,
                    "pack_scope": [{"pack_id": dataset_name}],
                    "variants": {
                        "current": {"gate_passed": True, "failed_case_ids": []},
                        "candidate": {"gate_passed": True, "failed_case_ids": []},
                    },
                },
            }

    class FakeContainer:
        eval_service = FakeEvalService()

        def session_factory(self) -> FakeSession:
            return FakeSession()

    monkeypatch.setattr("app.modules.eval_harness.cli.build_container", lambda: FakeContainer())
    monkeypatch.setattr("sys.argv", ["eval_harness", "pack-regressions"])

    eval_cli_main()

    assert calls == ["turn_resolution_gestaloka_regression"]
    output = capsys.readouterr().out
    assert '"status": "passed"' in output
    assert "turn_resolution_gestaloka_regression" in output


def test_shadow_replay_does_not_mutate_canonical_world_tables(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()
    post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_text": "広場で灯をともす"},
    )

    with container.session_factory() as db:
        before = {
            "events": db.execute(select(func.count(Event.id))).scalar_one(),
            "memories": db.execute(select(func.count(Memory.id))).scalar_one(),
            "outbox": db.execute(select(func.count(OutboxEvent.id))).scalar_one(),
            "sp_ledger": db.execute(select(func.count(SPLedgerEntry.id))).scalar_one(),
        }
        payload = container.eval_service.run_shadow_replay(db, limit=3)
        db.commit()
        after = {
            "events": db.execute(select(func.count(Event.id))).scalar_one(),
            "memories": db.execute(select(func.count(Memory.id))).scalar_one(),
            "outbox": db.execute(select(func.count(OutboxEvent.id))).scalar_one(),
            "sp_ledger": db.execute(select(func.count(SPLedgerEntry.id))).scalar_one(),
            "eval_runs": db.execute(select(func.count(EvalRun.id))).scalar_one(),
            "eval_case_results": db.execute(select(func.count(EvalCaseResult.id))).scalar_one(),
        }

    assert payload["summary"]["variants"]["current"]["gate_passed"] is True
    assert before == {key: after[key] for key in before}
    assert after["eval_runs"] == 1
    assert after["eval_case_results"] >= 2


def test_release_configs_and_runtime_defaults_use_openai_compatible_fallbacks(container):
    assert Settings.model_fields["model_provider"].default == "openai_compatible"
    assert Settings.model_fields["embedding_provider"].default == "openai_compatible"
    assert Settings.model_fields["model_lite_id"].default == ""
    assert Settings.model_fields["model_main_id"].default == ""
    assert Settings.model_fields["model_pro_id"].default == ""

    for config_name in ("current", "candidate"):
        config = container.eval_service.load_release_config(config_name)
        router = container.eval_service.router_for_config(config_name)
        for route in config.routes.values():
            assert route.model_ids == {}
            assert router._model_id_for_lane("lite_lane", route) == "test-lite-model"
            assert router._model_id_for_lane("main_lane", route) == "test-main-model"
            assert router._model_id_for_lane("pro_lane", route) == "test-pro-model"


def test_shadow_replay_filters_deterministic_turns_and_uses_source_event_location(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    for _ in range(2):
        post_turn_and_wait(
            client,
            session_id=session_payload["session_id"],
            auth_headers=auth_headers,
            payload={"input_mode": "choice", "choice_id": "progress"},
        )

    _, use_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )
    assert use_payload["action_type"] == "use_reward_item"

    _, travel_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )
    assert travel_payload["action_type"] == "travel"

    with container.session_factory() as db:
        cases = container.eval_service._shadow_replay_cases(db, limit=10)
        source_turn_ids = {case.source_turn_id for case in cases if case.source_turn_id}
        source_turns = list(db.execute(select(Turn).where(Turn.id.in_(source_turn_ids))).scalars())

    assert source_turns
    assert all(turn.action_type == "narrative" for turn in source_turns)
    assert all(turn.resolution_mode == "gm_council" for turn in source_turns)
    assert not any(turn.action_type in {"use_reward_item", "travel", "system"} for turn in source_turns)
    assert any("location=Nexus Gate" in line for case in cases for line in case.relation_context)
    assert not any("location=Oblivion Breach" in line for case in cases for line in case.relation_context)


def test_release_gate_reports_latest_smoke_failure_and_shadow_runs(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()
    post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_text": "広場で灯をともす"},
    )

    container.observability_service.probe_canary_health = lambda: CanaryProbeResult(  # type: ignore[method-assign]
        status="healthy",
        url="http://backend-canary:8000/health",
        http_status=200,
        detail="ok",
        graph_runtime_status="ready",
        release_gate_verdict="passed",
        projection_lag_seconds=0.0,
        outbox_pending_count=0,
        outbox_failed_count=0,
        llm_schema_valid_rate=1.0,
        llm_fallback_rate=0.0,
    )

    with container.session_factory() as db:
        gate = container.eval_service.run_release_checklist(db, trigger_type="manual", shadow_limit=3)
        db.commit()
        report_count = db.execute(select(func.count(ReleaseGateReport.id))).scalar_one()
        shadow_result = db.execute(
            select(EvalCaseResult)
            .where(EvalCaseResult.eval_run_id == gate["runs"]["shadow_replay"])
            .order_by(EvalCaseResult.case_id.asc(), EvalCaseResult.variant.asc())
            .limit(1)
        ).scalar_one()
        shadow_result.passed = False
        shadow_result.graph_context_status = "degraded"
        db.flush()
        gate_with_failure = container.eval_service.latest_release_checklist(db)

    assert gate["verdict"] == "passed"
    assert gate["checks"]["smoke"]["candidate_passed"] is True
    assert gate["checks"]["failure_injection"]["candidate_passed"] is True
    assert gate["checks"]["shadow_replay"]["candidate_passed"] is True
    assert gate["canary_promote_status"] == "ready"
    assert gate["cutover_status"]["promote_ready"] is True
    assert gate["cutover_status"]["missing_or_failed_checks"] == []
    assert gate["cutover_status"]["required_checks"] == [
        "turn_resolution_smoke",
        "turn_resolution_failure_injection",
        "shadow_replay",
        "shared_world_health",
        "turn_resolution_gestaloka_regression",
    ]
    assert gate["runbook"]["canary_up"] == "make canary-up"
    assert gate["runbook"]["canary_probe"] == "make canary-probe"
    assert gate["runbook"]["pre_promote_checklist"] == "make release-checklist"
    assert gate["runbook"]["nightly_gate"] == "make nightly-eval"
    assert gate["runbook"]["promote_condition"] == "verdict == passed and canary_promote_status == ready"
    assert gate["langfuse_trace_id"]
    assert gate["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")
    assert gate["langfuse_status"] == "ok"
    assert gate["diff_summary"] == []
    check_map = {item["check_id"]: item for item in gate["check_summaries"]}
    assert check_map["turn_resolution_smoke"]["execution_mode"] == "single_config_reused"
    assert check_map["turn_resolution_smoke"]["case_count"] == 2
    assert check_map["turn_resolution_smoke"]["timeout_seconds"] >= 0
    assert report_count == 1
    progress = container.eval_service.release_checklist_progress()
    assert progress["status"] == "completed"
    assert progress["completed_report_id"] == gate["report_id"]
    assert progress["elapsed_seconds"] >= 0
    assert gate_with_failure["shadow_failures"]
    assert gate_with_failure["shadow_failures"][0]["pack_context"]["pack_id"] == "gestaloka_reference"
    assert gate_with_failure["shadow_failures"][0]["pack_context"]["world_template_display_name"] == "Nexus Foundation"
    assert gate_with_failure["shadow_failures"][0]["retrieval_required"] in {True, False}
    assert "graph" in gate_with_failure["shadow_failures"][0]["failure_categories"]
    assert gate_with_failure["shadow_failures"][0]["failure_diagnostics"]


def test_release_checklist_timeout_creates_blocked_report(container, monkeypatch: pytest.MonkeyPatch):
    container.settings.release_check_timeout_seconds = 0.001
    container.settings.release_check_total_budget_seconds = 0.001
    container.observability_service.probe_canary_health = lambda: CanaryProbeResult(  # type: ignore[method-assign]
        status="healthy",
        url="http://backend-canary:8000/health",
        http_status=200,
        detail="ok",
        graph_runtime_status="ready",
        release_gate_verdict="passed",
        projection_lag_seconds=0.0,
        outbox_pending_count=0,
        outbox_failed_count=0,
        llm_schema_valid_rate=1.0,
        llm_fallback_rate=0.0,
    )
    original_run_dataset = container.eval_service.run_dataset

    def slow_run_dataset(db, dataset_name: str, **kwargs):
        if dataset_name == "turn_resolution_smoke":
            time.sleep(0.01)
        return original_run_dataset(db, dataset_name, **kwargs)

    monkeypatch.setattr(container.eval_service, "run_dataset", slow_run_dataset)

    with container.session_factory() as db:
        gate = container.eval_service.run_release_checklist(db, trigger_type="manual", shadow_limit=1)
        db.commit()
        smoke_run = db.execute(select(EvalRun).where(EvalRun.id == gate["runs"]["smoke"])).scalar_one()
        report_count = db.execute(select(func.count(ReleaseGateReport.id))).scalar_one()

    assert gate["verdict"] == "blocked"
    assert smoke_run.status == "timeout"
    assert any("turn_resolution_smoke" in reason for reason in gate["blocked_reasons"])
    check_map = {item["check_id"]: item for item in gate["check_summaries"]}
    assert check_map["turn_resolution_smoke"]["status"] == "timeout"
    assert check_map["slo_canary_snapshot"]["status"] == "passed"
    assert check_map["slo_canary_snapshot"]["reason"] is None
    assert gate["slo_snapshot"]["canary_health"]["status"] == "healthy"
    assert report_count == 1
    progress = container.eval_service.release_checklist_progress()
    assert progress["status"] == "completed"
    assert progress["completed_report_id"] == gate["report_id"]


def test_domain_eval_reads_consequence_tags_from_interpreted_intent(container):
    case = EvalCaseInput(
        case_id="interpreted-intent-consequence-tags",
        prompt_id="session.turn_resolution",
        world_id="gestaloka_reference",
        pack_id="gestaloka_reference",
        world_template_id="nexus_foundation",
        player_name="Demo Player",
        npc_name="Gate Steward Rikka",
        input_text="help the traveler",
        relevant_memories=[],
        relation_context=[],
        graph_context_status="ready",
        expect_success=True,
        expect_final_lane="main",
        expect_fallback=False,
        expect_failure_reason=None,
        expect_consequence_tags=["earned_trust"],
    )

    result = container.eval_service._evaluate_domain_case(
        case,
        {
            "consequence_tags": ["invalid_tag"],
            "interpreted_intent": {
                "consequence_tags": ["earned_trust", "invalid_tag"],
            },
        },
    )

    assert result["passed"] is True
    assert result["checks"]["consequence_tags_match"] is True
    assert result["actual_consequence_tags"] == ["earned_trust"]


def test_manual_release_uses_bounded_live_defaults(container):
    container.settings.release_check_timeout_seconds = 180.0
    container.settings.release_check_total_budget_seconds = 540.0
    container.settings.release_shadow_limit = 5

    assert container.eval_service._release_check_timeout_seconds("manual", container.settings.release_check_timeout_seconds) == 300.0
    assert container.eval_service._release_total_budget_seconds("manual", container.settings.release_check_total_budget_seconds) == 900.0
    assert container.eval_service._release_shadow_limit("manual") == 1
    assert container.eval_service._release_shadow_limit("nightly") == 5


def test_release_checklist_total_budget_synthesizes_remaining_timeouts(container, monkeypatch: pytest.MonkeyPatch):
    container.settings.release_check_timeout_seconds = 180.0
    container.settings.release_check_total_budget_seconds = 0.001
    container.observability_service.probe_canary_health = lambda: CanaryProbeResult(  # type: ignore[method-assign]
        status="healthy",
        url="http://backend-canary:8000/health",
        http_status=200,
        detail="ok",
        graph_runtime_status="ready",
        release_gate_verdict="passed",
        projection_lag_seconds=0.0,
        outbox_pending_count=0,
        outbox_failed_count=0,
        llm_schema_valid_rate=1.0,
        llm_fallback_rate=0.0,
    )
    original_run_dataset = container.eval_service.run_dataset

    def slow_smoke(db, dataset_name: str, **kwargs):
        if dataset_name == "turn_resolution_smoke":
            time.sleep(0.01)
        return original_run_dataset(db, dataset_name, **kwargs)

    monkeypatch.setattr(container.eval_service, "run_dataset", slow_smoke)

    with container.session_factory() as db:
        gate = container.eval_service.run_release_checklist(db, trigger_type="manual", shadow_limit=1)
        db.commit()
        pack_run_id = gate["runs"]["pack_regressions"]["turn_resolution_gestaloka_regression"]
        pack_run = db.execute(select(EvalRun).where(EvalRun.id == pack_run_id)).scalar_one()

    assert gate["verdict"] == "blocked"
    assert pack_run.status == "timeout"
    assert any("budget was exhausted" in reason for reason in gate["blocked_reasons"])
    check_map = {item["check_id"]: item for item in gate["check_summaries"]}
    assert check_map["turn_resolution_smoke"]["status"] == "timeout"
    assert check_map["pack_regression:turn_resolution_gestaloka_regression"]["status"] == "timeout"
    assert "budget was exhausted" in check_map["pack_regression:turn_resolution_gestaloka_regression"]["reason"]
    assert check_map["slo_canary_snapshot"]["status"] == "passed"
    assert check_map["slo_canary_snapshot"]["reason"] is None
    assert gate["slo_snapshot"]["canary_health"]["status"] == "healthy"


def test_release_gate_blocks_when_canary_is_unhealthy(container):
    container.observability_service.probe_canary_health = lambda: CanaryProbeResult(  # type: ignore[method-assign]
        status="unhealthy",
        url="http://backend-canary:8000/health",
        http_status=503,
        detail="down",
    )

    with container.session_factory() as db:
        gate = container.eval_service.run_release_checklist(db, trigger_type="manual", shadow_limit=1)
        db.commit()

    assert gate["verdict"] == "blocked"
    assert "canary health != healthy" in gate["blocked_reasons"]
    assert gate["cutover_status"]["promote_ready"] is False
    assert gate["cutover_status"]["missing_or_failed_checks"] == []
    assert gate["cutover_status"]["blocked_reasons"] == ["canary health != healthy"]
    assert set(gate["checks"]["pack_regressions"]) == {"turn_resolution_gestaloka_regression"}
    assert all(item["current_passed"] and item["candidate_passed"] for item in gate["checks"]["pack_regressions"].values())
    assert set(gate["runs"]["pack_regressions"]) == {"turn_resolution_gestaloka_regression"}


def test_release_gate_blocks_when_pack_catalog_is_degraded(container):
    degraded_registry = PackRegistry(container.settings.pack_dir)
    degraded_registry.failures.append(
        PackCatalogFailure(
            error="pack_id_mismatch",
            message="external pack failed validation",
            severity="error",
            pack_id="broken_pack",
            path="/external/packs/broken_pack/pack.yaml",
        )
    )
    container.pack_registry = degraded_registry
    container.eval_service.pack_registry = degraded_registry
    container.observability_service.probe_canary_health = lambda: CanaryProbeResult(  # type: ignore[method-assign]
        status="healthy",
        url="http://backend-canary:8000/health",
        http_status=200,
        detail="ok",
    )

    with container.session_factory() as db:
        gate = container.eval_service.run_release_checklist(db, trigger_type="manual", shadow_limit=1)
        db.commit()

    assert gate["verdict"] == "blocked"
    assert "world pack catalog != ready" in gate["blocked_reasons"]
    assert gate["slo_snapshot"]["world_packs"]["status"] == "degraded"
    assert gate["slo_snapshot"]["world_packs"]["failure_count"] == 1
    assert gate["cutover_status"]["promote_ready"] is False


def test_release_gate_blocks_on_shared_world_axis_drift(client, container, auth_headers):
    container.observability_service.probe_canary_health = lambda: CanaryProbeResult(  # type: ignore[method-assign]
        status="healthy",
        url="http://backend-canary:8000/health",
        http_status=200,
        detail="ok",
    )
    session_response = client.post("/sessions", json=engine_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()
    post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )

    with container.session_factory() as db:
        axis = db.execute(
            select(WorldAxisState).where(
                WorldAxisState.world_id == "gestaloka_reference",
                WorldAxisState.axis_id == "archive_integrity",
            )
        ).scalar_one()
        axis.current_value = axis.current_value + 1
        gate = container.eval_service.run_release_checklist(db, trigger_type="manual", shadow_limit=3)
        db.commit()

    assert gate["verdict"] == "blocked"
    assert "shared world health != ready" in gate["blocked_reasons"]
    assert gate["slo_snapshot"]["shared_world_health"]["axis_drift_count"] == 1
    assert gate["cutover_status"]["promote_ready"] is False
    assert "shared_world_health" in gate["cutover_status"]["missing_or_failed_checks"]


def test_release_gate_blocks_on_shared_world_memory_gap(client, container, auth_headers):
    container.observability_service.probe_canary_health = lambda: CanaryProbeResult(  # type: ignore[method-assign]
        status="healthy",
        url="http://backend-canary:8000/health",
        http_status=200,
        detail="ok",
    )
    session_response = client.post("/sessions", json=engine_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()
    _, turn_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )
    event_id = turn_payload["event_id"]

    with container.session_factory() as db:
        db.execute(delete(Memory).where(Memory.world_id == "gestaloka_reference", Memory.source_event_id == event_id))
        gate = container.eval_service.run_release_checklist(db, trigger_type="manual", shadow_limit=3)
        db.commit()

    assert gate["verdict"] == "blocked"
    assert "shared world health != ready" in gate["blocked_reasons"]
    assert gate["slo_snapshot"]["shared_world_health"]["memory_gap_count"] >= 1
    assert gate["cutover_status"]["promote_ready"] is False


def test_release_gate_blocks_on_cross_world_shared_event_link(client, container, auth_headers):
    container.observability_service.probe_canary_health = lambda: CanaryProbeResult(  # type: ignore[method-assign]
        status="healthy",
        url="http://backend-canary:8000/health",
        http_status=200,
        detail="ok",
    )
    reference_session = client.post("/sessions", json=engine_session_payload(), headers=auth_headers)
    assert reference_session.status_code == 200
    reference_payload = reference_session.json()
    _, reference_turn_payload, _ = post_turn_and_wait(
        client,
        session_id=reference_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )
    with container.session_factory() as db:
        memory = db.execute(
            select(Memory).where(
                Memory.world_id == "gestaloka_reference",
                Memory.source_event_id == reference_turn_payload["event_id"],
            )
        ).scalars().first()
        assert memory is not None
        memory_id = memory.id
        alt_event_id = str(uuid4())

    engine = container.session_factory.kw["bind"]
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        conn.exec_driver_sql(
            """
            INSERT INTO worlds (id, name, status, state, created_at, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                "alternate_reference_world",
                "GESTALOKA: Nexus Foundation Alt",
                "active",
                '{"pack_id": "gestaloka_reference", "world_template_id": "nexus_foundation"}',
            ),
        )
        conn.exec_driver_sql(
            """
            INSERT INTO events (
                id, world_id, session_id, turn_id, event_type, source_actor_id,
                location_id, payload, narrative, occurred_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                alt_event_id,
                "alternate_reference_world",
                reference_payload["session_id"],
                reference_turn_payload["turn_id"],
                "player.turn.resolved",
                reference_payload["player_actor_id"],
                None,
                '{"world_tags": ["aid_local"]}',
                "Cross-world integrity fixture.",
            ),
        )
        conn.exec_driver_sql(
            "UPDATE memories SET source_event_id = ? WHERE id = ?",
            (alt_event_id, memory_id),
        )
        conn.commit()
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")

    with container.session_factory() as db:
        gate = container.eval_service.run_release_checklist(db, trigger_type="manual", shadow_limit=3)
        db.commit()

    assert gate["verdict"] == "blocked"
    assert "shared world health != ready" in gate["blocked_reasons"]
    assert gate["slo_snapshot"]["shared_world_health"]["event_integrity_gap_count"] >= 1


def test_scheduler_helpers_only_persist_eval_and_release_tables(client, container, auth_headers, monkeypatch):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()
    post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_text": "広場で灯をともす"},
    )

    container.observability_service.probe_canary_health = lambda: CanaryProbeResult(  # type: ignore[method-assign]
        status="healthy",
        url="http://backend-canary:8000/health",
        http_status=200,
        detail="ok",
    )

    with container.session_factory() as db:
        before = {
            "events": db.execute(select(func.count(Event.id))).scalar_one(),
            "memories": db.execute(select(func.count(Memory.id))).scalar_one(),
            "outbox": db.execute(select(func.count(OutboxEvent.id))).scalar_one(),
            "sp_ledger": db.execute(select(func.count(SPLedgerEntry.id))).scalar_one(),
        }

    container.settings.release_scheduler_cron = "0 3 * * *"
    monkeypatch.setattr("app.modules.eval_harness.scheduler.build_container", lambda: container)
    payload = run_once(trigger_type="nightly", shadow_limit=2)

    with container.session_factory() as db:
        after = {
            "events": db.execute(select(func.count(Event.id))).scalar_one(),
            "memories": db.execute(select(func.count(Memory.id))).scalar_one(),
            "outbox": db.execute(select(func.count(OutboxEvent.id))).scalar_one(),
            "sp_ledger": db.execute(select(func.count(SPLedgerEntry.id))).scalar_one(),
            "eval_runs": db.execute(select(func.count(EvalRun.id))).scalar_one(),
            "eval_case_results": db.execute(select(func.count(EvalCaseResult.id))).scalar_one(),
            "release_gate_reports": db.execute(select(func.count(ReleaseGateReport.id))).scalar_one(),
        }

    assert payload["trigger_type"] == "nightly"
    assert before == {key: after[key] for key in before}
    assert after["eval_runs"] == 4
    assert after["release_gate_reports"] == 1
    assert seconds_until_next_run("0 3 * * *") >= 0.0


def test_langfuse_flush_failure_degrades_but_does_not_fail_turn(client, container, auth_headers):
    fake_client = container.observability_service._langfuse_client
    fake_client.raise_on_flush = True

    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )

    council_turns = client.get(
        f"/ops/council/turns?session_id={session_payload['session_id']}",
        headers=auth_headers,
    ).json()["items"]
    assert council_turns[0]["langfuse_status"] == "degraded"
    assert council_turns[0]["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")

    fake_client.raise_on_flush = False
