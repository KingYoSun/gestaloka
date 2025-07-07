# PostgreSQL ENUM型とマイグレーションの問題

**作成日**: 2025-07-08  
**カテゴリ**: 技術的決定事項  
**重要度**: 🔴 高（本番環境への影響大）

## 1. 問題の詳細

### 1.1 PostgreSQL ENUM型の制約
PostgreSQLのENUM型は以下の重要な制約があります：

1. **ALTER TYPE ADD VALUEの制約**
   - トランザクション内で実行できない
   - 一度追加した値は削除できない
   - 値の順序変更は非常に困難

2. **Alembicとの相性問題**
   - 自動検出が不完全（変更を検出できないケースが多い）
   - デフォルトのトランザクション制御と相性が悪い

### 1.2 実際に発生した問題
```python
# 初期マイグレーション（c8ab2c1be277）
sa.Column(
    "emotional_valence", 
    sa.Enum("POSITIVE", "NEGATIVE", "NEUTRAL", name="emotionalvalence"), 
    nullable=False
)

# 後のマイグレーション（06aafb457714）- 自動生成されたが空
def upgrade() -> None:
    pass  # MIXEDの追加が検出されなかった
```

## 2. 技術的解決策

### 2.1 ENUM型を使用する場合の正しい実装

```python
# alembic/versions/xxx_add_enum_value.py
def upgrade() -> None:
    # 方法1: トランザクション外で実行
    op.execute("COMMIT")
    op.execute("ALTER TYPE emotionalvalence ADD VALUE 'MIXED'")
    
    # 方法2: DO-BLOCKで例外処理（既に存在する場合のエラー回避）
    op.execute("""
        DO $$ BEGIN 
            ALTER TYPE emotionalvalence ADD VALUE 'MIXED';
        EXCEPTION WHEN duplicate_object THEN null;
        END $$
    """)
```

### 2.2 推奨される代替実装

```python
# models/log.py - ENUM型を使用しない実装
class EmotionalValence(str, Enum):
    """感情価（Pythonレベルの列挙型）"""
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"
    MIXED = "mixed"

class LogFragment(SQLModel, table=True):
    # VARCHAR型として保存、バリデーションはアプリケーション層で実施
    emotional_valence: str = Field(
        ...,
        description="感情価",
        regex="^(positive|negative|neutral|mixed)$"
    )
```

## 3. マイグレーション戦略

### 3.1 既存ENUM型からの移行手順

```sql
-- Step 1: 新しいカラムを追加
ALTER TABLE log_fragments ADD COLUMN emotional_valence_new VARCHAR(20);

-- Step 2: データをコピー
UPDATE log_fragments SET emotional_valence_new = emotional_valence::text;

-- Step 3: 制約を追加
ALTER TABLE log_fragments ADD CONSTRAINT emotional_valence_check 
CHECK (emotional_valence_new IN ('positive', 'negative', 'neutral', 'mixed'));

-- Step 4: 古いカラムを削除し、新しいカラムをリネーム
ALTER TABLE log_fragments DROP COLUMN emotional_valence;
ALTER TABLE log_fragments RENAME COLUMN emotional_valence_new TO emotional_valence;

-- Step 5: ENUM型を削除
DROP TYPE emotionalvalence;
```

### 3.2 Alembicでの実装例

```python
def upgrade():
    # 新しいカラムを追加
    op.add_column('log_fragments', 
        sa.Column('emotional_valence_new', sa.String(20), nullable=True)
    )
    
    # データ移行
    op.execute("""
        UPDATE log_fragments 
        SET emotional_valence_new = emotional_valence::text
    """)
    
    # NOT NULL制約を追加
    op.alter_column('log_fragments', 'emotional_valence_new', nullable=False)
    
    # CHECK制約を追加
    op.create_check_constraint(
        'emotional_valence_check',
        'log_fragments',
        "emotional_valence_new IN ('positive', 'negative', 'neutral', 'mixed')"
    )
    
    # 古いカラムを削除
    op.drop_column('log_fragments', 'emotional_valence')
    
    # カラム名を変更
    op.alter_column('log_fragments', 'emotional_valence_new', 
                    new_column_name='emotional_valence')
```

## 4. ベストプラクティス

### 4.1 開発ガイドライン

1. **新規開発**
   - PostgreSQL ENUM型は使用しない
   - 代わりにVARCHAR + CHECK制約を使用
   - Pythonレベルで列挙型を定義

2. **マイグレーション作成**
   - 自動生成後は必ず内容を確認
   - 空のマイグレーションは要注意
   - ENUM型の変更は手動で記述

3. **テスト**
   - マイグレーションの適用テストを必須化
   - ロールバックのテストも実施

### 4.2 CI/CDパイプライン

```yaml
# .github/workflows/migration-test.yml
migration-test:
  steps:
    - name: Apply migrations to test DB
      run: |
        alembic upgrade head
        
    - name: Verify schema
      run: |
        python scripts/verify_schema.py
        
    - name: Test rollback
      run: |
        alembic downgrade -1
        alembic upgrade head
```

## 5. 影響と対応

### 5.1 既存システムへの影響
- 現在3箇所でENUM型を使用
  - `emotionalvalence`
  - `logfragmentrarity`
  - `completedlogstatus`

### 5.2 移行計画
1. **Phase 1**: 新規開発でのENUM型使用禁止（即時）
2. **Phase 2**: 既存ENUM型の影響調査（1週間）
3. **Phase 3**: 段階的移行の実施（1ヶ月）

## 6. 参考資料

- [PostgreSQL: Enum Types](https://www.postgresql.org/docs/current/datatype-enum.html)
- [Alembic: Working with Constraints](https://alembic.sqlalchemy.org/en/latest/ops.html#alembic.operations.Operations.create_check_constraint)
- プロジェクト内参照: `documents/02_architecture/techDecisions/alembicIntegration.md`

---

**重要**: 本番環境でのENUM型の変更は慎重に行ってください。可能な限り、メンテナンスウィンドウを設けて実施することを推奨します。