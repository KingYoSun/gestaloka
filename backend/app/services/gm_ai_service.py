"""
GM AIサービス - 物語生成と世界管理

Coordinator AIを使用して物語生成と世界管理を行います。
"""

import re
from typing import Any, Optional

from sqlmodel import Session, select

from app.models import Character, Location, LocationConnection
from app.models.exploration_progress import CharacterExplorationProgress
from app.schemas.narrative import GMAIResponse, LocationEvent
from app.services.ai.coordinator_factory import get_coordinator_ai
from app.services.sp_calculation import SPCalculationService


class GMAIService:
    """GM AI評議会の統合サービス"""

    def __init__(self, db: Session):
        self.db = db
        # Coordinator AIを取得
        self.coordinator_ai = get_coordinator_ai()

    async def process_narrative_action(
        self, character: Character, action: str, current_location: Location, context: Optional[dict[str, Any]] = None
    ) -> GMAIResponse:
        """プレイヤーの行動を処理し、物語を生成"""

        # プロンプトを構築
        prompt = self._build_narrative_prompt(character, action, current_location, context)

        # Coordinator AIを使用してAI応答を生成
        response = await self.coordinator_ai.generate_response(
            prompt=prompt,
            agent_type="dramatist",
            character_name=character.name,
            metadata={
                "location_id": str(current_location.id),
                "location_name": current_location.name,
                "action": action,
                "context": context
            }
        )

        # レスポンスを解析
        return self._parse_narrative_response(response, character, current_location, action)

    def _build_narrative_prompt(
        self, character: Character, action: str, location: Location, context: Optional[dict[str, Any]] = None
    ) -> str:
        """物語生成のプロンプトを構築"""

        # 基本情報
        prompt = f"""## 現在の状況
キャラクター: {character.name}
現在地: {location.name}（{location.description}）
場所タイプ: {location.location_type.value}
危険度: {location.danger_level.value}
階層: 第{location.hierarchy_level}層

## キャラクターの行動
{action}

## 指示
1. キャラクターの行動に基づいて、2-3段落の物語を生成してください
2. 物語は一人称視点で、五感を使った描写を含めてください
3. 場所の雰囲気や危険度を反映させてください
4. 行動の結果として自然に場所が変わる場合は、その移動も描写してください

## 移動判定
以下の条件で場所の移動が発生します：
- 「進む」「向かう」「移動する」などの移動を示す行動
- 「扉を開ける」「階段を上る」など場所の遷移を伴う行動
- 物語の流れで自然に別の場所へ移る必要がある場合

## 出力形式
物語テキストを生成してください。
場所が変わる場合は、最後に以下を追加：
[移動先: 場所名]
[SP消費: 数値]"""

        # 利用可能な接続情報を追加
        available_locations = self._get_available_locations(character, location)
        if available_locations:
            prompt += "\n\n## 移動可能な場所\n"
            for to_location, travel_description in available_locations:
                prompt += f"- {to_location.name}（{travel_description or '未知の道'}）\n"

        return prompt

    def _get_available_locations(
        self, character: Character, location: Location
    ) -> list[tuple[Location, Optional[str]]]:
        """現在地から移動可能な場所を取得"""
        available = []

        connections = self.db.exec(
            select(LocationConnection).where(
                LocationConnection.from_location_id == location.id,
                LocationConnection.is_blocked == False,  # noqa: E712
            )
        ).all()

        for conn in connections:
            to_location = self.db.get(Location, conn.to_location_id)
            if to_location:
                # 探索進捗をチェックして発見済みか確認
                progress = self.db.exec(
                    select(CharacterExplorationProgress).where(
                        CharacterExplorationProgress.character_id == character.id,
                        CharacterExplorationProgress.location_id == to_location.id
                    )
                ).first()

                # 発見済み（霧が晴れている）場合のみ追加
                if progress and progress.fog_revealed_at:
                    available.append((to_location, conn.travel_description))

        return available

    def _parse_narrative_response(
        self, ai_response: str, character: Character, current_location: Location, action: str
    ) -> GMAIResponse:
        """AI応答を解析してGMAIResponseを生成"""

        # メタデータを抽出
        metadata = self._extract_metadata_from_response(ai_response)

        # メタデータを除去したナラティブを取得
        narrative = self._clean_narrative(ai_response, metadata)

        # 場所移動の処理
        location_changed = False
        new_location_id = None
        movement_description = None
        sp_cost = 0

        if "destination" in metadata:
            new_location = self.db.exec(
                select(Location).where(Location.name == metadata["destination"])
            ).first()

            if new_location:
                location_changed = True
                new_location_id = str(new_location.id)
                movement_description = self._extract_movement_description(narrative)

                # SP消費の計算
                if "sp_cost" in metadata:
                    try:
                        sp_cost = int(metadata["sp_cost"])
                    except (ValueError, TypeError):
                        sp_cost = self._calculate_default_sp_cost(current_location, new_location)
                else:
                    sp_cost = self._calculate_default_sp_cost(current_location, new_location)

        # イベントの生成（AI応答に基づいて判定）
        events = self._generate_events_from_narrative(narrative, action)

        return GMAIResponse(
            narrative=narrative,
            location_changed=location_changed,
            new_location_id=new_location_id,
            movement_description=movement_description,
            sp_cost=sp_cost,
            events=events if events else None,
        )

    def _calculate_default_sp_cost(self, from_location: Location, to_location: Location) -> int:
        """デフォルトのSP消費を計算"""
        # 移動の複雑度を判定
        level_diff = abs(to_location.hierarchy_level - from_location.hierarchy_level)
        danger_level = to_location.danger_level.value

        # 複雑度の判定
        complexity = "normal"
        if level_diff == 0 and danger_level in ["safe", "low"]:
            complexity = "simple"
        elif level_diff >= 2 or danger_level in ["high", "extreme"]:
            complexity = "complex"

        # SPCalculationServiceを使用
        return SPCalculationService.calculate_action_cost(
            action_type="movement",
            complexity=complexity,
            has_bonus=False
        )

    def _extract_movement_description(self, narrative: str) -> str:
        """物語から移動部分の描写を抽出"""
        # 最後の段落を移動描写として使用
        paragraphs = narrative.split("\n\n")
        if len(paragraphs) > 1:
            return paragraphs[-1]
        return "新しい場所へと移動した。"

    def _extract_metadata_from_response(self, response: str) -> dict[str, str]:
        """レスポンスからメタデータを抽出"""
        metadata = {}

        # [移動先: XXX] パターン
        destination_match = re.search(r'\[移動先:\s*([^\]]+)\]', response)
        if destination_match:
            metadata["destination"] = destination_match.group(1).strip()

        # [SP消費: XXX] パターン
        sp_match = re.search(r'\[SP消費:\s*([^\]]+)\]', response)
        if sp_match:
            metadata["sp_cost"] = sp_match.group(1).strip()

        # [イベント: XXX] パターン（将来的な拡張用）
        event_match = re.search(r'\[イベント:\s*([^\]]+)\]', response)
        if event_match:
            metadata["event"] = event_match.group(1).strip()

        return metadata

    def _clean_narrative(self, response: str, metadata: dict[str, str]) -> str:
        """メタデータを除去したクリーンなナラティブを返す"""
        # すべてのメタデータパターンを削除
        patterns = [
            r'\[移動先:[^\]]+\]',
            r'\[SP消費:[^\]]+\]',
            r'\[イベント:[^\]]+\]'
        ]

        clean_response = response
        for pattern in patterns:
            clean_response = re.sub(pattern, '', clean_response)

        # 連続する改行を整理
        clean_response = re.sub(r'\n{3,}', '\n\n', clean_response)

        return clean_response.strip()

    def _generate_events_from_narrative(self, narrative: str, action: str) -> list[LocationEvent]:
        """ナラティブやアクションに基づいてイベントを生成"""
        events = []

        # キーワードに基づいたイベント判定
        discovery_keywords = ["発見", "見つけ", "手に入れ", "発掘", "探し出"]
        encounter_keywords = ["出会", "遭遇", "出くわ", "現れ", "姿を見せ"]

        # 発見イベント
        if any(keyword in narrative or keyword in action for keyword in discovery_keywords):
            events.append(
                LocationEvent(
                    type="discovery",
                    title="何かを発見した",
                    description="探索中に興味深いものを見つけた",
                    effects={"fragments": 1},
                )
            )

        # 遭遇イベント
        if any(keyword in narrative for keyword in encounter_keywords):
            events.append(
                LocationEvent(
                    type="encounter",
                    title="誰かと出会った",
                    description="予期せぬ出会いがあった",
                    effects={},
                )
            )

        return events

    async def generate_ai_response(
        self,
        prompt: str,
        agent_type: str,
        character_name: str,
        metadata: Optional[dict[str, Any]] = None
    ) -> str:
        """
        他のサービスから呼び出されるAIレスポンス生成

        Coordinator AIを使用してリクエストを処理します。
        """
        return await self.coordinator_ai.generate_response(
            prompt=prompt,
            agent_type=agent_type,
            character_name=character_name,
            metadata=metadata
        )
