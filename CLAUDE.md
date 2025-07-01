# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリのコードを操作する際のガイダンスを提供します。

## 基本ルール

- **言語**: 必ず日本語で回答する
- **設計準拠**: documentsディレクトリ内の設計ドキュメントに従う
- **ドキュメンテーション**: 作業終了時に、作業内容に合わせてドキュメントとプロジェクトコンテキストの更新を行う
- **コミット不可**: ユーザーから明示的に要求されない限り、絶対にコミットしない
- **日付の正確性**: ドキュメント作成時は必ず`date`コマンドを実行して今日の日付を確認し、正しい日付を使用する

## 重複実装防止ルール

### 型定義の重複防止
- **API型定義**: バックエンドのPydanticモデルを唯一の真実の源とする
- **自動生成の活用**: `frontend/src/api/generated/`の自動生成型を使用する
- **手動型定義の禁止**: APIレスポンスの型を手動で定義しない

### バリデーションの重複防止
- **バックエンド優先**: バリデーションルールはバックエンドで定義
- **フロントエンド実装**: `/api/v1/config/game/validation-rules`から取得したルールを使用
- **Zodスキーマ**: フロントエンドではZodを使用し、バックエンドのルールと同期

### ビジネスロジックの重複防止
- **設定値のAPI化**: ゲーム設定値は`/api/v1/config/game`から取得
- **権限チェック**: `app.api.deps`の共通関数を使用
- **計算ロジック**: 複雑な計算はバックエンドAPIとして実装

### 実装時のチェックリスト
- [ ] 同じデータ構造を表す型が複数箇所に存在しないか確認
- [ ] バリデーションロジックが重複していないか確認
- [ ] ハードコーディングされた設定値がないか確認
- [ ] 権限チェックが`app.api.deps`を使用しているか確認
- [ ] フロントエンドで共通コンポーネント/フックを活用しているか確認
- [ ] 同じUIパターンが複数箇所に存在しないか確認

## ドキュメンテーションルール

### ファイル構成の原則
- **重複禁止**: 同じ目的・内容のファイルは作成しない。既存ファイルを更新する
- **サイズ制限**: 1ファイル500行を超える場合は、論理的な単位で分割を検討
- **命名規則**: 
  - 既存ファイル: 現在の命名パターン（アンダースコア使用）を維持
  - 新規ファイル: 同じディレクトリ内の既存ファイルと一貫性を保つ
  - 日付付きファイル: `YYYY-MM-DD_description.md` 形式を使用
- **実装コード省略**: 詳細な実装コードは省略し、内容をテキストで記述するに留める

### 作業履歴の管理
- **CLAUDE.md**: 作業ルールとプロジェクト概要のみ記載。詳細な作業履歴は記載しない
- **作業履歴の保存先**:
  - 進捗レポート: `documents/01_project/progressReports/YYYY-MM-DD_作業概要.md`
  - 最近の作業: `documents/01_project/activeContext/recentWork.md`
  - 完了タスク: `documents/01_project/activeContext/completedTasks.md`
- **日付の記載方法**:
  - 必ず`date`コマンドを実行して今日の日付を確認してから記載
  - 確認コマンド: `date +%Y-%m-%d`（YYYY-MM-DD形式）または`date`（詳細情報）
  - 記載フォーマット: `YYYY/MM/DD` または `YYYY年M月D日`
  - 例: `date +%Y-%m-%d`で「2025-06-29」が返された場合は「2025/06/29」または「2025年6月29日」と記載

### ドキュメント更新時の注意
1. **現在の環境情報**: `documents/01_project/activeContext/current_environment.md` に集約
2. **既知の問題**: `documents/01_project/activeContext/issuesAndNotes.md` に集約
3. **プロジェクトルートのREADME.md**: 常に最新のドキュメント内容と同期させる
4. **重複コンテンツの排除**: 同じ情報を複数箇所に記載しない。参照リンクを使用
5. **README.mdには開発状況・更新履歴を含まない**: 作業内容をドキュメントに反映する場合でも、開発状況・更新履歴はREADME.mdには含まず、進捗レポートに記載

