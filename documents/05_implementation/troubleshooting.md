# トラブルシューティングガイド - ゲスタロカ (Gestaloka)

**最終更新日:** 2025/06/18

## 目次
1. [Neo4j権限問題](#neo4j権限問題)
2. [Docker環境の問題](#docker環境の問題)
3. [依存関係の問題](#依存関係の問題)
4. [API接続の問題](#api接続の問題)
5. [開発環境の問題](#開発環境の問題)
6. [MakefileのTTY問題](#makefileのtty問題)
7. [Gemini APIの問題](#gemini-apiの問題)
8. [データベース初期化の問題](#データベース初期化の問題)

## Neo4j権限問題

### docker compose up後の権限変更

**症状:** neo4j/schemaディレクトリがroot所有になり、git追跡や編集が不可能になる

**原因:** Neo4jコンテナがボリュームマウントされたディレクトリの所有権を変更

**解決方法:**
1. 一時的解決: `make fix-permissions`で権限修正
2. 根本的解決: docker-compose.ymlでread-onlyマウントと起動時コピーを使用（実装済み）

**予防策:** Read-onlyマウント、起動時コピー、別ボリューム使用により権限変更を防止

## Docker環境の問題

### サービスが起動しない

**症状:** docker-compose upでエラー、特定サービスがunhealthy

**解決方法:**
1. ログ確認: `make logs`または個別サービスのログ確認
2. リソースクリーンアップ: `make clean`または`make clean-all`
3. 個別起動: データベースのみ起動後、問題のサービスを個別に起動

### ポートが既に使用されている

**症状:** bind: address already in useエラー

**解決方法:**
1. 使用中プロセス確認: `lsof -i`で各ポート（8000, 3000, 5432, 7474）を確認
2. プロセス終了: 該当PIDをkill

## 依存関係の問題

### langchain-google-genaiバージョン互換性

**症状:** バージョン競合、AttributeError: 'NoneType' object has no attribute 'split'

**解決方法:**
1. google-generativeaiをrequirements.txtから削除（langchain-google-genaiに含まれる）
2. Dockerイメージ再ビルド: `docker-compose build --no-cache backend`

### Pythonパッケージのバージョン競合

**症状:** pip installエラー、依存関係解決の失敗

**解決方法:**
1. requirements.txt再生成: `pip-compile requirements.in --resolver=backtracking`
2. キャッシュクリア後に再ビルド

### npm installでエラー

**症状:** node_modulesインストール失敗、peer dependency警告

**解決方法:**
1. node_modulesとpackage-lock.json削除後、再インストール
2. Dockerで再ビルド: `docker-compose build --no-cache frontend`

## API接続の問題

### CORSエラー

**症状:** ブラウザコンソールでCORSエラー、APIリクエストがブロック

**解決方法:**
1. バックエンドのCORS設定確認（main.pyのCORSMiddleware設定）
2. 環境変数確認: VITE_API_URL=http://localhost:8000

### 認証エラー（401 Unauthorized）

**症状:** ログイン後も401エラー、JWTトークン無効

**解決方法:**
1. トークン有効期限確認: ACCESS_TOKEN_EXPIRE_MINUTES設定
2. ローカルストレージクリア: `localStorage.clear()`後リロード

## 開発環境の問題

### 型チェックエラー

**症状:** make typecheckでエラー、TypeScriptまたはmypyエラー

**解決方法:**
1. 型定義更新: @typesパッケージインストール（フロントエンド）、mypy --install-types（バックエンド）
2. 設定ファイル確認: pyproject.toml、tsconfig.json

### リントエラー

**症状:** make lintでエラー、ESLintまたはruffエラー

**解決方法:**
1. 自動修正: `npm run lint:fix`（フロントエンド）、`ruff format . && ruff check . --fix`（バックエンド）
2. 特定エラー無視: `# type: ignore[error-name]`（Python）、`// eslint-disable-next-line`（TypeScript）

## その他の一般的な問題

### メモリ不足

**症状:** コンテナがOOMKilled、ビルドが途中で停止

**解決方法:**
1. Docker Desktopメモリ割当増加: 最低8GB、推奨16GB
2. 不要コンテナ停止: `docker system prune -a`

### ホットリロードが動作しない

**症状:** コード変更が反映されない、手動リロード必要

**解決方法:**
1. ボリュームマウント確認: docker-compose.ymlのvolumes設定
2. 開発サーバー再起動: `docker-compose restart backend frontend`

## 問題が解決しない場合

1. GitHubのIssues確認: 既知の問題と解決方法
2. ログ詳細確認: `docker-compose logs -f --tail=100`
3. 環境完全リセット: `make clean-all && make setup-dev`（データ削除注意）

## MakefileのTTY問題

### docker-compose execでTTYエラー

**症状:** make test実行時に"the input device is not a TTY"エラー

**原因:** Makefileからdocker-compose exec実行時、TTYが利用不可

**解決方法:** docker-compose execコマンドに-Tフラグを追加（実装済み）

## テスト・型・リントエラーの解決（2025/06/18）

### 依存関係更新後の大量エラー

**症状:** バックエンドテスト16件失敗、型チェックエラー35件、リントエラー710件

**主な修正内容:**

1. **テストエラー修正**
   - 戦闘統合テスト: データベースクエリのモックをタプル返却に修正
   - Geminiクライアント: langchain-google-genai 2.1.5対応のモック方式に変更
   - タイムゾーン: datetime.now(timezone.utc)→datetime.now(UTC)に統一

2. **型チェックエラー修正**
   - バックエンド: Null処理追加、不要な型注釈削除
   - フロントエンド: オプショナル属性追加、Function型を具体的な型に変更

3. **リントエラー修正**
   - 自動修正: ruff/ESLintの自動修正機能使用
   - 手動修正: 未使用変数処理、命名規則統一、インポート整理

**結果:** 全テスト成功（195件）、型チェック・リントエラー0件達成

## Gemini APIの問題

### temperatureパラメータエラー

**症状:** langchain-google-genai 2.1.5でtemperature設定エラー

**解決方法:**
1. model_kwargs使用: temperatureをmodel_kwargs内で設定
2. 範囲制限: temperature値を0.0-1.0に制限（Field検証）

### Gemini 2.5モデルの更新

**症状:** プレビュー版モデル使用による不安定性

**解決方法:** 安定版"gemini-2.5-pro"に統一（config.py、gemini_client.py）

## Alembicマイグレーション関連

### Alembicによる統一スキーマ管理（2025-06-18更新）

**現在の設定:**
- 全環境でAlembic使用のスキーマ管理
- SQLModel.create_all()は使用禁止
- create_db_and_tables()は後方互換性のため残存（実際には何もしない）

### SQLModelモデルの自動検出失敗

**問題:** 新モデル追加時、--autogenerateで空のマイグレーション生成

**原因:**
1. SQLModelの自動テーブル作成
2. 既存テーブルのため差分未検出
3. PostgreSQL ENUMタイプの重複

**解決方法:**
1. alembic/env.pyにモデルインポート追加
2. 開発環境: `make db-reset && make db-migrate`
3. 既存DB: `alembic stamp head`で現状認識

**推奨事項:**
- モデル追加時は必ずenv.pyにインポート
- 手動マイグレーション禁止（--autogenerate必須）
- docker-compose exec -T使用（TTYエラー回避）

## データベース初期化の問題

### 古いデータベース名の参照

**症状:** FATAL: database 'logverse' does not exist（プロジェクト名変更後）

**解決方法:**
1. SQL初期化スクリプト修正: \c gestaloka;に変更
2. DB再初期化: `make db-reset && make init-db`

### Pytestの非推奨警告

**症状:** asyncio_default_fixture_loop_scope未設定警告

**解決方法:** pyproject.tomlに`asyncio_default_fixture_loop_scope = "function"`追加

---

*このドキュメントは問題が発生した際に随時更新されます。*