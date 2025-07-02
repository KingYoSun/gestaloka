"""記憶継承関連のスキーマ定義"""

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class MemoryInheritanceType(str, Enum):
    """記憶継承のタイプ"""

    SKILL = "skill"  # スキル継承
    TITLE = "title"  # 称号獲得
    ITEM = "item"  # アイテム生成
    LOG_ENHANCEMENT = "log_enhancement"  # ログ強化


class MemoryInheritanceRequest(BaseModel):
    """記憶継承リクエスト"""

    fragment_ids: list[str] = Field(..., min_length=2, description="組み合わせる記憶フラグメントのIDリスト（最低2つ）")
    inheritance_type: MemoryInheritanceType = Field(..., description="継承タイプ")


class MemoryCombinationPreview(BaseModel):
    """記憶組み合わせのプレビュー"""

    fragment_ids: list[str] = Field(..., description="組み合わせる記憶フラグメントのIDリスト")
    possible_types: list[MemoryInheritanceType] = Field(..., description="可能な継承タイプのリスト")
    previews: dict[str, dict[str, Any]] = Field(..., description="各継承タイプのプレビュー情報")
    sp_costs: dict[str, int] = Field(..., description="各継承タイプのSP消費量")
    combo_bonus: Optional[str] = Field(None, description="コンボボーナスの説明")


class MemoryInheritanceResult(BaseModel):
    """記憶継承の結果"""

    success: bool = Field(..., description="継承が成功したかどうか")
    inheritance_type: MemoryInheritanceType = Field(..., description="実行された継承タイプ")
    result: dict[str, Any] = Field(..., description="継承結果の詳細")
    sp_consumed: int = Field(..., description="消費されたSP")
    fragments_used: list[str] = Field(..., description="使用された記憶フラグメントのIDリスト")


class InheritanceHistoryEntry(BaseModel):
    """継承履歴エントリ"""

    id: str = Field(..., description="履歴ID")
    timestamp: str = Field(..., description="継承実行日時")
    fragment_ids: list[str] = Field(..., description="使用した記憶フラグメントのIDリスト")
    inheritance_type: str = Field(..., description="継承タイプ")
    result: dict[str, Any] = Field(..., description="継承結果")


class LogEnhancementInfo(BaseModel):
    """ログ強化情報"""

    enhancement_id: str = Field(..., description="強化ID")
    name: str = Field(..., description="強化名")
    description: str = Field(..., description="強化の説明")
    effects: list[str] = Field(..., description="強化効果のリスト")
    fragment_ids: list[str] = Field(..., description="元となった記憶フラグメントのIDリスト")
