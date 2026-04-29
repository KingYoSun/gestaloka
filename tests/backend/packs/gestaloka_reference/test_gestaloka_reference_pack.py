from __future__ import annotations

from sqlalchemy import func, select

from app.models.entities import ActorTitleProgress, Event, Location, SPLedgerEntry, SharedHistoryRecord, Turn, World
from app.modules.llm_harness.service import PromptExecutionOutcome
from app.modules.world_state.shared_consequence import apply_shared_consequence_rules


def gestaloka_session_payload() -> dict[str, str]:
    return {
        "world_id": "gestaloka_reference",
        "pack_id": "gestaloka_reference",
        "world_template_id": "nexus_foundation",
        "world_name": "GESTALOKA: Nexus Foundation",
        "player_display_name": "Demo Player",
    }


def test_session_can_start_from_gestaloka_reference_pack(client, container, auth_headers):
    response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["pack_id"] == "gestaloka_reference"
    assert payload["world_template_id"] == "nexus_foundation"
    assert payload["world_name"] == "GESTALOKA: Nexus Foundation"

    state = client.get(f"/sessions/{payload['session_id']}/state", headers=auth_headers)
    assert state.status_code == 200
    state_payload = state.json()
    assert state_payload["current_location"]["key"] == "nexus_gate"
    assert state_payload["current_location"]["name"] == "Nexus Gate"
    assert state_payload["world_pack"]["pack_id"] == "gestaloka_reference"
    assert state_payload["world_pack"]["followup_location_name"] == "Oblivion Breach"
    assert state_payload["world_pack"]["followup_branches"]["formal_path"]["branch_key"] == "custodian_charter"
    assert state_payload["world_pack"]["followup_branches"]["undercurrent_path"]["branch_key"] == "edge_compact"
    assert state_payload["quests"][0]["stage_key"] == "starter_nexus"
    assert state_payload["chapter"]["key"] == "nexus_foundation_opening"
    assert any(item["axis_id"] == "archive_integrity" for item in state_payload["shared_world_context"]["world_axes"])
    assert any(item["destination_key"] == "lift_tower_concourse" for item in state_payload["nearby_routes"])
    assert any("Lift Tower Concourse" in item["label"] for item in state_payload["next_choices"])

    with container.session_factory() as db:
        world = db.execute(select(World).where(World.id == "gestaloka_reference")).scalar_one()
        assert world.state["pack_id"] == "gestaloka_reference"
        assert world.state["world_template_id"] == "nexus_foundation"


def test_gestaloka_reference_progression_reaches_followup_route(client, auth_headers):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    first_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200
    assert first_turn.json()["action_type"] == "narrative"

    second_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert second_turn.status_code == 200
    second_payload = second_turn.json()
    assert second_payload["inventory_updates"][0]["template_key"] == "nexus_writs"
    assert second_payload["inventory_updates"][0]["effect_kind"] == "unlock_oblivion_breach_route"

    post_reward_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_reward_state.status_code == 200
    assert any(item["action_kind"] == "use_reward_item" for item in post_reward_state.json()["next_choices"])
    assert all(len(item["summary"]) <= 80 for item in post_reward_state.json()["next_choices"])

    use_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert use_turn.status_code == 200
    use_payload = use_turn.json()
    assert use_payload["action_type"] == "use_reward_item"
    assert use_payload["quest_updates"][0]["stage_key"] == "breach_restoration"
    assert use_payload["chapter_updates"][-1]["key"] == "breach_restoration_followup"

    post_use_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_use_state.status_code == 200
    assert any(
        item["destination_key"] == "oblivion_breach" and item["available"]
        for item in post_use_state.json()["nearby_routes"]
    )
    assert not any(
        "The breach route stays sealed until Nexus recognizes the writ." in item["summary"]
        for item in post_use_state.json()["nearby_routes"]
    )
    assert any(
        item["destination_key"] == "oblivion_breach"
        and "recognized writ opens the restoration route" in item["summary"]
        for item in post_use_state.json()["nearby_routes"]
    )
    assert all(len(item["summary"]) <= 80 for item in post_use_state.json()["next_choices"])
    assert not any("arrival_clarity" in item["summary"] for item in post_use_state.json()["next_choices"])

    travel_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert travel_turn.status_code == 200
    travel_payload = travel_turn.json()
    assert travel_payload["action_type"] == "travel"
    assert travel_payload["current_location"]["key"] == "oblivion_breach"
    assert "The breach route stays sealed until Nexus recognizes the writ." not in travel_payload["travel_summary"]

    post_travel_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_travel_state.status_code == 200
    assert any(
        "recognized writ opens the restoration route" in item
        for item in post_travel_state.json()["recent_travel_history"]
    )
    assert not any(
        "The breach route stays sealed until Nexus recognizes the writ." in item
        for item in post_travel_state.json()["recent_travel_history"]
    )


