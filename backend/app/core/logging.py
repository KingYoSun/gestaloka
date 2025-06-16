"""
ログ設定
"""

from pathlib import Path
from typing import Any

import structlog
from structlog.stdlib import BoundLogger

from app.core.config import settings


def setup_logging() -> None:
    """構造化ログを設定"""

    # ログディレクトリを作成
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    # プロセッサーを設定
    processors: list[Any] = [
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="ISO"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]

    # 環境に応じてフォーマッターを選択
    if settings.LOG_FORMAT == "json":
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))

    # structlogを設定
    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> BoundLogger:
    """構造化ロガーを取得"""
    logger = structlog.get_logger(name)
    return logger  # type: ignore[no-any-return]


class LoggerMixin:
    """ログ機能を提供するMixin"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.logger = get_logger(self.__class__.__name__)

    def log_info(self, message: str, **kwargs: Any) -> None:
        """情報ログを出力"""
        self.logger.info(message, **kwargs)

    def log_warning(self, message: str, **kwargs: Any) -> None:
        """警告ログを出力"""
        self.logger.warning(message, **kwargs)

    def log_error(self, message: str, **kwargs: Any) -> None:
        """エラーログを出力"""
        self.logger.error(message, **kwargs)

    def log_debug(self, message: str, **kwargs: Any) -> None:
        """デバッグログを出力"""
        self.logger.debug(message, **kwargs)


def log_request_response(
    method: str, url: str, status_code: int, response_time: float, user_id: str | None = None, **kwargs: Any
) -> None:
    """リクエスト・レスポンスをログ"""
    logger = get_logger("api.request")
    logger.info(
        "API request processed",
        method=method,
        url=url,
        status_code=status_code,
        response_time_ms=round(response_time * 1000, 2),
        user_id=user_id,
        **kwargs,
    )


def log_ai_interaction(
    ai_type: str,
    prompt: str,
    response: str,
    response_time: float,
    user_id: str | None = None,
    session_id: str | None = None,
    **kwargs: Any,
) -> None:
    """AI相互作用をログ"""
    logger = get_logger("ai.interaction")
    logger.info(
        "AI interaction",
        ai_type=ai_type,
        prompt_length=len(prompt),
        response_length=len(response),
        response_time_ms=round(response_time * 1000, 2),
        user_id=user_id,
        session_id=session_id,
        **kwargs,
    )


def log_game_event(
    event_type: str, character_id: str, session_id: str, event_data: dict[str, Any], **kwargs: Any
) -> None:
    """ゲームイベントをログ"""
    logger = get_logger("game.event")
    logger.info(
        "Game event",
        event_type=event_type,
        character_id=character_id,
        session_id=session_id,
        event_data=event_data,
        **kwargs,
    )


def log_error_with_context(error: Exception, context: dict[str, Any], **kwargs: Any) -> None:
    """コンテキスト付きエラーログ"""
    logger = get_logger("error")
    logger.error("Error occurred", error_type=type(error).__name__, error_message=str(error), context=context, **kwargs)
