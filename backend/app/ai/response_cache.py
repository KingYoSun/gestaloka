"""
AI応答のキャッシュシステム

重複するAIリクエストを削減し、パフォーマンスを向上させます。
"""

import hashlib
import json
import time
from typing import Any, Optional

from app.core.logging import get_logger

from app.ai.coordination_models import AIResponse

logger = get_logger(__name__)


class ResponseCache:
    """AIレスポンスのキャッシュクラス"""

    def __init__(self, ttl: int = 300, max_size: int = 1000):
        """
        Args:
            ttl: キャッシュの有効期限（秒）
            max_size: キャッシュの最大サイズ
        """
        self.cache: dict[str, tuple[AIResponse, float]] = {}
        self.ttl = ttl
        self.max_size = max_size
        self.hit_count = 0
        self.miss_count = 0

    def _generate_cache_key(self, agent_name: str, context: dict[str, Any]) -> str:
        """キャッシュキーを生成"""
        try:
            # コンテキストを決定的な文字列に変換
            context_str = json.dumps(context, sort_keys=True, default=str)
        except TypeError:
            # JSON変換できない場合は、repr()を使用
            context_str = repr(context)

        # ハッシュを生成
        key_data = f"{agent_name}:{context_str}"
        return hashlib.sha256(key_data.encode()).hexdigest()

    def get(self, agent_name: str, context: dict[str, Any]) -> Optional[AIResponse]:
        """キャッシュからレスポンスを取得"""
        key = self._generate_cache_key(agent_name, context)

        if key in self.cache:
            response, timestamp = self.cache[key]

            # 有効期限をチェック
            if time.time() - timestamp < self.ttl:
                self.hit_count += 1
                logger.debug("Cache hit", agent=agent_name, hit_rate=self.get_hit_rate())
                return response
            else:
                # 期限切れのエントリを削除
                del self.cache[key]

        self.miss_count += 1
        return None

    def set(self, agent_name: str, context: dict[str, Any], response: AIResponse) -> None:
        """レスポンスをキャッシュに保存"""
        # キャッシュサイズの制限
        if len(self.cache) >= self.max_size:
            self._evict_oldest()

        key = self._generate_cache_key(agent_name, context)
        self.cache[key] = (response, time.time())

        logger.debug("Cached response", agent=agent_name, cache_size=len(self.cache))

    def _evict_oldest(self) -> None:
        """最も古いエントリを削除"""
        if not self.cache:
            return

        # 最も古いエントリを見つける
        oldest_key = min(self.cache.keys(), key=lambda k: self.cache[k][1])

        del self.cache[oldest_key]

    def clear(self) -> None:
        """キャッシュをクリア"""
        self.cache.clear()
        self.hit_count = 0
        self.miss_count = 0

    def get_hit_rate(self) -> float:
        """キャッシュヒット率を取得"""
        total = self.hit_count + self.miss_count
        if total == 0:
            return 0.0
        return self.hit_count / total

    def get_stats(self) -> dict[str, Any]:
        """キャッシュ統計を取得"""
        return {
            "size": len(self.cache),
            "hit_count": self.hit_count,
            "miss_count": self.miss_count,
            "hit_rate": self.get_hit_rate(),
            "ttl": self.ttl,
            "max_size": self.max_size,
        }

    def invalidate_agent(self, agent_name: str) -> int:
        """特定のエージェントのキャッシュを無効化"""
        invalidated = 0
        keys_to_remove = []

        for key in self.cache:
            # キーからエージェント名を推測（簡易的な方法）
            # 実際の実装では、キーとエージェント名のマッピングを保持する方が良い
            if key in self.cache:
                response, _ = self.cache[key]
                if response.agent_name == agent_name:
                    keys_to_remove.append(key)

        for key in keys_to_remove:
            del self.cache[key]
            invalidated += 1

        logger.info("Invalidated agent cache", agent=agent_name, count=invalidated)

        return invalidated