def test_gestaloka_reference_progression_falls_back_when_world_progress_schema_fails(
    client,
    container,
    auth_headers,
    monkeypatch,
):
    original_execute = container.model_router.execute_structured_prompt
    world_progress_calls = 0

    def execute_with_world_progress_schema_failure(*args, **kwargs):
        nonlocal world_progress_calls
        prompt_id = kwargs.get("prompt_id") or (args[0] if args else "")
        if prompt_id == "council.world_progress":
            world_progress_calls += 1
            if world_progress_calls == 2:
                return PromptExecutionOutcome(
                    attempts=[],
                    final_lane="lite",
                    final_payload=None,
                    failure_reason="lite_lane output failed schema validation",
                )
        return original_execute(*args, **kwargs)

    monkeypatch.setattr(container.model_router, "execute_structured_prompt", execute_with_world_progress_schema_failure)
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    first_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200

    second_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert second_turn.status_code == 200
    second_payload = second_turn.json()
    assert second_payload["inventory_updates"][0]["template_key"] == "nexus_writs"

    post_reward_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_reward_state.status_code == 200
    assert post_reward_state.json()["quests"][0]["progress"] == 2
    assert any(item["name"] == "Nexus Writ" for item in post_reward_state.json()["inventory"])

    with container.session_factory() as db:
        fallback_turn = db.get(Turn, second_payload["turn_id"])
        assert fallback_turn.resolved_output["used_fallback"] is True
        assert any(
            item["role"] == "world_progress" and item["approval_status"] == "failed"
            for item in fallback_turn.resolved_output["council_trace"]
        )


def test_gestaloka_reference_restore_canonizes_history_and_recognizes_title_without_sp_side_effects(
    client,
    container,
    auth_headers,
):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with container.session_factory() as db:
        breach_location = next(
            location
            for location in db.execute(select(Location).where(Location.world_id == "gestaloka_reference")).scalars()
            if location.state["key"] == "oblivion_breach"
        )
        sp_count_before = db.execute(
            select(func.count(SPLedgerEntry.id)).where(
                SPLedgerEntry.world_id == "gestaloka_reference",
                SPLedgerEntry.actor_id == session_payload["player_actor_id"],
            )
        ).scalar_one()
        for index in range(2):
            turn = Turn(
                world_id="gestaloka_reference",
                session_id=session_payload["session_id"],
                actor_id=session_payload["player_actor_id"],
                input_text=f"restore breach boundary {index}",
                resolved_output={"status": "resolved"},
                model_lane="test",
                action_type="narrative",
                resolution_mode="test",
            )
            db.add(turn)
            db.flush()
            event = Event(
                world_id="gestaloka_reference",
                session_id=session_payload["session_id"],
                turn_id=turn.id,
                event_type="player.turn.resolved",
                source_actor_id=session_payload["player_actor_id"],
                location_id=breach_location.id,
                payload={"world_tags": ["restore"], "consequence_tags": ["restored_boundary", "breach_contained"]},
                narrative=f"The player restored a breach boundary marker {index}.",
            )
            db.add(event)
            db.flush()
            apply_shared_consequence_rules(
                db,
                memory_service=container.memory_service,
                world_id="gestaloka_reference",
                actor_id=session_payload["player_actor_id"],
                location_id=breach_location.id,
                source_event_id=event.id,
                world_tags=["restore"],
                consequence_tags=["restored_boundary", "breach_contained"],
                action_kind="narrative",
                explicit_action_tag="restore",
                interpreted_intent={"outcome_tags": ["restored_boundary", "breach_contained"]},
            )
        db.commit()

    state_response = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state_response.status_code == 200
    assert any(
        item["title_rule_id"] == "breach_restorer" and item["status"] == "recognized"
        for item in state_response.json()["recognized_titles"]
    )

    with container.session_factory() as db:
        assert db.execute(
            select(func.count(SharedHistoryRecord.id)).where(
                SharedHistoryRecord.world_id == "gestaloka_reference",
                SharedHistoryRecord.level == "world_canon",
                SharedHistoryRecord.status == "canonized",
            )
        ).scalar_one() == 2
        title_progress = db.execute(
            select(ActorTitleProgress).where(
                ActorTitleProgress.world_id == "gestaloka_reference",
                ActorTitleProgress.actor_id == session_payload["player_actor_id"],
                ActorTitleProgress.title_rule_id == "breach_restorer",
            )
        ).scalar_one()
        assert title_progress.progress == title_progress.progress_target
        assert title_progress.status == "recognized"
        assert db.execute(
            select(func.count(SPLedgerEntry.id)).where(
                SPLedgerEntry.world_id == "gestaloka_reference",
                SPLedgerEntry.actor_id == session_payload["player_actor_id"],
            )
        ).scalar_one() == sp_count_before
