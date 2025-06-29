# SP購入システム設計書

**作成日**: 2025-06-29  
**バージョン**: 1.0

## 概要

本書では、ゲスタロカのSP（Story Points）購入システムの設計を定義します。MVPフェーズでは、実際の課金ではなくテスト用の申請システムを実装し、環境変数による切り替えを可能にします。

## システム要件

### 機能要件

1. **購入モード切り替え**
   - 環境変数による実装モードの切り替え
   - テストモード：申請のみでSP付与
   - 本番モード：Stripe決済統合（将来実装）

2. **SP購入フロー**
   - 価格プラン選択
   - 購入確認画面
   - テストモード：申請理由入力
   - 購入完了通知

3. **価格プラン**
   - 複数の価格帯（500円〜8,000円相当）
   - ボーナスSP付きプラン
   - 月額パスオプション（将来実装）

### 非機能要件

1. **セキュリティ**
   - HTTPS通信必須
   - CSRF対策
   - 購入履歴の監査ログ

2. **パフォーマンス**
   - 購入処理：3秒以内
   - リアルタイムSP反映

3. **可用性**
   - エラー時の適切なフォールバック
   - 購入プロセスの中断対応

## アーキテクチャ設計

### システム構成

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │     │   Backend API   │     │   Database      │
│                 │     │                 │     │                 │
│  Purchase UI    │────▶│  /api/v1/sp/    │────▶│  sp_purchases   │
│  Price Plans    │     │    purchase     │     │  sp_transactions│
│  Confirmation   │     │    plans        │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │ Payment Provider│
                        │ (Stripe/Test)   │
                        └─────────────────┘
```

### 環境変数設計

```bash
# 購入モード設定
PAYMENT_MODE=test|production  # デフォルト: test

# テストモード設定
TEST_MODE_AUTO_APPROVE=true|false  # デフォルト: true
TEST_MODE_APPROVAL_DELAY=0  # 承認までの遅延（秒）

# 本番モード設定（将来実装用）
STRIPE_PUBLIC_KEY=pk_test_xxx
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# SP価格設定
SP_PRICE_MULTIPLIER=1.0  # 価格調整用係数
```

## データモデル

### 購入申請モデル（SPPurchase）

```python
class SPPurchase(SQLModel, table=True):
    __tablename__ = "sp_purchases"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    
    # 購入情報
    plan_id: str = Field(index=True)  # small, medium, large, xlarge
    sp_amount: int = Field(gt=0)
    price_jpy: int = Field(gt=0)  # 円単位
    
    # ステータス
    status: PurchaseStatus = Field(default=PurchaseStatus.PENDING)
    payment_mode: PaymentMode = Field(default=PaymentMode.TEST)
    
    # テストモード用
    test_reason: Optional[str] = Field(default=None, max_length=500)
    approved_by: Optional[uuid.UUID] = Field(default=None)
    approved_at: Optional[datetime] = Field(default=None)
    
    # 本番モード用（将来実装）
    stripe_payment_intent_id: Optional[str] = Field(default=None)
    stripe_checkout_session_id: Optional[str] = Field(default=None)
    
    # メタデータ
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    
    # リレーション
    user: "User" = Relationship(back_populates="sp_purchases")
```

### 列挙型定義

```python
class PurchaseStatus(str, Enum):
    PENDING = "pending"          # 申請中
    PROCESSING = "processing"    # 処理中
    COMPLETED = "completed"      # 完了
    FAILED = "failed"           # 失敗
    CANCELLED = "cancelled"     # キャンセル
    REFUNDED = "refunded"       # 返金済み

class PaymentMode(str, Enum):
    TEST = "test"               # テストモード
    PRODUCTION = "production"   # 本番モード
```

### 価格プラン定義

```python
# backend/app/core/sp_plans.py
from pydantic import BaseModel
from typing import Dict, List

class SPPlan(BaseModel):
    id: str
    name: str
    sp_amount: int
    price_jpy: int
    bonus_percentage: int  # ボーナスSPの割合
    popular: bool = False  # 人気プラン表示用
    
SP_PLANS: Dict[str, SPPlan] = {
    "small": SPPlan(
        id="small",
        name="スモールパック",
        sp_amount=100,
        price_jpy=500,
        bonus_percentage=0
    ),
    "medium": SPPlan(
        id="medium",
        name="ミディアムパック",
        sp_amount=250,
        price_jpy=1000,
        bonus_percentage=25,  # 25%ボーナス
        popular=True
    ),
    "large": SPPlan(
        id="large",
        name="ラージパック",
        sp_amount=600,
        price_jpy=2000,
        bonus_percentage=50   # 50%ボーナス
    ),
    "xlarge": SPPlan(
        id="xlarge",
        name="エクストララージパック",
        sp_amount=2000,
        price_jpy=5000,
        bonus_percentage=100  # 100%ボーナス
    )
}
```

## API設計

### エンドポイント一覧

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/v1/sp/plans | 価格プラン一覧取得 | 不要 |
| POST | /api/v1/sp/purchase | SP購入申請 | 必要 |
| GET | /api/v1/sp/purchases | 購入履歴取得 | 必要 |
| GET | /api/v1/sp/purchases/{id} | 購入詳細取得 | 必要 |
| POST | /api/v1/sp/purchases/{id}/cancel | 購入キャンセル | 必要 |

### API詳細

#### 1. 価格プラン一覧取得

```typescript
// GET /api/v1/sp/plans
interface SPPlanResponse {
  plans: SPPlan[];
  payment_mode: "test" | "production";
  currency: "JPY";
}

