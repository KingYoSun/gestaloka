from __future__ import annotations

from sqlalchemy import func, select

from app.models.entities import (
    ActorTitleProgress,
    ChapterTrack,
    CharacterSheet,
    Faction,
    FactionStanding,
    Location,
    Memory,
    ProjectionRecord,
    QuestAssignment,
    QuestTemplate,
    SharedConsequenceApplication,
    SharedHistoryRecord,
    WorldAxisState,
    SceneFrame,
)
from app.modules.world_state.consequence import ConsequenceRuleEngine, ConsequenceRuleInput, ConsequenceThreadSnapshot
from app.modules.world_state.rules import QuestRuleEngine, QuestRuleInput
from app.modules.world_state.shared_consequence import apply_shared_consequence_rules


def engine_session_payload() -> dict[str, str]:
    return {
        "world_id": "ember_harbor",
        "world_name": "Ember Harbor",
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
        json=engine_session_payload(),
        headers=auth_headers,
    )

    assert first.status_code == 200
    assert second.status_code == 200

    with container.session_factory() as db:
        assert db.execute(select(func.count(Faction.id))).scalar_one() == 3
        assert db.execute(select(func.count(QuestTemplate.id))).scalar_one() == 2
        assert db.execute(select(func.count(QuestAssignment.id))).scalar_one() == 1
        assert db.execute(select(func.count(CharacterSheet.actor_id))).scalar_one() == 1
        assert db.execute(select(func.count(FactionStanding.actor_id))).scalar_one() == 3
        assert db.execute(select(func.count(ChapterTrack.id))).scalar_one() == 1
        assert db.execute(select(func.count(SceneFrame.id))).scalar_one() == 1
        assert db.execute(select(func.count(WorldAxisState.axis_id))).scalar_one() == 3
        quay = next(
            location
            for location in db.execute(select(Location).where(Location.world_id == "ember_harbor")).scalars()
            if location.state["key"] == "quay"
        )
        assert quay.state["public_state"]["public_trust"] == 1


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
                WorldAxisState.world_id == "ember_harbor",
                WorldAxisState.axis_id == "harbor_stability",
            )
        ).scalar_one()
        assert axis.current_value == 58
        assert axis.last_event_id == turn_payload["event_id"]

        primary_standing = db.execute(
            select(FactionStanding).where(
                FactionStanding.world_id == "ember_harbor",
                FactionStanding.actor_id == session_payload["player_actor_id"],
                FactionStanding.faction_id == "ember_harbor:ember_wardens",
            )
        ).scalar_one()
        assert primary_standing.standing > 0

        quay = next(
            location
            for location in db.execute(select(Location).where(Location.world_id == "ember_harbor")).scalars()
            if location.state["key"] == "quay"
        )
        assert quay.state["public_state"]["public_trust"] == 2

        assert db.execute(
            select(func.count(Memory.id)).where(
                Memory.world_id == "ember_harbor",
                Memory.source_event_id == turn_payload["event_id"],
                Memory.text.contains("steady the quay"),
            )
        ).scalar_one() >= 1
        assert db.execute(
            select(func.count(SharedHistoryRecord.id)).where(
                SharedHistoryRecord.world_id == "ember_harbor",
                SharedHistoryRecord.source_event_id == turn_payload["event_id"],
                SharedHistoryRecord.status == "candidate",
            )
        ).scalar_one() == 1
        title_progress = db.execute(
            select(ActorTitleProgress).where(
                ActorTitleProgress.world_id == "ember_harbor",
                ActorTitleProgress.actor_id == session_payload["player_actor_id"],
                ActorTitleProgress.title_rule_id == "harbor_seal_bearer",
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
            world_id="ember_harbor",
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
                WorldAxisState.world_id == "ember_harbor",
                WorldAxisState.axis_id == "harbor_stability",
            )
        ).scalar_one() == axis_before

        rebuilt = container.projection_service.rebuild(db, "ember_harbor")
        labels = {item["label"] for item in rebuilt}
        assert {"WorldAxis", "SharedHistory", "TitleProgress"} <= labels
        projection_labels = {
            record.payload.get("label")
            for record in db.execute(
                select(ProjectionRecord).where(ProjectionRecord.world_id == "ember_harbor")
            ).scalars()
        }
        assert {"WorldAxis", "SharedHistory", "TitleProgress"} <= projection_labels


def test_shared_consequence_projection_does_not_cross_worlds(client, container, auth_headers):
    ember_session = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    assert ember_session.status_code == 200
    ember_payload = ember_session.json()
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

    with container.session_factory() as db:
        founders_axis_before = {
            axis.axis_id: axis.current_value
            for axis in db.execute(select(WorldAxisState).where(WorldAxisState.world_id == "founders_reach")).scalars()
        }
        founders_memory_before = db.execute(
            select(func.count(Memory.id)).where(Memory.world_id == "founders_reach")
        ).scalar_one()
        founders_projection_before = db.execute(
            select(func.count(ProjectionRecord.id)).where(ProjectionRecord.world_id == "founders_reach")
        ).scalar_one()

    turn_response = client.post(
        "/turns",
        json={"session_id": ember_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200
    turn_payload = turn_response.json()
    assert turn_payload["shared_action_tag"] == "help"

    with container.session_factory() as db:
        founders_axis_after = {
            axis.axis_id: axis.current_value
            for axis in db.execute(select(WorldAxisState).where(WorldAxisState.world_id == "founders_reach")).scalars()
        }
        assert founders_axis_after == founders_axis_before
        assert db.execute(
            select(func.count(Memory.id)).where(Memory.world_id == "founders_reach")
        ).scalar_one() == founders_memory_before
        assert db.execute(
            select(func.count(ProjectionRecord.id)).where(ProjectionRecord.world_id == "founders_reach")
        ).scalar_one() == founders_projection_before
        assert db.execute(
            select(func.count(Memory.id)).where(
                Memory.world_id == "founders_reach",
                Memory.source_event_id == turn_payload["event_id"],
            )
        ).scalar_one() == 0
        assert db.execute(
            select(func.count(SharedHistoryRecord.id)).where(
                SharedHistoryRecord.world_id == "founders_reach",
                SharedHistoryRecord.source_event_id == turn_payload["event_id"],
            )
        ).scalar_one() == 0
        assert db.execute(
            select(func.count(ProjectionRecord.id)).where(
                ProjectionRecord.world_id == "founders_reach",
                ProjectionRecord.event_id == turn_payload["event_id"],
            )
        ).scalar_one() == 0


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
