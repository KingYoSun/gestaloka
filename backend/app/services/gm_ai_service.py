"""
GM AIサービス - 物語生成と世界管理
"""

import random
from typing import Any, Optional

from sqlmodel import Session, select

from app.models import Character, Location, LocationConnection
from app.schemas.narrative import GMAIResponse, LocationEvent
from app.services.ai_base_service import AIBaseService


class GMAIService(AIBaseService):
    """GM AI評議会の統合サービス"""

    def __init__(self, db: Session):
        super().__init__(db)

    async def process_narrative_action(
        self, character: Character, action: str, current_location: Location, context: Optional[dict[str, Any]] = None
    ) -> GMAIResponse:
        """プレイヤーの行動を処理し、物語を生成"""

        # プロンプトを構築
        prompt = self._build_narrative_prompt(character, action, current_location, context)

        # AI応答を生成
        response = await self.generate_ai_response(
            prompt,
            agent_type="scriptwriter",
            character_name=character.name,
            metadata={"action": action, "location": current_location.name},
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
        connections = self.db.exec(
            select(LocationConnection).where(
                LocationConnection.from_location_id == location.id, LocationConnection.is_blocked == False  # noqa: E712
            )
        ).all()

        if connections:
            prompt += "\n\n## 移動可能な場所\n"
            for conn in connections:
                to_location = self.db.get(Location, conn.to_location_id)
                if to_location and to_location.is_discovered:
                    prompt += f"- {to_location.name}（{conn.travel_description or '未知の道'}）\n"

        return prompt

    def _parse_narrative_response(
        self, ai_response: str, character: Character, current_location: Location, action: str
    ) -> GMAIResponse:
        """AI応答を解析してGMAIResponseを生成"""

        # デフォルト値
        narrative = ai_response
        location_changed = False
        new_location_id = None
        movement_description = None
        sp_cost = 0
        events = []

        # 移動判定
        if "[移動先:" in ai_response:
            # 移動先を抽出
            try:
                start = ai_response.index("[移動先:") + 5
                end = ai_response.index("]", start)
                destination_name = ai_response[start:end].strip()

                # 場所を検索
                new_location = self.db.exec(select(Location).where(Location.name == destination_name)).first()

                if new_location:
                    location_changed = True
                    new_location_id = str(new_location.id)

                    # SP消費を抽出
                    if "[SP消費:" in ai_response:
                        sp_start = ai_response.index("[SP消費:") + 6
                        sp_end = ai_response.index("]", sp_start)
                        try:
                            sp_cost = int(ai_response[sp_start:sp_end].strip())
                        except ValueError:
                            sp_cost = self._calculate_default_sp_cost(current_location, new_location)

                    # メタ情報を除去
                    narrative = ai_response[: ai_response.index("[移動先:")].strip()
                    movement_description = self._extract_movement_description(narrative)

            except (ValueError, IndexError):
                # パース失敗時はそのまま
                pass

        # イベント判定（簡易実装）
        if random.random() < 0.1:  # 10%の確率でイベント発生
            events.append(
                LocationEvent(
                    type="discovery",
                    title="何かを発見した",
                    description="探索中に興味深いものを見つけた",
                    effects={"fragments": 1},
                )
            )

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
        base_cost = 5

        # 階層差による追加コスト
        level_diff = abs(to_location.hierarchy_level - from_location.hierarchy_level)
        base_cost += level_diff * 2

        # 危険度による追加コスト
        danger_costs = {"safe": 0, "low": 1, "medium": 3, "high": 5, "extreme": 10}
        base_cost += danger_costs.get(to_location.danger_level.value, 0)

        return base_cost

    def _extract_movement_description(self, narrative: str) -> str:
        """物語から移動部分の描写を抽出"""
        # 最後の段落を移動描写として使用
        paragraphs = narrative.split("\n\n")
        if len(paragraphs) > 1:
            return paragraphs[-1]
        return "新しい場所へと移動した。"
