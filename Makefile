# GESTALOKA開発用Makefile

# デフォルトターゲット
.PHONY: help
help: ## ヘルプを表示
	@echo "利用可能なコマンド:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# 環境設定
.PHONY: setup
setup: ## 初期セットアップ
	@echo "初期セットアップを開始します..."
	@if [ ! -f .env ]; then cp .env.example .env; echo ".envファイルを作成しました。APIキーを設定してください。"; fi
	@echo "セットアップ完了"

.PHONY: setup-dev
setup-dev: ## 完全な開発環境セットアップ
	@echo "完全な開発環境をセットアップします..."
	./scripts/setup-dev.sh

.PHONY: init-db
init-db: ## データベースを初期化
	@echo "データベースを初期化します..."
	docker-compose exec neo4j cypher-shell -u neo4j -p gestaloka_neo4j_password < /var/lib/neo4j/import/01_schema.cypher
	docker-compose exec neo4j cypher-shell -u neo4j -p gestaloka_neo4j_password < /var/lib/neo4j/import/02_initial_data.cypher
	docker-compose exec backend alembic upgrade head

.PHONY: init-keycloak
init-keycloak: ## KeyCloakレルムを初期化
	@echo "KeyCloakレルムを初期化します..."
	./keycloak/import-realm.sh

# Docker操作
.PHONY: build
build: ## Dockerイメージをビルド
	docker-compose build

.PHONY: up
up: ## 全サービスを起動
	docker-compose up -d

.PHONY: down
down: ## 全サービスを停止
	docker-compose down

.PHONY: restart
restart: down up ## 全サービスを再起動

.PHONY: logs
logs: ## ログを表示
	docker-compose logs -f

.PHONY: logs-backend
logs-backend: ## バックエンドのログを表示
	docker-compose logs -f backend

.PHONY: logs-frontend
logs-frontend: ## フロントエンドのログを表示
	docker-compose logs -f frontend

.PHONY: logs-celery
logs-celery: ## Celeryのログを表示
	docker-compose logs -f celery-worker celery-beat

# データベース操作
.PHONY: db-reset
db-reset: ## データベースをリセット
	docker-compose down -v
	docker-compose up -d postgres neo4j redis
	@echo "データベースをリセットしました"

.PHONY: db-migrate
db-migrate: ## データベースマイグレーション実行
	docker-compose exec backend alembic upgrade head

.PHONY: db-shell-postgres
db-shell-postgres: ## PostgreSQLシェルに接続
	docker-compose exec postgres psql -U gestaloka_user -d gestaloka

.PHONY: db-shell-neo4j
db-shell-neo4j: ## Neo4jシェルに接続
	docker-compose exec neo4j cypher-shell -u neo4j -p gestaloka_neo4j_password

# 開発用
.PHONY: dev
dev: ## 開発環境を起動
	docker-compose up -d postgres neo4j redis keycloak keycloak-db
	@echo "データベースとKeyCloakが起動しました"
	@echo "バックエンド: cd backend && uvicorn app.main:app --reload"
	@echo "フロントエンド: cd frontend && npm run dev"

.PHONY: dev-backend
dev-backend: ## バックエンドのみ起動
	docker-compose up -d postgres neo4j redis
	@echo "バックエンド用のサービスが起動しました"

.PHONY: dev-full
dev-full: ## 完全な開発環境を起動
	docker-compose up

# テスト
.PHONY: test
test: ## 全テストを実行
	docker-compose exec backend pytest
	docker-compose exec frontend npm test

.PHONY: test-backend
test-backend: ## バックエンドテストを実行
	docker-compose exec backend pytest

.PHONY: test-frontend
test-frontend: ## フロントエンドテストを実行
	docker-compose exec frontend npm test

# リント・フォーマット
.PHONY: lint
lint: ## リントを実行
	docker-compose exec backend ruff check .
	docker-compose exec frontend npm run lint

.PHONY: format
format: ## コードフォーマットを実行
	docker-compose exec backend ruff format .
	docker-compose exec frontend npm run format

.PHONY: typecheck
typecheck: ## 型チェックを実行
	docker-compose exec backend mypy .
	docker-compose exec frontend npm run typecheck

# クリーンアップ
.PHONY: clean
clean: ## 不要なコンテナとイメージを削除
	docker-compose down -v
	docker system prune -f

.PHONY: clean-all
clean-all: ## 全Dockerリソースを削除
	docker-compose down -v
	docker system prune -af

.PHONY: fix-permissions
fix-permissions: ## Neo4jスキーマディレクトリの権限を修正
	@echo "Neo4jスキーマディレクトリの権限を修正します..."
	@./scripts/fix-neo4j-permissions.sh

# モニタリング
.PHONY: flower
flower: ## Celery Flowerを起動
	@echo "Celery Flower: http://localhost:5555"
	docker-compose up -d flower

.PHONY: keycloak
keycloak: ## KeyCloakを起動
	@echo "KeyCloak Admin: http://localhost:8080/admin"
	@echo "Username: admin"
	@echo "Password: admin_password"
	docker-compose up -d keycloak

.PHONY: neo4j-browser
neo4j-browser: ## Neo4jブラウザを開く
	@echo "Neo4j Browser: http://localhost:7474"
	@echo "Username: neo4j"
	@echo "Password: gestaloka_neo4j_password"

# 便利コマンド
.PHONY: shell-backend
shell-backend: ## バックエンドコンテナにシェル接続
	docker-compose exec backend bash

.PHONY: shell-frontend
shell-frontend: ## フロントエンドコンテナにシェル接続
	docker-compose exec frontend sh

.PHONY: status
status: ## サービスステータスを表示
	docker-compose ps

.PHONY: health
health: ## ヘルスチェックを実行
	@echo "=== サービスヘルスチェック ==="
	@echo "PostgreSQL:"
	@docker-compose exec postgres pg_isready -U gestaloka_user -d gestaloka || echo "❌ PostgreSQL not ready"
	@echo "Neo4j:"
	@docker-compose exec neo4j cypher-shell -u neo4j -p gestaloka_neo4j_password 'RETURN "OK"' || echo "❌ Neo4j not ready"
	@echo "Redis:"
	@docker-compose exec redis redis-cli ping || echo "❌ Redis not ready"
	@echo "Backend:"
	@curl -s http://localhost:8000/health > /dev/null && echo "✅ Backend healthy" || echo "❌ Backend not ready"
	@echo "Frontend:"
	@curl -s http://localhost:3000 > /dev/null && echo "✅ Frontend healthy" || echo "❌ Frontend not ready"

.PHONY: urls
urls: ## 重要なURLを表示
	@echo "=== 重要なURL ==="
	@echo "フロントエンド:      http://localhost:3000"
	@echo "バックエンドAPI:     http://localhost:8000"
	@echo "API Docs:          http://localhost:8000/docs"
	@echo "KeyCloak Admin:    http://localhost:8080/admin"
	@echo "Neo4j Browser:     http://localhost:7474"
	@echo "Celery Flower:     http://localhost:5555"