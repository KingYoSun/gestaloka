# ゲスタロカ (GESTALOKA)

**階層世界『ゲスタロカ』で紡がれる、あなただけの物語**

マルチプレイ・テキストMMO - LLMとグラフDB、RDBを組み合わせた動的な物語生成システム

## 🌟 プロジェクト概要

ゲスタロカは、プレイヤーが編纂した「ログ」が独立したNPCとして世界を旅し、他プレイヤーの物語に影響を与える革新的なテキストベースMMOです。

### 🎭 設計思想
- **プレイヤーファースト**: 制限より可能性を重視
- **物語の動的生成**: 固定シナリオではなく創発的な物語
- **ログによる永続性**: プレイヤーの行動が世界に残る
- **AI協調**: 単一AIではなく専門AIの協調による豊かな体験

### 🎯 特徴

- **🤖 GM AI評議会**: 6つの専門AIが協調してリアルタイムで物語を生成
- **📚 ログシステム**: プレイヤーが創造した「ログ」が独立したNPCとして世界を旅する
- **💰 SPシステム**: 「世界への干渉力」を表すリソース管理
- **🌐 階層世界**: 『ゲスタロカ』の多層的な世界観
- **🔄 動的な物語**: 固定シナリオではなく創発的なストーリー展開
- **⚡ リアルタイム**: WebSocketによる即座な世界変化

## 🚀 クイックスタート

### 前提条件

- **Docker & Docker Compose** (必須)
- **Node.js 18+** (ローカル開発用)
- **Python 3.11+** (ローカル開発用)
- **Git**

### ⚡ ワンコマンド起動

```bash
# 1. リポジトリクローン
git clone <repository-url>
cd gestaloka

# 2. 完全自動セットアップ
make setup-dev
```

これだけで全ての開発環境が自動構築されます！

### 🔑 手動セットアップ（詳細制御が必要な場合）

```bash
# 初期設定
make setup

# 環境変数設定（重要！）
cp .env.example .env
# .envファイルでGEMINI_API_KEYを設定

# 開発環境起動
make dev-full

# データベース初期化
make init-db
```

### 🌐 アクセスURL

| サービス | URL | 説明 |
|---------|-----|------|
| **🎮 ゲーム** | http://localhost:3000 | プレイヤー向けフロントエンド |
| **📡 API** | http://localhost:8000 | バックエンドAPI |
| **📖 API Docs** | http://localhost:8000/docs | Swagger UI |
| **🔐 認証管理** | http://localhost:8080/admin | Keycloak (admin/admin_password) |
| **🕸️ グラフDB** | http://localhost:7474 | Neo4j Browser (neo4j/gestaloka_neo4j_password) |
| **📊 タスク監視** | http://localhost:5555 | Celery Flower |

## 🛠️ 技術スタック

### 🎨 フロントエンド
| 技術 | バージョン | 用途 |
|------|-----------|------|
| **React** | 19.1.0 | UIライブラリ |
| **TypeScript** | 5.8.3 | 型安全性 |
| **Vite** | 6.3.5 | 高速ビルドツール |
| **shadcn/ui** | latest | UIコンポーネント（TailwindCSS v4） |
| **Zustand** | 5.0.5 | 軽量状態管理 |
| **TanStack Query** | 5.80.7 | サーバー状態管理 |
| **TanStack Router** | 1.121.12 | 型安全ルーティング |
| **Socket.IO Client** | 4.8.1 | リアルタイム通信 |
| **framer-motion** | 12.19.2 | アニメーションライブラリ |

### ⚙️ バックエンド
| 技術 | バージョン | 用途 |
|------|-----------|------|
| **FastAPI** | 0.115.6 | 高性能Webフレームワーク |
| **Python** | 3.11 | プログラミング言語 |
| **SQLModel** | 0.0.24 | タイプセーフORM |
| **Alembic** | 1.15.2 | データベースマイグレーション |
| **Socket.IO** | 5.12.1 | WebSocketサーバー |
| **neomodel** | 5.4.1 | Neo4j OGM |
| **LangChain** | 0.3.25 | LLM統合フレームワーク |
| **langchain-google-genai** | 2.1.5 | Gemini API統合 |
| **Celery** | 5.4.0 | 非同期タスクキュー |
| **structlog** | 25.4.0 | 構造化ログ |

