"""ゲーム設定APIエンドポイント"""
from fastapi import APIRouter
from app.schemas.config import GameConfig, CharacterInitialStats, GameMechanicsConfig, LogFragmentRequirements
from app.core.config import settings

router = APIRouter()


@router.get("/game", response_model=GameConfig)
async def get_game_config():
    """
    ゲーム設定を取得
    
    フロントエンドで使用する各種ゲーム設定値を返します。
    これにより、設定値の重複を避け、バックエンドを唯一の真実の源とします。
    """
    return GameConfig(
        max_characters_per_user=settings.MAX_CHARACTERS_PER_USER,
        character_initial_stats=CharacterInitialStats(
            level=1,
            experience=0,
            health=100,
            max_health=100,
            energy=100,
            max_energy=100,
            attack=10,
            defense=10,
            agility=10
        ),
        game_mechanics=GameMechanicsConfig(
            battle_turn_duration_seconds=30,
            max_battle_turns=50,
            experience_gain_formula="base_exp * level_multiplier",
            damage_calculation_formula="(attacker.attack * skill_multiplier) - (defender.defense * 0.5)",
            log_fragment_requirements=LogFragmentRequirements(
                min_fragments_for_completion=3,
                max_fragments_for_completion=10,
                fragment_generation_cooldown_hours=24,
                max_active_contracts=5
            )
        )
    )


@router.get("/game/character-limits")
async def get_character_limits():
    """
    キャラクター作成制限の設定を取得
    
    主にキャラクター作成画面で使用される設定値を返します。
    """
    return {
        "max_characters_per_user": settings.MAX_CHARACTERS_PER_USER,
        "max_name_length": 50,
        "min_name_length": 1,
        "max_description_length": 1000,
        "max_appearance_length": 1000,
        "max_personality_length": 1000
    }


@router.get("/game/validation-rules")
async def get_validation_rules():
    """
    バリデーションルールを取得
    
    フロントエンドでのバリデーション実装に使用される
    各種フィールドの制限値を返します。
    """
    return {
        "user": {
            "username": {
                "min_length": 3,
                "max_length": 50,
                "pattern": "^[a-zA-Z0-9_-]+$",
                "pattern_description": "英数字、アンダースコア、ハイフンのみ使用可能"
            },
            "password": {
                "min_length": 8,
                "max_length": 100,
                "requirements": [
                    "大文字を1つ以上含む",
                    "小文字を1つ以上含む",
                    "数字を1つ以上含む"
                ]
            }
        },
        "character": {
            "name": {"min_length": 1, "max_length": 50},
            "description": {"max_length": 1000},
            "appearance": {"max_length": 1000},
            "personality": {"max_length": 1000}
        },
        "game_action": {
            "action_text": {"max_length": 1000}
        }
    }