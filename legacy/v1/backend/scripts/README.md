# Backend Scripts

このディレクトリには、開発やデバッグに便利なスクリプトが含まれています。

## スクリプト一覧

### create_test_titles.py

テスト用の称号データを作成するスクリプトです。

**使用方法:**
```bash
# デフォルト（test@example.com）ユーザーに称号を作成
docker-compose exec -T backend python scripts/create_test_titles.py

# 特定のユーザーに称号を作成
docker-compose exec -T backend python scripts/create_test_titles.py user@example.com
```

**作成される称号:**
- 英雄的犠牲者（編纂コンボボーナス）
- 三徳の守護者（編纂コンボボーナス、装備中）
- 記憶の探求者（実績達成）
- 伝説の編纂者（編纂成功）

**注意事項:**
- 既存の称号はすべて削除されます
- キャラクターが存在しないユーザーを指定した場合、利用可能なユーザーの一覧が表示されます

## 今後追加予定のスクリプト

- `create_test_log_fragments.py` - テスト用ログフラグメントの作成
- `create_test_quests.py` - テスト用クエストの作成
- `reset_user_data.py` - ユーザーデータのリセット
- `export_game_data.py` - ゲームデータのエクスポート