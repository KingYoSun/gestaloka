"""
歴史家AI (Historian) - GM AI評議会メンバー

世界の出来事を記録・整理し、一貫性のある歴史として編纂する。
プレイヤーの行動履歴を管理し、将来的なログNPC化の基盤を提供する。
"""

from datetime import UTC, datetime
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.services.ai.agents.base import AgentResponse, BaseAgent
from app.services.ai.constants import LOW_CREATIVITY_TEMPERATURE
from app.services.ai.gemini_client import GeminiClient
from app.services.ai.prompt_manager import AIAgentRole, PromptContext, PromptManager
from app.services.ai.utils import agent_error_handler

if TYPE_CHECKING:
    from app.models.game_message import GameMessage

logger = get_logger(__name__)


class ActionType(Enum):
    """行動タイプの定義"""

    PLAYER_ACTION = "player_action"
    NPC_INTERACTION = "npc_interaction"
    WORLD_EVENT = "world_event"
    COMBAT = "combat"
    DIALOGUE = "dialogue"
    EXPLORATION = "exploration"
    CREATION = "creation"


class HistoricalRecord(BaseModel):
    """歴史的記録"""

    id: str = Field(default_factory=lambda: str(uuid4()))
    session_id: str
    actor_id: str
    action_type: ActionType
    action_details: dict[str, Any]
    location: dict[str, Any]
    participants: list[str]
    timestamp: datetime
    importance_level: int = Field(ge=1, le=10)
    tags: list[str]
    consequences: list[str]
    related_records: list[str] = Field(default_factory=list)
    log_fragment_potential: float = Field(ge=0.0, le=1.0)


class HistorianAnalysis(BaseModel):
    """歴史家AIの分析結果"""

    importance_level: int = Field(ge=1, le=10, description="重要度レベル")
    categorization: list[str] = Field(description="カテゴリ分類")
    log_fragment_potential: float = Field(ge=0.0, le=1.0, description="ログの欠片としての可能性")
    summary: str = Field(description="行動の要約")
    consequences: list[str] = Field(description="予測される結果")
    consistency_warnings: list[str] = Field(default_factory=list, description="一貫性に関する警告")


