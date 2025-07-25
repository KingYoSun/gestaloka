# ゲスタロカ (GESTALOKA) プロジェクトサマリー

最終更新: 2025-07-22

## 概要
**ゲスタロカ**は、LLMとグラフDB/RDBを組み合わせたマルチプレイ・テキストMMOです。プレイヤーの行動履歴（ログ）が他プレイヤーの世界にNPCとして影響を与える、動的な物語生成システムを特徴としています。

## 技術スタック
- **フロントエンド**: TypeScript, React 19, Vite, shadcn/ui, zustand, TanStack Query/Router
- **バックエンド**: Python 3.11, FastAPI, LangChain, SQLModel, neomodel, Celery
- **データベース**: PostgreSQL 17, Neo4j 5.26 LTS, Redis 8
- **AI/LLM**: Gemini 2.5 Pro（gemini-2.5-pro）, GM AI評議会（6つの専門AI）
- **認証**: 独自JWT認証（KeyCloak 26.2へ移行予定）
- **決済**: Stripe（SPサブスクリプション）
- **インフラ**: Docker Compose, WebSocket

## 実装状況（2025/07/22時点）

### ✅ 完了済み機能
**基盤システム**: 認証（Cookie認証移行済み）、キャラクター管理（編集機能追加）、ゲームセッション（メッセージ永続化実装）、WebSocket通信、Alembic統合  
**AI統合**: GM AI評議会（全6エージェント）、AIレスポンスキャッシュ（コスト20-30%削減）  
**ゲームシステム**: 戦闘、ログ編纂、SPシステム（日次回復自動化済み）  
**物語主導型探索**: 探索機能をセッション進行に完全統合（2025/07/06）、選択肢として自然に組み込み  
**セッションシステム**: GameMessageテーブル実装、SessionResultテーブル実装、長時間プレイ対策の基盤整備（2025/07/08）  
**ログ関連**: ログ派遣（AI駆動シミュレーション）、フラグメント発見（125種類以上）、遭遇システム（複数NPC対応）  
**高度な編纂メカニクス**: コンボボーナスシステム、汚染浄化メカニクス、特殊称号システム（完全実装済み）  
**記憶継承**: 動的クエストシステム、記憶継承メカニクス（スキル/称号/アイテム/ログ強化）  
**遭遇ストーリー**: 継続的な関係性構築、8種類のストーリーアーク、共同クエスト  
**フロントエンド**: ~~ミニマップ（Phase 1-4）~~、物語主導型移動、認証システム統一、テスト100%成功  
**課金システム**: SP購入（Stripe統合）、SPサブスクリプション（Basic/Premium）  
**管理機能**: SP付与・調整、履歴管理  
**品質**: 全テスト成功（フロント28/28、バックエンド280/280）、リント0エラー、型エラー0件  
**リファクタリング**: 全体リファクタリング第15回完了、テストカバレッジ（フロント0%、バックエンド29%）  
**型定義の一元管理**: OpenAPI Generator移行完了（90%のAPIクライアント移行済み）（2025/07/17）

### 🚧 進行中
- テストカバレッジの向上（フロント0%→50%、バックエンド29%→50%）
- ゲームセッションシステムの全面的な再実装（v2）

### 📋 計画中
- KeyCloak認証への移行
- 戦闘システムのスキル・アビリティ拡張
- パフォーマンス最適化とシステム監視体制構築

## 開発環境（2025/07/22時点）
- フェイディング設定削除と世界観の整合性改善完了（2025/07/22）
- 世界観・ゲームメカニクスドキュメントのリファクタリング完了（2025/07/11）
- アーキテクチャドキュメントのリファクタリング完了（2025/07/11）
- KeyCloak認証への移行タスクを高優先度で追加
- リファクタリング完了度調査実施（総合評価75%）（2025/07/15）
- 全体リファクタリング第15回完了（2025/07/15）
- バックエンドテスト280個全て成功（リファクタリング中に70個追加）
- テストカバレッジ判明（フロント0%、バックエンド29%）
- 型定義の重複問題確認（DRY原則違反60%）
- langchain-google-genai 2.1.6
- Pydantic V2完全移行済み
- AIレスポンスキャッシュ実装済み（コスト20-30%削減）
- フロントエンドテスト100%成功（28/28件）
- 全コード品質チェック通過（型・リント）
- SP日次回復の自動化実装済み（Celeryタスク、毎日UTC 4時実行）
- Energy→MPへの名称変更（2025/07/07）
- 記憶フラグメントを「ゲーム体験の記念碑」として再設計（2025/07/02）
- 高度な編纂メカニクス実装（コンボボーナス、汚染浄化、特殊称号）（2025/07/05完了）
- 認証システム統一（AuthProvider/useAuth）、Cookie認証移行（2025/07/06）
- 探索機能をセッション進行に完全統合（2025/07/06）
- キャラクター編集機能実装（2025/07/07）
- セッションシステム再設計・基盤実装（2025/07/08）
- ノベルゲーム風UI実装（Framer Motion導入）（2025/07/10）
- ゲームセッション全面再実装決定（2025/07/11）

