# 現在の開発環境状況 - ゲスタロカ (GESTALOKA)

## 最終更新: 2025/07/12（13:30 JST）

## 稼働中のサービス（localhost） - 2025/07/03時点（PostgreSQL統合後）
🟢 **PostgreSQL 17**: ポート5432 - 統合データベース（gestaloka、keycloak、gestaloka_test）（healthy）  
🟢 **Neo4j 5.26 LTS**: ポート7474/7687 - グラフデータベース、関係性データ（healthy）  
🟢 **Redis 8**: ポート6379 - セッション、キャッシュ、Celeryブローカー（healthy）  
🟢 **Backend API**: ポート8000 - FastAPI、認証API稼働中（healthy）  
🟢 **Celery Worker**: Celeryタスクワーカー稼働中（healthy）  
🟢 **Celery Beat**: 定期タスクスケジューラ稼働中（healthy）  
🟢 **Frontend**: ポート3000 - React/Vite開発サーバー稼働中（healthy）  
🟢 **Flower**: ポート5555 - Celery監視ツール稼働中（healthy）  
🟢 **Keycloak 26.2**: ポート8080 - 認証サーバー稼働中（healthy）

## インフラ構成変更（2025/07/03）
### PostgreSQLコンテナ統合 ✅
- **変更前**: postgres（メイン）、keycloak-db（認証）の2つのコンテナ
- **変更後**: 1つの統合postgresコンテナで3つのデータベースを管理
  - `gestaloka`: メインアプリケーション用
  - `keycloak`: Keycloak認証用
  - `gestaloka_test`: テスト用
- **効果**: メモリ使用量約50%削減、管理簡素化

## ヘルスチェック問題（2025/06/29 完全解決）
### 全て解決済み ✅
- **Celery Worker/Beat**: 非同期タスク処理が正常動作
- **Flower**: `FLOWER_UNAUTHENTICATED_API=true`環境変数追加で解決
- **Keycloak**: bashのTCP接続チェックに変更して解決
- **Frontend**: コンテナ再ビルドで依存関係を完全に解決
- **結果**: 全13サービスがhealthy状態（100%）  

## 実装済み機能
- ✅ ユーザー登録・ログイン（Cookie認証）
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
- ✅ 管理者用画面とパフォーマンス測定機能（管理者認証、リアルタイム監視）
- ✅ SP購入システムのStripe統合（テスト/本番モード切り替え、Webhook対応）
- ✅ セッションシステム再設計完了（全4フェーズ）
  - フェーズ1: セッション継続機能
  - フェーズ2: GM AIによる終了判定
  - フェーズ3: リザルト画面とデータ処理
  - フェーズ4: セッション間の継続性（AIナラティブ、Neo4j連携、初回仕様、ストーリーアーク）
- ✅ ノベルゲーム風UIの実装（タイプライター効果、自動再生、表示モード切り替え）
- ✅ ノベル風UIの改善（テーマ統合、直接実行、状態保持、レイアウト改善）

## 利用可能なURL
- **フロントエンド**: http://localhost:3000
- **管理画面**: http://localhost:3000/admin（管理者のみ）
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
- Gemini 2.5 Pro（gemini-2.5-pro）
- Gemini 2.5 Flash（高速版: gemini-2.5-flash、一部のAIエージェントで使用）

### インフラ
- Docker Compose
- WebSocket (Socket.IO)
- Celery（Worker/Beat/Flower）

  - フロントエンド決済フロー改善（テスト/本番モード切り替え）
  - 決済成功・キャンセルページの実装（/sp/success、/sp/cancel）
  - セキュリティ対策（Webhook署名検証、環境変数管理）
  - Stripe統合ガイドドキュメント作成
  - 詳細は`documents/01_project/progressReports/2025-07-01_SP購入システムStripe統合.md`参照

### 2025/07/09の変更
- **テスト失敗の修正**
  - test_create_session_saves_system_messageテストの修正
  - 初回セッションではシステムメッセージを保存しない仕様に対応
  - テストを2回目のセッション作成に変更
  - 全テスト成功（バックエンド242/242、フロントエンド28/28）

