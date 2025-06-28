"""
派遣ログ同士の相互作用システム

異なるプレイヤーから派遣されたログ同士が出会い、
相互作用することで、より豊かな物語を生成します。
"""

import random
from datetime import datetime
from typing import Any, Optional

import structlog
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.models.log import CompletedLog
from app.models.log_dispatch import (
    DispatchEncounter,
    DispatchObjectiveType,
    LogDispatch,
    DispatchStatus,
)
from app.services.ai.agents.dramatist import DramatistAgent
from app.services.ai.prompt_manager import PromptContext

logger = structlog.get_logger(__name__)


class DispatchInteraction(BaseModel):
    """派遣ログ間の相互作用"""

    dispatch_id_1: str
    dispatch_id_2: str
    location: str
    interaction_type: str
    outcome: str
    narrative: str
    impact_on_dispatch_1: dict[str, Any]
    impact_on_dispatch_2: dict[str, Any]
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class InteractionOutcome(BaseModel):
    """相互作用の結果"""

    success: bool
    relationship_change: float = Field(ge=-1.0, le=1.0)
    items_exchanged: list[dict[str, Any]] = Field(default_factory=list)
    knowledge_shared: list[str] = Field(default_factory=list)
    conflict_resolved: Optional[bool] = None
    alliance_formed: bool = False


