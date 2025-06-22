"""
データベース設定・接続管理
"""

from collections.abc import AsyncGenerator, Generator

import redis.asyncio as redis
import structlog
from neomodel import config as neo4j_config
from neomodel import db as neo4j_db
from sqlmodel import Session, create_engine

from app.core.config import settings

logger = structlog.get_logger(__name__)

# PostgreSQL設定
engine = create_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_size=10,
    max_overflow=20,
)

# Celeryタスク用のセッションファクトリ
SessionLocal = lambda: Session(engine)


def create_db_and_tables():
    """データベースとテーブルを作成

    注意: このプロジェクトではAlembicでスキーマ管理を行うため、
    SQLModel.metadata.create_all()は使用しません。

    スキーマの変更は必ずAlembicを使用して行ってください：
    1. モデルを変更/追加
    2. alembic/env.pyにモデルをインポート
    3. docker-compose exec -T backend alembic revision --autogenerate -m "説明"
    4. 生成されたマイグレーションを確認
    5. docker-compose exec -T backend alembic upgrade head
    """
    logger.info("Database tables must be created using Alembic migrations")


def get_session() -> Generator[Session, None, None]:
    """PostgreSQLセッションを取得"""
    with Session(engine) as session:
        try:
            yield session
        except Exception as e:
            logger.error("Database session error", error=str(e))
            session.rollback()
            raise
        finally:
            session.close()


# Neo4j設定
def setup_neo4j():
    """Neo4j接続を設定"""
    # neomodelが要求する形式: bolt://user:password@host:port
    neo4j_url = f"bolt://{settings.NEO4J_USER}:{settings.NEO4J_PASSWORD}@neo4j:7687"

    logger.info("Setting up Neo4j connection", url=neo4j_url, user=settings.NEO4J_USER)

    neo4j_config.DATABASE_URL = neo4j_url

    # 接続テスト
    try:
        neo4j_db.cypher_query("RETURN 1")
        logger.info("Neo4j connection established")
    except Exception as e:
        logger.error("Failed to connect to Neo4j", error=str(e))
        raise


def get_neo4j_session():
    """Neo4jセッションを取得"""
    return neo4j_db


# Redis設定
redis_client = None


async def setup_redis():
    """Redis接続を設定"""
    global redis_client
    try:
        redis_client = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=20,
        )
        # 接続テスト
        await redis_client.ping()
        logger.info("Redis connection established")
    except Exception as e:
        logger.error("Failed to connect to Redis", error=str(e))
        raise


async def get_redis() -> AsyncGenerator[redis.Redis, None]:
    """Redisクライアントを取得"""
    if redis_client is None:
        await setup_redis()
    if redis_client is not None:
        yield redis_client
    else:
        raise RuntimeError("Redis client not initialized")


async def close_redis():
    """Redis接続を閉じる"""
    global redis_client
    if redis_client:
        await redis_client.close()
        redis_client = None


# データベース初期化
async def init_db():
    """全データベースを初期化"""
    try:
        # PostgreSQL初期化
        create_db_and_tables()
        logger.info("PostgreSQL initialized")

        # Neo4j初期化
        setup_neo4j()

        # Redis初期化
        await setup_redis()

        logger.info("All databases initialized successfully")
    except Exception as e:
        logger.error("Database initialization failed", error=str(e))
        raise


# データベースクリーンアップ
async def cleanup_db():
    """データベース接続をクリーンアップ"""
    try:
        # Redis接続を閉じる
        await close_redis()

        # PostgreSQLエンジンをクリーンアップ
        engine.dispose()

        logger.info("Database connections cleaned up")
    except Exception as e:
        logger.error("Database cleanup failed", error=str(e))
