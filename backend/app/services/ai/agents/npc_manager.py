"""
NPC管理AI (NPC Manager) - 永続的NPC生成・管理を担当
"""

import json
import re
from datetime import UTC, datetime
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field

from app.core.exceptions import AIServiceError
from app.services.ai.agents.base import AgentResponse, BaseAgent
from app.services.ai.prompt_manager import AIAgentRole, PromptContext

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
                existing_rel.history.append(f"{datetime.utcnow()}: {context.recent_actions[-1]}")
            else:
                # 新しい関係を追加
                npc.relationships.append(
                    NPCRelationship(
                        target_id=context.character_name,
                        relationship_type="初対面",
                        intensity=0.0,
                        history=[f"{datetime.utcnow()}: 初めて出会った"],
                    )
                )

        return npc

    def _get_update_summary(self, npc: NPCCharacterSheet) -> dict[str, Any]:
        """NPC更新の要約を取得"""
        summary: dict[str, Any] = {
            "name": npc.name,
            "relationship_count": len(npc.relationships),
            "last_updated": datetime.utcnow().isoformat(),
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

    async def _handle_log_npc_encounters(self, context: PromptContext, npc_encounters: list[dict]) -> AgentResponse:
        """
        派遣ログNPCとの遭遇を処理
        Args:
            context: プロンプトコンテキスト
            npc_encounters: 遭遇したNPCリスト
        Returns:
            遭遇処理結果
        """
        # 最初の遭遇NPCを処理（将来的には複数対応）
        encounter = npc_encounters[0]

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
                speech_pattern=encounter.get("behavior_patterns", ["標準的"])[0] if encounter.get("behavior_patterns") else "標準的",
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

        # 遭遇ナラティブの生成
        narrative = f"""
突然、空気が歪み、一つの姿が現れた。
それは他の世界から派遣されたログ、「{log_npc.name}」だった。
{log_npc.title if log_npc.title else ""}
汚染度{encounter.get('contamination_level', 0)}%のその存在は、{encounter['objective_type']}の目的を持ってこの世界を訪れたようだ。
        """.strip()

        return AgentResponse(
            agent_role=self.role.value,
            narrative=narrative,
            metadata={
                "action": "log_npc_encounter",
                "encountered_npc": log_npc.model_dump(),
                "dispatch_id": encounter["dispatch_id"],
                "objective": encounter["objective_type"],
            },
            state_changes={
                "new_npc": log_npc.model_dump(),
                "encounter_type": "log_npc",
            },
            choices=[
                {"id": "talk", "text": f"{log_npc.name}と話す", "description": "派遣ログの目的について聞く"},
                {"id": "help", "text": "協力を申し出る", "description": f"{log_npc.name}の目的達成を手伝う"},
                {"id": "ignore", "text": "無視する", "description": "関わらずに立ち去る"},
            ],
        )