### 🗄️ データベース・インフラ
| 技術 | バージョン | 用途 |
|------|-----------|------|
| **PostgreSQL** | 17-alpine | メイン構造化データベース（最新安定版） |
| **Neo4j** | 5.26-community | グラフデータベース（LTS版） |
| **Redis** | 8-alpine | キャッシュ・メッセージブローカー（最新安定版） |
| **Keycloak** | 26.2 | 認証・認可（最新版） |
| **Docker Compose** | - | 統合開発環境 |

### 🤖 AI・LLM
| 技術 | 用途 |
|------|------|
| **Gemini 2.5 Pro** | メイン言語モデル（gemini-2.5-pro） |
| **GM AI評議会** | 6つの専門AIエージェント |
| - Dramatist | 物語生成・脚本（実装済み） |
| - Historian | 世界記録・歴史管理（実装済み） |
| - The World | マクロイベント管理（実装済み） |
| - The Anomaly | 予測不能要素生成（実装済み） |
| - NPC Manager | キャラクター管理（実装済み） |
| - State Manager | ルール・状態管理（実装済み） |

## 🔧 開発コマンド

完全自動化されたMakefileコマンド体系で、ワンコマンドで全ての操作が可能です。

### ✅ コード品質チェック（2025/06/30 更新）
```bash
make test         # 🧪 全テスト実行（PostgreSQL使用）
make test-backend # 🐍 バックエンドテスト（82/83件成功）
make test-frontend # ⚛️ フロントエンドテスト（21件成功）
make test-db-setup # 🗄️ テストDB初期化（gestaloka_test作成）
make typecheck    # 📝 型チェック
make lint         # 🔍 リントチェック
make format       # 📐 コード自動整形
```

### 🚀 環境管理
```bash
make setup-dev    # 🎯 完全自動セットアップ（初回推奨）
make dev          # 🐳 開発環境起動（DB+KeyCloak）
make dev-full     # 🌐 完全な開発環境起動
make up           # ⬆️  全サービス起動
make down         # ⬇️  全サービス停止
make restart      # 🔄 再起動
make status       # 📊 サービス状況確認
make health       # ❤️  ヘルスチェック
```

### 📋 ログ確認
```bash
make logs         # 📄 全ログ表示
make logs-backend # 🐍 バックエンドログ
make logs-frontend # ⚛️  フロントエンドログ
make logs-celery  # 🌿 Celeryログ
```

### 🗄️ データベース操作
```bash
make init-db      # 🔥 データベース初期化（初回必須）
make db-reset     # 💣 データベース完全リセット
make db-migrate   # 🔄 マイグレーション実行
make db-shell-postgres  # 🐘 PostgreSQLシェル
make db-shell-neo4j     # 🕸️  Neo4jシェル

# Alembicマイグレーション管理
docker-compose run --rm backend alembic revision --autogenerate -m "説明"
docker-compose run --rm backend alembic upgrade head
docker-compose run --rm backend alembic current
```

### 🧪 テスト・品質管理
```bash
make test         # ✅ 全テスト実行（Docker経由） - 246件全パス
make test-backend # 🐍 バックエンドテスト（Docker経由） - 225件
make test-frontend # ⚛️  フロントエンドテスト（Docker経由） - 21件
make lint         # 🧹 リント実行（Docker経由） - エラー0件
make format       # 💅 コードフォーマット（Docker経由）
make typecheck    # 🔍 型チェック（Docker経由） - バックエンド0件、フロントエンド0件
```