class DispatchInteractionManager:
    """
    派遣ログ同士の相互作用を管理するシステム
    """

    def __init__(self):
        """マネージャーの初期化"""
        self.dramatist = DramatistAgent()
        self.logger = logger

    async def check_and_process_interactions(
        self,
        db: Session,
    ) -> list[DispatchInteraction]:
        """
        現在活動中の派遣ログ同士の相互作用をチェックし処理

        Args:
            db: データベースセッション

        Returns:
            処理された相互作用のリスト
        """
        # 活動中の派遣を取得
        active_dispatches = self._get_active_dispatches(db)

        if len(active_dispatches) < 2:
            return []

        interactions = []

        # 派遣ペアをチェック
        for i in range(len(active_dispatches)):
            for j in range(i + 1, len(active_dispatches)):
                dispatch_1 = active_dispatches[i]
                dispatch_2 = active_dispatches[j]

                # 相互作用の可能性をチェック
                if self._should_interact(dispatch_1, dispatch_2):
                    interaction = await self._process_interaction(
                        dispatch_1,
                        dispatch_2,
                        db,
                    )
                    if interaction:
                        interactions.append(interaction)

        return interactions

    def _get_active_dispatches(self, db: Session) -> list[LogDispatch]:
        """活動中の派遣を取得"""
        stmt = select(LogDispatch).where(
            LogDispatch.status == DispatchStatus.DISPATCHED
        )
        result = db.exec(stmt)
        return list(result.all())

    def _should_interact(
        self,
        dispatch_1: LogDispatch,
        dispatch_2: LogDispatch,
    ) -> bool:
        """
        2つの派遣が相互作用すべきかを判定

        Args:
            dispatch_1: 派遣1
            dispatch_2: 派遣2

        Returns:
            相互作用すべきかどうか
        """
        # 同じプレイヤーの派遣同士は相互作用しない
        if dispatch_1.player_id == dispatch_2.player_id:
            return False

        # 最近の活動場所を取得
        location_1 = self._get_current_location(dispatch_1)
        location_2 = self._get_current_location(dispatch_2)

        # 同じ場所にいない場合は相互作用しない
        if location_1 != location_2:
            return False

        # 目的タイプによる相互作用確率
        interaction_probability = self._calculate_interaction_probability(
            dispatch_1.objective_type,
            dispatch_2.objective_type,
        )

        # 最後の相互作用からの経過時間を確認
        hours_since_last_interaction = self._hours_since_last_interaction(
            dispatch_1,
            dispatch_2,
        )

        # 6時間以内に相互作用していたら確率を下げる
        if hours_since_last_interaction < 6:
            interaction_probability *= 0.3

        return random.random() < interaction_probability

    def _calculate_interaction_probability(
        self,
        type_1: DispatchObjectiveType,
        type_2: DispatchObjectiveType,
    ) -> float:
        """目的タイプに基づく相互作用確率を計算"""
        # 基本確率
        base_probability = 0.3

        # 両方が交流型なら高確率
        if type_1 == DispatchObjectiveType.INTERACT and type_2 == DispatchObjectiveType.INTERACT:
            return 0.8

        # 商業型同士は競合または協力
        if type_1 == DispatchObjectiveType.TRADE and type_2 == DispatchObjectiveType.TRADE:
            return 0.6

        # 守護型と他のタイプは低確率
        if type_1 == DispatchObjectiveType.GUARD or type_2 == DispatchObjectiveType.GUARD:
            return 0.1

        # 研究型同士は知識共有の可能性
        if type_1 == DispatchObjectiveType.RESEARCH and type_2 == DispatchObjectiveType.RESEARCH:
            return 0.5

        return base_probability

    async def _process_interaction(
        self,
        dispatch_1: LogDispatch,
        dispatch_2: LogDispatch,
        db: Session,
    ) -> Optional[DispatchInteraction]:
        """
        派遣ログ間の相互作用を処理

        Args:
            dispatch_1: 派遣1
            dispatch_2: 派遣2
            db: データベースセッション

        Returns:
            相互作用の結果
        """
        try:
            # 完成ログを取得
            log_1 = db.get(CompletedLog, dispatch_1.completed_log_id)
            log_2 = db.get(CompletedLog, dispatch_2.completed_log_id)

            if not log_1 or not log_2:
                return None

            # 相互作用タイプを決定
            interaction_type = self._determine_interaction_type(
                dispatch_1,
                dispatch_2,
                log_1,
                log_2,
            )

            # AI駆動の相互作用シミュレーション
            interaction_result = await self._simulate_interaction(
                dispatch_1,
                dispatch_2,
                log_1,
                log_2,
                interaction_type,
            )

            # 相互作用の影響を適用
            impact_1 = self._apply_interaction_impact(
                dispatch_1,
                log_1,
                interaction_result,
                is_initiator=True,
            )
            impact_2 = self._apply_interaction_impact(
                dispatch_2,
                log_2,
                interaction_result,
                is_initiator=False,
            )

            # 遭遇記録を作成
            encounter_1 = self._create_encounter_record(
                dispatch_1,
                log_2.name,
                interaction_type,
                interaction_result,
                db,
            )
            encounter_2 = self._create_encounter_record(
                dispatch_2,
                log_1.name,
                interaction_type,
                interaction_result,
                db,
            )

            # 活動ログに記録
            self._add_to_travel_log(
                dispatch_1,
                encounter_1,
                interaction_result.narrative,
            )
            self._add_to_travel_log(
                dispatch_2,
                encounter_2,
                interaction_result.narrative,
            )

            # データベースを更新
            db.add(dispatch_1)
            db.add(dispatch_2)
            db.commit()

            # 相互作用記録を返す
            return DispatchInteraction(
                dispatch_id_1=dispatch_1.id,
                dispatch_id_2=dispatch_2.id,
                location=self._get_current_location(dispatch_1),
                interaction_type=interaction_type,
                outcome=interaction_result.outcome,
                narrative=interaction_result.narrative,
                impact_on_dispatch_1=impact_1,
                impact_on_dispatch_2=impact_2,
            )

        except Exception as e:
            self.logger.error(
                "Failed to process dispatch interaction",
                error=str(e),
                dispatch_1=dispatch_1.id,
                dispatch_2=dispatch_2.id,
            )
            return None

    def _determine_interaction_type(
        self,
        dispatch_1: LogDispatch,
        dispatch_2: LogDispatch,
        log_1: CompletedLog,
        log_2: CompletedLog,
    ) -> str:
        """相互作用タイプを決定"""
        # 目的の組み合わせによる基本タイプ
        if (
            dispatch_1.objective_type == DispatchObjectiveType.TRADE
            and dispatch_2.objective_type == DispatchObjectiveType.TRADE
        ):
            # 商人同士は取引または競合
            return "trade_negotiation" if random.random() > 0.3 else "trade_competition"

        if (
            dispatch_1.objective_type == DispatchObjectiveType.RESEARCH
            and dispatch_2.objective_type == DispatchObjectiveType.RESEARCH
        ):
            return "knowledge_exchange"

        if (
            dispatch_1.objective_type == DispatchObjectiveType.GUARD
            or dispatch_2.objective_type == DispatchObjectiveType.GUARD
        ):
            return "inspection"

        # 汚染度による影響
        high_contamination = (
            log_1.contamination_level > 0.7 or log_2.contamination_level > 0.7
        )
        if high_contamination:
            return random.choice(["mysterious_encounter", "conflict", "alliance"])

        # デフォルトの相互作用タイプ
        interaction_types = [
            "friendly_meeting",
            "information_exchange",
            "joint_exploration",
            "resource_sharing",
            "philosophical_debate",
        ]

        return random.choice(interaction_types)

    async def _simulate_interaction(
        self,
        dispatch_1: LogDispatch,
        dispatch_2: LogDispatch,
        log_1: CompletedLog,
        log_2: CompletedLog,
        interaction_type: str,
    ) -> InteractionOutcome:
        """AI駆動で相互作用をシミュレート"""
        # プロンプトコンテキストの構築
        context = PromptContext(
            character_name=f"{log_1.name}と{log_2.name}",
            action=f"{interaction_type}の相互作用",
            location=self._get_current_location(dispatch_1),
            recent_actions=[],
            world_state={},
            additional_context={
                "interaction_type": interaction_type,
                "character_1": {
                    "name": log_1.name,
                    "personality": log_1.personality,
                    "objective": dispatch_1.objective_type.value,
                    "contamination": log_1.contamination_level,
                },
                "character_2": {
                    "name": log_2.name,
                    "personality": log_2.personality,
                    "objective": dispatch_2.objective_type.value,
                    "contamination": log_2.contamination_level,
                },
            },
        )

        # 脚本家AIによる相互作用の物語生成
        response = await self.dramatist.process(
            context,
            narrative_style="character_interaction",
        )

        # 相互作用タイプに基づく結果の決定
        outcome = self._determine_interaction_outcome(
            interaction_type,
            log_1,
            log_2,
        )

        outcome.narrative = response.narrative or self._generate_fallback_narrative(
            interaction_type,
            log_1.name,
            log_2.name,
        )
        outcome.outcome = self._categorize_outcome(outcome)

        return outcome

    def _determine_interaction_outcome(
        self,
        interaction_type: str,
        log_1: CompletedLog,
        log_2: CompletedLog,
    ) -> InteractionOutcome:
        """相互作用の結果を決定"""
        outcome = InteractionOutcome(success=True)

        if interaction_type == "trade_negotiation":
            # 商談の成功率
            success_rate = 0.6
            if "商才" in log_1.skills or "商才" in log_2.skills:
                success_rate += 0.2

            outcome.success = random.random() < success_rate
            outcome.relationship_change = 0.3 if outcome.success else -0.1
            if outcome.success:
                outcome.items_exchanged = [
                    {"from": log_1.name, "item": "交易品A", "quantity": 5},
                    {"from": log_2.name, "item": "交易品B", "quantity": 3},
                ]

        elif interaction_type == "trade_competition":
            # 商業競争
            outcome.success = random.random() < 0.5
            outcome.relationship_change = -0.3
            outcome.conflict_resolved = False

        elif interaction_type == "knowledge_exchange":
            # 知識交換は通常成功
            outcome.success = True
            outcome.relationship_change = 0.5
            outcome.knowledge_shared = [
                "古代文字の解読法",
                "隠された遺跡の場所",
                "エネルギー結晶の性質",
            ]

        elif interaction_type == "inspection":
            # 検査
            suspicious = log_1.contamination_level > 0.5 or log_2.contamination_level > 0.5
            outcome.success = not suspicious
            outcome.relationship_change = -0.2 if suspicious else 0.1

        elif interaction_type == "mysterious_encounter":
            # 神秘的な遭遇
            outcome.success = True
            outcome.relationship_change = random.uniform(-0.5, 0.5)
            outcome.knowledge_shared = ["不可解な真実"]

        elif interaction_type == "alliance":
            # 同盟形成
            compatibility = self._calculate_compatibility(log_1, log_2)
            outcome.success = compatibility > 0.6
            outcome.relationship_change = 0.8 if outcome.success else 0.2
            outcome.alliance_formed = outcome.success

        else:
            # デフォルト（友好的な出会い等）
            outcome.success = True
            outcome.relationship_change = random.uniform(0.1, 0.5)

        return outcome

    def _calculate_compatibility(
        self,
        log_1: CompletedLog,
        log_2: CompletedLog,
    ) -> float:
        """2つのログの相性を計算"""
        compatibility = 0.5

        # 性格の類似性
        if any(trait in log_2.personality for trait in log_1.personality.split("、")):
            compatibility += 0.2

        # 汚染度の差
        contamination_diff = abs(log_1.contamination_level - log_2.contamination_level)
        compatibility -= contamination_diff * 0.3

        # スキルの共通性
        common_skills = set(log_1.skills) & set(log_2.skills)
        compatibility += len(common_skills) * 0.1

        return max(0.0, min(1.0, compatibility))

    def _categorize_outcome(self, outcome: InteractionOutcome) -> str:
        """結果をカテゴライズ"""
        if outcome.alliance_formed:
            return "alliance_formed"
        elif outcome.conflict_resolved is False:
            return "conflict"
        elif outcome.relationship_change > 0.5:
            return "strong_positive"
        elif outcome.relationship_change > 0:
            return "positive"
        elif outcome.relationship_change < -0.5:
            return "strong_negative"
        elif outcome.relationship_change < 0:
            return "negative"
        else:
            return "neutral"

    def _apply_interaction_impact(
        self,
        dispatch: LogDispatch,
        log: CompletedLog,
        outcome: InteractionOutcome,
        is_initiator: bool,
    ) -> dict[str, Any]:
        """相互作用の影響を適用"""
        impact = {
            "relationship_change": outcome.relationship_change,
            "success": outcome.success,
            "role": "initiator" if is_initiator else "responder",
        }

        # アイテム交換の処理
        if outcome.items_exchanged:
            for exchange in outcome.items_exchanged:
                if exchange["from"] == log.name:
                    # アイテムを失う
                    impact["items_lost"] = exchange
                else:
                    # アイテムを得る
                    dispatch.collected_items.append(exchange)
                    impact["items_gained"] = exchange

        # 知識共有の処理
        if outcome.knowledge_shared:
            if "knowledge_gained" not in dispatch.objective_details:
                dispatch.objective_details["knowledge_gained"] = []
            dispatch.objective_details["knowledge_gained"].extend(
                outcome.knowledge_shared
            )
            impact["knowledge_gained"] = outcome.knowledge_shared

        # 同盟形成の処理
        if outcome.alliance_formed:
            if "alliances" not in dispatch.objective_details:
                dispatch.objective_details["alliances"] = []
            dispatch.objective_details["alliances"].append({
                "with": log.name if not is_initiator else "other",
                "formed_at": datetime.utcnow().isoformat(),
            })
            impact["alliance_formed"] = True

        return impact

    def _create_encounter_record(
        self,
        dispatch: LogDispatch,
        encountered_name: str,
        interaction_type: str,
        outcome: InteractionOutcome,
        db: Session,
    ) -> DispatchEncounter:
        """遭遇記録を作成"""
        encounter = DispatchEncounter(
            dispatch_id=dispatch.id,
            encountered_npc_name=f"[派遣ログ] {encountered_name}",
            location=self._get_current_location(dispatch),
            interaction_type=interaction_type,
            interaction_summary=self._summarize_interaction(
                interaction_type,
                outcome,
            ),
            outcome=outcome.outcome,
            relationship_change=outcome.relationship_change,
            items_exchanged=outcome.items_exchanged,
            occurred_at=datetime.utcnow(),
        )

        db.add(encounter)
        return encounter

    def _summarize_interaction(
        self,
        interaction_type: str,
        outcome: InteractionOutcome,
    ) -> str:
        """相互作用を要約"""
        summaries = {
            "trade_negotiation": "商談を行った",
            "trade_competition": "商業競争が発生した",
            "knowledge_exchange": "知識を交換した",
            "inspection": "検査を受けた",
            "mysterious_encounter": "不思議な遭遇をした",
            "alliance": "同盟を結ぼうとした",
            "friendly_meeting": "友好的に出会った",
            "information_exchange": "情報を交換した",
            "joint_exploration": "共同で探索した",
            "resource_sharing": "資源を分け合った",
            "philosophical_debate": "哲学的な議論を交わした",
        }

        base_summary = summaries.get(interaction_type, "遭遇した")

        if outcome.success:
            return f"{base_summary} - 成功"
        else:
            return f"{base_summary} - 失敗"

    def _add_to_travel_log(
        self,
        dispatch: LogDispatch,
        encounter: DispatchEncounter,
        narrative: str,
    ) -> None:
        """活動ログに記録を追加"""
        log_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "location": encounter.location,
            "action": f"派遣ログとの遭遇: {encounter.encountered_npc_name}",
            "result": encounter.interaction_summary,
            "narrative": narrative,
            "encounter_id": encounter.id,
            "special_type": "dispatch_interaction",
        }

        dispatch.travel_log.append(log_entry)

    def _get_current_location(self, dispatch: LogDispatch) -> str:
        """現在地を取得"""
        if dispatch.travel_log:
            return dispatch.travel_log[-1].get("location", "不明な場所")
        return "出発地点"

    def _hours_since_last_interaction(
        self,
        dispatch_1: LogDispatch,
        dispatch_2: LogDispatch,
    ) -> float:
        """最後の相互作用からの経過時間を計算"""
        # 活動ログから相互作用を検索
        for log in reversed(dispatch_1.travel_log):
            if log.get("special_type") == "dispatch_interaction":
                if dispatch_2.id in str(log):
                    timestamp = datetime.fromisoformat(log["timestamp"])
                    return (datetime.utcnow() - timestamp).total_seconds() / 3600

        return 999  # 相互作用なし

    def _generate_fallback_narrative(
        self,
        interaction_type: str,
        name_1: str,
        name_2: str,
    ) -> str:
        """フォールバック用の物語を生成"""
        narratives = {
            "trade_negotiation": f"{name_1}と{name_2}は商談のテーブルに着いた。",
            "knowledge_exchange": f"{name_1}と{name_2}は知識を分かち合った。",
            "mysterious_encounter": f"{name_1}と{name_2}の間に奇妙な空気が流れた。",
            "alliance": f"{name_1}と{name_2}は手を取り合った。",
        }

        return narratives.get(
            interaction_type,
            f"{name_1}と{name_2}が出会った。",
        )