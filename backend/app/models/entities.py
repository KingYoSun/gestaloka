from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.models.types import EmbeddingType


def new_id() -> str:
    return str(uuid4())


def starter_location_id(world_id: str) -> str:
    digest = hashlib.sha1(world_id.encode("utf-8")).hexdigest()[:12]
    return f"loc-{digest}-starter"


def archive_steps_location_id(world_id: str) -> str:
    digest = hashlib.sha1(world_id.encode("utf-8")).hexdigest()[:12]
    return f"loc-{digest}-archive-steps"


def watch_path_location_id(world_id: str) -> str:
    digest = hashlib.sha1(world_id.encode("utf-8")).hexdigest()[:12]
    return f"loc-{digest}-watch-path"


def route_id(world_id: str, route_key: str) -> str:
    digest = hashlib.sha1(world_id.encode("utf-8")).hexdigest()[:12]
    normalized = route_key.replace("_", "-")
    return f"route-{digest}-{normalized}"


class World(Base, TimestampMixin):
    __tablename__ = "worlds"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32), default="active")
    state: Mapped[dict] = mapped_column(JSON, default=dict)


class AdminAppUser(Base, TimestampMixin):
    __tablename__ = "admin_app_users"

    user_sub: Mapped[str] = mapped_column(String(128), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), default="")
    display_name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(32), default="viewer")
    status: Mapped[str] = mapped_column(String(32), default="active")
    permissions: Mapped[dict] = mapped_column(JSON, default=dict)


class AdminRuntimeConfig(Base, TimestampMixin):
    __tablename__ = "admin_runtime_configs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), default="settings")
    base_url_secret_ref: Mapped[str] = mapped_column(String(160), default="")
    api_key_secret_ref: Mapped[str] = mapped_column(String(160), default="")
    embedding_provider: Mapped[str] = mapped_column(String(64), default="settings")
    embedding_base_url_secret_ref: Mapped[str] = mapped_column(String(160), default="")
    embedding_api_key_secret_ref: Mapped[str] = mapped_column(String(160), default="")
    model_ids: Mapped[dict] = mapped_column(JSON, default=dict)
    admin_debug_enabled: Mapped[bool] = mapped_column(Boolean, default=False)


class AdminPromptOverride(Base, TimestampMixin):
    __tablename__ = "admin_prompt_overrides"

    prompt_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    instructions: Mapped[str] = mapped_column(Text, default="")


class Location(Base, TimestampMixin):
    __tablename__ = "locations"
    __table_args__ = (UniqueConstraint("id", "world_id", name="uq_locations_id_world"),)

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[dict] = mapped_column(JSON, default=dict)


class LocationRoute(Base, TimestampMixin):
    __tablename__ = "location_routes"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_location_routes_id_world"),
        UniqueConstraint("world_id", "route_key", name="uq_location_routes_world_route_key"),
        UniqueConstraint("world_id", "from_location_id", "to_location_id", name="uq_location_routes_world_pair"),
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["from_location_id", "world_id"], ["locations.id", "locations.world_id"]),
        ForeignKeyConstraint(["to_location_id", "world_id"], ["locations.id", "locations.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    world_id: Mapped[str] = mapped_column(String(64))
    from_location_id: Mapped[str] = mapped_column(String(96))
    to_location_id: Mapped[str] = mapped_column(String(96))
    route_key: Mapped[str] = mapped_column(String(96))
    status: Mapped[str] = mapped_column(String(32), default="open")
    travel_summary: Mapped[str] = mapped_column(Text, default="")
    unlock_requirements_json: Mapped[dict] = mapped_column(JSON, default=dict)


class Actor(Base, TimestampMixin):
    __tablename__ = "actors"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_actors_id_world"),
        ForeignKeyConstraint(["current_location_id", "world_id"], ["locations.id", "locations.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"))
    current_location_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    actor_type: Mapped[str] = mapped_column(String(16))
    user_sub: Mapped[str | None] = mapped_column(String(128), nullable=True)
    display_name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32), default="active")


