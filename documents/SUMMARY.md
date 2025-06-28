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
✅ **完了**: 認証システム、キャラクター管理、ゲームセッション、AI統合基盤、GM AI評議会（全6エージェント）、WebSocket通信、戦闘システム、Alembic統合、ログ編纂機能、SPシステム、ログ派遣システム（AI駆動シミュレーション含む）、探索システム、ログNPC出現システム（フロントエンド・バックエンド統合完了）  
🚧 **進行中**: SP購入システム、SP不足時のUI/UX改善  
📋 **計画中**: マネタイズ機能（SP購入）、ギルドシステム、イベントシステム、探索システムのミニマップ

## 現在の優先タスク
1. SP購入システムの設計・実装
2. SP不足時のフィードバックUI改善
3. 探索システムのミニマップ機能

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