### 📊 モニタリング・管理
```bash
make flower       # 🌸 Celery監視ダッシュボード
make keycloak     # 🔐 KeyCloak管理画面
make neo4j-browser # 🌐 Neo4jブラウザ
make urls         # 🔗 重要URL一覧表示
make clean        # 🧹 不要リソース削除
```

### 🔧 ユーティリティ
```bash
make help         # ❓ ヘルプ表示
make shell-backend  # 🐚 バックエンドコンテナシェル
make shell-frontend # 🐚 フロントエンドコンテナシェル

# 直接Docker経由でコマンド実行
docker-compose exec backend pytest tests/test_file.py
docker-compose exec frontend npm run test:watch
docker-compose exec backend alembic upgrade head
```

## 📁 プロジェクト構造

```
gestaloka/
├── 📁 backend/                   # 🐍 FastAPIバックエンド
│   ├── 📁 app/                  # メインアプリケーション
│   │   ├── 📁 api/              # APIエンドポイント（SP API含む）
│   │   ├── 📁 core/             # コア機能（設定・セキュリティ・エラーハンドリング）
│   │   ├── 📁 models/           # データベースモデル（SPモデル含む）
│   │   ├── 📁 schemas/          # Pydanticスキーマ（戦闘・ログ・SP含む）
│   │   ├── 📁 services/         # ビジネスロジック（戦闘・ログ・SPサービス含む）
│   │   ├── 📁 ai/               # AIエージェント統合
│   │   ├── 📁 db/               # データベース接続（Neo4jモデル含む）
│   │   ├── 📁 utils/            # 共通ユーティリティ（バリデーション・権限チェック）
│   │   ├── 📁 websocket/        # WebSocketハンドラー
│   │   └── 📁 tasks/            # Celeryタスク（ログタスク含む）
│   ├── 📁 alembic/              # データベースマイグレーション
│   ├── 📁 tests/                # テストコード
│   ├── 🐳 Dockerfile            # バックエンドDocker設定
│   └── 📄 requirements.txt      # Python依存関係
├── 📁 frontend/                  # ⚛️ Reactフロントエンド
│   ├── 📁 src/                  # ソースコード
│   │   ├── 📁 components/       # Reactコンポーネント（SPコンポーネント含む）
│   │   ├── 📁 features/         # 機能別モジュール（戦闘・SP管理含む）
│   │   ├── 📁 hooks/            # カスタムフック（SPフック含む）
│   │   ├── 📁 services/         # API通信・WebSocket
│   │   └── 📁 stores/           # Zustand状態管理
│   ├── 📁 public/               # 静的ファイル
│   ├── 🐳 Dockerfile            # フロントエンドDocker設定
│   └── 📄 package.json          # Node.js依存関係
├── 📁 documents/                 # 📚 設計ドキュメント
│   ├── 📄 SUMMARY.md            # プロジェクト全体サマリー
│   ├── 📄 README.md             # ドキュメントガイド
│   ├── 📁 01_project/           # プロジェクト管理
│   │   ├── 📁 activeContext/    # 現在の開発状況
│   │   ├── 📁 progressReports/  # 進捗レポート
│   │   ├── 📄 projectbrief.md   # MVP要件と実装フェーズ
│   │   └── 📄 implementationRoadmap.md # 実装ロードマップ
│   ├── 📁 02_architecture/      # システム設計
│   │   ├── 📁 techDecisions/    # 技術的決定（Alembic統合含む）
│   │   ├── 📁 api/              # API仕様（AI協調プロトコル含む）
│   │   └── 📁 frontend/         # フロントエンドアーキテクチャ
│   ├── 📁 03_worldbuilding/     # 世界観・ゲーム設定
│   │   └── 📁 game_mechanics/   # ゲームメカニクス（SP・ログ派遣含む）
│   ├── 📁 04_ai_agents/         # AIエージェント仕様
│   │   └── 📁 gm_ai_spec/       # GM AI詳細（6エージェント）
│   ├── 📁 05_implementation/    # 実装ガイド
│   │   ├── 📄 spSystemImplementation.md # SPシステム実装詳細
│   │   ├── 📄 bestPractices.md  # ベストプラクティス
│   │   └── 📄 troubleshooting.md # トラブルシューティング
│   └── 📁 06_reports/           # テストレポート
├── 📁 tests/                     # 📝 E2Eテスト仕様
│   └── 📁 e2e/                  # E2Eテストケース定義
├── 📁 sql/                      # 🗄️ データベース初期化
├── 📁 neo4j/                    # 🕸️ Neo4j初期化スクリプト
├── 📁 keycloak/                 # 🔐 KeyCloak設定
├── 📁 scripts/                  # 🔧 自動化スクリプト
├── 🐳 docker-compose.yml        # Docker Compose設定
├── 🛠️ Makefile                 # 開発用コマンド
├── 📋 .env.example              # 環境変数テンプレート
└── 🤖 CLAUDE.md                # AI開発ガイド
```

