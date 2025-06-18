# 現在の開発環境状況

## 最終更新: 2025-06-18

### 稼働中のサービス
- ✅ PostgreSQL 17（localhost:5432）
- ✅ Neo4j 5.26 LTS（localhost:7474/7687）
- ✅ Redis 8（localhost:6379）
- ✅ Backend API（localhost:8000）
- ✅ Frontend（localhost:3000）
- ✅ Celery Worker
- ✅ Celery Beat
- ✅ Flower（localhost:5555）
- ✅ Keycloak 26.2（localhost:8080）

### 最近の変更
- ログシステムの基盤実装完了（LogFragment、CompletedLog、LogContract）
- データベーステーブルの追加（log_fragments、completed_logs、log_contracts等）
- APIエンドポイントの拡充（/api/v1/logs/*）
- テストカバレッジの向上（全178テストがパス）
- Gemini 2.5 Pro安定版への移行完了
- 依存ライブラリの更新（langchain 0.3.25、langchain-google-genai 2.1.5）
- プロジェクト名をTextMMOからGESTALOKAに統一
- コード品質の完全クリーン化（リント、型チェック0エラー）

### データベース状態
- PostgreSQLテーブル：
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

- ENUMタイプ：
  - logfragmentrarity
  - emotionalvalence
  - completedlogstatus
  - logcontractstatus

### 環境設定
- Docker Compose: 全サービス正常稼働
- ネットワーク: gestaloka-network（172.20.0.0/16）
- ボリューム: 全データ永続化設定済み