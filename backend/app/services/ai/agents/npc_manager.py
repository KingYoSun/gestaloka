"""
NPC管理AI (NPC Manager) - 永続的NPC生成・管理を担当
"""

import json
import re
from datetime import UTC, datetime
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.core.exceptions import AIServiceError
from app.models import EncounterType
from app.schemas.game_session import ActionChoice
from app.services.ai.agents.base import AgentContext, AgentResponse, BaseAgent
from app.services.ai.prompt_manager import AIAgentRole, PromptContext

if TYPE_CHECKING:
    from app.models.game_message import GameMessage

logger = structlog.get_logger(__name__)


class NPCType(Enum):
    """NPCタイプの定義"""

    PERSISTENT = "persistent"  # 永続的NPC（店主、重要人物等）
    LOG_NPC = "log_npc"  # ログから生成されたNPC
    TEMPORARY = "temporary"  # 一時的NPC（通行人等）
    QUEST_GIVER = "quest_giver"  # クエスト付与NPC
    MERCHANT = "merchant"  # 商人NPC
    GUARDIAN = "guardian"  # 守護者NPC


class NPCPersonality(BaseModel):
    """NPC性格の定義"""

    traits: list[str] = Field(description="性格特性リスト")
    motivations: list[str] = Field(description="動機・目的リスト")
    fears: list[str] = Field(description="恐れ・弱点リスト")
    speech_pattern: str = Field(description="話し方の特徴")
    alignment: str = Field(description="性格傾向（善/中立/悪）")


class NPCRelationship(BaseModel):
    """NPC関係性の定義"""

    target_id: str = Field(description="関係対象のID")
    relationship_type: str = Field(description="関係タイプ（友好/敵対/中立等）")
    intensity: float = Field(ge=-1.0, le=1.0, description="関係の強度")
    history: list[str] = Field(default_factory=list, description="関係の履歴")


class NPCCharacterSheet(BaseModel):
    """NPCキャラクターシート"""

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(description="NPC名")
    title: Optional[str] = Field(default=None, description="称号・肩書き")
    npc_type: NPCType = Field(description="NPCタイプ")
    appearance: str = Field(description="外見の説明")
    personality: NPCPersonality = Field(description="性格設定")
    background: str = Field(description="背景・経歴")
    occupation: str = Field(description="職業・役割")
    location: str = Field(description="通常いる場所")
    stats: dict[str, int] = Field(description="ステータス")
    skills: list[str] = Field(description="スキルリスト")
    inventory: list[str] = Field(default_factory=list, description="所持品")
    relationships: list[NPCRelationship] = Field(default_factory=list, description="関係性リスト")
    dialogue_topics: list[str] = Field(description="会話可能なトピック")
    quest_potential: bool = Field(default=False, description="クエスト付与可能か")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: str = Field(description="生成者（AI名）")
    persistence_level: int = Field(ge=1, le=10, description="永続性レベル")


class NPCGenerationRequest(BaseModel):
    """NPC生成リクエスト"""

    requesting_agent: str = Field(description="リクエスト元のAI")
    purpose: str = Field(description="生成目的")
    npc_type: NPCType = Field(description="必要なNPCタイプ")
    context: dict[str, Any] = Field(description="文脈情報")
    requirements: dict[str, Any] = Field(default_factory=lambda: {}, description="特定要件")


