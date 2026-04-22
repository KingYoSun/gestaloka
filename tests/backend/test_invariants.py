from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.entities import (
    Actor,
    ChapterTrack,
    ConsequenceThread,
    Faction,
    FactionStanding,
    Item,
    Memory,
    QuestAssignment,
    QuestTemplate,
    SceneFrame,
    Session as GameSession,
    World,
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
            completion_target=2,
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
                progress=0,
                progress_target=2,
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
                template_key="lantern_sigils",
                name="Lantern Sigil",
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
                chapter_key="founders_watch_opening",
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
            chapter_key="founders_watch_opening",
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
