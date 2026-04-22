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


class World(Base, TimestampMixin):
    __tablename__ = "worlds"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32), default="active")


class Location(Base, TimestampMixin):
    __tablename__ = "locations"
    __table_args__ = (UniqueConstraint("id", "world_id", name="uq_locations_id_world"),)

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    world_id: Mapped[str] = mapped_column(ForeignKey("worlds.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[dict] = mapped_column(JSON, default=dict)


class Actor(Base, TimestampMixin):
    __tablename__ = "actors"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_actors_id_world"),
        UniqueConstraint("world_id", "user_sub", name="uq_actors_world_user_sub"),
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
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)


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


class Event(Base, TimestampMixin):
    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("id", "world_id", name="uq_events_id_world"),
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
    embedding: Mapped[list[float] | None] = mapped_column(EmbeddingType(), nullable=True)
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


class SPAccount(Base, TimestampMixin):
    __tablename__ = "sp_accounts"
    __table_args__ = (CheckConstraint("balance >= 0", name="ck_sp_accounts_balance_nonnegative"),)

    user_sub: Mapped[str] = mapped_column(String(128), primary_key=True)
    balance: Mapped[int] = mapped_column(Integer, default=0)


class SPLedgerEntry(Base, TimestampMixin):
    __tablename__ = "sp_ledger"
    __table_args__ = (
        CheckConstraint("delta != 0", name="ck_sp_ledger_nonzero_delta"),
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
    created_by_sub: Mapped[str | None] = mapped_column(String(128), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class LLMRun(Base, TimestampMixin):
    __tablename__ = "llm_runs"
    __table_args__ = (ForeignKeyConstraint(["turn_id", "world_id"], ["turns.id", "turns.world_id"]),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    world_id: Mapped[str] = mapped_column(String(64))
    turn_id: Mapped[str] = mapped_column(String(36))
    prompt_id: Mapped[str] = mapped_column(String(120))
    model_id: Mapped[str] = mapped_column(String(120))
    model_lane: Mapped[str] = mapped_column(String(32))
    input_hash: Mapped[str] = mapped_column(String(128))
    schema_version: Mapped[str] = mapped_column(String(32))
    graph_context_status: Mapped[str] = mapped_column(String(32), default="ready")
    output_schema_status: Mapped[str] = mapped_column(String(32))
    output_payload: Mapped[dict] = mapped_column(JSON, default=dict)


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
    current_config_name: Mapped[str] = mapped_column(String(64))
    current_config_hash: Mapped[str] = mapped_column(String(128))
    candidate_config_name: Mapped[str] = mapped_column(String(64))
    candidate_config_hash: Mapped[str] = mapped_column(String(128))
    git_sha: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="running")
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
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
