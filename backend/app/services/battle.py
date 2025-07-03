"""
戦闘システムサービス
"""

import random
from typing import Any, Optional

from sqlmodel import Session

from app.core.logging import get_logger
from app.models.character import Character, CharacterStats
from app.schemas.battle import (
    BattleAction,
    BattleActionType,
    BattleData,
    BattleEnvironment,
    BattleResult,
    BattleState,
    Combatant,
    CombatantType,
)
from app.schemas.game_session import ActionChoice

logger = get_logger(__name__)


class BattleService:
    """戦闘システムサービス"""

    def __init__(self, db: Session):
        self.db = db

    def check_battle_trigger(self, action_result: dict[str, Any], session_data: dict[str, Any]) -> bool:
        """アクション結果から戦闘開始をチェック"""
        # 状態変更に戦闘トリガーが含まれているか確認
        state_changes = action_result.get("state_changes", {})
        if state_changes.get("battle_triggered"):
            return True

        # 特定のキーワードから戦闘を判定
        narrative = action_result.get("narrative", "").lower()
        battle_keywords = ["襲われ", "戦闘", "攻撃", "敵が現れ", "遭遇し", "戦いが始ま"]
        return any(keyword in narrative for keyword in battle_keywords)

    def initialize_battle(
        self,
        character: Character,
        character_stats: CharacterStats,
        enemy_data: Optional[dict[str, Any]] = None,
        environment: Optional[dict[str, Any]] = None,
    ) -> BattleData:
        """戦闘を初期化"""
        # プレイヤーのCombatantを作成
        player_combatant = Combatant(
            id=character.id,
            name=character.name,
            type=CombatantType.PLAYER,
            hp=character_stats.health,
            max_hp=character_stats.max_health,
            mp=character_stats.energy,
            max_mp=character_stats.max_energy,
            attack=character_stats.attack,
            defense=character_stats.defense,
            speed=character_stats.agility,
            status_effects=[],
            metadata={"level": character_stats.level},
        )

        # 敵のCombatantを作成（デフォルトまたは指定）
        if enemy_data:
            enemy_combatant = Combatant(**enemy_data)
        else:
            # デフォルトの敵を生成
            enemy_combatant = self._generate_default_enemy(character_stats.level)

        # 戦闘環境を設定
        battle_environment = None
        if environment:
            battle_environment = BattleEnvironment(
                terrain=environment.get("terrain", "平地"),
                weather=environment.get("weather"),
                time_of_day=environment.get("time_of_day"),
                interactive_objects=environment.get("interactive_objects", []),
                special_conditions=environment.get("special_conditions", []),
            )

        # 行動順を決定（速度順）
        combatants = [player_combatant, enemy_combatant]
        combatants.sort(key=lambda x: x.speed, reverse=True)
        turn_order = [c.id for c in combatants]

        # 戦闘データを作成
        battle_data = BattleData(
            state=BattleState.STARTING,
            turn_count=0,
            combatants=[player_combatant, enemy_combatant],
            turn_order=turn_order,
            current_turn_index=0,
            environment=battle_environment,
            battle_log=[],
        )

        logger.info(
            "Battle initialized",
            player_id=character.id,
            enemy_name=enemy_combatant.name,
            turn_order=turn_order,
        )

        return battle_data

    def get_battle_choices(self, battle_data: BattleData, is_player_turn: bool) -> list[ActionChoice]:
        """戦闘中の選択肢を生成"""
        choices = []

        if is_player_turn:
            # 基本的な戦闘アクション
            choices.extend(
                [
                    ActionChoice(
                        id="battle_attack",
                        text="攻撃する",
                        difficulty="easy",
                        requirements={},
                    ),
                    ActionChoice(
                        id="battle_defend",
                        text="防御する",
                        difficulty="easy",
                        requirements={},
                    ),
                    ActionChoice(
                        id="battle_escape",
                        text="逃走を試みる",
                        difficulty="medium",
                        requirements={},
                    ),
                ]
            )

            # 環境要素の活用
            if battle_data.environment and battle_data.environment.interactive_objects:
                for obj in battle_data.environment.interactive_objects[:2]:  # 最大2つまで
                    choices.append(
                        ActionChoice(
                            id=f"battle_use_{obj}",
                            text=f"{obj}を利用する",
                            difficulty="medium",
                            requirements={},
                        )
                    )

        return choices

    def process_battle_action(
        self,
        battle_data: BattleData,
        action: BattleAction,
    ) -> tuple[BattleResult, BattleData]:
        """戦闘アクションを処理"""
        # 行動者と対象を特定
        actor = next((c for c in battle_data.combatants if c.id == action.actor_id), None)
        target = (
            next((c for c in battle_data.combatants if c.id == action.target_id), None) if action.target_id else None
        )

        if not actor:
            raise ValueError(f"Actor with id {action.actor_id} not found")

        result = BattleResult(
            success=True,
            damage=None,
            healing=None,
            status_changes=[],
            narrative="",
            side_effects=[],
        )

        # アクションタイプに応じた処理
        if action.action_type == BattleActionType.ATTACK:
            if not target:
                # デフォルトターゲットを設定
                target = next((c for c in battle_data.combatants if c.id != actor.id), None)

            if target:
                # ダメージ計算（基本的な計算式）
                base_damage = actor.attack
                defense_reduction = target.defense // 2
                damage = max(1, base_damage - defense_reduction)

                # ランダム要素を追加
                damage = int(damage * random.uniform(0.8, 1.2))

                # ダメージを適用
                target.hp = max(0, target.hp - damage)
                result.damage = damage
                result.narrative = f"{actor.name}の攻撃！{target.name}に{damage}のダメージ！"

        elif action.action_type == BattleActionType.DEFEND:
            # 防御効果を適用
            actor.status_effects.append("defending")
            result.narrative = f"{actor.name}は防御態勢を取った！"
            result.status_changes = ["defending"]

        elif action.action_type == BattleActionType.ESCAPE:
            # 逃走判定
            escape_chance = 0.5  # 基本逃走確率
            if actor.speed > 10:  # 速度が高いと成功率上昇
                escape_chance += 0.2

            if random.random() < escape_chance:
                result.success = True
                result.narrative = f"{actor.name}は戦闘から逃走した！"
                battle_data.state = BattleState.ENDING
            else:
                result.success = False
                result.narrative = f"{actor.name}は逃走に失敗した！"

        elif action.action_type == BattleActionType.ENVIRONMENT:
            # 環境要素の利用
            result.narrative = f"{actor.name}は{action.action_text}を試みた！"
            result.side_effects = ["environment_used"]

        # 戦闘ログに追加
        battle_data.battle_log.append(
            {
                "turn": battle_data.turn_count,
                "actor": actor.name,
                "action": action.action_type,
                "result": result.model_dump(),
            }
        )

        # 戦闘終了判定
        if any(c.hp <= 0 for c in battle_data.combatants):
            battle_data.state = BattleState.ENDING

        return result, battle_data

    def advance_turn(self, battle_data: BattleData) -> tuple[str, bool]:
        """ターンを進める"""
        # 現在のターンを進める
        battle_data.current_turn_index = (battle_data.current_turn_index + 1) % len(battle_data.turn_order)

        # 全員が行動したら新しいターン
        if battle_data.current_turn_index == 0:
            battle_data.turn_count += 1

        current_actor_id = battle_data.turn_order[battle_data.current_turn_index]
        current_actor = next((c for c in battle_data.combatants if c.id == current_actor_id), None)

        is_player_turn = bool(current_actor and current_actor.type == CombatantType.PLAYER)

        # 戦闘状態を更新
        if is_player_turn:
            battle_data.state = BattleState.PLAYER_TURN
        else:
            battle_data.state = BattleState.ENEMY_TURN

        return current_actor_id, is_player_turn

    def check_battle_end(self, battle_data: BattleData) -> tuple[bool, Optional[bool], Optional[dict[str, Any]]]:
        """戦闘終了をチェック"""
        player = next((c for c in battle_data.combatants if c.type == CombatantType.PLAYER), None)
        enemies = [c for c in battle_data.combatants if c.type != CombatantType.PLAYER]

        if not player:
            return True, False, None

        # プレイヤーが倒れた
        if player.hp <= 0:
            return True, False, None

        # 全ての敵が倒れた
        if all(enemy.hp <= 0 for enemy in enemies):
            # 戦闘報酬を生成
            rewards = self._generate_rewards(enemies, battle_data.turn_count)
            return True, True, rewards

        # 逃走成功
        if battle_data.state == BattleState.ENDING:
            return True, None, None

        return False, None, None

    def _generate_default_enemy(self, player_level: int) -> Combatant:
        """デフォルトの敵を生成"""
        enemy_types = [
            {
                "name": "ゴブリン",
                "type": CombatantType.MONSTER,
                "base_stats": {"hp": 30, "attack": 8, "defense": 4, "speed": 6},
            },
            {
                "name": "野生の狼",
                "type": CombatantType.MONSTER,
                "base_stats": {"hp": 25, "attack": 10, "defense": 3, "speed": 8},
            },
            {
                "name": "盗賊",
                "type": CombatantType.NPC,
                "base_stats": {"hp": 40, "attack": 9, "defense": 5, "speed": 7},
            },
        ]

        enemy_template: dict[str, Any] = random.choice(enemy_types)
        base_stats: dict[str, int] = enemy_template["base_stats"]

        # レベルに応じて能力値を調整
        level_modifier = 1 + (player_level - 1) * 0.1

        return Combatant(
            id=f"enemy_{random.randint(1000, 9999)}",
            name=str(enemy_template["name"]),
            type=CombatantType(enemy_template["type"]),
            hp=int(base_stats["hp"] * level_modifier),
            max_hp=int(base_stats["hp"] * level_modifier),
            mp=20,
            max_mp=20,
            attack=int(base_stats["attack"] * level_modifier),
            defense=int(base_stats["defense"] * level_modifier),
            speed=int(base_stats["speed"]),
            status_effects=[],
            metadata={"level": player_level},
        )

    def _generate_rewards(self, defeated_enemies: list[Combatant], turns: int) -> dict[str, Any]:
        """戦闘報酬を生成"""
        total_exp = sum(enemy.metadata.get("level", 1) * 10 for enemy in defeated_enemies)
        total_gold = sum(random.randint(5, 20) * enemy.metadata.get("level", 1) for enemy in defeated_enemies)

        # 速攻ボーナス
        if turns < 5:
            total_exp = int(total_exp * 1.2)
            total_gold = int(total_gold * 1.2)

        rewards = {
            "experience": total_exp,
            "gold": total_gold,
            "items": [],  # 将来的にアイテムドロップを実装
        }

        return rewards
