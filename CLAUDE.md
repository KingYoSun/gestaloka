# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリのコードを操作する際のガイダンスを提供します。

## 基本ルール

- **言語**: 必ず日本語で回答する
- **設計準拠**: documentsディレクトリ内の設計ドキュメントに従う
- **ドキュメンテーション**: 作業終了時に、作業内容に合わせてドキュメントとプロジェクトコンテキストの更新を行う
- **コミット不可**: ユーザーから明示的に要求されない限り、絶対にコミットしない

## プロジェクト概要

**ログバース (Logverse)** - マルチプレイ・テキストMMO

- LLMとグラフDB、RDBを組み合わせた動的な物語生成システム
- プレイヤーの行動履歴（ログ）が他プレイヤーの世界にNPCとして影響を与える
- 階層世界『レーシュ』を舞台にした、自由度の高い物語体験

### 技術スタック

- **フロントエンド**: TypeScript 5.8, React 19.1, Vite 6.3, shadcn/ui, zustand 5.0, TanStack Query 5.80, TanStack Router 1.121, Vitest 3.2
- **バックエンド**: Python 3.11, FastAPI 0.115, LangChain 0.3, SQLModel 0.0.24, neomodel 5.4, Celery 5.4
- **データベース**: PostgreSQL 17 (構造化データ), Neo4j 5.26 LTS (グラフデータ)
- **キャッシュ/ブローカー**: Redis 8
- **認証**: Keycloak 26.2
- **LLM**: Gemini 2.5 Pro (最新版: gemini-2.5-pro-preview-06-05)
- **インフラ**: Docker Compose, WebSocket (Socket.IO), Celery（Worker/Beat/Flower）

## 現在の動作環境

### 稼働中サービス（2025/06/15時点）
🟢 **PostgreSQL 17**: localhost:5432 - ユーザーデータ、キャラクターデータ（最新安定版）  
🟢 **Neo4j 5.26 LTS**: localhost:7474/7687 - グラフデータベース、関係性データ（長期サポート版）  
🟢 **Redis 8**: localhost:6379 - セッション、キャッシュ、Celeryブローカー（最新安定版）  
🟢 **Backend API**: localhost:8000 - FastAPI、認証API稼働中  
🟢 **Frontend**: localhost:3000 - React/Vite開発サーバー稼働中  
🟢 **Celery Worker**: Celeryタスクワーカー稼働中  
🟢 **Celery Beat**: 定期タスクスケジューラ稼働中  
🟢 **Flower**: localhost:5555 - Celery監視ツール稼働中  
🟢 **Keycloak 26.2**: localhost:8080 - 認証サーバー稼働中（最新版）  

### 実装済み機能
- ✅ ユーザー登録・ログイン（JWT認証）
- ✅ 認証保護エンドポイント
- ✅ データベースマイグレーション
- ✅ 型安全なAPIクライアント統合
- ✅ キャラクター管理（作成・一覧・詳細・状態管理）
- ✅ ゲームセッション管理（作成・更新・終了・アクション実行）
- ✅ AI統合基盤（Gemini API、プロンプト管理、エージェントシステム）
- ✅ Celeryタスク管理（Worker、Beat、Flower統合）

### 利用可能なURL
- **フロントエンド**: http://localhost:3000
- **API ドキュメント**: http://localhost:8000/docs
- **Neo4j ブラウザ**: http://localhost:7474
- **ヘルスチェック**: http://localhost:8000/health
- **Celery監視（Flower）**: http://localhost:5555
- **Keycloak管理画面**: http://localhost:8080/admin（admin/admin_password）

## 必須コマンド

### 開発
```bash
# 全サービス起動（推奨）
docker-compose up -d

# 個別サービス起動
docker-compose up -d postgres neo4j redis  # データベースのみ
docker-compose up -d backend              # バックエンドAPI
docker-compose up -d frontend             # フロントエンド

# ローカル開発（Dockerなし）
npm run dev                    # フロントエンド
uvicorn app.main:app --reload  # バックエンド
```

