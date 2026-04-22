from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.prompts import PromptRegistry
from app.models.entities import LLMRun, OutboxEvent


def test_prompt_registry_rejects_unknown_schema(tmp_path):
    dataset_dir = tmp_path / "datasets"
    dataset_dir.mkdir()
    (dataset_dir / "smoke.yaml").write_text(
        "\n".join(
            [
                "dataset_id: smoke",
                "prompt_id: broken.prompt",
                "expected_output_schema: turn_resolution_v1",
                "cases:",
                "  - case_id: smoke-case",
                "    world_id: world-alpha",
                "    player_name: Demo Player",
                "    npc_name: Archivist Nera",
                "    input_text: test",
            ]
        ),
        encoding="utf-8",
    )
    prompt_file = tmp_path / "broken.yaml"
    prompt_file.write_text(
        "\n".join(
            [
                "prompt_id: broken.prompt",
                "owner_module: session",
                'schema_version: "1"',
                "model_lane: main_lane",
                "expected_output_schema: missing_schema",
                "eval_dataset_ref: smoke",
                "world_invariants:",
                "  - single_world_namespace",
                "instructions: |",
                "  broken",
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="unknown schema"):
        PromptRegistry(tmp_path, dataset_dir)


def test_model_router_falls_back_to_pro_lane(container):
    outcome = container.model_router.resolve_turn(
        world_id="world-alpha",
        player_name="Player",
        npc_name="Archivist Nera",
        input_text="__force_invalid_main__ 広場で灯をともす",
        relevant_memories=["以前の灯火を守った記憶"],
        relation_context=["location=Founders Reach"],
    )

    assert outcome.succeeded is True
    assert outcome.final_lane == "pro_lane"
    assert [attempt.model_lane for attempt in outcome.attempts] == ["main_lane", "pro_lane"]
    assert [attempt.output_schema_status for attempt in outcome.attempts] == ["invalid", "valid"]


def test_turn_failure_returns_422_and_persists_audit_records(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    session_payload = session_response.json()

    turn_response = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_text": "__force_invalid_all__ 広場で灯をともす",
        },
        headers=auth_headers,
    )
    assert turn_response.status_code == 422
    payload = turn_response.json()
    assert payload["detail"] == "pro_lane output failed schema validation"
    assert payload["memory_ids"] == []
    assert payload["sp_delta"] == 0
    assert payload["sp_balance"] == 10

    with container.session_factory() as db:
        llm_runs = list(db.execute(select(LLMRun).order_by(LLMRun.created_at.asc())).scalars())
        outbox_events = list(db.execute(select(OutboxEvent).order_by(OutboxEvent.created_at.asc())).scalars())

    assert [run.model_lane for run in llm_runs] == ["main_lane", "pro_lane"]
    assert [run.output_schema_status for run in llm_runs] == ["invalid", "invalid"]
    assert outbox_events[-1].status == "projected"
