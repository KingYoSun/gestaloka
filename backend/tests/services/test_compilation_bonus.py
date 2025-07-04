"""
編纂ボーナスシステムのテスト
"""

import pytest
from sqlmodel import Session

from app.models.character import Character
from app.models.log import EmotionalValence, LogFragment, LogFragmentRarity, MemoryType
from app.models.user import User
from app.services.compilation_bonus import BonusType, CompilationBonusService


@pytest.fixture
def test_user(session: Session):
    """テスト用ユーザー"""
    from datetime import datetime
    from uuid import uuid4

    unique_id = str(uuid4())[:8]
    user = User(
        id=str(uuid4()),
        username=f"test_user_{unique_id}",
        email=f"test_{unique_id}@example.com",
        hashed_password="hashed",
        created_at=datetime.utcnow(),
    )
    session.add(user)
    session.commit()
    return user


@pytest.fixture
def test_character(session: Session, test_user):
    """テスト用キャラクター"""
    from datetime import datetime
    from uuid import uuid4

    character = Character(
        id=str(uuid4()),
        user_id=test_user.id,
        name="テストキャラクター",
        personality='["記憶収集者"]',
        created_at=datetime.utcnow(),
    )
    session.add(character)
    session.commit()
    return character


@pytest.fixture
def test_fragments(session: Session, test_character):
    """テスト用フラグメント"""
    from datetime import datetime
    from uuid import uuid4

    fragments = [
        LogFragment(
            id=str(uuid4()),
            character_id=test_character.id,
            action_description="勇気ある行動",
            keyword="勇気",
            keywords=["勇気", "決意"],
            emotional_valence=EmotionalValence.POSITIVE,
            rarity=LogFragmentRarity.RARE,
            memory_type=MemoryType.COURAGE.value,
            created_at=datetime.utcnow(),
        ),
        LogFragment(
            id=str(uuid4()),
            character_id=test_character.id,
            action_description="自己犠牲的な行動",
            keyword="犠牲",
            keywords=["犠牲", "献身"],
            emotional_valence=EmotionalValence.MIXED,
            rarity=LogFragmentRarity.EPIC,
            memory_type=MemoryType.SACRIFICE.value,
            created_at=datetime.utcnow(),
        ),
        LogFragment(
            id=str(uuid4()),
            character_id=test_character.id,
            action_description="光をもたらす行動",
            keyword="光",
            keywords=["光", "希望"],
            emotional_valence=EmotionalValence.POSITIVE,
            rarity=LogFragmentRarity.LEGENDARY,
            memory_type=MemoryType.VICTORY.value,
            created_at=datetime.utcnow(),
        ),
        LogFragment(
            id=str(uuid4()),
            character_id=test_character.id,
            action_description="闇に関連する行動",
            keyword="闇",
            keywords=["闇", "絶望"],
            emotional_valence=EmotionalValence.NEGATIVE,
            rarity=LogFragmentRarity.LEGENDARY,
            memory_type=MemoryType.TRUTH.value,
            created_at=datetime.utcnow(),
        ),
    ]

    for fragment in fragments:
        session.add(fragment)
    session.commit()

    return fragments


class TestCompilationBonusService:
    """編纂ボーナスサービスのテスト"""

    def test_calculate_base_sp_cost(self, session: Session, test_fragments):
        """基本SP消費の計算テスト"""
        service = CompilationBonusService(session)

        # 単一フラグメント
        cost = service._calculate_base_sp_cost([test_fragments[0]])  # RARE
        assert cost == 40

        # 複数フラグメント
        cost = service._calculate_base_sp_cost(test_fragments[:3])  # RARE, EPIC, LEGENDARY
        assert cost == 40 + 80 + 160

        # 4つ以上のフラグメント（追加コスト）
        cost = service._calculate_base_sp_cost(test_fragments)  # 4つ
        assert cost == 40 + 80 + 160 + 160 + 20  # 基本コスト + 追加コスト

    def test_memory_combo_detection(self, session: Session, test_character, test_fragments):
        """記憶タイプコンボの検出テスト"""
        service = CompilationBonusService(session)

        # 勇気と犠牲のコンボ
        result = service.calculate_compilation_bonuses(
            core_fragment=test_fragments[0],  # COURAGE
            sub_fragments=[test_fragments[1]],  # SACRIFICE
            character=test_character,
        )

        assert len(result.combo_bonuses) >= 1
        assert any(
            bonus.bonus_type == BonusType.SPECIAL_TITLE and bonus.title == "英雄的犠牲者"
            for bonus in result.combo_bonuses
        )

    def test_keyword_combo_detection(self, session: Session, test_character, test_fragments):
        """キーワードコンボの検出テスト"""
        service = CompilationBonusService(session)

        # 光と闇のコンボ
        result = service.calculate_compilation_bonuses(
            core_fragment=test_fragments[2],  # 光
            sub_fragments=[test_fragments[3]],  # 闇
            character=test_character,
        )

        assert any(bonus.bonus_type == BonusType.PURIFICATION for bonus in result.combo_bonuses)

    def test_contamination_calculation(self, session: Session, test_fragments):
        """汚染度計算のテスト"""
        service = CompilationBonusService(session)

        # ポジティブのみ
        contamination = service._calculate_contamination([test_fragments[0], test_fragments[2]])
        assert contamination == 0.0

        # ネガティブを含む
        contamination = service._calculate_contamination(test_fragments)
        assert contamination == 0.25  # 1/4がネガティブ

    def test_character_trait_bonus(self, session: Session, test_character, test_fragments):
        """キャラクター特性によるボーナステスト"""
        service = CompilationBonusService(session)

        result = service.calculate_compilation_bonuses(
            core_fragment=test_fragments[0], sub_fragments=[test_fragments[1]], character=test_character
        )

        # 記憶収集者特性による10%削減
        base_cost = 40 + 80  # RARE + EPIC
        expected_cost = int(base_cost * 0.9)
        assert result.final_sp_cost == expected_cost

    def test_legendary_combo(self, session: Session, test_character, test_fragments):
        """レジェンダリーフラグメントコンボのテスト"""
        service = CompilationBonusService(session)

        # 2つのレジェンダリー
        result = service.calculate_compilation_bonuses(
            core_fragment=test_fragments[2],  # LEGENDARY
            sub_fragments=[test_fragments[3]],  # LEGENDARY
            character=test_character,
        )

        assert any(
            bonus.bonus_type == BonusType.SPECIAL_TITLE and bonus.title == "伝説の編纂者"
            for bonus in result.combo_bonuses
        )
