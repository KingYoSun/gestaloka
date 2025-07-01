"""
PostgreSQL統合テスト用ユーティリティ

テストデータの完全なクリーンアップとセットアップを提供
"""

import os
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlmodel import Session, SQLModel


def get_test_database_url() -> str:
    """テスト用PostgreSQL URLを取得"""
    host = os.getenv("POSTGRES_TEST_HOST", "postgres-test")
    port = os.getenv("POSTGRES_TEST_PORT", "5432")
    user = os.getenv("POSTGRES_TEST_USER", "test_user")
    password = os.getenv("POSTGRES_TEST_PASSWORD", "test_password")
    db = os.getenv("POSTGRES_TEST_DB", "gestaloka_test")

    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


def cleanup_all_postgres_data(engine):
    """
    PostgreSQLの全データを削除する

    警告: このメソッドは全てのテーブルデータを削除します。
    テスト環境でのみ使用してください。
    """
    try:
        with engine.begin() as conn:  # begin()を使用して自動的にコミット/ロールバック
            # 外部キー制約を一時的に無効化
            conn.execute(text("SET session_replication_role = 'replica';"))

            # 全テーブルのデータを削除（システムテーブルを除く）
            result = conn.execute(
                text("""
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
                AND tablename NOT LIKE 'alembic%'
            """)
            )

            tables = result.fetchall()
            for table in tables:
                try:
                    conn.execute(text(f"TRUNCATE TABLE {table[0]} CASCADE"))
                except Exception:
                    pass  # エラーを無視

            # 外部キー制約を再度有効化
            conn.execute(text("SET session_replication_role = 'origin';"))
    except Exception as e:
        print(f"PostgreSQL cleanup error: {e}")


def recreate_schema(engine):
    """
    スキーマを再作成する

    既存のスキーマを削除して新しく作成します。
    """
    try:
        with engine.begin() as conn:  # begin()を使用して自動的にコミット/ロールバック
            # 全テーブルを削除（CASCADE で依存関係も含めて削除）
            result = conn.execute(
                text("""
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
            """)
            )

            tables = result.fetchall()
            for table in tables:
                try:
                    conn.execute(text(f"DROP TABLE IF EXISTS {table[0]} CASCADE"))
                except Exception as e:
                    print(f"Warning: Could not drop table {table[0]}: {e}")

            # ENUMタイプを削除
            enum_types = ["emotionalvalence", "logfragmentrarity", "completedlogstatus"]
            for enum_type in enum_types:
                try:
                    conn.execute(text(f"DROP TYPE IF EXISTS {enum_type} CASCADE"))
                except Exception as e:
                    print(f"Warning: Could not drop type {enum_type}: {e}")

            # ENUMタイプを事前に作成
            # EmotionalValence ENUM
            conn.execute(
                text("""
                DO $$ BEGIN
                    CREATE TYPE emotionalvalence AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL');
                EXCEPTION
                    WHEN duplicate_object THEN null;
                END $$;
            """)
            )

            # LogFragmentRarity ENUM
            conn.execute(
                text("""
                DO $$ BEGIN
                    CREATE TYPE logfragmentrarity AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY');
                EXCEPTION
                    WHEN duplicate_object THEN null;
                END $$;
            """)
            )

            # CompletedLogStatus ENUM
            conn.execute(
                text("""
                DO $$ BEGIN
                    CREATE TYPE completedlogstatus AS ENUM ('DRAFT', 'COMPLETED', 'CONTRACTED', 'ACTIVE', 'EXPIRED', 'RECALLED');
                EXCEPTION
                    WHEN duplicate_object THEN null;
                END $$;
            """)
            )

            conn.commit()
    except Exception as e:
        print(f"PostgreSQL schema recreation error: {e}")
        raise


@contextmanager
def isolated_postgres_test(recreate: bool = False):
    """
    分離されたPostgreSQLテスト環境を提供

    Args:
        recreate: スキーマを再作成するかどうか
    """
    database_url = get_test_database_url()
    # 各テストで新しいエンジンを作成
    engine = create_engine(database_url, pool_pre_ping=True, pool_recycle=3600)

    if recreate:
        recreate_schema(engine)
        # モデルをインポートして確実にテーブルが作成される
        # 全てのモデルを明示的にインポート

        SQLModel.metadata.create_all(engine)
    else:
        cleanup_all_postgres_data(engine)

    session = None
    try:
        session = Session(engine)
        yield session
    finally:
        if session:
            session.close()
        cleanup_all_postgres_data(engine)
        engine.dispose()  # エンジンのコネクションプールをクリア


@contextmanager
def postgres_test_session():
    """PostgreSQLテストセッションのコンテキストマネージャー"""
    database_url = get_test_database_url()
    engine = create_engine(database_url)

    # データをクリーンアップ
    cleanup_all_postgres_data(engine)

    with Session(engine) as session:
        yield session


def verify_test_connection() -> bool:
    """テスト用PostgreSQL接続を検証"""
    try:
        database_url = get_test_database_url()
        engine = create_engine(database_url)

        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            return result.scalar() == 1
    except Exception as e:
        print(f"PostgreSQL test connection verification failed: {e}")
        return False


def get_table_count(engine, table_name: str) -> int:
    """指定されたテーブルの行数を取得"""
    try:
        with engine.connect() as conn:
            result = conn.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
            return result.scalar()
    except Exception:
        return -1


class PostgresTestStats:
    """PostgreSQLテスト統計情報"""

    def __init__(self, engine):
        self.engine = engine
        self.initial_counts = {}
        self.final_counts = {}

    def capture_initial(self):
        """初期状態を記録"""
        with self.engine.connect() as conn:
            result = conn.execute(
                text("""
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
                AND tablename NOT LIKE 'alembic%'
            """)
            )

            tables = result.fetchall()
            for table in tables:
                table_name = table[0]
                self.initial_counts[table_name] = get_table_count(self.engine, table_name)

    def capture_final(self):
        """最終状態を記録"""
        with self.engine.connect() as conn:
            result = conn.execute(
                text("""
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
                AND tablename NOT LIKE 'alembic%'
            """)
            )

            tables = result.fetchall()
            for table in tables:
                table_name = table[0]
                self.final_counts[table_name] = get_table_count(self.engine, table_name)

    def get_diff(self) -> dict:
        """差分を取得"""
        diff = {}
        all_tables = set(self.initial_counts.keys()) | set(self.final_counts.keys())

        for table in all_tables:
            initial = self.initial_counts.get(table, 0)
            final = self.final_counts.get(table, 0)
            if initial != final:
                diff[table] = {"initial": initial, "final": final, "added": final - initial}

        return diff

    def has_leaks(self) -> bool:
        """データリークがあるかチェック"""
        diff = self.get_diff()
        return len(diff) > 0


@contextmanager
def track_postgres_state(engine):
    """
    PostgreSQLの状態変化を追跡

    テスト前後のテーブル行数を記録し、
    データリークを検出
    """
    stats = PostgresTestStats(engine)
    stats.capture_initial()

    try:
        yield stats
    finally:
        stats.capture_final()
        if stats.has_leaks():
            diff = stats.get_diff()
            print(f"Warning: PostgreSQL data leak detected - {diff}")
