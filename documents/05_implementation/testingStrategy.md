# テスト戦略

## 概要

GESTALOKAプロジェクトでは、品質保証のために包括的なテスト戦略を採用しています。特に、複雑なデータベース統合（PostgreSQL + Neo4j）に対応した統合テスト環境を構築しています。

## テスト分類

### 1. 単体テスト
- **対象**: 個別の関数、クラス、コンポーネント
- **モック使用**: 外部依存（DB、API）は全てモック化
- **実行環境**: ローカル/CI環境
- **ツール**: pytest（バックエンド）、Vitest（フロントエンド）

### 2. 統合テスト
- **対象**: 複数コンポーネントの連携、データベース操作
- **実データベース使用**: テスト専用のPostgreSQL/Neo4j/Redisインスタンス
- **実行環境**: Docker Compose環境
- **ツール**: pytest + docker-compose.test.yml

### 3. E2Eテスト
- **対象**: ユーザーシナリオ全体
- **計画中**: Playwright導入予定

## Neo4j統合テスト環境

### 環境構成

#### docker-compose.test.yml
テスト専用のサービスを定義し、本番環境から完全に分離：

- **Neo4j Test**: ポート7688（本番: 7687）
- **PostgreSQL Test**: ポート5433（本番: 5432）
- **Redis Test**: ポート6380（本番: 6379）

#### .env.test
テスト環境専用の環境変数：
```
NEO4J_URI=bolt://localhost:7688
DATABASE_URL=postgresql://test_user:test_password@localhost:5433/gestaloka_test
REDIS_URL=redis://localhost:6380
```

### 実装パターン

#### 1. 遅延初期化パターン
```python
class NPCGenerator:
    def __init__(self, session: Session):
        self.session = session
        self._neo4j = None
    
    @property
    def neo4j(self):
        if self._neo4j is None:
            self._neo4j = get_neo4j_session()
        return self._neo4j
```

このパターンにより、テスト時のモック注入が容易になります。

#### 2. 基底テストクラス
```python
class BaseNeo4jIntegrationTest:
    """Neo4j統合テストの基底クラス"""
    
    @classmethod
    def setup_class(cls):
        # Neo4j接続設定
        
    def setup_method(self, method):
        # 各テスト前のクリーンアップ
        
    def teardown_method(self, method):
        # 各テスト後のクリーンアップ
```

#### 3. テストデータの分離
- テスト用のプレフィックス（`test_`）を使用
- 各テスト後に自動クリーンアップ
- Cypherクエリによる確実なデータ削除

### 実行コマンド

```bash
# テスト環境の起動
make test-neo4j-up

# 統合テストの実行
make test-integration

# テスト環境の停止
make test-neo4j-down

# ローカルでの統合テスト（環境起動済みの場合）
make test-integration-local
```

## データベースクリーンアップメカニズム

### Neo4jクリーンアップ実装

#### 1. ユーティリティモジュール (`neo4j_test_utils.py`)
```python
def cleanup_all_neo4j_data():
    """Neo4jの全データを削除"""
    # テスト環境確認
    if "neo4j-test" not in neo_config.DATABASE_URL:
        return
    
    # 全リレーションシップ削除
    neo_db.cypher_query("MATCH ()-[r]->() DELETE r")
    # 全ノード削除
    neo_db.cypher_query("MATCH (n) DELETE n")

def cleanup_test_data():
    """テストプレフィックスを持つデータのみ削除"""
    neo_db.cypher_query("""
        MATCH (n)
        WHERE n.npc_id STARTS WITH 'test_'
           OR n.player_id STARTS WITH 'test_'
           OR n.location_id STARTS WITH 'test_'
        DETACH DELETE n
    """)
```

#### 2. 接続管理 (`neo4j_connection.py`)
```python
def ensure_test_connection():
    """テスト用Neo4j接続を確実に設定"""
    test_url = get_test_neo4j_url()
    if neo_config.DATABASE_URL != test_url:
        neo_config.DATABASE_URL = test_url
        # 既存接続をクリア
        if hasattr(neo_db, '_driver'):
            neo_db._driver.close()
            neo_db._driver = None
```

### PostgreSQLクリーンアップ実装

