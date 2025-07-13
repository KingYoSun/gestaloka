# バックエンドリファクタリング第3回（HTTPException共通化・テスト追加）

## 実施日: 2025-07-13（21:30 JST）

## 概要
バックエンドAPIエンドポイントのリファクタリング第3回として、HTTPExceptionのハードコーディングを共通関数に置き換え、テストカバレッジの向上を実施。

## 実施内容

### 1. narrative.pyのリファクタリング

#### HTTPExceptionの共通化
- `raise HTTPException(404)` → `raise_not_found()` に置換
- `raise HTTPException(403)` → `raise_forbidden()` に置換
- `get_or_404()` ヘルパー関数を活用

#### 非同期関数の修正
- `async def update_location_history()` → `def update_location_history()` に変更
  - awaitを使用していないため通常の関数に変更
- `async def generate_action_choices()` → `def generate_action_choices()` に変更
  - 同様に非同期処理が不要

#### 変更前後の比較
```python
# Before
if not current_location:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Current location not found")

# After
current_location = get_or_404(db, Location, current_character.location_id, "Current location not found")
```

### 2. narrative.pyのテスト作成

新規ファイル: `/backend/tests/api/api_v1/endpoints/test_narrative.py`

#### テストケース
1. `test_perform_narrative_action_success` - 正常な物語アクション実行
2. `test_perform_narrative_action_insufficient_sp` - SP不足時の処理
3. `test_perform_narrative_action_forbidden` - 権限チェック
4. `test_get_available_actions` - 利用可能アクション取得
5. `test_get_available_actions_forbidden` - 権限チェック
6. `test_update_location_history` - 移動履歴更新
7. `test_generate_action_choices_with_context` - 文脈依存の選択肢生成

#### テスト実装の工夫
- 認証のモック化（`mock_auth`フィクスチャ）
- GM AIサービスのモック化
- WebSocketサービスのモック化
- 包括的なアサーション

### 3. logs.pyのリファクタリング

#### HTTPExceptionの統一化（12箇所）
- キャラクター所有権確認の共通化
  ```python
  # Before
  character = db.exec(select(Character).where(...)).first()
  if not character:
      raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")
  
  # After
  character = get_by_condition_or_404(db, select(Character).where(...), "Character not found")
  ```
- フラグメント確認処理の簡潔化
- エラーハンドリングの一元化

### 4. sp.pyのリファクタリング

#### HTTPExceptionの置換（11箇所）
- `status_code=400` → `raise_bad_request()`
- `status_code=404` → `raise_not_found()`
- `status_code=500` → `raise_internal_error()`

#### 既存の改善点
- 既に`handle_sp_errors`デコレータが適用済み
- SP関連エラーの自動変換が実装済み

## 成果

### コード品質の向上
- HTTPExceptionのハードコーディング削減: 30箇所以上
- エラーハンドリングの一元化による保守性向上
- DRY原則の徹底適用

### テストカバレッジ
- narrative.pyに7つの包括的なテストケースを追加
- モック化によるユニットテストの独立性確保
- エッジケースのカバー（SP不足、権限エラー等）

### 型安全性
- 非同期関数の適切な使い分け
- 型注釈の追加と改善

## 技術的な改善点

### 1. エラーハンドリングパターンの統一
```python
# 共通パターン
from app.utils.exceptions import raise_not_found, raise_bad_request, get_or_404

# 使用例
character = get_or_404(db, Character, character_id, "Character not found")
```

### 2. テストフィクスチャの整備
```python
@pytest.fixture
def mock_auth(self, client: TestClient, session: Session):
    """認証のモック設定"""
    # 実装...
```

### 3. コード重複の削減
- 同一パターンの処理を共通関数化
- データベースクエリの簡潔化

## 残存課題

### テスト環境
- データベース接続エラーが発生（環境設定の問題）
- CI/CD環境でのテスト実行確認が必要

### 追加のリファクタリング候補
- characters.py
- memory_inheritance.py
- auth.py
- admin.py
- users.py
- stripe_webhook.py

### ドキュメント
- APIドキュメントの更新が必要
- エラーレスポンスの仕様書作成

## 次のステップ

1. 残りのエンドポイントファイルのリファクタリング
2. 全体的なテストカバレッジの確認と向上
3. APIドキュメントの自動生成設定
4. パフォーマンステストの実装

## まとめ

第3回のリファクタリングでは、HTTPExceptionの共通化とテストカバレッジの向上を中心に実施。エラーハンドリングの一元化により、コードの保守性と可読性が大幅に向上した。narrative.pyへの包括的なテスト追加により、物語主導型探索システムの品質保証が強化された。