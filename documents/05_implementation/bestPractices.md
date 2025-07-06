# ゲスタロカ開発ベストプラクティス

## 概要
このドキュメントは、ゲスタロカプロジェクトで採用されているベストプラクティスと、開発時に従うべきガイドラインをまとめています。

## コード品質

### DRY原則（Don't Repeat Yourself）
重複コードを避け、保守性と一貫性を保つための実践的なガイドライン。

#### 共通関数の活用
- **バリデーション**: `app/utils/validation.py`に共通バリデーション関数を配置
  ```python
  from app.utils.validation import validate_password
  ```

- **権限チェック**: `app/utils/permissions.py`で統一的な権限確認
  ```python
  from app.utils.permissions import check_character_ownership, check_session_ownership
  ```

#### 設定値の一元管理
- ハードコーディング禁止
- 全ての設定値は`app/core/config.py`で管理
- 環境変数経由で設定可能に

```python
from app.core.config import settings

# 良い例
initial_hp = settings.DEFAULT_CHARACTER_HP

# 悪い例
initial_hp = 100  # ハードコーディング
```

### エラーハンドリング

#### カスタム例外の使用
`app/core/exceptions.py`で定義されたカスタム例外を活用：

```python
from app.core.exceptions import DatabaseError, ResourceNotFoundError

# 良い例
try:
    result = await service.get_data()
except Exception as e:
    raise DatabaseError("データ取得に失敗しました", operation="get_data")

# 悪い例
raise HTTPException(status_code=500, detail="エラーが発生しました")
```

#### 統一エラーハンドラー
- グローバルエラーハンドラーが`app/main.py`で設定済み
- 個別のエンドポイントでのエラーハンドリングは最小限に

### 型安全性

#### 型定義の重複防止
- **API型定義**: バックエンドのPydanticモデルを唯一の真実の源とする
- **自動生成の活用**: `frontend/src/api/generated/`の型を使用
- **手動型定義の禁止**: APIレスポンスの型を手動で定義しない

#### 型チェックの実行
```bash
# 定期的に型チェックを実行
make typecheck
```

## データベース操作

### マイグレーション管理
Alembicによる統一的なスキーマ管理を厳守：

```bash
# 1. モデルを変更/追加
# 2. alembic/env.pyに新しいモデルをインポート（重要！）
# 3. 自動生成（手動作成は禁止）
docker-compose exec -T backend alembic revision --autogenerate -m "変更内容"
# 4. 生成されたファイルを確認
# 5. マイグレーション適用
docker-compose exec -T backend alembic upgrade head
```

**重要なルール**：
- 手動マイグレーションファイル作成は禁止
- 必ず`--autogenerate`を使用
- 新しいモデルは`alembic/env.py`に必ずインポート
- `SQLModel.metadata.create_all()`は使用しない

### トランザクション管理
- PostgreSQLとNeo4jの整合性を保つため、同一トランザクション内で更新
- エラー時は必ずロールバック

## 非同期処理

### Celeryタスクの活用
重い処理や時間のかかる処理はCeleryタスクとして実装：

```python
from app.core.celery_app import celery_app

@celery_app.task
def process_heavy_task(data):
    # 重い処理
    pass
```

## ロギング

### LoggerMixinの活用
統一的なロギングのため、`LoggerMixin`を継承：

```python
from app.core.logging import LoggerMixin

class MyService(LoggerMixin):
    def process(self):
        self.log_info("処理開始", user_id=user_id)
        self.log_error("エラー発生", error=str(e))
```

## AIエージェント実装

### 責務の明確な分離
各AIエージェントは単一の責務を持つ：
- **Dramatist**: 物語生成
- **StateManager**: 状態管理
- **Historian**: 歴史記録
- **NPCManager**: NPC管理
- **TheWorld**: 世界イベント
- **Anomaly**: 異常イベント

### プロンプト管理
- LangChainによる統一的なプロンプト管理
- プロンプトテンプレートの活用

## セキュリティ

### 認証・認可
- JWTトークンベースの認証システム
- `app/api/deps.py`の共通関数を使用
- Cookie認証（2025-07-06実装）
  - httpOnlyフラグでXSS対策
  - secureフラグでHTTPS通信のみ（本番環境）
  - samesiteフラグでCSRF対策

#### Cookie認証の実装詳細
```python
# バックエンド: Cookie設定
response.set_cookie(
    key="authToken",
    value=access_token,
    httponly=True,  # JavaScriptからアクセス不可
    secure=settings.ENVIRONMENT != "development",  # 本番環境でHTTPS必須
    samesite="lax",  # CSRF対策
    max_age=60 * 60 * 24 * 8,  # 8日間
    path="/"
)

# フロントエンド: Cookie送信設定
fetch(url, {
    credentials: 'include',  // Cookieを自動送信
    // その他のオプション
})
```

#### 認証方式の互換性
- BearerトークンとCookieの両方をサポート
- 既存のAPIクライアントとの後方互換性を維持
- 新規実装ではCookie認証を推奨

### 秘密情報の管理
- 環境変数で管理
- コードにハードコーディングしない
- `.env`ファイルはgitignoreに追加

## テスト

### テストの作成
共通関数化により、ユニットテストが容易に：

```python
def test_validate_password():
    # 正常系
    assert validate_password("ValidPass123") == "ValidPass123"
    
    # 異常系
    with pytest.raises(ValueError):
        validate_password("weak")
```

### テストの実行
```bash
# 全テスト実行
make test

# 特定のテストファイル実行
docker-compose exec backend pytest tests/test_validation.py
```

## コードレビュー時のチェックリスト

- [ ] DRY原則に従っているか
- [ ] 適切なカスタム例外を使用しているか
- [ ] ハードコーディングされた値がないか
- [ ] 型定義の重複がないか
- [ ] 権限チェックが適切に実装されているか
- [ ] ログ出力が適切か
- [ ] テストが追加されているか
- [ ] マイグレーションが正しく作成されているか

## 更新履歴
- 2025-06-19: DRY原則に基づく重複コード修正後のベストプラクティスを文書化
- 2025-07-06: Cookie認証の実装とセキュリティベストプラクティスを追加