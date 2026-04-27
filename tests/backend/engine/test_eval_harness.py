from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import delete, func, select

from app.core.config import Settings
from app.core.prompts import PromptRegistry
from app.models.entities import EvalCaseResult, EvalRun, Event, Memory, OutboxEvent, ReleaseGateReport, SPLedgerEntry, WorldAxisState
from app.modules.eval_harness.service import EvalHarnessService
from app.modules.eval_harness.cli import main as eval_cli_main
from app.modules.eval_harness.scheduler import run_once, seconds_until_next_run
from app.modules.graph_projection.service import ProjectionService
from app.modules.observability.service import CanaryProbeResult
from app.modules.world_pack.service import PackCatalogFailure, PackRegistry
from app.modules.world_memory.service import MemoryService


REPO_ROOT = next(parent for parent in Path(__file__).resolve().parents if (parent / "rebuild_plan_v2.md").exists())


def engine_session_payload(*, world_id: str = "ember_harbor") -> dict[str, str]:
    return {
        "world_id": world_id,
        "world_name": "Ember Harbor",
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
                "    pack_id: ember_harbor",
                "    world_template_id: ember_harbor",
                "    player_name: Demo Player",
                "    npc_name: Runner Eska",
                "    input_text: one",
                "  - case_id: duplicated",
                "    world_id: world-alpha",
                "    pack_id: ember_harbor",
                "    world_template_id: ember_harbor",
                "    player_name: Demo Player",
                "    npc_name: Runner Eska",
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
    } == {("ember_harbor", "ember_harbor"), ("founders_reach", "founders_reach")}
    assert payload["langfuse_trace_url"] == runs[0].langfuse_trace_url
    with container.session_factory() as db:
        detail = container.eval_service.get_run_detail(db, runs[0].id)
    assert detail["results"][0]["pack_context"]["world_id"]
    eval_trace = next(
        item
        for item in container.observability_service.recent_trace_attributes(limit=200)
        if item["name"] == "eval.run"
    )
    assert eval_trace["attributes"]["eval.pack_ids"] == "ember_harbor,founders_reach"
    assert eval_trace["attributes"]["eval.world_template_ids"] == "ember_harbor,founders_reach"


def test_ember_pack_regression_dataset_runs(container):
    with container.session_factory() as db:
        payload = container.eval_service.run_dataset(db, "turn_resolution_ember_regression")
        db.commit()

    assert payload["summary"]["case_count"] == 3
    assert payload["summary"]["variants"]["current"]["gate_passed"] is True
    assert payload["summary"]["variants"]["candidate"]["gate_passed"] is True


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

    monkeypatch.setattr("app.modules.eval_harness.cli.build_container", lambda: FakeContainer())
    monkeypatch.setattr(
        "sys.argv",
        ["eval_harness", "dataset", "--dataset", "turn_resolution_founders_regression"],
    )

    eval_cli_main()

    assert calls == ["turn_resolution_founders_regression"]
    assert "turn_resolution_founders_regression" in capsys.readouterr().out


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

    assert calls == [
        "turn_resolution_founders_regression",
        "turn_resolution_ember_regression",
        "turn_resolution_gestaloka_regression",
    ]
    output = capsys.readouterr().out
    assert '"status": "passed"' in output
    assert "turn_resolution_founders_regression" in output
    assert "turn_resolution_ember_regression" in output
    assert "turn_resolution_gestaloka_regression" in output


def test_shadow_replay_does_not_mutate_canonical_world_tables(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()
    first_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場で灯をともす"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200

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


def test_release_gate_reports_latest_smoke_failure_and_shadow_runs(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()
    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場で灯をともす"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200

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
        "turn_resolution_founders_regression",
        "turn_resolution_ember_regression",
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
    assert {item["route_id"] for item in gate["diff_summary"]} == {
        "ambient.memory_manager",
        "ambient.npc_manager",
        "ambient.safety_guard",
        "idle.memory_manager",
        "idle.npc_manager",
        "idle.safety_guard",
        "council.world_progress",
        "council.rules_arbiter",
        "council.safety_guard",
        "council.narrative",
    }
    assert report_count == 1
    assert gate_with_failure["shadow_failures"]
    assert gate_with_failure["shadow_failures"][0]["pack_context"]["pack_id"] == "ember_harbor"
    assert gate_with_failure["shadow_failures"][0]["pack_context"]["world_template_display_name"] == "Ember Harbor"


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
    assert gate["cutover_status"]["missing_or_failed_checks"] == ["shadow_replay"]
    assert gate["cutover_status"]["blocked_reasons"] == ["shadow replay gate failed", "canary health != healthy"]
    assert set(gate["checks"]["pack_regressions"]) == {
        "turn_resolution_founders_regression",
        "turn_resolution_ember_regression",
        "turn_resolution_gestaloka_regression",
    }
    assert all(item["current_passed"] and item["candidate_passed"] for item in gate["checks"]["pack_regressions"].values())
    assert set(gate["runs"]["pack_regressions"]) == {
        "turn_resolution_founders_regression",
        "turn_resolution_ember_regression",
        "turn_resolution_gestaloka_regression",
    }


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
    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200

    with container.session_factory() as db:
        axis = db.execute(
            select(WorldAxisState).where(
                WorldAxisState.world_id == "ember_harbor",
                WorldAxisState.axis_id == "harbor_stability",
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
    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200
    event_id = turn_response.json()["event_id"]

    with container.session_factory() as db:
        db.execute(delete(Memory).where(Memory.world_id == "ember_harbor", Memory.source_event_id == event_id))
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
    ember_session = client.post("/sessions", json=engine_session_payload(), headers=auth_headers)
    assert ember_session.status_code == 200
    ember_payload = ember_session.json()
    ember_turn = client.post(
        "/turns",
        json={"session_id": ember_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert ember_turn.status_code == 200
    founders_session = client.post(
        "/sessions",
        json={
            "world_id": "founders_reach",
            "pack_id": "founders_reach",
            "world_template_id": "founders_reach",
            "world_name": "Founders Reach",
        },
        headers=auth_headers,
    )
    assert founders_session.status_code == 200
    founders_turn = client.post(
        "/turns",
        json={"session_id": founders_session.json()["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert founders_turn.status_code == 200

    with container.session_factory() as db:
        memory = db.execute(
            select(Memory).where(
                Memory.world_id == "ember_harbor",
                Memory.source_event_id == ember_turn.json()["event_id"],
            )
        ).scalars().first()
        assert memory is not None

    engine = container.session_factory.kw["bind"]
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        conn.exec_driver_sql(
            "UPDATE memories SET source_event_id = ? WHERE id = ?",
            (founders_turn.json()["event_id"], memory.id),
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
    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場で灯をともす"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200

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
    assert after["eval_runs"] == 6
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

    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )

    assert turn_response.status_code == 200

    council_turns = client.get(
        f"/ops/council/turns?session_id={session_payload['session_id']}",
        headers=auth_headers,
    ).json()["items"]
    assert council_turns[0]["langfuse_status"] == "degraded"
    assert council_turns[0]["langfuse_trace_url"].startswith("http://langfuse.test/project/gestaloka-v2/traces/")

    fake_client.raise_on_flush = False
