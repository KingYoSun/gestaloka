from __future__ import annotations

from sqlalchemy import func, select

from app.models.entities import Actor, Item, Memory, NPCProfile, OutboxEvent, ProjectionRecord, QuestAssignment, Turn
from app.modules.world_memory.service import build_retrieval_query_text


def test_turn_flow_materializes_memory_and_projection(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()

    first_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200
    first_payload = first_turn.json()
    assert first_payload["sp_balance"] == 9
    assert first_payload["quest_updates"][0]["progress"] == 1
    assert first_payload["inventory_updates"] == []

    second_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "choice",
            "choice_id": "progress",
        },
        headers=auth_headers,
    )
    assert second_turn.status_code == 200
    second_payload = second_turn.json()
    assert "旅人を助け" in second_payload["npc_reaction"]
    assert second_payload["sp_balance"] == 8
    assert second_payload["quest_updates"][0]["progress"] == 2
    assert second_payload["inventory_updates"][0]["template_key"] == "lantern_sigils"
    assert second_payload["relationship_updates"][0]["band"] == "warm"

    state_after_reward = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state_after_reward.status_code == 200
    reward_item = state_after_reward.json()["inventory"][0]
    assert reward_item["usable"] is True
    assert reward_item["effect_kind"] == "unlock_followup_watch_path"
    assert state_after_reward.json()["relationships"][0]["band"] == "warm"
    assert state_after_reward.json()["chapter"]["key"] == "founders_watch_opening"
    assert state_after_reward.json()["current_scene"]["summary"]
    assert state_after_reward.json()["current_location"]["key"] == "square"
    assert len(state_after_reward.json()["local_figures"]) >= 1
    assert any(item["destination_key"] == "archive_steps" for item in state_after_reward.json()["nearby_routes"])
    assert state_after_reward.json()["recent_world_beats"]

    assert state_after_reward.json()["next_choices"][1]["action_kind"] == "use_reward_item"

    use_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert use_turn.status_code == 200
    use_payload = use_turn.json()
    assert use_payload["action_type"] == "use_reward_item"
    assert use_payload["sp_balance"] == 7
    assert use_payload["quest_updates"][0]["stage_key"] == "watch_path_followup"
    assert use_payload["inventory_updates"][0]["status"] == "used"
    assert use_payload["faction_updates"][0]["delta"] == 0.1
    assert use_payload["chapter_updates"][-1]["key"] == "watch_path_followup"
    assert use_payload["scene_updates"]
    assert use_payload["current_location"]["key"] == "square"

    post_use_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_use_state.status_code == 200
    assert any(item["destination_key"] == "watch_path" and item["available"] for item in post_use_state.json()["nearby_routes"])
    assert post_use_state.json()["next_choices"][1]["action_kind"] == "travel"

    travel_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "choice",
            "choice_id": "progress",
        },
        headers=auth_headers,
    )
    assert travel_turn.status_code == 200
    travel_payload = travel_turn.json()
    assert travel_payload["action_type"] == "travel"
    assert travel_payload["sp_balance"] == 6
    assert travel_payload["current_location"]["key"] == "watch_path"
    assert travel_payload["location_updates"]
    assert travel_payload["travel_summary"]

    third_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "free_text",
            "input_text": "Watch Pathで灯の余韻と見回りの気配を観察する",
        },
        headers=auth_headers,
    )
    assert third_turn.status_code == 200
    third_payload = third_turn.json()
    assert third_payload["sp_balance"] == 3
    assert "watch" in third_payload["npc_reaction"].lower() or "巡回" in third_payload["npc_reaction"]
    assert third_payload["scene_summary"]
    assert third_payload["ambient_updates"]
    assert third_payload["recent_world_beats"]

    events = client.get(f"/worlds/{session_payload['world_id']}/events", headers=auth_headers)
    memories = client.get(f"/worlds/{session_payload['world_id']}/memories", headers=auth_headers)
    state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert events.status_code == 200
    assert memories.status_code == 200
    assert state.status_code == 200
    assert len(events.json()["items"]) >= 10
    assert events.json()["items"][-1]["event_type"] == "session.started"
    assert any(item["event_type"].startswith("ambient.npc.") for item in events.json()["items"])
    assert any(item["event_type"] == "travel.arrived" for item in events.json()["items"])
    assert any("旅人を助け" in item["text"] for item in memories.json()["items"])
    assert any("Lantern Sigil" in item["text"] for item in memories.json()["items"])
    assert any("Watch Path" in item["text"] for item in memories.json()["items"])
    assert state.json()["quests"][0]["stage_key"] == "watch_path_followup"
    assert state.json()["inventory"][0]["status"] == "used"
    assert state.json()["chapter"]["key"] == "watch_path_followup"
    assert state.json()["recent_scene_history"]
    assert state.json()["recent_world_beats"]
    assert state.json()["current_location"]["key"] == "watch_path"
    assert "watch path" in state.json()["current_scene"]["summary"].lower()

    with container.session_factory() as db:
        pending = list(db.execute(select(OutboxEvent).where(OutboxEvent.status == "projected")).scalars())
        projected = list(db.execute(select(ProjectionRecord)).scalars())
        assignments = list(db.execute(select(QuestAssignment)).scalars())
        items = list(db.execute(select(Item)).scalars())
        assert pending
        assert projected
        assert {assignment.status for assignment in assignments} >= {"completed"}
        assert any(assignment.status == "active" for assignment in assignments)
        assert items[0].template_key == "lantern_sigils"
        assert items[0].status == "used"
        assert items[0].used_event_id is not None
        projected_count = db.execute(select(func.count(ProjectionRecord.id))).scalar_one()

        processed_again = container.projection_service.process_pending(db)
        db.commit()
        assert processed_again == []
        assert db.execute(select(func.count(ProjectionRecord.id))).scalar_one() == projected_count

        rebuilt = container.projection_service.rebuild(db, session_payload["world_id"])
        db.commit()
        assert rebuilt


