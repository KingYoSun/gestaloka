"""
戦闘システム関連スキーマ
"""

from datetime import datetime
from typing import Any, Optional
from enum import Enum

from pydantic import BaseModel, Field


class BattleState(str, Enum):
    """戦闘状態"""
    NONE = "none"
    STARTING = "starting"
    IN_PROGRESS = "in_progress"
    PLAYER_TURN = "player_turn"
    ENEMY_TURN = "enemy_turn"
    ENDING = "ending"
    FINISHED = "finished"


class BattleActionType(str, Enum):
    """戦闘アクションタイプ"""
    ATTACK = "attack"
    DEFEND = "defend"
    SKILL = "skill"
    ITEM = "item"
    ESCAPE = "escape"
    DIALOGUE = "dialogue"
    ENVIRONMENT = "environment"  # 環境を利用した行動


class CombatantType(str, Enum):
    """戦闘参加者タイプ"""
    PLAYER = "player"
    NPC = "npc"
    MONSTER = "monster"
    BOSS = "boss"


class Combatant(BaseModel):
    """戦闘参加者"""
    id: str = Field(description="参加者ID")
    name: str = Field(description="参加者名")
    type: CombatantType = Field(description="参加者タイプ")
    hp: int = Field(description="現在HP")
    max_hp: int = Field(description="最大HP")
    mp: int = Field(description="現在MP")
    max_mp: int = Field(description="最大MP")
    attack: int = Field(description="攻撃力")
    defense: int = Field(description="防御力")
    speed: int = Field(description="素早さ（行動順）")
    status_effects: list[str] = Field(default_factory=list, description="状態異常")
    metadata: dict[str, Any] = Field(default_factory=dict, description="追加データ")


class BattleEnvironment(BaseModel):
    """戦闘環境"""
    terrain: str = Field(description="地形")
    weather: Optional[str] = Field(default=None, description="天候")
    time_of_day: Optional[str] = Field(default=None, description="時間帯")
    interactive_objects: list[str] = Field(default_factory=list, description="利用可能なオブジェクト")
    special_conditions: list[str] = Field(default_factory=list, description="特殊条件")


class BattleAction(BaseModel):
    """戦闘アクション"""
    actor_id: str = Field(description="行動者ID")
    action_type: BattleActionType = Field(description="アクションタイプ")
    target_id: Optional[str] = Field(default=None, description="対象ID")
    action_text: str = Field(description="アクションの説明")
    metadata: dict[str, Any] = Field(default_factory=dict, description="追加データ（スキルID、アイテムIDなど）")


class BattleResult(BaseModel):
    """戦闘結果"""
    success: bool = Field(description="アクション成功フラグ")
    damage: Optional[int] = Field(default=None, description="与えたダメージ")
    healing: Optional[int] = Field(default=None, description="回復量")
    status_changes: list[str] = Field(default_factory=list, description="状態変化")
    narrative: str = Field(description="結果の描写")
    side_effects: list[str] = Field(default_factory=list, description="副次効果")


class BattleData(BaseModel):
    """戦闘データ（session_data内に格納）"""
    state: BattleState = Field(default=BattleState.NONE, description="戦闘状態")
    turn_count: int = Field(default=0, description="戦闘ターン数")
    combatants: list[Combatant] = Field(default_factory=list, description="戦闘参加者")
    turn_order: list[str] = Field(default_factory=list, description="行動順（参加者ID）")
    current_turn_index: int = Field(default=0, description="現在のターンインデックス")
    environment: Optional[BattleEnvironment] = Field(default=None, description="戦闘環境")
    battle_log: list[dict[str, Any]] = Field(default_factory=list, description="戦闘ログ")
    

class BattleStartRequest(BaseModel):
    """戦闘開始リクエスト"""
    enemy_id: Optional[str] = Field(default=None, description="敵ID（指定がない場合はランダム）")
    enemy_type: Optional[str] = Field(default=None, description="敵タイプ")
    context: Optional[str] = Field(default=None, description="戦闘開始の文脈")


class BattleActionRequest(BaseModel):
    """戦闘アクションリクエスト"""
    action_type: BattleActionType = Field(description="アクションタイプ")
    target_id: Optional[str] = Field(default=None, description="対象ID")
    action_detail: Optional[str] = Field(default=None, description="詳細な行動指定")
    use_environment: Optional[str] = Field(default=None, description="環境要素の利用")


class BattleUpdateResponse(BaseModel):
    """戦闘更新レスポンス"""
    battle_state: BattleState = Field(description="現在の戦闘状態")
    turn_number: int = Field(description="ゲーム全体のターン数")
    battle_turn: int = Field(description="戦闘内のターン数")
    narrative: str = Field(description="戦闘描写")
    combatants: list[Combatant] = Field(description="戦闘参加者の状態")
    current_turn: str = Field(description="現在の行動者")
    choices: Optional[list[dict[str, Any]]] = Field(default=None, description="利用可能な行動")
    battle_ended: bool = Field(default=False, description="戦闘終了フラグ")
    victory: Optional[bool] = Field(default=None, description="勝利フラグ")
    rewards: Optional[dict[str, Any]] = Field(default=None, description="戦闘報酬")