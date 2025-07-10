# WebSocketとAI統合の問題調査レポート - 2025年7月10日

## 概要
セッションUI表示問題の修正作業中に、WebSocketとAI統合に関する複数の重大な問題が発覚しました。問題の修正を試みましたが、根本的な解決には至らず、今後の対応が必要です。

## 実施した修正

### 1. UI表示問題（解決済み）✅
- **キャラクター名表示問題**: NovelGameInterfaceでspeaker: undefinedに設定して解決
- **セッション永続化**: useGameSessionsフックのインポート漏れを修正
- **WebSocketメッセージ重複**: タイムスタンプ+ランダム文字列でユニークID生成
- **スクロール制限**: コンテナ階層とoverflow設定を修正
- **削除済みキャラクター表示**: フィルタリング追加
- **レイアウト重複**: コンテナ構造を再設計

### 2. WebSocket統合エラー（部分的に解決）⚠️
#### エラー修正経緯
1. "name 'select' is not defined" → `from sqlmodel import select`追加
2. "'ConnectionManager' has no attribute 'emit_to_session'" → `broadcast_to_game`に変更
3. "'GMAIService' has no attribute 'generate_narrative'" → `generate_ai_response`に変更
4. "name 'character' is not defined" → キャラクター取得処理追加

#### 修正したファイル
- `backend/app/websocket/server.py`
- `backend/app/services/quest_service.py`
- `backend/app/ai/progress_notifier.py`

## 未解決の問題 🔴

### 1. セッション再接続時の重複表示
- **症状**: 再接続時に同じストーリーが2回表示される
- **試行した対策**:
  - React.StrictModeの影響を考慮（isMountedフラグ追加）
  - バックエンドでの重複接続チェック
  - フロントエンドでのメッセージ重複排除
  - 再接続時は選択肢のみ送信するよう変更
- **結果**: 問題は解決せず、原因不明

### 2. AI統合の不完全な実装
- **選択肢が更新されない**: 古い選択肢が表示され続ける
- **不要なテキスト表示**: "承知しました。あなたの行動ログを基に、物語を生成します"などのAIレスポンス前置きが表示される
- **クエスト更新失敗**: JSONパースエラーでクエストが更新されない

### 3. 根本的な設計問題
- LLMService、AIBaseService、GMAIServiceが仮実装のまま
- WebSocketとREST APIの処理が混在
- エラーハンドリングが不十分で問題の特定が困難

## 技術的分析

### WebSocketメッセージフロー
```
1. join_game → 初回: introduction narrative + choices
           → 再接続: choices only
2. game_action → execute_action → narrative_update + choices_update
```

### 問題の推定原因
1. **フロントエンドのストア管理**
   - Zustandストアとローカルストレージの同期問題
   - メッセージの重複チェックが不完全

2. **メッセージタイプの混乱**
   - introduction、current_scene、loaded_from_historyの処理が統一されていない
   - narrative_typeの使い分けが不明確

3. **AI統合の未完成**
   - LLMServiceが仮実装で固定レスポンスを返す
   - JSONフォーマットの生成が保証されていない
   - プロンプトエンジニアリングが不十分

## 推奨される次のステップ

### 短期対応
1. WebSocketイベント処理の完全な見直し
2. メッセージ管理ロジックの再設計
3. LLMServiceの実装（Gemini API連携）

### 中期対応
1. WebSocketとREST APIの役割分担明確化
2. 包括的なエラーハンドリング実装
3. E2Eテストの追加

### 長期対応
1. アーキテクチャの再検討
2. リアルタイム通信の最適化
3. AI統合のベストプラクティス確立

## まとめ
複数の修正を試みましたが、WebSocketとAI統合に関する根本的な問題は未解決のままです。特にセッション再接続時の重複表示とAI応答の品質問題は、ユーザー体験に直接影響するため、優先的な対応が必要です。

現時点では問題の全容を把握し、文書化することで、今後の開発方針を明確にすることを優先しました。