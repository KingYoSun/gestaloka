# アーキテクチャ・技術仕様サマリー

最終更新: 2025-07-02

## 概要
このセクションには、ゲスタロカのシステム設計、アーキテクチャパターン、技術的決定、API仕様に関するドキュメントが含まれています。新機能の実装や技術的な意思決定を行う際の指針となります。

## 主要ポイント

### システム構成
- **認証フロー**: Keycloak → JWT → API
- **リアルタイム通信**: WebSocket (Socket.IO)
- **非同期処理**: Celery + Redis
- **データベース**: PostgreSQL（構造化データ）+ Neo4j（関係性データ）
- **決済システム**: Stripe（SP購入・サブスクリプション）
- **AIキャッシュ**: Redis（コスト20-30%削減）

### GM AI評議会
6つの専門AIがそれぞれの役割を持ち協調動作：
- 脚本家AI：物語生成とテキスト創作
- 状態管理AI：ルール判定とDB管理
- 歴史家AI：世界の記録と歴史編纂
- NPC管理AI：永続的NPC生成・管理
- 世界の意識AI：マクロイベント管理
- 混沌AI：予測不能なイベント生成

### アーキテクチャ決定
- **ポリグロットパーシステンス**: 用途に応じた複数DB活用
- **イベントソーシング**: 全行動をイベントログとして記録
- **AIエージェント協調**: 各AIが専門領域を持ち協調
- **リアクティブアーキテクチャ**: WebSocketによる双方向通信

## ドキュメント一覧

### [design_doc.md](design_doc.md)
システム全体の詳細設計仕様。GM AI評議会の構成、データフロー、技術選定理由を記載。

### [systemPatterns.md](systemPatterns.md)
確立されたアーキテクチャパターンとデータフロー図。新機能実装時の参考資料。

### [techDecisions/](techDecisions/index.md) 📁
技術的な決定事項と実装詳細を階層的に管理。
- **index.md**: 技術コンテキストの概要
- **techStack.md**: 技術スタック選定理由と詳細
- **implementationPatterns.md**: 確立された実装パターン
- **developmentGuide.md**: 開発環境セットアップとツール
- **productionGuide.md**: 本番環境・セキュリティガイド
- **technicalDecisions.md**: 技術的決定記録と負債管理

### techDecisions/
- **[alembicIntegration.md](techDecisions/alembicIntegration.md)**: Alembic + SQLModel統合ガイド
- **[websocketArchitecture.md](techDecisions/websocketArchitecture.md)**: WebSocketアーキテクチャとリアルタイム通信設計

### api/
- **[gemini_api_specification.md](api/gemini_api_specification.md)**: Gemini API仕様とLangChain統合ガイド
- **[ai_coordination_protocol.md](api/ai_coordination_protocol.md)**: AI間の協調動作プロトコル

### frontend/
- **[componentArchitecture.md](frontend/componentArchitecture.md)**: フロントエンドコンポーネントアーキテクチャとDRY原則

### features/
- **[minimap_design.md](features/minimap_design.md)**: ミニマップ機能の設計書（UI/UX、実装フェーズ）
- **[minimap_technical_spec.md](features/minimap_technical_spec.md)**: ミニマップ機能の技術仕様（API、DB、Canvas実装）
- **[sp_system_spec.md](features/sp_system_spec.md)**: SPシステムの完全仕様（購入、サブスク、管理）
- **[log_encounter_spec.md](features/log_encounter_spec.md)**: ログ遭遇システム仕様（複数NPC、アイテム交換）
- **[encounter_story_spec.md](features/encounter_story_spec.md)**: 遭遇ストーリーシステム仕様（記憶継承システムの拡張）

## 最近の更新（2025年7月）

- **SPシステム完全実装**: Stripe統合、サブスクリプション、管理機能
- **ログ遭遇システム強化**: 複数NPC対応、アイテム交換、確率計算
- **物語主導型移動**: ミニマップview-only化、GM AIによる自然な移動
- **AIレスポンスキャッシュ**: コスト20-30%削減
- **遭遇ストーリーシステム**: ログとの遭遇を継続的な物語に発展させる機能（2025-07-04）

## クイックリファレンス

- 新機能設計時：`design_doc.md`でシステム全体像を確認
- 実装パターン：`systemPatterns.md`で確立されたパターンを参照
- AI実装時：`api/gemini_api_specification.md`でAPI仕様を確認
- 機能設計時：`features/`内の該当設計書を参照