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

---

*このドキュメントは問題が発生した際に随時更新されます。*