### テスト
```bash
# 全テスト実行（Docker経由）
make test

# フロントエンドテストを実行（Docker経由）
make test-frontend

# バックエンドテスト実行（Docker経由）
make test-backend

# Docker内で特定のテストファイルを実行
docker-compose exec backend pytest tests/test_gm_ai.py
docker-compose exec frontend npm test src/features/player/Player.test.tsx

# ローカル実行（Docker起動済みの場合のみ）
cd frontend && npm test
cd backend && pytest
```

### リント & 型チェック
```bash
# 全リント実行（Docker経由）
make lint

# 全型チェック実行（Docker経由）
make typecheck

# コードフォーマット（Docker経由）
make format

# 個別実行（Docker経由）
docker-compose exec frontend npm run typecheck
docker-compose exec frontend npm run lint
docker-compose exec backend ruff check .
docker-compose exec backend ruff format .
docker-compose exec backend mypy .
```

## アーキテクチャ概要

### システム構成

1. **認証フロー**: Keycloak → JWT → API
2. **リアルタイム通信**: WebSocket (Socket.IO)
3. **非同期処理**: Celery + Redis
4. **AI協調**: GM AI評議会（6つの専門AI）

### GM AI評議会の構成

- **脚本家AI (Dramatist)**: 物語進行とテキスト生成
- **歴史家AI (Historian)**: 世界の記録と歴史編纂
- **世界の意識AI (The World)**: マクロイベント管理
- **混沌AI (The Anomaly)**: 予測不能なイベント生成
- **NPC管理AI (NPC Manager)**: 永続的NPC生成・管理
- **状態管理AI (State Manager)**: ルールエンジンとDB管理

### データフローパターン

```
ユーザー入力 → WebSocket → FastAPI → LangChain
                                ↓
                        コンテキスト構築
                    (PostgreSQL + Neo4j)
                                ↓
                        LLM (Gemini 2.5 Pro)
                                ↓
                        物語生成・状態更新
                                ↓
                        WebSocket → クライアント
```

### データベースの役割分担

- **Keycloak**: 認証・認可情報
- **PostgreSQL**: キャラクターステータス、スキル、所持品、行動ログ、ゲームセッション
- **Neo4j**: エンティティ間の関係性（INTERACTED_WITH, LOCATED_IN等）
- **Redis**: セッション管理、キャッシュ、Celeryメッセージブローカー

### 主要なアーキテクチャ決定

1. **ポリグロットパーシステンス**: 構造化データと関係性データの分離
2. **イベントソーシング**: 全行動をイベントログとして記録
3. **AIエージェント協調**: 各AIが専門領域を持ち協調動作
4. **リアクティブアーキテクチャ**: WebSocketによる双方向通信

## ゲームメカニクス概要

### コアサイクル

1. **キャラクター作成**: 名前、外見、性格、初期スキル設定
2. **物語進行**: GM AIによる状況生成、自由記述での行動入力
3. **ログ記録**: 全行動がタイムスタンプ付きでDB記録
4. **ログNPC化**: 関連性の高いログが他世界でNPCとして登場
5. **交流と変容**: プレイヤー、ログNPC、永続NPCとの相互作用

### ハイブリッド行動システム

- AIによる3つの選択肢提示
- 自由なテキスト入力（第四の選択肢）
- 環境を利用した創造的な行動

### ログ生成メカニクス

- **ログの欠片収集**: 重要な行動や経験が「欠片」として記録
- **ログ編纂**: 欠片を組み合わせて完成ログ（NPC）を創造
- **ログ契約**: 作成したログを他プレイヤーの世界へ送出

## 一般的な開発タスク

### 新機能の追加手順

1. 設計ドキュメントで世界観・メカニクスとの整合性確認
2. 該当するAIエージェントの責務範囲を確認
3. フロントエンド/バックエンドの両面から実装
4. テストの作成と実行
5. リント・型チェックの実行

### AIエージェント実装時の注意

- 各AIの役割を明確に分離
- プロンプトエンジニアリングはLangChainで管理
- AI間の情報伝達はデータベース経由で行う
- **Gemini API統合時は必ずgemini_api_specification.mdを参照**

### データベース操作時の注意

- PostgreSQL: トランザクション管理に注意
- Neo4j: 関係性の作成時は必ず双方向性を考慮
- 両DBの整合性を保つため、更新は同一トランザクション内で

