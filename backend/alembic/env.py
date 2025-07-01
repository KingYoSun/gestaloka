"""
Alembic環境設定
"""

import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from alembic import context

# パスを追加
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

# 設定をインポート
from app.core.config import settings
from app.models.character import Character, CharacterStats, GameSession, Skill  # noqa

# 新しいモデルを追加する場合は、ここにインポートを追加
from app.models.location import (  # noqa
    CharacterLocationHistory,
    ExplorationArea,
    ExplorationLog,
    Location,
    LocationConnection,
    PathType,
)
from app.models.exploration_progress import CharacterExplorationProgress  # noqa
from app.models.log import (  # noqa
    ActionLog,
    CompletedLog,
    CompletedLogSubFragment,
    LogContract,
    LogFragment,
)
from app.models.log_dispatch import (  # noqa
    DispatchEncounter,
    DispatchReport,
    LogDispatch,
)
from app.models.sp import PlayerSP, SPTransaction  # noqa
from app.models.sp_purchase import SPPurchase  # noqa

# 全てのモデルをインポート（自動生成のため必須）
# 重要: モデルの追加時は必ずここにインポートを追加すること
from app.models.user import User  # noqa
from app.models.user_role import UserRole  # noqa

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = SQLModel.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def get_url():
    """データベースURLを取得"""
    return str(settings.DATABASE_URL)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    configuration = config.get_section(config.config_ini_section)
    if configuration is None:
        configuration = {}
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_object=include_object,
            render_item=render_item,
        )

        with context.begin_transaction():
            context.run_migrations()


def include_object(object, name, type_, reflected, compare_to):
    """自動生成時に含めるオブジェクトをフィルタリング"""
    # alembic_versionテーブルは除外
    if type_ == "table" and name == "alembic_version":
        return False
    return True


def render_item(type_, obj, autogen_context):
    """SQLModel用のレンダリング関数"""
    from sqlalchemy.dialects import postgresql

    # PostgreSQL ENUMタイプのレンダリングをカスタマイズ
    if type_ == "type" and isinstance(obj, postgresql.ENUM):
        # ENUMタイプの作成時に既存チェックを追加
        autogen_context.imports.add("import sqlalchemy as sa")
        return f"sa.Enum({', '.join(repr(x) for x in obj.enums)}, name={obj.name!r}, create_type=False)"

    return False


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
