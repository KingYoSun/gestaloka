"""
AIレスポンスキャッシュ

高頻度で使用される固定的なプロンプトに対するレスポンスをキャッシュし、
APIコールを削減してパフォーマンスを向上させます。
"""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class CacheEntry(BaseModel):
    """キャッシュエントリー"""

    key: str = Field(description="キャッシュキー")
    value: str = Field(description="キャッシュされた値")
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    ttl_seconds: int = Field(default=3600)  # デフォルト1時間
    hit_count: int = Field(default=0)

    @property
    def is_expired(self) -> bool:
        """有効期限切れかどうか"""
        return datetime.now(UTC) > self.created_at + timedelta(seconds=self.ttl_seconds)


class ResponseCache:
    """
    AIレスポンスキャッシュ

    特定のプロンプトパターンに対するレスポンスをメモリにキャッシュし、
    同一のリクエストに対して高速に応答を返します。
    """

    def __init__(self, max_entries: int = 1000):
        """
        キャッシュの初期化

        Args:
            max_entries: 最大キャッシュエントリ数
        """
        self._cache: dict[str, CacheEntry] = {}
        self._max_entries = max_entries
        self._enabled = getattr(settings, "AI_RESPONSE_CACHE_ENABLED", True)
        self.logger = logger.bind(service="response_cache")

    def _generate_key(self, prompt: str, **kwargs: Any) -> str:
        """
        プロンプトとパラメータからキャッシュキーを生成

        Args:
            prompt: プロンプト文字列
            **kwargs: 追加パラメータ

        Returns:
            ハッシュ化されたキー
        """
        # キー生成用のデータを作成
        key_data = {
            "prompt": prompt,
            "params": kwargs,
        }

        # JSON化してハッシュ
        key_string = json.dumps(key_data, sort_keys=True)
        return hashlib.sha256(key_string.encode()).hexdigest()

    def get(self, prompt: str, **kwargs: Any) -> Optional[str]:
        """
        キャッシュから値を取得

        Args:
            prompt: プロンプト文字列
            **kwargs: 追加パラメータ

        Returns:
            キャッシュされた値（存在しない場合はNone）
        """
        if not self._enabled:
            return None

        key = self._generate_key(prompt, **kwargs)

        if key in self._cache:
            entry = self._cache[key]

            # 有効期限チェック
            if entry.is_expired:
                self.logger.info("Cache expired", key=key[:8])
                del self._cache[key]
                return None

            # ヒットカウント更新
            entry.hit_count += 1
            self.logger.info(
                "Cache hit",
                key=key[:8],
                hit_count=entry.hit_count,
                age_seconds=(datetime.now(UTC) - entry.created_at).total_seconds(),
            )
            return entry.value

        return None

    def set(self, prompt: str, value: str, ttl_seconds: Optional[int] = None, **kwargs: Any) -> None:
        """
        キャッシュに値を設定

        Args:
            prompt: プロンプト文字列
            value: キャッシュする値
            ttl_seconds: 有効期限（秒）
            **kwargs: 追加パラメータ
        """
        if not self._enabled:
            return

        # キャッシュサイズ制限チェック
        if len(self._cache) >= self._max_entries:
            # 最も古いエントリを削除
            oldest_key = min(self._cache.keys(), key=lambda k: self._cache[k].created_at)
            del self._cache[oldest_key]
            self.logger.info("Evicted oldest cache entry", key=oldest_key[:8])

        key = self._generate_key(prompt, **kwargs)

        entry = CacheEntry(
            key=key,
            value=value,
            ttl_seconds=ttl_seconds or 3600,  # デフォルト1時間
        )

        self._cache[key] = entry
        self.logger.info("Cache set", key=key[:8], ttl_seconds=entry.ttl_seconds, cache_size=len(self._cache))

    def clear(self) -> None:
        """キャッシュをクリア"""
        size = len(self._cache)
        self._cache.clear()
        self.logger.info("Cache cleared", entries_removed=size)

    def get_stats(self) -> dict[str, Any]:
        """
        キャッシュ統計を取得

        Returns:
            統計情報
        """
        total_hits = sum(entry.hit_count for entry in self._cache.values())
        return {
            "enabled": self._enabled,
            "size": len(self._cache),
            "max_size": self._max_entries,
            "total_hits": total_hits,
            "entries": [
                {
                    "key": entry.key[:8],
                    "hit_count": entry.hit_count,
                    "age_seconds": (datetime.now(UTC) - entry.created_at).total_seconds(),
                    "ttl_seconds": entry.ttl_seconds,
                }
                for entry in sorted(self._cache.values(), key=lambda e: e.hit_count, reverse=True)[:10]  # Top 10
            ],
        }


# グローバルキャッシュインスタンス
_response_cache = ResponseCache()


def get_response_cache() -> ResponseCache:
    """グローバルキャッシュインスタンスを取得"""
    return _response_cache
