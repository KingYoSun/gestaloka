"""
SP計算ロジックを統合したサービス

すべてのSP関連の計算ロジックを一元化し、DRY原則に従って実装
"""

from decimal import Decimal
from typing import Dict, List, Optional

from app.models.log import CompletedLog, LogFragment, LogFragmentRarity
from app.models.title import CharacterTitle


class SPCalculationService:
    """SP計算ロジックを統合したサービス"""

    # 基本SP消費コスト
    BASE_ACTION_COST = 10
    BASE_COMPILATION_COST = 10
    BASE_PURIFICATION_COST = 30
    BASE_MEMORY_INHERITANCE_COST = 50

    # レアリティ係数
    RARITY_MULTIPLIERS = {
        LogFragmentRarity.COMMON: 1.0,
        LogFragmentRarity.UNCOMMON: 1.5,
        LogFragmentRarity.RARE: 2.0,
        LogFragmentRarity.EPIC: 3.0,
        LogFragmentRarity.LEGENDARY: 5.0
    }

    @classmethod
    def calculate_action_cost(cls, 
                            action_type: str,
                            complexity: Optional[str] = None,
                            has_bonus: bool = False) -> int:
        """アクションのSPコストを計算
        
        Args:
            action_type: アクションタイプ
            complexity: 複雑度（simple, normal, complex）
            has_bonus: ボーナスがあるか
            
        Returns:
            SP消費量
        """
        cost = cls.BASE_ACTION_COST

        # 複雑度による調整
        if complexity == "simple":
            cost = int(cost * 0.8)
        elif complexity == "complex":
            cost = int(cost * 1.5)

        # ボーナスによる割引
        if has_bonus:
            cost = int(cost * 0.8)

        return max(cost, 1)  # 最低1SP

    @classmethod
    def calculate_compilation_cost(cls,
                                 fragments: List[LogFragment],
                                 combo_multiplier: float = 1.0,
                                 contamination_level: float = 0.0) -> int:
        """ログ編纂のSPコストを計算
        
        Args:
            fragments: 使用するフラグメントリスト
            combo_multiplier: コンボボーナス倍率
            contamination_level: 汚染度（0.0-1.0）
            
        Returns:
            SP消費量
        """
        # 基本コスト = ベースコスト + フラグメント数 * 2
        base_cost = cls.BASE_COMPILATION_COST + len(fragments) * 2

        # レアリティによる追加コスト
        rarity_cost = 0
        for fragment in fragments:
            rarity = fragment.rarity or LogFragmentRarity.COMMON
            rarity_cost += int(5 * cls.RARITY_MULTIPLIERS.get(rarity, 1.0))

        total_cost = base_cost + rarity_cost

        # コンボボーナスによる割引（最大50%オフ）
        if combo_multiplier > 1.0:
            discount = min(0.5, (combo_multiplier - 1.0) * 0.1)
            total_cost = int(total_cost * (1 - discount))

        # 汚染による追加コスト
        if contamination_level > 0:
            contamination_cost = int(total_cost * contamination_level * 0.5)
            total_cost += contamination_cost

        return max(total_cost, 5)  # 最低5SP

    @classmethod
    def calculate_purification_cost(cls,
                                  log: CompletedLog,
                                  purification_strength: float = 1.0) -> int:
        """ログ浄化のSPコストを計算
        
        Args:
            log: 浄化対象のログ
            purification_strength: 浄化強度（1.0-3.0）
            
        Returns:
            SP消費量
        """
        base_cost = cls.BASE_PURIFICATION_COST

        # 汚染度による追加コスト
        contamination_cost = int(base_cost * log.contamination_level)

        # 浄化強度による倍率
        strength_multiplier = purification_strength

        total_cost = int((base_cost + contamination_cost) * strength_multiplier)

        return max(total_cost, 10)  # 最低10SP

    @classmethod
    def calculate_memory_inheritance_cost(cls,
                                        inheritance_type: str,
                                        source_rarity: LogFragmentRarity,
                                        target_level: int = 1) -> int:
        """記憶継承のSPコストを計算
        
        Args:
            inheritance_type: 継承タイプ（skill, title, item, log_enhancement）
            source_rarity: ソースログのレアリティ
            target_level: ターゲットのレベル
            
        Returns:
            SP消費量
        """
        base_cost = cls.BASE_MEMORY_INHERITANCE_COST

        # レアリティによる倍率
        rarity_multiplier = cls.RARITY_MULTIPLIERS.get(source_rarity, 1.0)

        # 継承タイプによる倍率
        type_multipliers = {
            "skill": 1.0,
            "title": 1.5,
            "item": 1.2,
            "log_enhancement": 2.0
        }
        type_multiplier = type_multipliers.get(inheritance_type, 1.0)

        # ターゲットレベルによる追加コスト
        level_cost = (target_level - 1) * 10

        total_cost = int((base_cost + level_cost) * rarity_multiplier * type_multiplier)

        return max(total_cost, 20)  # 最低20SP

    @classmethod
    def calculate_dispatch_cost(cls,
                              log_rarity: LogFragmentRarity,
                              destination_distance: int = 1,
                              special_effects: bool = False) -> int:
        """ログ派遣のSPコストを計算
        
        Args:
            log_rarity: 派遣するログのレアリティ
            destination_distance: 派遣先の距離（階層差）
            special_effects: 特殊効果を持つか
            
        Returns:
            SP消費量
        """
        # 基本コスト：レアリティ基準
        rarity_multiplier = cls.RARITY_MULTIPLIERS.get(log_rarity, 1.0)
        base_cost = int(20 * rarity_multiplier)

        # 距離による追加コスト
        distance_cost = destination_distance * 5

        # 特殊効果による追加コスト
        special_cost = 10 if special_effects else 0

        total_cost = base_cost + distance_cost + special_cost

        return max(total_cost, 10)  # 最低10SP

    @classmethod
    def calculate_title_effects_bonus(cls,
                                    titles: List[CharacterTitle]) -> float:
        """称号効果によるSPボーナス倍率を計算
        
        Args:
            titles: 装備中の称号リスト
            
        Returns:
            ボーナス倍率（0.8 = 20%割引など）
        """
        if not titles:
            return 1.0

        total_discount = 0.0
        
        for title in titles:
            if title.is_equipped and title.effects:
                # SPコスト削減効果を探す
                sp_discount = title.effects.get("sp_cost_reduction", 0)
                total_discount += sp_discount

        # 最大50%割引
        total_discount = min(total_discount, 0.5)

        return 1.0 - total_discount

    @classmethod
    def apply_test_mode_discount(cls, cost: int, is_test_mode: bool = False) -> int:
        """テストモードの割引を適用
        
        Args:
            cost: 元のコスト
            is_test_mode: テストモードか
            
        Returns:
            割引後のコスト
        """
        if is_test_mode:
            # テストモードでは10%のコスト
            return max(int(cost * 0.1), 1)
        return cost