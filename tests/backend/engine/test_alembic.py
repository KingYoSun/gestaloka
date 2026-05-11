from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


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
        "player_profiles",
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
        "world_timeline_counters",
        "world_timeline_entries",
        "world_resource_locks",
        "world_broadcast_events",
        "world_broadcast_deliveries",
        "outbox_events",
        "play_localized_text_cache",
        "llm_context_cache_entries",
        "actor_knowledge_entries",
        "pack_preprocess_runs",
        "admin_pack_publication_overrides",
        "admin_world_template_publication_overrides",
        "admin_app_users",
        "admin_runtime_configs",
        "admin_prompt_overrides",
    } <= tables

    event_columns = {column["name"] for column in inspector.get_columns("events")}
    player_profile_columns = {column["name"] for column in inspector.get_columns("player_profiles")}
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
    sp_account_columns = {column["name"] for column in inspector.get_columns("sp_accounts")}
    sp_ledger_columns = {column["name"] for column in inspector.get_columns("sp_ledger")}
    world_axis_columns = {column["name"] for column in inspector.get_columns("world_axis_states")}
    shared_history_columns = {column["name"] for column in inspector.get_columns("shared_history_records")}
    title_progress_columns = {column["name"] for column in inspector.get_columns("actor_title_progress")}
    timeline_entry_columns = {column["name"] for column in inspector.get_columns("world_timeline_entries")}
    resource_lock_columns = {column["name"] for column in inspector.get_columns("world_resource_locks")}
    broadcast_event_columns = {column["name"] for column in inspector.get_columns("world_broadcast_events")}
    broadcast_delivery_columns = {column["name"] for column in inspector.get_columns("world_broadcast_deliveries")}
    play_localization_columns = {column["name"] for column in inspector.get_columns("play_localized_text_cache")}
    llm_context_cache_columns = {column["name"] for column in inspector.get_columns("llm_context_cache_entries")}
    actor_knowledge_columns = {column["name"] for column in inspector.get_columns("actor_knowledge_entries")}
    pack_preprocess_columns = {column["name"] for column in inspector.get_columns("pack_preprocess_runs")}
    pack_publication_override_columns = {
        column["name"] for column in inspector.get_columns("admin_pack_publication_overrides")
    }
    template_publication_override_columns = {
        column["name"] for column in inspector.get_columns("admin_world_template_publication_overrides")
    }
    assert {"canonical_sequence", "canonical_status", "timeline_entry_id"} <= event_columns
    assert {"paid_balance", "bonus_balance"} <= sp_account_columns
    assert {"paid_delta", "bonus_delta", "paid_balance_after", "bonus_balance_after"} <= sp_ledger_columns
    assert {"narrative_preferences", "preferences", "locked_at", "profile_setup_event_id"} <= player_profile_columns
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
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens",
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
    assert {"sequence", "entry_kind", "source_event_id", "affected_location_ids", "narrative_constraint"} <= timeline_entry_columns
    assert {"resource_type", "resource_id", "holder_turn_id", "expires_at", "constraint_summary"} <= resource_lock_columns
    assert {"semantic_key", "lifecycle_kind", "affected_location_ids", "constraint_text"} <= broadcast_event_columns
    assert {"broadcast_event_id", "session_id", "actor_id", "status", "consumed_at"} <= broadcast_delivery_columns
    assert {
        "world_id",
        "actor_id_scope",
        "target_language",
        "source_kind",
        "source_key",
        "source_hash",
        "source_text",
        "localized_text",
        "model_id",
        "prompt_id",
    } <= play_localization_columns
    play_localization_indexes = {index["name"] for index in inspector.get_indexes("play_localized_text_cache")}
    assert "ix_play_localized_text_cache_world_actor_language" in play_localization_indexes
    assert {
        "provider_name",
        "model_id",
        "context_hash",
        "cache_name",
        "expires_at",
        "token_count",
        "last_used_at",
        "status",
    } <= llm_context_cache_columns
    llm_context_cache_indexes = {index["name"] for index in inspector.get_indexes("llm_context_cache_entries")}
    assert "ix_llm_context_cache_entries_status_expires" in llm_context_cache_indexes
    llm_context_cache_uniques = {
        unique["name"] for unique in inspector.get_unique_constraints("llm_context_cache_entries")
    }
    assert "uq_llm_context_cache_provider_model_hash" in llm_context_cache_uniques
    assert {
        "world_id",
        "actor_id",
        "entry_kind",
        "title",
        "summary",
        "status",
        "salience",
        "source_event_id",
        "evidence_payload",
    } <= actor_knowledge_columns
    actor_knowledge_indexes = {index["name"] for index in inspector.get_indexes("actor_knowledge_entries")}
    assert "ix_actor_knowledge_world_actor_kind" in actor_knowledge_indexes
    assert {
        "pack_id",
        "world_template_id",
        "world_id",
        "pack_content_hash",
        "status",
        "counts",
        "error",
        "triggered_by_sub",
        "started_at",
        "completed_at",
    } <= pack_preprocess_columns
    pack_preprocess_indexes = {index["name"] for index in inspector.get_indexes("pack_preprocess_runs")}
    assert {
        "ix_pack_preprocess_runs_scope_hash",
        "ix_pack_preprocess_runs_world_status",
    } <= pack_preprocess_indexes
    assert {"pack_id", "visibility", "publish_status", "updated_by_sub"} <= pack_publication_override_columns
    assert {
        "pack_id",
        "world_template_id",
        "visibility",
        "publish_status",
        "updated_by_sub",
    } <= template_publication_override_columns