def test_consequence_threads_affect_state_and_fail_forward_without_422(client, auth_headers):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-threads", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    session_payload = session_response.json()

    progress = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert progress.status_code == 200

    promise_delay = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "free_text",
            "input_text": "今は行かない。あとで約束には応える。",
        },
        headers=auth_headers,
    )
    assert promise_delay.status_code == 200
    promise_payload = promise_delay.json()
    assert promise_payload["scene_tone"] == "uneasy"
    assert promise_payload["consequence_updates"]
    assert promise_payload["consequence_updates"][0]["status"] == "active"

    state_after_delay = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert state_after_delay.status_code == 200
    assert state_after_delay.json()["active_consequence_threads"]
    assert any("約束" in item["summary"] or "promise" in item["summary"].lower() for item in state_after_delay.json()["active_consequence_threads"])
    assert state_after_delay.json()["ambient_murmurs"]
    assert any("rumor" in item.lower() or "promise" in item.lower() or "約束" in item for item in state_after_delay.json()["recent_world_beats"])

    impossible = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "free_text",
            "input_text": "空を飛んで塔の上に瞬間移動する",
        },
        headers=auth_headers,
    )
    assert impossible.status_code == 200
    impossible_payload = impossible.json()
    assert impossible_payload["scene_tone"] == "tense"
    assert impossible_payload["consequence_updates"]
    assert impossible_payload["relationship_updates"][0]["band"] in {"wary", "neutral"}
    assert impossible_payload["scene_summary"]


def test_reward_item_memory_is_retrieved_on_followup_turn_and_worker_backfill_can_recover(container, client, auth_headers, monkeypatch):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-alpha", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    session_payload = session_response.json()

    first_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert first_turn.status_code == 200

    second_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "choice",
            "choice_id": "progress",
        },
        headers=auth_headers,
    )
    assert second_turn.status_code == 200

    reward_item_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers).json()
    reward_item = reward_item_state["inventory"][0]
    use_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert use_turn.status_code == 200

    travel_turn = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert travel_turn.status_code == 200
    assert travel_turn.json()["action_type"] == "travel"

    followup_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "free_text",
            "input_text": "Watch Pathで灯の余韻と見回りの気配を観察する",
        },
        headers=auth_headers,
    )
    assert followup_turn.status_code == 200

    with container.session_factory() as db:
        resolved_turn = db.execute(select(Turn).where(Turn.id == followup_turn.json()["turn_id"])).scalar_one()
        retrieval_trace = resolved_turn.resolved_output["retrieval_trace"]
        assert retrieval_trace["status"] == "ready"
        assert len(retrieval_trace["retrieved_memory_ids"]) >= 1
        assert any(score >= container.settings.memory_retrieval_min_score for score in retrieval_trace["top_scores"])
        retrieved_texts = [
            db.execute(select(Memory).where(Memory.id == memory_id)).scalar_one().text
            for memory_id in retrieval_trace["retrieved_memory_ids"]
        ]
        assert any("Lantern Sigil" in text for text in retrieved_texts)

    original_embed_document = container.memory_service.provider.embed_document
    original_embed_query = container.memory_service.provider.embed_query

    def fail_embed_document(text: str) -> list[float]:
        raise RuntimeError(f"embedding unavailable for {text}")

    def fail_embed_query(text: str) -> list[float]:
        raise RuntimeError(f"query embedding unavailable for {text}")

    monkeypatch.setattr(container.memory_service.provider, "embed_document", fail_embed_document)
    monkeypatch.setattr(container.memory_service.provider, "embed_query", fail_embed_query)
    degraded_turn = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "free_text",
            "input_text": "Lantern Sigilで開いた巡回路の様子をさらに確かめる",
        },
        headers=auth_headers,
    )
    assert degraded_turn.status_code == 200

    with container.session_factory() as db:
        pending = list(db.execute(select(Memory).where(Memory.embedding_status == "pending")).scalars())
        assert pending
        degraded_turn_record = db.execute(select(Turn).where(Turn.id == degraded_turn.json()["turn_id"])).scalar_one()
        assert degraded_turn_record.resolved_output["retrieval_trace"]["status"] == "degraded"
        retrieval = container.memory_service.search(
            db,
            world_id=session_payload["world_id"],
            query_text=build_retrieval_query_text("Lantern Sigilで開いた巡回路の様子をさらに確かめる"),
        )
        assert retrieval.trace.status == "degraded"

    monkeypatch.setattr(container.memory_service.provider, "embed_document", original_embed_document)
    monkeypatch.setattr(container.memory_service.provider, "embed_query", original_embed_query)
    with container.session_factory() as db:
        processed = container.memory_service.process_pending(db, world_id=session_payload["world_id"], limit=16)
        db.commit()
        assert processed
        refreshed = container.memory_service.search(
            db,
            world_id=session_payload["world_id"],
            query_text=build_retrieval_query_text("Lantern Sigilで開いた巡回路の様子をさらに確かめる"),
        )
        assert refreshed.trace.status == "ready"
        assert refreshed.trace.retrieved_memory_ids


