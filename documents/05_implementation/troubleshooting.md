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

### 問題: docker compose up後にneo4j/schemaディレクトリの権限が変更される

**症状:**
- `docker compose up`実行後、`neo4j/schema`ディレクトリがrootユーザー所有になる
- gitで追跡できなくなる（Permission denied）
- ローカルでファイルを編集できなくなる

**原因:**
Neo4jコンテナがボリュームマウントされたディレクトリの所有権を変更するため

**解決方法:**

1. **権限を修正する（一時的な解決）**
```bash
# 権限修正スクリプトを実行
make fix-permissions

# または手動で実行
sudo chown -R $(id -u):$(id -g) neo4j/schema
sudo chmod -R 755 neo4j/schema
```

2. **根本的な解決（実装済み）**
docker-compose.ymlで以下の設定を使用：
```yaml
volumes:
  - neo4j_import:/var/lib/neo4j/import
  - ./neo4j/schema:/tmp/neo4j-schema:ro  # read-onlyマウント
entrypoint: >
  bash -c "
    echo 'Copying schema files...' &&
    mkdir -p /var/lib/neo4j/import &&
    cp -f /tmp/neo4j-schema/* /var/lib/neo4j/import/ 2>/dev/null || true &&
    echo 'Schema files copied' &&
    exec /startup/docker-entrypoint.sh neo4j
  "
```

この設定により：
- ホストのファイルシステムの権限は変更されない
- gitで正常に追跡可能
- Neo4jは必要なファイルにアクセス可能

### 予防策

1. **Read-onlyマウント**: スキーマファイルを一時ディレクトリにread-onlyでマウント
2. **起動時コピー**: コンテナ起動時にファイルをコピーして使用
3. **別ボリューム使用**: importディレクトリはDockerボリュームを使用

これにより、ホストのファイルシステムの権限が変更されることを防いでいます。

### コンテナの再起動が必要な場合

権限修正後、Neo4jコンテナを再起動する必要がある場合があります：

```bash
# Neo4jコンテナのみ再起動
docker-compose restart neo4j

# または全体を再起動
docker-compose down
docker-compose up -d
```

## Docker環境の問題

### 問題: サービスが起動しない

**症状:**
- `docker-compose up`でエラーが発生
- 特定のサービスがunhealthyになる

**解決方法:**

1. **ログを確認**
```bash
# 全サービスのログ
make logs

# 特定サービスのログ
docker-compose logs -f backend
docker-compose logs -f neo4j
```

2. **リソースをクリーンアップ**
```bash
# コンテナとボリュームを削除
make clean

# 完全にクリーンアップ
make clean-all
```

3. **個別にサービスを起動**
```bash
# データベースのみ起動
docker-compose up -d postgres neo4j redis

# 問題のあるサービスを個別に起動
docker-compose up backend
```

### 問題: ポートが既に使用されている

**症状:**
- `bind: address already in use`エラー

**解決方法:**

1. **使用中のプロセスを確認**
```bash
# ポート使用状況を確認
sudo lsof -i :8000  # Backend
sudo lsof -i :3000  # Frontend
sudo lsof -i :5432  # PostgreSQL
sudo lsof -i :7474  # Neo4j
```

2. **プロセスを終了**
```bash
# プロセスIDを確認してkill
kill -9 <PID>
```

## 依存関係の問題

### 問題: langchain-google-genaiバージョン互換性

**症状:**
- langchain-google-genai 2.1.5とgoogle-generativeaiのバージョン競合
- `AttributeError: 'NoneType' object has no attribute 'split'`

**解決方法:**

1. **google-generativeaiをrequirements.txtから削除**
```python
# requirements.txt
langchain==0.3.25
langchain-google-genai==2.1.5
# google-generativeai==0.8.5  # langchain-google-genaiに含まれるため削除
```

2. **Dockerイメージを再ビルド**
```bash
docker-compose build --no-cache backend
```

### 問題: Pythonパッケージのバージョン競合

**症状:**
- `pip install`でエラー
- 依存関係の解決に失敗

**解決方法:**

1. **requirements.txtを再生成**
```bash
cd backend
pip-compile requirements.in --resolver=backtracking
```

2. **キャッシュをクリア**
```bash
docker-compose build --no-cache backend
```

### 問題: npm installでエラー

**症状:**
- node_modulesのインストールに失敗
- peer dependencyの警告

**解決方法:**

1. **node_modulesを削除して再インストール**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

2. **Dockerで再ビルド**
```bash
docker-compose build --no-cache frontend
```

## API接続の問題

### 問題: CORSエラー

**症状:**
- ブラウザコンソールでCORSエラー
- APIリクエストがブロックされる

**解決方法:**

1. **バックエンドのCORS設定を確認**
```python
# backend/app/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

2. **環境変数を確認**
```bash
# .envファイル
VITE_API_URL=http://localhost:8000
```

### 問題: 認証エラー（401 Unauthorized）

**症状:**
- ログイン後もAPIリクエストが401エラー
- JWTトークンが無効

**解決方法:**

1. **トークンの有効期限を確認**
```bash
# .envファイル
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

