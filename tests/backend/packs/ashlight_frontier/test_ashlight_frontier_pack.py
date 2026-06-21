from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select

from app.models.entities import Actor, Event, Location, LocationRoute, QuestAssignment, World
from app.modules.world_state.service import _route_accessible, apply_active_quest_resolution


REPO_ROOT = next(parent for parent in Path(__file__).resolve().parents if (parent / "AGENTS.md").exists())
PACK_DIR = REPO_ROOT / "packs" / "ashlight_frontier"


def ashlight_session_payload() -> dict[str, str]:
    return {
        "world_id": "ashlight_frontier",
        "pack_id": "ashlight_frontier",
        "world_template_id": "ashlight_frontier_foundation",
        "world_name": "灰灯の辺境: Ashlight Frontier",
        "player_display_name": "Demo Player",
    }


def _pack_text() -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in sorted(PACK_DIR.glob("*.yaml")))


def test_session_can_start_from_ashlight_frontier_pack(client, container, auth_headers):
    response = client.post("/sessions", json=ashlight_session_payload(), headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["pack_id"] == "ashlight_frontier"
    assert payload["world_template_id"] == "ashlight_frontier_foundation"
    assert payload["world_id"] == "ashlight_frontier"

    state = client.get(f"/sessions/{payload['session_id']}/state", headers=auth_headers)
    assert state.status_code == 200
    state_payload = state.json()
    assert state_payload["current_location"]["key"] == "lieber_lampfort"
    assert state_payload["current_location"]["name"] == "リーベル灯砦"
    assert state_payload["world_pack"]["pack_id"] == "ashlight_frontier"
    assert state_payload["world_pack"]["followup_location_name"] == "Mistbound Frontier"
    assert state_payload["world_pack"]["followup_branches"]["formal_path"]["branch_key"] == "lantern_guild_mandate"
    assert state_payload["world_pack"]["followup_branches"]["undercurrent_path"]["branch_key"] == "mist_witch_compact"

    nearby_destination_keys = {route["destination_key"] for route in state_payload["nearby_routes"]}
    assert {"adventurers_guild_hall", "lampfort_outer_gate"} & nearby_destination_keys
    gate_route = next(route for route in state_payload["nearby_routes"] if route["destination_key"] == "lampfort_outer_gate")
    assert "灯砦外門" in gate_route["destination_aliases"]["ja"]
    assert "Lampfort Outer Gate" in gate_route["destination_aliases"]["en"]

    choices = state_payload["suggested_actions"]
    assert [choice["label"] for choice in choices] == [
        "ギルド受付に、いま多い相談の傾向を聞く",
        "掲示板を眺め、自分が気になる問題の方向を探す",
        "町の外縁から、灯りと夜霧の境界を見る",
    ]
    assert all("依頼リスト" not in choice["label"] for choice in choices)

    story = client.get(f"/sessions/{payload['session_id']}/story", headers=auth_headers)
    assert story.status_code == 200
    opening = story.json()["items"][0]
    assert any(term in opening["narrative"] for term in ("リーベル灯砦", "夜霧", "冒険者ギルド"))
    forbidden_opening_terms = [
        "街道灯が消えた",
        "薬草採りが帰ってこない",
        "古井戸の底から子どもの声",
        "三つの依頼",
        "3つの依頼",
        "森で失踪",
        "井戸から声",
        "灯標が消えた",
    ]
    assert not any(term in opening["narrative"] for term in forbidden_opening_terms)

    with container.session_factory() as db:
        world = db.execute(select(World).where(World.id == "ashlight_frontier")).scalar_one()
        assert world.state["pack_id"] == "ashlight_frontier"
        assert world.state["world_template_id"] == "ashlight_frontier_foundation"

        locations = {
            (location.state or {}).get("key"): location
            for location in db.execute(select(Location).where(Location.world_id == "ashlight_frontier")).scalars()
        }
        assert "リーベル灯砦" in locations["lieber_lampfort"].state["public_aliases"]["ja"]
        assert "灯砦外門" in locations["lampfort_outer_gate"].state["public_aliases"]["ja"]

        seed_npcs = list(
            db.execute(
                select(Actor).where(
                    Actor.world_id == "ashlight_frontier",
                    Actor.actor_type == "npc",
                    Actor.origin_kind == "pack_seed",
                )
            ).scalars()
        )
        seed_names = {npc.display_name for npc in seed_npcs}
        assert seed_names == {
            "Guild Receptionist Elna",
            "Lamp Warden Orwin",
            "Sister Liora",
            "Rook the Free Merchant",
            "Old Nera",
        }
        assert not any("Herbalist" in name or "Missing" in name for name in seed_names)

        quests = list(
            db.execute(
                select(QuestAssignment).where(
                    QuestAssignment.world_id == "ashlight_frontier",
                    QuestAssignment.owner_actor_id == payload["player_actor_id"],
                )
            ).scalars()
        )
        assert len(quests) == 1
        assert quests[0].quest_template_id.endswith(":first_attention")
        assert "missing" not in json.dumps(quests[0].state_json or {}, ensure_ascii=False).lower()


def test_ashlight_pack_data_has_generation_grammar_without_fixed_incident_candidates():
    text = _pack_text()
    forbidden_fragments = [
        "missing_herbalist",
        "road_lamp_anomaly",
        "voice_from_old_well",
        "extinguished western road lamp",
        "haunted well",
        "Herbalist Mina",
    ]
    assert not any(fragment in text for fragment in forbidden_fragments)

    assert "situation_grammar" in text
    assert "rumor_grammar" in text
    assert "quest_generation_constraints" in text
    assert "must_arise_from_player_attention" in text


def test_resolving_opening_thread_unlocks_mistbound_access_emergently(client, container, auth_headers):
    """Issue #3 / ADR-003 regression: exploration-driven resolution of the opening thread
    makes the Mistbound Frontier reachable without a fixed reward-item unlock spine.

    This is the end-to-end shape of the deadlock fix: a player who never uses a "key" item
    still reaches the next area once the AI GM judges the opening thread resolved.
    """
    created = client.post("/sessions", json=ashlight_session_payload(), headers=auth_headers)
    assert created.status_code == 200
    payload = created.json()
    actor_id = payload["player_actor_id"]
    world_id = "ashlight_frontier"

    with container.session_factory() as db:
        locked_route = (
            db.execute(
                select(LocationRoute).where(
                    LocationRoute.world_id == world_id,
                    LocationRoute.status == "locked",
                )
            )
            .scalars()
            .first()
        )
        assert locked_route is not None, "ashlight seeds locked routes into the Mistbound Frontier"
        # Access is now world-state driven, not item-key driven.
        assert (locked_route.unlock_requirements_json or {}).get("requires_resolved_stage") == "first_attention"
        assert "starter_item_effect" not in (locked_route.unlock_requirements_json or {})
        assert _route_accessible(db, world_id=world_id, route=locked_route, actor_id=actor_id) is False

        source_event = (
            db.execute(
                select(Event)
                .where(Event.world_id == world_id, Event.session_id == payload["session_id"])
                .order_by(Event.created_at.asc(), Event.id.asc())
            )
            .scalars()
            .first()
        )
        assert source_event is not None

        resolution = apply_active_quest_resolution(
            db,
            world_id=world_id,
            actor_id=actor_id,
            source_event_id=source_event.id,
            resolution={"resolved": True, "summary": "A first thread of attention is chosen."},
            summary="",
        )
        db.commit()
        assert resolution["quest_updates"], "the opening thread should resolve"
        assert resolution["quest_updates"][0]["status"] == "completed"

        db.refresh(locked_route)
        # Emergent access: the frontier opens once the opening thread is resolved.
        assert _route_accessible(db, world_id=world_id, route=locked_route, actor_id=actor_id) is True
