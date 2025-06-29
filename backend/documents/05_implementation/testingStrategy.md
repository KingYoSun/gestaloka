# テスト戦略

最終更新: 2025年6月30日

## 概要

ゲスタロカプロジェクトのテスト戦略は、品質保証と開発効率のバランスを重視し、段階的なテストピラミッドアプローチを採用しています。

## テスト環境

### PostgreSQLベースのテスト環境（2025年6月30日追加）

#### 特徴
- **実データベース使用**: 本番環境と同じPostgreSQLを使用
- **トランザクション分離**: 各テストは独立したトランザクション内で実行
- **自動クリーンアップ**: テスト終了時に自動的にロールバック

#### 設定
```python
# テスト用データベース
TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/gestaloka_test"

# conftest.pyでの設定
@pytest.fixture
def db_session():
    """各テストで独立したデータベースセッションを提供"""
    connection = engine.connect()
    transaction = connection.begin()
    
    session = Session(bind=connection)
    yield session
    
    session.close()
    transaction.rollback()
    connection.close()
```

#### 利点
- データベース固有の機能（制約、トリガー、関数）のテスト
- 本番環境により近い状態でのテスト
- SQLインジェクションなどのセキュリティテスト
- パフォーマンステスト

### Docker環境でのテスト実行

```bash
# テスト用データベースのセットアップ
make test-db-setup

# 全テスト実行（DOCKER_ENV環境変数を使用）
make test

# バックエンドテストのみ
make test-backend

# 特定のテストファイルを実行
docker-compose exec -T backend sh -c "DOCKER_ENV=true pytest tests/test_battle_integration_postgres.py -xvs"
```

#### 環境変数の使用
- **DOCKER_ENV=true**: Docker環境内でのテスト実行を示す
- この環境変数により、conftest.pyが自動的にpostgresホスト名を使用

### 実装の詳細

#### conftest.pyの改修内容
```python
# Docker環境の自動検出
if os.environ.get("DOCKER_ENV") or os.path.exists("/.dockerenv"):
    TEST_DATABASE_URL = "postgresql://gestaloka_user:gestaloka_password@postgres:5432/gestaloka_test"
else:
    TEST_DATABASE_URL = "postgresql://gestaloka_user:gestaloka_password@localhost:5432/gestaloka_test"

# テストデータベースエンジン（セッションスコープ）
@pytest.fixture(scope="session")
def test_engine():
    """テスト用データベースエンジンを作成し、マイグレーションを実行"""
    # テストデータベースの作成とマイグレーション
    # Alembicを使用して本番と同じスキーマを適用
    
# トランザクションベースのセッション（関数スコープ）
@pytest.fixture(scope="function")
def session(test_engine):
    """各テストに独立したトランザクションを提供"""
    connection = test_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    
    yield session
    
    session.close()
    transaction.rollback()
    connection.close()
```

### 移行実績（2025年6月30日）

#### 移行前（SQLite）
- インメモリデータベース使用
- 制約やトリガーの一部が未サポート
- 本番環境との差異によるバグ見逃しリスク

#### 移行後（PostgreSQL）  
- 本番環境と同一のデータベースエンジン
- 全ての制約とトリガーが正しく動作
- 98.8%のテスト成功率（82/83テスト）

#### 主な修正項目
1. **test_battle_integration_postgres.py**: 戦闘統合テストのPostgreSQL対応
2. **test_sp_purchase.py**: SP購入テストの実行確認
3. **test_database.py**: データベース接続とトランザクションテスト
4. **scripts/test_db_setup.py**: テストデータベース初期化スクリプト

