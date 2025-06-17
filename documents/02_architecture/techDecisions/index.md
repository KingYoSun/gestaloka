# 技術コンテキスト - ログバース (Logverse)

**最終更新日:** 2025/06/17

## 概要

このセクションには、ログバースプロジェクトの技術的な決定事項、実装詳細、開発ガイドが含まれています。技術スタックの選定理由から具体的な実装パターンまで、開発に必要な技術情報を体系的に整理しています。

## クイックリファレンス

### 技術スタック
- **フロントエンド**: TypeScript, React 19, Vite, TanStack Query/Router
- **バックエンド**: Python 3.11, FastAPI, LangChain, SQLModel
- **データベース**: PostgreSQL 17, Neo4j 5.26 LTS
- **インフラ**: Docker Compose, Redis, Keycloak, Celery

### 主要な技術的決定
1. **ポリグロットパーシステンス**: 構造化データ（PostgreSQL）と関係性データ（Neo4j）の使い分け
2. **リアクティブアーキテクチャ**: WebSocketによる双方向通信
3. **AIエージェント協調**: LangChainを活用した複数AI連携
4. **イベントソーシング**: 全行動をイベントログとして記録

## ドキュメント構成

### [技術スタック](./techStack.md)
技術スタックの選定理由、比較検討した代替案、各技術の役割と統合方法。

### [実装パターン](./implementationPatterns.md)
確立された実装パターン、認証フロー、WebSocket通信、AI統合、エラーハンドリング。

### [開発ガイド](./developmentGuide.md)
開発環境セットアップ、開発ツール、作業フロー、トラブルシューティング。

### [本番環境ガイド](./productionGuide.md)
デプロイメント手順、運用考慮事項、セキュリティ設定、監視・ログ設定。

### [技術的決定記録](./technicalDecisions.md)
重要な技術的決定、実装時の問題と解決策、技術的負債、今後の検討事項。

## 開発の流れ

### 新機能開発時
1. [技術スタック](./techStack.md)で使用技術を確認
2. [実装パターン](./implementationPatterns.md)で既存パターンを参照
3. [開発ガイド](./developmentGuide.md)でセットアップと開発手順を確認

### トラブルシューティング
1. [開発ガイド](./developmentGuide.md)の「トラブルシューティング」セクション
2. [技術的決定記録](./technicalDecisions.md)の「問題と解決策」

### デプロイメント準備
1. [本番環境ガイド](./productionGuide.md)でデプロイ手順を確認
2. セキュリティチェックリストの実施

## 関連ドキュメント

- [システム設計](../design_doc.md) - アーキテクチャ全体像
- [システムパターン](../systemPatterns.md) - 確立されたパターン
- [API仕様](../api/) - Gemini API、AI協調プロトコル