# 現在の開発環境状況 - ゲスタロカ (GESTALOKA)

## 最終更新: 2025-06-18

## 稼働中のサービス（localhost）
🟢 **PostgreSQL 17**: ポート5432 - ユーザーデータ、キャラクターデータ（最新安定版）  
🟢 **Neo4j 5.26 LTS**: ポート7474/7687 - グラフデータベース、関係性データ（長期サポート版）  
🟢 **Redis 8**: ポート6379 - セッション、キャッシュ、Celeryブローカー（最新安定版）  
🟢 **Backend API**: ポート8000 - FastAPI、認証API稼働中  
🟢 **Frontend**: ポート3000 - React/Vite開発サーバー稼働中  
🟢 **Celery Worker**: Celeryタスクワーカー稼働中  
🟢 **Celery Beat**: 定期タスクスケジューラ稼働中  
🟢 **Flower**: ポート5555 - Celery監視ツール稼働中  
🟢 **Keycloak 26.2**: ポート8080 - 認証サーバー稼働中（最新版）  

## 実装済み機能
- ✅ ユーザー登録・ログイン（JWT認証、パスワード強度検証）
- ✅ 認証保護エンドポイント
- ✅ データベースマイグレーション（Alembic + SQLModel統合）
- ✅ 型安全なAPIクライアント統合
- ✅ キャラクター管理（作成・一覧・詳細・状態管理）
- ✅ ゲームセッション管理（作成・更新・終了・アクション実行）
- ✅ AI統合基盤（Gemini API、プロンプト管理、エージェントシステム）
  - ✅ 脚本家AI (Dramatist) - 物語生成と選択肢提示
  - ✅ 状態管理AI (State Manager) - ルール判定とパラメータ管理
  - ✅ 歴史家AI (Historian) - 行動記録と歴史編纂
  - ✅ NPC管理AI (NPC Manager) - 永続的NPC生成・管理
  - ✅ 世界の意識AI (The World) - マクロイベント管理
  - ✅ 混沌AI (The Anomaly) - 予測不能イベント生成
- ✅ AI協調動作プロトコル（CoordinatorAI、SharedContext、イベント連鎖）
- ✅ Celeryタスク管理（Worker、Beat、Flower統合）
- ✅ 基本的な戦闘システム（ターン制バトル、戦闘UI、リアルタイム更新）
- ✅ ログシステム基盤（LogFragment、CompletedLog、LogContract）
- ✅ WebSocketリアルタイム通信（Socket.IO、イベントドリブン）
- ✅ コード品質管理（ruff、mypy、ESLint、型チェック）

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

## 最近の変更（2025-06-18）
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
- log_fragments（新規）
- completed_logs（新規）
- completed_log_sub_fragments（新規）
- log_contracts（新規）
- alembic_version

### ENUMタイプ
- logfragmentrarity
- emotionalvalence
- completedlogstatus
- logcontractstatus

## 環境設定
- **Docker Compose**: 全サービス正常稼働
- **ネットワーク**: gestaloka-network（172.20.0.0/16）
- **ボリューム**: 全データ永続化設定済み