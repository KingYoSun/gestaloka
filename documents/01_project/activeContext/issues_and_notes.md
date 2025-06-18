# 現在の問題と注意事項

## 最終更新: 2025-06-18

### 技術的注意事項

#### Alembicマイグレーション
- SQLModelが自動的にテーブルを作成するため、`--autogenerate`が機能しない場合がある
- 新しいモデル追加時は手動でマイグレーションファイル作成が必要な場合がある
- PostgreSQLのENUMタイプは`DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$`でラップする必要がある
- マイグレーション履歴の手動更新が必要な場合：`INSERT INTO alembic_version (version_num) VALUES ('revision_id');`

#### Gemini API
- `gemini-2.5-pro`安定版を使用（プレビュー版から移行済み）
- temperatureは`model_kwargs`で設定する必要がある
- 範囲は0.0-1.0に制限（langchainの制約）

#### 依存関係
- `langchain-google-genai`に`google-generativeai`が含まれるため、重複インストールは避ける
- バージョン固定が重要：`langchain==0.3.25`, `langchain-google-genai==2.1.5`

#### Docker環境
- Makefileでのコマンド実行時は`-T`フラグが必要（TTY問題）
- ネットワーク設定変更時は全コンテナの再作成が必要

### 既知の問題

#### TypeScript警告
- Viteの設定ファイルで`ConvertibleValue`型の警告が残存（機能に影響なし）
- React Contextの型定義で警告が発生する場合がある

#### pytest警告
- `asyncio_default_fixture_loop_scope`の設定警告（pytest-asyncio関連）
- 機能には影響しないが、将来的に設定が必要

### 開発時の注意点

1. **新規モデル追加時**
   - `app/models/__init__.py`にインポートを追加
   - `alembic/env.py`にもインポートを追加
   - マイグレーションが自動生成されない場合は手動作成

2. **API変更時**
   - OpenAPIスキーマの更新を確認
   - フロントエンドの型定義を再生成

3. **テスト実行時**
   - Dockerコンテナが全て起動していることを確認
   - 特にPostgreSQL、Neo4j、Redisが必要