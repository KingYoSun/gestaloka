from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.config import Settings
from app.core.prompts import PromptRegistry
from app.models.entities import LLMRun, OutboxEvent
from app.modules.gm_council.service import CouncilRequest, GMCouncilService
from app.modules.llm_harness.service import ModelRouter


REPO_ROOT = Path(__file__).resolve().parents[2]


def _session_state(*, progress: int = 0, standing: float = 0.25, reward_item_id: str | None = None) -> dict[str, object]:
    inventory = []
    if reward_item_id is not None:
        inventory.append(
            {
                "id": reward_item_id,
                "template_key": "lantern_sigils",
                "name": "Lantern Sigil",
                "description": "A reward sigil from Founders Watch.",
                "status": "active",
                "usable": True,
                "effect_kind": "unlock_followup_watch_path",
            }
        )
    return {
        "world_id": "world-alpha",
        "location": {"id": "starter", "name": "Founders Reach", "description": "Starter plaza"},
        "character": {"actor_id": "player-alpha", "rank": "Wayfarer", "hp": 10, "focus": 5, "status_json": {}},
        "quests": [
            {
                "assignment_id": "quest-alpha",
                "quest_template_id": "starter_watch_request",
                "title": "First Watch Request",
                "description": "Help the watch and report back.",
                "status": "active" if progress < 2 else "completed",
                "stage_key": "starter_watch",
                "unlock_requirements": {},
                "progress": progress,
                "progress_target": 2,
                "latest_summary": "",
                "reward_item_id": reward_item_id,
                "state_json": {},
            }
        ],
        "factions": [
            {
                "faction_id": "founders_watch",
                "name": "Founders Watch",
                "description": "Guardians of Founders Reach.",
                "standing": standing,
                "band": "neutral",
            }
        ],
        "inventory": inventory,
    }


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


def test_council_service_falls_back_to_pro_lane(container):
    outcome = container.council_service.resolve_turn(
        CouncilRequest(
            world_id="world-alpha",
            turn_id="turn-eval-fallback",
            player_name="Player",
            npc_name="Archivist Nera",
            input_text="__force_invalid_main__ 広場で灯をともす",
            relevant_memories=["以前の灯火を守った記憶"],
            relation_context=["location=Founders Reach"],
            graph_context_status="ready",
            session_state=_session_state(),
        )
    )

    assert outcome.succeeded is True
    assert outcome.final_lane == "pro_lane"
    assert outcome.used_fallback is True
    assert [role_run.council_role for role_run in outcome.role_runs] == [
        "memory_manager",
        "npc_manager",
        "world_progress",
        "rules_arbiter",
        "safety_guard",
        "narrative",
    ]
    assert [len(role_run.attempts) for role_run in outcome.role_runs] == [1, 1, 1, 2, 2, 2]
    assert outcome.role_runs[-1].approval_status == "approved"
    assert outcome.final_payload is not None
    assert outcome.final_payload.world_tags == ["aid_local"]


def test_turn_council_reject_returns_422_and_persists_audit_records(client, container, auth_headers):
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
            "input_text": "__force_safety_reject__ 広場で灯をともす",
        },
        headers=auth_headers,
    )
    assert turn_response.status_code == 422
    payload = turn_response.json()
    assert payload["detail"] == "council_rejected"
    assert payload["memory_ids"] == []
    assert payload["sp_delta"] == 0
    assert payload["sp_balance"] == 10
    assert payload["quest_updates"] == []
    assert payload["faction_updates"] == []
    assert payload["inventory_updates"] == []

    with container.session_factory() as db:
        llm_runs = list(
            db.execute(select(LLMRun).order_by(LLMRun.stage_index.asc(), LLMRun.created_at.asc(), LLMRun.id.asc())).scalars()
        )
        outbox_events = list(db.execute(select(OutboxEvent).order_by(OutboxEvent.created_at.asc())).scalars())

    assert [run.council_role for run in llm_runs if run.turn_id == payload["turn_id"]] == [
        "memory_manager",
        "npc_manager",
        "world_progress",
        "rules_arbiter",
        "safety_guard",
    ]
    assert {run.workflow_name for run in llm_runs if run.turn_id == payload["turn_id"]} == {"gm_council"}
    assert llm_runs[-1].approval_status == "rejected"
    assert llm_runs[-1].provider_name == "stub"
    assert outbox_events[-1].status == "projected"


def test_live_gemini_council_structured_output_runs_when_api_key_present():
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key:
        pytest.skip("GEMINI_API_KEY is not configured")
    pytest.importorskip("google.genai")

    settings = Settings(
        database_url="sqlite:///./gestaloka-live-gemini.db",
        alembic_database_url="sqlite:///./gestaloka-live-gemini.db",
        oidc_dev_mode=True,
        prompt_dir=REPO_ROOT / "prompts",
        eval_dataset_dir=REPO_ROOT / "evals" / "datasets",
        release_config_dir=REPO_ROOT / "config" / "release",
        model_provider="gemini_developer_api",
        gemini_api_key=gemini_api_key,
        otel_metrics_port=0,
    )
    prompt_registry = PromptRegistry(settings.prompt_dir, settings.eval_dataset_dir)
    router = ModelRouter(settings, prompt_registry)
    council_service = GMCouncilService(settings, router)

    outcome = council_service.resolve_turn(
        CouncilRequest(
            world_id="world-alpha",
            turn_id="live-gemini-turn",
            player_name="Demo Player",
            npc_name="Archivist Nera",
            input_text="広場で旅人を助け、灯をともす",
            relevant_memories=["Demo Playerは以前にも広場の灯を守った。"],
            relation_context=[
                "location=Founders Reach",
                "relationship=Archivist Nera KNOWS Demo Player (0.55)",
                "active_quest=First Watch Request [active 0/2]",
                "faction=Founders Watch standing=0.25 (neutral)",
            ],
            graph_context_status="ready",
            session_state=_session_state(),
        )
    )

    assert outcome.succeeded is True
    assert len(outcome.role_runs) == 6
    assert all(role_run.attempts[-1].output_schema_status == "valid" for role_run in outcome.role_runs)
    assert all(role_run.attempts[-1].provider_name == "gemini_developer_api" for role_run in outcome.role_runs)
    assert outcome.final_payload is not None
    assert outcome.final_payload.event_payload["world_id"] == "world-alpha"
