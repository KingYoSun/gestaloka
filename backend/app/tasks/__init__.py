"""
Celeryタスクパッケージ
"""

from .ai_tasks import generate_log_npc, generate_story_response, generate_world_events
from .cleanup_tasks import (
    archive_old_game_sessions,
    cleanup_expired_sessions,
    cleanup_orphaned_logs,
    cleanup_temporary_npcs,
    optimize_database_indices,
)
from .log_tasks import compile_log_fragments, distribute_log_to_worlds, process_player_log, purify_contaminated_log
from .notification_tasks import (
    broadcast_world_event,
    cleanup_old_notifications,
    send_log_contract_notification,
    send_player_notification,
)
from .session_result_tasks import process_session_result

__all__ = [
    "archive_old_game_sessions",
    "broadcast_world_event",
    "cleanup_expired_sessions",
    "cleanup_old_notifications",
    "cleanup_orphaned_logs",
    "cleanup_temporary_npcs",
    "compile_log_fragments",
    "distribute_log_to_worlds",
    "generate_log_npc",
    "generate_story_response",
    "generate_world_events",
    "optimize_database_indices",
    "process_player_log",
    "process_session_result",
    "purify_contaminated_log",
    "send_log_contract_notification",
    "send_player_notification",
]
