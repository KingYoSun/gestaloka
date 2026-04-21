# Alembicマイグレーション管理

このディレクトリにはAlembicによるデータベースマイグレーションファイルが含まれています。

## 重要なルール

### 🚫 手動でマイグレーションファイルを作成しない

このプロジェクトでは一貫性のあるスキーマ管理のため、**手動でのマイグレーションファイル作成は禁止**されています。
必ず`--autogenerate`オプションを使用して自動生成してください。

### ✅ 正しいマイグレーション作成手順

1. **モデルを変更または追加**
   ```python
   # app/models/your_model.py
   class YourModel(SQLModel, table=True):
       # ...
   ```

2. **env.pyにモデルをインポート（重要！）**
   ```python
   # alembic/env.py
   from app.models.your_model import YourModel  # noqa
   ```

3. **マイグレーションを自動生成**
   ```bash
   docker-compose exec -T backend alembic revision --autogenerate -m "説明"
   ```

4. **生成されたファイルを確認**
   - versions/フォルダに新しいファイルが作成される
   - 不要な変更が含まれていないか確認

5. **マイグレーションを適用**
   ```bash
   docker-compose exec -T backend alembic upgrade head
   ```

### ⚠️ 注意事項

- `docker-compose run`ではなく`docker-compose exec -T`を使用すること
- 生成されたマイグレーションファイルは必ずレビューすること
- マイグレーションファイルは必ずコミットすること

### 📋 チェックリスト

新しいモデルを追加する際は、以下を確認してください：

- [ ] モデルクラスを作成した
- [ ] `alembic/env.py`にインポートを追加した
- [ ] `--autogenerate`でマイグレーションを生成した
- [ ] 生成されたファイルに不要な変更がないか確認した
- [ ] マイグレーションが正常に適用されることを確認した
- [ ] マイグレーションファイルをGitにコミットした

## トラブルシューティング

### 空のマイグレーションが生成される場合

1. `alembic/env.py`に全てのモデルがインポートされているか確認
2. SQLModel.metadata.create_all()が実行されていないか確認（無効化済み）
3. データベースをリセットして再度試す：
   ```bash
   make db-reset
   make db-migrate
   ```

### 既存のデータベースがある場合

```bash
# 現在の状態をAlembicに認識させる
docker-compose exec -T backend alembic stamp head
```

詳細は`documents/02_architecture/techDecisions/alembicIntegration.md`を参照してください。