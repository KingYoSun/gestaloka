from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.entities import Actor, Memory, Session as GameSession, World, starter_location_id


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
