# データベース不整合問題の修正レポート
**日付**: 2025年7月10日  
**作業者**: Claude Code  
**カテゴリ**: バグ修正、データベース

## 概要
ユーザー新規登録時に`user_roles`テーブルが存在しないエラーが発生する問題を修正。根本原因はPostgreSQL ENUM型の使用によるマイグレーションの部分的失敗であることが判明し、全マイグレーションをVARCHAR + CHECK制約に修正して解決した。

## 問題の詳細

### エラー内容
```
psycopg2.errors.UndefinedTable: relation "user_roles" does not exist
LINE 1: INSERT INTO user_roles (id, user_id, role, granted_at, grant...
```

### 影響範囲
- ユーザー新規登録機能が完全に使用不可
- 既存ユーザーのログインは影響なし

## 原因分析

### 1. 直接的原因
- Alembicマイグレーションが途中で失敗し、一部のテーブルのみが作成された状態
- `user_roles`テーブルを含む後半のマイグレーションが未適用

### 2. 根本原因
- **PostgreSQL ENUM型の使用**がプロジェクトのコーディング規約違反
- CLAUDE.mdに明記されている「PostgreSQL ENUM型は使用禁止」ルールの無視

### 3. 技術的詳細
```python
# 問題のあったコード例（初期マイグレーション）
sa.Column('emotional_valence', postgresql.ENUM('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED', name='emotionalvalence'), nullable=False),
sa.Column('rarity', postgresql.ENUM('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', name='rarity'), nullable=False),
```

### 4. 失敗の連鎖
1. 初期マイグレーションで一部のENUM型作成成功、一部失敗
2. 後続マイグレーションが未定義のENUM型を参照
3. `user_roles`テーブルのマイグレーションも失敗
4. データベースが不整合状態に

## 修正内容

### 1. マイグレーションファイルの修正
全てのENUM型をVARCHAR + CHECK制約に変更：

```python
# 修正後のコード例
sa.Column('emotional_valence', sa.VARCHAR(20), nullable=False),
sa.CheckConstraint("emotional_valence IN ('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED')", name='check_emotional_valence'),
sa.Column('rarity', sa.VARCHAR(20), nullable=False),
sa.CheckConstraint("rarity IN ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY')", name='check_rarity'),
```

### 2. データベースのリセットと再構築
```bash
docker-compose down -v
docker-compose up -d
docker-compose exec -T backend alembic upgrade head
```

### 3. 修正されたマイグレーション
- `c8ab2c1be277`: 初期マイグレーション
- `30f5fb512c38`: SPシステム
- `3205fd04cad5`: ログ派遣システム
- `2d1728c7de59`: ユーザーロールテーブル
- 他、全26個のマイグレーション

## 結果

### 1. 成功確認
- 全38テーブルが正常に作成
- `user_roles`テーブルの存在確認：✅
- ユーザー新規登録機能の正常動作：✅

### 2. 技術的成果
- データベーススキーマの整合性回復
- コーディング規約の遵守
- 将来的な保守性の向上

## 教訓と推奨事項

### 1. コーディング規約の重要性
- CLAUDE.mdに記載されている規約は必ず遵守する
- 特にデータベース関連の規約は厳守が必要

### 2. PostgreSQL ENUM型について
- **使用禁止**：プロジェクト方針として明確化
- **代替案**：VARCHAR + CHECK制約を使用
- **理由**：
  - ENUM型の変更が困難（ALTER TYPE制限）
  - トランザクション内での制約
  - Alembicの自動検出が不完全

### 3. マイグレーション管理
- 新規マイグレーション作成後は必ず内容を確認
- 特にENUM型が含まれていないかチェック
- テスト環境での適用確認を徹底

### 4. エラー対応
- データベース不整合が発生した場合は、部分修正より完全リセットが確実
- 開発環境では積極的にリセットを選択
- 本番環境では慎重な移行計画が必要

## 関連ドキュメント
- `CLAUDE.md`: コーディング規約
- `documents/02_architecture/techDecisions/postgresql_enum_migration_issues.md`: ENUM型問題の詳細

## まとめ
プロジェクトのコーディング規約を守ることで、このような問題を未然に防ぐことができる。特にデータベース関連の規約は、後から修正が困難になるため、初期段階での遵守が重要である。