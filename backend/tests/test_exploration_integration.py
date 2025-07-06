"""
探索機能統合テスト
"""

import pytest
from sqlmodel import Session

from app.models.character import Character, GameSession
from app.schemas.game_session import ActionExecuteRequest
from app.services.game_session import GameSessionService


@pytest.mark.asyncio
class TestExplorationIntegration:
    """探索機能がセッション進行に統合されているかのテスト"""

    async def test_exploration_choices_in_narrative(self, session: Session, test_character: Character):
        """物語の選択肢に探索関連が含まれるかテスト"""
        # ゲームセッションサービスを初期化
        game_service = GameSessionService(session)

        # セッションを作成
        game_session = GameSession(
            character_id=test_character.id,
            is_active=True,
            current_scene="テスト用のシーン"
        )
        session.add(game_session)
        session.commit()

        # アクションを実行
        action_request = ActionExecuteRequest(
            action_type="choice_action",
            action_text="周囲を見回す"
        )

        response = await game_service.execute_action(game_session, action_request)

        # レスポンスの確認
        assert response.success is True
        assert response.narrative is not None
        assert response.choices is not None

        # 探索関連の選択肢が含まれているか確認
        exploration_keywords = ["探索", "調べる", "探す", "周囲"]
        has_exploration_choice = any(
            any(keyword in choice.text for keyword in exploration_keywords)
            for choice in response.choices
        )
        assert has_exploration_choice is True

    async def test_exploration_action_processing(self, session: Session, test_character: Character):
        """探索アクションが物語として処理されるかテスト"""
        # ゲームセッションサービスを初期化
        game_service = GameSessionService(session)

        # セッションを作成
        game_session = GameSession(
            character_id=test_character.id,
            is_active=True,
            current_scene="テスト用のシーン"
        )
        session.add(game_session)
        session.commit()

        # 探索アクションを実行
        action_request = ActionExecuteRequest(
            action_type="choice_action",
            action_text="周囲を探索する"
        )

        response = await game_service.execute_action(game_session, action_request)

        # レスポンスの確認
        assert response.success is True
        assert response.narrative is not None

        # メタデータにフラグメント発見情報が含まれている可能性がある
        # （発見は確率的なので、必ずしも含まれているとは限らない）
        if response.metadata and "fragment" in response.metadata:
            assert "id" in response.metadata["fragment"]
            assert "rarity" in response.metadata["fragment"]

    async def test_movement_action_in_narrative(self, session: Session, test_character: Character):
        """移動アクションが物語として処理されるかテスト"""
        # ゲームセッションサービスを初期化
        game_service = GameSessionService(session)

        # セッションを作成
        game_session = GameSession(
            character_id=test_character.id,
            is_active=True,
            current_scene="テスト用のシーン"
        )
        session.add(game_session)
        session.commit()

        # 移動アクションを実行
        action_request = ActionExecuteRequest(
            action_type="choice_action",
            action_text="北へ向かう"
        )

        response = await game_service.execute_action(game_session, action_request)

        # レスポンスの確認
        assert response.success is True
        assert response.narrative is not None

        # 物語として処理されていることを確認
        # （具体的な場所名がなくても、移動の意図が物語に反映される）
        assert len(response.narrative) > 50  # ある程度の長さの物語が生成される
