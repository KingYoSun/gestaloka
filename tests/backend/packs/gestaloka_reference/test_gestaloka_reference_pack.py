from __future__ import annotations

import json

from sqlalchemy import func, select

from app.models.entities import ActorTitleProgress, Event, Location, QuestAssignment, SPLedgerEntry, SharedHistoryRecord, Turn, World
from app.modules.llm_harness.service import PromptExecutionOutcome
from app.modules.world_state.shared_consequence import apply_shared_consequence_rules
from app.modules.world_state.service import (
    apply_quest_lifecycle_action,
    create_dynamic_quest_offer,
    record_quest_resolution_hint,
    _normalize_dynamic_quest_completion_target,
)
from tests.backend.turn_async_helpers import post_turn_and_wait


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
    assert state_payload["current_location"]["name"] == "ネクサス・ゲート"
    assert state_payload["current_scene"]["summary"]
    assert "到着門" in state_payload["current_scene"]["summary"]
    assert state_payload["world_pack"]["pack_id"] == "gestaloka_reference"
    assert state_payload["world_pack"]["followup_location_name"] == "Oblivion Breach"
    assert state_payload["world_pack"]["followup_branches"]["formal_path"]["branch_key"] == "custodian_charter"
    assert state_payload["world_pack"]["followup_branches"]["undercurrent_path"]["branch_key"] == "edge_compact"
    assert state_payload["quests"] == []
    assert state_payload["quest_journal"] == []
    assert state_payload["quest_display_state"] == {"mode": "exploration", "label": "探索中..."}
    assert state_payload["chapter"] is None
    assert any(item["axis_id"] == "archive_integrity" for item in state_payload["shared_world_context"]["world_axes"])
    assert any(item["destination_key"] == "lift_tower_concourse" for item in state_payload["nearby_routes"])
    assert state_payload["next_choices"][0]["label"] == "周囲を観察し、門で何が起きているか確かめる"
    assert state_payload["next_choices"][1]["label"] == "リッカを手伝い、乱れた到着記録を整える"
    assert state_payload["next_choices"][2]["label"] == "上階の記録所へ向かい、この街の仕組みを探る"

    story = client.get(f"/sessions/{payload['session_id']}/story", headers=auth_headers)
    assert story.status_code == 200
    story_payload = story.json()
    assert len(story_payload["items"]) == 1
    opening = story_payload["items"][0]
    assert opening["narrative"].startswith("ネクサス・ゲート。")
    assert "都市の共有記録" in opening["narrative"]
    assert "session_id" not in opening["narrative"]
    assert "raw" not in opening["narrative"].lower()
    assert opening["consequence"] == ""

    journal = client.get(f"/sessions/{payload['session_id']}/quests", headers=auth_headers)
    assert journal.status_code == 200
    assert journal.json()["quest_display_state"] == {"mode": "exploration", "label": "探索中..."}
    assert journal.json()["quests"] == []

    with container.session_factory() as db:
        world = db.execute(select(World).where(World.id == "gestaloka_reference")).scalar_one()
        assert world.state["pack_id"] == "gestaloka_reference"
        assert world.state["world_template_id"] == "nexus_foundation"


def test_gestaloka_reference_exploration_turn_offers_dynamic_quest_and_lifecycle_actions(client, auth_headers):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    _, first_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )
    assert first_payload["action_type"] == "narrative"
    assert first_payload["quest_updates"][0]["status"] == "offered"
    assert first_payload["quest_updates"][0]["available_actions"] == ["accept_quest", "decline_quest"]
    assert first_payload["chapter_updates"] == []
    quest_assignment_id = first_payload["quest_updates"][0]["assignment_id"]

    post_offer_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_offer_state.status_code == 200
    assert post_offer_state.json()["quest_display_state"]["mode"] == "quest"
    assert post_offer_state.json()["quest_journal"][0]["assignment_id"] == quest_assignment_id
    assert post_offer_state.json()["quest_journal"][0]["available_actions"] == ["accept_quest", "decline_quest"]
    quest_response = client.get(f"/sessions/{session_payload['session_id']}/quests", headers=auth_headers)
    assert quest_response.status_code == 200
    quest_payload = quest_response.json()
    assert quest_payload["items"] == quest_payload["quests"]
    assert quest_payload["quests"][0]["assignment_id"] == quest_assignment_id
    assert quest_payload["quest_display_state"]["label"] == quest_payload["quests"][0]["title"]
    visible_quest_text = json.dumps(quest_payload["quests"], ensure_ascii=False)
    assert "First Stabilizer Request" not in visible_quest_text
    assert "Nexus Gate" not in visible_quest_text

    _, accept_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"action_type": "accept_quest", "quest_assignment_id": quest_assignment_id},
    )
    assert accept_payload["action_type"] == "accept_quest"
    assert accept_payload["quest_updates"][0]["status"] == "active"
    assert accept_payload["chapter_updates"][0]["chapter_kind"] == "prologue"
    assert "body" in {item["chapter_kind"] for item in accept_payload["chapter_updates"]}
    assert accept_payload["interpreted_intent"]["lifecycle_action_kind"] == "accept_quest"
    assert not any("幕を開ける" in item["label"] for item in accept_payload["next_choices"])

    _, leave_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"action_type": "leave_quest", "quest_assignment_id": quest_assignment_id},
    )
    assert leave_payload["quest_updates"][0]["status"] == "paused"

    _, resume_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"action_type": "resume_quest", "quest_assignment_id": quest_assignment_id},
    )
    assert resume_payload["quest_updates"][0]["status"] == "active"


