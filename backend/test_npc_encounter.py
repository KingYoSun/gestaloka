#!/usr/bin/env python
"""
NPC遭遇システムのテストスクリプト
WebSocket経由でNPC遭遇イベントを送信してフロントエンドの動作を確認する
"""

import asyncio
import sys
from datetime import datetime
from pathlib import Path

# プロジェクトのルートディレクトリをPythonパスに追加
sys.path.insert(0, str(Path(__file__).parent))

from app.websocket.events import GameEventEmitter
from app.core.logging import get_logger

logger = get_logger(__name__)

# テスト用のNPCデータ
TEST_NPC_DATA = {
    "npc_id": "test-npc-001",
    "name": "迷子の冒険者",
    "title": "記憶を失った者",
    "npc_type": "LOG_NPC",
    "personality_traits": ["好奇心旺盛", "慎重", "親切"],
    "behavior_patterns": ["探索を好む", "戦闘を避ける", "困っている人を助ける"],
    "skills": ["探索", "薬草知識", "地図作成"],
    "appearance": "ぼろぼろの冒険者の装備を身に着けた若い女性。目は澄んでいるが、どこか遠くを見つめているような表情をしている。",
    "backstory": "かつて別の世界で冒険者として活動していたが、ある事件により記憶の一部を失い、この世界に迷い込んだ。",
    "original_player": "Player_123",
    "log_source": "探索ログ#42",
    "contamination_level": 3,
    "persistence_level": 7,
    "current_location": "Nexus",
    "is_active": True
}

# テスト用の選択肢
TEST_CHOICES = [
    {
        "id": "talk",
        "text": "話しかけてみる",
        "difficulty": "easy",
        "requirements": None
    },
    {
        "id": "help",
        "text": "道案内を申し出る",
        "difficulty": "medium",
        "requirements": {"skill": "navigation"}
    },
    {
        "id": "trade",
        "text": "持っているアイテムと交換を提案する",
        "difficulty": "medium",
        "requirements": None
    },
    {
        "id": "attack",
        "text": "警戒して武器を構える",
        "difficulty": "hard",
        "requirements": {"stat": "strength", "value": 10}
    },
    {
        "id": "leave",
        "text": "そっと立ち去る",
        "difficulty": None,
        "requirements": None
    }
]


async def test_npc_encounter(game_session_id: str):
    """NPC遭遇イベントをテスト送信"""
    logger.info(f"Testing NPC encounter for session: {game_session_id}")
    
    # 1. 通常の遭遇
    await GameEventEmitter.emit_npc_encounter(
        game_session_id=game_session_id,
        npc_data=TEST_NPC_DATA,
        encounter_type="friendly",
        choices=TEST_CHOICES
    )
    logger.info("Sent friendly NPC encounter")
    
    await asyncio.sleep(10)
    
    # 2. 敵対的な遭遇
    hostile_npc = TEST_NPC_DATA.copy()
    hostile_npc.update({
        "npc_id": "test-npc-002",
        "name": "汚染された守護者",
        "title": "狂気の番人",
        "contamination_level": 8,
        "personality_traits": ["攻撃的", "予測不能", "執念深い"],
        "behavior_patterns": ["侵入者を攻撃", "領域を守護", "汚染を拡散"],
        "skills": ["戦闘", "呪詛", "追跡"],
        "appearance": "黒い靄に包まれた人型の影。赤く光る目だけがはっきりと見える。"
    })
    
    await GameEventEmitter.emit_npc_encounter(
        game_session_id=game_session_id,
        npc_data=hostile_npc,
        encounter_type="hostile",
        choices=[
            {"id": "fight", "text": "戦う", "difficulty": "hard"},
            {"id": "flee", "text": "逃げる", "difficulty": "medium"},
            {"id": "negotiate", "text": "交渉を試みる", "difficulty": "hard"}
        ]
    )
    logger.info("Sent hostile NPC encounter")
    
    await asyncio.sleep(10)
    
    # 3. 神秘的な遭遇（選択肢なし）
    mysterious_npc = TEST_NPC_DATA.copy()
    mysterious_npc.update({
        "npc_id": "test-npc-003",
        "name": "時の観測者",
        "title": None,
        "npc_type": "PERMANENT_NPC",
        "contamination_level": 0,
        "personality_traits": ["謎めいた", "知識豊富", "中立"],
        "behavior_patterns": ["観察", "助言", "予言"],
        "skills": ["予知", "時空操作", "古代知識"],
        "appearance": "半透明の体を持つ老人の姿。時折、その姿が若返ったり、別の人物に変わったりする。"
    })
    
    await GameEventEmitter.emit_npc_encounter(
        game_session_id=game_session_id,
        npc_data=mysterious_npc,
        encounter_type="mysterious",
        choices=None  # 選択肢なし（デフォルトアクションを使用）
    )
    logger.info("Sent mysterious NPC encounter")


async def main():
    """メイン関数"""
    if len(sys.argv) < 2:
        print("Usage: python test_npc_encounter.py <game_session_id>")
        print("Example: python test_npc_encounter.py session123")
        sys.exit(1)
    
    game_session_id = sys.argv[1]
    
    try:
        await test_npc_encounter(game_session_id)
        logger.info("NPC encounter test completed")
    except Exception as e:
        logger.error(f"Error during test: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())