## ドキュメント構成

### [01_project/](01_project/summary.md) - プロジェクト管理
MVP要件、進捗追跡、現在のタスク管理

### [02_architecture/](02_architecture/summary.md) - アーキテクチャ
システム設計、技術選定、API仕様

### [03_worldbuilding/](03_worldbuilding/summary.md) - 世界観
階層世界『ゲスタロカ』の設定、ゲームメカニクス

### [04_ai_agents/](04_ai_agents/summary.md) - AIエージェント
GM AI評議会の各エージェント仕様

### [05_implementation/](05_implementation/summary.md) - 実装ガイド
機能実装のサマリー、トラブルシューティング
- **最新**: [game_session_overview.md](05_implementation/game_session_overview.md) - ゲームセッション実装の最新ドキュメント構成
- **重要**: [game_session_design_v2.md](05_implementation/game_session_design_v2.md) - ゲームセッションv2設計書

### [06_reports/](06_reports/summary.md) - レポート
テストプレイレポート、フィードバック

### [archived/](archived/) - アーカイブ
- [game_session_old_design/](archived/game_session_old_design/) - 旧ゲームセッション設計（2025/07/11以前）

## 最近の主要更新（2025年7月）

### フェイディング設定削除と世界観の整合性改善（2025/07/22）
- **背景**: 「フェイディング」（世界の消滅）が世界観を必要以上にダークにしていた
- **実施内容**:
  - 世界設定から「フェイディング」を完全削除
  - 「汚染と浄化」システムに統一
  - documents/03_worldbuilding、04_ai_agents以下を全面更新
  - バックエンド実装のプロンプトとコードを更新
- **成果**:
  - 世界観の統一性向上（重複概念の削除）
  - 汚染浄化システムが中心的な役割に
  - プレイヤーの目的が明確化（世界の浄化と再生）
- **詳細**: `progressReports/2025-07-22_fading_removal_world_consistency.md`

### リファクタリング完了度調査（2025/07/15）
- **調査結果**: 総合評価75%完了
- **発見事項**:
  - DRY原則違反: Frontend/Backend間で型定義が重複（60%達成）
  - 未使用コード: 3つの未使用パラメータ、2つの未使用クラス（85%達成）
  - テストカバレッジ: Frontend 0%、Backend 29%（40%達成）
  - ドキュメント整合性: AIエージェントとコア機能は実装済み（90%達成）
- **優先対応**: OpenAPI Generator導入、テストカバレッジ向上
- **詳細**: `progressReports/refactoring_completion_report_2025-07-15.md`

### 全体リファクタリング第11-15回（2025/07/14-15）
- **第15回**: テスト修正と重複チェック実装、280個のテスト全て成功
- **第14回**: 第13回で追加したテストのエラー修正
- **第13回**: フロントエンド未使用ファイル21個削除、29個の新規テスト追加
- **第12回**: SP購入プラン整合性修正（5プラン体系に変更）
- **第11回**: 連続ログインボーナス定数の重複削除、26個の新規テスト追加

### ゲームセッション全面再実装の決定（2025/07/11）
- **背景**: 度重なる修正により設計が複雑化、状態管理の不整合が顕在化
- **問題点**:
  - WebSocket/HTTP/Redis間での状態同期の問題
  - ネットワーク切断時の復帰処理の不安定性
  - セッション永続化とメモリセッションの混在
  - エラーハンドリングの不完全性
