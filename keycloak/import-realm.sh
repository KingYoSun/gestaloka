#!/bin/bash
# KeyCloak レルム自動インポートスクリプト

echo "=== KeyCloak レルムインポート開始 ==="

# KeyCloakの起動を待機
echo "KeyCloakの起動を待機中..."
while ! curl -s http://localhost:8080/health > /dev/null; do
    echo "KeyCloakの起動を待機中... (5秒後に再試行)"
    sleep 5
done

echo "KeyCloakが起動しました"

# 管理者認証
echo "管理者認証中..."
ADMIN_TOKEN=$(curl -s -X POST \
  "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin" \
  -d "password=admin_password" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" | jq -r '.access_token')

if [ "$ADMIN_TOKEN" = "null" ] || [ -z "$ADMIN_TOKEN" ]; then
    echo "❌ 管理者認証に失敗しました"
    exit 1
fi

echo "✅ 管理者認証に成功しました"

# レルムの存在チェック
echo "Gestalokaレルムの存在をチェック中..."
REALM_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8080/admin/realms/gestaloka")

if [ "$REALM_EXISTS" = "200" ]; then
    echo "⚠️  Gestalokaレルムは既に存在します"
    echo "既存のレルムを使用します"
else
    echo "Gestalokaレルムを作成中..."
    
    # レルムインポート
    IMPORT_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d @/opt/keycloak/data/import/realm-export.json \
      "http://localhost:8080/admin/realms")
    
    if [ "$IMPORT_RESULT" = "201" ]; then
        echo "✅ Gestalokaレルムが正常に作成されました"
    else
        echo "❌ レルム作成に失敗しました (HTTP: $IMPORT_RESULT)"
        exit 1
    fi
fi

# テストユーザーの作成
echo "テストユーザーを作成中..."
TEST_USER_RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@gestaloka.com",
    "firstName": "Test",
    "lastName": "User",
    "enabled": true,
    "emailVerified": true,
    "credentials": [{
      "type": "password",
      "value": "testpassword",
      "temporary": false
    }]
  }' \
  "http://localhost:8080/admin/realms/gestaloka/users")

if [ "$TEST_USER_RESULT" = "201" ]; then
    echo "✅ テストユーザーが作成されました"
    echo "   ユーザー名: testuser"
    echo "   パスワード: testpassword"
elif [ "$TEST_USER_RESULT" = "409" ]; then
    echo "⚠️  テストユーザーは既に存在します"
else
    echo "⚠️  テストユーザー作成に失敗しました (HTTP: $TEST_USER_RESULT)"
fi

echo "=== KeyCloak設定完了 ==="
echo ""
echo "🔗 KeyCloak管理コンソール: http://localhost:8080/admin"
echo "   管理者ユーザー: admin"
echo "   管理者パスワード: admin_password"
echo ""
echo "🎮 Gestalokaレルム:"
echo "   テストユーザー: testuser"
echo "   テストパスワード: testpassword"
echo ""