### 2025/07/08の変更
- **セッションシステム再設計の全フェーズ完了**
  - フェーズ1: セッション継続機能（SessionResult、continue API）
  - フェーズ2: GM AIによる終了判定（DramatistAgent、3段階提案）
  - フェーズ3: リザルト画面実装（Celeryタスク、フロントエンドUI）
  - フェーズ4: セッション間の継続性
    - AIによる継続ナラティブ生成（200-300文字の導入文）
    - Neo4j知識グラフ連携（NPC関係性の永続化）
    - 初回セッション特別仕様（6つの初期クエスト）
    - ストーリーアーク管理システム（複数セッション跨ぎ）
  - 詳細レポート:
    - `progressReports/2025_07_08_phase4_ai_continuation_narrative.md`
    - `progressReports/2025_07_08_phase4_neo4j_integration.md`
    - `progressReports/2025_07_08_phase4_first_session_initializer.md`
    - `progressReports/2025_07_08_phase4_story_arc_management.md`
    - `progressReports/2025_07_08_session_system_redesign_complete.md`
- **テスト・型・リントエラーの最終修正（23:30）**
  - バックエンド: 242テスト成功、型エラー0、リントエラー0
  - フロントエンド: 28テスト成功、型エラー0、リントエラー0
  - 50個の型エラーを全て解消（PromptContext、型注釈、インポート等）
  - 詳細レポート: `progressReports/2025-07-08_type_lint_errors_final_fix.md`

### 2025/06/30の変更
- 管理者用画面とAIパフォーマンス測定機能の実装
  - 管理者専用APIエンドポイント（/api/v1/admin/performance/）
  - ロールベースアクセス制御（RBAC）の実装
  - user_rolesテーブルの追加とマイグレーション
  - パフォーマンス測定ダッシュボード（統計、リアルタイム監視、テスト実行）
  - デフォルト管理者アカウントの作成（admin/Admin123456!）
  - bcrypt互換性問題の対応（4.0.1に固定）
  - 詳細は`documents/01_project/progressReports/2025-06-30_管理画面とAIパフォーマンス測定機能の実装.md`参照
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
  - SPシステムのデータモデル実装（PlayerSP、SPTransaction）
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
- user_roles
- characters
- character_stats
- skills
- game_sessions
- action_logs
- skill_logs
- player_sp
- sp_transactions
- log_fragments（記憶継承フィールド追加済み）
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
- quests（新規追加）
- sp_subscriptions
- subscription_transactions
- sp_purchases
- session_results（新規追加）
- story_arcs（新規追加）
- story_arc_milestones（新規追加）
- alembic_version

### ENUMタイプ
- skilllogtype
- sptransactiontype
- roletype
- queststatus
- questorigin
- subscriptiontype
- subscriptionstatus
- spsubscriptiontype
- sppurchasepackage

## 環境設定
- **Docker Compose**: 全サービスが正常稼働
- **ネットワーク**: gestaloka-network（172.20.0.0/16）
- **ボリューム**: 全データ永続化設定済み

## 現在の問題点（2025/07/09 10:55更新）
### テスト状況（2025-07-12更新）
- バックエンドテスト: 202/203成功（99.5%成功率）✅
  - データベース再構築後のクリーンな状態
  - 確率的テスト1件（test_high_contamination_effects）のみ失敗
  - ID型統一による整合性向上
- フロントエンドテスト: 28/28成功（100%成功率）✅
  - 全てのテストが成功
  - 型安全性確保

### リントエラー ✅ 完全解消
- バックエンド: 0個 ✅
- フロントエンド: 0個のエラー（45個のwarning - any型使用）

### 型エラー ✅ 完全解消
- バックエンド: 0個 ✅（50個から完全解消）
- フロントエンド: 0個 ✅（完全解消）

### ヘルスチェック（完全解決）
- ✅ 全13サービスがhealthy状態（100%）

### 残存する警告（エラーではない）
1. ~~Pydantic V1スタイルの警告~~ ✅ **解決済み（2025-07-05）**
   - `@validator` → `@field_validator`への移行完了
   - `from_orm()` → `model_validate()`への移行完了
   - `dict()` → `model_dump()`への移行完了
2. Neo4j/Redisセッション管理の警告
   - 明示的なclose()処理の追加推奨
3. TypeScriptのany型警告（45箇所）
   - 段階的な型定義強化が推奨

### 優先対応事項（更新）
1. ~~フロントエンドの型エラー修正~~ ✅ 完了
2. ~~バトル統合テストのモック改善~~ ✅ 完了 
3. ~~MinimapCanvasのdrawLocation初期化順序修正~~ ✅ 完了
4. ~~Pydantic V2への移行~~ ✅ **完了（2025-07-05）**
5. ~~フロントエンドテストケース更新~~ ✅ **完了（2025-07-05）**
6. パフォーマンス最適化（AI応答時間）
7. TypeScriptのany型改善（45箇所のwarning）