2. **ローカルストレージをクリア**
```javascript
// ブラウザのコンソールで実行
localStorage.clear()
// ページをリロード
location.reload()
```

## 開発環境の問題

### 問題: 型チェックエラー

**症状:**
- `make typecheck`でエラー
- TypeScriptまたはmypyのエラー

**解決方法:**

1. **型定義を更新**
```bash
# フロントエンド
cd frontend
npm install @types/node @types/react @types/react-dom

# バックエンド
cd backend
mypy --install-types
```

2. **設定ファイルを確認**
```bash
# pyproject.toml（バックエンド）
# tsconfig.json（フロントエンド）
```

### 問題: リントエラー

**症状:**
- `make lint`でエラー
- ESLintまたはruffのエラー

**解決方法:**

1. **自動修正を実行**
```bash
# フロントエンド
cd frontend
npm run lint:fix

# バックエンド
cd backend
ruff format .
ruff check . --fix
```

2. **特定のエラーを無視**
```python
# Python
# type: ignore[error-name]

# TypeScript
// eslint-disable-next-line rule-name
```

## その他の一般的な問題

### 問題: メモリ不足

**症状:**
- コンテナがOOMKilledになる
- ビルドが途中で止まる

**解決方法:**

1. **Docker Desktopのメモリ割り当てを増やす**
- Docker Desktop設定 → Resources → Memory
- 最低8GB、推奨16GB

2. **不要なコンテナを停止**
```bash
docker system prune -a
```

### 問題: ホットリロードが動作しない

**症状:**
- コード変更が反映されない
- 手動でリロードが必要

**解決方法:**

1. **ボリュームマウントを確認**
```yaml
# docker-compose.yml
volumes:
  - ./backend:/app
  - ./frontend:/app
```

2. **開発サーバーを再起動**
```bash
docker-compose restart backend frontend
```

## 問題が解決しない場合

1. **GitHubのIssuesを確認**
   - 既知の問題と解決方法が記載されている可能性があります

2. **ログを詳細に確認**
   ```bash
   # Dockerログ
   docker-compose logs -f --tail=100
   
   # アプリケーションログ
   tail -f backend/logs/*.log
   ```

3. **環境を完全にリセット**
   ```bash
   # 警告: すべてのデータが削除されます
   make clean-all
   make setup-dev
   ```

---

## MakefileのTTY問題

### 問題: docker-compose execでTTYエラー

**症状:**
- `make test`などのコマンド実行時に`the input device is not a TTY`エラー

**原因:**
Makefileからdocker-compose execを実行する際、TTYが利用できないため

**解決方法:**

1. **Makefileのdocker-compose execコマンドに-Tフラグを追加**
```makefile
test-backend: ## バックエンドテストを実行
	docker-compose exec -T backend sh -c "cd /app && python -m pytest -v"

lint-backend: ## バックエンドのリントを実行  
	docker-compose exec -T backend sh -c "cd /app && ruff check . && ruff format --check ."
```

## テスト・型・リントエラーの解決（2025/06/18）

### 問題: 依存関係更新後の大量のエラー

**症状:**
- バックエンドテスト: 16件失敗
- 型チェックエラー: バックエンド5件、フロントエンド30件
- リントエラー: バックエンド705件、フロントエンド5件+28警告

**解決方法:**

#### 1. テストエラーの修正

**戦闘統合テスト（6件）**
```python
# tests/test_battle_integration.py
# データベースクエリのモックがタプルを返すように修正
def setup_db_mocks(mock_db, mock_game_session, mock_character):
    def exec_side_effect(query):
        result = Mock()
        result.first.return_value = (mock_game_session, mock_character)  # タプルで返す
        return result
```

**Geminiクライアントテスト（5件）**
```python
# tests/test_gemini_client.py
# langchain-google-genai 2.1.5での新しいモック方式
with patch("app.services.ai.gemini_client.ChatGoogleGenerativeAI") as mock_llm:
    mock_llm_instance = mock_llm.return_value
    mock_llm_instance.astream = mock_astream
```

**タイムゾーンエラー（1件）**
```python
# datetime.now(timezone.utc) → datetime.now(UTC) に変更
from datetime import UTC, datetime
current_time = datetime.now(UTC)
```

#### 2. 型チェックエラーの修正

**バックエンド**
```python
# alembic/env.py - Null処理
configuration = config.get_section(config.config_ini_section)
if configuration is None:
    configuration = {}

# app/services/game_session.py - 型注釈の削除
initial_battle_choices = self.battle_service.get_battle_choices(battle_data, True)
```

**フロントエンド**
```typescript
// BattleStatus.tsx - level属性をオプショナルに
interface Combatant {
  level?: number;
}

// useWebSocket.test.ts - Function型を具体的な型に
(onConnectedCall[1] as (data: { socketId: string }) => void)({ socketId: 'test-socket-id' })
```

#### 3. リントエラーの修正

