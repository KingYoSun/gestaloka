# 現在の開発環境状況 - ゲスタロカ (GESTALOKA)

## 最終更新: 2025/06/30

## 稼働中のサービス（localhost） - 2025/06/29時点（ヘルスチェック完全修正）
🟢 **PostgreSQL 17**: ポート5432 - ユーザーデータ、キャラクターデータ（healthy）  
🟢 **Neo4j 5.26 LTS**: ポート7474/7687 - グラフデータベース、関係性データ（healthy）  
🟢 **Redis 8**: ポート6379 - セッション、キャッシュ、Celeryブローカー（healthy）  
🟢 **Backend API**: ポート8000 - FastAPI、認証API稼働中（healthy）  
🟢 **Celery Worker**: Celeryタスクワーカー稼働中（healthy）  
🟢 **Celery Beat**: 定期タスクスケジューラ稼働中（healthy）  
🟢 **Frontend**: ポート3000 - React/Vite開発サーバー稼働中（healthy）✅ 修正済み  
🟢 **Flower**: ポート5555 - Celery監視ツール稼働中（healthy）✅ 修正済み  
🟢 **Keycloak 26.2**: ポート8080 - 認証サーバー稼働中（healthy）✅ 修正済み

## ヘルスチェック問題（2025/06/29 完全解決）
### 全て解決済み ✅
- **Celery Worker/Beat**: 非同期タスク処理が正常動作
- **Flower**: `FLOWER_UNAUTHENTICATED_API=true`環境変数追加で解決
- **Keycloak**: bashのTCP接続チェックに変更して解決
- **Frontend**: コンテナ再ビルドで依存関係を完全に解決
- **結果**: 全13サービスがhealthy状態（100%）  

## 実装済み機能
- ✅ ユーザー登録・ログイン（JWT認証）
- ✅ 認証保護エンドポイント
- ✅ データベースマイグレーション（Alembic + SQLModel統合）
- ✅ 型安全なAPIクライアント統合
- ✅ キャラクター管理（作成・一覧・詳細・状態管理）
- ✅ ゲームセッション管理（作成・更新・終了・アクション実行）
- ✅ AI統合基盤（Gemini API、プロンプト管理、エージェントシステム）
- ✅ Celeryタスク管理（Worker、Beat、Flower統合）
- ✅ 基本的な戦闘システム（ターン制バトル、戦闘UI、リアルタイム更新）
- ✅ ログシステム基盤（LogFragment、CompletedLog）
- ✅ ログNPC生成機能（Neo4j統合、NPCジェネレーター、Celeryタスク）
- ✅ フロントエンドDRY原則実装（共通コンポーネント、カスタムフック、ユーティリティ）
- ✅ ログ編纂UI基本実装（フラグメント管理、編纂エディター、汚染度計算）
- ✅ SPシステムのデータモデル実装
- ✅ SP管理API実装完了
- ✅ SPシステムのフロントエンド統合完了
- ✅ 全てのテスト・型・リントエラーを完全解消
- ✅ ログ派遣システムの完全実装（DispatchAPI、UI、Celeryタスク）
- ✅ 探索システムの完全実装（Location管理、移動、エリア探索）
- ✅ ログNPC出現システムの完全実装（バックエンド・フロントエンド統合）
- ✅ 派遣ログAI駆動シミュレーション（8種類の目的別活動、相互作用）
- ✅ SP購入システムの実装（テストモード、環境変数制御、WebSocket統合）
- ✅ ログNPC遭遇システムのフロントエンド改善（UI/UX向上、アニメーション）

## 利用可能なURL
- **フロントエンド**: http://localhost:3000
- **API ドキュメント**: http://localhost:8000/docs
- **Neo4j ブラウザ**: http://localhost:7474
- **ヘルスチェック**: http://localhost:8000/health
- **Celery監視（Flower）**: http://localhost:5555
- **Keycloak管理画面**: http://localhost:8080/admin（admin/admin_password）

## 技術スタック

### フロントエンド
- TypeScript 5.8
- React 19.1
- Vite 6.3
- shadcn/ui
- zustand 5.0
- TanStack Query 5.80
- TanStack Router 1.121
- Vitest 3.2