class NPCManagerAgent(BaseAgent):
    """
    NPC管理AI (NPC Manager)

    世界に必要な永続的NPCを創造・管理し、
    ログNPCの生成メカニズムも担当します。
    """

    def __init__(self, **kwargs):
        """NPC管理AIの初期化"""
        super().__init__(role=AIAgentRole.NPC_MANAGER, **kwargs)

        # NPC管理用のキャッシュ
        self.npc_registry: dict[str, NPCCharacterSheet] = {}

        # NPC生成テンプレート
        self.generation_templates = self._load_generation_templates()

    def _load_generation_templates(self) -> dict[str, Any]:
        """
        NPC生成テンプレートのロード

        Returns:
            テンプレート辞書
        """
        return {
            "persistent": {
                "min_stats": {"hp": 100, "mp": 50, "level": 5},
                "required_fields": ["occupation", "location", "dialogue_topics"],
                "persistence_level_range": (7, 10),
            },
            "log_npc": {
                "min_stats": {"hp": 80, "mp": 40, "level": 1},
                "required_fields": ["original_player", "log_source"],
                "persistence_level_range": (3, 7),
            },
            "merchant": {
                "min_stats": {"hp": 120, "mp": 30, "level": 8},
                "required_fields": ["inventory", "trade_goods", "price_modifier"],
                "persistence_level_range": (8, 10),
            },
            "quest_giver": {
                "min_stats": {"hp": 150, "mp": 80, "level": 10},
                "required_fields": ["quest_chain", "reward_pool"],
                "persistence_level_range": (8, 10),
            },
        }

    async def process(self, context: PromptContext, **kwargs: Any) -> AgentResponse:
        """
        NPC生成・管理リクエストを処理

        Args:
            context: プロンプトコンテキスト
            **kwargs: 追加パラメータ（generation_request等）

        Returns:
            NPC情報を含むレスポンス
        """
        # コンテキストの検証
        if not self.validate_context(context):
            raise AIServiceError("Invalid context for NPC Manager agent")

        try:
            # 派遣ログNPCの遭遇チェック
            npc_encounters = context.additional_context.get("npc_encounters", [])
            if npc_encounters:
                return await self._handle_log_npc_encounters(context, npc_encounters)

            # 生成リクエストの取得
            generation_request = kwargs.get("generation_request")
            if not generation_request:
                # リクエストがない場合は、コンテキストから推測
                generation_request = self._infer_generation_request(context)

            # NPC生成の必要性を判断
            if self._should_generate_npc(context, generation_request):
                # 新規NPC生成
                npc = await self._generate_npc(context, generation_request)
                self.npc_registry[npc.id] = npc

                return AgentResponse(
                    agent_role=self.role.value,
                    narrative=self._create_introduction_narrative(npc),
                    metadata={
                        "action": "npc_created",
                        "npc_id": npc.id,
                        "npc_name": npc.name,
                        "npc_type": npc.npc_type.value,
                        "persistence_level": npc.persistence_level,
                    },
                    state_changes={"new_npc": npc.model_dump()},
                )
            else:
                # 既存NPCの管理・更新
                npc_id = kwargs.get("npc_id")
                if npc_id and npc_id in self.npc_registry:
                    updated_npc = await self._update_npc(self.npc_registry[npc_id], context)
                    self.npc_registry[npc_id] = updated_npc

                    return AgentResponse(
                        agent_role=self.role.value,
                        metadata={
                            "action": "npc_updated",
                            "npc_id": npc_id,
                            "updates": self._get_update_summary(updated_npc),
                        },
                    )

            # デフォルトレスポンス
            return AgentResponse(
                agent_role=self.role.value,
                metadata={"action": "no_action_needed", "reason": "No NPC generation or update required"},
            )

        except Exception as e:
            self.logger.error("NPC Manager processing failed", error=str(e), character=context.character_name)
            raise AIServiceError(f"NPC Manager agent error: {e!s}")

    def _infer_generation_request(self, context: PromptContext) -> NPCGenerationRequest:
        """
        コンテキストからNPC生成リクエストを推測

        Args:
            context: プロンプトコンテキスト

        Returns:
            推測された生成リクエスト
        """
        # 最近の行動から必要なNPCタイプを推測
        recent_text = " ".join(context.recent_actions)

        if "商店" in recent_text or "買い物" in recent_text:
            npc_type = NPCType.MERCHANT
            purpose = "商業活動のため"
        elif "クエスト" in recent_text or "依頼" in recent_text:
            npc_type = NPCType.QUEST_GIVER
            purpose = "クエスト進行のため"
        elif "守護" in recent_text or "門番" in recent_text:
            npc_type = NPCType.GUARDIAN
            purpose = "場所の守護のため"
        else:
            npc_type = NPCType.PERSISTENT
            purpose = "物語進行のため"

        return NPCGenerationRequest(
            requesting_agent="dramatist",  # デフォルトは脚本家AI
            purpose=purpose,
            npc_type=npc_type,
            context={
                "location": context.location,
                "world_state": context.world_state,
                "session_history": context.session_history[-3:] if context.session_history else [],
            },
        )

    def _should_generate_npc(self, context: PromptContext, request: NPCGenerationRequest) -> bool:
        """
        NPC生成の必要性を判断

        Args:
            context: プロンプトコンテキスト
            request: 生成リクエスト

        Returns:
            生成が必要かどうか
        """
        # 場所に既存のNPCがいるかチェック
        existing_npcs = [npc for npc in self.npc_registry.values() if npc.location == context.location]

        # タイプ別の判断
        if request.npc_type == NPCType.MERCHANT:
            # 商人がいない場合は生成
            return not any(npc.npc_type == NPCType.MERCHANT for npc in existing_npcs)
        elif request.npc_type == NPCType.QUEST_GIVER:
            # クエスト付与NPCは必要に応じて生成
            return request.purpose == "クエスト進行のため"
        else:
            # 場所にNPCが少ない場合は生成
            return len(existing_npcs) < 3

    async def _generate_npc(self, context: PromptContext, request: NPCGenerationRequest) -> NPCCharacterSheet:
        """
        新規NPCを生成

        Args:
            context: プロンプトコンテキスト
            request: 生成リクエスト

        Returns:
            生成されたNPCキャラクターシート
        """
        # コンテキストの拡張
        enhanced_context = self._enhance_context_for_generation(context, request)

        # AI生成
        raw_response = await self.generate_response(
            enhanced_context,
            temperature=0.8,  # 創造的な生成のため高めの温度
            max_tokens=1500,
        )

        # レスポンスの解析
        npc_data = self._parse_npc_response(raw_response, request.npc_type)

        # キャラクターシートの構築
        npc = NPCCharacterSheet(
            name=npc_data.get("name", self._generate_default_name(request.npc_type)),
            title=npc_data.get("title"),
            npc_type=request.npc_type,
            appearance=npc_data.get("appearance", "普通の外見"),
            personality=NPCPersonality(
                traits=npc_data.get("traits", ["普通", "親切"]),
                motivations=npc_data.get("motivations", ["生活の維持"]),
                fears=npc_data.get("fears", ["死", "貧困"]),
                speech_pattern=npc_data.get("speech_pattern", "標準的な話し方"),
                alignment=npc_data.get("alignment", "中立"),
            ),
            background=npc_data.get("background", "詳細不明"),
            occupation=npc_data.get("occupation", self._get_default_occupation(request.npc_type)),
            location=context.location,
            stats=self._generate_stats(request.npc_type, npc_data.get("level", 5)),
            skills=npc_data.get("skills", self._get_default_skills(request.npc_type)),
            inventory=npc_data.get("inventory", []),
            dialogue_topics=npc_data.get("dialogue_topics", ["挨拶", "天気", "噂話"]),
            quest_potential=request.npc_type == NPCType.QUEST_GIVER,
            created_by=self.role.value,
            persistence_level=self._calculate_persistence_level(request.npc_type),
        )

        return npc

    async def handle_encounter_story(
        self,
        context: AgentContext,
        encounter_type: EncounterType,
        encounter_entity_id: str,
        db: Session,
    ) -> dict[str, Any]:
        """
        遭遇ストーリーシステムとの統合処理

        Args:
            context: エージェントコンテキスト
            encounter_type: 遭遇タイプ
            encounter_entity_id: 遭遇エンティティID
            db: データベースセッション

        Returns:
            遭遇処理結果
        """
        from app.services.encounter_manager import EncounterManager

        encounter_manager = EncounterManager(db)

        # 現在のキャラクター情報を取得
        from app.models import Character

        character = db.get(Character, context.character_id)
        if not character:
            raise ValueError(f"Character {context.character_id} not found")

        # 遭遇を処理
        result = await encounter_manager.process_encounter(
            character=character,
            encounter_entity_id=encounter_entity_id,
            encounter_type=encounter_type,
            context=context,
        )

        # NPCの情報を更新（遭遇タイプがNPCの場合）
        if encounter_type in [EncounterType.LOG_NPC, EncounterType.PERSISTENT_NPC]:
            npc = self.get_npc_by_id(encounter_entity_id)
            if npc:
                # 関係性を更新
                existing_relationship = next((r for r in npc.relationships if r.target_id == character.id), None)

                if existing_relationship:
                    # 既存の関係性を更新
                    existing_relationship.history.append(f"Encounter on {datetime.now(UTC).isoformat()}")
                else:
                    # 新しい関係性を追加
                    npc.relationships.append(
                        NPCRelationship(
                            target_id=character.id,
                            relationship_type="encounter_initiated",
                            intensity=0.1,
                            history=[f"First encounter on {datetime.now(UTC).isoformat()}"],
                        )
                    )

        return result

    def _enhance_context_for_generation(self, context: PromptContext, request: NPCGenerationRequest) -> PromptContext:
        """
        NPC生成用にコンテキストを拡張

        Args:
            context: 元のコンテキスト
            request: 生成リクエスト

        Returns:
            拡張されたコンテキスト
        """
        context.additional_context.update(
            {
                "npc_generation_request": {
                    "type": request.npc_type.value,
                    "purpose": request.purpose,
                    "requirements": request.requirements,
                },
                "location_details": {
                    "name": context.location,
                    "atmosphere": context.world_state.get("atmosphere", "普通"),
                    "population": context.world_state.get("population_density", "中"),
                },
                "existing_npcs": [
                    {"name": npc.name, "occupation": npc.occupation}
                    for npc in self.npc_registry.values()
                    if npc.location == context.location
                ],
            }
        )

        return context

    def _parse_npc_response(self, raw_response: str, npc_type: NPCType) -> dict[str, Any]:
        """
        AIレスポンスを解析してNPCデータを抽出

        Args:
            raw_response: 生のAIレスポンス
            npc_type: NPCタイプ

        Returns:
            NPCデータ辞書
        """
        try:
            # JSONブロックを抽出
            json_match = re.search(r"```json\s*(.*?)\s*```", raw_response, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
                data: dict[str, Any] = json.loads(json_str)
                return data
        except json.JSONDecodeError:
            self.logger.warning("Failed to parse JSON response, using fallback")

        # フォールバック: テキストから情報を抽出
        npc_data: dict[str, Any] = {}

        # 名前の抽出
        name_match = re.search(r"名前[:：]\s*(.+)", raw_response)
        if name_match:
            npc_data["name"] = name_match.group(1).strip()

        # 職業の抽出
        occupation_match = re.search(r"職業[:：]\s*(.+)", raw_response)
        if occupation_match:
            npc_data["occupation"] = occupation_match.group(1).strip()

        # 性格特性の抽出
        traits_match = re.search(r"性格[:：]\s*(.+)", raw_response)
        if traits_match:
            traits_text = traits_match.group(1).strip()
            npc_data["traits"] = [t.strip() for t in traits_text.split("、")]

        # レベルの抽出
        level_match = re.search(r"レベル[:：]\s*(\d+)", raw_response)
        if level_match:
            npc_data["level"] = int(level_match.group(1))

        return npc_data

    def _generate_stats(self, npc_type: NPCType, level: int) -> dict[str, int]:
        """
        NPCのステータスを生成

        Args:
            npc_type: NPCタイプ
            level: レベル

        Returns:
            ステータス辞書
        """
        base_stats = self.generation_templates.get(npc_type.value, {}).get(
            "min_stats", {"hp": 100, "mp": 50, "level": 5}
        )

        # レベルに応じて調整
        return {
            "level": level,
            "hp": base_stats["hp"] + (level - 1) * 10,
            "max_hp": base_stats["hp"] + (level - 1) * 10,
            "mp": base_stats["mp"] + (level - 1) * 5,
            "max_mp": base_stats["mp"] + (level - 1) * 5,
            "strength": 10 + level,
            "defense": 10 + level,
            "magic": 10 + level,
            "speed": 10 + level,
        }

    def _get_default_occupation(self, npc_type: NPCType) -> str:
        """デフォルトの職業を取得"""
        occupation_map = {
            NPCType.MERCHANT: "商人",
            NPCType.QUEST_GIVER: "依頼主",
            NPCType.GUARDIAN: "守衛",
            NPCType.PERSISTENT: "町人",
            NPCType.LOG_NPC: "冒険者",
            NPCType.TEMPORARY: "通行人",
        }
        return occupation_map.get(npc_type, "一般人")

    def _get_default_skills(self, npc_type: NPCType) -> list[str]:
        """デフォルトのスキルリストを取得"""
        skill_map = {
            NPCType.MERCHANT: ["商談", "鑑定", "計算"],
            NPCType.QUEST_GIVER: ["情報収集", "交渉", "判断"],
            NPCType.GUARDIAN: ["警戒", "戦闘", "威圧"],
            NPCType.PERSISTENT: ["日常生活", "会話", "観察"],
            NPCType.LOG_NPC: ["冒険", "戦闘", "探索"],
            NPCType.TEMPORARY: ["歩行", "会話"],
        }
        return skill_map.get(npc_type, ["基本行動"])

    def _generate_default_name(self, npc_type: NPCType) -> str:
        """デフォルトの名前を生成"""
        import random

        prefixes = {
            NPCType.MERCHANT: ["商人", "店主"],
            NPCType.QUEST_GIVER: ["依頼主", "情報屋"],
            NPCType.GUARDIAN: ["守衛", "門番"],
            NPCType.PERSISTENT: ["住人", "町人"],
            NPCType.LOG_NPC: ["冒険者", "旅人"],
            NPCType.TEMPORARY: ["通行人", "見知らぬ人"],
        }

        prefix = random.choice(prefixes.get(npc_type, ["名無し"]))
        suffix = random.choice(["A", "B", "C", "D", "E"])

        return f"{prefix}{suffix}"

    def _calculate_persistence_level(self, npc_type: NPCType) -> int:
        """永続性レベルを計算"""
        min_level, max_level = self.generation_templates.get(npc_type.value, {}).get("persistence_level_range", (5, 7))

        import random

        return random.randint(min_level, max_level)

    def _create_introduction_narrative(self, npc: NPCCharacterSheet) -> str:
        """NPC登場の物語的描写を生成"""
        if npc.title:
            intro = f"{npc.title}として知られる{npc.name}が現れました。"
        else:
            intro = f"{npc.name}という{npc.occupation}が現れました。"

        intro += f"\n{npc.appearance}"

        if npc.personality.speech_pattern:
            intro += f"\n{npc.personality.speech_pattern}で話すようです。"

        return intro

    async def _update_npc(self, npc: NPCCharacterSheet, context: PromptContext) -> NPCCharacterSheet:
        """
        既存NPCを更新

        Args:
            npc: 更新対象のNPC
            context: プロンプトコンテキスト

        Returns:
            更新されたNPC
        """
        # 関係性の更新
        if context.character_name:
            # プレイヤーとの関係を更新
            existing_rel = next((rel for rel in npc.relationships if rel.target_id == context.character_name), None)

            if existing_rel:
                # 既存の関係を更新
                existing_rel.history.append(f"{datetime.now(UTC)}: {context.recent_actions[-1]}")
            else:
                # 新しい関係を追加
                npc.relationships.append(
                    NPCRelationship(
                        target_id=context.character_name,
                        relationship_type="初対面",
                        intensity=0.0,
                        history=[f"{datetime.now(UTC)}: 初めて出会った"],
                    )
                )

        return npc

    def _get_update_summary(self, npc: NPCCharacterSheet) -> dict[str, Any]:
        """NPC更新の要約を取得"""
        summary: dict[str, Any] = {
            "name": npc.name,
            "relationship_count": len(npc.relationships),
            "last_updated": datetime.now(UTC).isoformat(),
        }
        return summary

    async def generate_log_npc(self, log_data: dict[str, Any], context: PromptContext) -> NPCCharacterSheet:
        """
        ログデータからNPCを生成

        Args:
            log_data: ログデータ
            context: プロンプトコンテキスト

        Returns:
            生成されたログNPC
        """
        # ログNPC生成リクエストの作成
        request = NPCGenerationRequest(
            requesting_agent="historian",
            purpose="ログのNPC化",
            npc_type=NPCType.LOG_NPC,
            context={"log_data": log_data, "original_world": log_data.get("world_id")},
            requirements={"preserve_personality": True, "adapt_to_world": True},
        )

        # 通常のNPC生成プロセスを使用
        npc = await self._generate_npc(context, request)

        # ログNPC特有の属性を追加
        npc.background = f"元は{log_data.get('original_player', '不明')}という冒険者だった。"
        npc.personality.motivations.append("元の世界への郷愁")

        return npc

    def get_npcs_by_location(self, location: str) -> list[NPCCharacterSheet]:
        """
        特定の場所にいるNPCを取得

        Args:
            location: 場所名

        Returns:
            NPCリスト
        """
        return [npc for npc in self.npc_registry.values() if npc.location == location]

    def get_npc_by_id(self, npc_id: str) -> Optional[NPCCharacterSheet]:
        """
        IDでNPCを取得

        Args:
            npc_id: NPC ID

        Returns:
            NPCまたはNone
        """
        return self.npc_registry.get(npc_id)

    def remove_temporary_npcs(self, threshold_hours: int = 24) -> int:
        """
        一時的なNPCを削除

        Args:
            threshold_hours: 削除閾値（時間）

        Returns:
            削除されたNPC数
        """
        current_time = datetime.now(UTC)
        removed_count = 0

        npcs_to_remove = []
        for npc_id, npc in self.npc_registry.items():
            if npc.npc_type == NPCType.TEMPORARY:
                time_diff = (current_time - npc.created_at).total_seconds() / 3600
                if time_diff > threshold_hours:
                    npcs_to_remove.append(npc_id)

        for npc_id in npcs_to_remove:
            del self.npc_registry[npc_id]
            removed_count += 1

        return removed_count

    async def _handle_log_npc_encounters(
        self, context: PromptContext, npc_encounters: list[dict], db: Optional[Session] = None
    ) -> AgentResponse:
        """
        派遣ログNPCとの遭遇を処理
        Args:
            context: プロンプトコンテキスト
            npc_encounters: 遭遇したNPCリスト
            db: データベースセッション（ストーリー管理用）
        Returns:
            遭遇処理結果
        """
        encountered_npcs = []
        narratives = []
        story_results = []

        # 各遭遇NPCを処理（最大3体まで）
        for i, encounter in enumerate(npc_encounters[:3]):
            # NPCデータから一時的なNPCCharacterSheetを作成
            log_npc = NPCCharacterSheet(
                id=encounter["log_id"],
                name=encounter["log_name"],
                title=encounter.get("log_title"),
                npc_type=NPCType.LOG_NPC,
                appearance="派遣ログから実体化した存在",
                personality=NPCPersonality(
                    traits=encounter.get("personality_traits", []),
                    motivations=[f"{encounter['objective_type']}を遂行する"],
                    fears=["目的の失敗", "汚染の進行"],
                    speech_pattern=encounter.get("behavior_patterns", ["標準的"])[0]
                    if encounter.get("behavior_patterns")
                    else "標準的",
                    alignment="中立",
                ),
                background="他のプレイヤーから派遣されたログ",
                occupation=f"派遣ログ（{encounter['objective_type']}）",
                location=context.location,
                stats={"汚染度": encounter.get("contamination_level", 0)},
                skills=[],
                dialogue_topics=[
                    "派遣の目的",
                    "元の世界の話",
                    encounter["objective_type"],
                ],
                quest_potential=encounter["objective_type"] in ["interact", "collect"],
                created_by="log_dispatch_system",
                persistence_level=5,
            )

            # レジストリに一時的に追加
            self.npc_registry[log_npc.id] = log_npc
            encountered_npcs.append(log_npc)

            # ストーリーシステムとの統合（DBセッションがある場合）
            if db and hasattr(context, "character_id"):
                agent_context = AgentContext(
                    session_id=context.session_id if hasattr(context, "session_id") else None,
                    character_id=context.character_id if hasattr(context, "character_id") else None,
                    character_name=context.character_name if hasattr(context, "character_name") else None,
                    location=context.location,
                    world_state=context.world_state,
                    recent_actions=context.recent_actions,
                )

                story_result = await self.handle_encounter_story(
                    context=agent_context,
                    encounter_type=EncounterType.LOG_NPC,
                    encounter_entity_id=log_npc.id,
                    db=db,
                )
                story_results.append(story_result)

            # 個別のナラティブを生成
            if i == 0:
                narratives.append("突然、空気が歪み、一つの姿が現れた。")
            else:
                narratives.append("さらに、別の歪みから新たな姿が現れた。")

            narratives.append(
                f"それは他の世界から派遣されたログ、「{log_npc.name}」だった。"
                f"{log_npc.title if log_npc.title else ''}"
                f"汚染度{encounter.get('contamination_level', 0)}%のその存在は、"
                f"{encounter['objective_type']}の目的を持ってこの世界を訪れたようだ。"
            )

        # 複数NPCの場合の追加ナラティブ
        if len(encountered_npcs) > 1:
            narratives.append(f"\n{len(encountered_npcs)}体の派遣ログが、互いの存在に気づいたようだ。")

        # ストーリー情報を含むナラティブ
        if story_results:
            for result in story_results:
                if result.get("quest_generated"):
                    narratives.append("\n何か重要な出来事が始まろうとしている...")

        # 全体のナラティブを結合
        narrative = "\n".join(narratives)

        # 選択肢の生成（複数NPCの場合は各NPCへの対応を選択）
        choices = []
        if len(encountered_npcs) == 1:
            npc = encountered_npcs[0]
            choices = [
                ActionChoice(id="talk", text=f"{npc.name}と話す"),
                ActionChoice(id="help", text="協力を申し出る"),
                ActionChoice(id="ignore", text="無視する"),
            ]
        else:
            # 複数NPCの場合
            choices.append(ActionChoice(id="talk_all", text="全員と話す"))
            for i, npc in enumerate(encountered_npcs):
                choices.append(ActionChoice(id=f"talk_{i}", text=f"{npc.name}と話す"))
            choices.append(ActionChoice(id="help_all", text="全員に協力を申し出る"))
            choices.append(ActionChoice(id="ignore", text="全員を無視する"))

        # メタデータの準備
        metadata = {
            "action": "log_npc_encounter",
            "encounter_count": len(encountered_npcs),
            "encountered_npcs": [npc.model_dump() for npc in encountered_npcs],
            "dispatch_ids": [enc["dispatch_id"] for enc in npc_encounters[:3]],
            "objectives": [enc["objective_type"] for enc in npc_encounters[:3]],
            "story_initiated": len(story_results) > 0,
            "story_results": story_results,
        }

        # 状態変化の準備
        state_changes = {
            "new_npcs": [npc.model_dump() for npc in encountered_npcs],
            "encounter_type": "log_npc_multiple" if len(encountered_npcs) > 1 else "log_npc",
        }

        return AgentResponse(
            agent_role=self.role.value,
            narrative=narrative,
            metadata=metadata,
            state_changes=state_changes,
            choices=choices,
        )

    async def update_npc_relationships(self, context: PromptContext, messages: list["GameMessage"]) -> dict:
        """
        セッションからNPC関係性の更新情報を生成

        Args:
            context: プロンプトコンテキスト
            messages: セッションのメッセージ履歴

        Returns:
            dict: Neo4jに反映する更新情報
        """

        updates: dict[str, Any] = {
            "relationships": [],
            "npcs_met": [],
            "locations_visited": [],
        }

        # メッセージからNPCとの交流を抽出
        for msg in messages:
            if msg.message_type == "GM_NARRATIVE":
                # NPCの名前パターンを探す（簡易的な実装）
                if "「" in msg.content and "」" in msg.content:
                    # 会話があった場合
                    npc_name = msg.content.split("「")[0].strip()
                    if npc_name and len(npc_name) < 20:  # 妥当な長さのNPC名
                        updates["npcs_met"].append(
                            {
                                "name": npc_name,
                                "location": context.location,
                                "interaction_type": "dialogue",
                            }
                        )

                # 関係性の変化を検出
                relationship_keywords = {
                    "友好的": "friendly",
                    "敵対的": "hostile",
                    "中立的": "neutral",
                    "親密": "intimate",
                    "警戒": "wary",
                }

                for keyword, relation_type in relationship_keywords.items():
                    if keyword in msg.content:
                        updates["relationships"].append(
                            {
                                "type": relation_type,
                                "context": msg.content[:100],
                            }
                        )

        # 重複を削除
        unique_npcs = []
        seen_names = set()
        for npc in updates["npcs_met"]:
            if npc["name"] not in seen_names:
                unique_npcs.append(npc)
                seen_names.add(npc["name"])
        updates["npcs_met"] = unique_npcs

        return updates
