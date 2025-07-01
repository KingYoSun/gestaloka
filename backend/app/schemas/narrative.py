"""
物語主導型探索システムのスキーマ定義
"""

from typing import Any, Optional

from pydantic import BaseModel, Field


class ActionRequest(BaseModel):
    """プレイヤーの行動リクエスト"""

    text: str = Field(..., description="プレイヤーが選択した行動テキスト")
    context: Optional[dict[str, Any]] = Field(None, description="追加のコンテキスト情報")


class ActionChoice(BaseModel):
    """行動選択肢"""

    text: str = Field(..., description="表示する選択肢のテキスト")
    action_type: str = Field(..., description="行動のタイプ（move, investigate, interact等）")
    description: Optional[str] = Field(None, description="選択肢の説明（ツールチップ用）")
    metadata: Optional[dict[str, Any]] = Field(None, description="行動に関連するメタデータ")


class LocationEvent(BaseModel):
    """場所で発生したイベント"""

    type: str = Field(..., description="イベントタイプ")
    title: str = Field(..., description="イベントタイトル")
    description: str = Field(..., description="イベントの詳細")
    effects: Optional[dict[str, Any]] = Field(None, description="イベントの効果")


class NarrativeResponse(BaseModel):
    """物語生成のレスポンス"""

    narrative: str = Field(..., description="生成された物語テキスト")
    location_changed: bool = Field(False, description="場所が変更されたか")
    new_location_id: Optional[str] = Field(None, description="新しい場所のID")
    new_location_name: Optional[str] = Field(None, description="新しい場所の名前")
    sp_consumed: int = Field(0, description="消費されたSP")
    action_choices: list[ActionChoice] = Field(..., description="次の行動選択肢")
    events: Optional[list[LocationEvent]] = Field(None, description="発生したイベント")


class NarrativeUpdate(BaseModel):
    """WebSocket経由の物語更新通知"""

    type: str = Field("narrative_update", description="更新タイプ")
    narrative: str = Field(..., description="物語テキスト")
    location_changed: bool = Field(False, description="場所が変更されたか")
    new_location: Optional[dict[str, Any]] = Field(None, description="新しい場所の情報")
    character_path: Optional[list[dict[str, float]]] = Field(None, description="移動軌跡")


class GMAIResponse(BaseModel):
    """GM AIからのレスポンス"""

    narrative: str = Field(..., description="生成された物語")
    location_changed: bool = Field(False, description="場所変更フラグ")
    new_location_id: Optional[str] = Field(None, description="新しい場所ID")
    movement_description: Optional[str] = Field(None, description="移動の描写")
    sp_cost: int = Field(0, description="SP消費量")
    events: Optional[list[LocationEvent]] = Field(None, description="発生イベント")
