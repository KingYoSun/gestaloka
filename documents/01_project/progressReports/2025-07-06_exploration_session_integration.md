# 探索機能とセッション進行の統合実装レポート

## 実施日: 2025-07-06

## 概要
独立した探索機能をセッション進行（物語主導型システム）に統合し、設計理念である「物語が移動を導く」を実現しました。

## 背景
- 探索専用ページの存在が物語主導型設計の理念と矛盾
- プレイヤーが物語から切り離されて機械的に探索できる状態
- MVPテストプレイに向けて理想的な実装を行う必要性

## 実装内容

### 1. フロントエンドの変更
- **探索ページの削除**
  - `/frontend/src/routes/_authenticated/exploration.tsx` 削除
  - `/frontend/src/features/exploration/` ディレクトリ全体を削除
  - サイドバーから「探索」メニューを削除
  - 探索関連のフック・APIクライアントを削除

- **NarrativeInterface.tsxの修正**
  - ミニマップコンポーネントの参照を削除
  - 場所情報表示を削除（物語内で表現されるため）

### 2. バックエンドの変更

#### GameSessionServiceの拡張
```python
def _is_exploration_action(self, action_request: ActionExecuteRequest) -> bool:
    """アクションが探索関連かどうかを判定"""
    exploration_keywords = ["探索", "調べる", "探す", "捜索", "移動", "向かう", "行く"]
    return any(keyword in action_request.action_text for keyword in exploration_keywords)

async def _process_exploration_action(...) -> Any:
    """探索アクションを物語として処理"""
    # 探索結果の判定
    exploration_result = await self._perform_exploration(character)
    
    # CoordinatorAIで物語を生成
    coordinator_response = await self.coordinator.process_action(player_action, session_response)
    
    # フラグメント発見を物語に組み込む
    if exploration_result.get("found_fragment"):
        additional_narrative = f"探索中に、{fragment_data['rarity']}な記憶の欠片を発見しました..."
        coordinator_response.narrative += additional_narrative
```

#### CoordinatorAIの拡張
```python
def _generate_exploration_choices_from_context(self, narrative: str) -> list[Choice]:
    """物語の文脈から探索関連の選択肢を生成"""
    # 物語の内容に基づいて適切な探索選択肢を提案
    if any(word in narrative for word in ["街", "町", "都市", "村"]):
        choices.append(Choice(
            id="explore_town",
            text="街を探索する",
            metadata={"action_type": "exploration", "sp_cost": 5}
        ))
```

### 3. API変更
- **削除したエンドポイント**
  - `/api/v1/exploration/*` - 探索専用API全て
  - 関連するサービスクラスも削除

### 4. テスト
- 探索関連の古いテストを削除
- 新しい統合テストを作成（`test_exploration_integration.py`）
- フロントエンドテスト：28/28成功（100%）

## 技術的な特徴

### 物語主導の探索
- プレイヤーの探索意図をAIが解釈
- 探索結果を物語として描写
- フラグメント発見も物語の一部として統合

### シームレスな統合
- 既存のセッション進行フローを活用
- 探索専用の処理を最小限に抑制
- SP消費は既存の仕組みをそのまま使用

## 成果

### 設計理念の実現
- ✅ 物語が移動を導く
- ✅ セッション進行が最優先
- ✅ プレイヤーは物語に没入しながら探索

### 開発効率
- 実装期間：1日（計画では1週間）
- コード削減：探索関連の独立コードを大幅削減
- 保守性向上：システムが単純化

### ユーザー体験
- 物語の流れが途切れない
- 探索が自然な行動として組み込まれる
- 機械的な操作感の排除

## 課題と今後の改善点

### パフォーマンス
- 探索アクションでもAI処理が必要
- レスポンス時間の監視が必要

### 探索体験の深化
- より豊かな探索描写の生成
- 場所固有の探索イベント追加
- 移動時の物語演出強化

## まとめ
MVPテストプレイに向けて、探索機能をセッション進行に完全統合しました。これにより、ゲスタロカの核心的な設計理念である「物語主導型」のゲーム体験が実現されました。

---

*作成者: Claude (AI Assistant)*
*レビュー: 未実施*