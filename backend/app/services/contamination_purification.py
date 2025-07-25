"""
汚染浄化メカニクス

ログの汚染を浄化し、より純粋な記憶を作り出すシステム
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, ClassVar, Optional

from sqlmodel import Session, select

from app.core.exceptions import InsufficientSPError
from app.models.character import Character
from app.models.item import CharacterItem, Item
from app.models.log import CompletedLog, EmotionalValence, LogFragment
from app.services.sp_service import SPService


@dataclass
class PurificationResult:
    """浄化結果"""

    original_contamination: float
    purified_contamination: float
    purification_rate: float
    sp_cost: int
    items_consumed: list[str]
    new_traits: list[str]
    special_effects: dict[str, Any]


class ContaminationPurificationService:
    """汚染浄化サービス"""

    # 浄化アイテムと効果
    PURIFICATION_ITEMS: ClassVar[dict[str, dict[str, Any]]] = {
        "聖水": {"power": 0.1, "sp_cost": 10, "rarity": "common"},
        "光のクリスタル": {"power": 0.2, "sp_cost": 30, "rarity": "uncommon"},
        "浄化の書": {"power": 0.3, "sp_cost": 50, "rarity": "rare"},
        "天使の涙": {"power": 0.5, "sp_cost": 100, "rarity": "epic"},
        "世界樹の葉": {"power": 0.7, "sp_cost": 200, "rarity": "legendary"},
    }

    # 浄化による特性変化
    PURIFICATION_TRAITS: ClassVar[dict[float, list[str]]] = {
        0.3: ["清らか", "純粋"],  # 30%以上浄化
        0.5: ["聖なる光", "守護者"],  # 50%以上浄化
        0.7: ["浄化の化身", "光の導き手"],  # 70%以上浄化
        1.0: ["完全なる純粋", "聖者"],  # 100%浄化
    }

    # コンテキスト修復による特性
    CONTEXT_RESTORATION_TRAITS: ClassVar[dict[str, list[str]]] = {
        "memory_coherence": ["記憶の照満者", "意味の守護者"],
        "emotional_balance": ["感情の調律者", "平静の化身"],
        "context_clarity": ["真実の語り手", "文脈の編み手"],
    }

    def __init__(self, db: Session):
        self.db = db
        self.sp_service = SPService(db)

    async def purify_completed_log(
        self, log_id: str, character: Character, purification_items: list[str]
    ) -> PurificationResult:
        """
        完成ログの汚染を浄化

        浄化は単なる数値の減少ではなく、歪んだコンテキストを修正し、
        記憶が本来持っていた意味を取り戻すプロセス
        """

        # ログの取得と所有権確認
        log = self.db.exec(
            select(CompletedLog).where(CompletedLog.id == log_id, CompletedLog.creator_id == character.id)
        ).first()

        if not log:
            raise ValueError("Completed log not found")

        # 現在の汚染度
        original_contamination = log.contamination_level

        # 浄化力とSPコストの計算
        total_purification_power = 0.0
        total_sp_cost = 0
        items_consumed = []

        for item_name in purification_items:
            if item_name not in self.PURIFICATION_ITEMS:
                continue

            item_info = self.PURIFICATION_ITEMS[item_name]

            # アイテムの所持確認
            character_item = self.db.exec(
                select(CharacterItem)
                .join(Item)
                .where(CharacterItem.character_id == character.id, Item.name == item_name, CharacterItem.quantity > 0)
            ).first()

            if character_item:
                total_purification_power += item_info["power"]
                total_sp_cost += item_info["sp_cost"]
                items_consumed.append(item_name)

                # アイテムを消費
                character_item.quantity -= 1
                if character_item.quantity <= 0:
                    self.db.delete(character_item)

        # SP残高確認
        player_sp = await self.sp_service.get_balance(character.user_id)
        if player_sp.current_sp < total_sp_cost:
            raise InsufficientSPError(f"Insufficient SP. Required: {total_sp_cost}, Current: {player_sp.current_sp}")

        # SP消費
        from app.models.sp import SPTransactionType

        await self.sp_service.consume_sp(
            user_id=character.user_id,
            amount=total_sp_cost,
            transaction_type=SPTransactionType.LOG_ENHANCEMENT,
            description=f"汚染浄化: {log.name}",
        )

        # 浄化計算（コンテキスト修正プロセス）
        purification_rate = min(total_purification_power, 1.0)

        # 汚染度が高いほど浄化が困難（コンテキストの歪みが深い）
        if original_contamination > 0.75:
            # 極度の汚染は浄化効果が半減
            effective_rate = purification_rate * 0.5
        elif original_contamination > 0.5:
            # 重度の汚染は浄化効果が低下
            effective_rate = purification_rate * 0.75
        else:
            effective_rate = purification_rate

        purified_contamination = max(0.0, original_contamination * (1 - effective_rate))

        # 特性の付与
        new_traits = []
        for threshold, traits in self.PURIFICATION_TRAITS.items():
            if purification_rate >= threshold:
                new_traits.extend(traits)

        # 特殊効果の計算
        special_effects = self._calculate_special_effects(
            log, original_contamination, purified_contamination, purification_rate
        )

        # ログの更新
        log.contamination_level = purified_contamination

        # メタデータの更新
        if not log.compilation_metadata:
            log.compilation_metadata = {}

        log.compilation_metadata["purification_history"] = log.compilation_metadata.get("purification_history", [])
        log.compilation_metadata["purification_history"].append(
            {
                "timestamp": datetime.now(UTC).isoformat(),
                "original_contamination": original_contamination,
                "purified_contamination": purified_contamination,
                "purification_rate": purification_rate,
                "items_used": items_consumed,
                "sp_cost": total_sp_cost,
                "context_restoration": {
                    "process": "歪んだ文脈の修正",
                    "emotional_balance": "負の感情ループの遮断",
                    "memory_coherence": "記憶の一貫性回復",
                },
            }
        )

        # 新しい特性の追加
        if new_traits:
            current_traits = log.personality_traits or []
            log.personality_traits = list(set(current_traits + new_traits))

        self.db.commit()

        return PurificationResult(
            original_contamination=original_contamination,
            purified_contamination=purified_contamination,
            purification_rate=purification_rate,
            sp_cost=total_sp_cost,
            items_consumed=items_consumed,
            new_traits=new_traits,
            special_effects=special_effects,
        )

    def _calculate_special_effects(
        self, log: CompletedLog, original_contamination: float, purified_contamination: float, purification_rate: float
    ) -> dict[str, Any]:
        """浄化による特殊効果を計算"""

        effects = {}

        # 完全浄化ボーナス
        if purified_contamination == 0.0:
            effects["perfect_purification"] = {
                "bonus_type": "power_multiplier",
                "value": 1.5,
                "description": "完全なる浄化により、ログの力が50%強化",
            }

        # 大幅浄化ボーナス
        elif purification_rate >= 0.8:
            effects["major_purification"] = {
                "bonus_type": "skill_enhancement",
                "value": 1.2,
                "description": "大幅な浄化により、スキル効果が20%強化",
            }

        # コンテキスト修復ボーナス
        if original_contamination >= 0.5 and purified_contamination <= 0.25:
            effects["context_restoration"] = {
                "bonus_type": "memory_clarity",
                "value": "restored",
                "description": "歪んだコンテキストが修復され、記憶の本来の意味が明確に",
            }

        # 汚染反転
        if original_contamination >= 0.7 and purified_contamination <= 0.3:
            effects["corruption_reversal"] = {
                "bonus_type": "special_title",
                "value": "闇から光へ",
                "description": "深い汚染からの浄化により特殊称号を獲得",
            }

        return effects

    async def create_purification_item(self, character: Character, fragments: list[LogFragment]) -> Optional[Item]:
        """浄化アイテムの作成（特定のフラグメント組み合わせから）"""

        # ポジティブなフラグメントの割合を確認
        positive_count = sum(1 for f in fragments if f.emotional_valence == EmotionalValence.POSITIVE)
        total_count = len(fragments)

        if total_count < 3:
            return None

        positive_ratio = positive_count / total_count

        # 高い割合のポジティブフラグメントから浄化アイテムを生成
        from app.models.item import ItemRarity, ItemType

        if positive_ratio >= 0.9:
            item_name = "光のクリスタル"
            item_rarity = ItemRarity.UNCOMMON
        elif positive_ratio >= 0.7:
            item_name = "聖水"
            item_rarity = ItemRarity.COMMON
        else:
            return None

        # アイテムが既に存在するか確認
        existing_item = self.db.exec(select(Item).where(Item.name == item_name)).first()

        if not existing_item:
            # 新しいアイテムを作成
            from uuid import uuid4

            new_item = Item(
                id=str(uuid4()),
                name=item_name,
                description=f"ログフラグメントから生成された{item_name}",
                item_type=ItemType.CONSUMABLE,
                rarity=item_rarity,
                effects={"purification_power": self.PURIFICATION_ITEMS[item_name]["power"], "type": "purification"},
            )
            self.db.add(new_item)
            self.db.commit()
            existing_item = new_item

        # キャラクターのインベントリに追加
        char_item = self.db.exec(
            select(CharacterItem).where(
                CharacterItem.character_id == character.id, CharacterItem.item_id == existing_item.id
            )
        ).first()

        if char_item:
            char_item.quantity += 1
        else:
            from uuid import uuid4

            char_item = CharacterItem(
                id=str(uuid4()),
                character_id=character.id,
                item_id=existing_item.id,
                quantity=1,
                obtained_at="フラグメントから生成",
            )
            self.db.add(char_item)

        self.db.commit()
        return existing_item
