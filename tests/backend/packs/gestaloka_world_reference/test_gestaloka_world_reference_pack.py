from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.models.entities import (
    Actor,
    ActorTitleProgress,
    Event,
    Faction,
    Location,
    LocationRoute,
    NPCProfile,
    QuestAssignment,
    SPLedgerEntry,
    SharedHistoryRecord,
    Turn,
    World,
    WorldResourceLock,
)
from app.modules.llm_harness.service import PromptExecutionOutcome
from app.modules.session.service import _canonicalize_next_choices
from app.modules.world_state.entity_generation import materialize_entity_drafts, pack_seed_entity_key
from app.modules.world_state.shared_consequence import apply_shared_consequence_rules
from app.modules.world_state.service import (
    apply_quest_lifecycle_action,
    create_dynamic_quest_offer,
    quest_offer_repeats_resolution,
    record_quest_resolution_hint,
    _normalize_dynamic_quest_completion_target,
)
from tests.backend.turn_async_helpers import post_turn_and_wait


def gestaloka_session_payload() -> dict[str, str]:
    return {
        "world_id": "gestaloka_world_reference",
        "pack_id": "gestaloka_world_reference",
        "world_template_id": "layered_world_foundation",
        "world_name": "GESTALOKA: Layered World Foundation",
        "player_display_name": "Demo Player",
    }


def test_session_can_start_from_gestaloka_world_reference_pack(client, container, auth_headers):
    response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["pack_id"] == "gestaloka_world_reference"
    assert payload["world_template_id"] == "layered_world_foundation"
    assert payload["world_name"] == "GESTALOKA: Layered World Foundation"

    state = client.get(f"/sessions/{payload['session_id']}/state", headers=auth_headers)
    assert state.status_code == 200
    state_payload = state.json()
    assert state_payload["current_location"]["key"] == "nexus_city"
    assert state_payload["current_location"]["name"] == "ネクサス市"
    assert state_payload["current_scene"]["summary"]
    assert "来訪者" in state_payload["current_scene"]["summary"]
    assert state_payload["world_pack"]["pack_id"] == "gestaloka_world_reference"
    assert state_payload["world_pack"]["followup_location_name"] == "Oblivion Regions"
    assert state_payload["world_pack"]["followup_branches"]["formal_path"]["branch_key"] == "public_archive_mandate"
    assert state_payload["world_pack"]["followup_branches"]["undercurrent_path"]["branch_key"] == "edge_market_compact"
    assert state_payload["quests"] == []
    assert state_payload["quest_journal"] == []
    assert state_payload["quest_display_state"] == {"mode": "exploration", "label": "探索中..."}
    assert state_payload["chapter"] is None
    assert any(item["axis_id"] == "world_integrity" for item in state_payload["shared_world_context"]["world_axes"])
    assert any(item["destination_key"] == "universal_library" for item in state_payload["nearby_routes"])
    assert state_payload["next_choices"][0]["label"] == "ネクサス市の公開記録として来訪者ログを確認する"
    assert state_payload["next_choices"][1]["label"] == "案内担当と協力し、来訪者ログの初期登録を進める"
    assert state_payload["next_choices"][2]["label"] == "万象図書館へ向かい、ゲスタロカの正史を調べる"

    story = client.get(f"/sessions/{payload['session_id']}/story", headers=auth_headers)
    assert story.status_code == 200
    story_payload = story.json()
    assert len(story_payload["items"]) == 1
    opening = story_payload["items"][0]
    assert opening["narrative"].startswith("基点都市ネクサス。")
    assert "階層世界ゲスタロカ" in opening["narrative"]
    assert "session_id" not in opening["narrative"]
    assert "raw" not in opening["narrative"].lower()
    assert opening["consequence"] == ""

    journal = client.get(f"/sessions/{payload['session_id']}/quests", headers=auth_headers)
    assert journal.status_code == 200
    assert journal.json()["quest_display_state"] == {"mode": "exploration", "label": "探索中..."}
    assert journal.json()["quests"] == []

    with container.session_factory() as db:
        world = db.execute(select(World).where(World.id == "gestaloka_world_reference")).scalar_one()
        assert world.state["pack_id"] == "gestaloka_world_reference"
        assert world.state["world_template_id"] == "layered_world_foundation"