**自動修正**
```bash
# バックエンド
docker-compose exec -T backend ruff check . --fix
docker-compose exec -T backend ruff format .

# フロントエンド  
make format
```

**手動修正が必要な項目**
- 未使用変数: `_`プレフィックスを追加または実際に使用
- 変数名の大文字: `MockCoordinator` → `mock_coordinator`
- 未定義のインポート: 必要に応じて追加または削除

### 結果

✅ **全テスト成功**: バックエンド174件、フロントエンド21件
✅ **型チェックエラー0件**: mypy、TypeScript共にクリーン
✅ **リントエラー0件**: ruff、ESLint共にエラーなし（警告のみ）

## Gemini APIの問題

### 問題: temperatureパラメータエラー

**症状:**
- `GenerativeServiceClient.generate_content() got an unexpected keyword argument 'temperature'`
- langchain-google-genai 2.1.5でtemperature設定方法が変更

**解決方法:**

1. **model_kwargsを使用してtemperatureを設定**
```python
# app/services/ai/gemini_client.py
kwargs: dict[str, Any] = {
    "model": self.config.model,
    "model_kwargs": {
        "temperature": self.config.temperature,
    }
}
self._llm = ChatGoogleGenerativeAI(**kwargs)
```

2. **temperatureの範囲を制限**
```python
class GeminiConfig(BaseModel):
    temperature: float = Field(default=0.7, ge=0.0, le=1.0)  # 0.0-1.0のみサポート
```

### 問題: Gemini 2.5モデルの更新

**症状:**
- プレビュー版モデルの使用

**解決方法:**

1. **安定版モデルへ更新**
```python
# app/core/config.py
LLM_MODEL: str = Field(default="gemini-2.5-pro", validation_alias="LLM_MODEL")

# app/services/ai/gemini_client.py  
model: str = Field(default="gemini-2.5-pro")
```

## Alembicマイグレーション関連

### SQLModelモデルの自動検出失敗（2025-06-18）

#### 問題
- `alembic revision --autogenerate`を実行しても、新しく追加したSQLModelモデル（LogFragment、CompletedLog等）が検出されず、空のマイグレーションファイルが生成される
- バックエンド起動時にSQLModelがテーブルを自動作成してしまい、マイグレーションとの競合が発生

#### 原因
1. **モデルの自動作成**: SQLModelがデータベース接続時に`SQLModel.metadata.create_all()`相当の処理を実行
2. **インポート順序**: `alembic/env.py`でモデルが適切にインポートされていても、既にテーブルが存在するため差分が検出されない
3. **ENUMタイプの重複**: PostgreSQLのENUMタイプが既に作成されているため、マイグレーション実行時にエラーが発生

#### 解決方法
1. **手動マイグレーションファイルの作成**
   ```python
   # alembic/versions/add_log_system_models.py
   def upgrade() -> None:
       # ENUMタイプの作成（既存チェック付き）
       op.execute("DO $$ BEGIN CREATE TYPE logfragmentrarity AS ENUM (...); EXCEPTION WHEN duplicate_object THEN null; END $$")
       
       # テーブル作成
       op.create_table('log_fragments', ...)
   ```

2. **マイグレーション状態の手動更新**
   ```bash
   # 既にテーブルが作成されている場合
   docker-compose exec -T postgres psql -U gestaloka_user -d gestaloka \
     -c "INSERT INTO alembic_version (version_num) VALUES ('add_log_system_models');"
   ```

#### 推奨事項
- **開発初期段階**: `SQLModel.metadata.create_all()`を無効化し、Alembicのみでスキーマ管理
- **モデル追加時**: 必ず`alembic/env.py`にインポートを追加
- **ENUMタイプ使用時**: PostgreSQL特有の考慮が必要（IF NOT EXISTSサポートなし）

### Docker環境でのマイグレーション実行

#### 問題
- `docker-compose run`でマイグレーションを実行すると、ネットワーク設定エラーが発生
- TTYエラーでインタラクティブコマンドが失敗

#### 解決方法
```bash
# TTYなしで実行
docker-compose exec -T backend alembic upgrade head

# または、Makefileに定義されたコマンドを使用
make db-migrate
```

## データベース初期化の問題

### 問題: 古いデータベース名の参照

**症状:**
- `FATAL: database 'logverse' does not exist`
- プロジェクト名変更後も古いDB名を参照

**解決方法:**

1. **SQL初期化スクリプトを修正**
```sql
-- sql/init/01_create_databases.sql
-- Gestalokaデータベースに接続して追加設定
\c gestaloka;
```

2. **データベースを再初期化**
```bash
make db-reset
make init-db
```

### 問題: Pytestの非推奨警告

**症状:**
- `PytestDeprecationWarning: The configuration option "asyncio_default_fixture_loop_scope" is unset`

**解決方法:**

pytest.iniまたはpyproject.tomlに設定を追加:
```toml
[tool.pytest.ini_options]
asyncio_default_fixture_loop_scope = "function"
```

---

*このドキュメントは問題が発生した際に随時更新されます。*