from __future__ import annotations

from sqlalchemy import select

from app.models.entities import QuestAssignment, QuestTemplate, Turn
from app.modules.llm_harness.service import PromptExecutionOutcome
from app.modules.world_state.service import evaluate_quest_emergence_gate
from tests.backend.turn_async_helpers import post_turn_and_wait


def _state(**overrides):
    payload = {
        "quests": [],
        "quest_journal": [],
        "current_location": {"name": "ネクサス市", "description": "来訪者ログと公開掲示が集まる基点都市。"},
        "shared_world_context": {
            "world_axes": [{"axis_id": "visitor_resonance", "summary": "来訪者の足跡が不安定に増えている。"}],
            "faction_pressure": [{"name": "記録自治局", "summary": "公開記録の混線を警戒している。"}],
        },
        "pack_generation_context": {
            "quest_emergence_policy": {
                "require_player_attention_basis": True,
                "require_uncertainty": True,
                "require_first_step": True,
                "reject_single_action_quests": True,
                "suppress_primary_offer_when_live_quest_exists": True,
            }
        },
    }
    payload.update(overrides)
    return payload


def _offer(**overrides):
    payload = {
        "title": "来訪者ログの混線を追う",
        "description": "ネクサス市で不明な来訪者ログ混線を調査し、まず公開登録所で欠落した記録の手がかりを確認する。",
        "offered_summary": "来訪者ログ混線の調査が始められる。",
        "outcome_basis": {
            "player_attention": "プレイヤーが近くで困っている人に関わりたいと示した。",
            "current_location": "ネクサス市",
            "uncertainty": "混線の原因はまだ不明。",
            "first_step": "公開登録所で欠落記録を確認する。",
            "why_now": "登録所で新しい混線が表面化した。",
        },
    }
    payload.update(overrides)
    return payload


def _gate(offer, **overrides):
    params = {
        "session_state": _state(),
        "offer": offer,
        "player_action_text": "人助けがしたい。近くで困っている人に関わりたい",
        "resolution_summary": "ネクサス市で困りごとの気配を探した。",
        "is_followup": False,
        "has_live_primary_quest": False,
        "followup_of_assignment_id": None,
    }
    params.update(overrides)
    return evaluate_quest_emergence_gate(**params)


def test_gate_rejects_no_offer():
    result = _gate(None)

    assert result["allowed"] is False
    assert result["reason_code"] == "no_offer"


def test_gate_rejects_missing_title_or_description():
    missing_title = _gate(_offer(title=""))
    missing_description = _gate(_offer(description="", summary=""))

    assert missing_title["reason_code"] == "missing_title_or_description"
    assert missing_description["reason_code"] == "missing_title_or_description"


def test_gate_rejects_live_primary_quest():
    result = _gate(
        _offer(),
        session_state=_state(quests=[{"title": "既存の依頼", "status": "active", "description": "進行中。"}]),
        has_live_primary_quest=True,
    )

    assert result["allowed"] is False
    assert result["reason_code"] == "live_primary_quest_exists"


def test_gate_rejects_resolution_repeat():
    result = _gate(
        _offer(title="掲示板を確認した", description="掲示板を確認した"),
        resolution_summary="掲示板を確認した",
    )

    assert result["allowed"] is False
    assert result["reason_code"] == "repeats_resolution"


def test_gate_rejects_missing_player_attention_basis():
    result = _gate(
        _offer(
            title="記録倉庫の異常",
            description="ネクサス市の記録倉庫にある不明な異常を調査し、まず保管棚を確認する。",
            outcome_basis={"current_location": "ネクサス市", "uncertainty": "原因不明", "first_step": "保管棚を確認する。"},
        ),
        player_action_text="空を見上げる",
    )

    assert result["allowed"] is False
    assert result["reason_code"] in {"lacks_player_attention_basis", "not_enough_context"}


def test_gate_rejects_single_next_action_and_broad_observation():
    single_action = _gate(_offer(title="掲示板を見る", description="掲示板を見る。"))
    broad = _gate(_offer(title="世界を探索する", description="この世界を探索して情報を集める。", outcome_basis={}))

    assert single_action["allowed"] is False
    assert single_action["reason_code"] == "too_early_broad_observation"
    assert broad["allowed"] is False
    assert broad["reason_code"] == "too_abstract"


def test_gate_rejects_too_conclusive_offer():
    result = _gate(
        _offer(
            title="真犯人を倒す",
            description="真犯人が記録官だと判明したので、最終解決として倒す。",
        )
    )

    assert result["allowed"] is False
    assert result["reason_code"] == "too_conclusive"


