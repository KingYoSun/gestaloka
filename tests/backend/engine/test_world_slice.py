from __future__ import annotations

from sqlalchemy import func, select

from app.models.entities import (
    ActorTitleProgress,
    ChapterTrack,
    CharacterSheet,
    Event,
    Faction,
    FactionStanding,
    Location,
    Memory,
    ProjectionRecord,
    QuestAssignment,
    QuestTemplate,
    SPLedgerEntry,
    Turn,
    SharedConsequenceApplication,
    SharedHistoryRecord,
    World,
    WorldAxisState,
    SceneFrame,
)
from app.modules.identity.oidc import UserIdentity
from app.modules.world_state.consequence import ConsequenceRuleEngine, ConsequenceRuleInput, ConsequenceThreadSnapshot
from app.modules.world_state.rules import QuestRuleEngine, QuestRuleInput
from app.modules.world_state.shared_consequence import apply_shared_consequence_rules
from app.modules.world_state.service import ensure_starter_faction, ensure_world


def engine_session_payload() -> dict[str, str]:
    return {
        "world_id": "gestaloka_reference",
        "world_name": "GESTALOKA: Nexus Foundation",
        "player_display_name": "Demo Player",
    }


def test_quest_rule_engine_progresses_and_issues_reward_only_on_completion():
    first = QuestRuleEngine.evaluate(
        QuestRuleInput(
            world_tags=["aid_local"],
            current_progress=0,
            progress_target=2,
            current_standing=0.25,
            reward_already_issued=False,
        )
    )
    second = QuestRuleEngine.evaluate(
        QuestRuleInput(
            world_tags=["investigate", "promise_followup"],
            current_progress=1,
            progress_target=2,
            current_standing=0.4,
            reward_already_issued=False,
        )
    )

    assert first.next_progress == 1
    assert first.should_issue_reward is False
    assert second.next_progress == 2
    assert second.should_issue_reward is True
    assert second.next_standing > 0.4

    followup = QuestRuleEngine.evaluate(
        QuestRuleInput(
            world_tags=["promise_followup"],
            current_progress=0,
            progress_target=1,
            current_standing=0.55,
            reward_already_issued=False,
            reward_enabled=False,
        )
    )
    assert followup.next_progress == 1
    assert followup.should_issue_reward is False


def test_session_seed_is_idempotent_for_character_faction_and_quest(client, container, auth_headers):
    first = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    second = client.post(
        "/sessions",
        json={**engine_session_payload(), "player_actor_id": first.json()["player_actor_id"]},
        headers=auth_headers,
    )

    assert first.status_code == 200
    assert second.status_code == 200

    with container.session_factory() as db:
        assert db.execute(select(func.count(Faction.id))).scalar_one() == 5
        assert db.execute(select(func.count(QuestTemplate.id))).scalar_one() == 2
        assert db.execute(select(func.count(QuestAssignment.id))).scalar_one() == 1
        assert db.execute(select(func.count(CharacterSheet.actor_id))).scalar_one() == 1
        assert db.execute(select(func.count(FactionStanding.actor_id))).scalar_one() == 5
        assert db.execute(select(func.count(ChapterTrack.id))).scalar_one() == 1
        assert db.execute(select(func.count(SceneFrame.id))).scalar_one() == 1
        assert db.execute(select(func.count(WorldAxisState.axis_id))).scalar_one() == 5
        gate = next(
            location
            for location in db.execute(select(Location).where(Location.world_id == "gestaloka_reference")).scalars()
            if location.state["key"] == "nexus_gate"
        )
        assert gate.state["public_state"]["civic_trust"] == 1


