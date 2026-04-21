#!/usr/bin/env python3
"""ログフラグメントのテストデータを作成するスクリプト"""

import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
import random
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlmodel import Session

from app.core.database import engine
from app.models.character import Character
from app.models.game_session import GameSession
from app.models.log import EmotionalValence, LogFragment, LogFragmentRarity

# テストデータのテンプレート
FRAGMENT_TEMPLATES = [
    # 戦闘関連（ポジティブ）
    {
        "action_description": "荒野の獣との戦闘で巧みな戦術を用いて勝利した",
        "keywords": ["戦闘", "戦術", "勝利"],
        "emotional_valence": "positive",
        "rarity": "uncommon",
        "importance_score": 0.7,
    },
    {
        "action_description": "強大な敵に立ち向かい、仲間と協力して撃退した",
        "keywords": ["協力", "勇気", "友情"],
        "emotional_valence": "positive",
        "rarity": "rare",
        "importance_score": 0.85,
    },
    {
        "action_description": "絶体絶命の危機から奇跡的な逆転勝利を収めた",
        "keywords": ["奇跡", "逆転", "英雄"],
        "emotional_valence": "positive",
        "rarity": "epic",
        "importance_score": 0.95,
    },
    # 戦闘関連（ネガティブ）
    {
        "action_description": "油断から敵の罠にかかり、重傷を負った",
        "keywords": ["失敗", "罠", "負傷"],
        "emotional_valence": "negative",
        "rarity": "common",
        "importance_score": 0.6,
    },
    {
        "action_description": "仲間を守ろうとして自らが深い傷を負った",
        "keywords": ["犠牲", "保護", "痛み"],
        "emotional_valence": "negative",
        "rarity": "uncommon",
        "importance_score": 0.75,
    },
    # 探索関連（ポジティブ）
    {
        "action_description": "古代の遺跡で貴重な遺物を発見した",
        "keywords": ["探索", "発見", "遺跡"],
        "emotional_valence": "positive",
        "rarity": "rare",
        "importance_score": 0.8,
    },
    {
        "action_description": "危険な洞窟を探索し、隠された宝物を見つけた",
        "keywords": ["冒険", "宝物", "成功"],
        "emotional_valence": "positive",
        "rarity": "uncommon",
        "importance_score": 0.7,
    },
    {
        "action_description": "謎めいた地図を解読し、秘密の場所を突き止めた",
        "keywords": ["謎解き", "知恵", "解明"],
        "emotional_valence": "positive",
        "rarity": "rare",
        "importance_score": 0.85,
    },
    # 探索関連（ネガティブ）
    {
        "action_description": "迷宮で道に迷い、貴重な時間を失った",
        "keywords": ["迷子", "失敗", "焦り"],
        "emotional_valence": "negative",
        "rarity": "common",
        "importance_score": 0.5,
    },
    {
        "action_description": "古代の呪いに触れてしまい、不吉な予感に襲われた",
        "keywords": ["呪い", "不吉", "恐怖"],
        "emotional_valence": "negative",
        "rarity": "uncommon",
        "importance_score": 0.65,
    },
    # 社交関連（ポジティブ）
    {
        "action_description": "困っている旅人を助け、感謝の言葉を受けた",
        "keywords": ["善行", "助け", "感謝"],
        "emotional_valence": "positive",
        "rarity": "common",
        "importance_score": 0.6,
    },
    {
        "action_description": "敵対していた相手と和解し、新たな友情を築いた",
        "keywords": ["和解", "友情", "理解"],
        "emotional_valence": "positive",
        "rarity": "rare",
        "importance_score": 0.9,
    },
    {
        "action_description": "村の祭りで英雄として称えられた",
        "keywords": ["名誉", "祝福", "英雄"],
        "emotional_valence": "positive",
        "rarity": "epic",
        "importance_score": 0.95,
    },
    # 社交関連（ネガティブ）
    {
        "action_description": "信頼していた仲間に裏切られた",
        "keywords": ["裏切り", "失望", "悲しみ"],
        "emotional_valence": "negative",
        "rarity": "rare",
        "importance_score": 0.85,
    },
    {
        "action_description": "交渉に失敗し、重要な機会を逃した",
        "keywords": ["失敗", "後悔", "機会損失"],
        "emotional_valence": "negative",
        "rarity": "uncommon",
        "importance_score": 0.65,
    },
    # 中立的な記録
    {
        "action_description": "市場で珍しい品物を見つけ、興味深く観察した",
        "keywords": ["観察", "発見", "日常"],
        "emotional_valence": "neutral",
        "rarity": "common",
        "importance_score": 0.4,
    },
    {
        "action_description": "古い書物から新しい知識を学んだ",
        "keywords": ["学習", "知識", "成長"],
        "emotional_valence": "neutral",
        "rarity": "uncommon",
        "importance_score": 0.6,
    },
    {
        "action_description": "静かな夜に星空を眺めて過ごした",
        "keywords": ["休息", "平穏", "内省"],
        "emotional_valence": "neutral",
        "rarity": "common",
        "importance_score": 0.3,
    },
    # 伝説的な出来事
    {
        "action_description": "古代の龍と対峙し、その知恵を授かった",
        "keywords": ["龍", "伝説", "知恵"],
        "emotional_valence": "positive",
        "rarity": "legendary",
        "importance_score": 1.0,
    },
    {
        "action_description": "失われた神器を発見し、その力を解放した",
        "keywords": ["神器", "力", "運命"],
        "emotional_valence": "positive",
        "rarity": "legendary",
        "importance_score": 1.0,
    },
]


