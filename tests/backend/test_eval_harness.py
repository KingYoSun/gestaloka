from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.core.config import Settings
from app.core.prompts import PromptRegistry
from app.models.entities import EvalCaseResult, EvalRun, Event, Memory, OutboxEvent, SPLedgerEntry
from app.modules.eval_harness.service import EvalHarnessService
from app.modules.graph_projection.service import ProjectionService


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_eval_dataset_validation_rejects_duplicate_case_ids(tmp_path: Path):
    dataset_dir = tmp_path / "datasets"
    dataset_dir.mkdir()
    smoke_source = REPO_ROOT / "evals" / "datasets" / "turn_resolution_smoke.yaml"
    (dataset_dir / "turn_resolution_smoke.yaml").write_text(smoke_source.read_text(encoding="utf-8"), encoding="utf-8")
    (dataset_dir / "broken.yaml").write_text(
        "\n".join(
            [
                "dataset_id: broken_dataset",
                "prompt_id: session.turn_resolution",
                "expected_output_schema: turn_resolution_v1",
                "cases:",
                "  - case_id: duplicated",
                "    world_id: world-alpha",
                "    player_name: Demo Player",
                "    npc_name: Archivist Nera",
                "    input_text: one",
                "  - case_id: duplicated",
                "    world_id: world-alpha",
                "    player_name: Demo Player",
                "    npc_name: Archivist Nera",
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
    )
    prompt_registry = PromptRegistry(settings.prompt_dir, settings.eval_dataset_dir)

    with pytest.raises(ValueError, match="duplicate case_id"):
        EvalHarnessService(settings, prompt_registry, ProjectionService(settings))


def test_eval_runner_persists_current_and_candidate_results(container):
    with container.session_factory() as db:
        payload = container.eval_service.run_dataset(db, "turn_resolution_smoke")
        db.commit()
        runs = list(db.execute(select(EvalRun)).scalars())
        case_results = list(db.execute(select(EvalCaseResult)).scalars())

    assert payload["summary"]["variants"]["current"]["gate_passed"] is True
    assert payload["summary"]["variants"]["candidate"]["gate_passed"] is True
    assert len(runs) == 1
    assert len(case_results) == payload["summary"]["case_count"] * 2
    assert {item.variant for item in case_results} == {"current", "candidate"}


def test_shadow_replay_does_not_mutate_canonical_world_tables(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
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
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    session_payload = session_response.json()
    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場で灯をともす"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200

    with container.session_factory() as db:
        container.eval_service.run_dataset(db, "turn_resolution_smoke")
        container.eval_service.run_dataset(db, "turn_resolution_failure_injection")
        container.eval_service.run_shadow_replay(db, limit=3)
        db.commit()
        gate = container.eval_service.latest_gate_report(db)

    assert gate["verdict"] == "passed"
    assert gate["checks"]["smoke"]["candidate_passed"] is True
    assert gate["checks"]["failure_injection"]["candidate_passed"] is True
    assert gate["checks"]["shadow_replay"]["candidate_passed"] is True
    assert gate["canary_promote_status"] == "ready"
    assert gate["diff_summary"][0]["route_id"] == "session.turn_resolution"
