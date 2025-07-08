"""
脚本家AI (Dramatist) - 物語進行とテキスト生成を担当
"""

import json
import re
from typing import Any, Optional

import structlog

from app.core.exceptions import AIServiceError
from app.schemas.game_session import ActionChoice, SessionEndingProposal
from app.services.ai.agents.base import AgentResponse, BaseAgent
from app.services.ai.prompt_manager import AIAgentRole, PromptContext

logger = structlog.get_logger(__name__)


class DramatistAgent(BaseAgent):
    """
    脚本家AI (Dramatist)

    プレイヤーの行動に対して物語的な描写を生成し、
    次の行動の選択肢を提示します。
    """

    def __init__(self, **kwargs):
        """脚本家AIの初期化"""
        super().__init__(role=AIAgentRole.DRAMATIST, **kwargs)

    async def process(self, context: PromptContext, **kwargs: Any) -> AgentResponse:
        """
        物語的な描写と行動選択肢を生成

        Args:
            context: プロンプトコンテキスト
            **kwargs: 追加パラメータ

        Returns:
            物語描写と選択肢を含むレスポンス
        """
        # コンテキストの検証
        if not self.validate_context(context):
            raise AIServiceError("Invalid context for Dramatist agent")

        try:
            # カスタムプロンプトの追加
            enhanced_context = self._enhance_context(context)

            # レスポンス生成
            raw_response = await self.generate_response(
                enhanced_context, temperature=kwargs.get("temperature", 0.8), max_tokens=kwargs.get("max_tokens", 1500)
            )

            # レスポンスの解析
            narrative, choices = self._parse_response(raw_response)

            # メタデータの抽出
            metadata = self.extract_metadata(context)
            metadata["response_length"] = len(narrative) if narrative else 0
            metadata["choice_count"] = len(choices)

            return AgentResponse(
                agent_role=self.role.value,
                narrative=narrative or "物語は続きます...",
                choices=choices,
                metadata=metadata,
            )

        except Exception as e:
            self.logger.error("Dramatist processing failed", error=str(e), character=context.character_name)
            raise AIServiceError(f"Dramatist agent error: {e!s}")

    def _enhance_context(self, context: PromptContext) -> PromptContext:
        """
        脚本家AI用にコンテキストを拡張

        Args:
            context: 元のコンテキスト

        Returns:
            拡張されたコンテキスト
        """
        # 世界の状態から物語的要素を抽出
        narrative_elements = {
            "time_of_day": context.world_state.get("time_of_day", "昼"),
            "weather": context.world_state.get("weather", "晴れ"),
            "atmosphere": context.world_state.get("atmosphere", "平穏"),
            "recent_events": context.world_state.get("recent_events", []),
        }

        # 追加コンテキストに物語要素を追加
        context.additional_context.update(
            {
                "narrative_elements": json.dumps(narrative_elements, ensure_ascii=False),
                "character_mood": self._infer_character_mood(context),
                "story_tension": self._calculate_story_tension(context),
            }
        )

        # NPC遭遇情報があれば追加
        npc_encounters = context.additional_context.get("npc_encounters", [])
        if npc_encounters:
            encounter_info = []
            for encounter in npc_encounters:
                encounter_info.append(
                    {
                        "name": encounter.get("log_name"),
                        "title": encounter.get("log_title"),
                        "objective": encounter.get("objective_type"),
                        "personality": encounter.get("personality_traits", []),
                        "contamination": encounter.get("contamination_level", 0),
                    }
                )
            context.additional_context["active_npc_encounters"] = encounter_info

        return context

    def _infer_character_mood(self, context: PromptContext) -> str:
        """
        キャラクターの気分を推測

        Args:
            context: プロンプトコンテキスト

        Returns:
            推測された気分
        """
        # HP/MPから基本的な状態を推測
        hp_ratio = context.character_stats.get("hp", 100) / context.character_stats.get("max_hp", 100)
        mp_ratio = context.character_stats.get("mp", 100) / context.character_stats.get("max_mp", 100)

        if hp_ratio < 0.3:
            return "危機的"
        elif hp_ratio < 0.5:
            return "疲弊"
        elif mp_ratio < 0.3:
            return "消耗"
        elif hp_ratio > 0.8 and mp_ratio > 0.8:
            return "快調"
        else:
            return "普通"

    def _calculate_story_tension(self, context: PromptContext) -> str:
        """
        物語の緊張度を計算

        Args:
            context: プロンプトコンテキスト

        Returns:
            緊張度レベル
        """
        # 最近の行動から緊張度を推測
        tension_keywords = ["戦闘", "逃走", "危険", "敵", "攻撃", "防御"]
        recent_text = " ".join(context.recent_actions)

        tension_count = sum(1 for keyword in tension_keywords if keyword in recent_text)

        if tension_count >= 3:
            return "高"
        elif tension_count >= 1:
            return "中"
        else:
            return "低"

    def _parse_response(self, raw_response: str) -> tuple[str, list[ActionChoice]]:
        """
        AIレスポンスを解析して物語と選択肢を抽出

        Args:
            raw_response: 生のAIレスポンス

        Returns:
            (物語描写, 選択肢リスト)のタプル
        """
        # デバッグ用ログ
        self.logger.debug("Parsing AI response", response_preview=raw_response[:200])

        # レスポンスを行で分割
        lines = raw_response.strip().split("\n")

        # 物語部分と選択肢部分を分離
        narrative_lines = []
        choices: list[ActionChoice] = []
        in_choices_section = False

        for line in lines:
            # 選択肢セクションの開始を検出（より広いパターンマッチング）
            if re.match(r"^(選択肢|行動選択|次の行動|##\s*選択肢|###\s*次の行動|【選択肢】|\*\*【選択肢】\*\*)", line):
                in_choices_section = True
                self.logger.debug("Found choices section marker", line=line)
                continue

            if in_choices_section:
                # 空行や区切り線は無視
                if not line.strip() or line.strip().startswith("---"):
                    continue

                # 選択肢のパターン: "1. " or "- " or "* " or "A) "など
                # AIが**太字**で返すことがあるので、それも考慮
                choice_match = re.match(r"^(?:[1-9]\.|[-•*]|[A-Z]\))\s*\*?\*?(.+)", line.strip())
                if choice_match:
                    choice_text = choice_match.group(1).strip()
                    # **太字**記号を除去（末尾の**も含む）
                    choice_text = re.sub(r"\*\*(.+?)\*\*", r"\1", choice_text)
                    choice_text = re.sub(r"\*\*$", "", choice_text).strip()

                    # 【タグ】形式のプレフィックスを除去
                    choice_text = re.sub(r"^【[^】]+】\s*", "", choice_text).strip()

                    # 選択肢本文と難易度情報を分離
                    # 難易度は行の最後に [難易度: xxx] の形式で来ることがある
                    full_line = line.strip()
                    difficulty_match = re.search(r"\[難易度:\s*(簡単|普通|困難|通常|easy|medium|hard)\]", full_line)
                    difficulty = None
                    if difficulty_match:
                        difficulty_map = {
                            "簡単": "easy",
                            "easy": "easy",
                            "普通": "medium",
                            "medium": "medium",
                            "通常": "medium",
                            "困難": "hard",
                            "hard": "hard",
                        }
                        difficulty = difficulty_map.get(difficulty_match.group(1), None)
                        # 難易度情報を除去
                        choice_text = re.sub(r"\s*\[難易度:.*?\]", "", choice_text).strip()

                    # 追加情報セクションのパターンをチェック（例：視覚:、聴覚:、感覚:など）
                    # これらは選択肢ではなく情報なので除外
                    if re.match(r"^(視覚|聴覚|感覚|情報|ヒント|注意|追加情報)[:：]", choice_text):
                        continue

                    # 有効な選択肢として追加（最大3つまで）
                    if len(choices) < 3:
                        choices.append(
                            ActionChoice(id=f"choice_{len(choices) + 1}", text=choice_text, difficulty=difficulty)
                        )
            else:
                # 物語部分
                if line.strip():
                    narrative_lines.append(line)

        # 物語テキストを結合
        narrative = "\n".join(narrative_lines).strip()

        # 選択肢が見つからない場合はデフォルトを生成
        if not choices:
            self.logger.warning("No choices found in response, generating defaults")
            choices = self._generate_default_choices()

        return narrative, choices

    def _generate_default_choices(self) -> list[ActionChoice]:
        """
        デフォルトの選択肢を生成

        Returns:
            デフォルトの選択肢リスト
        """
        return [
            ActionChoice(id="choice_1", text="周囲を詳しく調べる", difficulty="easy"),
            ActionChoice(id="choice_2", text="先に進む", difficulty="medium"),
            ActionChoice(id="choice_3", text="別の道を探す", difficulty="medium"),
        ]

    async def evaluate_session_ending(
        self, context: PromptContext, session_stats: dict[str, Any], proposal_count: int = 0
    ) -> Optional[SessionEndingProposal]:
        """
        セッション終了の判定と提案を生成

        Args:
            context: プロンプトコンテキスト
            session_stats: セッション統計（turn_count, play_duration_minutes, word_count）
            proposal_count: 現在の提案回数（0-2）

        Returns:
            終了提案（終了すべきでない場合はNone）
        """
        try:
            # 終了判定用の追加コンテキスト
            ending_context = {
                "turn_count": session_stats.get("turn_count", 0),
                "play_duration_minutes": session_stats.get("play_duration_minutes", 0),
                "word_count": session_stats.get("word_count", 0),
                "proposal_count": proposal_count,
                "recent_events": context.world_state.get("recent_events", []),
                "character_hp_ratio": context.character_stats.get("hp", 100)
                / context.character_stats.get("max_hp", 100),
                "character_mp_ratio": context.character_stats.get("mp", 100)
                / context.character_stats.get("max_mp", 100),
                "sp_remaining": context.character_stats.get("sp", 0),
            }

            # 強制終了条件のチェック
            is_mandatory = self._check_mandatory_ending(ending_context, proposal_count)

            # 終了提案が必要かチェック
            should_propose, reason = self._should_propose_ending(ending_context)

            if not should_propose and not is_mandatory:
                return None

            # 終了提案用のプロンプト生成
            enhanced_context = self._create_ending_evaluation_context(context, ending_context, reason)

            # AIに終了提案を生成させる
            prompt = self._build_ending_proposal_prompt(enhanced_context)
            response = await self.generate_response(
                enhanced_context, temperature=0.7, max_tokens=800, custom_prompt=prompt
            )

            # レスポンスを解析して提案を構築
            proposal = self._parse_ending_proposal(response, proposal_count, is_mandatory, reason)

            return proposal

        except Exception as e:
            self.logger.error("Failed to evaluate session ending", error=str(e), character=context.character_name)
            # エラー時はNoneを返して終了提案しない
            return None

    def _check_mandatory_ending(self, ending_context: dict[str, Any], proposal_count: int) -> bool:
        """
        強制終了条件をチェック

        Args:
            ending_context: 終了判定用コンテキスト
            proposal_count: 現在の提案回数

        Returns:
            強制終了が必要かどうか
        """
        # 3回目の提案は必ず強制終了
        if proposal_count >= 2:
            return True

        # システム的な限界値
        if ending_context["turn_count"] >= 100:
            return True
        if ending_context["play_duration_minutes"] >= 180:  # 3時間
            return True
        if ending_context["word_count"] >= 50000:
            return True

        return False

    def _should_propose_ending(self, ending_context: dict[str, Any]) -> tuple[bool, str]:
        """
        終了提案をすべきか判定

        Args:
            ending_context: 終了判定用コンテキスト

        Returns:
            (提案すべきか, 理由)のタプル
        """
        # ストーリー的区切りの判定
        recent_events = ending_context.get("recent_events", [])
        for event in recent_events:
            if any(keyword in event for keyword in ["クエスト完了", "ボス撃破", "章の終わり", "重要な選択"]):
                return True, "物語が大きな区切りを迎えました"

        # システム的区切り
        if ending_context["turn_count"] >= 50:
            return True, "冒険が長時間に及んでいます"
        if ending_context["play_duration_minutes"] >= 120:  # 2時間
            return True, "プレイ時間が2時間を超えました"

        # プレイヤー状態
        if ending_context["character_hp_ratio"] < 0.2:
            return True, "キャラクターが危険な状態です"
        if ending_context["sp_remaining"] <= 0:
            return True, "SPが不足しています"

        return False, ""

    def _create_ending_evaluation_context(
        self, context: PromptContext, ending_context: dict[str, Any], reason: str
    ) -> PromptContext:
        """
        終了評価用のコンテキストを作成
        """
        # 既存のコンテキストをコピー
        enhanced_context = context
        enhanced_context.additional_context.update(
            {
                "ending_evaluation": True,
                "ending_reason": reason,
                "session_stats": ending_context,
            }
        )
        return enhanced_context

    def _build_ending_proposal_prompt(self, context: PromptContext) -> str:
        """
        終了提案生成用のプロンプトを構築
        """
        return f"""
現在のセッションは区切りの良いところまで来ています。
理由: {context.additional_context.get('ending_reason', '')}

これまでの冒険を簡潔にまとめ、次回への引きを作成してください。

以下の形式で回答してください：

【これまでの冒険】
（2-3文で今回のセッションの要点をまとめる）

【獲得予定の報酬】
- 経験値: （適切な値）
- アイテム: （獲得したアイテムがあれば）
- その他: （重要な成果があれば）

【次回への引き】
（1-2文で次回のセッションへの期待を高める文章）
"""

    def _parse_ending_proposal(
        self, response: str, proposal_count: int, is_mandatory: bool, reason: str
    ) -> SessionEndingProposal:
        """
        AIレスポンスから終了提案を解析
        """
        # デフォルト値
        summary_preview = "今回の冒険はここまでとなります。"
        continuation_hint = "次回の冒険でお会いしましょう。"
        rewards_preview = {"experience": 100, "skills": {}, "items": []}

        # レスポンスを解析
        sections = response.split("【")
        for section in sections:
            if section.startswith("これまでの冒険】"):
                summary_preview = section.split("】", 1)[1].strip()
            elif section.startswith("獲得予定の報酬】"):
                rewards_text = section.split("】", 1)[1].strip()
                # 簡易的な報酬解析
                if "経験値:" in rewards_text:
                    exp_match = re.search(r"経験値:\s*(\d+)", rewards_text)
                    if exp_match:
                        rewards_preview["experience"] = int(exp_match.group(1))
            elif section.startswith("次回への引き】"):
                continuation_hint = section.split("】", 1)[1].strip()

        return SessionEndingProposal(
            reason=reason,
            summary_preview=summary_preview,
            continuation_hint=continuation_hint,
            rewards_preview=rewards_preview,
            proposal_count=proposal_count + 1,
            is_mandatory=is_mandatory,
            can_continue=not is_mandatory,
        )
