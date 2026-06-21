from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select

from app.models.entities import Actor, Event, Location, LocationRoute, QuestAssignment, Turn, World
from app.modules.llm_harness.service import ProviderResponse
from app.modules.session.service import (
    _build_canonical_public_alias_index,
    _enrich_public_turn_session_state,
    _match_visible_route_by_public_text,
)
from app.modules.world_state.service import (
    _route_accessible,
    apply_active_quest_resolution,
    build_session_state,
)
from tests.backend.turn_async_helpers import post_turn_and_wait


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


def _guild_receptionist(db) -> Actor:
    """The guide receptionist (Elna) is materialized inside the guild hall, one
    open hop from the hub starter location `lieber_lampfort`."""
    guild_hall = next(
        location
        for location in db.execute(select(Location).where(Location.world_id == "ashlight_frontier")).scalars()
        if (location.state or {}).get("key") == "adventurers_guild_hall"
    )
    guide = db.execute(
        select(Actor).where(
            Actor.world_id == "ashlight_frontier",
            Actor.actor_type == "npc",
            Actor.display_name == "Guild Receptionist Elna",
        )
    ).scalars().first()
    assert guide is not None, "the guild receptionist should be seeded for ashlight_frontier"
    assert guide.current_location_id == guild_hall.id, "Elna lives in the guild hall, not the hub starter node"
    return guide


def test_guild_hall_location_claim_resolves_without_movement_verb(client, container, auth_headers):
    """Issue #4 (I2): a narrative opening choice whose scene the GM places in the
    open-route-adjacent guild hall must resolve as an implicit travel, even
    without an explicit movement verb, instead of being rejected."""
    response = client.post("/sessions", json=ashlight_session_payload(), headers=auth_headers)
    assert response.status_code == 200

    with container.session_factory() as db:
        actor = db.execute(
            select(Actor).where(Actor.world_id == "ashlight_frontier", Actor.actor_type == "player")
        ).scalar_one()
        assert (
            db.execute(select(Location).where(Location.world_id == "ashlight_frontier", Location.id == actor.current_location_id))
            .scalar_one()
            .state["key"]
            == "lieber_lampfort"
        )
        state = build_session_state(
            db,
            world_id="ashlight_frontier",
            actor_id=actor.id,
            location_id=actor.current_location_id,
            include_internal=True,
        )
        state.pop("next_choices", None)
        state = _enrich_public_turn_session_state(
            db,
            world_id="ashlight_frontier",
            actor_id=actor.id,
            session_state=state,
        )
        alias_index = _build_canonical_public_alias_index(db, "ashlight_frontier", state)

        # "眺める" carries no movement verb, but the GM asserting the guild-hall
        # scene as the current location is itself the movement signal.
        route = _match_visible_route_by_public_text(
            db,
            world_id="ashlight_frontier",
            session_state=state,
            claim_text="冒険者ギルド広間",
            player_action_text="掲示板を眺め、自分が気になる問題の方向を探す",
            alias_index=alias_index,
        )
        assert route is not None
        assert route["destination_key"] == "adventurers_guild_hall"

        # Without any location claim and without movement intent, a free-text
        # action must NOT silently teleport the player.
        assert (
            _match_visible_route_by_public_text(
                db,
                world_id="ashlight_frontier",
                session_state=state,
                claim_text="",
                player_action_text="掲示板を眺める",
                alias_index=alias_index,
            )
            is None
        )

        # The strengthened short alias "冒険者ギルド" resolves an explicit move
        # even though the canonical node name is "冒険者ギルド広間".
        partial_alias_route = _match_visible_route_by_public_text(
            db,
            world_id="ashlight_frontier",
            session_state=state,
            claim_text="",
            player_action_text="冒険者ギルドへ向かう",
            alias_index=alias_index,
        )
        assert partial_alias_route is not None
        assert partial_alias_route["destination_key"] == "adventurers_guild_hall"


def test_opening_guild_choice_resolves_via_implicit_adjacent_travel(client, container, auth_headers):
    """Issue #4 (I2) regression: choice_1/choice_2 narrative openings that the GM
    sets inside the guild hall (with the receptionist present) used to fail with
    `repair_failed` because the player starts one open hop away at the hub. They
    must now resolve by implicitly relocating the player into the guild hall."""
    session_response = client.post("/sessions", json=ashlight_session_payload(), headers=auth_headers)
    assert session_response.status_code == 200
    session_id = session_response.json()["session_id"]

    with container.session_factory() as db:
        guide_name = _guild_receptionist(db).display_name

    original_generate = container.model_router.provider.generate

    def guild_scene_generate(**kwargs):
        prompt = kwargs["prompt"]
        if prompt.prompt_id not in {"session.turn_resolution", "session.turn_resolution_repair"}:
            return original_generate(**kwargs)
        return ProviderResponse(
            raw_output={
                "action_interpretation": "新米冒険者は受付に近づき、最近の相談の傾向を尋ねている。",
                "narrative": (
                    f"{guide_name}は掲示板の断片的な相談を指し示し、"
                    "最近増えている気がかりの種類を、まだ依頼名にはせずに落ち着いて並べてみせた。"
                ),
                "current_situation": "冒険者ギルド広間では、受付と掲示板の周りに相談や噂が集まっている。",
                "current_location_name": "冒険者ギルド広間",
                "suggested_actions": [
                    {"label": "掲示板の相談を一つ選ぶ", "summary": "気になる方向を一つ選んで深掘りする。"},
                    {"label": "受付にもう少し詳しく尋ねる", "summary": "相談の背景を確認する。"},
                ],
                "consequence_summary": "受付と掲示板から、最近の相談の傾向が見えてきた。",
                "world_tags": ["investigate"],
                "consequence_tags": ["careful_observation"],
                "scene_tone": "measured",
                "scene_move": "deepen",
                "scene_pressure": "low",
                "memories": [
                    {"scope": "world", "text": "新米冒険者は受付で相談の傾向を尋ねた。", "salience": 0.6}
                ],
                "language_context": {
                    "pack_source_language": "en",
                    "play_language": "ja",
                    "output_language_requested": "ja",
                },
                "public_claims": [
                    {"kind": "location", "surface_text": "冒険者ギルド広間", "language": "ja", "role": "current_location"},
                    {"kind": "actor", "surface_text": guide_name, "language": "ja", "role": "present"},
                ],
                "present_people": [guide_name],
            },
            provider_name="test",
            provider_response_id=None,
        )

    container.model_router.provider.generate = guild_scene_generate
    try:
        _, data, _ = post_turn_and_wait(
            client,
            session_id=session_id,
            auth_headers=auth_headers,
            payload={"player_action_text": "ギルド受付に、いま多い相談の傾向を聞く"},
        )
    finally:
        container.model_router.provider.generate = original_generate

    assert data.get("system_message") is None, data
    assert data.get("failure") is None, data
    assert data["current_location"]["key"] == "adventurers_guild_hall"

    with container.session_factory() as db:
        turn = db.get(Turn, data["turn_id"])
        assert turn is not None
        assert turn.resolved_output["status"] == "resolved"
        assert not turn.resolved_output["rejected_claims"], turn.resolved_output["rejected_claims"]