## 🤖 AI開発について

このプロジェクトは**Claude Code**を使用して開発されています。

### 🎯 開発方針
- **🤖 CLAUDE.md**: AI開発時のガイドライン・ルール
- **📚 documents/**: 包括的な設計ドキュメント群
- **🧠 GM AI評議会**: 6つの専門AIが協調動作

### 🔗 重要なドキュメント

#### 📊 概要・現状
| ドキュメント | 内容 |
|-------------|------|
| [`documents/SUMMARY.md`](documents/SUMMARY.md) | プロジェクト全体の概要（1ページ） |
| [`documents/01_project/activeContext/`](documents/01_project/activeContext/) | 現在の開発状況・タスク |
| [`documents/01_project/progressReports/`](documents/01_project/progressReports/) | 進捗レポート・マイルストーン |

#### 🏗️ 設計・仕様
| ドキュメント | 内容 |
|-------------|------|
| [`documents/01_project/projectbrief.md`](documents/01_project/projectbrief.md) | MVP要件と実装フェーズ |
| [`documents/02_architecture/design_doc.md`](documents/02_architecture/design_doc.md) | システム全体設計 |
| [`documents/02_architecture/systemPatterns.md`](documents/02_architecture/systemPatterns.md) | アーキテクチャパターン |
| [`documents/02_architecture/techDecisions/`](documents/02_architecture/techDecisions/) | 技術スタック・実装パターン |

#### 🎮 ゲーム・世界観
| ドキュメント | 内容 |
|-------------|------|
| [`documents/03_worldbuilding/world_design.md`](documents/03_worldbuilding/world_design.md) | 階層世界『ゲスタロカ』設定 |
| [`documents/03_worldbuilding/game_mechanics/`](documents/03_worldbuilding/game_mechanics/) | ゲームシステム詳細 |
| [`documents/03_worldbuilding/game_mechanics/spSystem.md`](documents/03_worldbuilding/game_mechanics/spSystem.md) | SPシステム仕様 |
| [`documents/03_worldbuilding/game_mechanics/logDispatchSystem.md`](documents/03_worldbuilding/game_mechanics/logDispatchSystem.md) | ログ派遣システム仕様 |
| [`documents/04_ai_agents/gm_ai_spec/`](documents/04_ai_agents/gm_ai_spec/) | GM AIエージェント仕様 |

#### 🛠️ 実装・開発
| ドキュメント | 内容 |
|-------------|------|
| [`documents/02_architecture/techDecisions/developmentGuide.md`](documents/02_architecture/techDecisions/developmentGuide.md) | 開発環境セットアップ |
| [`documents/02_architecture/techDecisions/implementationPatterns.md`](documents/02_architecture/techDecisions/implementationPatterns.md) | 実装パターン集 |
| [`documents/05_implementation/bestPractices.md`](documents/05_implementation/bestPractices.md) | ベストプラクティス（DRY原則等） |
| [`documents/05_implementation/spSystemImplementation.md`](documents/05_implementation/spSystemImplementation.md) | SPシステム実装詳細 |
| [`documents/02_architecture/frontend/componentArchitecture.md`](documents/02_architecture/frontend/componentArchitecture.md) | フロントエンドコンポーネントアーキテクチャ |
| [`documents/05_implementation/troubleshooting.md`](documents/05_implementation/troubleshooting.md) | トラブルシューティング |

## 🚨 トラブルシューティング

詳細なトラブルシューティングガイドは [`documents/05_implementation/troubleshooting.md`](documents/05_implementation/troubleshooting.md) を参照してください。

### ⚡ よくある問題と解決策

| 問題 | 原因 | 解決方法 |
|------|------|---------|
| 🔴 ポート競合エラー | 他サービスがポート使用中 | `docker ps` で確認 → `make down` → 該当サービス停止 |
| 🔴 DB接続エラー | データベース初期化未完了 | `make db-reset` → `make init-db` |
| 🔴 Docker エラー | イメージ・キャッシュの問題 | `make clean` → `make build` |
| 🔴 メモリ不足 | Neo4j/PostgreSQLメモリ | docker-compose.yml のメモリ設定調整 |
| 🔴 環境変数エラー | .env設定不備 | `.env.example`から`.env`作成・API KEY設定 |

### 🔍 デバッグ方法

```bash
# 🩺 完全ヘルスチェック
make health

# 📊 サービス状況確認
make status

# 📋 ログ確認（エラー調査）
make logs | grep -i error
make logs-backend | grep -i error

# 🧹 完全クリーンアップ
make clean-all

# 🔄 完全再構築
make clean && make setup-dev
```

### 🆘 緊急時の対処

```bash
# 🚨 緊急停止
docker-compose down --remove-orphans

# 💣 全削除（最終手段）
make clean-all
```

## 🤝 開発参加について

### 🎯 開発の流れ
1. **📖 設計ドキュメント確認** (`documents/` フォルダ)
2. **🔧 環境構築** (`make setup-dev`)
3. **💡 機能開発** (型安全性・テスト重視)
4. **✅ 品質チェック** (`make lint typecheck test`)

### 🌟 貢献ガイドライン
- **🎨 コードスタイル**: TypeScript + Python(Black/Ruff)
- **🧪 テスト**: 全機能にテスト必須
- **📝 ドキュメント**: 重要な変更は設計ドキュメント更新
- **🤖 AI使用**: Claude Codeとの協調開発

詳細は [**`CLAUDE.md`**](CLAUDE.md) の開発ガイドラインを参照してください。

## 🎯 実装状況

### ✅ 実装済み機能
- **認証システム**: Keycloak統合、JWT認証
- **キャラクター管理**: 作成・一覧・詳細・状態管理
- **ゲームセッション**: リアルタイム物語進行（WebSocket）
- **GM AI評議会**: 6つの専門AIによる動的物語生成
- **戦闘システム**: ターン制バトル、リアルタイム更新
- **ログシステム**: フラグメント収集、編纂、派遣機能
- **ログNPC出現**: 派遣ログが他プレイヤーのゲームにNPCとして登場
- **AI駆動シミュレーション**: 派遣ログの自律的な活動と相互作用
- **SPシステム**: 完全実装（バックエンド＋フロントエンド統合）
  - データモデル・API（残高管理、消費、日次回復、履歴）
  - React Queryフック（リアルタイム更新、エラーハンドリング）
  - UIコンポーネント（SP表示、使用履歴、消費確認ダイアログ）
  - ゲームセッション統合（選択肢：2SP、自由行動：1-5SP）
  - **WebSocket統合**: SP変更時のリアルタイム通知（sp_update、sp_insufficient、sp_daily_recovery）
- **ログ派遣システム**: 編纂したログを独立NPCとして世界へ送り出す
  - 派遣API（作成、一覧、詳細、報告書、緊急召還）
  - 派遣UI（作成フォーム、一覧表示、詳細モーダル）
  - **AI駆動活動シミュレーション**: 個性的で意味のある物語生成
    - 8種類の派遣目的（探索、交流、収集、護衛、商業、記憶保存、研究、自由）
    - ログの性格・スキル・汚染度を反映した活動
    - 脚本家AI・NPC管理AIとの統合
  - **派遣ログ相互作用システム**: 派遣ログ同士の出会いと協調
    - 目的タイプに基づく相互作用確率
    - アイテム交換・知識共有・同盟形成
    - 30分ごとの自動チェックタスク
  - SP消費・還元メカニズム（最大20%還元）
  - 派遣中の遭遇記録・成果蓄積
- **ログNPC出現システム**: 派遣ログが他プレイヤーの世界にNPCとして出現
  - ゲームセッション内での自動遭遇チェック
  - NPC遭遇時のWebSocketリアルタイム通知
  - GM AIによる動的な会話・選択肢生成
  - 相互作用結果の記録（DispatchEncounter）
  - **フロントエンド完全実装**（2025/06/29完了）
    - NPCEncounterDialogコンポーネント（カード形式UI）
    - リアルタイム通知とアクション処理
    - 汚染レベル視覚化、遭遇タイプ別演出
    - スライドインアニメーション、選択状態ハイライト
- **探索システム**: ログフラグメント収集、場所移動、エリア探索
  - フラグメント発見演出アニメーション（レアリティ別エフェクト）
  - 段階的表示とパーティクル効果
- **SP残高表示コンポーネント**: リアルタイム更新、警告表示、増減アニメーション
- **Celeryタスク管理**: Worker、Beat、Flower統合
- **データベース連携**: PostgreSQL + Neo4j のハイブリッド構成
- **型安全なAPI統合**: OpenAPI自動生成によるフロントエンド型定義
- **SP購入システム**: テストモード実装完了（2025/06/29）
  - 購入申請API（プラン一覧、購入、履歴、詳細、キャンセル、統計）
  - 4段階の価格プラン（100SP～1300SP、最大100%ボーナス）
  - テストモード自動承認機能（環境変数制御）
  - フロントエンドUI完全実装（プラン表示、購入確認、履歴管理）
  - WebSocket連携によるリアルタイム更新

### 🚧 開発中
- **SP購入システムの統合テスト**: エンドツーエンドテストの実施
- **NPCEncounterDialogの型エラー修正**: フロントエンドの型定義整合性
- **探索システムの改善**: ミニマップ機能

### 📋 計画中
- **決済統合（Stripe）**: SP購入の実装
- **ログ遭遇システム**: 他プレイヤーの派遣したログとの出会い
  - Week 19-20（7/20-8/2）: 遭遇エンジン、交流システム
- **品質保証**: 統合テスト、バランス調整
  - Week 21-22（8/3-16）: プロダクション品質達成

### 🔮 将来構想
- **ギルドシステム**: プレイヤー間の協力プレイ
- **イベントシステム**: 期間限定イベント、ワールドイベント
- **高度なAI対話**: より自然なNPCとの会話システム

詳細な実装計画は [`documents/01_project/implementationRoadmap.md`](documents/01_project/implementationRoadmap.md) を参照してください。


## 📚 関連ドキュメント

### 🔥 最新の重要ドキュメント
- [SPシステム実装詳細](documents/05_implementation/spSystemImplementation.md) - SPシステムの完全な実装ガイド
- [ログ派遣システム仕様](documents/03_worldbuilding/game_mechanics/logDispatchSystem.md) - 新しいログシステムの詳細設計
- [実装ロードマップ](documents/01_project/implementationRoadmap.md) - 今後2.5ヶ月の詳細計画
- [プロジェクトブリーフ](documents/01_project/projectbrief.md) - MVP要件と実装フェーズ

### 📂 ドキュメント構成の詳細
[`documents/`](documents/) ディレクトリには、プロジェクトの設計・仕様・実装に関する包括的なドキュメントが整理されています。詳細は[`documents/README.md`](documents/README.md)を参照してください。

---

> **🚀 "プレイヤーの想像力が世界を創る" - ゲスタロカで、あなただけの物語を紡ぎましょう**