def test_gestaloka_reference_declines_dynamic_quest_offer(client, auth_headers):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    _, offer_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )
    quest_assignment_id = offer_payload["quest_updates"][0]["assignment_id"]

    _, decline_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"action_type": "decline_quest", "quest_assignment_id": quest_assignment_id},
    )
    assert decline_payload["quest_updates"][0]["status"] == "declined"
    assert decline_payload["action_type"] == "decline_quest"
    assert decline_payload["sp_delta"] < 0
    assert decline_payload["interpreted_intent"]["lifecycle_action_kind"] == "decline_quest"
    assert "破棄" in json.dumps(decline_payload, ensure_ascii=False)
    state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state.status_code == 200
    assert state.json()["quest_display_state"] == {"mode": "exploration", "label": "探索中..."}


def test_dynamic_quest_completion_target_normalizes_live_provider_values(client, container, auth_headers):
    assert _normalize_dynamic_quest_completion_target("5") == 5
    assert _normalize_dynamic_quest_completion_target(99) == 8
    assert _normalize_dynamic_quest_completion_target(0) == 1
    assert _normalize_dynamic_quest_completion_target(True) == 3

    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with container.session_factory() as db:
        source_event = db.execute(
            select(Event)
            .where(
                Event.world_id == "gestaloka_reference",
                Event.session_id == session_payload["session_id"],
                Event.event_type == "session.started",
            )
            .order_by(Event.created_at.desc(), Event.id.desc())
        ).scalar_one()

        updates = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id=source_event.id,
            offer={
                "title": "Visitor Log Sequence",
                "description": "A live provider supplied malformed completion target regression case.",
                "offered_summary": "Check the visitor log safely.",
                "completion_target": "Verify the visitor log sequence with Kaito JP Optimizer.",
                "constraints": [],
            },
        )

    assert updates[0]["progress_target"] == 3


def test_dynamic_quest_offer_merges_similar_live_quests_and_caps_offered_queue(client, container, auth_headers):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with container.session_factory() as db:
        first_updates = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id="dynamic-source-one",
            offer={
                "title": "訪問者の証を刻む",
                "description": "ネクサス・ゲートで訪問者の証を正式に登録する。",
                "offered_summary": "訪問者の証の登録が始まった。",
                "completion_target": 3,
                "constraints": [],
            },
        )
        similar_updates = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id="dynamic-source-two",
            offer={
                "title": "訪問者証の登録を進める",
                "description": "ネクサス・ゲートで訪問者の証を刻み、登録の流れを続ける。",
                "offered_summary": "同じ登録の局面が既存クエストへ統合された。",
                "completion_target": 3,
                "constraints": [],
            },
        )
        assert similar_updates[0]["assignment_id"] == first_updates[0]["assignment_id"]
        assert similar_updates[0]["action"] == "merged_existing"

        distinct_offers = [
            ("星図の奪還", "失われた星図を取り戻す。"),
            ("地下水路の合意", "地下水路の管理者と合意を結ぶ。"),
            ("鐘楼の封印調査", "鐘楼に残る封印を調査する。"),
            ("灯台記録の修復", "灯台に残された記録を修復する。"),
        ]
        for index, (title, description) in enumerate(distinct_offers):
            create_dynamic_quest_offer(
                db,
                world_id="gestaloka_reference",
                actor_id=session_payload["player_actor_id"],
                source_event_id=f"dynamic-queue-{index}",
                offer={
                    "title": title,
                    "description": description,
                    "offered_summary": description,
                    "completion_target": 3,
                    "constraints": [],
                },
            )
        offered_count = db.execute(
            select(func.count(QuestAssignment.id)).where(
                QuestAssignment.world_id == "gestaloka_reference",
                QuestAssignment.owner_actor_id == session_payload["player_actor_id"],
                QuestAssignment.status == "offered",
            )
        ).scalar_one()
        superseded_count = db.execute(
            select(func.count(QuestAssignment.id)).where(
                QuestAssignment.world_id == "gestaloka_reference",
                QuestAssignment.owner_actor_id == session_payload["player_actor_id"],
                QuestAssignment.status == "superseded",
            )
        ).scalar_one()

    assert offered_count == 3
    assert superseded_count >= 1