### ドキュメント階層
```
documents/
├── SUMMARY.md              # 全体概要（1-2ページ）
├── 01_project/            # プロジェクト管理
│   ├── activeContext/     # 現在の状況
│   └── progressReports/   # 作業履歴
├── 02_architecture/       # 設計・技術
├── 03_worldbuilding/      # ゲーム世界観
├── 04_ai_agents/          # AI仕様
├── 05_implementation/     # 実装ガイド
└── 06_reports/           # テストレポート
```

### 作業完了時のチェックリスト
- [ ] 関連ドキュメントの更新
- [ ] 重複ファイルの確認・統合
- [ ] 500行超えファイルの分割検討
- [ ] プロジェクトルートREADME.mdの同期
- [ ] 進捗レポートの作成（重要な変更時）
- [ ] 重複実装がないか最終確認
- [ ] 日付が正しく記載されているか確認（`date`コマンドで取得した日付と一致）

## プロジェクト概要

**ゲスタロカ (GESTALOKA)** - マルチプレイ・テキストMMO

- LLMとグラフDB、RDBを組み合わせた動的な物語生成システム
- プレイヤーの行動履歴（ログ）が他プレイヤーの世界にNPCとして影響を与える
- 階層世界『ゲスタロカ』を舞台にした、自由度の高い物語体験

### 技術スタック

- **フロントエンド**: TypeScript 5.8, React 19.1, Vite 6.3, shadcn/ui, zustand 5.0, TanStack Query 5.80, TanStack Router 1.121, Vitest 3.2
- **バックエンド**: Python 3.11, FastAPI 0.115, LangChain 0.3, SQLModel 0.0.24, neomodel 5.4, Celery 5.4
- **データベース**: PostgreSQL 17 (構造化データ), Neo4j 5.26 LTS (グラフデータ)
- **キャッシュ/ブローカー**: Redis 8
- **認証**: Keycloak 26.2
- **LLM**: Gemini 2.5 Pro (安定版: gemini-2.5-pro)
- **インフラ**: Docker Compose, WebSocket (Socket.IO), Celery（Worker/Beat/Flower）

## 現在の環境

詳細は `documents/01_project/activeContext/current_environment.md` を参照してください。

## 最近の重要な更新（2025/07/01）

- **langchain-google-genai 2.1.6**: 温度範囲0.0-2.0、top_p/top_k対応
- **AIレスポンスキャッシュ**: APIコスト20-30%削減
- **バッチ処理最適化**: 最大10並列、自動リトライ
- **フロントエンドテスト**: 100%成功率達成（MSW導入）

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
# 全テスト実行（Docker経由、PostgreSQL使用）
make test

# テスト用データベースセットアップ
make test-db-setup

# バックエンドテスト実行（Docker経由、PostgreSQL使用）
make test-backend
docker-compose exec -T backend sh -c "DOCKER_ENV=true pytest -v"

# フロントエンドテストを実行（Docker経由）
make test-frontend

# Docker内で特定のテストファイルを実行
docker-compose exec -T backend sh -c "DOCKER_ENV=true pytest tests/test_battle_integration_postgres.py -xvs"
docker-compose exec frontend npm test src/features/player/Player.test.tsx

# ローカル実行（Docker起動済みの場合のみ）
cd frontend && npm test
cd backend && DOCKER_ENV=true pytest
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
- **PostgreSQL**: キャラクターステータス、スキル、所持品、行動ログ、ゲームセッション、ログシステム
- **Neo4j**: エンティティ間の関係性（INTERACTED_WITH, LOCATED_IN等）、NPCエンティティ
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
- **ログ派遣**: 編纂したログを独立NPCとして世界へ送り出す（SP消費）

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
- **スキーマ管理**: 全ての環境でAlembicを使用して統一的に管理
- **Neo4jモデル**: neomodelを使用したオブジェクトマッピング

### マイグレーション（必須手順）
```bash
# マイグレーション作成手順（必ずこの順序で実行）
# 1. モデルを変更/追加
# 2. alembic/env.pyに新しいモデルをインポート（重要！）
# 3. 自動生成（手動作成は禁止）
docker-compose exec -T backend alembic revision --autogenerate -m "migration message"
# 4. 生成されたファイルを確認
# 5. マイグレーション適用
docker-compose exec -T backend alembic upgrade head

# データベースマイグレーション実行（Docker経由）
make db-migrate

# マイグレーション履歴確認
docker-compose exec -T backend alembic current

# マイグレーションをロールバック
docker-compose exec -T backend alembic downgrade -1

# 重要なルール：
# - 手動マイグレーションファイル作成は禁止
# - 必ず--autogenerateを使用して自動生成
# - 新しいモデルはalembic/env.pyに必ずインポート
# - docker-compose runではなくdocker-compose exec -Tを使用
# - SQLModel.metadata.create_all()は使用しない（Alembic統一管理のため）
```