def test_session_start_uses_pack_seed_npc_entity_key_when_generated_npc_shares_name(client, container, auth_headers):
    first_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert first_response.status_code == 200
    seed_entity_key = pack_seed_entity_key("npc", "Historian AI of the Universal Library")

    with container.session_factory() as db:
        seed_npc = db.execute(
            select(Actor).where(
                Actor.world_id == "gestaloka_world_reference",
                Actor.actor_type == "npc",
                Actor.entity_key == seed_entity_key,
            )
        ).scalar_one()
        generated_npc = Actor(
            world_id="gestaloka_world_reference",
            current_location_id=seed_npc.current_location_id,
            actor_type="npc",
            display_name=seed_npc.display_name,
            status="active",
            entity_key="npc:test:duplicate_historian_ai",
            origin_kind="freeform_generated",
            origin_ref="freeform",
            visibility_scope="world",
        )
        db.add(generated_npc)
        db.flush()
        db.add(
            NPCProfile(
                actor_id=generated_npc.id,
                world_id="gestaloka_world_reference",
                personality="duplicate generated actor used for seed lookup regression coverage",
                goals={},
                routine_state={},
            )
        )
        seed_npc_id = seed_npc.id
        generated_npc_id = generated_npc.id
        db.commit()

    second_payload = {**gestaloka_session_payload(), "player_display_name": "Second Demo Player"}
    second_response = client.post("/sessions", json=second_payload, headers=auth_headers)

    assert second_response.status_code == 200
    with container.session_factory() as db:
        seed_npc = db.execute(
            select(Actor).where(
                Actor.world_id == "gestaloka_world_reference",
                Actor.actor_type == "npc",
                Actor.entity_key == seed_entity_key,
            )
        ).scalar_one()
        generated_npc = db.execute(
            select(Actor).where(
                Actor.world_id == "gestaloka_world_reference",
                Actor.actor_type == "npc",
                Actor.id == generated_npc_id,
            )
        ).scalar_one()
        assert seed_npc.id == seed_npc_id
        assert seed_npc.origin_kind == "pack_seed"
        assert generated_npc.origin_kind == "freeform_generated"


def test_gestaloka_world_reference_exploration_turn_offers_dynamic_quest_and_lifecycle_actions(client, auth_headers):
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
    assert "Visitor Log Registration" not in visible_quest_text
    assert "Nexus City" not in visible_quest_text

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
    accept_choice_text = json.dumps(accept_payload["next_choices"], ensure_ascii=False)
    assert "直前の結果" not in accept_choice_text
    assert "場面を次へ進める" not in accept_choice_text
    assert "latest result" not in accept_choice_text
    assert "push the scene forward" not in accept_choice_text

    _, progress_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )
    assert progress_payload["quest_updates"][0]["assignment_id"] == quest_assignment_id
    assert progress_payload["quest_updates"][0]["progress"] > accept_payload["quest_updates"][0]["progress"]
    assert progress_payload["quest_updates"][0]["world_tags"] != ["none"]
    assert any(tag in progress_payload["quest_updates"][0]["world_tags"] for tag in ("aid_local", "promise_followup"))

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


