from __future__ import annotations

from sqlalchemy import func, select

from app.models.entities import ChapterTrack, CharacterSheet, Faction, FactionStanding, QuestAssignment, QuestTemplate, SceneFrame
from app.modules.world_state.consequence import ConsequenceRuleEngine, ConsequenceRuleInput, ConsequenceThreadSnapshot
from app.modules.world_state.rules import QuestRuleEngine, QuestRuleInput


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
        assert db.execute(select(func.count(Faction.id))).scalar_one() == 1
        assert db.execute(select(func.count(QuestTemplate.id))).scalar_one() == 2
        assert db.execute(select(func.count(QuestAssignment.id))).scalar_one() == 1
        assert db.execute(select(func.count(CharacterSheet.actor_id))).scalar_one() == 1
        assert db.execute(select(func.count(FactionStanding.actor_id))).scalar_one() == 1
        assert db.execute(select(func.count(ChapterTrack.id))).scalar_one() == 1
        assert db.execute(select(func.count(SceneFrame.id))).scalar_one() == 1


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