def test_alembic_revision_ids_fit_default_version_table():
    repo_root = next(parent for parent in Path(__file__).resolve().parents if (parent / "AGENTS.md").exists() and (parent / "backend").is_dir())
    alembic_path = repo_root / "backend" / "alembic.ini"

    config = Config(str(alembic_path))
    config.set_main_option("script_location", str(repo_root / "backend" / "alembic"))

    overlong_revisions = [
        script.revision
        for script in ScriptDirectory.from_config(config).walk_revisions()
        if script.revision is not None and len(script.revision) > 32
    ]
    assert overlong_revisions == []


def test_paid_bonus_sp_migration_backfills_existing_balance(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "sp-backfill.db"
    sqlite_url = f"sqlite:///{db_path}"
    repo_root = next(parent for parent in Path(__file__).resolve().parents if (parent / "AGENTS.md").exists() and (parent / "backend").is_dir())
    alembic_path = repo_root / "backend" / "alembic.ini"

    monkeypatch.setenv("ALEMBIC_DATABASE_URL", sqlite_url)
    monkeypatch.setenv("DATABASE_URL", sqlite_url)

    config = Config(str(alembic_path))
    config.set_main_option("script_location", str(repo_root / "backend" / "alembic"))
    engine = create_engine(sqlite_url)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('0025_llm_usage_tokens')"))
        conn.execute(
            text(
                "CREATE TABLE sp_accounts ("
                "user_sub VARCHAR(128) NOT NULL PRIMARY KEY, "
                "balance INTEGER NOT NULL DEFAULT 0, "
                "created_at DATETIME NOT NULL, "
                "updated_at DATETIME NOT NULL, "
                "CONSTRAINT ck_sp_accounts_balance_nonnegative CHECK (balance >= 0)"
                ")"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE sp_ledger ("
                "id VARCHAR(36) NOT NULL PRIMARY KEY, "
                "user_sub VARCHAR(128) NOT NULL, "
                "world_id VARCHAR(64), "
                "actor_id VARCHAR(36), "
                "delta INTEGER NOT NULL, "
                "reason_code VARCHAR(64) NOT NULL, "
                "reference_type VARCHAR(64) NOT NULL, "
                "reference_id VARCHAR(96) NOT NULL, "
                "balance_after INTEGER NOT NULL, "
                "created_by_sub VARCHAR(128), "
                "note TEXT, "
                "created_at DATETIME NOT NULL, "
                "updated_at DATETIME NOT NULL, "
                "CONSTRAINT ck_sp_ledger_nonzero_delta CHECK (delta != 0), "
                "CONSTRAINT ck_sp_ledger_actor_requires_world CHECK (actor_id IS NULL OR world_id IS NOT NULL)"
                ")"
            )
        )
        conn.execute(text("CREATE INDEX ix_sp_ledger_user_sub ON sp_ledger (user_sub)"))
        conn.execute(text("CREATE INDEX ix_sp_ledger_world_id ON sp_ledger (world_id)"))

    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO sp_accounts (user_sub, balance, created_at, updated_at) "
                "VALUES ('legacy-user', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO sp_ledger "
                "(id, user_sub, world_id, actor_id, delta, reason_code, reference_type, reference_id, "
                "balance_after, created_by_sub, note, created_at, updated_at) "
                "VALUES ('legacy-ledger', 'legacy-user', NULL, NULL, 10, 'wallet_seed', 'wallet_seed', "
                "'legacy-user', 10, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        account = conn.execute(
            text("SELECT paid_balance, bonus_balance, balance FROM sp_accounts WHERE user_sub = 'legacy-user'")
        ).one()
        ledger = conn.execute(
            text(
                "SELECT paid_delta, bonus_delta, paid_balance_after, bonus_balance_after, delta, balance_after "
                "FROM sp_ledger WHERE id = 'legacy-ledger'"
            )
        ).one()

    assert account == (0, 10, 10)
    assert ledger == (0, 10, 0, 10, 10, 10)