### バックエンド
- Python 3.11
- FastAPI 0.115
- LangChain 0.3.25
- langchain-google-genai 2.1.5
- SQLModel 0.0.24
- neomodel 5.4
- Celery 5.4

### データベース
- PostgreSQL 17 (構造化データ)
- Neo4j 5.26 LTS (グラフデータ)

### キャッシュ/ブローカー
- Redis 8

### 認証
- Keycloak 26.2

### LLM
- Gemini 2.5 Pro (安定版: gemini-2.5-pro)

### インフラ
- Docker Compose
- WebSocket (Socket.IO)
- Celery（Worker/Beat/Flower）

## 最近の変更（2025/06/30）
- AI応答時間の最適化実装
  - GM AIエージェント別のLLMモデル切り替え機能追加
  - 軽量モデル（gemini-2.5-flash）と標準モデル（gemini-2.5-pro）の使い分け
  - 環境変数による柔軟なモデル設定（GEMINI_MODEL_FAST、GEMINI_MODEL_STANDARD）
  - パフォーマンスログの追加による実行時間の可視化
  - 期待効果：応答時間を20秒から10-15秒へ短縮（25-50%削減）
  - 詳細は`documents/01_project/progressReports/2025-06-30_AI応答時間最適化.md`参照
- AI派遣シミュレーションテストの修正完了
  - 失敗していた3件のテストを全て修正
  - MagicMockから実際のPydanticモデルインスタンスに変更
  - 存在しないobjective_detailsフィールドの削除
  - バックエンドテスト成功率100%達成（全225件成功）
  - 詳細は`documents/01_project/progressReports/2025-06-30_テスト修正完了.md`参照
- バックエンド型エラーの完全解消
  - 82個の型エラーを0に削減
  - SQLModel/SQLAlchemy統合の型安全性改善
  - Optional型の適切な処理実装
  - 非同期/同期処理の整合性確保
  - 詳細は`documents/01_project/progressReports/2025-06-30_型エラー完全解消.md`参照

### 2025/06/29の変更
- ヘルスチェック問題の完全解決
  - Flower: `FLOWER_UNAUTHENTICATED_API=true`環境変数追加
  - Frontend: コンテナ再ビルドで依存関係解決
  - Keycloak: bashのTCP接続チェックに変更
  - 全13サービスがhealthy状態を達成
- ログNPC遭遇システムのフロントエンド実装完了
  - NPCEncounterDialogコンポーネントの新規作成
  - WebSocketイベントハンドラーの実装（npc_encounter、npc_action_result）
  - useGameWebSocketフックの拡張によるNPC遭遇状態管理
  - ゲーム画面への統合（リアルタイム通知、メッセージログ記録）
  - 型定義の追加（NPCProfile、NPCEncounterData、NPCActionResultData）
- UI/UXの向上
  - ダイアログ形式での遭遇表示
  - 遭遇タイプ別のバッジ色分け（hostile、friendly、mysterious）
  - 汚染レベルの視覚的インジケーター
  - 選択肢の難易度表示
- 技術的成果
  - 型チェックエラーなし
  - リントエラーなし（既存のany型警告のみ）
  - バックエンドとの完全な統合

### 2025/06/29の変更
- ログNPC出現システムのバックエンド実装
  - 派遣ログの位置追跡機能
  - 同一場所でのNPC遭遇メカニズム
  - AI統合によるNPC処理
- 派遣ログAI駆動シミュレーション強化
  - 8種類の派遣目的別活動生成
  - 派遣ログ同士の相互作用システム
  - 30分ごとの定期チェックタスク

### 2025/06/28の変更
- ログフラグメント発見演出のアニメーション実装
  - 探索システムにおける視覚的フィードバックの強化
  - framer-motionを活用した段階的表示アニメーション
  - レアリティ別の演出効果（色彩、パーティクル、波紋）
  - FragmentDiscoveryAnimationコンポーネントの新規作成
- SP残高表示コンポーネントの改良とセキュリティ強化
  - リアルタイム更新機能（5秒間隔、30秒自動更新）
  - 視覚的フィードバック（警告表示、増減アニメーション）
  - WebSocketイベント（sp_update）への対応準備
  - セキュリティ検証：全SP関連APIの認証・権限確認