def test_non_progress_choices_do_not_promise_quest_stage_completion():
    choices = _canonicalize_next_choices(
        [
            {
                "posture": "safe",
                "label": "図書館でログを確認する",
                "summary": "来訪者ログの登録が完了する。",
                "canonical_input_text": "安全にcomplete the registration",
                "action_kind": "narrative",
            },
            {
                "posture": "progress",
                "label": "未処理項目を確定する",
                "summary": "次のクエスト段階へ進む。",
                "canonical_input_text": "未処理項目を確定する",
                "action_kind": "narrative",
            },
            {
                "posture": "explore",
                "label": "反応の広がりを調べる",
                "summary": "advance to the next quest stage by observing.",
                "canonical_input_text": "move to the next quest stage by observing",
                "action_kind": "narrative",
            },
        ],
        [],
    )

    safe, progress, explore = choices
    assert "登録が完了する" not in safe["summary"]
    assert "complete the registration" not in safe["canonical_input_text"]
    assert "次のクエスト段階へ進む" in progress["summary"]
    assert "advance to the next quest stage" not in explore["summary"]
    assert "move to the next quest stage" not in explore["canonical_input_text"]


def test_generated_freeform_entities_persist_and_reuse_across_sessions(client, container, auth_headers):
    first_session = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers).json()
    second_payload = {**gestaloka_session_payload(), "player_display_name": "Second Player"}
    second_session = client.post("/sessions", json=second_payload, headers=auth_headers).json()

    with container.session_factory() as db:
        nexus = next(
            location
            for location in db.execute(select(Location).where(Location.world_id == "gestaloka_world_reference")).scalars()
            if location.state["key"] == "nexus_city"
        )
        source_event = db.execute(
            select(Event)
            .where(Event.world_id == "gestaloka_world_reference", Event.session_id == first_session["session_id"])
            .order_by(Event.created_at.asc())
            .limit(1)
        ).scalar_one()
        drafts = [
            {
                "entity_type": "npc",
                "display_name": "Aster Crystal Clerk",
                "semantic_key_hint": "aster-crystal-clerk",
                "location_key": "nexus_city",
                "community_id": "nexus_city",
                "description": "A freeform generated clerk who remembers visitor crystal paperwork.",
            },
            {
                "entity_type": "location",
                "display_name": "Aster Crystal Stall",
                "semantic_key_hint": "aster-crystal-stall",
                "location_key": "aster_crystal_stall",
                "community_id": "nexus_city",
                "description": "A freeform generated shopfront near the visitor registry.",
            },
            {
                "entity_type": "community",
                "display_name": "Aster Stall Cooperative",
                "semantic_key_hint": "aster-stall-cooperative",
                "location_key": "nexus_city",
                "description": "A freeform generated small merchant cooperative.",
            },
        ]
        first_updates = materialize_entity_drafts(
            db,
            world_id="gestaloka_world_reference",
            actor_id=first_session["player_actor_id"],
            session_id=first_session["session_id"],
            source_event_id=source_event.id,
            current_location_id=nexus.id,
            drafts=drafts,
        )
        second_updates = materialize_entity_drafts(
            db,
            world_id="gestaloka_world_reference",
            actor_id=second_session["player_actor_id"],
            session_id=second_session["session_id"],
            source_event_id=source_event.id,
            current_location_id=nexus.id,
            drafts=drafts,
        )

        assert [item.entity_id for item in second_updates] == [item.entity_id for item in first_updates]
        assert all(item.origin_kind == "freeform_generated" for item in first_updates)
        assert db.execute(select(Actor).where(Actor.world_id == "gestaloka_world_reference", Actor.entity_key == first_updates[0].entity_key)).scalar_one()
        generated_location = db.execute(
            select(Location).where(Location.world_id == "gestaloka_world_reference", Location.entity_key == first_updates[1].entity_key)
        ).scalar_one()
        assert generated_location.origin_kind == "freeform_generated"
        assert db.execute(
            select(LocationRoute).where(
                LocationRoute.world_id == "gestaloka_world_reference",
                LocationRoute.to_location_id == generated_location.id,
            )
        ).scalar_one()
        generated_community = db.execute(
            select(Faction).where(Faction.world_id == "gestaloka_world_reference", Faction.entity_key == first_updates[2].entity_key)
        ).scalar_one()
        assert generated_community.state["community_generated"] is True
        assert len(generated_community.id) <= 96