def test_manual_idle_world_pass_updates_offstage_state_without_mutating_progression(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json={"world_id": "world-idle", "world_name": "Founders Reach"},
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()

    pre_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert pre_state.status_code == 200
    pre_payload = pre_state.json()

    with container.session_factory() as db:
        npc_rows = list(
            db.execute(
                select(Actor, NPCProfile)
                .join(NPCProfile, (NPCProfile.actor_id == Actor.id) & (NPCProfile.world_id == Actor.world_id))
                .where(Actor.world_id == session_payload["world_id"], Actor.actor_type == "npc")
                .order_by(Actor.created_at.asc(), Actor.id.asc())
            ).all()
        )
        assert len(npc_rows) == 3
        before_locations = {actor.id: actor.current_location_id for actor, _ in npc_rows}
        for _, profile in npc_rows:
            routine_state = profile.routine_state or {}
            assert {
                "home_location_id",
                "active_location_id",
                "routine_role",
                "beat_state",
                "attention_target_actor_id",
                "last_ambient_turn_id",
                "last_idle_tick_id",
                "rumor_focus",
                "tension_band",
            } <= set(routine_state)

    idle_response = client.post(f"/ops/worlds/{session_payload['world_id']}/idle-pass", headers=auth_headers)
    assert idle_response.status_code == 200
    idle_payload = idle_response.json()
    assert idle_payload["tick"]["status"] == "completed"
    assert len(idle_payload["idle_updates"]) <= 2

    world_ticks = client.get(f"/ops/worlds/{session_payload['world_id']}/world-ticks", headers=auth_headers)
    npc_locations = client.get(f"/ops/worlds/{session_payload['world_id']}/npc-locations", headers=auth_headers)
    offstage_beats = client.get(f"/ops/worlds/{session_payload['world_id']}/offstage-beats", headers=auth_headers)
    assert world_ticks.status_code == 200
    assert npc_locations.status_code == 200
    assert offstage_beats.status_code == 200
    assert world_ticks.json()["items"]
    assert len(npc_locations.json()["items"]) == 3
    assert offstage_beats.json()["items"]

    post_state = client.get(f"/sessions/{session_payload['session_id']}/state", headers=auth_headers)
    assert post_state.status_code == 200
    post_payload = post_state.json()
    assert post_payload["quests"][0]["progress"] == pre_payload["quests"][0]["progress"]
    assert post_payload["quests"][0]["stage_key"] == pre_payload["quests"][0]["stage_key"]
    assert post_payload["inventory"] == pre_payload["inventory"]
    assert post_payload["chapter"]["key"] == pre_payload["chapter"]["key"]
    assert post_payload["npc_locations"]
    assert post_payload["recent_offstage_beats"]

    with container.session_factory() as db:
        npc_rows = list(
            db.execute(
                select(Actor, NPCProfile)
                .join(NPCProfile, (NPCProfile.actor_id == Actor.id) & (NPCProfile.world_id == Actor.world_id))
                .where(Actor.world_id == session_payload["world_id"], Actor.actor_type == "npc")
                .order_by(Actor.created_at.asc(), Actor.id.asc())
            ).all()
        )
        moved_count = sum(1 for actor, _ in npc_rows if before_locations.get(actor.id) != actor.current_location_id)
        assert moved_count <= 1
        assert not any(
            actor.display_name == "Lamplighter Sera" and before_locations.get(actor.id) != actor.current_location_id
            for actor, _ in npc_rows
        )
        assert any((_profile.routine_state or {}).get("last_idle_tick_id") for _, _profile in npc_rows)
