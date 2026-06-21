from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.entities import (
    Actor,
    ChapterTrack,
    ConsequenceThread,
    Event,
    Faction,
    FactionStanding,
    Item,
    Memory,
    QuestAssignment,
    QuestTemplate,
    SceneFrame,
    Session as GameSession,
    Turn,
    World,
    WorldBroadcastDelivery,
    WorldBroadcastEvent,
    WorldResourceLock,
    WorldTimelineEntry,
    starter_location_id,
)


def test_cross_world_session_reference_is_rejected(container):
    with container.session_factory() as db:
        db.add_all(
            [
                World(id="world-a", name="World A", status="active"),
                World(id="world-b", name="World B", status="active"),
            ]
        )
        db.flush()
        actor = Actor(world_id="world-a", actor_type="player", user_sub="demo", display_name="Demo")
        db.add(actor)
        db.flush()
        db.add(GameSession(world_id="world-b", player_actor_id=actor.id, status="active"))

        with pytest.raises(IntegrityError):
            db.commit()


def test_memory_without_source_event_is_rejected(container):
    with container.session_factory() as db:
        db.add(World(id="world-a", name="World A", status="active"))
        db.flush()
        actor = Actor(world_id="world-a", actor_type="npc", display_name="Guide")
        db.add(actor)
        db.flush()
        db.add(
            Memory(
                world_id="world-a",
                source_event_id="missing-event",
                actor_id=actor.id,
                scope="actor",
                text="This should fail",
                salience=0.8,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_actor_cannot_point_to_location_from_another_world(container):
    with container.session_factory() as db:
        db.add_all(
            [
                World(id="world-a", name="World A", status="active"),
                World(id="world-b", name="World B", status="active"),
            ]
        )
        db.flush()
        actor = Actor(
            world_id="world-a",
            actor_type="player",
            user_sub="demo",
            display_name="Demo",
            current_location_id=starter_location_id("world-b"),
        )
        db.add(actor)
        with pytest.raises(IntegrityError):
            db.commit()


def test_faction_standing_cannot_reference_faction_from_another_world(container):
    with container.session_factory() as db:
        db.add_all(
            [
                World(id="world-a", name="World A", status="active"),
                World(id="world-b", name="World B", status="active"),
            ]
        )
        db.flush()
        actor = Actor(world_id="world-a", actor_type="player", user_sub="demo", display_name="Demo")
        faction = Faction(id="faction-b", world_id="world-b", name="Faction B", description="desc", status="active", state={})
        db.add_all([actor, faction])
        db.flush()
        db.add(
            FactionStanding(
                actor_id=actor.id,
                world_id="world-a",
                faction_id=faction.id,
                standing=0.2,
                band="neutral",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_quest_assignment_cannot_reference_template_from_another_world(container):
    with container.session_factory() as db:
        db.add_all(
            [
                World(id="world-a", name="World A", status="active"),
                World(id="world-b", name="World B", status="active"),
            ]
        )
        db.flush()
        actor = Actor(world_id="world-a", actor_type="player", user_sub="demo", display_name="Demo")
        template = QuestTemplate(
            id="quest-b",
            world_id="world-b",
            title="Quest B",
            description="desc",
            status="active",
            reward_template_key="reward",
            reward_name="Reward",
            reward_description="desc",
            state={},
        )
        db.add_all([actor, template])
        db.flush()
        db.add(
            QuestAssignment(
                world_id="world-a",
                owner_actor_id=actor.id,
                quest_template_id=template.id,
                status="active",
                latest_summary="bad",
                state_json={},
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_item_cannot_reference_owner_from_another_world(container):
    with container.session_factory() as db:
        db.add_all(
            [
                World(id="world-a", name="World A", status="active"),
                World(id="world-b", name="World B", status="active"),
            ]
        )
        db.flush()
        actor = Actor(world_id="world-a", actor_type="player", user_sub="demo", display_name="Demo")
        db.add(actor)
        db.flush()
        db.add(
            Item(
                world_id="world-b",
                owner_actor_id=actor.id,
                template_key="test_item",
                name="Test Item",
                description="desc",
                status="active",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_consequence_thread_cannot_reference_counterpart_from_another_world(container):
    with container.session_factory() as db:
        db.add_all(
            [
                World(id="world-a", name="World A", status="active"),
                World(id="world-b", name="World B", status="active"),
            ]
        )
        db.flush()
        owner = Actor(world_id="world-a", actor_type="player", user_sub="demo", display_name="Owner")
        counterpart = Actor(world_id="world-b", actor_type="npc", display_name="Counterpart")
        db.add_all([owner, counterpart])
        db.flush()
        db.add(
            ConsequenceThread(
                world_id="world-a",
                owner_actor_id=owner.id,
                counterpart_actor_id=counterpart.id,
                location_id=None,
                thread_type="promise",
                status="active",
                pressure_band="medium",
                title="A promise hangs in the square",
                summary="A promise remains unresolved.",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_chapter_track_cannot_reference_owner_from_another_world(container):
    with container.session_factory() as db:
        db.add_all(
            [
                World(id="world-a", name="World A", status="active"),
                World(id="world-b", name="World B", status="active"),
            ]
        )
        db.flush()
        owner = Actor(world_id="world-a", actor_type="player", user_sub="demo", display_name="Owner")
        db.add(owner)
        db.flush()
        db.add(
            ChapterTrack(
                world_id="world-b",
                owner_actor_id=owner.id,
                chapter_key="opening_chapter",
                status="active",
                summary="bad",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_scene_frame_cannot_reference_chapter_from_another_world(container):
    with container.session_factory() as db:
        db.add_all(
            [
                World(id="world-a", name="World A", status="active"),
                World(id="world-b", name="World B", status="active"),
            ]
        )
        db.flush()
        owner_a = Actor(world_id="world-a", actor_type="player", user_sub="demo-a", display_name="Owner A")
        owner_b = Actor(world_id="world-b", actor_type="player", user_sub="demo-b", display_name="Owner B")
        db.add_all([owner_a, owner_b])
        db.flush()
        chapter = ChapterTrack(
            world_id="world-b",
            owner_actor_id=owner_b.id,
            chapter_key="opening_chapter",
            status="active",
            summary="chapter",
        )
        db.add(chapter)
        db.flush()
        db.add(
            SceneFrame(
                world_id="world-a",
                owner_actor_id=owner_a.id,
                chapter_track_id=chapter.id,
                scene_phase="establish",
                status="active",
                location_id=None,
                focus_actor_id=None,
                stakes_summary="bad",
                pressure_summary="bad",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def _seed_event_for_world(db, world_id: str, user_sub: str) -> tuple[Actor, GameSession, Turn, Event]:
    db.add(World(id=world_id, name=world_id, status="active"))
    db.flush()
    actor = Actor(world_id=world_id, actor_type="player", user_sub=user_sub, display_name=user_sub)
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
    event = Event(
        world_id=world_id,
        session_id=session.id,
        turn_id=turn.id,
        event_type="player.turn.resolved",
        source_actor_id=actor.id,
        payload={},
        narrative="Fixture event.",
    )
    db.add(event)
    db.flush()
    return actor, session, turn, event


def test_timeline_entry_cannot_reference_source_event_from_another_world(container):
    with container.session_factory() as db:
        _seed_event_for_world(db, "world-a", "a")
        _, _, _, event_b = _seed_event_for_world(db, "world-b", "b")
        db.add(
            WorldTimelineEntry(
                world_id="world-a",
                sequence=1,
                entry_kind="event",
                source_event_id=event_b.id,
                scope_kind="event",
                status="canon",
                narrative_constraint="bad",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_resource_lock_cannot_reference_holder_from_another_world(container):
    from datetime import datetime, timedelta, timezone

    with container.session_factory() as db:
        _seed_event_for_world(db, "world-a", "a")
        _, session_b, turn_b, _ = _seed_event_for_world(db, "world-b", "b")
        db.add(
            WorldResourceLock(
                world_id="world-a",
                resource_type="npc",
                resource_id="npc-b",
                holder_turn_id=turn_b.id,
                holder_session_id=session_b.id,
                status="active",
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_broadcast_delivery_cannot_reference_session_from_another_world(container):
    with container.session_factory() as db:
        _, _, _, event_a = _seed_event_for_world(db, "world-a", "a")
        actor_b, session_b, _, _ = _seed_event_for_world(db, "world-b", "b")
        broadcast = WorldBroadcastEvent(
            world_id="world-a",
            source_event_id=event_a.id,
            semantic_key="world-a:help:test",
            status="active",
            summary="A nearby change spreads.",
            constraint_text="A nearby change must be honored.",
        )
        db.add(broadcast)
        db.flush()
        db.add(
            WorldBroadcastDelivery(
                world_id="world-a",
                broadcast_event_id=broadcast.id,
                session_id=session_b.id,
                actor_id=actor_b.id,
                status="pending",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
