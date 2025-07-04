# APIエンドポイント一覧

作成日: 2025-07-02
最終更新: 2025-07-04

## 概要

このドキュメントは、ゲスタロカのバックエンドAPIで実装されているすべてのエンドポイントの一覧です。

## ベースURL

- 開発環境: `http://localhost:8000/api/v1`
- プロダクション環境: TBD

## 認証

多くのエンドポイントは認証が必要です。認証はOAuth2を使用しており、`/auth/login`でトークンを取得し、`Authorization: Bearer {token}`ヘッダーで認証します。

## エンドポイント一覧

### 認証 (/auth)
- POST `/auth/register` - 新規ユーザー登録
- POST `/auth/login` - ログイン（トークン取得）
- POST `/auth/logout` - ログアウト
- GET `/auth/me` - 現在のユーザー情報取得

### ユーザー (/users)
- GET `/users/profile` - プロフィール取得
- PUT `/users/profile` - プロフィール更新
- DELETE `/users/profile` - アカウント削除

### キャラクター (/characters)
- GET `/characters` - キャラクター一覧取得
- POST `/characters` - キャラクター作成
- GET `/characters/{character_id}` - キャラクター詳細取得
- PUT `/characters/{character_id}` - キャラクター更新
- DELETE `/characters/{character_id}` - キャラクター削除

### ゲームセッション (/game)
- GET `/game/sessions` - セッション一覧取得
- POST `/game/sessions` - 新規セッション作成
- GET `/game/sessions/{session_id}` - セッション詳細取得
- PUT `/game/sessions/{session_id}` - セッション更新
- POST `/game/sessions/{session_id}/action` - アクション実行
- POST `/game/sessions/{session_id}/execute` - コマンド実行
- POST `/game/sessions/{session_id}/end` - セッション終了

### ログ管理 (/logs)
- GET `/logs/fragments/{character_id}` - ログフラグメント一覧取得
- POST `/logs/fragments` - ログフラグメント作成
- GET `/logs/completed/{character_id}` - 完成ログ一覧取得
- POST `/logs/completed` - ログ編纂（完成ログ作成）
- PATCH `/logs/completed/{log_id}` - 完成ログ更新
- POST `/logs/completed/preview` - 編纂プレビュー（SP消費とボーナス表示）※2025-07-04追加
- POST `/logs/completed/{log_id}/purify` - 完成ログの汚染浄化 ※2025-07-04追加
- POST `/logs/fragments/create-purification-item` - フラグメントから浄化アイテム作成 ※2025-07-04追加

### ログフラグメント (/log-fragments)
- GET `/log-fragments/{character_id}/fragments` - フラグメント一覧取得
- GET `/log-fragments/{character_id}/fragments/{fragment_id}` - フラグメント詳細取得

### ログ派遣 (/dispatch)
- POST `/dispatch/dispatch` - ログNPC派遣
- GET `/dispatch/dispatches` - 派遣一覧取得
- GET `/dispatch/dispatches/{dispatch_id}` - 派遣詳細取得
- GET `/dispatch/dispatches/{dispatch_id}/report` - 派遣レポート取得
- POST `/dispatch/dispatches/{dispatch_id}/recall` - 派遣取り消し
- POST `/dispatch/encounters/{encounter_id}/interact` - 遭遇NPC相互作用

### 探索 (/exploration)
- GET `/exploration/locations` - ロケーション一覧取得
- GET `/exploration/{character_id}/areas` - 利用可能エリア取得
- GET `/exploration/{character_id}/current-location` - 現在地取得
- GET `/exploration/{character_id}/available-locations` - 移動可能ロケーション取得
- GET `/exploration/{character_id}/map-data` - マップデータ取得
- POST `/exploration/{character_id}/move` - 移動
- POST `/exploration/{character_id}/explore` - 探索
- POST `/exploration/{character_id}/update-progress` - 進捗更新

### ナラティブ (/narrative)
- GET `/narrative/{character_id}/actions` - 行動履歴取得
- POST `/narrative/{character_id}/action` - ナラティブアクション実行

### NPC (/npcs)
- GET `/npcs/npcs` - NPC一覧取得
- GET `/npcs/npcs/{npc_id}` - NPC詳細取得
- GET `/npcs/locations/{location_name}/npcs` - ロケーション別NPC取得
- POST `/npcs/npcs/{npc_id}/move` - NPC移動

### クエスト (/quests) ※2025-07-03追加
- GET `/quests/{character_id}/quests` - クエスト一覧取得（ステータスでフィルタ可能）
- GET `/quests/{character_id}/proposals` - AI駆動のクエスト提案取得
- POST `/quests/{character_id}/create` - 新規クエスト作成
- POST `/quests/{character_id}/quests/infer` - 行動パターンから暗黙的クエストを推測
- POST `/quests/{character_id}/quests/{quest_id}/accept` - 提案されたクエストを受諾
- POST `/quests/{character_id}/quests/{quest_id}/update` - クエスト進捗をAIで評価・更新

