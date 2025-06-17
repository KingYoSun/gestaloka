"""
戦闘サービスのテスト
"""

from unittest.mock import Mock, patch

import pytest

from app.models.character import Character, CharacterStats
from app.schemas.battle import (
    BattleAction,
    BattleActionType,
    BattleData,
    BattleState,
    Combatant,
    CombatantType,
)
from app.services.battle import BattleService


@pytest.fixture
def mock_db():
    """モックデータベースセッション"""
    return Mock()


@pytest.fixture
def battle_service(mock_db):
    """BattleServiceのフィクスチャ"""
    return BattleService(mock_db)


@pytest.fixture
def mock_character():
    """テスト用キャラクター"""
    return Character(
        id="char_1",
        user_id="user_1",
        name="テストヒーロー",
        description="勇敢な冒険者",
        location="starting_village",
    )


@pytest.fixture
def mock_character_stats():
    """テスト用キャラクターステータス"""
    return CharacterStats(
        id="stats_1",
        character_id="char_1",
        level=5,
        health=80,
        max_health=100,
        energy=50,
        max_energy=60,
        attack=15,
        defense=8,
        agility=12,
    )


class TestBattleService:
    """BattleServiceのテストクラス"""

    def test_check_battle_trigger_no_battle(self, battle_service):
        """戦闘トリガーがない場合のテスト"""
        action_result = {
            "narrative": "あなたは平和な村を歩いています。",
            "state_changes": {},
        }
        session_data = {}
        
        result = battle_service.check_battle_trigger(action_result, session_data)
        assert result is False

    def test_check_battle_trigger_with_state_change(self, battle_service):
        """状態変更による戦闘トリガーのテスト"""
        action_result = {
            "narrative": "突然、ゴブリンが襲いかかってきた！",
            "state_changes": {
                "battle_triggered": True,
            },
        }
        session_data = {}
        
        result = battle_service.check_battle_trigger(action_result, session_data)
        assert result is True

    def test_check_battle_trigger_with_keywords(self, battle_service):
        """キーワードによる戦闘トリガーのテスト"""
        action_result = {
            "narrative": "敵が現れた！戦闘開始！",
            "state_changes": {},
        }
        session_data = {}
        
        result = battle_service.check_battle_trigger(action_result, session_data)
        assert result is True

    def test_initialize_battle_default_enemy(self, battle_service, mock_character, mock_character_stats):
        """デフォルト敵での戦闘初期化のテスト"""
        battle_data = battle_service.initialize_battle(
            character=mock_character,
            character_stats=mock_character_stats,
        )
        
        assert battle_data.state == BattleState.STARTING
        assert battle_data.turn_count == 0
        assert len(battle_data.combatants) == 2
        
        # プレイヤーの確認
        player = next(c for c in battle_data.combatants if c.type == CombatantType.PLAYER)
        assert player.name == "テストヒーロー"
        assert player.hp == 80
        assert player.max_hp == 100
        assert player.attack == 15
        assert player.defense == 8
        assert player.speed == 12
        
        # 敵の確認（自動生成）
        enemy = next(c for c in battle_data.combatants if c.type != CombatantType.PLAYER)
        assert enemy.name in ["ゴブリン", "野生の狼", "盗賊"]
        assert enemy.hp > 0
        assert enemy.attack > 0

    def test_initialize_battle_with_enemy_data(self, battle_service, mock_character, mock_character_stats):
        """指定した敵データでの戦闘初期化のテスト"""
        enemy_data = {
            "id": "enemy_boss",
            "name": "ドラゴン",
            "type": CombatantType.BOSS,
            "hp": 200,
            "max_hp": 200,
            "mp": 100,
            "max_mp": 100,
            "attack": 30,
            "defense": 20,
            "speed": 15,
            "status_effects": [],
            "metadata": {"level": 10},
        }
        
        battle_data = battle_service.initialize_battle(
            character=mock_character,
            character_stats=mock_character_stats,
            enemy_data=enemy_data,
        )
        
        # 指定した敵の確認
        enemy = next(c for c in battle_data.combatants if c.type == CombatantType.BOSS)
        assert enemy.name == "ドラゴン"
        assert enemy.hp == 200
        assert enemy.attack == 30

    def test_get_battle_choices_player_turn(self, battle_service):
        """プレイヤーターンの選択肢生成のテスト"""
        battle_data = BattleData(
            state=BattleState.PLAYER_TURN,
            turn_count=1,
            combatants=[],
            turn_order=[],
            current_turn_index=0,
            battle_log=[],
        )
        
        choices = battle_service.get_battle_choices(battle_data, is_player_turn=True)
        
        assert len(choices) >= 3
        assert any(c.text == "攻撃する" for c in choices)
        assert any(c.text == "防御する" for c in choices)
        assert any(c.text == "逃走を試みる" for c in choices)

    def test_get_battle_choices_enemy_turn(self, battle_service):
        """敵ターンの選択肢生成のテスト"""
        battle_data = BattleData(
            state=BattleState.ENEMY_TURN,
            turn_count=1,
            combatants=[],
            turn_order=[],
            current_turn_index=0,
            battle_log=[],
        )
        
        choices = battle_service.get_battle_choices(battle_data, is_player_turn=False)
        
        assert len(choices) == 0  # 敵ターンでは選択肢なし

    def test_process_battle_action_attack(self, battle_service):
        """攻撃アクション処理のテスト"""
        battle_data = BattleData(
            state=BattleState.PLAYER_TURN,
            turn_count=1,
            combatants=[
                Combatant(
                    id="player_1",
                    name="ヒーロー",
                    type=CombatantType.PLAYER,
                    hp=80,
                    max_hp=100,
                    mp=30,
                    max_mp=50,
                    attack=15,
                    defense=8,
                    speed=12,
                    status_effects=[],
                ),
                Combatant(
                    id="enemy_1",
                    name="ゴブリン",
                    type=CombatantType.MONSTER,
                    hp=40,
                    max_hp=40,
                    mp=0,
                    max_mp=0,
                    attack=10,
                    defense=5,
                    speed=8,
                    status_effects=[],
                    metadata={"level": 3},
                ),
            ],
            turn_order=["player_1", "enemy_1"],
            current_turn_index=0,
            battle_log=[],
        )
        
        action = BattleAction(
            action_type=BattleActionType.ATTACK,
            actor_id="player_1",
            target_id="enemy_1",
            action_text="攻撃する",
        )
        
        result, updated_battle_data = battle_service.process_battle_action(battle_data, action)
        
        assert result.success is True
        assert "ダメージ" in result.narrative
        assert result.damage is not None and result.damage > 0
        
        # 敵のHPが減っていることを確認
        enemy = next(c for c in updated_battle_data.combatants if c.id == "enemy_1")
        assert enemy.hp < 40

    def test_process_battle_action_defend(self, battle_service):
        """防御アクション処理のテスト"""
        battle_data = BattleData(
            state=BattleState.PLAYER_TURN,
            turn_count=1,
            combatants=[
                Combatant(
                    id="player_1",
                    name="ヒーロー",
                    type=CombatantType.PLAYER,
                    hp=80,
                    max_hp=100,
                    mp=30,
                    max_mp=50,
                    attack=15,
                    defense=8,
                    speed=12,
                    status_effects=[],
                ),
            ],
            turn_order=["player_1"],
            current_turn_index=0,
            battle_log=[],
        )
        
        action = BattleAction(
            action_type=BattleActionType.DEFEND,
            actor_id="player_1",
            action_text="防御する",
        )
        
        result, updated_battle_data = battle_service.process_battle_action(battle_data, action)
        
        assert result.success is True
        assert "防御" in result.narrative
        
        # 防御バフが付与されていることを確認
        player = next(c for c in updated_battle_data.combatants if c.id == "player_1")
        assert "defending" in player.status_effects

    def test_advance_turn(self, battle_service):
        """ターン進行のテスト"""
        battle_data = BattleData(
            state=BattleState.PLAYER_TURN,
            turn_count=1,
            combatants=[
                Combatant(
                    id="player_1",
                    name="ヒーロー",
                    type=CombatantType.PLAYER,
                    hp=80,
                    max_hp=100,
                    mp=30,
                    max_mp=50,
                    attack=15,
                    defense=8,
                    speed=12,
                    status_effects=[],
                ),
                Combatant(
                    id="enemy_1",
                    name="ゴブリン",
                    type=CombatantType.MONSTER,
                    hp=40,
                    max_hp=40,
                    mp=0,
                    max_mp=0,
                    attack=10,
                    defense=5,
                    speed=8,
                    status_effects=[],
                    metadata={"level": 3},
                ),
            ],
            turn_order=["player_1", "enemy_1"],
            current_turn_index=0,
            battle_log=[],
        )
        
        current_actor_id, is_player_turn = battle_service.advance_turn(battle_data)
        
        assert battle_data.current_turn_index == 1
        assert current_actor_id == "enemy_1"
        assert is_player_turn is False
        assert battle_data.state == BattleState.ENEMY_TURN
        
        # もう一度進めるとプレイヤーターンに戻る
        current_actor_id, is_player_turn = battle_service.advance_turn(battle_data)
        
        assert battle_data.current_turn_index == 0
        assert current_actor_id == "player_1"
        assert is_player_turn is True
        assert battle_data.state == BattleState.PLAYER_TURN
        assert battle_data.turn_count == 2

    def test_check_battle_end_victory(self, battle_service):
        """勝利判定のテスト"""
        battle_data = BattleData(
            state=BattleState.IN_PROGRESS,
            turn_count=5,
            combatants=[
                Combatant(
                    id="player_1",
                    name="ヒーロー",
                    type=CombatantType.PLAYER,
                    hp=50,
                    max_hp=100,
                    mp=20,
                    max_mp=50,
                    attack=15,
                    defense=8,
                    speed=12,
                    status_effects=[],
                ),
                Combatant(
                    id="enemy_1",
                    name="ゴブリン",
                    type=CombatantType.MONSTER,
                    hp=0,
                    max_hp=40,
                    mp=0,
                    max_mp=0,
                    attack=10,
                    defense=5,
                    speed=8,
                    status_effects=[],
                    metadata={"level": 3},
                ),
            ],
            turn_order=["player_1", "enemy_1"],
            current_turn_index=0,
            battle_log=[],
        )
        
        ended, victory, rewards = battle_service.check_battle_end(battle_data)
        
        assert ended is True
        assert victory is True
        assert rewards is not None
        assert rewards["experience"] > 0
        assert rewards["gold"] > 0

    def test_check_battle_end_defeat(self, battle_service):
        """敗北判定のテスト"""
        battle_data = BattleData(
            state=BattleState.IN_PROGRESS,
            turn_count=5,
            combatants=[
                Combatant(
                    id="player_1",
                    name="ヒーロー",
                    type=CombatantType.PLAYER,
                    hp=0,
                    max_hp=100,
                    mp=20,
                    max_mp=50,
                    attack=15,
                    defense=8,
                    speed=12,
                    status_effects=[],
                ),
                Combatant(
                    id="enemy_1",
                    name="ゴブリン",
                    type=CombatantType.MONSTER,
                    hp=20,
                    max_hp=40,
                    mp=0,
                    max_mp=0,
                    attack=10,
                    defense=5,
                    speed=8,
                    status_effects=[],
                    metadata={"level": 3},
                ),
            ],
            turn_order=["player_1", "enemy_1"],
            current_turn_index=0,
            battle_log=[],
        )
        
        ended, victory, rewards = battle_service.check_battle_end(battle_data)
        
        assert ended is True
        assert victory is False
        assert rewards is None

    def test_check_battle_end_escape(self, battle_service):
        """逃走による戦闘終了のテスト"""
        battle_data = BattleData(
            state=BattleState.ENDING,
            turn_count=3,
            combatants=[
                Combatant(
                    id="player_1",
                    name="ヒーロー",
                    type=CombatantType.PLAYER,
                    hp=50,
                    max_hp=100,
                    mp=20,
                    max_mp=50,
                    attack=15,
                    defense=8,
                    speed=12,
                    status_effects=[],
                ),
                Combatant(
                    id="enemy_1",
                    name="ゴブリン",
                    type=CombatantType.MONSTER,
                    hp=30,
                    max_hp=40,
                    mp=0,
                    max_mp=0,
                    attack=10,
                    defense=5,
                    speed=8,
                    status_effects=[],
                    metadata={"level": 3},
                ),
            ],
            turn_order=["player_1", "enemy_1"],
            current_turn_index=0,
            battle_log=[],
        )
        
        ended, victory, rewards = battle_service.check_battle_end(battle_data)
        
        assert ended is True
        assert victory is None  # 逃走の場合は勝敗なし
        assert rewards is None

    @patch("random.choice")
    def test_generate_default_enemy(self, mock_choice, battle_service):
        """デフォルト敵生成のテスト"""
        # ゴブリンを選択するようにモック
        mock_choice.return_value = {
            "name": "ゴブリン",
            "type": CombatantType.MONSTER,
            "base_stats": {"hp": 30, "attack": 8, "defense": 4, "speed": 6}
        }
        
        enemy = battle_service._generate_default_enemy(player_level=5)
        
        assert enemy.name == "ゴブリン"
        assert enemy.type == CombatantType.MONSTER
        # レベル5のモディファイア: 1 + (5-1) * 0.1 = 1.4
        assert enemy.hp == 42  # 30 * 1.4
        assert enemy.attack == 11  # 8 * 1.4
        assert enemy.metadata["level"] == 5

    def test_generate_rewards(self, battle_service):
        """報酬生成のテスト"""
        enemies = [
            Combatant(
                id="enemy_1",
                name="ゴブリン",
                type=CombatantType.MONSTER,
                hp=0,
                max_hp=40,
                mp=0,
                max_mp=0,
                attack=10,
                defense=5,
                speed=8,
                status_effects=[],
                metadata={"level": 3},
            ),
            Combatant(
                id="enemy_2",
                name="スライム",
                type=CombatantType.MONSTER,
                hp=0,
                max_hp=20,
                mp=0,
                max_mp=0,
                attack=5,
                defense=2,
                speed=4,
                status_effects=[],
                metadata={"level": 2},
            ),
        ]
        
        rewards = battle_service._generate_rewards(enemies, turns=3)
        
        # 基本報酬: (3*10 + 2*10) = 50経験値
        # 速攻ボーナス（5ターン未満）: 50 * 1.2 = 60
        assert rewards["experience"] == 60
        assert rewards["gold"] > 0
        assert isinstance(rewards["items"], list)

    @patch("random.random")
    def test_process_battle_action_escape_success(self, mock_random, battle_service):
        """逃走成功のテスト"""
        mock_random.return_value = 0.3  # 成功確率より低い値
        
        battle_data = BattleData(
            state=BattleState.PLAYER_TURN,
            turn_count=2,
            combatants=[
                Combatant(
                    id="player_1",
                    name="ヒーロー",
                    type=CombatantType.PLAYER,
                    hp=50,
                    max_hp=100,
                    mp=20,
                    max_mp=50,
                    attack=15,
                    defense=8,
                    speed=15,  # 高い速度
                    status_effects=[],
                ),
                Combatant(
                    id="enemy_1",
                    name="ゴブリン",
                    type=CombatantType.MONSTER,
                    hp=40,
                    max_hp=40,
                    mp=0,
                    max_mp=0,
                    attack=10,
                    defense=5,
                    speed=8,
                    status_effects=[],
                    metadata={"level": 3},
                ),
            ],
            turn_order=["player_1", "enemy_1"],
            current_turn_index=0,
            battle_log=[],
        )
        
        action = BattleAction(
            action_type=BattleActionType.ESCAPE,
            actor_id="player_1",
            action_text="逃走を試みる",
        )
        
        result, updated_battle_data = battle_service.process_battle_action(battle_data, action)
        
        assert result.success is True
        assert "逃走した" in result.narrative
        assert updated_battle_data.state == BattleState.ENDING