"""
編纂ボーナスシステム

フラグメントの組み合わせによる追加効果とコンボシステムを管理
"""

import json
from dataclasses import dataclass
from enum import Enum
from typing import ClassVar, Optional

from sqlmodel import Session, select

from app.models.character import Character
from app.models.log import LogFragment, LogFragmentRarity, MemoryType


class BonusType(str, Enum):
    """ボーナスの種類"""

    SP_COST_REDUCTION = "sp_cost_reduction"  # SP消費削減
    POWER_BOOST = "power_boost"  # ログの力強化
    SKILL_ENHANCEMENT = "skill_enhancement"  # スキル強化
    SPECIAL_TITLE = "special_title"  # 特殊称号獲得
    PURIFICATION = "purification"  # 汚染浄化
    RARITY_UPGRADE = "rarity_upgrade"  # レアリティ昇格
    MEMORY_RESONANCE = "memory_resonance"  # 記憶共鳴


@dataclass
class ComboBonus:
    """コンボボーナス情報"""

    bonus_type: BonusType
    value: float  # ボーナスの効果値
    description: str
    title: Optional[str] = None  # 特殊称号の場合


@dataclass
class CompilationResult:
    """編纂結果"""

    base_sp_cost: int
    final_sp_cost: int
    combo_bonuses: list[ComboBonus]
    contamination_level: float
    final_contamination: float
    special_titles: list[str]
    power_multiplier: float