#### 1. ユーティリティモジュール (`postgres_test_utils.py`)
```python
def cleanup_all_postgres_data(engine):
    """全テーブルデータを削除（システムテーブル除く）"""
    with engine.connect() as conn:
        # 外部キー制約を一時無効化
        conn.execute(text("SET session_replication_role = 'replica';"))
        
        # 全テーブルのTRUNCATE
        result = conn.execute(text("""
            SELECT tablename FROM pg_tables 
            WHERE schemaname = 'public' 
            AND tablename NOT LIKE 'alembic%'
        """))
        
        for table in result.fetchall():
            conn.execute(text(f"TRUNCATE TABLE {table[0]} CASCADE"))
        
        # 外部キー制約を再有効化
        conn.execute(text("SET session_replication_role = 'origin';"))

def recreate_schema(engine):
    """スキーマを完全に再作成"""
    # 既存接続を切断
    conn.execute(text("""
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname = current_database() 
        AND pid <> pg_backend_pid()
    """))
    
    # スキーマ削除と再作成
    conn.execute(text("DROP SCHEMA public CASCADE"))
    conn.execute(text("CREATE SCHEMA public"))
    
    # ENUMタイプの再作成
    create_enum_types(conn)
```

#### 2. 分離された環境提供
```python
@contextmanager
def isolated_postgres_test(recreate: bool = False):
    """完全に分離されたテスト環境を提供"""
    engine = create_engine(url, pool_pre_ping=True)
    
    if recreate:
        recreate_schema(engine)
        SQLModel.metadata.create_all(engine)
    else:
        cleanup_all_postgres_data(engine)
    
    try:
        with Session(engine) as session:
            yield session
    finally:
        cleanup_all_postgres_data(engine)
        engine.dispose()  # コネクションプールをクリア
```

### 統合テストでの利用

#### 1. 基底クラスでの自動クリーンアップ
```python
class BaseNeo4jIntegrationTest:
    def setup_method(self, method):
        """各テスト前に両方のDBをクリーンアップ"""
        ensure_test_connection()
        cleanup_all_neo4j_data()
    
    def teardown_method(self, method):
        """各テスト後も確実にクリーンアップ"""
        cleanup_all_neo4j_data()
```

#### 2. Pytestマーカーによる自動化
```python
@pytest.fixture(autouse=True)
def auto_cleanup_for_integration_tests(request):
    """統合テストマーカー付きテストで自動クリーンアップ"""
    if request.node.get_closest_marker("integration"):
        ensure_test_connection()
        cleanup_all_neo4j_data()
        yield
        cleanup_all_neo4j_data()
```

## 既知の課題と対策

### 1. Alembicマイグレーションの依存関係
**問題**: テスト環境でのマイグレーション実行時に、テーブル間の依存関係でエラーが発生

**回避策**:
- Option 1: 必要なテーブルのみを直接作成
```python
SQLModel.metadata.create_all(engine, tables=[User.__table__, CompletedLog.__table__])
```
- Option 2: テスト専用の簡略化されたスキーマを使用
- Option 3: マイグレーションファイルの依存関係を修正

### 2. Neo4jモデルの互換性
**問題**: neomodelのバージョンによってトランザクション処理のAPIが異なる

**対策**: トランザクションを使用せず、各テストでデータを明示的にクリーンアップ

### 3. セッション管理の複雑性
**問題**: SQLAlchemyセッションの状態管理により、オブジェクトの重複挿入エラーが発生

**対策**:
- 各テストで独立したセッションを使用
- `isolated_postgres_test`コンテキストマネージャーの活用
- エンジンのコネクションプール管理

## ベストプラクティス

1. **テストの独立性**: 各テストは他のテストに依存しない
2. **データのクリーンアップ**: setup/teardownメソッドで確実にクリーンアップ
3. **適切なモックの使用**: 外部APIはモック、データベースは実インスタンス
4. **並列実行の考慮**: テスト間でのデータ競合を避ける設計

## 今後の改善計画

1. **CI/CD統合**: GitHub Actionsでの自動テスト実行
2. **パフォーマンステスト**: 大量データでの動作確認
3. **カバレッジ目標**: 80%以上のコードカバレッジ
4. **E2Eテストの追加**: Playwrightによるブラウザテスト