# カバレッジ付き実行
docker-compose exec backend pytest --cov=app tests/
```

## テストレベル

### 1. ユニットテスト
- **対象**: 個別の関数、クラス、メソッド
- **ツール**: pytest（バックエンド）、Vitest（フロントエンド）
- **実行頻度**: コミット前、CI/CD

### 2. 統合テスト
- **対象**: API、データベース操作、外部サービス連携
- **特徴**: PostgreSQLベースの実環境テスト
- **例**: 
  - 戦闘システムの統合テスト
  - SP購入システムの統合テスト
  - WebSocket通信テスト

### 3. E2Eテスト
- **対象**: ユーザーシナリオ全体
- **ツール**: Playwright（計画中）
- **実行頻度**: リリース前、重要機能変更時

## テストカテゴリー

### APIテスト
```python
def test_create_character(client, db_session):
    """キャラクター作成APIのテスト"""
    response = client.post(
        "/api/v1/characters/",
        json={"name": "テストキャラ", "appearance": "..."}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "テストキャラ"
```

### データベーステスト
```python
def test_character_persistence(db_session):
    """キャラクターの永続化テスト"""
    character = Character(name="テスト", user_id=1)
    db_session.add(character)
    db_session.commit()
    
    # 別セッションで取得
    result = db_session.query(Character).filter_by(name="テスト").first()
    assert result is not None
    assert result.name == "テスト"
```

### AIエージェントテスト
```python
def test_gm_ai_response(mock_gemini):
    """GM AIのレスポンステスト"""
    mock_gemini.return_value = "テスト応答"
    response = gm_ai.generate_response("テスト入力")
    assert "テスト応答" in response
```

## テストデータ管理

### フィクスチャ
```python
@pytest.fixture
def test_user(db_session):
    """テスト用ユーザーを作成"""
    user = User(
        keycloak_id="test-id",
        username="testuser",
        email="test@example.com"
    )
    db_session.add(user)
    db_session.commit()
    return user

@pytest.fixture
def test_character(db_session, test_user):
    """テスト用キャラクターを作成"""
    character = Character(
        name="テストキャラクター",
        user_id=test_user.id,
        level=1,
        hp=100,
        mp=50
    )
    db_session.add(character)
    db_session.commit()
    return character
```

### ファクトリーパターン（計画中）
```python
class CharacterFactory:
    """キャラクター生成ファクトリー"""
    @staticmethod
    def create(**kwargs):
        defaults = {
            "name": "デフォルトキャラ",
            "level": 1,
            "hp": 100,
            "mp": 50
        }
        defaults.update(kwargs)
        return Character(**defaults)
```

## CI/CD統合

### GitHub Actions設定
```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
    - uses: actions/checkout@v2
    - name: Run tests
      run: |
        docker-compose up -d
        make test
        make coverage-report
```

## テストのベストプラクティス

### 1. テストの独立性
- 各テストは他のテストに依存しない
- テストの実行順序に依存しない
- データベースの状態をクリーンに保つ

### 2. 明確な命名
```python
# 良い例
def test_character_creation_with_valid_data_succeeds():
    pass

def test_character_creation_with_duplicate_name_fails():
    pass

# 悪い例
def test_character():
    pass
```

### 3. AAA原則
```python
def test_sp_purchase():
    # Arrange（準備）
    user = create_test_user()
    initial_sp = 100
    
    # Act（実行）
    result = purchase_sp(user.id, amount=50)
    
    # Assert（検証）
    assert result.success is True
    assert user.sp == initial_sp + 50
```

### 4. モックの適切な使用
```python
# 外部APIのモック
@patch("app.services.gemini.generate")
def test_ai_response(mock_generate):
    mock_generate.return_value = "モックレスポンス"
    # テスト実行
```

## パフォーマンステスト

### 負荷テスト
```python
@pytest.mark.performance
def test_concurrent_character_creation(db_session):
    """同時キャラクター作成のパフォーマンステスト"""
    import concurrent.futures
    
    def create_character(index):
        return Character(name=f"キャラ{index}", user_id=1)
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(create_character, i) for i in range(100)]
        results = [f.result() for f in futures]
    
    assert len(results) == 100
```

## セキュリティテスト

### SQLインジェクション対策
```python
def test_sql_injection_prevention(client):
    """SQLインジェクション攻撃への耐性テスト"""
    malicious_input = "'; DROP TABLE characters; --"
    response = client.post(
        "/api/v1/characters/search",
        json={"name": malicious_input}
    )
    # エラーにならず、安全に処理されることを確認
    assert response.status_code in [200, 404]
```

## テストカバレッジ目標

- **全体**: 80%以上
- **コアロジック**: 90%以上
- **API**: 100%
- **データベース操作**: 90%以上

## 今後の計画

1. **E2Eテストの導入**
   - Playwrightを使用したブラウザテスト
   - ユーザーシナリオベースのテスト

2. **パフォーマンステストの強化**
   - 負荷テストツール（Locust）の導入
   - データベースクエリの最適化テスト

3. **セキュリティテストの拡充**
   - OWASP ZAPの導入
   - 定期的なセキュリティスキャン

4. **テストデータ管理の改善**
   - ファクトリーボーイの導入
   - シードデータの整備