def test_generated_npc_lock_creates_alternate_persistent_actor(client, container, auth_headers):
    session_payload = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers).json()
    with container.session_factory() as db:
        nexus = next(
            location
            for location in db.execute(select(Location).where(Location.world_id == "gestaloka_world_reference")).scalars()
            if location.state["key"] == "nexus_city"
        )
        source_event = db.execute(
            select(Event)
            .where(Event.world_id == "gestaloka_world_reference", Event.session_id == session_payload["session_id"])
            .order_by(Event.created_at.asc())
            .limit(1)
        ).scalar_one()
        draft = {
            "entity_type": "npc",
            "display_name": "Busy Entry Liaison",
            "semantic_key_hint": "busy-entry-liaison",
            "archetype_id": "nexus_entry_liaison",
            "location_key": "nexus_city",
            "community_id": "nexus_city",
            "description": "A generated liaison used to prove lock-aware alternate generation.",
        }
        first = materialize_entity_drafts(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            session_id=session_payload["session_id"],
            source_event_id=source_event.id,
            current_location_id=nexus.id,
            drafts=[draft],
        )[0]
        lock_turn = Turn(
            world_id="gestaloka_world_reference",
            session_id=session_payload["session_id"],
            actor_id=session_payload["player_actor_id"],
            input_text="hold generated liaison",
            resolved_output={},
            model_lane="test",
            action_type="narrative",
            resolution_mode="test",
        )
        db.add(lock_turn)
        db.flush()
        db.add(
            WorldResourceLock(
                world_id="gestaloka_world_reference",
                resource_type="npc",
                resource_id=first.entity_id,
                holder_turn_id=lock_turn.id,
                holder_session_id=session_payload["session_id"],
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
                constraint_summary="test lock",
            )
        )
        db.flush()
        second = materialize_entity_drafts(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            session_id=session_payload["session_id"],
            source_event_id=source_event.id,
            current_location_id=nexus.id,
            drafts=[draft],
        )[0]
        assert second.entity_id != first.entity_id
        assert second.origin_kind == "archetype_generated"


def test_gestaloka_world_reference_declines_dynamic_quest_offer(client, auth_headers):
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
                Event.world_id == "gestaloka_world_reference",
                Event.session_id == session_payload["session_id"],
                Event.event_type == "session.started",
            )
            .order_by(Event.created_at.desc(), Event.id.desc())
        ).scalar_one()

        updates = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
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


def test_dynamic_quest_offer_merges_similar_offered_quest_and_suppresses_distinct_live_offers(
    client,
    container,
    auth_headers,
):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with container.session_factory() as db:
        first_updates = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
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
            world_id="gestaloka_world_reference",
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

        distinct_updates = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id="dynamic-distinct-suppressed",
            offer={
                "title": "星図の奪還",
                "description": "失われた星図を取り戻す。",
                "offered_summary": "星図の奪還が提示された。",
                "completion_target": 3,
                "constraints": [],
            },
        )
        offered_count = db.execute(
            select(func.count(QuestAssignment.id)).where(
                QuestAssignment.world_id == "gestaloka_world_reference",
                QuestAssignment.owner_actor_id == session_payload["player_actor_id"],
                QuestAssignment.status == "offered",
            )
        ).scalar_one()

    assert distinct_updates == []
    assert offered_count == 1


def test_dynamic_quest_offer_suppresses_new_offer_while_active_quest_exists(client, container, auth_headers):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with container.session_factory() as db:
        source_event = db.execute(
            select(Event)
            .where(Event.world_id == "gestaloka_world_reference", Event.session_id == session_payload["session_id"])
            .order_by(Event.created_at.desc(), Event.id.desc())
            .limit(1)
        ).scalar_one()
        first = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id="active-gate-quest",
            offer={
                "title": "門記録の整理",
                "description": "門の記録を整理する。",
                "offered_summary": "門記録の整理が提示された。",
                "completion_target": 3,
                "constraints": [],
            },
        )[0]
        apply_quest_lifecycle_action(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            quest_assignment_id=first["assignment_id"],
            action_type="accept_quest",
            source_event_id=source_event.id,
        )

        blocked_updates = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id="active-distinct-suppressed",
            offer={
                "title": "別件の星図調査",
                "description": "門とは別の星図を調査する。",
                "offered_summary": "別件の星図調査が提示された。",
                "completion_target": 3,
                "constraints": [],
            },
        )
        offered_count = db.execute(
            select(func.count(QuestAssignment.id)).where(
                QuestAssignment.world_id == "gestaloka_world_reference",
                QuestAssignment.owner_actor_id == session_payload["player_actor_id"],
                QuestAssignment.status == "offered",
            )
        ).scalar_one()

    assert blocked_updates == []
    assert offered_count == 0


