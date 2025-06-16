"""
イベント連鎖システム

AIエージェント間のイベント駆動型相互作用を管理し、
動的で予測不能なゲーム展開を実現します。
"""

import asyncio
import heapq
import uuid
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

import structlog

from app.ai.shared_context import EventType, GameEvent

logger = structlog.get_logger()


@dataclass
class EventHandler:
    """イベントハンドラーの定義"""
    agent_name: str
    event_types: set[EventType]
    handler_func: Callable
    priority: int = 0  # 高いほど優先
    conditions: Optional[Callable] = None  # イベント処理の条件


@dataclass
class EventChainNode:
    """イベント連鎖のノード"""
    event: GameEvent
    depth: int = 0
    parent_id: Optional[str] = None
    children: list[str] = field(default_factory=list)
    processed: bool = False


class EventChain:
    """イベント連鎖管理クラス"""

    def __init__(self, max_chain_depth: int = 3):
        self.event_queue: list[tuple[tuple[int, datetime, int], GameEvent]] = []
        self.handlers: dict[EventType, list[EventHandler]] = defaultdict(list)
        self.event_nodes: dict[str, EventChainNode] = {}
        self.processing_lock = asyncio.Lock()
        self.counter = 0
        self.max_chain_depth = max_chain_depth

        # イベント処理の統計
        self.event_stats: dict[str, Any] = {
            "total_events": 0,
            "chain_events": 0,
            "max_chain_length": 0,
            "events_by_type": defaultdict(int)
        }

    def register_handler(
        self,
        agent_name: str,
        event_types: set[EventType],
        handler_func: Callable,
        priority: int = 0,
        conditions: Optional[Callable] = None
    ) -> None:
        """イベントハンドラーを登録"""
        handler = EventHandler(
            agent_name=agent_name,
            event_types=event_types,
            handler_func=handler_func,
            priority=priority,
            conditions=conditions
        )

        for event_type in event_types:
            self.handlers[event_type].append(handler)
            # 優先度順にソート
            self.handlers[event_type].sort(key=lambda h: h.priority, reverse=True)

        logger.info(
            "Event handler registered",
            agent=agent_name,
            event_types=[et.value for et in event_types],
            priority=priority
        )

    async def emit_event(self, event: GameEvent) -> None:
        """イベントを発行"""
        # イベントIDが設定されていない場合は生成
        if not event.id:
            event.id = str(uuid.uuid4())

        # イベントノードを作成
        node = EventChainNode(
            event=event,
            depth=0,
            parent_id=event.parent_event_id
        )

        # 親イベントがある場合は深度を計算
        if event.parent_event_id and event.parent_event_id in self.event_nodes:
            parent_node = self.event_nodes[event.parent_event_id]
            node.depth = parent_node.depth + 1
            parent_node.children.append(event.id)

        self.event_nodes[event.id] = node

        # 連鎖の深さをチェック
        if event.can_trigger_chain and node.depth < self.max_chain_depth:
            await self._queue_event(event)
        else:
            logger.warning(
                "Event chain depth exceeded",
                event_id=event.id,
                depth=node.depth,
                max_depth=self.max_chain_depth
            )

        # 統計を更新
        self.event_stats["total_events"] += 1
        self.event_stats["events_by_type"][event.type] += 1
        if node.depth > 0:
            self.event_stats["chain_events"] += 1
            self.event_stats["max_chain_length"] = max(
                self.event_stats["max_chain_length"],
                node.depth
            )

    async def _queue_event(self, event: GameEvent) -> None:
        """イベントをキューに追加"""
        # 優先度タプル（優先度が高いほど小さい値）
        priority_tuple = (
            -event.priority.value,  # 負の値にして高優先度を先に
            event.timestamp,
            self.counter
        )

        heapq.heappush(self.event_queue, (priority_tuple, event))
        self.counter += 1

        logger.debug(
            "Event queued",
            event_id=event.id,
            event_type=event.type.value,
            priority=event.priority.value,
            queue_size=len(self.event_queue)
        )

    async def process_events(self) -> None:
        """キューのイベントを処理"""
        async with self.processing_lock:
            processed_count = 0

            while self.event_queue:
                _, event = heapq.heappop(self.event_queue)

                try:
                    await self._process_single_event(event)
                    processed_count += 1
                except Exception as e:
                    logger.error(
                        "Event processing failed",
                        event_id=event.id,
                        event_type=event.type.value,
                        error=str(e)
                    )

            if processed_count > 0:
                logger.info(
                    "Events processed",
                    count=processed_count
                )

    async def _process_single_event(self, event: GameEvent) -> None:
        """単一のイベントを処理"""
        node = self.event_nodes.get(event.id)
        if not node:
            logger.error(f"Event node not found: {event.id}")
            return

        if node.processed:
            logger.warning(f"Event already processed: {event.id}")
            return

        # イベントタイプに対応するハンドラーを取得
        handlers = self.handlers.get(event.type, [])

        # 条件を満たすハンドラーのみ実行
        valid_handlers = []
        for handler in handlers:
            if handler.conditions is None or handler.conditions(event):
                valid_handlers.append(handler)

        logger.info(
            "Processing event",
            event_id=event.id,
            event_type=event.type.value,
            handler_count=len(valid_handlers),
            depth=node.depth
        )

        # 各ハンドラーを実行
        secondary_events = []
        for handler in valid_handlers:
            try:
                result = await handler.handler_func(event)

                # ハンドラーが新しいイベントを返した場合
                if result and isinstance(result, list):
                    for new_event in result:
                        if isinstance(new_event, GameEvent):
                            new_event.parent_event_id = event.id
                            secondary_events.append(new_event)

            except Exception as e:
                logger.error(
                    "Handler execution failed",
                    agent=handler.agent_name,
                    event_id=event.id,
                    error=str(e)
                )

        # ノードを処理済みにマーク
        node.processed = True

        # 二次イベントを発行
        for secondary_event in secondary_events:
            await self.emit_event(secondary_event)

    def get_event_chain(self, event_id: str) -> list[EventChainNode]:
        """特定のイベントから始まる連鎖を取得"""
        chain = []

        def traverse(node_id: str):
            if node_id in self.event_nodes:
                node = self.event_nodes[node_id]
                chain.append(node)
                for child_id in node.children:
                    traverse(child_id)

        traverse(event_id)
        return chain

    def get_event_tree(self, root_event_id: str) -> dict[str, Any]:
        """イベント連鎖をツリー構造で取得"""
        def build_tree(node_id: str) -> dict[str, Any]:
            if node_id not in self.event_nodes:
                return {}

            node = self.event_nodes[node_id]
            return {
                "event_id": node.event.id,
                "event_type": node.event.type.value,
                "depth": node.depth,
                "processed": node.processed,
                "children": [build_tree(child_id) for child_id in node.children]
            }

        return build_tree(root_event_id)

    def clear_processed_events(self, keep_recent: int = 100) -> None:
        """処理済みのイベントをクリア"""
        # 最近のイベントは保持
        all_events = sorted(
            self.event_nodes.values(),
            key=lambda n: n.event.timestamp,
            reverse=True
        )

        keep_ids = {node.event.id for node in all_events[:keep_recent]}

        # 古い処理済みイベントを削除
        removed = 0
        for event_id in list(self.event_nodes.keys()):
            if event_id not in keep_ids:
                node = self.event_nodes[event_id]
                if node.processed:
                    del self.event_nodes[event_id]
                    removed += 1

        if removed > 0:
            logger.info(
                "Cleared processed events",
                removed=removed,
                remaining=len(self.event_nodes)
            )

    def get_statistics(self) -> dict[str, Any]:
        """イベント処理の統計を取得"""
        return {
            **self.event_stats,
            "pending_events": len(self.event_queue),
            "total_nodes": len(self.event_nodes),
            "processed_nodes": sum(
                1 for node in self.event_nodes.values() if node.processed
            )
        }


class EventChainVisualizer:
    """イベント連鎖の可視化ヘルパー"""

    @staticmethod
    def format_chain(chain: list[EventChainNode]) -> str:
        """イベント連鎖を文字列として整形"""
        lines = []
        for node in chain:
            indent = "  " * node.depth
            status = "✓" if node.processed else "○"
            lines.append(
                f"{indent}{status} {node.event.type.value} "
                f"[{node.event.id[:8]}] "
                f"@ {node.event.timestamp.strftime('%H:%M:%S')}"
            )
        return "\n".join(lines)

    @staticmethod
    def format_tree(tree: dict[str, Any], indent: int = 0) -> str:
        """イベントツリーを文字列として整形"""
        if not tree:
            return ""

        lines = []
        prefix = "  " * indent
        status = "✓" if tree.get("processed") else "○"

        lines.append(
            f"{prefix}{status} {tree['event_type']} [{tree['event_id'][:8]}]"
        )

        for child in tree.get("children", []):
            lines.append(EventChainVisualizer.format_tree(child, indent + 1))

        return "\n".join(lines)

