# 進捗レポート：キャラクター作成制限のバグ修正

**日付**: 2025-01-07  
**作業者**: Claude  
**カテゴリ**: バグ修正

## 概要
キャラクター作成時に発生していた400エラーを修正。削除済みキャラクターも含めてカウントしていたため、実際には1体しかアクティブなキャラクターがいないにも関わらず、上限（5体）に達していると判定されていた問題を解決。

## 問題の詳細

### 症状
- POST /api/v1/characters エンドポイントで400エラー
- エラーメッセージ: "Maximum character limit (5) reached"
- 実際にはアクティブなキャラクターは1体のみ

### 原因
`app.api.deps.check_character_limit`関数で、`is_active`フラグを考慮せずに全てのキャラクターをカウントしていた。

```python
# 修正前
character_count = db.exec(select(Character).where(Character.user_id == current_user.id)).all()
```

### データベースの状態
```
ID                                    | name   | is_active
--------------------------------------|--------|----------
df9f150f-365e-4225-a8c7-c2f72eebe293 | 　     | f
d4a2ead7-f3a3-44be-9253-a5ec9e33e173 | ヌート | f
baabd097-27a9-4621-b65f-bdd09f089f72 | ヌート | f
00418daf-fe6e-495a-8bfc-214171475eb0 | ヌート | f
9093ae72-0b26-483c-a47d-6968fdccd788 | ヌート | t
```

## 実施した修正

### 1. check_character_limit関数の修正
**ファイル**: `backend/app/api/deps.py`

削除済み（`is_active = false`）のキャラクターを除外してカウントするように変更：

```python
# 修正後
character_count = db.exec(
    select(Character).where(Character.user_id == current_user.id, Character.is_active == True)
).all()
```

## 影響範囲
- キャラクター作成機能が正常に動作するようになった
- 既存のキャラクター削除機能との整合性が取れた
- ユーザーは削除したキャラクターの枠を再利用できるようになった

## テスト結果
- バックエンドサービスを再起動後、エラーが解消されたことを確認
- アクティブなキャラクターのみがカウントされることを確認

## 今後の検討事項
1. 削除済みキャラクターの物理削除（ハードデリート）の実装検討
2. キャラクター削除時の関連データ（ログ、セッション等）の処理方針の明確化
3. フロントエンドでの削除済みキャラクターの表示制御の確認

## 関連ファイル
- `/backend/app/api/deps.py` - 修正対象ファイル
- `/backend/app/api/api_v1/endpoints/characters.py` - キャラクターエンドポイント
- `/backend/app/models/character.py` - キャラクターモデル定義