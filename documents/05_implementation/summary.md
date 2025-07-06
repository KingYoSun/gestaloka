# 実装ガイドサマリー

## 概要
このセクションには、ゲスタロカの実装に関する実践的なガイド、機能実装のサマリー、トラブルシューティング情報が含まれています。実際の開発作業を行う際の参考資料です。

## 主要な実装済み機能

### 認証・ユーザー管理
- Keycloak統合によるJWT認証
- ユーザー登録・ログイン機能
- 認証保護されたAPIエンドポイント

### キャラクター管理
- キャラクター作成（名前、外見、性格、初期スキル）
- キャラクター一覧・詳細表示
- 状態管理（HP/MP、バフ/デバフ）

### ゲームセッション
- セッション作成・管理
- アクション実行と結果処理
- リアルタイム状態同期

### AI統合基盤
- Gemini 2.5 Pro API統合
- LangChain によるプロンプト管理
- GM AI評議会（6エージェント）実装

### インフラ・開発環境
- Docker Compose による環境構築
- Celery による非同期タスク処理
- WebSocket によるリアルタイム通信
- 自動テスト・リント・型チェック環境

### ログシステム
- ログフラグメント収集・編纂機能
- ログ派遣システム（AI駆動シミュレーション）
- ログNPC出現システム（2025/06/29フロントエンド改善）
- 派遣ログ同士の相互作用システム
- 汚染浄化メカニクス（2025/07/06 コンテキスト汚染概念実装）

### SPシステム
- SP残高管理・消費・取引履歴
- WebSocket統合によるリアルタイム更新
- 日次回復とボーナスシステム（Celeryタスク自動化済み）
- 選択肢（2SP）と自由行動（1-5SP）の消費ルール
- SPサブスクリプション機能（Basic/Premium、Stripe統合）
- 管理画面でのSP管理機能（付与・調整・履歴確認）

## 開発のベストプラクティス

### コード規約
- **フロントエンド**: TypeScript strict mode、ESLint、Prettier
- **バックエンド**: Ruff（Python）、mypy による型チェック
- **コミット**: conventional commits 形式

### テスト戦略
- **単体テスト**: Vitest（フロント）、pytest（バック）
- **統合テスト**: API エンドポイント、DB操作、Neo4j実インスタンステスト
- **E2Eテスト**: 主要ユーザーフロー（計画中）
- **テスト環境**: docker-compose.test.ymlによる分離環境

### パフォーマンス考慮
- DB クエリの最適化（N+1問題の回避）
- 適切なキャッシュ戦略（Redis活用）
- WebSocket 接続の効率的な管理

## よくある課題と解決策

### 開発環境
- Docker コンテナの起動順序問題 → depends_on と healthcheck
- ポート競合 → .env でポート設定をカスタマイズ
- メモリ不足 → Docker Desktop のリソース設定を調整

### API連携
- CORS エラー → FastAPI の CORS middleware 設定
- 認証トークン期限切れ → 自動リフレッシュ機能
- WebSocket 切断 → 自動再接続とハートビート

### データベース
- マイグレーション失敗 → alembic downgrade で巻き戻し
- Neo4j 接続エラー → ボルトプロトコルのポート確認
- トランザクション競合 → 適切な分離レベル設定

## ドキュメント一覧

### [characterManagementSummary.md](characterManagementSummary.md)
キャラクター管理システムの実装概要。API設計、データモデル、UI実装の詳細。

### [productContext.md](productContext.md)
プロダクトビジョンとユーザーエクスペリエンス目標。機能の優先順位付けの指針。

### [troubleshooting.md](troubleshooting.md)
既知の問題と解決策。エラーメッセージ別の対処法。

### [battleSystemImplementation.md](battleSystemImplementation.md)
戦闘システムの実装ガイド。ターン制バトル、UI統合、AIとの連携詳細。

### [duplicatedBusinessLogic.md](duplicatedBusinessLogic.md)
バックエンドとフロントエンドで重複しているビジネスロジックの調査結果と統合提案。

### [testingStrategy.md](testingStrategy.md)
テスト戦略とNeo4j統合テスト環境の構築ガイド。実データベースを使用したテストの実装方法。

### [spSystemImplementation.md](spSystemImplementation.md)
SPシステムの実装詳細。モデル設計、API実装、フロントエンド統合。

### [spPurchaseSystem.md](spPurchaseSystem.md)
SP購入システムの設計書。テストモードと本番モードの切り替え、価格プラン、セキュリティ対策。

### [form_validation.md](form_validation.md)
フォームバリデーションと文字数制限の実装ガイド。AI送信フォームの制限一覧、文字数カウンターUI実装。

## クイックリファレンス

- 新機能実装：既存の実装パターンを`characterManagementSummary.md`で確認
- エラー解決：`troubleshooting.md`で既知の問題をチェック
- 開発方針：`productContext.md`でプロダクトビジョンを確認