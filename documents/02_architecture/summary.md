# アーキテクチャ・技術仕様サマリー

最終更新: 2025-07-08

## 概要
このセクションには、ゲスタロカのシステム設計、アーキテクチャパターン、技術的決定、API仕様に関するドキュメントが含まれています。新機能の実装や技術的な意思決定を行う際の指針となります。

## 主要ポイント

### システム構成
- **認証フロー**: KeyCloak → JWT → Cookie認証（設計）
  - ※現在の実装は独自JWT認証であり、KeyCloakへの移行が必要
- **リアルタイム通信**: WebSocket (Socket.IO)
- **非同期処理**: Celery + Redis
- **データベース**: PostgreSQL（構造化データ）+ Neo4j（関係性データ）
- **決済システム**: Stripe（SP購入・サブスクリプション）
- **AIキャッシュ**: Redis（コスト20-30%削減）
- **セッション管理**: GameMessage/SessionResultテーブル（2025-07-08追加）

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
- **物語主導型設計**: 探索を含むすべての機能が物語の一部として統合（2025-07-06追加）

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
- **[encounter_story_spec.md](features/encounter_story_spec.md)**: 遭遇ストーリーシステム仕様（記憶継承システムの拡張）

## 最近の更新（2025年7月）

- **セッションシステム再設計（2025-07-08）**: 長時間プレイ対策とコンテキスト管理
  - GameMessageテーブルで全メッセージを永続化
  - SessionResultテーブルでセッション結果を保存
  - GameSessionモデルの拡張（session_status、turn_count等）
  - GameMessage/SessionResultテーブルの詳細は実装コード参照
- **キャラクター編集機能（2025-07-07）**: 名前、説明、外見、性格の編集
- **探索機能の統合（2025-07-06）**: 独立した探索システムをセッション進行に完全統合
  - 探索専用ページ・APIを削除
  - GameSessionServiceで探索処理を実装
  - CoordinatorAIが文脈に応じた探索選択肢を生成
- **Cookie認証への移行（2025-07-06）**: LocalStorageからセキュアなhttponly Cookieへ（JWT保存先の変更、独自JWT認証のまま）
- **KeyCloak認証への移行**: 未実装、移行作業が必要
- **Energy→MPへの名称変更（2025-07-07）**: キャラクターの魔力ポイント
- **SPシステム完全実装**: Stripe統合、サブスクリプション、管理機能
- **ログ遭遇システム強化**: 複数NPC対応、アイテム交換、確率計算
- **物語主導型移動**: ミニマップ削除、GM AIによる自然な移動（2025-07-06）
- **AIレスポンスキャッシュ**: コスト20-30%削減
- **遭遇ストーリーシステム**: ログとの遭遇を継続的な物語に発展させる機能（2025-07-04）

## クイックリファレンス

- 新機能設計時：`design_doc.md`でシステム全体像を確認
- 実装パターン：`systemPatterns.md`で確立されたパターンを参照
- AI実装時：`api/gemini_api_specification.md`でAPI仕様を確認
- 機能設計時：`features/`内の該当設計書を参照