class PlayerProfile(Base, TimestampMixin):
    __tablename__ = "player_profiles"
    __table_args__ = (ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),)

    actor_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    world_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    gender: Mapped[str] = mapped_column(String(32), default="unspecified")
    background: Mapped[str] = mapped_column(Text, default="")
    free_text: Mapped[str] = mapped_column(Text, default="")
    narrative_preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    profile_setup_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class NPCProfile(Base, TimestampMixin):
    __tablename__ = "npc_profiles"
    __table_args__ = (ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),)

    actor_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    world_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    personality: Mapped[str] = mapped_column(Text, default="steady")
    goals: Mapped[dict] = mapped_column(JSON, default=dict)
    routine_state: Mapped[dict] = mapped_column(JSON, default=dict)


class Session(Base, TimestampMixin):
    __tablename__ = "sessions"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_sessions_id_world"),
        ForeignKeyConstraint(["player_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"))
    player_actor_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(32), default="active")


class WorldTick(Base, TimestampMixin):
    __tablename__ = "world_ticks"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_world_ticks_id_world"),
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["seed_turn_id", "world_id"], ["turns.id", "turns.world_id"]),
        ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    tick_kind: Mapped[str] = mapped_column(String(32), default="idle_world_pass")
    status: Mapped[str] = mapped_column(String(32), default="pending")
    seed_turn_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    location_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Turn(Base, TimestampMixin):
    __tablename__ = "turns"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_turns_id_world"),
        ForeignKeyConstraint(["session_id", "world_id"], ["sessions.id", "sessions.world_id"]),
        ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    session_id: Mapped[str] = mapped_column(String(36))
    actor_id: Mapped[str] = mapped_column(String(36))
    input_text: Mapped[str] = mapped_column(Text)
    resolved_output: Mapped[dict] = mapped_column(JSON, default=dict)
    model_lane: Mapped[str] = mapped_column(String(32))
    action_type: Mapped[str] = mapped_column(String(32), default="narrative")
    resolution_mode: Mapped[str] = mapped_column(String(32), default="legacy")
    langfuse_trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    langfuse_trace_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    langfuse_status: Mapped[str] = mapped_column(String(32), default="disabled")


