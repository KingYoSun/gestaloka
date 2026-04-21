# ゲームセッション処理フロー分析

作成日: 2025-07-11

## 概要

このドキュメントは、ゲスタロカのゲームセッション実装における各ケースの詳細な処理フローを分析したものです。初回セッション、通常セッション、復帰セッション、セッション離脱時、セッション終了時の5つのケースについて、実装の詳細とフロー図を記載しています。

## 1. 初回セッション

初回セッションは、キャラクターが初めてゲームを開始する際の特別な処理フローです。

### 処理の流れ

1. **セッション作成（バックエンド）**
   - REST API: `POST /api/v1/game/sessions`
   - `GameSessionService.create_session()` が呼ばれる
   - 既存のアクティブセッションを非アクティブ化
   - `is_first_session=True` のセッションを作成
   - システムメッセージは保存しない（後でWebSocketで処理）

2. **WebSocket接続とゲーム参加**
   - フロントエンドが `join_game` イベントを送信
   - `websocket/server.py` の `join_game` ハンドラーが処理
   - 初回セッションかつメッセージがない場合：
     - `FirstSessionInitializer` が初期クエストを付与
     - 導入テキストと初期選択肢を生成
     - GMナラティブメッセージとして保存

3. **フロントエンド処理**
   - `useGameWebSocket` フックがイベントを受信
   - `narrative_update` と `choices_update` イベントを処理
   - ゲームセッションストアに保存

### Mermaidフロー図

```mermaid
sequenceDiagram
    participant FE as フロントエンド
    participant API as REST API
    participant WS as WebSocket
    participant DB as データベース
    participant AI as FirstSessionInitializer

    FE->>API: POST /sessions (character_id)
    API->>DB: 既存セッション非アクティブ化
    API->>DB: 新規セッション作成 (is_first_session=True)
    API-->>FE: GameSessionResponse

    FE->>WS: join_game (session_id, user_id)
    WS->>DB: セッション情報確認
    WS->>DB: 既存メッセージ確認
    
    alt 初回セッション & メッセージなし
        WS->>AI: 初期化処理依頼
        AI->>DB: 初期クエスト付与
        AI-->>WS: 導入テキスト & 選択肢
        WS->>DB: GMナラティブ保存
        WS->>FE: narrative_update
        WS->>FE: choices_update
    end

    FE->>FE: ストアに保存 & 表示
```

## 2. 通常セッション

通常セッションは、既存のセッションでゲームプレイを継続する標準的なフローです。

### 処理の流れ

1. **セッション作成/再開**
   - 既存セッションがある場合でも新規作成される
   - `is_first_session=False` で作成
   - システムメッセージ「セッション #N を開始しました」を保存

2. **WebSocket接続とゲーム参加**
   - `join_game` イベントで既存メッセージを確認
   - 最新の選択肢のみを送信（ナラティブは送信しない）
   - フロントエンドのストアから履歴を読み込み

3. **アクション実行**
   - `game_action` イベントでアクション送信
   - `GameSessionService.execute_action()` で処理
   - SP消費、AI処理、メッセージ保存
   - WebSocketで結果を返信

### Mermaidフロー図

```mermaid
sequenceDiagram
    participant FE as フロントエンド
    participant WS as WebSocket
    participant GS as GameSessionService
    participant AI as CoordinatorAI
    participant DB as データベース
    participant SP as SPService

    FE->>WS: join_game (session_id, user_id)
    WS->>DB: 既存メッセージ取得
    WS->>FE: choices_update (最新の選択肢)

    FE->>WS: game_action (action_text)
    WS->>GS: execute_action(session, action_request)
    
    GS->>SP: SP消費チェック
    alt SP不足
        SP-->>GS: エラー
        GS-->>WS: HTTPException
        WS-->>FE: error
    else SP十分
        SP-->>GS: 消費成功
        GS->>DB: プレイヤーメッセージ保存
        GS->>AI: process_action
        
        Note over AI: AI処理中...
        WS->>FE: processing_started
        
        AI-->>GS: FinalResponse
        GS->>DB: GMメッセージ保存
        GS->>DB: セッション更新
        
        WS->>FE: message_added
        WS->>FE: action_result
        WS->>FE: processing_completed
    end
```

## 3. 復帰セッション

前回のセッション結果を引き継いで新しいセッションを開始するフローです。

### 処理の流れ

1. **継続セッション作成**
   - REST API: `POST /api/v1/game/sessions/continue`
   - `GameSessionService.continue_session()` が呼ばれる
   - 前回のセッション結果（SessionResult）を取得
   - 継続コンテキストを含む新規セッション作成

2. **継続ナラティブの生成**
   - AIが前回の結果を踏まえた継続ナラティブを生成
   - GMナラティブメッセージとして保存
   - ストーリーアークの引き継ぎ

3. **通常セッションと同様の処理**
   - WebSocket接続後は通常セッションと同じ

### Mermaidフロー図