- **新方針**:
  - シンプリシティ・ファースト: 最小限の実装から段階的に拡張
  - WebSocketファースト: リアルタイム通信を前提とした設計
  - 明確な責任分離: 各コンポーネントの役割を明確化
- **ドキュメント整理**: 旧仕様を `/documents/archived/game_session_old_design/` にアーカイブ

### ノベルゲーム風UI実装（2025/07/10）
- **実装内容**: Framer Motion導入、タイプライター効果、日付/時間表示
- **技術的選択**: カスタムタイプライター実装でパフォーマンス最適化
- **成果**: 没入感のあるゲーム体験、3つの表示モード対応

### セッションシステムの再設計（2025/07/08）
- **背景**: 長時間プレイによるコンテキスト肥大化問題への対応
- **実装内容**:
  - GameMessageテーブル: 全メッセージをDBに永続化
  - SessionResultテーブル: セッション結果の保存
  - GameSessionモデル拡張: session_status、turn_count、word_count等追加
- **技術的選択**: PostgreSQL ENUM型を回避し文字列フィールドで実装
- **今後の展開**: GM AIによる自動セッション区切り、リザルト処理による継続性確保

### キャラクター編集機能の実装（2025/07/07）
- **実装内容**: 名前、説明、外見、性格の編集機能
- **技術的学び**: TanStack Routerのディレクトリベースルーティングが必須
- **成果**: キャラクター情報の柔軟な更新が可能に

### 探索機能とセッション進行の統合（2025/07/06）
- **物語主導型設計の実現**: 独立した探索ページを削除し、セッション進行に完全統合
- **実装内容**: 
  - フロントエンドから探索関連ページ・コンポーネントを削除
  - GameSessionServiceに探索処理を統合
  - CoordinatorAIが物語の文脈から探索選択肢を生成
  - フラグメント発見を物語として描写
- **成果**: 1日で実装完了（計画では1週間）、システムの単純化とコード削減
- **影響**: 「物語が移動を導く」という核心理念を完全に実現

### コード品質の完全改善（2025/07/05）
- **Pydantic V2移行**: `@validator`→`@field_validator`、`.from_orm()`→`.model_validate()`
- **DRY原則**: トースト実装統一、型定義重複解消
- **テスト成功率100%**: フロントエンド47/47、バックエンド229/229
- **エラー0件達成**: 型チェック、リント完全クリア

### 認証・WebSocket修正（2025/07/05）
- **認証システム統一**: useAuthStore→AuthProvider/useAuthフックへ一本化
- **WebSocket接続状態**: 接続状態表示の問題を完全解決
- **レイアウト問題**: TanStack Routerレイアウトルートで二重表示解消
- **CORS問題**: 環境変数からの動的設定を維持しつつ根本解決

### 高度な編纂メカニクス完全実装（2025/07/05）
- **フロントエンドUI**: SP消費リアルタイム表示、コンボボーナス視覚化
- **浄化インターフェース**: 汚染度表示、浄化効果プレビュー、アイテム作成
- **特殊称号管理**: 称号一覧、装備機能、ゲーム画面での表示
- **完全な型安全性**: TypeScriptエラー0件達成
- **汚染概念の深化**: 負の感情による「コンテキスト汚染」として再定義（AI/LLMにも通じる概念）

### SPシステム完全実装（2025/07/02）
- **サブスクリプション**: Basic（+20SP/日）、Premium（+50SP/日）プラン
- **自動化**: 日次回復（UTC 4時）、期限管理、Stripe統合
- **管理機能**: SP付与・調整、履歴管理、一括調整API

### ログシステム強化（2025/07/01-02）
- **フラグメント**: 125種類以上のキーワード、動的生成
- **遭遇**: 複数NPC対応（最大3体）、確率計算、アイテム交換
- **物語主導**: 行動選択→GM AI生成→自然な移動の流れ

### 品質改善（2025/07/02）
- テスト229個全て成功、リント0エラー
- 型エラー大幅削減（60個→38個、内部コード0個）

### 記憶継承システム実装（2025/07/02）
- **動的クエスト**: AI駆動の自然なクエスト生成・進行管理
- **記憶継承メカニクス**: 4つの継承タイプ（スキル/称号/アイテム/ログ強化）
- **新モデル**: CharacterTitle、Item、CharacterItem、Skillモデル分離
- **SP消費**: レアリティとコンボボーナスによる動的価格設定