### マイグレーション
```bash
# データベースマイグレーション実行（Docker経由）
make db-migrate

# Docker内で直接実行
docker-compose exec backend alembic upgrade head

# マイグレーションファイル作成（Docker経由）
docker-compose exec backend alembic revision --autogenerate -m "migration message"
```

## ドキュメント使用法

`documents/`ディレクトリには重要な設計ドキュメントが含まれています：

### 必読ドキュメント

#### 基本設計
- **design_doc.md**: システム全体の設計仕様
  - GM AI評議会の構成と役割
  - 技術スタックの選定理由
  - データフローとアーキテクチャ
  - リスクと対策

#### 世界観設定
- **world_design.md**: 階層世界『レーシュ』の設定
  - 世界の根源的な設定（真実）
  - スキルとエネルギーシステム
  - 主要勢力と地域
  - 世界のテーマ『フェイディング』

#### ゲームメカニクス
- **game_mechanics/basic.md**: 基本システム
  - ハイブリッド行動システム
  - キャラクターコンソール
  - 成長システムと経済活動
  - 戦闘システム

- **game_mechanics/log.md**: ログ生成メカニクス
  - ログの欠片システム
  - ログ編纂プロセス
  - ログ汚染と浄化
  - ログ契約とマーケット

#### プロジェクトコンテキスト
- **projectbrief.md**: MVP要件と実装フェーズ
- **systemPatterns.md**: アーキテクチャパターンとデータフロー図
- **techContext.md**: 技術的決定と実装詳細
- **activeContext.md**: 現在の開発状況とアクティブなタスク
- **progress.md**: 開発進捗追跡
- **productContext.md**: プロダクトビジョンとユーザーエクスペリエンス目標

#### AI統合
- **gemini_api_specification.md**: Gemini API仕様とLangChain統合ガイド
  - API料金体系とレート制限
  - LangChain統合の実装方法
  - エラーハンドリングとリトライ戦略
  - ログバース特有の考慮事項

#### GM AI仕様
- **gm_ai_spec/**: 各GM AIエージェントの詳細仕様
  - **dramatist.md**: 脚本家AI - 物語生成とテキスト創作
  - **historian.md**: 歴史家AI - 世界の記録と歴史編纂
  - **npc_manager.md**: NPC管理AI - キャラクター生成と管理
  - **state_manager.md**: 状態管理AI - ルールエンジンとDB管理
  - **the_world.md**: 世界の意識AI - マクロイベント管理（未実装）

#### 開発サポート
- **characterManagementSummary.md**: キャラクター管理システムの実装概要
- **troubleshooting.md**: トラブルシューティングガイド
- **test_play_reports/**: テストプレイからの知見

### ドキュメント参照の原則

1. **実装前の確認事項**
   - 世界観との整合性（world_design.md）
   - システム設計との整合性（design_doc.md）
   - ゲームメカニクスとの整合性（game_mechanics/）

2. **AI実装時**
   - 各AIの役割定義を厳守（design_doc.md セクション2.2）
   - 対応するGM AI仕様を確認（gm_ai_spec/）
   - AI間の協調動作プロトコルを遵守
   - Gemini API統合仕様を必ず確認（gemini_api_specification.md）

3. **新機能追加時**
   - 既存のゲームメカニクスとの相互作用を考慮
   - プレイヤーの自由度を制限しない設計

### プロジェクトコンテキストを参照するタイミング
1. **新機能実装前**: MVP目標との整合性についてprojectbrief.mdを確認
2. **アーキテクチャ決定**: 確立されたパターンについてsystemPatterns.mdを参照
3. **データフロー実装**: systemPatterns.mdで文書化されたパターンに従う
4. **技術的選択**: 技術選択の根拠についてtechContext.mdを参照

### プロジェクトコンテキストガイドライン
- systemPatterns.mdで確立されたパターンに常に従う
- 新機能がprojectbrief.mdのMVPスコープと整合することを確認
- 重要なマイルストーン完了時にprogress.mdを更新
- 現在の開発優先事項についてactiveContext.mdを参照

### 重要な設計思想

- **プレイヤーファースト**: 制限より可能性を重視
- **物語の動的生成**: 固定シナリオではなく創発的な物語
- **ログによる永続性**: プレイヤーの行動が世界に残る
- **AI協調**: 単一AIではなく専門AIの協調による豊かな体験