def test_starter_faction_seed_survives_insert_race(container, monkeypatch):
    world_id = "gestaloka_reference"
    faction_id = "gestaloka_reference:nexus_custodians"
    with container.session_factory() as db:
        ensure_world(
            db,
            world_id,
            pack_id="gestaloka_reference",
            world_template_id="nexus_foundation",
            world_name="GESTALOKA: Nexus Foundation",
        )
        db.commit()

    with container.session_factory() as db:
        original_execute = db.execute
        original_flush = db.flush
        raced = {"done": False}

        def racing_execute(statement, *args, **kwargs):
            result = original_execute(statement, *args, **kwargs)
            if not raced["done"] and "FROM factions" in str(statement):
                raced["done"] = True
                db.add(
                    Faction(
                        id=faction_id,
                        world_id=world_id,
                        name="Raced Custodians",
                        description="Inserted by a concurrent seed transaction.",
                        state={"pack_faction_id": "nexus_custodians", "policy": "race"},
                    )
                )
                original_flush()
            return result

        monkeypatch.setattr(db, "execute", racing_execute)
        faction = ensure_starter_faction(db, world_id)
        resolved_faction_id = faction.id
        db.commit()

    assert resolved_faction_id == faction_id
    with container.session_factory() as db:
        assert db.execute(select(func.count(Faction.id)).where(Faction.id == faction_id)).scalar_one() == 1