def test_accepting_or_resuming_quest_keeps_only_one_active_focus(client, container, auth_headers):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with container.session_factory() as db:
        source_event = db.execute(
            select(Event)
            .where(Event.world_id == "gestaloka_reference", Event.session_id == session_payload["session_id"])
            .order_by(Event.created_at.desc(), Event.id.desc())
            .limit(1)
        ).scalar_one()
        first = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id="focus-quest-one",
            offer={
                "title": "星図の奪還",
                "description": "失われた星図を取り戻す。",
                "offered_summary": "星図の奪還が提示された。",
                "completion_target": 3,
                "constraints": [],
            },
        )[0]
        second = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id="focus-quest-two",
            offer={
                "title": "地下水路の合意",
                "description": "地下水路の管理者と合意を結ぶ。",
                "offered_summary": "地下水路の合意が提示された。",
                "completion_target": 3,
                "constraints": [],
            },
        )[0]

        apply_quest_lifecycle_action(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            quest_assignment_id=first["assignment_id"],
            action_type="accept_quest",
            source_event_id=source_event.id,
        )
        second_updates, _, _ = apply_quest_lifecycle_action(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            quest_assignment_id=second["assignment_id"],
            action_type="accept_quest",
            source_event_id=source_event.id,
        )
        statuses = {
            item.id: item.status
            for item in db.execute(
                select(QuestAssignment).where(
                    QuestAssignment.world_id == "gestaloka_reference",
                    QuestAssignment.owner_actor_id == session_payload["player_actor_id"],
                )
            ).scalars()
        }
        resume_updates, _, _ = apply_quest_lifecycle_action(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            quest_assignment_id=first["assignment_id"],
            action_type="resume_quest",
            source_event_id=source_event.id,
        )
        resumed_statuses = {
            item.id: item.status
            for item in db.execute(
                select(QuestAssignment).where(
                    QuestAssignment.world_id == "gestaloka_reference",
                    QuestAssignment.owner_actor_id == session_payload["player_actor_id"],
                )
            ).scalars()
        }

    assert statuses[first["assignment_id"]] == "paused"
    assert statuses[second["assignment_id"]] == "active"
    assert any(item["action"] == "paused_by_focus_change" for item in second_updates)
    assert resumed_statuses[first["assignment_id"]] == "active"
    assert resumed_statuses[second["assignment_id"]] == "paused"
    assert any(item["action"] == "paused_by_focus_change" for item in resume_updates)


def test_paused_quest_resolution_hint_resolves_into_epilogue_on_resume(client, container, auth_headers):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with container.session_factory() as db:
        source_event = db.execute(
            select(Event)
            .where(Event.world_id == "gestaloka_reference", Event.session_id == session_payload["session_id"])
            .order_by(Event.created_at.desc(), Event.id.desc())
            .limit(1)
        ).scalar_one()
        quest = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id="pending-resolution-quest",
            offer={
                "title": "境界の修復",
                "description": "境界の修復を進める長期目的。",
                "offered_summary": "境界の修復が提示された。",
                "completion_target": 3,
                "constraints": [],
            },
        )[0]
        assignment = db.execute(
            select(QuestAssignment).where(
                QuestAssignment.world_id == "gestaloka_reference",
                QuestAssignment.id == quest["assignment_id"],
            )
        ).scalar_one()
        assignment.status = "paused"
        db.flush()

        hint_updates = record_quest_resolution_hint(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id=source_event.id,
            hint={
                "title": "境界の修復",
                "summary": "別行動中に境界の修復条件が満たされた。",
            },
        )
        resume_updates, chapter_updates, _ = apply_quest_lifecycle_action(
            db,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            quest_assignment_id=quest["assignment_id"],
            action_type="resume_quest",
            source_event_id=source_event.id,
        )

    assert hint_updates[0]["action"] == "deferred_resolution_recorded"
    assert resume_updates[0]["status"] == "completed"
    assert resume_updates[0]["progress"] == resume_updates[0]["progress_target"]
    assert chapter_updates[0]["chapter_kind"] == "epilogue"


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

    post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "safe"},
    )

    _, second_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )
    assert second_payload["quest_updates"][0]["status"] == "offered"

    post_offer_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_offer_state.status_code == 200
    assert post_offer_state.json()["quest_journal"][0]["status"] == "offered"

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
