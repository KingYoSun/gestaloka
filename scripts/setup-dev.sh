#!/bin/bash
# ゲスタロカ開発環境セットアップスクリプト

set -e

echo "======================================"
echo "🎮 ゲスタロカ開発環境セットアップ"
echo "======================================"

# 色付きログのための関数
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 前提条件チェック
log_info "前提条件をチェック中..."

if ! command -v docker &> /dev/null; then
    log_error "Dockerが見つかりません。Dockerをインストールしてください。"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    log_error "Docker Composeが見つかりません。Docker Composeをインストールしてください。"
    exit 1
fi

log_success "前提条件チェック完了"

# 環境変数ファイルの確認・作成
log_info "環境変数ファイルを確認中..."

if [ ! -f .env ]; then
    log_warning ".envファイルが見つかりません。.env.exampleからコピーします。"
    cp .env.example .env
    log_warning "⚠️  重要: .envファイルを編集してAPIキーを設定してください！"
    echo ""
    echo "必要な設定項目:"
    echo "- GEMINI_API_KEY: Google Gemini APIキー"
    echo "- SECRET_KEY: JWT用の秘密鍵（本番環境では強力なものに変更）"
    echo ""
    read -p "今すぐ.envファイルを編集しますか？ (y/N): " edit_env
    if [[ $edit_env =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} .env
    fi
fi

log_success "環境変数ファイル確認完了"

# Docker イメージのビルド
log_info "Dockerイメージをビルド中..."
docker-compose build --no-cache
log_success "Dockerイメージビルド完了"

# データベースサービスの起動
log_info "データベースサービスを起動中..."
docker-compose up -d postgres neo4j redis keycloak keycloak-db
log_success "データベースサービス起動完了"

# データベースの起動待機
log_info "データベースの準備完了を待機中..."

# PostgreSQLの待機
echo -n "PostgreSQL準備待機: "
while ! docker-compose exec -T postgres pg_isready -U gestaloka_user -d gestaloka > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo " ✅"

# Neo4jの待機
echo -n "Neo4j準備待機: "
while ! docker-compose exec -T neo4j cypher-shell -u neo4j -p gestaloka_neo4j_password "RETURN 1" > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo " ✅"

# Redisの待機
echo -n "Redis準備待機: "
while ! docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo " ✅"

# KeyCloakの待機
echo -n "KeyCloak準備待機: "
while ! curl -s http://localhost:8080/health > /dev/null 2>&1; do
    echo -n "."
    sleep 5
done
echo " ✅"

log_success "全データベース準備完了"

# Neo4j初期化
log_info "Neo4jを初期化中..."
if [ -f neo4j/init-neo4j.sh ]; then
    docker-compose exec neo4j bash -c "
        cp /var/lib/neo4j/import/01_schema.cypher /tmp/01_schema.cypher &&
        cp /var/lib/neo4j/import/02_initial_data.cypher /tmp/02_initial_data.cypher &&
        cypher-shell -u neo4j -p gestaloka_neo4j_password < /tmp/01_schema.cypher &&
        cypher-shell -u neo4j -p gestaloka_neo4j_password < /tmp/02_initial_data.cypher
    "
    log_success "Neo4j初期化完了"
else
    log_warning "Neo4j初期化スクリプトが見つかりません"
fi

# KeyCloak設定
log_info "KeyCloakを設定中..."
if [ -f keycloak/import-realm.sh ]; then
    # KeyCloakレルムのインポート（簡易版）
    docker-compose exec keycloak bash -c "
        /opt/keycloak/bin/kc.sh import --file /opt/keycloak/data/import/realm-export.json --override true
    " || log_warning "KeyCloakレルムのインポートに失敗しました（手動設定が必要かもしれません）"
else
    log_warning "KeyCloak設定スクリプトが見つかりません"
fi

# PostgreSQLマイグレーション実行
log_info "データベースマイグレーションを実行中..."
docker-compose up -d backend
sleep 10
docker-compose exec backend alembic upgrade head || log_warning "マイグレーション実行に失敗しました（初回起動時は正常です）"

# フロントエンド依存関係のインストール
log_info "フロントエンド依存関係をインストール中..."
if [ -d "frontend" ]; then
    cd frontend
    npm install
    cd ..
    log_success "フロントエンド依存関係インストール完了"
fi

# バックエンド依存関係のインストール（venv作成）
log_info "バックエンド開発環境をセットアップ中..."
if [ -d "backend" ]; then
    cd backend
    if [ ! -d "venv" ]; then
        python3 -m venv venv
    fi
    source venv/bin/activate
    pip install -r requirements.txt
    cd ..
    log_success "バックエンド開発環境セットアップ完了"
fi

# 全サービス起動
log_info "全サービスを起動中..."
docker-compose up -d
log_success "全サービス起動完了"

# 起動確認とヘルスチェック
log_info "サービスのヘルスチェックを実行中..."
sleep 15

# サービス状況の確認
echo ""
echo "📊 サービス状況:"
echo "=================================="

check_service() {
    local name=$1
    local url=$2
    local expected_status=${3:-200}
    
    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "$expected_status"; then
        log_success "$name: 稼働中"
        return 0
    else
        log_error "$name: 停止中"
        return 1
    fi
}

check_service "フロントエンド" "http://localhost:3000" "200"
check_service "バックエンドAPI" "http://localhost:8000/health" "200"
check_service "KeyCloak" "http://localhost:8080/health" "200"

echo ""
echo "🔗 アクセスURL:"
echo "=================================="
echo "🎮 フロントエンド:      http://localhost:3000"
echo "🔧 バックエンドAPI:     http://localhost:8000"
echo "📚 API ドキュメント:     http://localhost:8000/docs"
echo "🔐 KeyCloak管理:       http://localhost:8080/admin"
echo "📊 Neo4j ブラウザ:      http://localhost:7474"
echo "🌸 Celery Flower:      http://localhost:5555"
echo ""

echo "👤 ログイン情報:"
echo "=================================="
echo "KeyCloak管理者:"
echo "  ユーザー名: admin"
echo "  パスワード: admin_password"
echo ""
echo "Neo4j:"
echo "  ユーザー名: neo4j" 
echo "  パスワード: gestaloka_neo4j_password"
echo ""
echo "テストユーザー（作成される場合）:"
echo "  ユーザー名: testuser"
echo "  パスワード: testpassword"
echo ""

echo "🛠️  開発用コマンド:"
echo "=================================="
echo "# 全サービス停止"
echo "make down"
echo ""
echo "# ログ確認"
echo "make logs"
echo ""  
echo "# データベースリセット"
echo "make db-reset"
echo ""
echo "# ヘルスチェック"
echo "make health"
echo ""

echo "🎉 セットアップ完了！"
echo "=================================="
echo "開発を開始する準備が整いました。"
echo ""
echo "次のステップ:"
echo "1. .envファイルでAPIキーを設定（まだの場合）"
echo "2. http://localhost:3000 でフロントエンドにアクセス"
echo "3. KeyCloakでユーザー登録またはテストユーザーでログイン"
echo ""