```mermaid
sequenceDiagram
    participant FE as フロントエンド
    participant API as REST API
    participant GS as GameSessionService
    participant AI as CoordinatorAI
    participant DB as データベース

    FE->>API: POST /sessions/continue
    Note right of FE: previous_session_id

    API->>GS: continue_session(character, previous_session_id)
    GS->>DB: 前回セッション取得
    GS->>DB: SessionResult取得
    
    GS->>DB: 新規セッション作成
    Note over DB: previous_session_id設定<br/>continuation_context含む

    alt 継続コンテキストあり
        GS->>AI: generate_continuation_narrative
        AI-->>GS: 継続ナラティブ
    else コンテキストなし
        GS->>GS: デフォルトナラティブ使用
    end

    GS->>DB: システムメッセージ保存
    GS->>DB: GMナラティブ保存
    GS-->>API: GameSessionResponse
    API-->>FE: セッション情報

    FE->>FE: 通常セッションとして処理開始
```

## 4. セッション離脱時

プレイヤーがセッションから一時的に離脱する際の処理です。

### 処理の流れ

1. **明示的な離脱**
   - `leave_game` イベントを送信
   - Socket.IOのroomから退出
   - 接続情報は更新（game_session_idをnullに）
   - 他のプレイヤーに通知

2. **暗黙的な離脱**
   - ページ遷移やリロード時
   - WebSocket接続は自動的に切断
   - `disconnect` イベントで接続情報削除

3. **復帰時の処理**
   - 再度 `join_game` を実行
   - 既存のメッセージと選択肢を読み込み

### Mermaidフロー図

```mermaid
sequenceDiagram
    participant FE as フロントエンド
    participant WS as WebSocket
    participant CM as ConnectionManager
    participant Room as Socket.IO Room

    alt 明示的な離脱
        FE->>WS: leave_game (session_id, user_id)
        WS->>Room: leave_room("game_{session_id}")
        WS->>CM: 接続情報更新 (game_session_id = null)
        WS->>FE: left_game確認
        WS->>Room: player_left通知 (他プレイヤーへ)
    else 暗黙的な離脱（ページ遷移等）
        FE->>WS: disconnect
        WS->>CM: remove_connection(sid)
        Note over CM: ユーザー/ゲームセッションから削除
    end

    Note over FE: 後で復帰...

    FE->>WS: connect
    FE->>WS: join_game (session_id, user_id)
    WS->>WS: 既に参加済みチェック
    WS->>FE: 最新の選択肢を送信
```

## 5. セッション終了時

セッションを正式に終了する際の処理フローです。

### 処理の流れ

1. **終了提案システム**
   - `get_ending_proposal` で終了提案を取得
   - AIが現在の状況から終了の適切性を判断
   - 最大3回まで拒否可能

2. **終了承認時**
   - `accept_ending` を呼び出し
   - セッションを非アクティブ化
   - Celeryタスクでリザルト処理を開始

3. **リザルト生成**
   - `SessionResult` を非同期で生成
   - ストーリーサマリー、獲得経験値、未解決プロット等
   - 完了後に `session:result_ready` イベント

### Mermaidフロー図

```mermaid
sequenceDiagram
    participant FE as フロントエンド
    participant API as REST API
    participant GS as GameSessionService
    participant AI as DramatistAgent
    participant DB as データベース
    participant Celery as Celeryタスク

    FE->>API: GET /sessions/{id}/ending-proposal
    API->>GS: get_ending_proposal
    GS->>AI: evaluate_session_ending
    AI-->>GS: SessionEndingProposal
    GS-->>API: 提案内容
    API-->>FE: 終了提案表示

    alt 承認
        FE->>API: POST /sessions/{id}/end/accept
        API->>GS: accept_ending
        GS->>DB: セッション非アクティブ化
        GS->>DB: session_status = COMPLETED
        GS->>Celery: process_session_result.delay()
        GS-->>API: result_id
        API-->>FE: 処理中...

        Note over Celery: 非同期でリザルト生成
        Celery->>DB: SessionResult保存
        Celery->>FE: session:result_ready (WebSocket)
        
        FE->>FE: リザルト画面へ遷移
    else 拒否
        FE->>API: POST /sessions/{id}/end/reject
        API->>GS: reject_ending
        GS->>DB: proposal_count++
        GS-->>API: 残り拒否可能回数
        API-->>FE: ゲーム継続
    end
```

## 既知の問題と注意点

### 1. メッセージ重複問題
- WebSocketイベントの重複送信
- フロントエンドでの重複チェック実装
- ID重複チェックでの対処

### 2. 初回セッション初期化タイミング
- `join_game` 時に初期化（REST APIではなく）
- 既存メッセージチェックで重複防止

### 3. SP消費エラー処理
- SP不足時の適切なエラーハンドリング
- WebSocketエラーイベントでの通知

### 4. セッション状態の永続化
- フロントエンドストアでの永続化（localStorage）
- リロード時の状態復元

### 5. 並行処理の考慮
- 同一セッションへの複数接続対応
- メッセージ順序の保証

## 推奨される改善点

1. **トランザクション管理の強化**
   - メッセージ保存とセッション更新の原子性
   - エラー時のロールバック処理

2. **イベント順序の保証**
   - WebSocketイベントの順序制御
   - クライアント側でのバッファリング

3. **エラーリカバリー**
   - 接続断時の自動再接続
   - 未送信アクションの再送信

4. **パフォーマンス最適化**
   - メッセージの差分送信
   - 大量メッセージ時のページネーション

5. **セッション管理の改善**
   - セッションタイムアウト処理
   - 長時間アイドル時の自動保存