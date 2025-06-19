"""
アプリケーション設定
"""

from functools import lru_cache

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """アプリケーション設定"""

    # アプリケーション基本設定
    PROJECT_NAME: str = "GESTALOKA API"
    VERSION: str = "0.1.0"
    DESCRIPTION: str = "マルチプレイ・テキストMMO - ゲスタロカ API"
    ENVIRONMENT: str = Field(default="development", validation_alias="ENVIRONMENT")
    DEBUG: bool = Field(default=True, validation_alias="DEBUG")

    # API設定
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = Field(default="default-dev-secret-key-change-in-production", validation_alias="SECRET_KEY")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60 * 24 * 8, validation_alias="ACCESS_TOKEN_EXPIRE_MINUTES")  # 8日

    # データベース設定
    DATABASE_URL: str = Field(
        default="postgresql://gestaloka_user:gestaloka_password@localhost:5432/gestaloka",
        validation_alias="DATABASE_URL",
    )

    # Neo4j設定
    NEO4J_URI: str = Field(default="bolt://localhost:7687", validation_alias="NEO4J_URI")
    NEO4J_USER: str = Field(default="neo4j", validation_alias="NEO4J_USER")
    NEO4J_PASSWORD: str = Field(default="gestaloka_neo4j_password", validation_alias="NEO4J_PASSWORD")

    # Redis設定
    REDIS_URL: str = Field(default="redis://localhost:6379/0", validation_alias="REDIS_URL")

    # Celery設定
    CELERY_BROKER_URL: str = Field(default="redis://localhost:6379/0", validation_alias="CELERY_BROKER_URL")
    CELERY_RESULT_BACKEND: str = Field(default="redis://localhost:6379/0", validation_alias="CELERY_RESULT_BACKEND")

    # KeyCloak設定
    KEYCLOAK_SERVER_URL: str = Field(default="http://localhost:8080", validation_alias="KEYCLOAK_SERVER_URL")
    KEYCLOAK_REALM: str = Field(default="gestaloka", validation_alias="KEYCLOAK_REALM")
    KEYCLOAK_CLIENT_ID: str = Field(default="gestaloka-client", validation_alias="KEYCLOAK_CLIENT_ID")
    KEYCLOAK_CLIENT_SECRET: str = Field(
        default="your-keycloak-client-secret", validation_alias="KEYCLOAK_CLIENT_SECRET"
    )

    # LLM設定
    LLM_MODEL: str = Field(default="gemini-2.5-pro", validation_alias="LLM_MODEL")
    LLM_TEMPERATURE: float = Field(default=0.7, validation_alias="LLM_TEMPERATURE")
    LLM_MAX_TOKENS: int = Field(default=2048, validation_alias="LLM_MAX_TOKENS")

    # CORS設定
    BACKEND_CORS_ORIGINS: list[AnyHttpUrl] = Field(
        default=[
            AnyHttpUrl("http://localhost:3000"),
            AnyHttpUrl("http://localhost:8000"),
            AnyHttpUrl("http://127.0.0.1:3000"),
            AnyHttpUrl("http://127.0.0.1:8000"),
        ],
        validation_alias="BACKEND_CORS_ORIGINS",
    )

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: str | list[str]) -> list[str] | str:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, list | str):
            return v
        raise ValueError(v)

    # ログ設定
    LOG_LEVEL: str = Field(default="INFO", validation_alias="LOG_LEVEL")
    LOG_FORMAT: str = Field(default="json", validation_alias="LOG_FORMAT")  # json or console

    # ファイルアップロード設定
    MAX_UPLOAD_SIZE: int = Field(default=10 * 1024 * 1024, validation_alias="MAX_UPLOAD_SIZE")  # 10MB
    UPLOAD_DIR: str = Field(default="uploads", validation_alias="UPLOAD_DIR")

    # ゲーム設定
    MAX_CHARACTERS_PER_USER: int = Field(default=5, validation_alias="MAX_CHARACTERS_PER_USER")
    MAX_ACTIVE_SESSIONS_PER_USER: int = Field(default=1, validation_alias="MAX_ACTIVE_SESSIONS_PER_USER")
    DEFAULT_STARTING_LOCATION: str = Field(default="starting_village", validation_alias="DEFAULT_STARTING_LOCATION")
    DEFAULT_CHARACTER_HP: int = Field(default=100, validation_alias="DEFAULT_CHARACTER_HP")
    DEFAULT_CHARACTER_ENERGY: int = Field(default=100, validation_alias="DEFAULT_CHARACTER_ENERGY")
    DEFAULT_CHARACTER_ATTACK: int = Field(default=10, validation_alias="DEFAULT_CHARACTER_ATTACK")
    DEFAULT_CHARACTER_DEFENSE: int = Field(default=5, validation_alias="DEFAULT_CHARACTER_DEFENSE")

    # AI設定
    AI_RESPONSE_TIMEOUT: int = Field(default=30, validation_alias="AI_RESPONSE_TIMEOUT")  # 秒
    MAX_AI_RETRIES: int = Field(default=3, validation_alias="MAX_AI_RETRIES")
    GEMINI_API_KEY: str = Field(default="", validation_alias="GEMINI_API_KEY")
    GEMINI_MODEL: str = Field(default="gemini-2.5-pro", validation_alias="GEMINI_MODEL")

    # WebSocket設定
    WS_HEARTBEAT_INTERVAL: int = Field(default=30, validation_alias="WS_HEARTBEAT_INTERVAL")  # 秒
    WS_CONNECTION_TIMEOUT: int = Field(default=300, validation_alias="WS_CONNECTION_TIMEOUT")  # 秒

    # セキュリティ設定
    PASSWORD_MIN_LENGTH: int = Field(default=8, validation_alias="PASSWORD_MIN_LENGTH")
    JWT_ALGORITHM: str = Field(default="HS256", validation_alias="JWT_ALGORITHM")

    # モニタリング設定
    ENABLE_METRICS: bool = Field(default=True, validation_alias="ENABLE_METRICS")
    METRICS_PORT: int = Field(default=9090, validation_alias="METRICS_PORT")

    # 開発設定
    RELOAD_ON_CHANGE: bool = Field(default=True, validation_alias="RELOAD_ON_CHANGE")

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache
def get_settings() -> Settings:
    """設定のシングルトンインスタンスを取得"""
    return Settings()


# 設定インスタンス
settings = get_settings()