def test_dynamic_followup_offer_requires_completed_source_and_no_live_quest(client, container, auth_headers):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with container.session_factory() as db:
        source_event = db.execute(
            select(Event)
            .where(Event.world_id == "gestaloka_world_reference", Event.session_id == session_payload["session_id"])
            .order_by(Event.created_at.desc(), Event.id.desc())
            .limit(1)
        ).scalar_one()
        source = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id="followup-source-quest",
            offer={
                "title": "門記録を収束させる",
                "description": "門記録の収束を進める。",
                "offered_summary": "門記録の収束が提示された。",
                "completion_target": 3,
                "constraints": [],
            },
        )[0]
        blocked_while_offered = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id="followup-blocked-live",
            followup_of_assignment_id=source["assignment_id"],
            offer={
                "title": "塔記録の照合",
                "description": "塔記録を照合する後続任務。",
                "offered_summary": "塔記録の照合が提示された。",
                "completion_target": 3,
                "constraints": [],
            },
        )
        assignment = db.execute(
            select(QuestAssignment).where(
                QuestAssignment.world_id == "gestaloka_world_reference",
                QuestAssignment.id == source["assignment_id"],
            )
        ).scalar_one()
        assignment.status = "completed"
        assignment.progress = assignment.progress_target
        db.flush()
        followup_updates = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id=source_event.id,
            followup_of_assignment_id=source["assignment_id"],
            offer={
                "title": "塔記録の照合",
                "description": "塔記録を照合する後続任務。",
                "offered_summary": "塔記録の照合が提示された。",
                "completion_target": 3,
                "constraints": [],
            },
        )

    assert blocked_while_offered == []
    assert followup_updates[0]["status"] == "offered"
    assert followup_updates[0]["state_json"]["followup_of_assignment_id"] == source["assignment_id"]


def test_dynamic_quest_offer_rejects_completed_resolution_text():
    resolution_summary = "ナートはリッカと共に門の記録ログを精査し、綻びを修正しました。"

    assert quest_offer_repeats_resolution(
        offer={
            "title": "特定した綻びをリッカと共に修正する",
            "description": resolution_summary,
            "offered_summary": resolution_summary,
        },
        resolution_summary=resolution_summary,
    )