### SP（スペシャルポイント）(/sp)
- GET `/sp/balance` - SP残高取得
- GET `/sp/balance/summary` - SP残高サマリー取得
- GET `/sp/transactions` - トランザクション履歴取得
- GET `/sp/transactions/{transaction_id}` - トランザクション詳細取得
- POST `/sp/consume` - SP消費
- POST `/sp/daily-recovery` - 日次回復（システム用）
- GET `/sp/plans` - 購入プラン一覧取得
- POST `/sp/purchase` - SP購入
- POST `/sp/stripe/checkout` - Stripeチェックアウト開始
- GET `/sp/purchases` - 購入履歴取得
- GET `/sp/purchases/{purchase_id}` - 購入詳細取得
- POST `/sp/purchases/{purchase_id}/cancel` - 購入キャンセル
- GET `/sp/purchase-stats` - 購入統計取得

### SPサブスクリプション (/sp/subscriptions)
- GET `/sp/subscriptions/plans` - サブスクリプションプラン一覧
- GET `/sp/subscriptions/current` - 現在のサブスクリプション取得
- POST `/sp/subscriptions/purchase` - サブスクリプション購入
- PUT `/sp/subscriptions/update` - サブスクリプション更新
- POST `/sp/subscriptions/cancel` - サブスクリプションキャンセル
- GET `/sp/subscriptions/history` - サブスクリプション履歴取得

### 設定 (/config)
- GET `/config/game` - ゲーム設定取得
- GET `/config/game/character-limits` - キャラクター制限設定取得
- GET `/config/game/validation-rules` - バリデーションルール取得

### WebSocket (/ws)
- WEBSOCKET `/ws/game/{session_id}` - ゲームセッションWebSocket
- WEBSOCKET `/ws/general/{user_id}` - 汎用WebSocket

### Stripe Webhook (/stripe)
- POST `/stripe/stripe/webhook` - Stripe Webhookエンドポイント（認証不要）

### 記憶継承 (/memory-inheritance) ※2025-07-03追加
- GET `/memory-inheritance/{character_id}/preview` - 継承プレビュー取得
- POST `/memory-inheritance/{character_id}/inherit` - 記憶継承実行
- GET `/memory-inheritance/{character_id}/history` - 継承履歴取得

### 遭遇ストーリー ※2025-07-04実装（サービスレベル）
遭遇ストーリーシステムは現在、EncounterManagerサービスとしてバックエンドに実装されていますが、
専用のAPIエンドポイントはまだ公開されていません。現在は以下のサービスを通じて機能が提供されています：
- ゲームセッションAPIの中でログNPCとの遭遇時に自動的に処理
- ナラティブAPIの中でストーリー進行が管理される
- クエストAPIと連携して共同クエストが生成される

### 管理者API (/admin)

#### パフォーマンス (/admin/performance)
- GET `/admin/performance/stats` - パフォーマンス統計取得（過去N時間）
- POST `/admin/performance/test` - パフォーマンステスト実行
- GET `/admin/performance/realtime` - リアルタイムメトリクス取得（過去5分）

#### SP管理 (/admin/sp)
- GET `/admin/sp/players` - 全プレイヤーのSP情報取得（検索・ページング対応）
- GET `/admin/sp/players/{user_id}` - 特定プレイヤーのSP詳細取得
- GET `/admin/sp/players/{user_id}/transactions` - プレイヤーのトランザクション履歴
- POST `/admin/sp/adjust` - SP調整（単一プレイヤー）
- POST `/admin/sp/batch-adjust` - SP一括調整（複数プレイヤー）

## 認証が不要なエンドポイント

- POST `/auth/register`
- POST `/auth/login`
- POST `/stripe/stripe/webhook`
- GET `/config/game`
- GET `/config/game/character-limits`
- GET `/config/game/validation-rules`

## 管理者権限が必要なエンドポイント

`/admin`配下のすべてのエンドポイントは管理者権限が必要です。

## レート制限

現在の実装では明示的なレート制限は設定されていませんが、本番環境では以下のような制限を推奨します：

- 認証エンドポイント: 5回/分
- 一般API: 60回/分
- WebSocket: 接続数制限

## エラーレスポンス

標準的なHTTPステータスコードを使用：

- 200: 成功
- 201: 作成成功
- 400: 不正なリクエスト
- 401: 認証エラー
- 403: 権限エラー
- 404: リソースが見つからない
- 422: バリデーションエラー
- 500: サーバーエラー

## 関連ドキュメント

- [API仕様書](/documents/02_architecture/api/gemini_api_specification.md)
- [フロントエンドAPI統合ガイド](/documents/05_implementation/frontend/)
- [認証実装詳細](/documents/05_implementation/bestPractices.md)