interface SPPlan {
  id: string;
  name: string;
  sp_amount: number;
  price_jpy: number;
  bonus_percentage: number;
  popular: boolean;
  description?: string;
}
```

#### 2. SP購入申請

```typescript
// POST /api/v1/sp/purchase
interface PurchaseRequest {
  plan_id: string;
  test_reason?: string;  // テストモード時のみ必須
}

interface PurchaseResponse {
  purchase_id: string;
  status: PurchaseStatus;
  sp_amount: number;
  price_jpy: number;
  payment_mode: "test" | "production";
  checkout_url?: string;  // 本番モード時のみ
  message?: string;
}
```

## フロントエンド設計

### コンポーネント構成

```
SPPurchasePage/
├── SPPurchasePage.tsx        # メインページ
├── components/
│   ├── PricePlanCard.tsx     # 価格プラン表示
│   ├── PricePlanGrid.tsx     # プラン一覧グリッド
│   ├── PurchaseDialog.tsx    # 購入確認ダイアログ
│   ├── TestModeForm.tsx      # テストモード申請フォーム
│   └── PurchaseHistory.tsx   # 購入履歴
└── hooks/
    ├── useSPPlans.ts         # プラン取得フック
    └── useSPPurchase.ts      # 購入処理フック
```

### UI/UXデザイン

#### 価格プラン表示
- カード形式で各プランを表示
- 人気プランにはバッジ表示
- ボーナスSPを視覚的に強調
- 現在のSP残高を常時表示

#### 購入フロー
1. プラン選択
2. 確認ダイアログ表示
   - テストモード：申請理由入力
   - 本番モード：支払い情報確認
3. 処理中表示
4. 完了通知とSP残高更新

### テストモードUI

```typescript
// TestModeForm.tsx
interface TestModeFormProps {
  plan: SPPlan;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}

const TestModeForm: React.FC<TestModeFormProps> = ({ plan, onSubmit, onCancel }) => {
  return (
    <div className="space-y-4">
      <Alert>
        <InfoIcon className="h-4 w-4" />
        <AlertDescription>
          テストモードでのSP申請です。実際の課金は発生しません。
        </AlertDescription>
      </Alert>
      
      <div className="border rounded-lg p-4">
        <h4 className="font-semibold">{plan.name}</h4>
        <p className="text-sm text-muted-foreground">
          {plan.sp_amount} SP（{plan.price_jpy}円相当）
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="reason">申請理由</Label>
        <Textarea
          id="reason"
          placeholder="テストプレイのため、SP購入機能の動作確認..."
          required
          minLength={10}
          maxLength={500}
        />
      </div>
      
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          キャンセル
        </Button>
        <Button onClick={() => onSubmit(reason)}>
          申請する
        </Button>
      </div>
    </div>
  );
};
```

## セキュリティ設計

### 購入処理のセキュリティ
1. **レート制限**
   - 1ユーザーあたり5分間に3回まで
   - IPアドレスベースの制限も実装

2. **トランザクション管理**
   - データベーストランザクションで一貫性保証
   - 二重購入防止のための排他制御

3. **監査ログ**
   - 全ての購入申請を記録
   - ステータス変更履歴の保持

### テストモードのセキュリティ
1. **申請制限**
   - 1日あたりの申請回数制限
   - 累計申請額の上限設定

2. **自動承認の条件**
   - 環境変数で有効化が必要
   - 申請理由の最低文字数チェック
   - 不正なパターンの検出

## 実装スケジュール

### フェーズ1：基盤実装（2日）
- [ ] データモデルとマイグレーション
- [ ] 環境変数設定と設定管理
- [ ] 基本的なAPI実装

### フェーズ2：テストモード実装（2日）
- [ ] テストモード用API
- [ ] フロントエンドUI
- [ ] 自動承認ロジック

### フェーズ3：統合とテスト（1日）
- [ ] WebSocket通知統合
- [ ] E2Eテスト
- [ ] ドキュメント整備

### フェーズ4：本番モード準備（将来）
- [ ] Stripe SDK統合
- [ ] Webhookハンドラー
- [ ] 本番用UI実装

## テスト計画

### 単体テスト
- 購入申請API
- SP付与ロジック
- 環境変数切り替え

### 統合テスト
- 購入フロー全体
- SP残高の即時反映
- エラーケース処理

### E2Eテスト
- テストモードでの購入完了
- キャンセル処理
- 購入履歴表示

## 移行計画

### テストモードから本番モードへの移行
1. Stripe設定の追加
2. 環境変数の更新
3. 既存データの移行（必要に応じて）
4. 段階的な機能公開

## 注意事項

1. **テストモードの明示**
   - UIで常にテストモードであることを表示
   - 実際の課金が発生しないことを明記

2. **データ保護**
   - 購入履歴は削除不可
   - 個人情報の適切な管理

3. **将来の拡張性**
   - サブスクリプション対応
   - 複数通貨対応
   - プロモーションコード機能