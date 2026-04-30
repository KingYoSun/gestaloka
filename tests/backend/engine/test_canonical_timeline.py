from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.entities import (
    Actor,
    Event,
    Location,
    LocationRoute,
    Session as GameSession,
    Turn,
    World,
    WorldBroadcastDelivery,
    WorldBroadcastEvent,
    WorldResourceLock,
    WorldTimelineCounter,
    WorldTimelineEntry,
)
from app.modules.event_log.service import list_world_events
from app.modules.world_state.timeline import (
    canonicalize_event,
    create_broadcast_from_turn,
    pending_broadcast_constraints,
    sync_active_broadcast_deliveries,
)
from tests.backend.turn_async_helpers import post_turn_and_wait


def _seed_actor_session_turn(db, *, world_id: str, actor_name: str, location_id: str | None = None):
    actor = Actor(
        world_id=world_id,
        actor_type="player",
        user_sub=actor_name,
        display_name=actor_name,
        current_location_id=location_id,
    )
    db.add(actor)
    db.flush()
    session = GameSession(world_id=world_id, player_actor_id=actor.id, status="active")
    db.add(session)
    db.flush()
    turn = Turn(
        world_id=world_id,
        session_id=session.id,
        actor_id=actor.id,
        input_text="fixture",
        resolved_output={"status": "resolved"},
        model_lane="test",
    )
    db.add(turn)
    db.flush()
    return actor, session, turn


def _seed_event(db, *, world_id: str, session: GameSession, actor: Actor, turn: Turn, location_id: str | None = None) -> Event:
    event = Event(
        world_id=world_id,
        session_id=session.id,
        turn_id=turn.id,
        event_type="player.turn.resolved",
        source_actor_id=actor.id,
        location_id=location_id,
        payload={"world_tags": ["aid_local"]},
        narrative=f"{actor.display_name} resolves a fixture turn.",
    )
    db.add(event)
    db.flush()
    return event


def test_canonical_timeline_sequences_are_per_world_and_drive_event_log_order(container):
    with container.session_factory() as db:
        db.add_all(
            [
                World(id="timeline-a", name="Timeline A", status="active"),
                World(id="timeline-b", name="Timeline B", status="active"),
            ]
        )
        db.flush()
        actor_a, session_a, turn_a = _seed_actor_session_turn(db, world_id="timeline-a", actor_name="a")
        actor_b, session_b, turn_b = _seed_actor_session_turn(db, world_id="timeline-b", actor_name="b")
        older = _seed_event(db, world_id="timeline-a", session=session_a, actor=actor_a, turn=turn_a)
        older.occurred_at = datetime.now(timezone.utc) - timedelta(days=1)
        newer = _seed_event(db, world_id="timeline-a", session=session_a, actor=actor_a, turn=turn_a)
        newer.occurred_at = datetime.now(timezone.utc) - timedelta(days=2)
        other_world = _seed_event(db, world_id="timeline-b", session=session_b, actor=actor_b, turn=turn_b)

        canonicalize_event(db, older)
        canonicalize_event(db, newer)
        canonicalize_event(db, other_world)
        db.commit()

    with container.session_factory() as db:
        timeline_a_events = list_world_events(db, "timeline-a")
        assert [event.canonical_sequence for event in timeline_a_events] == [2, 1]
        assert db.execute(
            select(WorldTimelineCounter.next_sequence).where(WorldTimelineCounter.world_id == "timeline-a")
        ).scalar_one() == 3
        assert db.execute(
            select(WorldTimelineCounter.next_sequence).where(WorldTimelineCounter.world_id == "timeline-b")
        ).scalar_one() == 2
        assert [entry.sequence for entry in db.execute(
            select(WorldTimelineEntry)
            .where(WorldTimelineEntry.world_id == "timeline-a")
            .order_by(WorldTimelineEntry.sequence.asc())
        ).scalars()] == [1, 2]


