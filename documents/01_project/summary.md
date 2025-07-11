# プロジェクト管理サマリー

## 概要
このセクションには、ゲスタロカプロジェクトのMVP要件、開発進捗、現在のタスク管理に関するドキュメントが含まれています。プロジェクトの全体像を把握し、開発の方向性を確認するための重要な情報源です。

## 主要ポイント

### プロジェクト概要
- **ビジョン**: LLMとグラフDBを活用したマルチプレイ・テキストMMO
- **特徴**: プレイヤーの行動履歴（ログ）が他プレイヤーの世界にNPCとして影響
- **技術**: TypeScript/React + Python/FastAPI + PostgreSQL/Neo4j + Gemini 2.5 Pro

### 現在の状況（2025/07/11）
- **MVP完成度**: ゲームセッション実装の全面的やり直し中
- **完了**: 技術基盤、Cookie認証、キャラクター管理（編集機能追加）、GM AI評議会（全6メンバー）、戦闘システム、ログシステム（編纂・派遣・遭遇）、SPシステム（Stripe統合）
- **再実装中**: ゲームセッションシステム（WebSocket接続問題により全面的にやり直し）
- **技術的債務**: TypeScript any型改善（45箇所）、Neo4j/Redisセッション管理

### 優先タスク
1. ゲームセッションMVP実装（WebSocketサーバー基本実装）
2. 基本機能の段階的追加（メッセージ配信、AI応答）
3. フロントエンド統合（WebSocket接続管理、基本対話UI）

## ドキュメント一覧

### [projectbrief.md](projectbrief.md)
MVP要件の詳細定義。4つのフェーズに分けた開発計画と、各フェーズの成功基準を記載。

### [progressReports/](progressReports/index.md) 📁
開発進捗の詳細追跡。週次レポート、マイルストーン、振り返りを体系的に管理。
- **index.md**: 進捗サマリーと現在の状況
- **weeklyReports.md**: 週次の詳細進捗
- **milestones.md**: 完了済み・進行中のマイルストーン
- **retrospective.md**: 振り返りとメトリクス

### [activeContext/](activeContext/index.md) 📁
現在の開発コンテキスト。現在の状況と詳細情報を階層的に管理。
- **index.md**: 現在の開発状況と優先タスク
- **completedTasks.md**: 完了済みタスクの詳細記録
- **developmentEnvironment.md**: 稼働中サービスと環境情報
- **issuesAndNotes.md**: 既知の問題と開発メモ

## クイックリファレンス

- 新機能追加前：`projectbrief.md`でMVP要件を確認
- 進捗確認：`progress.md`で最新の開発状況を把握
- 今すぐやるべきこと：`activeContext.md`で現在のタスクを確認