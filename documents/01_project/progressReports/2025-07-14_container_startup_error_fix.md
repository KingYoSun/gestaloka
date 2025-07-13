# バックエンドコンテナ起動エラー修正

## 日付
2025年7月14日 02:20 JST

## 概要
backend、celery-beat、celery-workerコンテナの起動に失敗していた問題を修正しました。

## 問題の詳細

### 1. SPSystemErrorクラスが未定義
- **エラー内容**: `NameError: name 'SPSystemError' is not defined`
- **発生箇所**: `app/core/exceptions.py:58`
- **原因**: `InsufficientSPError`クラスが`SPSystemError`を継承しているが、`SPSystemError`自体が定義されていなかった

### 2. StoryArcモデルの参照エラー
- **エラー内容**: `sqlalchemy.exc.InvalidRequestError: When initializing mapper Mapper[Character(characters)], expression 'StoryArc' failed to locate a name`
- **発生箇所**: Celery workerの起動時
- **原因**: `app/models/__init__.py`に`StoryArc`モデルがインポートされていなかった

## 修正内容

### 1. SPSystemErrorクラスの定義追加
`app/core/exceptions.py`に以下を追加：

```python
class SPSystemError(LogverseError):
    """SPシステムエラー"""

    def __init__(self, message: str, operation: Optional[str] = None):
        details = {"operation": operation} if operation else {}
        super().__init__(message, code="SP_SYSTEM_ERROR", details=details)
```

HTTPステータスコードマッピングにも追加：
```python
"SP_SYSTEM_ERROR": status.HTTP_500_INTERNAL_SERVER_ERROR,
```

### 2. StoryArcモデルのインポート追加
`app/models/__init__.py`に以下を追加：

```python
from app.models.story_arc import StoryArc, StoryArcMilestone, StoryArcStatus, StoryArcType as SAType
```

`__all__`リストにも追加：
```python
"StoryArc",
"StoryArcMilestone", 
"StoryArcStatus",
```

注意：`StoryArcType`は`encounter_story.py`に既に存在するため、`SAType`としてインポート

## 結果

### 修正前
- backend: Up (unhealthy)
- celery-beat: Exit 1
- celery-worker: Exit 1

### 修正後
- backend: Up (healthy)
- celery-beat: Up (healthy)
- celery-worker: Up (healthy)

すべてのコンテナが正常に起動し、APIも正常に動作しています：
```bash
curl -s http://localhost:8000/health
{"status":"healthy","version":"0.1.0","environment":"development"}
```

## 技術的詳細

### SPSystemError
- 基底クラス：`LogverseError`
- HTTPステータス：500 Internal Server Error
- 用途：SP関連のシステムエラー全般
- 派生クラス：`InsufficientSPError`（SP不足エラー）

### StoryArcモデル
- 複数セッションに跨る物語管理モデル
- `alembic/env.py`には既にインポート済み
- リレーションシップ：Character ↔ StoryArc ↔ GameSession

## 教訓
1. 新しい例外クラスを継承する場合は、基底クラスが定義されているか確認
2. モデル間のリレーションシップを使用する場合は、`__init__.py`でのインポートを忘れない
3. エラーログを順番に確認し、根本原因から修正する

## 関連ファイル
- `/backend/app/core/exceptions.py`
- `/backend/app/models/__init__.py`
- `/backend/app/models/story_arc.py`
- `/backend/app/models/character.py`