class HistorianAgent(BaseAgent):
    """歴史家AI - 世界の記録と歴史編纂"""

    def __init__(
        self,
        gemini_client: Optional[GeminiClient] = None,
        prompt_manager: Optional[PromptManager] = None,
    ):
        super().__init__(
            role=AIAgentRole.HISTORIAN,
            gemini_client=gemini_client,
            prompt_manager=prompt_manager,
        )
        self.records_cache: dict[str, HistoricalRecord] = {}

    @agent_error_handler("Historian")
    async def process(self, context: PromptContext, **kwargs: Any) -> AgentResponse:
        """
        歴史的コンテキストを処理してレスポンスを生成

        Args:
            context: プロンプトコンテキスト
            **kwargs: 追加パラメータ（action_type, action_details等）

        Returns:
            AgentResponse: 歴史家AIの応答
        """
        if not self.validate_context(context):
            return AgentResponse(agent_role=self.role.value, metadata={"error": "Invalid context"})

        # 行動の分析を実行
        action_type = kwargs.get("action_type", ActionType.PLAYER_ACTION)
        action_details = kwargs.get("action_details", {})

        analysis = await self._analyze_action(context=context, action_type=action_type, action_details=action_details)

        # 記録を作成・保存
        record = self._create_record(
            context=context, action_type=action_type, action_details=action_details, analysis=analysis
        )

        self.records_cache[record.id] = record

        # レスポンスを構築
        return AgentResponse(
            agent_role=self.role.value,
            narrative=self._generate_historical_narrative(record, analysis),
            metadata={
                "record_id": record.id,
                "importance_level": analysis.importance_level,
                "categorization": analysis.categorization,
                "log_fragment_potential": analysis.log_fragment_potential,
                "consistency_warnings": analysis.consistency_warnings,
            },
        )

    async def _analyze_action(
        self, context: PromptContext, action_type: ActionType, action_details: dict[str, Any]
    ) -> HistorianAnalysis:
        """
        行動を分析して歴史的重要性を評価

        Args:
            context: プロンプトコンテキスト
            action_type: 行動タイプ
            action_details: 行動の詳細

        Returns:
            HistorianAnalysis: 分析結果
        """
        # 分析用のプロンプトを構築
        analysis_prompt = self._build_analysis_prompt(context, action_type, action_details)

        try:
            # Gemini APIで分析を実行
            response = await self.generate_response(
                context=context,
                system_message=analysis_prompt,
                temperature=LOW_CREATIVITY_TEMPERATURE,  # 分析には低温度を使用
                max_output_tokens=500,
            )

            # レスポンスを解析して分析結果を構築
            return self._parse_analysis_response(response)

        except Exception as e:
            self.logger.error("Action analysis failed", error=str(e), action_type=action_type.value)
            # エラー時のフォールバック
            return HistorianAnalysis(
                importance_level=3,
                categorization=[action_type.value],
                log_fragment_potential=0.3,
                summary="分析に失敗しました",
                consequences=[],
                consistency_warnings=[f"分析エラー: {e!s}"],
            )

    def _build_analysis_prompt(
        self, context: PromptContext, action_type: ActionType, action_details: dict[str, Any]
    ) -> str:
        """行動分析用のプロンプトを構築"""
        return f"""あなたはゲスタロカ世界の歴史家AIです。
以下の行動を分析し、歴史的重要性を評価してください。

【評価基準】
- 重要度（1-10）: 世界への影響度、他者への影響、物語上の重要性
- カテゴリ: 行動の種類（combat, dialogue, exploration, creation等）
- ログの欠片価値（0.0-1.0）: 他プレイヤーの世界でNPCとして再現する価値
- 結果予測: この行動がもたらす可能性のある結果
- 一貫性チェック: 時系列や場所の矛盾がないか

【行動情報】
- タイプ: {action_type.value}
- キャラクター: {context.character_name}
- 場所: {context.location}
- 詳細: {action_details}
- 直前の行動: {context.recent_actions[-1] if context.recent_actions else 'なし'}

【分析フォーマット】
IMPORTANCE: [1-10の数値]
CATEGORIES: [カテゴリのリスト]
LOG_POTENTIAL: [0.0-1.0の数値]
SUMMARY: [1行の要約]
CONSEQUENCES: [予測される結果のリスト]
WARNINGS: [一貫性の問題があれば記載]"""

    def _parse_analysis_response(self, response: str) -> HistorianAnalysis:
        """分析レスポンスをパース"""
        lines = response.strip().split("\n")
        analysis_data: dict[str, Any] = {
            "importance_level": 5,
            "categorization": [],
            "log_fragment_potential": 0.5,
            "summary": "",
            "consequences": [],
            "consistency_warnings": [],
        }

        for line in lines:
            if line.startswith("IMPORTANCE:"):
                try:
                    analysis_data["importance_level"] = int(line.split(":", 1)[1].strip())
                except ValueError:
                    pass
            elif line.startswith("CATEGORIES:"):
                categories = line.split(":", 1)[1].strip()
                analysis_data["categorization"] = [c.strip() for c in categories.split(",")]
            elif line.startswith("LOG_POTENTIAL:"):
                try:
                    analysis_data["log_fragment_potential"] = float(line.split(":", 1)[1].strip())
                except ValueError:
                    pass
            elif line.startswith("SUMMARY:"):
                analysis_data["summary"] = line.split(":", 1)[1].strip()
            elif line.startswith("CONSEQUENCES:"):
                consequences = line.split(":", 1)[1].strip()
                analysis_data["consequences"] = [c.strip() for c in consequences.split(",") if c.strip()]
            elif line.startswith("WARNINGS:"):
                warnings = line.split(":", 1)[1].strip()
                if warnings and warnings.lower() != "なし":
                    analysis_data["consistency_warnings"] = [w.strip() for w in warnings.split(",")]

        return HistorianAnalysis(**analysis_data)

    def _create_record(
        self,
        context: PromptContext,
        action_type: ActionType,
        action_details: dict[str, Any],
        analysis: HistorianAnalysis,
    ) -> HistoricalRecord:
        """歴史的記録を作成"""
        return HistoricalRecord(
            session_id=context.session_id or "unknown",
            actor_id=context.character_id or context.character_name,
            action_type=action_type,
            action_details=action_details,
            location={"name": context.location},
            participants=self._extract_participants(context, action_details),
            timestamp=datetime.now(UTC),
            importance_level=analysis.importance_level,
            tags=analysis.categorization,
            consequences=analysis.consequences,
            log_fragment_potential=analysis.log_fragment_potential,
        )

    def _extract_participants(self, context: PromptContext, action_details: dict[str, Any]) -> list[str]:
        """行動の参加者を抽出"""
        participants = [context.character_name]

        # action_detailsから参加者を抽出（実装は詳細による）
        if "target" in action_details:
            participants.append(action_details["target"])
        if "participants" in action_details:
            participants.extend(action_details["participants"])

        return list(set(participants))  # 重複を除去

    def _generate_historical_narrative(self, record: HistoricalRecord, analysis: HistorianAnalysis) -> str:
        """歴史的な物語を生成"""
        if record.importance_level >= 8:
            prefix = "【重要な出来事】"
        elif record.importance_level >= 5:
            prefix = "【注目すべき行動】"
        else:
            prefix = "【記録】"

        return f"{prefix} {analysis.summary}"

    def get_character_history(self, character_id: str, limit: int = 10, offset: int = 0) -> list[HistoricalRecord]:
        """
        特定キャラクターの行動履歴を取得

        Args:
            character_id: キャラクターID
            limit: 取得件数
            offset: オフセット

        Returns:
            List[HistoricalRecord]: 行動履歴リスト
        """
        records = [record for record in self.records_cache.values() if record.actor_id == character_id]

        # タイムスタンプでソート
        records.sort(key=lambda r: r.timestamp, reverse=True)

        return records[offset : offset + limit]

    def get_log_fragment_candidates(self, session_id: str, threshold: float = 0.7) -> list[HistoricalRecord]:
        """
        ログの欠片として適した記録を取得

        Args:
            session_id: セッションID
            threshold: 閾値（0.0-1.0）

        Returns:
            List[HistoricalRecord]: ログの欠片候補リスト
        """
        candidates = [
            record
            for record in self.records_cache.values()
            if record.session_id == session_id and record.log_fragment_potential >= threshold
        ]

        # 重要度でソート
        candidates.sort(key=lambda r: r.importance_level, reverse=True)

        return candidates

    def check_consistency(self, new_action: dict[str, Any], context: PromptContext) -> list[str]:
        """
        新しい行動の一貫性をチェック

        Args:
            new_action: 新しい行動
            context: コンテキスト

        Returns:
            List[str]: 一貫性の警告リスト
        """
        warnings = []

        # 時系列の一貫性チェック
        if context.recent_actions:
            # last_action = context.recent_actions[-1]
            # 簡易的なチェック（実際にはより詳細な実装が必要）
            if "rapid_location_change" in new_action:
                warnings.append("場所の一貫性: 瞬間移動のような移動が検出されました")

        return warnings

    async def generate_session_summary(self, context: PromptContext, messages: list["GameMessage"]) -> str:
        """
        セッションのサマリーを生成

        Args:
            context: プロンプトコンテキスト
            messages: セッションのメッセージ履歴

        Returns:
            str: セッションサマリー
        """

        # メッセージを物語形式に整形
        narrative_parts = []
        for msg in messages:
            if msg.message_type == "PLAYER_ACTION":
                narrative_parts.append(f"【行動】{msg.content}")
            elif msg.message_type == "GM_NARRATIVE":
                narrative_parts.append(f"【展開】{msg.content}")

        narrative = "\n".join(narrative_parts[-30:])  # 最新30件

        prompt = f"""あなたはゲスタロカ世界の歴史家AIです。
以下のセッションの出来事を要約し、歴史的な記録として残してください。

【キャラクター情報】
- 名前: {context.character_name}
- 場所: {context.location}

【セッションの記録】
{narrative}

【要約の指針】
- 物語の主要な流れを200文字程度で要約
- キャラクターの成長や変化に注目
- 重要な出来事や転換点を強調
- 客観的かつ詩的な文体で記述"""

        response = await self.generate_response(
            context=context,
            system_message=prompt,
            temperature=0.7,
            max_output_tokens=300,
        )

        return response.strip()

    async def extract_key_events(self, context: PromptContext, messages: list["GameMessage"]) -> list[str]:
        """
        セッションから重要イベントを抽出

        Args:
            context: プロンプトコンテキスト
            messages: セッションのメッセージ履歴

        Returns:
            list[str]: 重要イベントのリスト
        """

        # メッセージから重要な出来事を特定
        events = []

        for i, msg in enumerate(messages):
            if msg.message_type == "GM_NARRATIVE":
                # 戦闘、発見、重要な選択などのキーワードを含むメッセージを抽出
                keywords = ["戦闘", "発見", "決断", "出会い", "勝利", "敗北", "獲得", "完了"]
                if any(keyword in msg.content for keyword in keywords):
                    # 前後のコンテキストを含めて簡潔にまとめる
                    event_context = []
                    if i > 0 and messages[i - 1].message_type == "PLAYER_ACTION":
                        event_context.append(messages[i - 1].content)
                    event_context.append(msg.content)

                    # 50文字以内に要約
                    event_summary = "".join(event_context)[:50] + "..."
                    events.append(event_summary)

        # 最大5つまでの重要イベントを返す
        return events[:5]
