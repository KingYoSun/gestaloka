# ゲスタロカ (GESTALOKA) プロジェクトサマリー

## 概要
**ゲスタロカ**は、LLMとグラフDB/RDBを組み合わせたマルチプレイ・テキストMMOです。プレイヤーの行動履歴（ログ）が他プレイヤーの世界にNPCとして影響を与える、動的な物語生成システムを特徴としています。

## 技術スタック
- **フロントエンド**: TypeScript, React 19, Vite, shadcn/ui, zustand, TanStack Query/Router
- **バックエンド**: Python 3.11, FastAPI, LangChain, SQLModel, neomodel, Celery
- **データベース**: PostgreSQL 17, Neo4j 5.26 LTS, Redis 8
- **AI/LLM**: Gemini 2.5 Pro, GM AI評議会（6つの専門AI）
- **認証**: Keycloak 26.2

## 実装状況
✅ **完了**: 認証システム、キャラクター管理、ゲームセッション、AI統合基盤、GM AI評議会（全6エージェント）、WebSocket通信、戦闘システム、Alembic統合、ログ編纂機能、SPシステム、ログ派遣システム（AI駆動シミュレーション含む）、探索システム、ログNPC出現システム（フロントエンド改善版・2025/06/29完了）、SP購入システム（Stripe統合・2025/07/01完了）、探索システムミニマップ（Phase 1-4完了・2025/07/01）  
🚧 **進行中**: 探索システムの改善  
📋 **計画中**: 戦闘システムのスキル・アビリティ、ミニマップのモバイル対応・アクセシビリティ

## 現在の優先タスク
1. 探索システムの改善（ミニマップのモバイル対応・アクセシビリティ、探索報酬バランス調整）
2. 戦闘システムの拡張（スキル・アビリティシステム設計）
3. ミニマップ新機能（マーキング、経路探索、天候効果、時間軸スライダー）

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

### [06_reports/](06_reports/summary.md) - レポート
テストプレイレポート、フィードバック