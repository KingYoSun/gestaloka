# Alembic + SQLModel統合ガイド

## 概要

ゲスタロカでは、データベースマイグレーション管理にAlembicを使用し、SQLModelと統合しています。

## スキーマ管理戦略

### Alembicによる統一的なスキーマ管理

ゲスタロカプロジェクトでは、全ての環境（開発・本番）でAlembicを使用したスキーマ管理を行います。

#### 理由
- **一貫性**: 開発環境と本番環境で同じスキーマ管理方法を使用
- **バージョン管理**: スキーマ変更の履歴が明確に管理される
- **ロールバック**: 問題が発生した場合、以前のバージョンに戻すことが可能
- **自動化**: CI/CDパイプラインとの統合が容易

#### 注意事項
- SQLModelの`create_all()`は使用しません
- すべてのテーブル作成・変更はAlembicマイグレーションを通じて行います
- `create_db_and_tables()`関数は後方互換性のために残されていますが、実際にはテーブル作成を行いません

## 設定方法

### 1. 環境設定（alembic/env.py）

SQLModelで自動マイグレーション生成を有効にするための重要な設定：

```python
# モデルをインポート（これがないと自動生成が正しく動作しない）
from app.models.user import User  # noqa
from app.models.character import Character, CharacterStats, Skill, GameSession  # noqa

# SQLModelのメタデータを使用
from sqlmodel import SQLModel
target_metadata = SQLModel.metadata

# configure内で追加オプションを設定
context.configure(
    connection=connection, 
    target_metadata=target_metadata,
    compare_type=True,  # 型の変更を検出
    compare_server_default=True,  # デフォルト値の変更を検出
)
```

### 2. 初期セットアップ

#### 新規プロジェクトの場合

```bash
# Alembicの初期化
docker-compose run --rm backend alembic init alembic

# 初期マイグレーションの作成
docker-compose run --rm backend alembic revision --autogenerate -m "Initial migration"

# マイグレーションの適用
docker-compose run --rm backend alembic upgrade head
```

#### 既存のデータベースがある場合

既存のテーブルがある場合、Alembicは差分を検出できないため、手動で初期マイグレーションを作成する必要があります。

### 3. 日常的な使用方法

#### モデル変更後のマイグレーション生成

```bash
# 1. モデルを変更（例：新しいカラムを追加）
# app/models/character.py を編集

# 2. マイグレーションを自動生成
docker-compose run --rm backend alembic revision --autogenerate -m "Add new column to character"

# 3. 生成されたマイグレーションファイルを確認
# alembic/versions/xxx_add_new_column_to_character.py

# 4. マイグレーションを適用
docker-compose run --rm backend alembic upgrade head
```

#### その他の便利なコマンド

```bash
# 現在のマイグレーション状態を確認
docker-compose run --rm backend alembic current

# 1つ前のマイグレーションに戻す
docker-compose run --rm backend alembic downgrade -1

# 特定のリビジョンまで戻す
docker-compose run --rm backend alembic downgrade <revision_id>

# マイグレーション履歴を表示
docker-compose run --rm backend alembic history

# 次に適用されるマイグレーションを確認
docker-compose run --rm backend alembic show <revision_id>
```

## トラブルシューティング

### 問題1: 自動生成で空のマイグレーションが作成される

**原因**: 
1. モデルがインポートされていない
2. SQLModelの`create_all()`が既にテーブルを作成している

**解決方法**: 

1. `alembic/env.py`で全てのモデルをインポートする
```python
# 全てのモデルをインポート
from app.models.user import User
from app.models.character import Character, CharacterStats, Skill, GameSession
from app.models.log import LogFragment, CompletedLog, LogContract  # 新規追加時
```

2. 既存のテーブルがある場合は手動でマイグレーションを作成
```python
# 手動でマイグレーションファイルを作成
def upgrade() -> None:
    op.create_table('log_fragments', ...)
```

### 問題2: "Target database is not up to date"エラー

**原因**: データベースのマイグレーション状態が不整合

**解決方法**:
```bash
# 現在の状態を確認
docker-compose run --rm backend alembic current

# 必要に応じて最新版にアップグレード
docker-compose run --rm backend alembic upgrade head

# または特定のリビジョンにスタンプ
docker-compose run --rm backend alembic stamp <revision_id>
```

### 問題3: SQLModelの特殊な型が認識されない

**原因**: SQLModelとSQLAlchemyの型の違い

**解決方法**: 必要に応じて`render_item`関数をカスタマイズ

```python
def render_item(type_, obj, autogen_context):
    """SQLModel用のレンダリング関数"""
    # SQLModel特有の型変換が必要な場合はここで処理
    return False
```

### 問題4: PostgreSQL ENUMタイプのエラー

**原因**: PostgreSQLのENUMタイプは`CREATE TYPE IF NOT EXISTS`をサポートしていない

**解決方法**: DO-BLOCKで例外処理を追加
```python
# 注意: これはAlembicが自動生成したコードの例です
# 手動でこのようなコードを書かないでください
def upgrade() -> None:
    # ENUMタイプの作成（既存チェック付き）
    op.execute("""
        DO $$ BEGIN 
            CREATE TYPE logfragmentrarity AS ENUM ('common', 'uncommon', 'rare', 'epic', 'legendary');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$
    """)
```

## ベストプラクティス

### 1. マイグレーションの命名規則

```bash
# 良い例
alembic revision --autogenerate -m "Add attack defense agility to character_stats"
alembic revision --autogenerate -m "Create battle_logs table"

# 悪い例
alembic revision --autogenerate -m "update"
alembic revision --autogenerate -m "fix"
```

### 2. マイグレーションの確認

生成されたマイグレーションファイルは必ず確認してください：

- 不要な変更が含まれていないか
- インデックスの変更が意図通りか
- 外部キー制約が正しく設定されているか

### 3. 本番環境での適用

```bash
# 1. バックアップを取る
pg_dump -U postgres -d gestaloka > backup.sql

# 2. マイグレーションを適用
docker-compose run --rm backend alembic upgrade head

# 3. 動作確認
docker-compose run --rm backend alembic current
```

### 4. チーム開発での注意点

- マイグレーションファイルは必ずコミットする
- 複数人が同時にマイグレーションを作成した場合は、リビジョンIDの衝突に注意
- マージ時にはマイグレーションの順序を確認

## 関連ファイル

- `backend/alembic.ini`: Alembicの設定ファイル
- `backend/alembic/env.py`: Alembic環境設定
- `backend/alembic/versions/`: マイグレーションファイル
- `backend/app/models/`: SQLModelのモデル定義