## ドキュメント使用法

### 段階的読み込み戦略

`documents/`ディレクトリは段階的読み込みに最適化された構造になっています：

1. **初回読み込み**
   - `documents/SUMMARY.md` - プロジェクト全体の概要（1-2ページ）
   - 作業に関連するディレクトリの `summary.md`

2. **詳細が必要な場合**
   - 具体的な実装時：該当する詳細ドキュメント
   - 例：AI実装時は `04_ai_agents/gm_ai_spec/` の該当ファイル

3. **参照優先順位**
   - レベル1: SUMMARY.md（全体把握）
   - レベル2: 各ディレクトリのsummary.md（カテゴリー把握）
   - レベル3: 詳細ドキュメント（実装時）

### ドキュメント構成

#### [01_project/](documents/01_project/summary.md) - プロジェクト管理
- **projectbrief.md**: MVP要件と実装フェーズ
- **progressReports/**: 開発進捗追跡（週次レポート、マイルストーン、振り返り）
- **activeContext/**: 現在の状況（タスク、環境、問題と注意事項）

#### [02_architecture/](documents/02_architecture/summary.md) - アーキテクチャ
- **design_doc.md**: システム全体の設計仕様
- **systemPatterns.md**: アーキテクチャパターン
- **techDecisions/**: 技術的決定（スタック、実装パターン、開発・本番ガイド、Alembic統合）
- **api/**: API仕様（Gemini、AI協調プロトコル）

#### [03_worldbuilding/](documents/03_worldbuilding/summary.md) - 世界観
- **world_design.md**: 階層世界『ゲスタロカ』の設定
- **game_mechanics/**: ゲームメカニクス（基本、ログシステム）

#### [04_ai_agents/](documents/04_ai_agents/summary.md) - AIエージェント
- **gm_ai_spec/**: 各GM AIエージェントの詳細仕様
  - dramatist.md（脚本家）、state_manager.md（状態管理）
  - historian.md（歴史家）、npc_manager.md（NPC管理）
  - the_world.md（世界の意識）、anomaly.md（混沌）

#### [05_implementation/](documents/05_implementation/summary.md) - 実装ガイド
- **characterManagementSummary.md**: キャラクター管理の実装
- **battleSystemImplementation.md**: 戦闘システムの実装ガイド
- **testingStrategy.md**: テスト戦略とNeo4j統合テスト環境
- **productContext.md**: プロダクトビジョン
- **troubleshooting.md**: トラブルシューティング

#### [06_reports/](documents/06_reports/summary.md) - レポート
- **test_play_reports/**: テストプレイからの知見

### ドキュメント参照の原則

1. **新機能実装時の確認フロー**
   - `01_project/summary.md` → MVP要件の確認
   - `03_worldbuilding/summary.md` → 世界観との整合性
   - `02_architecture/summary.md` → 技術パターンの確認
   - 必要に応じて詳細ドキュメントを参照

2. **AI実装時の確認フロー**
   - `04_ai_agents/summary.md` → GM AI評議会の概要
   - `02_architecture/api/gemini_api_specification.md` → API仕様
   - 該当するAIの詳細仕様（`gm_ai_spec/`内）

3. **トラブルシューティング**
   - `05_implementation/troubleshooting.md` → 既知の問題
   - `05_implementation/summary.md` → 実装概要

### 重要な設計思想

- **プレイヤーファースト**: 制限より可能性を重視
- **物語の動的生成**: 固定シナリオではなく創発的な物語
- **ログによる永続性**: プレイヤーの行動が世界に残る
- **AI協調**: 単一AIではなく専門AIの協調による豊かな体験

## 詳細情報の参照先

- **現在の環境**: `documents/01_project/activeContext/current_environment.md`
- **既知の問題**: `documents/01_project/activeContext/issuesAndNotes.md`
- **開発進捗**: `documents/01_project/progressReports/`