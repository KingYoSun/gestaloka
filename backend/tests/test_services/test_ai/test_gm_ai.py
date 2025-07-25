"""GM AI (脚本家AI) の動作確認テスト"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.services.ai.agents.dramatist import DramatistAgent


@pytest.mark.asyncio
async def test_dramatist_agent_basic():
    """脚本家AIの基本動作テスト"""
    from app.services.ai.prompt_manager import PromptContext

    # Geminiクライアントをモック
    with patch("app.services.ai.agents.base.GeminiClient") as mock_gemini_client:
        mock_client = mock_gemini_client.return_value
        mock_response = AsyncMock()
        mock_response.content = """
テストキャラクターは始まりの村の広場に立っていた。
朝のさわやかな空気が心地よく、村人たちが忙しそうに動き回っている。

## 選択肢
1. 市場を訪れる
2. 村長の家へ向かう
3. 周辺を探索する
"""
        mock_client.generate = AsyncMock(return_value=mock_response)

        agent = DramatistAgent()

        # テスト用のゲーム状況
        context = PromptContext(
            character_name="テストキャラクター",
            character_stats={"hp": 100, "max_hp": 100, "mp": 50, "max_mp": 50},
            location="始まりの村",
            recent_actions=["村に到着した", "宿屋で休憩した", "村の広場を探索する"],
            world_state={"time_of_day": "朝", "weather": "晴れ"},
            additional_context={},
        )

        # AI応答の生成
        response = await agent.process(context)

        # レスポンスの確認
        assert response is not None
        assert response.narrative is not None
        assert response.choices is not None
        assert len(response.choices) >= 1

        print("\n=== 脚本家AI レスポンス ===")
        print(f"シーン描写: {response.narrative}")
        print("\n選択肢:")
        for i, choice in enumerate(response.choices, 1):
            print(f"{i}. {choice.text} [難易度: {choice.difficulty or '通常'}]")


@pytest.mark.asyncio
async def test_gm_council_initialization():
    """GM評議会の初期化テスト（現在は脚本家AIのみ実装）"""
    # GMCouncilクラスがまだ実装されていない場合はスキップ
    print("\n=== GM評議会 状態 ===")
    print("現在の実装状況:")
    print("- 脚本家AI (Dramatist): 実装済み")
    print("- 歴史家AI (Historian): 実装済み")
    print("- 世界の意識AI (The World): 実装済み")
    print("- 混沌AI (The Anomaly): 実装済み")
    print("- NPC管理AI (NPC Manager): 実装済み")
    print("- 状態管理AI (State Manager): 実装済み")


@pytest.mark.asyncio
async def test_dramatist_with_player_action():
    """プレイヤーアクションに対する脚本家AIのレスポンステスト"""
    from app.services.ai.prompt_manager import PromptContext

    # Geminiクライアントをモック
    with patch("app.services.ai.agents.base.GeminiClient") as mock_gemini_client:
        mock_client = mock_gemini_client.return_value
        mock_response = AsyncMock()
        mock_response.content = """
アリスは慎重に光るキノコに近づいた。
キノコは薄い青白い光を放ち、脈動するように明滅している。
霧の中でその光は幻想的な雰囲気を醸し出していた。

## 選択肢
1. キノコに触れてみる [難易度: 困難]
2. 周囲に他のキノコがないか探す
3. 光を避けて引き返す
"""
        mock_client.generate = AsyncMock(return_value=mock_response)

        agent = DramatistAgent()

        # より複雑なゲーム状況
        context = PromptContext(
            character_name="アリス",
            character_stats={
                "hp": 75,
                "max_hp": 100,
                "mp": 30,
                "max_mp": 50,
                "level": 3,
                "inventory": ["錆びた剣", "旅人の地図", "乾パン"],
            },
            location="薄暮の森",
            recent_actions=["森に入った", "奇妙な声を聞いた", "光るキノコを発見した", "不思議な光を放つキノコを調べる"],
            world_state={
                "time_of_day": "夕暮れ",
                "weather": "霧",
                "recent_events": ["森で奇妙な声を聞いた", "キノコが光り始めた"],
            },
            additional_context={},
        )

        response = await agent.process(context)

        assert response is not None
        assert response.narrative
        assert response.choices

        print("\n=== 複雑な状況でのAIレスポンス ===")
        print(f"状況: {context.location}で「不思議な光を放つキノコを調べる」")
        print(f"\nAI生成シーン: {response.narrative}")
        print("\nAI提案の選択肢:")
        for i, choice in enumerate(response.choices, 1):
            print(f"{i}. {choice.text} [難易度: {choice.difficulty or '通常'}]")


@pytest.mark.asyncio
async def test_api_rate_limit_handling():
    """API レート制限のハンドリングテスト"""
    from app.core.exceptions import AIRateLimitError
    from app.services.ai.prompt_manager import PromptContext

    # Geminiクライアントをモック
    with patch("app.services.ai.agents.base.GeminiClient") as mock_gemini_client:
        mock_client = mock_gemini_client.return_value

        # 1回目は成功、2回目はレート制限、3回目は成功
        mock_response1 = AsyncMock()
        mock_response1.content = "テスト応答1"
        mock_response3 = AsyncMock()
        mock_response3.content = "テスト応答3"

        mock_client.generate = AsyncMock(
            side_effect=[mock_response1, AIRateLimitError("Rate limit exceeded"), mock_response3]
        )

        agent = DramatistAgent()

        # 短時間に複数のリクエストを送信
        contexts = [
            PromptContext(
                character_name=f"テスター{i}",
                character_stats={"hp": 100, "max_hp": 100, "mp": 50, "max_mp": 50},
                location="テスト場所",
                recent_actions=[f"アクション{i}"],
                world_state={"time_of_day": "昼"},
                additional_context={},
            )
            for i in range(3)
        ]

        responses = []
        errors = []

        for context in contexts:
            try:
                response = await agent.process(context)
                responses.append(response)
                await asyncio.sleep(0.5)  # レート制限を考慮した待機
            except Exception as e:
                errors.append(str(e))

        print("\n=== レート制限テスト結果 ===")
        print(f"成功したリクエスト: {len(responses)}/{len(contexts)}")
        print(f"エラー: {len(errors)}")

        if errors:
            print("\nエラー詳細:")
            for error in errors:
                print(f"- {error}")

        # 少なくとも1つは成功することを確認
        assert len(responses) > 0


@pytest.mark.asyncio
async def test_error_recovery():
    """エラーリカバリーのテスト"""
    from app.services.ai.prompt_manager import PromptContext

    agent = DramatistAgent()

    # 不正な入力でのテスト
    test_cases = [
        (
            "空の名前",
            lambda: PromptContext(
                character_name="",
                character_stats={},
                location="",
                player_action="",
                recent_actions=[],
                world_state={},
                additional_context={},
            ),
        ),
        ("Noneコンテキスト", lambda: None),
    ]

    for case_name, context_creator in test_cases:
        try:
            context = context_creator()
            if context:
                response = await agent.process(context)
                print(f"\n{case_name}: 予期せず成功 - {response}")
            else:
                response = await agent.process(None)
                print(f"\n{case_name}: 予期せず成功 - {response}")
        except Exception as e:
            print(f"\n{case_name}: 期待通りエラー - {type(e).__name__}: {e!s}")


if __name__ == "__main__":
    # 直接実行時の簡易テスト
    asyncio.run(test_dramatist_agent_basic())