def test_accepting_or_resuming_quest_keeps_only_one_active_focus(client, container, auth_headers):
    session_response = client.post("/sessions", json=gestaloka_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with container.session_factory() as db:
        source_event = db.execute(
            select(Event)
            .where(Event.world_id == "gestaloka_world_reference", Event.session_id == session_payload["session_id"])
            .order_by(Event.created_at.desc(), Event.id.desc())
            .limit(1)
        ).scalar_one()
        first = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
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
        first_assignment = db.execute(
            select(QuestAssignment).where(
                QuestAssignment.world_id == "gestaloka_world_reference",
                QuestAssignment.id == first["assignment_id"],
            )
        ).scalar_one()
        first_assignment.status = "declined"
        db.flush()
        second = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
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
        first_assignment.status = "active"
        db.flush()

        second_updates, _, _ = apply_quest_lifecycle_action(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            quest_assignment_id=second["assignment_id"],
            action_type="accept_quest",
            source_event_id=source_event.id,
        )
        statuses = {
            item.id: item.status
            for item in db.execute(
                select(QuestAssignment).where(
                    QuestAssignment.world_id == "gestaloka_world_reference",
                    QuestAssignment.owner_actor_id == session_payload["player_actor_id"],
                )
            ).scalars()
        }
        resume_updates, _, _ = apply_quest_lifecycle_action(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            quest_assignment_id=first["assignment_id"],
            action_type="resume_quest",
            source_event_id=source_event.id,
        )
        resumed_statuses = {
            item.id: item.status
            for item in db.execute(
                select(QuestAssignment).where(
                    QuestAssignment.world_id == "gestaloka_world_reference",
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
            .where(Event.world_id == "gestaloka_world_reference", Event.session_id == session_payload["session_id"])
            .order_by(Event.created_at.desc(), Event.id.desc())
            .limit(1)
        ).scalar_one()
        quest = create_dynamic_quest_offer(
            db,
            world_id="gestaloka_world_reference",
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
                QuestAssignment.world_id == "gestaloka_world_reference",
                QuestAssignment.id == quest["assignment_id"],
            )
        ).scalar_one()
        assignment.status = "paused"
        db.flush()

        hint_updates = record_quest_resolution_hint(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            source_event_id=source_event.id,
            hint={
                "title": "境界の修復",
                "summary": "別行動中に境界の修復条件が満たされた。",
            },
        )
        resume_updates, chapter_updates, _ = apply_quest_lifecycle_action(
            db,
            world_id="gestaloka_world_reference",
            actor_id=session_payload["player_actor_id"],
            quest_assignment_id=quest["assignment_id"],
            action_type="resume_quest",
            source_event_id=source_event.id,
        )

    assert hint_updates[0]["action"] == "deferred_resolution_recorded"
    assert resume_updates[0]["status"] == "completed"
    assert resume_updates[0]["progress"] == resume_updates[0]["progress_target"]
    assert chapter_updates[0]["chapter_kind"] == "epilogue"


def test_gestaloka_world_reference_progression_falls_back_when_world_progress_schema_fails(
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


def test_gestaloka_world_reference_restore_canonizes_history_and_recognizes_title_without_sp_side_effects(
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
            for location in db.execute(select(Location).where(Location.world_id == "gestaloka_world_reference")).scalars()
            if location.state["key"] == "oblivion_regions"
        )
        sp_count_before = db.execute(
            select(func.count(SPLedgerEntry.id)).where(
                SPLedgerEntry.world_id == "gestaloka_world_reference",
                SPLedgerEntry.actor_id == session_payload["player_actor_id"],
            )
        ).scalar_one()
        for index in range(2):
            turn = Turn(
                world_id="gestaloka_world_reference",
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
                world_id="gestaloka_world_reference",
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
                world_id="gestaloka_world_reference",
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
        item["title_rule_id"] == "oblivion_surveyor" and item["status"] == "recognized"
        for item in state_response.json()["recognized_titles"]
    )

    with container.session_factory() as db:
        assert db.execute(
            select(func.count(SharedHistoryRecord.id)).where(
                SharedHistoryRecord.world_id == "gestaloka_world_reference",
                SharedHistoryRecord.level == "world_canon",
                SharedHistoryRecord.status == "canonized",
            )
        ).scalar_one() == 2
        title_progress = db.execute(
            select(ActorTitleProgress).where(
                ActorTitleProgress.world_id == "gestaloka_world_reference",
                ActorTitleProgress.actor_id == session_payload["player_actor_id"],
                ActorTitleProgress.title_rule_id == "oblivion_surveyor",
            )
        ).scalar_one()
        assert title_progress.progress == title_progress.progress_target
        assert title_progress.status == "recognized"
        assert db.execute(
            select(func.count(SPLedgerEntry.id)).where(
                SPLedgerEntry.world_id == "gestaloka_world_reference",
                SPLedgerEntry.actor_id == session_payload["player_actor_id"],
            )
        ).scalar_one() == sp_count_before