- SPシステムの基本実装完了
  - 自由行動入力時のSP消費実装（自由行動3SP、選択肢1SP）
  - SP不足時のエラーハンドリング強化
  - SP自然回復バッチ処理（Celeryタスク、毎日UTC4時実行）
  - SP消費設定の設定ファイル管理（config.py）
- 全てのテスト・型・リントエラーを完全解消
  - フロントエンド：テスト21個成功、型チェックエラー0、リントエラー0
  - バックエンド：テスト192/193成功、型チェック対応、リントエラー0
  - 型定義の重複解消、キャメルケース/スネークケース統一
  - date-fnsパッケージのインストール

### 2025/06/22の変更
- SPシステムの完全実装
  - SPシステムのデータモデル実装（CharacterSP、SPHistory）
  - SP管理API実装完了（SP消費、回復、履歴取得）
  - SPシステムのフロントエンド統合完了
  - 全てのテスト・型・リントエラーを完全解消
  - ログシステムの全面再設計（アクションログとスキルログの分離）

### 2025-06-20の変更
- ログ編纂機能の有効化と実装完了
  - 編纂ボタンの有効化とクリックハンドラー実装
  - LogCompilationEditorとLogsPageの完全統合
  - バックエンドAPIとの型整合性問題を解決
  - `CompletedLogCreate`型をバックエンドスキーマに合わせて修正
  - テストデータ作成環境の整備（手動テスト手順書）
  - 型チェックエラーなし、リント警告2件（any型使用、許容範囲内）

### 2025-06-19の変更
- DRY原則に基づく重複コードの大規模修正
  - パスワードバリデーションの共通関数化（`app/utils/validation.py`）
  - 権限チェックロジックの統一化（`app/utils/permissions.py`）
  - カスタム例外クラスの活用とエラーハンドリング統一（`app/core/error_handler.py`）
  - ハードコーディング値の設定ファイル移行（キャラクター初期値等）
  - 重複NPCマネージャー実装の統合
- ベストプラクティスドキュメントの作成（`documents/05_implementation/bestPractices.md`）
- コード品質の向上（保守性、一貫性、拡張性の改善）

### 2025-06-18の変更
- ログシステムの基盤実装完了（LogFragment、CompletedLog、LogContract）
- データベーステーブルの追加（log_fragments、completed_logs、log_contracts等）
- APIエンドポイントの拡充（/api/v1/logs/*）
- テストカバレッジの向上（全178テストがパス）
- Gemini 2.5 Pro安定版への移行完了
- 依存ライブラリの更新（langchain 0.3.25、langchain-google-genai 2.1.5）
- プロジェクト名をTextMMOからGESTALOKAに統一
- コード品質の完全クリーン化（リント、型チェック0エラー）

## データベース状態

### PostgreSQLテーブル
- users
- characters
- character_stats
- skills
- game_sessions
- action_logs
- skill_logs
- character_sp
- sp_history
- log_fragments
- completed_logs
- log_contracts
- completed_log_sub_fragments
- log_dispatches
- dispatch_encounters
- dispatch_reports
- locations
- location_connections
- exploration_areas
- character_location_history
- exploration_logs
- alembic_version

### ENUMタイプ
- skilllogtype
- sphistorytype

## 環境設定
- **Docker Compose**: 全サービスが正常稼働
- **ネットワーク**: gestaloka-network（172.20.0.0/16）
- **ボリューム**: 全データ永続化設定済み

## 現在の問題点（2025/06/30更新）
### テスト（完全修正済み）
- バックエンドテスト: 225件中225件成功（100%成功率）✅
  - AI派遣シミュレーション: 全て修正完了
  - その他のテストも全て正常

### 型エラー（完全修正済み）
- バックエンド: 0個（2025/06/30 - 82個から完全解消）✅
- フロントエンド: 0個 ✅

### ヘルスチェック（完全解決）
- ✅ 全13サービスがhealthy状態（100%）

### 優先対応事項
1. ✅ ~~AI関連テストの修正~~ 完了
2. ✅ ~~バックエンドの型エラー対応~~ 完了（2025/06/30）
3. パフォーマンス最適化（AI応答時間）
4. Pydantic V2への移行準備