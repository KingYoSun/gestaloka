# キャラクター作成機能の修正レポート

## 実施日時
2025-07-06 23:49 JST

## 問題の概要
/character/createページでキャラクターを作成すると、ダッシュボードに遷移するがキャラクターが作成されていない状態になっていた。

## 問題の原因
1. **SQLクエリのブーリアン比較の問題**
   - `CharacterService.get_by_user`メソッドで`CharacterModel.is_active is True`を使用
   - SQLModel/SQLAlchemyでは`is`演算子ではなく`==`演算子を使用する必要がある
   - 結果として`WHERE false`というSQLが生成され、キャラクターが取得できない

2. **APIエンドポイントのリダイレクト**
   - `/characters`へのリクエストが`/characters/`に307リダイレクト

## 修正内容

### 1. SQLクエリの修正
```python
# backend/app/services/character_service.py:39
# 修正前
CharacterModel.is_active is True

# 修正後
CharacterModel.is_active == True  # noqa: E712
```

```python
# backend/app/services/game_session.py:88
# 同様の修正を実施
```

### 2. APIエンドポイントの修正
```typescript
// frontend/src/api/client.ts
// 修正前
return this.requestWithTransform<Character[]>('/characters')

// 修正後
return this.requestWithTransform<Character[]>('/characters/')
```

### 3. リダイレクト先の変更
```typescript
// frontend/src/features/character/CharacterCreatePage.tsx
// 修正前
navigate({ to: '/dashboard' })

// 修正後
navigate({ to: '/characters' })
```

## 技術的な注意点

### SQLModelでのブーリアン比較
- SQLModel/SQLAlchemyのクエリでは、Pythonの`is`演算子は使用できない
- `== True`を使用する必要がある（E712リントエラーを無視）
- これはSQLへの変換時の制約によるもの

### 例
```python
# 誤り
.where(Model.is_active is True)  # WHERE false になる

# 正しい
.where(Model.is_active == True)  # noqa: E712
```

## 成果
- キャラクター作成が正常に動作するようになった
- 作成後、キャラクター一覧ページで作成したキャラクターを確認できる
- デバッグログを削除し、本番環境に向けてクリーンアップ完了

## 今後の推奨事項
1. SQLModelを使用する際は、ブーリアン比較に注意する
2. 新しいサービスクラスを作成する際は、既存の実装パターンを参照する
3. APIエンドポイントは末尾スラッシュの有無に注意する