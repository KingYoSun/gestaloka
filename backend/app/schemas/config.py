"""ゲーム設定に関するスキーマ定義"""
from pydantic import BaseModel, Field


class GameConfig(BaseModel):
    """ゲーム設定"""
    
    max_characters_per_user: int = Field(
        default=5,
        description="ユーザーが作成できる最大キャラクター数"
    )
    
    character_initial_stats: CharacterInitialStats = Field(
        description="キャラクターの初期ステータス"
    )
    
    game_mechanics: GameMechanicsConfig = Field(
        description="ゲームメカニクスの設定"
    )


class CharacterInitialStats(BaseModel):
    """キャラクターの初期ステータス設定"""
    
    level: int = Field(default=1, description="初期レベル")
    experience: int = Field(default=0, description="初期経験値")
    health: int = Field(default=100, description="初期HP")
    max_health: int = Field(default=100, description="初期最大HP")
    energy: int = Field(default=100, description="初期エネルギー")
    max_energy: int = Field(default=100, description="初期最大エネルギー")
    attack: int = Field(default=10, description="初期攻撃力")
    defense: int = Field(default=10, description="初期防御力")
    agility: int = Field(default=10, description="初期素早さ")


class GameMechanicsConfig(BaseModel):
    """ゲームメカニクスの設定"""
    
    battle_turn_duration_seconds: int = Field(
        default=30,
        description="バトルの1ターンの制限時間（秒）"
    )
    
    max_battle_turns: int = Field(
        default=50,
        description="バトルの最大ターン数"
    )
    
    experience_gain_formula: str = Field(
        default="base_exp * level_multiplier",
        description="経験値獲得の計算式"
    )
    
    damage_calculation_formula: str = Field(
        default="(attacker.attack * skill_multiplier) - (defender.defense * 0.5)",
        description="ダメージ計算式"
    )
    
    log_fragment_requirements: LogFragmentRequirements = Field(
        description="ログの欠片に関する設定"
    )


class LogFragmentRequirements(BaseModel):
    """ログの欠片に関する設定"""
    
    min_fragments_for_completion: int = Field(
        default=3,
        description="ログ完成に必要な最小欠片数"
    )
    
    max_fragments_for_completion: int = Field(
        default=10,
        description="ログ完成に必要な最大欠片数"
    )
    
    fragment_generation_cooldown_hours: int = Field(
        default=24,
        description="欠片生成のクールダウン時間（時間）"
    )
    
    max_active_contracts: int = Field(
        default=5,
        description="同時に持てる最大契約数"
    )