async def create_test_fragments():
    """テスト用のログフラグメントを作成する"""
    with Session(engine) as session:
        # 既存のキャラクターとゲームセッションを取得
        characters = session.exec(select(Character)).all()
        if not characters:
            print("エラー: キャラクターが存在しません。先にキャラクターを作成してください。")
            return

        sessions = session.exec(select(GameSession)).all()
        if not sessions:
            print("エラー: ゲームセッションが存在しません。先にセッションを作成してください。")
            return

        print(f"テストデータ作成開始: {len(characters)}個のキャラクター、{len(sessions)}個のセッション")

        created_count = 0
        base_time = datetime.utcnow() - timedelta(days=30)

        # 各キャラクターに対してフラグメントを作成
        for character in characters:
            # 各キャラクターに10-20個のフラグメントを作成
            num_fragments = random.randint(10, 20)

            for i in range(num_fragments):
                # テンプレートからランダムに選択
                template = random.choice(FRAGMENT_TEMPLATES)

                # セッションをランダムに選択
                session_for_fragment = random.choice(sessions)

                # 時系列でフラグメントを作成
                created_at = base_time + timedelta(days=i, hours=random.randint(0, 23))

                # コンテキストデータを生成
                context_data = {
                    "location": random.choice(["荒野", "森林", "洞窟", "街", "遺跡", "山岳"]),
                    "weather": random.choice(["晴れ", "曇り", "雨", "霧", "嵐"]),
                    "time_of_day": random.choice(["朝", "昼", "夕方", "夜", "深夜"]),
                    "health_status": random.randint(50, 100),
                    "party_size": random.randint(1, 4),
                }

                fragment = LogFragment(
                    id=str(uuid4()),
                    character_id=character.id,
                    session_id=session_for_fragment.id,
                    action_description=template["action_description"],
                    keywords=template["keywords"],
                    emotional_valence=EmotionalValence(template["emotional_valence"]),
                    rarity=LogFragmentRarity(template["rarity"]),
                    importance_score=template["importance_score"] + random.uniform(-0.1, 0.1),  # 少し変動を加える
                    context_data=context_data,
                    created_at=created_at,
                )

                session.add(fragment)
                created_count += 1

        session.commit()
        print(f"✅ {created_count}個のログフラグメントを作成しました")

        # 作成結果のサマリー
        for character in characters:
            fragments = session.exec(select(LogFragment).where(LogFragment.character_id == character.id)).all()

            rarity_counts = {}
            valence_counts = {}

            for fragment in fragments:
                rarity_counts[fragment.rarity] = rarity_counts.get(fragment.rarity, 0) + 1
                valence_counts[fragment.emotional_valence] = valence_counts.get(fragment.emotional_valence, 0) + 1

            print(f"\n{character.name}のフラグメント統計:")
            print(f"  総数: {len(fragments)}")
            print(f"  レアリティ: {rarity_counts}")
            print(f"  感情価: {valence_counts}")


if __name__ == "__main__":
    asyncio.run(create_test_fragments())
