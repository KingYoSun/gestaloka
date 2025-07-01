# CLAUDE.md

## 作業開始時の確認事項
1. **TodoReadツールで現在のタスク状況を確認**
2. `documents/01_project/activeContext/current_tasks.md` で最新タスクを把握
3. ドキュメントの最終更新日を確認（古い情報に注意）

## 基本ルール
- **言語**: 必ず日本語で回答
- **コミット**: ユーザーから明示的に要求されない限り、絶対にコミットしない
- **日付**: ドキュメント作成時は`date`コマンドで今日の日付を確認

## 技術的ルール

### 重複実装の防止
- API型定義: `frontend/src/api/generated/`の自動生成型を使用
- バリデーション: バックエンドで定義、フロントエンドは`/api/v1/config/game/validation-rules`から取得
- 権限チェック: `app.api.deps`の共通関数を使用

### Alembicマイグレーション（必須）
```bash
# 1. モデルを変更/追加
# 2. alembic/env.pyに新しいモデルをインポート（重要！）
# 3. 自動生成（手動作成は禁止）
docker-compose exec -T backend alembic revision --autogenerate -m "message"
# 4. マイグレーション適用
docker-compose exec -T backend alembic upgrade head
```

### 作業完了時のチェック
- [ ] current_tasks.mdの更新（完了タスクを反映）
- [ ] TodoWriteツールでタスクリストを更新
- [ ] 重要な変更は進捗レポート作成

## プロジェクト概要

**ゲスタロカ (GESTALOKA)** - マルチプレイ・テキストMMO
- LLMとグラフDB、RDBを組み合わせた動的な物語生成
- プレイヤーの行動履歴（ログ）が他プレイヤーの世界にNPCとして影響

### 技術スタック
- **フロントエンド**: TypeScript, React, Vite, TanStack Query/Router
- **バックエンド**: Python 3.11, FastAPI, LangChain, SQLModel, neomodel
- **データベース**: PostgreSQL（構造化）, Neo4j（グラフ）
- **LLM**: Gemini 2.5 Pro（gemini-2.5-pro）
- **インフラ**: Docker Compose, WebSocket, Celery

## 必須コマンド

### 開発
```bash
# 全サービス起動
docker-compose up -d

# テスト実行
make test              # 全テスト
make test-backend      # バックエンドのみ
make test-frontend     # フロントエンドのみ

# リント・型チェック
make lint              # リント
make typecheck         # 型チェック
make format            # フォーマット
```

## アーキテクチャ

### GM AI評議会
- **脚本家AI**: 物語進行とテキスト生成
- **歴史家AI**: 世界の記録と歴史編纂
- **世界の意識AI**: マクロイベント管理
- **混沌AI**: 予測不能なイベント生成
- **NPC管理AI**: 永続的NPC生成・管理
- **状態管理AI**: ルールエンジンとDB管理

### データベース役割分担
- **PostgreSQL**: キャラクター、スキル、行動ログ、セッション
- **Neo4j**: エンティティ関係性、NPCエンティティ
- **Redis**: セッション、キャッシュ、Celeryブローカー

## ゲームメカニクス

### コアサイクル
1. キャラクター作成
2. GM AIによる物語進行
3. 全行動をログとして記録
4. ログをNPC化して他世界へ派遣
5. プレイヤー間の相互作用

### ログシステム
- ログフラグメント収集
- ログ編纂（フラグメント組み合わせ）
- ログ派遣（SP消費でNPCとして派遣）

## ドキュメント構成

### 優先参照順
1. `documents/SUMMARY.md` - 全体概要
2. `documents/01_project/activeContext/` - 現在の状況
3. 各ディレクトリのsummary.md - カテゴリー概要
4. 詳細ドキュメント - 実装時のみ

### 主要ディレクトリ
- `01_project/`: プロジェクト管理、進捗
- `02_architecture/`: 設計、技術決定
- `03_worldbuilding/`: 世界観、メカニクス
- `04_ai_agents/`: AI仕様
- `05_implementation/`: 実装ガイド

## 現在の環境（2025/07/01）
- langchain-google-genai 2.1.6
- AIレスポンスキャッシュ実装（コスト20-30%削減）
- フロントエンドテスト100%成功（MSW導入）
- 全コード品質チェック通過（型・リント）

## 詳細参照先
- 環境情報: `documents/01_project/activeContext/current_environment.md`
- 既知の問題: `documents/01_project/activeContext/issuesAndNotes.md`
- 開発進捗: `documents/01_project/progressReports/`