def test_shared_consequence_projection_persists_pack_rule_outputs_and_is_idempotent(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()

    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200
    turn_payload = turn_response.json()

    with container.session_factory() as db:
        axis = db.execute(
            select(WorldAxisState).where(
                WorldAxisState.world_id == "gestaloka_reference",
                WorldAxisState.axis_id == "archive_integrity",
            )
        ).scalar_one()
        assert axis.current_value == 55
        assert axis.last_event_id == turn_payload["event_id"]

        primary_standing = db.execute(
            select(FactionStanding).where(
                FactionStanding.world_id == "gestaloka_reference",
                FactionStanding.actor_id == session_payload["player_actor_id"],
                FactionStanding.faction_id == "gestaloka_reference:nexus_custodians",
            )
        ).scalar_one()
        assert primary_standing.standing > 0

        gate = next(
            location
            for location in db.execute(select(Location).where(Location.world_id == "gestaloka_reference")).scalars()
            if location.state["key"] == "nexus_gate"
        )
        assert gate.state["public_state"]["civic_trust"] == 2

        assert db.execute(
            select(func.count(Memory.id)).where(
                Memory.world_id == "gestaloka_reference",
                Memory.source_event_id == turn_payload["event_id"],
                Memory.text.contains("first arrival"),
            )
        ).scalar_one() >= 1
        assert db.execute(
            select(func.count(SharedHistoryRecord.id)).where(
                SharedHistoryRecord.world_id == "gestaloka_reference",
                SharedHistoryRecord.source_event_id == turn_payload["event_id"],
                SharedHistoryRecord.status == "canonized",
            )
        ).scalar_one() == 1
        assert db.execute(
            select(func.count(SharedHistoryRecord.id)).where(
                SharedHistoryRecord.world_id == "gestaloka_reference",
                SharedHistoryRecord.source_event_id == turn_payload["event_id"],
                SharedHistoryRecord.level == "local_rumor",
            )
        ).scalar_one() == 1
        title_progress = db.execute(
            select(ActorTitleProgress).where(
                ActorTitleProgress.world_id == "gestaloka_reference",
                ActorTitleProgress.actor_id == session_payload["player_actor_id"],
                ActorTitleProgress.title_rule_id == "nexus_stabilizer",
            )
        ).scalar_one()
        assert title_progress.progress == 1
        assert title_progress.status == "in_progress"

        applications_before = db.execute(select(func.count(SharedConsequenceApplication.rule_id))).scalar_one()
        axis_before = axis.current_value
        event_id = turn_payload["event_id"]
        apply_shared_consequence_rules(
            db,
            memory_service=container.memory_service,
            world_id="gestaloka_reference",
            actor_id=session_payload["player_actor_id"],
            location_id=session_payload["location_id"],
            source_event_id=event_id,
            world_tags=["aid_local"],
            consequence_tags=["earned_trust"],
            action_kind="narrative",
            interpreted_intent={"consequence_tags": ["earned_trust"]},
        )
        db.flush()
        assert db.execute(select(func.count(SharedConsequenceApplication.rule_id))).scalar_one() == applications_before
        assert db.execute(
            select(WorldAxisState.current_value).where(
                WorldAxisState.world_id == "gestaloka_reference",
                WorldAxisState.axis_id == "archive_integrity",
            )
        ).scalar_one() == axis_before

        rebuilt = container.projection_service.rebuild(db, "gestaloka_reference")
        labels = {item["label"] for item in rebuilt}
        assert {"WorldAxis", "SharedHistory", "TitleProgress"} <= labels
        projection_labels = {
            record.payload.get("label")
            for record in db.execute(
                select(ProjectionRecord).where(ProjectionRecord.world_id == "gestaloka_reference")
            ).scalars()
        }
        assert {"WorldAxis", "SharedHistory", "TitleProgress"} <= projection_labels


def test_shared_consequence_projection_does_not_cross_worlds(client, container, auth_headers):
    reference_session = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    assert reference_session.status_code == 200
    reference_payload = reference_session.json()
    with container.session_factory() as db:
        db.add(
            World(
                id="alternate_reference_world",
                name="GESTALOKA: Nexus Foundation Alt",
                status="active",
                state={"pack_id": "gestaloka_reference", "world_template_id": "nexus_foundation"},
            )
        )
        db.commit()

    with container.session_factory() as db:
        alternate_axis_before = {
            axis.axis_id: axis.current_value
            for axis in db.execute(select(WorldAxisState).where(WorldAxisState.world_id == "alternate_reference_world")).scalars()
        }
        alternate_memory_before = db.execute(
            select(func.count(Memory.id)).where(Memory.world_id == "alternate_reference_world")
        ).scalar_one()
        alternate_projection_before = db.execute(
            select(func.count(ProjectionRecord.id)).where(ProjectionRecord.world_id == "alternate_reference_world")
        ).scalar_one()

    turn_response = client.post(
        "/turns",
        json={"session_id": reference_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200
    turn_payload = turn_response.json()
    assert turn_payload["shared_action_tag"] == "help"

    with container.session_factory() as db:
        alternate_axis_after = {
            axis.axis_id: axis.current_value
            for axis in db.execute(select(WorldAxisState).where(WorldAxisState.world_id == "alternate_reference_world")).scalars()
        }
        assert alternate_axis_after == alternate_axis_before
        assert db.execute(
            select(func.count(Memory.id)).where(Memory.world_id == "alternate_reference_world")
        ).scalar_one() == alternate_memory_before
        assert db.execute(
            select(func.count(ProjectionRecord.id)).where(ProjectionRecord.world_id == "alternate_reference_world")
        ).scalar_one() == alternate_projection_before
        assert db.execute(
            select(func.count(Memory.id)).where(
                Memory.world_id == "alternate_reference_world",
                Memory.source_event_id == turn_payload["event_id"],
            )
        ).scalar_one() == 0
        assert db.execute(
            select(func.count(SharedHistoryRecord.id)).where(
                SharedHistoryRecord.world_id == "alternate_reference_world",
                SharedHistoryRecord.source_event_id == turn_payload["event_id"],
            )
        ).scalar_one() == 0
        assert db.execute(
            select(func.count(ProjectionRecord.id)).where(
                ProjectionRecord.world_id == "alternate_reference_world",
                ProjectionRecord.event_id == turn_payload["event_id"],
            )
        ).scalar_one() == 0


def test_shared_world_context_flows_between_players_without_crossing_worlds(client, container):
    def resolve_token(token: str) -> UserIdentity:
        if token == "player-a":
            return UserIdentity(sub="player-a", name="Player A")
        if token == "player-b":
            return UserIdentity(sub="player-b", name="Player B")
        if token == "ops-token":
            return UserIdentity(sub="ops-sub", name="Ops")
        raise AssertionError(f"Unexpected token: {token}")

    container.oidc_adapter.resolve_token = resolve_token  # type: ignore[method-assign]
    headers_a = {"Authorization": "Bearer player-a"}
    headers_b = {"Authorization": "Bearer player-b"}
    ops_headers = {"Authorization": "Bearer ops-token"}

    player_a_session = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=headers_a,
    )
    assert player_a_session.status_code == 200
    player_a_payload = player_a_session.json()

    player_a_turn = client.post(
        "/turns",
        json={"session_id": player_a_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=headers_a,
    )
    assert player_a_turn.status_code == 200
    player_a_turn_payload = player_a_turn.json()
    assert player_a_turn_payload["shared_action_tag"] == "help"

    player_b_session = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=headers_b,
    )
    assert player_b_session.status_code == 200
    player_b_payload = player_b_session.json()
    player_b_state = client.get(f"/sessions/{player_b_payload['session_id']}/state", headers=headers_b)
    assert player_b_state.status_code == 200
    shared_context = player_b_state.json()["shared_world_context"]

    assert player_a_turn_payload["event_id"] in shared_context["trace"]["source_event_ids"]
    assert any(item["axis_id"] == "archive_integrity" and item["current_value"] == 55 for item in shared_context["world_axes"])
    assert any(item["source_event_id"] == player_a_turn_payload["event_id"] for item in shared_context["recent_history"])
    assert any(
        item["source_event_id"] == player_a_turn_payload["event_id"]
        and item["level"] == "local_rumor"
        and item["status"] == "canonized"
        for item in shared_context["recent_history"]
    )
    assert any(item["source_event_id"] == player_a_turn_payload["event_id"] for item in shared_context["rumor_surface"])
    assert shared_context["location_public_state"]["public_state"]["civic_trust"] == 2
    assert "user_sub" not in str(shared_context)

    player_b_turn = client.post(
        "/turns",
        json={
            "session_id": player_b_payload["session_id"],
            "input_mode": "free_text",
            "input_text": "Gate stewards repeat who helped clarify the arrival registry.",
        },
        headers=headers_b,
    )
    assert player_b_turn.status_code == 200

    with container.session_factory() as db:
        resolved_turn = db.execute(select(Turn).where(Turn.id == player_b_turn.json()["turn_id"])).scalar_one()
        retrieval_trace = resolved_turn.resolved_output["retrieval_trace"]
        assert retrieval_trace["status"] == "ready"
        retrieved_memories = [
            db.execute(select(Memory).where(Memory.id == memory_id)).scalar_one()
            for memory_id in retrieval_trace["retrieved_memory_ids"]
        ]
        assert any(memory.source_event_id == player_a_turn_payload["event_id"] for memory in retrieved_memories)

    langfuse_records = container.observability_service._langfuse_client.records
    generation_inputs = [
        record.get("input") or {}
        for record in langfuse_records
        if record.get("event") == "enter" and record.get("as_type") == "generation"
    ]
    assert any(payload.get("shared_world_context", {}).get("trace", {}).get("source_event_ids") for payload in generation_inputs)
    assert any(
        any(
            item.get("level") == "local_rumor" and item.get("status") == "canonized"
            for item in payload.get("shared_world_context", {}).get("recent_history", [])
        )
        for payload in generation_inputs
    )

    ops_shared = client.get("/ops/worlds/gestaloka_reference/shared-world", headers=ops_headers)
    assert ops_shared.status_code == 200
    assert player_a_turn_payload["event_id"] in ops_shared.json()["shared_world_context"]["trace"]["source_event_ids"]
    ops_history = client.get("/ops/worlds/gestaloka_reference/history?level=local_rumor&status=canonized", headers=ops_headers)
    assert ops_history.status_code == 200
    assert any(item["source_event_id"] == player_a_turn_payload["event_id"] for item in ops_history.json()["items"])
    ops_titles = client.get(
        f"/ops/worlds/gestaloka_reference/titles?actor_id={player_a_payload['player_actor_id']}&status=in_progress",
        headers=ops_headers,
    )
    assert ops_titles.status_code == 200
    assert any(item["title_rule_id"] == "nexus_stabilizer" for item in ops_titles.json()["items"])

    with container.session_factory() as db:
        db.add(
            World(
                id="alternate_reference_world",
                name="GESTALOKA: Nexus Foundation Alt",
                status="active",
                state={"pack_id": "gestaloka_reference", "world_template_id": "nexus_foundation"},
            )
        )
        db.commit()
    alternate_ops_shared = client.get("/ops/worlds/alternate_reference_world/shared-world", headers=ops_headers)
    assert alternate_ops_shared.status_code == 200
    assert player_a_turn_payload["event_id"] not in alternate_ops_shared.json()["shared_world_context"]["trace"]["source_event_ids"]
    alternate_ops_history = client.get("/ops/worlds/alternate_reference_world/history?level=local_rumor", headers=ops_headers)
    assert alternate_ops_history.status_code == 200
    assert player_a_turn_payload["event_id"] not in [item["source_event_id"] for item in alternate_ops_history.json()["items"]]
    alternate_ops_titles = client.get("/ops/worlds/alternate_reference_world/titles?status=in_progress", headers=ops_headers)
    assert alternate_ops_titles.status_code == 200
    assert player_a_payload["player_actor_id"] not in [item["actor_id"] for item in alternate_ops_titles.json()["items"]]


def test_title_recognition_reaches_session_and_prompt_context_without_sp_side_effects(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()

    with container.session_factory() as db:
        sp_count_before = db.execute(
            select(func.count(SPLedgerEntry.id)).where(
                SPLedgerEntry.world_id == "gestaloka_reference",
                SPLedgerEntry.actor_id == session_payload["player_actor_id"],
            )
        ).scalar_one()
        for index in range(3):
            turn = Turn(
                world_id="gestaloka_reference",
                session_id=session_payload["session_id"],
                actor_id=session_payload["player_actor_id"],
                input_text=f"recognized harbor help {index}",
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
                location_id=session_payload["location_id"],
                payload={"world_tags": ["aid_local"], "consequence_tags": ["earned_trust"]},
                narrative=f"The player helped the harbor enough to be recognized {index}.",
            )
            db.add(event)
            db.flush()
            apply_shared_consequence_rules(
                db,
                memory_service=container.memory_service,
                world_id="gestaloka_reference",
                actor_id=session_payload["player_actor_id"],
                location_id=session_payload["location_id"],
                source_event_id=event.id,
                world_tags=["aid_local"],
                consequence_tags=["earned_trust"],
                action_kind="narrative",
                interpreted_intent={"consequence_tags": ["earned_trust"]},
            )
        db.commit()

    state_response = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state_response.status_code == 200
    recognized_titles = state_response.json()["recognized_titles"]
    assert any(item["title_rule_id"] == "nexus_stabilizer" and item["status"] == "recognized" for item in recognized_titles)

    with container.session_factory() as db:
        title_progress = db.execute(
            select(ActorTitleProgress).where(
                ActorTitleProgress.world_id == "gestaloka_reference",
                ActorTitleProgress.actor_id == session_payload["player_actor_id"],
                ActorTitleProgress.title_rule_id == "nexus_stabilizer",
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

    prompt_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "free_text",
            "input_text": "Nexus StabilizerとしてNexus Gateの記録を確かめる",
        },
        headers=auth_headers,
    )
    assert prompt_turn.status_code == 200
    generation_inputs = [
        record.get("input") or {}
        for record in container.observability_service._langfuse_client.records
        if record.get("event") == "enter" and record.get("as_type") == "generation"
    ]
    assert any(
        any(item.get("title_rule_id") == "nexus_stabilizer" for item in payload.get("recognized_titles", []))
        for payload in generation_inputs
    )


def test_consequence_rule_engine_tracks_trust_promises_and_setbacks():
    steady = ConsequenceRuleEngine.evaluate(
        ConsequenceRuleInput(
            world_tags=["aid_local"],
            consequence_tags=["earned_trust"],
            relationship_strength=0.55,
            active_threads=[],
        )
    )
    assert steady.outcome_band == "steady"
    assert steady.relationship_delta > 0
    assert steady.thread_action == "none"

    reward_item = ConsequenceRuleEngine.evaluate(
        ConsequenceRuleInput(
            world_tags=["collect_reward"],
            consequence_tags=["reward_item_respect"],
            relationship_strength=0.55,
            active_threads=[ConsequenceThreadSnapshot(thread_type="promise", status="active", pressure_band="medium")],
        )
    )
    assert reward_item.outcome_band == "steady"
    assert reward_item.thread_type == "promise"
    assert reward_item.thread_action == "resolved"
    assert reward_item.relationship_delta > 0

    tangled = ConsequenceRuleEngine.evaluate(
        ConsequenceRuleInput(
            world_tags=["promise_followup"],
            consequence_tags=["missed_timing"],
            relationship_strength=0.6,
            active_threads=[],
        )
    )
    assert tangled.outcome_band == "tangled"
    assert tangled.thread_type == "promise"
    assert tangled.thread_action == "opened"

    setback = ConsequenceRuleEngine.evaluate(
        ConsequenceRuleInput(
            world_tags=["none"],
            consequence_tags=["overreach"],
            relationship_strength=0.6,
            active_threads=[],
        )
    )
    assert setback.outcome_band == "setback"
    assert setback.thread_type == "scrutiny"
    assert setback.relationship_delta < 0