def test_gate_allows_grounded_primary_offer():
    result = _gate(_offer())

    assert result["allowed"] is True
    assert result["reason_code"] == "allowed"
    assert result["basis"]["player_attention"] is True
    assert result["basis"]["uncertainty"] is True
    assert result["basis"]["first_step"] is True


def test_gate_allows_valid_followup_offer():
    result = _gate(
        _offer(title="混線の余波を追う"),
        is_followup=True,
        followup_of_assignment_id="quest-assignment-1",
    )

    assert result["allowed"] is True
    assert result["reason_code"] == "allowed_followup"


def test_gate_rejects_followup_without_source():
    result = _gate(_offer(title="混線の余波を追う"), is_followup=True, followup_of_assignment_id=None)

    assert result["allowed"] is False
    assert result["reason_code"] == "followup_source_missing"


def test_public_turn_persists_only_gate_allowed_dynamic_quest_offer(client, container, auth_headers, monkeypatch):
    original_execute = container.model_router.execute_structured_prompt

    def force_grounded_public_turn(*args, **kwargs):
        prompt_id = kwargs.get("prompt_id") or (args[0] if args else "")
        if prompt_id != "session.turn_resolution":
            return original_execute(*args, **kwargs)
        response_model = kwargs["response_model"]
        input_payload = kwargs.get("input_payload") or {}
        payload = response_model.model_validate(
            {
                "action_interpretation": "近くで困っている人に関わりたい",
                "narrative": "プレイヤーはネクサス市で、公開登録所の混線に困る人々へ関わる姿勢を示した。",
                "npc_reaction": "案内役は、公開登録所で欠落記録の確認から始められると告げる。",
                "current_situation": "ネクサス市の公開登録所で、来訪者ログの混線が表面化している。",
                "current_location_name": "ネクサス市",
                "public_claims": [{"kind": "location", "surface_text": "ネクサス市", "role": "current_location"}],
                "suggested_actions": [
                    {"label": "公開登録所で欠落記録を確認する", "summary": "混線の最初の手がかりを調べる。"},
                    {"label": "困っている記録係に話を聞く", "summary": "誰が影響を受けたかを確かめる。"},
                    {"label": "掲示された混線ログを読む", "summary": "公開情報だけを照合する。"},
                ],
                "consequence_summary": "ネクサス市で来訪者ログ混線への関心が明確になった。",
                "internal_summary": "Player committed attention to a grounded unresolved visitor-log thread.",
                "consequence_tags": ["careful_observation"],
                "world_tags": ["investigate"],
                "shared_action_tag": "investigate",
                "state_drafts": {},
                "branch_signals": [],
                "outcome_band": "steady",
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "medium",
                "memories": [
                    {
                        "scope": "world",
                        "text": "ネクサス市で来訪者ログ混線への関心が明確になった。",
                        "salience": 0.7,
                    }
                ],
                "quest_offer": _offer(),
            },
            context={"input_payload": input_payload},
        )
        return PromptExecutionOutcome(attempts=[], final_lane="forced-test", final_payload=payload)

    monkeypatch.setattr(container.model_router, "execute_structured_prompt", force_grounded_public_turn)
    session_response = client.post(
        "/sessions",
        json={
            "world_id": "gestaloka_world_reference",
            "world_name": "GESTALOKA: Layered World Foundation",
            "player_display_name": "Demo Player",
        },
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()
    with container.session_factory() as db:
        for assignment in db.execute(
            select(QuestAssignment).where(
                QuestAssignment.world_id == session_payload["world_id"],
                QuestAssignment.owner_actor_id == session_payload["player_actor_id"],
                QuestAssignment.status.in_(("offered", "active", "paused")),
            )
        ).scalars():
            assignment.status = "completed"
        db.commit()

    _, turn_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_text": "人助けがしたい。近くで困っている人に関わりたい"},
    )

    offered_updates = [item for item in turn_payload["quest_updates"] if item.get("action") == "offered"]
    assert len(offered_updates) == 1
    assert offered_updates[0]["status"] == "offered"

    with container.session_factory() as db:
        assignment = db.execute(
            select(QuestAssignment).where(
                QuestAssignment.world_id == session_payload["world_id"],
                QuestAssignment.owner_actor_id == session_payload["player_actor_id"],
                QuestAssignment.status == "offered",
            )
        ).scalar_one()
        template = db.execute(
            select(QuestTemplate).where(
                QuestTemplate.world_id == session_payload["world_id"],
                QuestTemplate.id == assignment.quest_template_id,
            )
        ).scalar_one()
        latest_turn = db.execute(select(Turn).where(Turn.id == turn_payload["turn_id"])).scalar_one()

    assert template.state["dynamic"] is True
    assert assignment.state_json["dynamic"] is True
    assert latest_turn.resolved_output["quest_emergence_gate"]["primary"]["allowed"] is True
