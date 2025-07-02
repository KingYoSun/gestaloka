# SPサブスクリプション購入・更新API実装

## 実施日: 2025-07-02

## 概要
SPシステムにサブスクリプション（月額パス）機能を追加。プレイヤーが定期的にSPボーナスを受け取れる仕組みと、継続的な収益モデルを実装。

## 実装内容

### 1. データベースモデル

#### SPSubscriptionモデル
- **ファイル**: `backend/app/models/sp_subscription.py`
- **テーブル**: `sp_subscriptions`
- **主要フィールド**:
  - サブスクリプションタイプ（BASIC/PREMIUM）
  - ステータス（ACTIVE/CANCELLED/EXPIRED/PENDING/FAILED）
  - 期間情報（開始日、有効期限、キャンセル日）
  - Stripe連携情報
  - 自動更新設定

#### SubscriptionTransactionモデル
- **テーブル**: `subscription_transactions`
- **用途**: 購入、更新、キャンセル、返金の履歴管理

### 2. バックエンドAPI

#### エンドポイント一覧
- `GET /api/v1/sp/subscriptions/plans` - プラン一覧取得
- `GET /api/v1/sp/subscriptions/current` - 現在のサブスクリプション
- `GET /api/v1/sp/subscriptions/history` - 履歴取得
- `POST /api/v1/sp/subscriptions/purchase` - 購入
- `POST /api/v1/sp/subscriptions/cancel` - キャンセル
- `PUT /api/v1/sp/subscriptions/update` - 更新（自動更新設定など）

#### サブスクリプションプラン
```python
BASIC = {
    "price": 1000,
    "daily_bonus": 20,
    "discount_rate": 0.1,  # 10%割引
    "features": [
        "毎日20SPボーナス",
        "SP消費10%割引",
        "限定ログフラグメント出現率UP",
    ]
}

PREMIUM = {
    "price": 2500,
    "daily_bonus": 50,
    "discount_rate": 0.2,  # 20%割引
    "features": [
        "毎日50SPボーナス",
        "SP消費20%割引",
        "限定ログフラグメント出現率大幅UP",
        "専用ログフラグメント",
        "月1回の特別ログ編纂チケット",
    ]
}
```

### 3. サービス層実装

#### SPSubscriptionService
- **ファイル**: `backend/app/services/sp_subscription_service.py`
- **機能**:
  - サブスクリプション作成（テスト/本番モード対応）
  - キャンセル処理（即時/期限まで有効）
  - 自動更新設定の変更
  - Stripe連携

#### StripeService
- **ファイル**: `backend/app/services/stripe_service.py`
- **機能**:
  - Stripeサブスクリプション作成
  - 決済方法管理
  - キャンセル処理
  - Webhook検証

### 4. フロントエンド実装

#### コンポーネント
1. **SubscriptionPlans.tsx**
   - プラン比較表示
   - 購入ボタン
   - 現在のプラン表示

2. **SubscriptionManagement.tsx**
   - 現在のサブスクリプション詳細
   - 自動更新ON/OFF切り替え
   - キャンセル機能
   - 残り日数表示

#### API統合
- **型定義**: `frontend/src/features/sp/types/subscription.ts`
- **APIクライアント**: `frontend/src/features/sp/api/subscription.ts`
- **React Queryフック**: `frontend/src/features/sp/hooks/useSubscription.ts`

### 5. 既存機能との統合

#### SP日次回復（実装済み）
- Celeryタスクで毎日UTC 4時に実行
- サブスクリプション保有者にボーナスSP付与
- BASICは+20SP、PREMIUMは+50SP

#### SP消費時の割引（実装済み）
- `SPService`で割引率を自動適用
- BASICは10%割引、PREMIUMは20%割引

#### 期限切れチェック（実装済み）
- Celeryタスクで1時間ごとに実行
- 期限切れサブスクリプションを自動無効化

## テストモード動作

1. **即時有効化**: 購入と同時にサブスクリプションが有効
2. **Stripe不要**: 決済処理をスキップ
3. **30日間有効**: 自動的に30日後の期限を設定
4. **環境変数**: `SP_PURCHASE_TEST_MODE=true`

## 本番モード動作

1. **Stripe統合**: 実際の決済処理
2. **Webhook連携**: 支払い成功時に自動有効化
3. **自動更新**: Stripeの定期支払い機能を利用
4. **試用期間**: オプションで設定可能

## データベースマイグレーション

```bash
# 実行済み
docker-compose exec -T backend alembic revision --autogenerate -m "Add SP subscription models"
docker-compose exec -T backend alembic upgrade head
```

## 今後の実装予定

1. **管理画面機能**
   - 手動でのサブスクリプション付与
   - 期限延長・調整
   - 統計ダッシュボード

2. **通知機能**
   - 期限切れ前の通知
   - 更新成功/失敗の通知
   - メール連携

3. **プロモーション機能**
   - 初回割引
   - クーポンコード
   - 期間限定キャンペーン

## 技術的な注意点

1. **Enum型の重複**: `spsubscriptiontype`は既存のSPモデルで定義済み
2. **JSONフィールド**: SQLAlchemyのColumn(JSON)を使用
3. **型の一貫性**: フロントエンドとバックエンドで型定義を統一

## まとめ
SPサブスクリプション機能の基本実装が完了。テストモードで即座に動作確認可能で、本番環境でもStripe統合により実際の決済処理に対応。既存のSPシステムと完全に統合され、日次回復や割引機能も自動的に適用される。