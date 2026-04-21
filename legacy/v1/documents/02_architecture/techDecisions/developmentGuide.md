# 開発ガイド - ゲスタロカ (Gestaloka)

このファイルには、開発環境のセットアップ手順、開発ツール、トラブルシューティングが記載されています。

## 開発環境セットアップ

### 必要な環境変数

```bash
# .env.example
# 認証（KeyCloak - 設計上は使用予定だが現在未実装）
KEYCLOAK_SERVER_URL=http://localhost:8080
KEYCLOAK_CLIENT_ID=gestaloka
KEYCLOAK_CLIENT_SECRET=your-secret

# 現在の認証（独自JWT）
SECRET_KEY=your-secret-key  # JWT署名用
ACCESS_TOKEN_EXPIRE_MINUTES=11520  # 8日間

# データベース
DATABASE_URL=postgresql://user:pass@localhost/gestaloka
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password

# Redis
REDIS_URL=redis://localhost:6379

# LLM
GOOGLE_API_KEY=your-api-key

# アプリケーション
SECRET_KEY=your-secret-key
ENVIRONMENT=development
```

### 開発ツール

**推奨VSCode拡張:**
- Python: Pylance, Python
- TypeScript: ESLint, Prettier
- その他: Docker, GitLens, Thunder Client

**pre-commitフック:**
```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/charliermarsh/ruff-pre-commit
    rev: v0.0.292
    hooks:
      - id: ruff
      - id: ruff-format
  
  - repo: https://github.com/pre-commit/mirrors-eslint
    rev: v8.0.0
    hooks:
      - id: eslint
        files: \.[jt]sx?$
```

## トラブルシューティング

### よくある問題と解決策

**1. Docker環境でのホットリロードが効かない**
```yaml
# docker-compose.ymlでvolumesを正しく設定
volumes:
  - ./frontend/src:/app/src
  - ./frontend/public:/app/public
```

**2. Neo4jの接続エラー**
```python
# BOLT プロトコルの明示的な指定
from neo4j import GraphDatabase

driver = GraphDatabase.driver(
    "bolt://localhost:7687",  # httpではなくbolt
    auth=("neo4j", "password")
)
```

**3. CORSエラー**
```python
# FastAPIでのCORS設定
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## 開発ツールと作業フロー

### 開発コマンド体系 ✅ **実装済み**

**Makefile統合管理:**
```bash
# 基本操作
make setup-dev      # 完全自動セットアップ
make dev           # 開発用サービス起動
make dev-full      # 全サービス起動
make health        # ヘルスチェック

# データベース操作  
make init-db       # DB初期化
make db-reset      # DB完全リセット
make db-migrate    # マイグレーション実行

# 開発支援
make test          # 全テスト実行
make lint          # リント実行
make typecheck     # 型チェック実行
make format        # コードフォーマット

# 監視・デバッグ
make logs          # 全ログ表示
make logs-backend  # バックエンドログ
make flower        # Celery監視
make urls          # 重要URL一覧表示
```

**自動化スクリプト:** ✅ **実装済み**
- `scripts/setup-dev.sh`: 完全自動環境構築
- カラー付きログ出力
- エラーハンドリング
- ヘルスチェック統合

**Docker経由の開発コマンド:** ✅ **実装済み**
```bash
# リント・型チェック（Docker経由）
make lint              # 全リント実行
make typecheck         # 全型チェック実行
make format            # コードフォーマット

# 直接Docker実行
docker-compose exec frontend npm run typecheck
docker-compose exec frontend npm run lint
docker-compose exec backend ruff check .
docker-compose exec backend ruff format .
docker-compose exec backend mypy .

# マイグレーション（Docker経由）
make db-migrate        # マイグレーション実行
docker-compose exec backend alembic upgrade head
docker-compose exec backend alembic revision --autogenerate -m "message"
```

### Docker開発体験 ✅ **実装済み (更新済み 2025/06/15)**

**9サービス統合環境:**
- PostgreSQL 17 (メインDB、最新安定版)
- Neo4j 5.26 LTS (グラフDB、長期サポート版)  
- Redis 8 (キャッシュ・メッセージブローカー、最新安定版)
- Keycloak 26.2 (認証、最新版)
- FastAPI Backend (Python 3.11)
- React Frontend (Node.js 18)
- Celery Worker (非同期タスク処理)
- Celery Beat (定期タスクスケジューラー)
- Flower (Celery監視ツール)

**開発者エクスペリエンス:**
```yaml
# ボリューム最適化（ホットリロード対応）
volumes:
  - ./backend:/app              # バックエンドソース
  - ./frontend:/app             # フロントエンドソース  
  - /app/node_modules           # node_modules分離
  - backend_logs:/app/logs      # ログ永続化

# ヘルスチェック統合
healthcheck:
  test: ["CMD-SHELL", "curl -f http://localhost:8000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

### テスト戦略 ✅ **基盤準備完了**

**フロントエンド:**
- Vitest (高速テストランナー)
- React Testing Library (コンポーネントテスト)
- MSW (APIモック)

**バックエンド:**
- pytest (単体・統合テスト)
- pytest-asyncio (非同期テスト)
- TestClient (FastAPIテスト)

**テスト実行パターン（Docker経由推奨）:**
```bash
# 並行テスト実行（Docker経由）
make test              # 全テスト並行実行
make test-backend      # Pythonテスト（Docker経由）
make test-frontend     # TypeScriptテスト（Docker経由）

# 直接Docker実行
docker-compose exec backend pytest
docker-compose exec frontend npm test

# ウォッチモード（開発時）
docker-compose exec frontend npm run test:watch
docker-compose exec backend pytest --watch

# ローカル実行（Docker起動済みの場合のみ）
cd frontend && npm test
cd backend && pytest
```