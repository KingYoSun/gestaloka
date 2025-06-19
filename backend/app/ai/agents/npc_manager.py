"""
NPC Manager AI エージェント

ログNPCと永続NPCの管理を担当するAIエージェント
"""

import json
from typing import Any

import structlog
from langchain.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import settings
from app.schemas.npc_schemas import NPCProfile

logger = structlog.get_logger(__name__)


class NPCManagerAgent:
    """NPC管理AIエージェント"""

    def __init__(self):
        self.llm = ChatGoogleGenerativeAI(
            model=settings.GEMINI_MODEL,
            google_api_key=settings.GEMINI_API_KEY,
            temperature=0.7,
        )

        # NPCキャラクターシート生成プロンプト
        self.character_sheet_prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    """あなたはゲスタロカのNPC Manager AIです。
            ログから生成されたNPCや永続的なNPCのキャラクターシートを作成し、管理します。

            与えられた情報を基に、NPCの詳細なキャラクターシートを生成してください。
            NPCは元のプレイヤーの行動や性格を反映しつつ、独自の発展を遂げた存在として設定してください。

            生成するキャラクターシートには以下を含めてください：
            1. 詳細な外見描写
            2. 拡張された背景ストーリー
            3. 現在の目的や動機
            4. 特徴的な口調や話し方
            5. 記憶している重要な出来事

            JSON形式で出力してください。
            """,
                ),
                (
                    "human",
                    """以下のNPCプロファイルからキャラクターシートを生成してください：

            基本情報:
            - 名前: {name}
            - 称号: {title}
            - タイプ: {npc_type}
            - 汚染度: {contamination_level}

            性格特性: {personality_traits}
            行動パターン: {behavior_patterns}
            スキル: {skills}

            現在の外見: {appearance}
            背景: {backstory}
            """,
                ),
            ]
        )

        # NPC行動生成プロンプト
        self.behavior_prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    """あなたはゲスタロカのNPC Manager AIです。
            NPCの行動と反応を生成します。

            NPCの性格、行動パターン、現在の状況を考慮して、
            自然で一貫性のある行動を生成してください。

            汚染度が高いNPCほど、予測不能で異常な行動を取る可能性があります。
            """,
                ),
                (
                    "human",
                    """NPCの行動を生成してください：

            NPC情報:
            - 名前: {name}
            - 性格: {personality_traits}
            - 行動パターン: {behavior_patterns}
            - 汚染度: {contamination_level}
            - 現在の場所: {current_location}

            状況: {situation}

            このNPCがどのように行動するか、具体的に描写してください。
            """,
                ),
            ]
        )

    async def register_npc(self, npc_profile: NPCProfile) -> dict[str, Any]:
        """
        NPCをシステムに登録し、詳細なキャラクターシートを生成

        Args:
            npc_profile: NPCの基本プロファイル

        Returns:
            生成されたキャラクターシート
        """
        try:
            # キャラクターシートを生成
            response = await self.llm.ainvoke(
                self.character_sheet_prompt.format_messages(
                    name=npc_profile.name,
                    title=npc_profile.title or "称号なし",
                    npc_type=npc_profile.npc_type,
                    contamination_level=npc_profile.contamination_level,
                    personality_traits=", ".join(npc_profile.personality_traits),
                    behavior_patterns=", ".join(npc_profile.behavior_patterns),
                    skills=", ".join(npc_profile.skills),
                    appearance=npc_profile.appearance or "不明",
                    backstory=npc_profile.backstory or "不明",
                )
            )

            # レスポンスをパース
            character_sheet = self._parse_json_response(response.content)

            logger.info("NPC registered", npc_id=npc_profile.npc_id, npc_name=npc_profile.name)

            return character_sheet

        except Exception as e:
            logger.error("Failed to register NPC", npc_id=npc_profile.npc_id, error=str(e))
            # フォールバック
            return {
                "appearance": npc_profile.appearance or "謎めいた人物",
                "backstory": npc_profile.backstory or "過去は謎に包まれている",
                "current_goal": "自分の存在意義を探している",
                "speech_pattern": "普通の話し方",
                "important_memories": [],
            }

    async def generate_npc_behavior(self, npc_profile: NPCProfile, situation: str) -> str:
        """
        特定の状況でのNPCの行動を生成

        Args:
            npc_profile: NPCプロファイル
            situation: 現在の状況説明

        Returns:
            NPCの行動描写
        """
        try:
            response = await self.llm.ainvoke(
                self.behavior_prompt.format_messages(
                    name=npc_profile.name,
                    personality_traits=", ".join(npc_profile.personality_traits),
                    behavior_patterns=", ".join(npc_profile.behavior_patterns),
                    contamination_level=npc_profile.contamination_level,
                    current_location=npc_profile.current_location or "不明",
                    situation=situation,
                )
            )

            return str(response.content)

        except Exception as e:
            logger.error("Failed to generate NPC behavior", npc_id=npc_profile.npc_id, error=str(e))
            return f"{npc_profile.name}は静かに佇んでいる。"

    def _parse_json_response(self, response: str) -> dict[str, Any]:
        """LLMレスポンスからJSONを抽出してパース"""
        try:
            # コードブロックがある場合は除去
            if "```json" in response:
                start = response.find("```json") + 7
                end = response.find("```", start)
                response = response[start:end].strip()
            elif "```" in response:
                start = response.find("```") + 3
                end = response.find("```", start)
                response = response[start:end].strip()

            return json.loads(response)  # type: ignore[no-any-return]
        except json.JSONDecodeError:
            logger.warning("Failed to parse JSON response", response=response)
            return {}