class TurnResolutionJob(Base, TimestampMixin):
    __tablename__ = "turn_resolution_jobs"
    __table_args__ = (
        UniqueConstraint("turn_id", "world_id", name="uq_turn_resolution_jobs_turn_world"),
        ForeignKeyConstraint(["session_id", "world_id"], ["sessions.id", "sessions.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    turn_id: Mapped[str] = mapped_column(String(36), index=True)
    session_id: Mapped[str] = mapped_column(String(36))
    world_id: Mapped[str] = mapped_column(String(64), index=True)
    user_sub: Mapped[str] = mapped_column(String(128), index=True)
    request_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="accepted", index=True)
    result_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    error_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Event(Base, TimestampMixin):
    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_events_id_world"),
        UniqueConstraint("world_id", "canonical_sequence", name="uq_events_world_canonical_sequence"),
        ForeignKeyConstraint(["session_id", "world_id"], ["sessions.id", "sessions.world_id"]),
        ForeignKeyConstraint(["turn_id", "world_id"], ["turns.id", "turns.world_id"]),
        ForeignKeyConstraint(["source_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    session_id: Mapped[str] = mapped_column(String(36))
    turn_id: Mapped[str] = mapped_column(String(36))
    event_type: Mapped[str] = mapped_column(String(64))
    source_actor_id: Mapped[str] = mapped_column(String(36))
    location_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    narrative: Mapped[str] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    canonical_sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    canonical_status: Mapped[str] = mapped_column(String(32), default="pending", server_default="pending")
    timeline_entry_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class WorldTimelineCounter(Base, TimestampMixin):
    __tablename__ = "world_timeline_counters"

    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"), primary_key=True)
    next_sequence: Mapped[int] = mapped_column(Integer, default=1)


class WorldTimelineEntry(Base, TimestampMixin):
    __tablename__ = "world_timeline_entries"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_world_timeline_entries_id_world"),
        UniqueConstraint("world_id", "sequence", name="uq_world_timeline_entries_world_sequence"),
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
        ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
        Index("ix_world_timeline_entries_world_status", "world_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    sequence: Mapped[int] = mapped_column(Integer)
    entry_kind: Mapped[str] = mapped_column(String(32))
    source_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    scope_kind: Mapped[str] = mapped_column(String(32), default="event")
    location_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    affected_location_ids: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="canon")
    narrative_constraint: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class WorldResourceLock(Base, TimestampMixin):
    __tablename__ = "world_resource_locks"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_world_resource_locks_id_world"),
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["holder_turn_id", "world_id"], ["turns.id", "turns.world_id"]),
        ForeignKeyConstraint(["holder_session_id", "world_id"], ["sessions.id", "sessions.world_id"]),
        Index("ix_world_resource_locks_resource", "world_id", "resource_type", "resource_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    resource_type: Mapped[str] = mapped_column(String(32))
    resource_id: Mapped[str] = mapped_column(String(120))
    holder_turn_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    holder_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active")
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    constraint_summary: Mapped[str] = mapped_column(Text, default="")


class WorldBroadcastEvent(Base, TimestampMixin):
    __tablename__ = "world_broadcast_events"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_world_broadcast_events_id_world"),
        UniqueConstraint("world_id", "semantic_key", name="uq_world_broadcast_events_semantic_key"),
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
        ForeignKeyConstraint(["origin_location_id", "world_id"], ["locations.id", "locations.world_id"]),
        Index("ix_world_broadcast_events_world_status", "world_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    source_event_id: Mapped[str] = mapped_column(String(36))
    semantic_key: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(32), default="active")
    scope_kind: Mapped[str] = mapped_column(String(32), default="location")
    lifecycle_kind: Mapped[str] = mapped_column(String(32), default="scene")
    origin_location_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    affected_location_ids: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[str] = mapped_column(Text, default="")
    constraint_text: Mapped[str] = mapped_column(Text, default="")
    relevance_tags: Mapped[list] = mapped_column(JSON, default=list)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class WorldBroadcastDelivery(Base, TimestampMixin):
    __tablename__ = "world_broadcast_deliveries"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_world_broadcast_deliveries_id_world"),
        UniqueConstraint("world_id", "broadcast_event_id", "session_id", name="uq_world_broadcast_delivery_session"),
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["broadcast_event_id", "world_id"], ["world_broadcast_events.id", "world_broadcast_events.world_id"]),
        ForeignKeyConstraint(["session_id", "world_id"], ["sessions.id", "sessions.world_id"]),
        ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        Index("ix_world_broadcast_deliveries_session_status", "world_id", "session_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    broadcast_event_id: Mapped[str] = mapped_column(String(36))
    session_id: Mapped[str] = mapped_column(String(36))
    actor_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class Memory(Base, TimestampMixin):
    __tablename__ = "memories"
    __table_args__ = (
        ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
        ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    source_event_id: Mapped[str] = mapped_column(String(36))
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    location_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    scope: Mapped[str] = mapped_column(String(32))
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(EmbeddingType(768), nullable=True)
    embedding_status: Mapped[str] = mapped_column(String(32), default="pending")
    embedding_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    embedded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    salience: Mapped[float] = mapped_column(Float, default=0.7)


class Relationship(Base, TimestampMixin):
    __tablename__ = "relationships"
    __table_args__ = (
        UniqueConstraint("world_id", "from_actor_id", "to_entity_id", "relationship_type", name="uq_relationships_world_pair"),
        ForeignKeyConstraint(["from_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["to_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    from_actor_id: Mapped[str] = mapped_column(String(36))
    to_entity_id: Mapped[str] = mapped_column(String(64))
    to_actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    relationship_type: Mapped[str] = mapped_column(String(64))
    strength: Mapped[float] = mapped_column(Float, default=0.5)


class ConsequenceThread(Base, TimestampMixin):
    __tablename__ = "consequence_threads"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_consequence_threads_id_world"),
        ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["counterpart_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
        ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
        ForeignKeyConstraint(["last_event_id", "world_id"], ["events.id", "events.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    owner_actor_id: Mapped[str] = mapped_column(String(36))
    counterpart_actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    location_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    thread_type: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="active")
    pressure_band: Mapped[str] = mapped_column(String(16), default="low")
    title: Mapped[str] = mapped_column(String(160))
    summary: Mapped[str] = mapped_column(Text, default="")
    source_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ChapterTrack(Base, TimestampMixin):
    __tablename__ = "chapter_tracks"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_chapter_tracks_id_world"),
        UniqueConstraint("world_id", "owner_actor_id", "chapter_key", name="uq_chapter_tracks_owner_key"),
        ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["quest_assignment_id", "world_id"], ["quest_assignments.id", "quest_assignments.world_id"]),
        ForeignKeyConstraint(["opening_event_id", "world_id"], ["events.id", "events.world_id"]),
        ForeignKeyConstraint(["closing_event_id", "world_id"], ["events.id", "events.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"))
    owner_actor_id: Mapped[str] = mapped_column(String(36))
    quest_assignment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    chapter_key: Mapped[str] = mapped_column(String(96))
    chapter_kind: Mapped[str] = mapped_column(String(32), default="ambient")
    sequence_index: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="active")
    summary: Mapped[str] = mapped_column(Text, default="")
    state_json: Mapped[dict] = mapped_column(JSON, default=dict)
    branch_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    crossroads_status: Mapped[str] = mapped_column(String(32), default="none")
    crossroads_summary: Mapped[str] = mapped_column(Text, default="")
    opening_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    closing_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RoutePressure(Base, TimestampMixin):
    __tablename__ = "route_pressures"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_route_pressures_id_world"),
        UniqueConstraint(
            "world_id",
            "owner_actor_id",
            "chapter_key",
            "route_key",
            name="uq_route_pressures_owner_chapter_route",
        ),
        ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    owner_actor_id: Mapped[str] = mapped_column(String(36))
    chapter_key: Mapped[str] = mapped_column(String(96))
    route_key: Mapped[str] = mapped_column(String(64))
    pressure: Mapped[float] = mapped_column(Float, default=0.0)
    band: Mapped[str] = mapped_column(String(32), default="low")
    last_signal: Mapped[str] = mapped_column(String(64), default="none")


class SceneFrame(Base, TimestampMixin):
    __tablename__ = "scene_frames"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_scene_frames_id_world"),
        ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["chapter_track_id", "world_id"], ["chapter_tracks.id", "chapter_tracks.world_id"]),
        ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
        ForeignKeyConstraint(["focus_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["opening_event_id", "world_id"], ["events.id", "events.world_id"]),
        ForeignKeyConstraint(["closing_event_id", "world_id"], ["events.id", "events.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"))
    owner_actor_id: Mapped[str] = mapped_column(String(36))
    chapter_track_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    scene_phase: Mapped[str] = mapped_column(String(32), default="establish")
    status: Mapped[str] = mapped_column(String(32), default="active")
    location_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    focus_actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    stakes_summary: Mapped[str] = mapped_column(Text, default="")
    pressure_summary: Mapped[str] = mapped_column(Text, default="")
    opening_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    closing_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CharacterSheet(Base, TimestampMixin):
    __tablename__ = "character_sheets"
    __table_args__ = (ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),)

    actor_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    world_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    rank: Mapped[str] = mapped_column(String(64), default="wayfarer")
    hp: Mapped[int] = mapped_column(Integer, default=10)
    focus: Mapped[int] = mapped_column(Integer, default=5)
    status_json: Mapped[dict] = mapped_column(JSON, default=dict)


class Faction(Base, TimestampMixin):
    __tablename__ = "factions"
    __table_args__ = (UniqueConstraint("id", "world_id", name="uq_factions_id_world"),)

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="active")
    state: Mapped[dict] = mapped_column(JSON, default=dict)


class FactionStanding(Base, TimestampMixin):
    __tablename__ = "faction_standings"
    __table_args__ = (
        ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["faction_id", "world_id"], ["factions.id", "factions.world_id"]),
        CheckConstraint("standing >= -1.0 AND standing <= 1.0", name="ck_faction_standings_range"),
    )

    actor_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    world_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    faction_id: Mapped[str] = mapped_column(String(96), primary_key=True)
    standing: Mapped[float] = mapped_column(Float, default=0.0)
    band: Mapped[str] = mapped_column(String(32), default="neutral")


class WorldAxisState(Base, TimestampMixin):
    __tablename__ = "world_axis_states"
    __table_args__ = (
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["last_event_id", "world_id"], ["events.id", "events.world_id"]),
        CheckConstraint("current_value >= min_value AND current_value <= max_value", name="ck_world_axis_states_value_range"),
    )

    world_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    axis_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    min_value: Mapped[float] = mapped_column(Float, default=0.0)
    max_value: Mapped[float] = mapped_column(Float, default=1.0)
    current_value: Mapped[float] = mapped_column(Float, default=0.0)
    expose_to_session_context: Mapped[bool] = mapped_column(Boolean, default=True)
    thresholds: Mapped[list] = mapped_column(JSON, default=list)
    last_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class SharedHistoryRecord(Base, TimestampMixin):
    __tablename__ = "shared_history_records"
    __table_args__ = (
        UniqueConstraint("world_id", "source_event_id", "history_rule_id", name="uq_shared_history_event_rule"),
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
        ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["location_id", "world_id"], ["locations.id", "locations.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64), index=True)
    source_event_id: Mapped[str] = mapped_column(String(36))
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    location_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    history_rule_id: Mapped[str] = mapped_column(String(120))
    level: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="candidate")
    summary: Mapped[str] = mapped_column(Text, default="")
    salience: Mapped[float] = mapped_column(Float, default=0.5)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class ActorTitleProgress(Base, TimestampMixin):
    __tablename__ = "actor_title_progress"
    __table_args__ = (
        ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
        CheckConstraint("progress >= 0", name="ck_actor_title_progress_nonnegative"),
        CheckConstraint("progress_target > 0", name="ck_actor_title_progress_target_positive"),
    )

    actor_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    world_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title_rule_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    progress_target: Mapped[float] = mapped_column(Float, default=1.0)
    status: Mapped[str] = mapped_column(String(32), default="in_progress")
    source_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class SharedConsequenceApplication(Base, TimestampMixin):
    __tablename__ = "shared_consequence_applications"
    __table_args__ = (
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["source_event_id", "world_id"], ["events.id", "events.world_id"]),
    )

    world_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    rule_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    action_tag: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class QuestTemplate(Base, TimestampMixin):
    __tablename__ = "quest_templates"
    __table_args__ = (UniqueConstraint("id", "world_id", name="uq_quest_templates_id_world"),)

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="active")
    stage_key: Mapped[str] = mapped_column(String(96), default="starter")
    unlock_requirements: Mapped[dict] = mapped_column(JSON, default=dict)
    completion_target: Mapped[int] = mapped_column(Integer, default=2)
    reward_template_key: Mapped[str] = mapped_column(String(96))
    reward_name: Mapped[str] = mapped_column(String(120))
    reward_description: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[dict] = mapped_column(JSON, default=dict)


class QuestAssignment(Base, TimestampMixin):
    __tablename__ = "quest_assignments"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_quest_assignments_id_world"),
        UniqueConstraint("world_id", "owner_actor_id", "quest_template_id", name="uq_quest_assignments_owner_template"),
        ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["quest_template_id", "world_id"], ["quest_templates.id", "quest_templates.world_id"]),
        CheckConstraint("progress >= 0", name="ck_quest_assignments_progress_nonnegative"),
        CheckConstraint("progress_target >= 1", name="ck_quest_assignments_progress_target_positive"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    owner_actor_id: Mapped[str] = mapped_column(String(36))
    quest_template_id: Mapped[str] = mapped_column(String(96))
    status: Mapped[str] = mapped_column(String(32), default="active")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    progress_target: Mapped[int] = mapped_column(Integer, default=2)
    latest_summary: Mapped[str] = mapped_column(Text, default="")
    reward_item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    state_json: Mapped[dict] = mapped_column(JSON, default=dict)


class Item(Base, TimestampMixin):
    __tablename__ = "items"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_items_id_world"),
        UniqueConstraint("world_id", "source_quest_assignment_id", name="uq_items_source_assignment"),
        ForeignKeyConstraint(["owner_actor_id", "world_id"], ["actors.id", "actors.world_id"]),
        ForeignKeyConstraint(["source_quest_assignment_id", "world_id"], ["quest_assignments.id", "quest_assignments.world_id"]),
        ForeignKeyConstraint(["used_event_id", "world_id"], ["events.id", "events.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    owner_actor_id: Mapped[str] = mapped_column(String(36))
    template_key: Mapped[str] = mapped_column(String(96))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="active")
    effect_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    effect_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    used_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_quest_assignment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class PlayLocalizedTextCache(Base, TimestampMixin):
    __tablename__ = "play_localized_text_cache"
    __table_args__ = (
        UniqueConstraint(
            "world_id",
            "actor_id_scope",
            "target_language",
            "source_kind",
            "source_key",
            "source_hash",
            name="uq_play_localized_text_cache_source",
        ),
        Index("ix_play_localized_text_cache_world_actor_language", "world_id", "actor_id_scope", "target_language"),
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="CASCADE"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    actor_id_scope: Mapped[str] = mapped_column(String(36))
    target_language: Mapped[str] = mapped_column(String(120))
    source_kind: Mapped[str] = mapped_column(String(64))
    source_key: Mapped[str] = mapped_column(String(180))
    source_hash: Mapped[str] = mapped_column(String(64))
    source_text: Mapped[str] = mapped_column(Text)
    localized_text: Mapped[str] = mapped_column(Text)
    model_id: Mapped[str] = mapped_column(String(120))
    prompt_id: Mapped[str] = mapped_column(String(120))


class SPAccount(Base, TimestampMixin):
    __tablename__ = "sp_accounts"
    __table_args__ = (
        CheckConstraint("balance >= 0", name="ck_sp_accounts_balance_nonnegative"),
        CheckConstraint("paid_balance >= 0", name="ck_sp_accounts_paid_balance_nonnegative"),
        CheckConstraint("bonus_balance >= 0", name="ck_sp_accounts_bonus_balance_nonnegative"),
    )

    user_sub: Mapped[str] = mapped_column(String(128), primary_key=True)
    balance: Mapped[int] = mapped_column(Integer, default=0)
    paid_balance: Mapped[int] = mapped_column(Integer, default=0)
    bonus_balance: Mapped[int] = mapped_column(Integer, default=0)


class SPLedgerEntry(Base, TimestampMixin):
    __tablename__ = "sp_ledger"
    __table_args__ = (
        CheckConstraint("delta != 0", name="ck_sp_ledger_nonzero_delta"),
        CheckConstraint("paid_delta + bonus_delta = delta", name="ck_sp_ledger_bucket_delta_sum"),
        CheckConstraint(
            "paid_balance_after + bonus_balance_after = balance_after",
            name="ck_sp_ledger_bucket_balance_sum",
        ),
        CheckConstraint("paid_delta != 0 OR bonus_delta != 0", name="ck_sp_ledger_bucket_nonzero_delta"),
        CheckConstraint("actor_id IS NULL OR world_id IS NOT NULL", name="ck_sp_ledger_actor_requires_world"),
        ForeignKeyConstraint(["world_id"], ["worlds.id"], ondelete="SET NULL"),
        ForeignKeyConstraint(["actor_id", "world_id"], ["actors.id", "actors.world_id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_sub: Mapped[str] = mapped_column(String(128), index=True)
    world_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason_code: Mapped[str] = mapped_column(String(64))
    reference_type: Mapped[str] = mapped_column(String(64))
    reference_id: Mapped[str] = mapped_column(String(96))
    balance_after: Mapped[int] = mapped_column(Integer)
    paid_delta: Mapped[int] = mapped_column(Integer, default=0)
    bonus_delta: Mapped[int] = mapped_column(Integer, default=0)
    paid_balance_after: Mapped[int] = mapped_column(Integer, default=0)
    bonus_balance_after: Mapped[int] = mapped_column(Integer, default=0)
    created_by_sub: Mapped[str | None] = mapped_column(String(128), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class LLMRun(Base, TimestampMixin):
    __tablename__ = "llm_runs"
    __table_args__ = (ForeignKeyConstraint(["turn_id", "world_id"], ["turns.id", "turns.world_id"]),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    turn_id: Mapped[str] = mapped_column(String(36))
    prompt_id: Mapped[str] = mapped_column(String(120))
    workflow_name: Mapped[str] = mapped_column(String(64), default="single_prompt")
    council_role: Mapped[str | None] = mapped_column(String(64), nullable=True)
    stage_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approval_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model_id: Mapped[str] = mapped_column(String(120))
    model_lane: Mapped[str] = mapped_column(String(32))
    provider_name: Mapped[str] = mapped_column(String(64), default="stub")
    provider_response_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_cache_hit_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_cache_miss_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_hash: Mapped[str] = mapped_column(String(128))
    input_context_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    schema_version: Mapped[str] = mapped_column(String(32))
    graph_context_status: Mapped[str] = mapped_column(String(32), default="ready")
    output_schema_status: Mapped[str] = mapped_column(String(32))
    output_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    langfuse_trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    langfuse_observation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    langfuse_trace_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    langfuse_status: Mapped[str] = mapped_column(String(32), default="disabled")


class OutboxEvent(Base, TimestampMixin):
    __tablename__ = "outbox_events"
    __table_args__ = (ForeignKeyConstraint(["event_id", "world_id"], ["events.id", "events.world_id"]),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    event_id: Mapped[str] = mapped_column(String(36))
    projection_type: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProjectionRecord(Base, TimestampMixin):
    __tablename__ = "projection_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64), index=True)
    outbox_event_id: Mapped[str] = mapped_column(String(36))
    event_id: Mapped[str] = mapped_column(String(36))
    projection_type: Mapped[str] = mapped_column(String(64))
    entity_key: Mapped[str] = mapped_column(String(255))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class EvalRun(Base, TimestampMixin):
    __tablename__ = "eval_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_type: Mapped[str] = mapped_column(String(32))
    dataset_name: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    trigger_type: Mapped[str] = mapped_column(String(32), default="manual")
    runtime_role: Mapped[str] = mapped_column(String(32), default="primary")
    current_config_name: Mapped[str] = mapped_column(String(64))
    current_config_hash: Mapped[str] = mapped_column(String(128))
    candidate_config_name: Mapped[str] = mapped_column(String(64))
    candidate_config_hash: Mapped[str] = mapped_column(String(128))
    git_sha: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="running")
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    langfuse_trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    langfuse_trace_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    langfuse_status: Mapped[str] = mapped_column(String(32), default="disabled")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EvalCaseResult(Base, TimestampMixin):
    __tablename__ = "eval_case_results"
    __table_args__ = (ForeignKeyConstraint(["eval_run_id"], ["eval_runs.id"], ondelete="CASCADE"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    eval_run_id: Mapped[str] = mapped_column(String(36), index=True)
    variant: Mapped[str] = mapped_column(String(32))
    case_id: Mapped[str] = mapped_column(String(128), index=True)
    prompt_id: Mapped[str] = mapped_column(String(120))
    model_id: Mapped[str] = mapped_column(String(120))
    lane: Mapped[str] = mapped_column(String(32))
    used_fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    schema_valid: Mapped[bool] = mapped_column(Boolean, default=False)
    same_world_invariant: Mapped[bool] = mapped_column(Boolean, default=False)
    graph_context_status: Mapped[str] = mapped_column(String(32), default="ready")
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_output: Mapped[dict] = mapped_column(JSON, default=dict)


class ReleaseGateReport(Base, TimestampMixin):
    __tablename__ = "release_gate_reports"
    __table_args__ = (
        ForeignKeyConstraint(["smoke_run_id"], ["eval_runs.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["failure_run_id"], ["eval_runs.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["shadow_run_id"], ["eval_runs.id"], ondelete="CASCADE"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    smoke_run_id: Mapped[str] = mapped_column(String(36), index=True)
    failure_run_id: Mapped[str] = mapped_column(String(36), index=True)
    shadow_run_id: Mapped[str] = mapped_column(String(36), index=True)
    pack_regression_run_ids: Mapped[dict] = mapped_column(JSON, default=dict)
    verdict: Mapped[str] = mapped_column(String(32))
    blocked_reasons: Mapped[list[str]] = mapped_column(JSON, default=list)
    slo_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    trigger_type: Mapped[str] = mapped_column(String(32), default="manual")
    langfuse_trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    langfuse_trace_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    langfuse_status: Mapped[str] = mapped_column(String(32), default="disabled")


class ObservabilitySnapshot(Base, TimestampMixin):
    __tablename__ = "observability_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    snapshot_kind: Mapped[str] = mapped_column(String(32), default="summary", index=True)
    runtime_role: Mapped[str] = mapped_column(String(32), default="primary", index=True)
    pack_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    pack_display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    world_template_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    world_template_display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    release_gate_report_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    primary_slo: Mapped[dict] = mapped_column(JSON, default=dict)
    canary_health: Mapped[dict] = mapped_column(JSON, default=dict)
    langfuse_status: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    trace_count: Mapped[int] = mapped_column(Integer, default=0)