def test_resource_lock_conflict_continues_turn_and_records_constraints(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json={
            "world_id": "gestaloka_reference",
            "world_name": "GESTALOKA: Nexus Foundation",
            "player_display_name": "Demo Player",
        },
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    session_payload = session_response.json()
    with container.session_factory() as db:
        db.add(
            WorldResourceLock(
                world_id="gestaloka_reference",
                resource_type="location",
                resource_id=session_payload["location_id"],
                status="active",
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
                constraint_summary="The gate is already settling another canonical exchange.",
            )
        )
        db.commit()

    _, turn_payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "progress"},
    )
    assert turn_payload["shared_action_tag"] == "none"

    with container.session_factory() as db:
        event = db.execute(
            select(Event).where(Event.world_id == "gestaloka_reference", Event.id == turn_payload["event_id"])
        ).scalar_one()
        assert event.payload["resource_constraints"]
        assert any(item["resource_type"] == "location" for item in event.payload["skipped_shared_resources"])
        assert db.execute(
            select(WorldTimelineEntry).where(
                WorldTimelineEntry.world_id == "gestaloka_reference",
                WorldTimelineEntry.source_event_id == event.id,
                WorldTimelineEntry.entry_kind == "resource_conflict",
            )
        ).scalar_one()


def test_broadcast_delivers_to_origin_adjacent_and_late_active_sessions(container):
    with container.session_factory() as db:
        db.add(World(id="broadcast-world", name="Broadcast World", status="active"))
        db.flush()
        db.add_all(
            [
                Location(id="origin", world_id="broadcast-world", name="Origin"),
                Location(id="adjacent", world_id="broadcast-world", name="Adjacent"),
                Location(id="far", world_id="broadcast-world", name="Far"),
            ]
        )
        db.flush()
        db.add(
            LocationRoute(
                id="route-origin-adjacent",
                world_id="broadcast-world",
                from_location_id="origin",
                to_location_id="adjacent",
                route_key="origin_adjacent",
            )
        )
        db.flush()
        origin_actor, origin_session, origin_turn = _seed_actor_session_turn(
            db, world_id="broadcast-world", actor_name="origin-player", location_id="origin"
        )
        adjacent_actor, adjacent_session, _ = _seed_actor_session_turn(
            db, world_id="broadcast-world", actor_name="adjacent-player", location_id="adjacent"
        )
        _far_actor, far_session, _ = _seed_actor_session_turn(
            db, world_id="broadcast-world", actor_name="far-player", location_id="far"
        )
        event = _seed_event(
            db,
            world_id="broadcast-world",
            session=origin_session,
            actor=origin_actor,
            turn=origin_turn,
            location_id="origin",
        )

        broadcast, deliveries = create_broadcast_from_turn(
            db,
            event=event,
            broadcast_draft={
                "summary": "A gate flare is visible from the road.",
                "constraint_text": "The gate flare should color the next local narration.",
                "scope_kind": "location",
                "lifecycle_kind": "scene",
                "relevance_tags": ["gate_flare"],
            },
            action_tag="help",
            relevance_tags=["gate_flare"],
        )
        assert broadcast is not None
        assert set(broadcast.affected_location_ids) == {"origin", "adjacent"}
        assert {delivery.session_id for delivery in deliveries} == {origin_session.id, adjacent_session.id}
        assert far_session.id not in {delivery.session_id for delivery in deliveries}

        late_actor, late_session, _ = _seed_actor_session_turn(
            db, world_id="broadcast-world", actor_name="late-player", location_id="adjacent"
        )
        late_deliveries = sync_active_broadcast_deliveries(
            db,
            world_id="broadcast-world",
            session_id=late_session.id,
            actor_id=late_actor.id,
            location_id="adjacent",
        )
        assert [delivery.session_id for delivery in late_deliveries] == [late_session.id]
        constraints = pending_broadcast_constraints(db, world_id="broadcast-world", session_id=late_session.id)
        assert constraints == [
            {
                "semantic_key": broadcast.semantic_key,
                "scope_kind": "location",
                "lifecycle_kind": "scene",
                "origin_location_id": "origin",
                "affected_location_ids": ["adjacent", "origin"],
                "summary": "A gate flare is visible from the road.",
                "constraint_text": "The gate flare should color the next local narration.",
                "relevance_tags": ["gate_flare"],
                "delivery_status": "delivered",
            }
        ]
        assert "broadcast_event_id" not in constraints[0]
        assert "delivery_id" not in constraints[0]
        db.flush()
        assert db.execute(
            select(WorldBroadcastDelivery).where(
                WorldBroadcastDelivery.world_id == "broadcast-world",
                WorldBroadcastDelivery.session_id == far_session.id,
            )
        ).scalar_one_or_none() is None
        assert db.execute(
            select(WorldBroadcastEvent).where(
                WorldBroadcastEvent.world_id == "broadcast-world",
                WorldBroadcastEvent.semantic_key == broadcast.semantic_key,
            )
        ).scalar_one()
