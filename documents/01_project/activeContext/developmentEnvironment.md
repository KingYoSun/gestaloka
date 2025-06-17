# 開発環境 - ログバース (Logverse)

このファイルには、現在の開発環境、稼働中サービス、実装済み機能の情報が記載されています。

## 現在の動作環境

### 稼働中サービス（localhost）
🟢 **PostgreSQL 17**: ポート5432 - ユーザーデータ、キャラクターデータ  
🟢 **Neo4j 5.26 LTS**: ポート7474/7687 - グラフデータベース、関係性データ  
🟢 **Redis 8**: ポート6379 - セッション、キャッシュ、Celeryブローカー  
🟢 **Backend API**: ポート8000 - FastAPI、認証API稼働中  
🟢 **Frontend**: ポート3000 - React/Vite開発サーバー稼働中  
🟢 **Celery Worker**: Celeryタスクワーカー稼働中  
🟢 **Celery Beat**: 定期タスクスケジューラ稼働中  
🟢 **Flower**: ポート5555 - Celery監視ツール稼働中  
🟢 **Keycloak 26.2**: ポート8080 - 認証サーバー稼働中  

### 実装済み機能
- ✅ ユーザー登録・ログイン（JWT認証、パスワード強度検証）
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
- ✅ WebSocketリアルタイム通信（Socket.IO、イベントドリブン）
- ✅ 型安全なAPIクライアント（TypeScript + Pydantic）
- ✅ コード品質管理（ruff、mypy、ESLint、型チェック）

### 利用可能なURL
- **フロントエンド**: http://localhost:3000
- **API ドキュメント**: http://localhost:8000/docs
- **Neo4j ブラウザ**: http://localhost:7474
- **ヘルスチェック**: http://localhost:8000/health
- **Celery Flower**: http://localhost:5555
- **Keycloak**: http://localhost:8080

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
- LangChain 0.3
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
- Gemini 2.5 Pro (最新版: gemini-2.5-pro-preview-06-05)

### インフラ
- Docker Compose
- WebSocket (Socket.IO)
- Celery（Worker/Beat/Flower）