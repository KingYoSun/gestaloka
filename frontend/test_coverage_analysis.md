# テストカバレッジ分析レポート

## 概要
- **Backend**: 280テスト実行、99.5%成功（202/203）→ 最新実行で100%成功（280/280）
- **Frontend**: テストファイルが存在しない（0テスト）

## Backend テストカバレッジ

### テスト済みモジュール ✅

#### APIエンドポイント
- ✅ `/api/v1/endpoints/narrative.py` → `test_narrative.py`
- ✅ `/api/v1/endpoints/logs.py` → `test_log_endpoints.py`
- ✅ `/api/v1/endpoints/sp.py` → `test_sp.py`

#### サービス層
- ✅ `auth_service.py` → `test_auth_service.py`
- ✅ `character_service.py` → `test_character_service.py`
- ✅ `compilation_bonus.py` → `test_compilation_bonus.py`
- ✅ `memory_inheritance_service.py` → `test_memory_inheritance_service.py`
- ✅ `quest_service.py` → `test_quest_service.py`
- ✅ `sp_service.py` → `test_sp_service.py`
- ✅ `user_service.py` → `test_user_service.py`
- ✅ `battle.py` → `test_battle_service.py`
- ✅ `npc_generator.py` → `test_npc_generator.py`, `test_npc_generator_integration.py`
- ✅ `sp_purchase_service.py` → `test_sp_purchase.py`

#### AIエージェント
- ✅ `agents/anomaly.py` → `test_anomaly_ai.py`
- ✅ `agents/npc_manager.py` → `test_npc_manager_ai.py`
- ✅ `agents/the_world.py` → `test_the_world_ai.py`
- ✅ `agents/historian.py` → `test_historian.py`
- ✅ `agents/state_manager.py` → `test_state_manager_ai.py`
- ✅ `gemini_client.py` → `test_gemini_client.py`
- ✅ `dispatch_interaction.py` → `test_dispatch_interaction.py`
- ✅ `dispatch_simulator.py` → `test_dispatch_ai_simulation.py`

#### その他
- ✅ `core/exceptions.py` → `test_exceptions.py`
- ✅ データベース接続 → `test_database.py`
- ✅ メインアプリケーション → `test_main.py`
- ✅ `ai/shared_context.py` → `test_shared_context.py`
- ✅ `ai/task_generator.py` → `test_task_generator.py`
- ✅ `gm_ai_service.py` → `test_gm_ai.py`

### テストが存在しないモジュール ❌

#### APIエンドポイント（未テスト）
- ❌ `/api/v1/endpoints/admin.py`
- ❌ `/api/v1/endpoints/auth.py`
- ❌ `/api/v1/endpoints/characters.py`
- ❌ `/api/v1/endpoints/config.py`
- ❌ `/api/v1/endpoints/dispatch.py`
- ❌ `/api/v1/endpoints/log_fragments.py`
- ❌ `/api/v1/endpoints/memory_inheritance.py`
- ❌ `/api/v1/endpoints/npcs.py`
- ❌ `/api/v1/endpoints/sp_subscription.py`
- ❌ `/api/v1/endpoints/stripe_webhook.py`
- ❌ `/api/v1/endpoints/titles.py`
- ❌ `/api/v1/endpoints/users.py`
- ❌ `/api/v1/endpoints/websocket.py`
- ❌ `/api/v1/endpoints/quests.py`
- ❌ `/api/v1/admin/sp_management.py`

#### サービス層（未テスト）
- ❌ `contamination_purification.py`
- ❌ `encounter_manager.py`
- ❌ `game_action_sp_calculation.py`
- ❌ `log_fragment_service.py`
- ❌ `sp_subscription_service.py`
- ❌ `stripe_service.py`
- ❌ `websocket_service.py`
- ❌ `sp_service_base.py`

#### AIエージェント（未テスト）
- ❌ `agents/base.py`
- ❌ `agents/coordinator.py`
- ❌ `agents/dramatist.py`
- ❌ `ai/coordinator_factory.py`
- ❌ `ai/gemini_factory.py`
- ❌ `ai/prompt_manager.py`
- ❌ `ai/response_cache.py`
- ❌ `ai/utils.py`

#### モデル層（未テスト）
- ❌ すべてのモデルファイル（`models/*.py`）
- ❌ `db/neo4j_models.py`

## Frontend テストカバレッジ

### 現状
- **テストファイルが1つも存在しない**
- `src/test/setup.ts` のみ存在（テスト環境設定ファイル）

### テストが必要な主要コンポーネント

#### フィーチャーモジュール
- ❌ `features/auth/` - 認証関連（LoginPage, RegisterPage, useAuth）
- ❌ `features/character/` - キャラクター管理
- ❌ `features/game/` - ゲームプレイ機能
- ❌ `features/logs/` - ログ管理機能
- ❌ `features/narrative/` - ナラティブインターフェース
- ❌ `features/sp/` - SPおよびサブスクリプション管理
- ❌ `features/admin/` - 管理画面

#### 共通コンポーネント
- ❌ `components/ui/` - UIコンポーネント
- ❌ `components/memory/` - メモリー継承関連
- ❌ `components/quests/` - クエスト関連
- ❌ `components/sp/` - SP表示・購入関連

#### フック・ユーティリティ
- ❌ `hooks/` - カスタムフック
- ❌ `api/` - API呼び出し関数
- ❌ `utils/` - ユーティリティ関数
- ❌ `contexts/` - コンテキスト
- ❌ `stores/` - 状態管理

## 重要度別テスト優先度

### 最優先（コア機能）
1. **Backend**
   - ❌ `api/v1/endpoints/auth.py` - 認証エンドポイント
   - ❌ `api/v1/endpoints/characters.py` - キャラクター管理
   - ❌ `api/v1/endpoints/websocket.py` - リアルタイム通信
   - ❌ `services/stripe_service.py` - 決済処理

2. **Frontend**
   - ❌ 認証フロー（ログイン、登録、セッション管理）
   - ❌ ゲームプレイのコアループ
   - ❌ API通信とエラーハンドリング

### 高優先度
1. **Backend**
   - ❌ `agents/coordinator.py` - AI調整役
   - ❌ `agents/dramatist.py` - 物語生成
   - ❌ `services/sp_subscription_service.py` - サブスクリプション管理

2. **Frontend**
   - ❌ SPおよび決済関連コンポーネント
   - ❌ リアルタイムゲーム更新（WebSocket）

### 中優先度
- モデル層の単体テスト
- UIコンポーネントの表示テスト
- ユーティリティ関数のテスト

## 推奨アクション

1. **Frontend テスト環境構築**
   - Vitestの設定は完了済み
   - MSW（Mock Service Worker）導入済み
   - テストファイルの作成開始が必要

2. **Backend 重要エンドポイントのテスト追加**
   - 認証・認可フローのテスト
   - WebSocketエンドポイントのテスト
   - Stripe Webhookのテスト

3. **統合テストの拡充**
   - エンドツーエンドのゲームプレイフロー
   - 決済フローの統合テスト