"""AI関連の共通ユーティリティ"""
import json
import re
from functools import wraps
from typing import Any, Dict, List, Optional, TypeVar, Callable

from app.core.exceptions import AIServiceError
from app.core.logging import get_logger
from .constants import JSON_BLOCK_PATTERN

logger = get_logger(__name__)

T = TypeVar('T')


class ResponseParser:
    """AI応答の解析共通処理"""
    
    @staticmethod
    def extract_json_block(raw_response: str) -> Optional[Dict[str, Any]]:
        """レスポンスからJSONブロックを抽出"""
        json_match = re.search(JSON_BLOCK_PATTERN, raw_response, re.DOTALL)
        if json_match:
            try:
                json_str = json_match.group(1)
                return json.loads(json_str)
            except json.JSONDecodeError as e:
                logger.error("JSON parse error", error=str(e), json_str=json_str)
                return None
        return None
    
    @staticmethod
    def extract_choices(data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """選択肢の抽出と検証"""
        choices = data.get("choices", [])
        if not isinstance(choices, list):
            logger.warning("Choices is not a list", choices=choices)
            return []
        
        # 各選択肢の検証
        valid_choices = []
        for choice in choices:
            if isinstance(choice, dict) and "text" in choice:
                valid_choices.append(choice)
        
        return valid_choices
    
    @staticmethod
    def extract_text_content(data: Dict[str, Any], field: str = "content") -> str:
        """テキストコンテンツの抽出"""
        content = data.get(field, "")
        if not isinstance(content, str):
            return str(content)
        return content.strip()


def agent_error_handler(agent_name: str):
    """エージェント共通のエラーハンドリングデコレータ"""
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            try:
                return await func(*args, **kwargs)
            except AIServiceError:
                # AIServiceErrorはそのまま再スロー
                raise
            except Exception as e:
                # コンテキスト情報を取得
                context = kwargs.get('context') or (args[1] if len(args) > 1 else None)
                context_info = {}
                if context and hasattr(context, 'character_name'):
                    context_info['character'] = context.character_name
                if context and hasattr(context, 'location'):
                    context_info['location'] = context.location
                
                logger.error(
                    f"{agent_name} processing failed",
                    error=str(e),
                    **context_info
                )
                raise AIServiceError(f"{agent_name} agent error: {e!s}")
        
        return wrapper
    return decorator


class ContextEnhancer:
    """コンテキスト拡張の共通処理"""
    
    @staticmethod
    def add_location_info(base_context: str, location: Optional[str]) -> str:
        """位置情報をコンテキストに追加"""
        if location:
            return f"{base_context}\n現在地: {location}"
        return base_context
    
    @staticmethod
    def add_recent_actions(base_context: str, actions: List[str], limit: int = 5) -> str:
        """最近のアクションをコンテキストに追加"""
        if actions:
            recent = actions[-limit:]
            actions_str = "\n".join(f"- {action}" for action in recent)
            return f"{base_context}\n\n最近の行動:\n{actions_str}"
        return base_context
    
    @staticmethod
    def add_emotional_state(base_context: str, emotional_state: Optional[str]) -> str:
        """感情状態をコンテキストに追加"""
        if emotional_state:
            return f"{base_context}\n感情状態: {emotional_state}"
        return base_context
    
    @staticmethod
    def add_world_events(base_context: str, events: List[Dict[str, Any]]) -> str:
        """世界イベントをコンテキストに追加"""
        if events:
            events_str = "\n".join(
                f"- {event.get('name', '不明なイベント')}: {event.get('status', '進行中')}"
                for event in events
            )
            return f"{base_context}\n\n世界の状況:\n{events_str}"
        return base_context


def validate_context(context: Any, required_fields: List[str]) -> None:
    """コンテキストの必須フィールドを検証"""
    missing_fields = []
    for field in required_fields:
        if not hasattr(context, field):
            missing_fields.append(field)
    
    if missing_fields:
        raise ValueError(f"Context missing required fields: {', '.join(missing_fields)}")


def build_system_prompt(agent_type: str, additional_instructions: str = "") -> str:
    """エージェント用のシステムプロンプトを構築"""
    from .constants import WORLD_NAME, WORLD_DESCRIPTION, BASE_SYSTEM_PROMPT
    
    base_prompt = BASE_SYSTEM_PROMPT.format(
        world_name=WORLD_NAME,
        world_description=WORLD_DESCRIPTION
    )
    
    if additional_instructions:
        return f"{base_prompt}\n\n{additional_instructions}"
    
    return base_prompt