class CompilationBonusService:
    """編纂ボーナスシステムのサービス"""

    # レアリティごとの基本SP消費
    RARITY_SP_COSTS: ClassVar[dict[LogFragmentRarity, int]] = {
        LogFragmentRarity.COMMON: 10,
        LogFragmentRarity.UNCOMMON: 20,
        LogFragmentRarity.RARE: 40,
        LogFragmentRarity.EPIC: 80,
        LogFragmentRarity.LEGENDARY: 160,
        LogFragmentRarity.UNIQUE: 200,
        LogFragmentRarity.ARCHITECT: 300,
    }

    # 記憶タイプの組み合わせによるボーナス定義
    MEMORY_COMBOS: ClassVar[dict[frozenset[MemoryType], ComboBonus]] = {
        # 2つの組み合わせ
        frozenset([MemoryType.COURAGE, MemoryType.SACRIFICE]): ComboBonus(
            BonusType.SPECIAL_TITLE, 1.0, "勇気と犠牲の組み合わせ", "英雄的犠牲者"
        ),
        frozenset([MemoryType.WISDOM, MemoryType.TRUTH]): ComboBonus(
            BonusType.POWER_BOOST, 1.2, "知恵と真実により力が20%強化"
        ),
        frozenset([MemoryType.FRIENDSHIP, MemoryType.VICTORY]): ComboBonus(
            BonusType.SP_COST_REDUCTION, 0.8, "友情と勝利によりSP消費20%削減"
        ),
        # 3つの組み合わせ
        frozenset([MemoryType.COURAGE, MemoryType.WISDOM, MemoryType.FRIENDSHIP]): ComboBonus(
            BonusType.SPECIAL_TITLE, 1.5, "勇気・知恵・友情の完璧な調和", "三徳の守護者"
        ),
        frozenset([MemoryType.SACRIFICE, MemoryType.TRUTH, MemoryType.MYSTERY]): ComboBonus(
            BonusType.MEMORY_RESONANCE, 2.0, "犠牲・真実・謎が共鳴し、隠された記憶が覚醒"
        ),
    }

    # キーワードの組み合わせによるボーナス
    KEYWORD_COMBOS: ClassVar[dict[frozenset[str], ComboBonus]] = {
        frozenset(["光", "闇"]): ComboBonus(BonusType.PURIFICATION, 0.5, "光と闇の調和により汚染が50%浄化"),
        frozenset(["始まり", "終わり"]): ComboBonus(
            BonusType.RARITY_UPGRADE, 1.0, "始まりと終わりの循環によりレアリティが上昇"
        ),
        frozenset(["破壊", "創造"]): ComboBonus(BonusType.POWER_BOOST, 1.5, "破壊と創造の力により効果が50%強化"),
    }

    def __init__(self, db: Session):
        self.db = db

    def calculate_compilation_bonuses(
        self, core_fragment: LogFragment, sub_fragments: list[LogFragment], character: Character
    ) -> CompilationResult:
        """編纂時のボーナスを計算"""

        all_fragments = [core_fragment, *sub_fragments]

        # 基本SP消費の計算
        base_sp_cost = self._calculate_base_sp_cost(all_fragments)

        # コンボボーナスの検出
        combo_bonuses = self._detect_combo_bonuses(all_fragments)

        # 汚染度の計算
        base_contamination = self._calculate_contamination(all_fragments)

        # ボーナスの適用
        final_sp_cost = base_sp_cost
        final_contamination = base_contamination
        power_multiplier = 1.0
        special_titles = []

        for bonus in combo_bonuses:
            if bonus.bonus_type == BonusType.SP_COST_REDUCTION:
                final_sp_cost = int(final_sp_cost * bonus.value)
            elif bonus.bonus_type == BonusType.POWER_BOOST:
                power_multiplier *= bonus.value
            elif bonus.bonus_type == BonusType.SPECIAL_TITLE:
                if bonus.title:
                    special_titles.append(bonus.title)
            elif bonus.bonus_type == BonusType.PURIFICATION:
                final_contamination *= bonus.value

        # キャラクターの特性による追加ボーナス
        if hasattr(character, 'personality') and character.personality:
            # character.personalityはOptional[str]なので、リストではない
            try:
                traits = json.loads(character.personality)
                if isinstance(traits, list) and "記憶収集者" in traits:
                    final_sp_cost = int(final_sp_cost * 0.9)  # 10%削減
            except (json.JSONDecodeError, TypeError):
                pass

        return CompilationResult(
            base_sp_cost=base_sp_cost,
            final_sp_cost=final_sp_cost,
            combo_bonuses=combo_bonuses,
            contamination_level=base_contamination,
            final_contamination=final_contamination,
            special_titles=special_titles,
            power_multiplier=power_multiplier,
        )

    def _calculate_base_sp_cost(self, fragments: list[LogFragment]) -> int:
        """基本SP消費を計算"""
        total_cost = 0

        for fragment in fragments:
            # rarityはLogFragmentRarity型なので直接使用
            rarity_cost = self.RARITY_SP_COSTS.get(fragment.rarity, 10)
            
            # UNIQUEとARCHITECTは追加コスト
            if fragment.rarity in [LogFragmentRarity.UNIQUE, LogFragmentRarity.ARCHITECT]:
                rarity_cost = int(rarity_cost * 1.5)
            total_cost += rarity_cost

        # フラグメント数による追加コスト
        if len(fragments) > 3:
            total_cost += (len(fragments) - 3) * 20

        return int(total_cost)

    def _detect_combo_bonuses(self, fragments: list[LogFragment]) -> list[ComboBonus]:
        """コンボボーナスを検出"""
        bonuses = []

        # 記憶タイプのコンボ検出
        memory_types = set()
        for fragment in fragments:
            if fragment.memory_type:
                # 文字列からMemoryType Enumに変換
                try:
                    memory_type_enum = MemoryType(fragment.memory_type)
                    memory_types.add(memory_type_enum)
                except ValueError:
                    pass

        for combo_set, bonus in self.MEMORY_COMBOS.items():
            if combo_set.issubset(memory_types):
                bonuses.append(bonus)

        # キーワードのコンボ検出
        all_keywords = set()
        for fragment in fragments:
            if fragment.keyword:
                all_keywords.add(fragment.keyword)
            if fragment.keywords:
                all_keywords.update(fragment.keywords)

        for keyword_set, bonus in self.KEYWORD_COMBOS.items():
            if keyword_set.issubset(all_keywords):
                bonuses.append(bonus)

        # レアリティコンボ
        rarities = [f.rarity for f in fragments]
        if rarities.count(LogFragmentRarity.LEGENDARY) >= 2:
            bonuses.append(ComboBonus(BonusType.SPECIAL_TITLE, 2.0, "複数の伝説的記憶の融合", "伝説の編纂者"))

        # 同一感情価コンボ
        emotional_valences = [f.emotional_valence for f in fragments if f.emotional_valence]
        if len(emotional_valences) >= 3 and len(set(emotional_valences)) == 1:
            # emotional_valenceはEmotionalValence型なので、valueプロパティで文字列値を取得
            emotion_value = emotional_valences[0].value
            bonuses.append(
                ComboBonus(BonusType.POWER_BOOST, 1.3, f"すべて{emotion_value}の感情で統一され、力が30%強化")
            )

        return bonuses

    def _calculate_contamination(self, fragments: list[LogFragment]) -> float:
        """汚染度を計算"""
        from app.models.log import EmotionalValence

        negative_count = sum(1 for f in fragments if f.emotional_valence == EmotionalValence.NEGATIVE)
        total_count = len(fragments)

        if total_count == 0:
            return 0.0

        base_contamination = negative_count / total_count

        # ARCHITECTフラグメントは汚染を増加させる
        architect_count = sum(1 for f in fragments if f.rarity == LogFragmentRarity.ARCHITECT)
        if architect_count > 0:
            base_contamination += architect_count * 0.1

        return min(base_contamination, 1.0)  # 最大100%

    def apply_special_titles(self, character: Character, titles: list[str], db: Session) -> None:
        """特殊称号をキャラクターに付与"""
        from uuid import uuid4

        from app.models.title import CharacterTitle

        for title_name in titles:
            # 既存の称号チェック
            existing = db.exec(
                select(CharacterTitle).where(
                    CharacterTitle.character_id == character.id, CharacterTitle.title == title_name
                )
            ).first()

            if not existing:
                new_title = CharacterTitle(
                    id=str(uuid4()),
                    character_id=character.id,
                    title=title_name,
                    description=f"編纂コンボにより獲得: {title_name}",
                    acquired_at="ログ編纂のコンボボーナス",
                    effects={"source": "compilation_combo", "type": "special"},
                )
                db.add(new_title)

        db.commit()
