from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


def test_alembic_upgrade_creates_v2_tables(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "alembic.db"
    sqlite_url = f"sqlite:///{db_path}"
    repo_root = next(parent for parent in Path(__file__).resolve().parents if (parent / "AGENTS.md").exists() and (parent / "backend").is_dir())
    alembic_path = repo_root / "backend" / "alembic.ini"

    monkeypatch.setenv("ALEMBIC_DATABASE_URL", sqlite_url)
    monkeypatch.setenv("DATABASE_URL", sqlite_url)

    config = Config(str(alembic_path))
    config.set_main_option("script_location", str(repo_root / "backend" / "alembic"))
    command.upgrade(config, "head")

    inspector = inspect(create_engine(sqlite_url))
    tables = set(inspector.get_table_names())
    assert {
        "worlds",
        "locations",
        "actors",
        "character_sheets",
        "factions",
        "faction_standings",
        "quest_templates",
        "quest_assignments",
        "items",
        "sessions",
        "events",
        "memories",
        "relationships",
        "consequence_threads",
        "chapter_tracks",
        "scene_frames",
        "world_ticks",
        "sp_accounts",
        "sp_ledger",
        "llm_runs",
        "eval_runs",
        "eval_case_results",
        "release_gate_reports",
        "observability_snapshots",
        "world_axis_states",
        "shared_history_records",
        "actor_title_progress",
        "shared_consequence_applications",
        "outbox_events",
    } <= tables

    turn_columns = {column["name"] for column in inspector.get_columns("turns")}
    quest_template_columns = {column["name"] for column in inspector.get_columns("quest_templates")}
    item_columns = {column["name"] for column in inspector.get_columns("items")}
    llm_run_columns = {column["name"] for column in inspector.get_columns("llm_runs")}
    eval_run_columns = {column["name"] for column in inspector.get_columns("eval_runs")}
    release_gate_columns = {column["name"] for column in inspector.get_columns("release_gate_reports")}
    observability_snapshot_columns = {column["name"] for column in inspector.get_columns("observability_snapshots")}
    memory_columns = {column["name"] for column in inspector.get_columns("memories")}
    world_tick_columns = {column["name"] for column in inspector.get_columns("world_ticks")}
    world_columns = {column["name"] for column in inspector.get_columns("worlds")}
    world_axis_columns = {column["name"] for column in inspector.get_columns("world_axis_states")}
    shared_history_columns = {column["name"] for column in inspector.get_columns("shared_history_records")}
    title_progress_columns = {column["name"] for column in inspector.get_columns("actor_title_progress")}
    assert "resolution_mode" in turn_columns
    assert "action_type" in turn_columns
    assert {"langfuse_trace_id", "langfuse_trace_url", "langfuse_status"} <= turn_columns
    assert {"stage_key", "unlock_requirements"} <= quest_template_columns
    assert {"effect_kind", "effect_payload", "used_at", "used_event_id"} <= item_columns
    assert {"embedding_status", "embedding_model", "embedded_at"} <= memory_columns
    assert {
        "workflow_name",
        "council_role",
        "stage_index",
        "approval_status",
        "provider_name",
        "provider_response_id",
        "input_context_hash",
        "langfuse_trace_id",
        "langfuse_observation_id",
        "langfuse_trace_url",
        "langfuse_status",
    } <= llm_run_columns
    assert {"langfuse_trace_id", "langfuse_trace_url", "langfuse_status"} <= eval_run_columns
    assert {"langfuse_trace_id", "langfuse_trace_url", "langfuse_status"} <= release_gate_columns
    assert {
        "snapshot_kind",
        "runtime_role",
        "pack_id",
        "world_template_id",
        "release_gate_report_id",
        "primary_slo",
        "canary_health",
        "langfuse_status",
        "metrics",
        "trace_count",
    } <= observability_snapshot_columns
    observability_indexes = {index["name"] for index in inspector.get_indexes("observability_snapshots")}
    assert {
        "ix_observability_snapshots_snapshot_kind",
        "ix_observability_snapshots_pack_id",
        "ix_observability_snapshots_world_template_id",
        "ix_observability_snapshots_release_gate_report_id",
    } <= observability_indexes
    assert {"tick_kind", "status", "seed_turn_id", "location_id", "summary", "started_at", "completed_at"} <= world_tick_columns
    assert "state" in world_columns
    assert {"axis_id", "current_value", "thresholds", "last_event_id"} <= world_axis_columns
    assert {"history_rule_id", "level", "status", "summary", "payload"} <= shared_history_columns
    assert {"title_rule_id", "progress", "progress_target", "source_event_id"} <= title_progress_columns
