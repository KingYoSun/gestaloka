from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


def test_alembic_upgrade_creates_v2_tables(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "alembic.db"
    sqlite_url = f"sqlite:///{db_path}"
    repo_root = Path(__file__).resolve().parents[2]
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
        "sessions",
        "events",
        "memories",
        "relationships",
        "sp_accounts",
        "sp_ledger",
        "llm_runs",
        "outbox_events",
    } <= tables
