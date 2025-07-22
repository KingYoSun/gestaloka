# ゲームセッション機能再実装計画
作成日: 2025-07-22

## 概要
ゲームセッション機能の再実装をフェーズ1から開始します。データベースモデルとスキーマは既に完全実装済みのため、APIエンドポイントの実装から着手します。

## 前提条件（全て満たしている）
- ✅ 型エラー: 0個（完全解消）
- ✅ テストエラー: フロントエンド0個、バックエンド0個
- ✅ データベースモデル: 完全実装済み
- ✅ スキーマ定義: 完全実装済み
- ✅ プロジェクト品質: 安定状態

## 実装計画

### フェーズ1：基本APIエンドポイント（2025-07-22〜）

#### 1-1. game.pyエンドポイント作成
**ファイルパス**: `/backend/app/api/api_v1/endpoints/game.py`

**実装するエンドポイント**:
```python
# 1. セッション作成
@router.post("/sessions", response_model=GameSessionResponse)
async def create_session(
    request: GameSessionCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """新規ゲームセッションを作成"""
    pass

# 2. セッション詳細取得
@router.get("/sessions/{session_id}", response_model=GameSessionResponse)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """セッションの詳細情報を取得"""
    pass

# 3. セッション履歴
@router.get("/sessions/history", response_model=GameSessionHistoryResponse)
async def get_session_history(
    character_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """セッション履歴を取得"""
    pass

# 4. セッション継続
@router.post("/sessions/{session_id}/continue", response_model=GameSessionResponse)
async def continue_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """既存セッションを継続"""
    pass

# 5. セッション終了
@router.post("/sessions/{session_id}/end", response_model=SessionResultResponse)
async def end_session(
    session_id: str,
    request: EndSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """セッションを終了"""
    pass
```

**活用する既存資産**:
- `app.models.game_session.GameSession`
- `app.schemas.game_session.*`（既に定義済みのスキーマ）
- `app.api.deps.get_current_active_user`（認証）
- `app.api.deps.get_db`（データベースセッション）

#### 1-2. APIルーティング有効化
**ファイルパス**: `/backend/app/api/api_v1/api.py`

現在コメントアウトされている以下の行を有効化：
```python
# from app.api.api_v1.endpoints import game
# api_router.include_router(game.router, prefix="/game", tags=["game"])
```

#### 1-3. テスト作成
**ファイルパス**: `/backend/tests/api/api_v1/test_game.py`

各エンドポイントに対するテストケース：
- セッション作成（正常系、異常系）
- 権限チェック（他ユーザーのセッションへのアクセス）
- ページネーション（履歴取得）
- 状態遷移（active → ended）

#### 1-4. フロントエンド型更新
```bash
# API型の再生成
make generate-api

# session-temp.tsの型定義を自動生成型に移行
# useGameSessions.tsのTODOコメントを解消
```

### フェーズ2：WebSocketリアルタイム通信（第2週）

**実装内容**:
- `join_game`イベントハンドラー
- `send_action`イベントハンドラー
- `receive_narrative`イベント送信
- エラーハンドリングと再接続ロジック

### フェーズ3：AIエージェント統合（第3週）

**実装内容**:
- GameSessionServiceの実装
- Coordinator AIとの統合
- プロンプトコンテキスト構築
- キャッシュ戦略の実装

### フェーズ4：フロントエンドUI実装（第4週）

**実装内容**:
- GameSessionPage.tsxの作成
- useGameSessionフック（WebSocket統合版）
- ノベルモード/チャットモード切り替え
- セッション状態管理

## 実装時の注意事項

1. **既存資産の最大活用**
   - データベースモデルとスキーマは変更不要
   - 既存の認証・権限チェック機能を使用
   - エラーハンドリングは既存パターンに従う

2. **段階的な実装**
   - 各フェーズ完了後に動作確認
   - テストを必ず作成
   - Swagger UIで動作確認

3. **設計原則の遵守**
   - シンプリシティ・ファースト
   - WebSocketファースト（ゲームプレイ）
   - REST APIは認証とメタデータのみ

## 成功指標

### フェーズ1完了時
- [ ] 5つのREST APIが動作
- [ ] Swagger UIで全エンドポイント確認可能
- [ ] 全テストが成功
- [ ] フロントエンドの型エラーなし

### 全フェーズ完了時
- [ ] ゲームセッションの作成から終了まで一通り動作
- [ ] WebSocketによるリアルタイム通信
- [ ] AIによる物語生成
- [ ] ノベルモード/チャットモードの切り替え

## 次のアクション
1. game.pyファイルの作成とエンドポイント実装
2. 既存のスキーマとモデルを確認しながら実装
3. 動作確認とテスト作成