# SPシステム実装詳細

## 概要

SPシステムは「世界への干渉力」として、プレイヤーがゲーム内で行動するためのリソース管理システムです。2025年6月22日に基本的なデータモデルの実装が完了しました。

## データモデル設計

### PlayerSPモデル（実際のテーブル名: player_sp）

プレイヤーのSP残高と統計情報を管理するモデルです。

```python
class PlayerSP(SQLModel, table=True):
    """プレイヤーのSP（Story Points）残高と統計情報"""
    __tablename__ = "player_sp"
    
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="users.id", unique=True, index=True)
    
    # SP残高
    current_sp: int = Field(default=0, ge=0)  # 現在のSP残高（0以上）
    
    # 統計情報
    total_earned_sp: int = Field(default=0, ge=0)  # 累積獲得SP
    total_consumed_sp: int = Field(default=0, ge=0)  # 累積消費SP
    total_purchased_sp: int = Field(default=0, ge=0)  # 購入による総SP
    total_purchase_amount: int = Field(default=0, ge=0)  # 総購入金額（円）
    
    # 日次情報
    last_daily_recovery_at: datetime | None = Field(default=None)  # 最終日次回復時刻
    consecutive_login_days: int = Field(default=0, ge=0)  # 連続ログイン日数
    last_login_date: datetime | None = Field(default=None)  # 最終ログイン日
    
    # サブスクリプション情報
    active_subscription: SPSubscriptionType | None = Field(default=None)
    subscription_expires_at: datetime | None = Field(default=None)
    
    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

#### 主要フィールド

- **current_sp**: 現在のSP残高（0以上の整数）
- **total_earned_sp/total_consumed_sp**: 累積統計（プレイヤーの活動履歴）
- **total_purchased_sp**: 購入によって獲得した総SP
- **last_daily_recovery_at**: 最終日次回復時刻（定期回復の計算に使用）
- **active_subscription**: 有効な月額パスの種類（Basic/Premium）

### SPTransactionモデル（実際のテーブル名: sp_transactions）

SP変動の詳細な履歴を記録するモデルです。

```python
class SPTransaction(SQLModel, table=True):
    """SP取引履歴"""
    __tablename__ = "sp_transactions"
    
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    player_sp_id: str = Field(foreign_key="player_sp.id", index=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    
    # 取引情報
    transaction_type: SPTransactionType = Field(index=True)
    amount: int = Field()  # 正の値は獲得、負の値は消費
    
    # 残高追跡
    balance_before: int = Field(ge=0)  # 変動前のSP残高
    balance_after: int = Field(ge=0)  # 変動後のSP残高
    
    # 詳細情報
    description: str = Field()  # 取引の説明
    metadata: dict = Field(default_factory=dict, sa_column=Column(JSON))
    
    # 関連エンティティ（オプション）
    related_entity_type: str | None = Field(default=None)
    related_entity_id: str | None = Field(default=None)
    
    # タイムスタンプ
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

#### 主要フィールド

- **transaction_type**: 取引種別（DAILY_RECOVERY/PURCHASE/FREE_ACTION/LOG_DISPATCH等）
- **amount**: 変動量（正の値は獲得、負の値は消費）
- **balance_before/after**: 変動前後のSP残高（監査証跡）
- **metadata**: 追加情報をJSON形式で保存
- **related_entity_type/id**: 関連エンティティへの汎用的な参照

### 列挙型定義

```python
class SPTransactionType(str, Enum):
    """SP取引タイプ"""
    # 取得系
    DAILY_RECOVERY = "daily_recovery"  # 毎日の自然回復
    PURCHASE = "purchase"  # 購入
    ACHIEVEMENT = "achievement"  # 実績報酬
    EVENT_REWARD = "event_reward"  # イベント報酬
    LOG_RESULT = "log_result"  # ログ成果報酬
    LOGIN_BONUS = "login_bonus"  # ログインボーナス
    REFUND = "refund"  # 返金・補填
    
    # 消費系
    FREE_ACTION = "free_action"  # 自由行動宣言
    LOG_DISPATCH = "log_dispatch"  # ログ派遣
    LOG_ENHANCEMENT = "log_enhancement"  # ログ強化
    MEMORY_INHERITANCE = "memory_inheritance"  # 記憶継承
    SYSTEM_FUNCTION = "system_function"  # システム機能
    MOVEMENT = "movement"  # 場所移動
    EXPLORATION = "exploration"  # 探索行動
    
    # システム系
    ADJUSTMENT = "adjustment"  # システム調整
    MIGRATION = "migration"  # データ移行
    ADMIN_GRANT = "admin_grant"  # 管理者付与
    ADMIN_DEDUCT = "admin_deduct"  # 管理者減算

class SPPurchasePackage(str, Enum):
    """SP購入パッケージ"""
    SMALL = "small"  # 100 SP (¥500)
    MEDIUM = "medium"  # 300 SP (¥1,200)
    LARGE = "large"  # 500 SP (¥2,000)
    EXTRA_LARGE = "extra_large"  # 1,000 SP (¥3,500)
    MEGA = "mega"  # 3,000 SP (¥8,000)

class SPSubscriptionType(str, Enum):
    """SP月額パスの種類"""
    BASIC = "basic"  # ベーシックパス (¥1,000/月)
    PREMIUM = "premium"  # プレミアムパス (¥2,500/月)
```

## データベース設計

### テーブル構造

1. **player_spテーブル**
   - プレイヤーごとに1レコード
   - player_idにユニーク制約
   - 高頻度でアクセスされるため適切なインデックス設定

2. **sp_transactionsテーブル**
   - 全てのSP変動を記録
   - player_idと created_atで複合インデックス
   - 関連エンティティIDで検索可能

### マイグレーション（Alembic）

実際のマイグレーションファイル: `alembic/versions/30f5fb512c38_add_sp_system_models.py`

主要なテーブル構造:

1. **player_spテーブル**
   - プレイヤーごとに1レコード
   - user_idにユニーク制約
   - 高頻度でアクセスされるため適切なインデックス設定

2. **sp_transactionsテーブル**
   - 全てのSP変動を記録
   - user_idとcreated_atで複合インデックス
   - metadataフィールドでJSON形式の追加情報を保存

## 実装の特徴

### 1. 型安全性
- SQLModelによる型定義
- Pydanticバリデーション
- 列挙型による取引タイプの制限

### 2. 監査証跡
- 全ての取引を記録
- 変動前後の残高を保存
- 関連エンティティとの紐付け

### 3. 拡張性
- 新しい取引タイプの追加が容易
- 関連エンティティの追加が可能
- 統計情報の拡張が簡単

### 4. パフォーマンス考慮
- 適切なインデックス設計
- 残高の直接更新（集計不要）
- 履歴と現在値の分離

## 実装状況

### ✅ Phase 1: API実装（2025/06/22完了）

#### 実装済みエンドポイント
- `GET /api/v1/sp/balance` - SP残高詳細取得
- `GET /api/v1/sp/balance/summary` - SP残高概要取得（軽量版）
- `POST /api/v1/sp/consume` - SP消費（トランザクション処理）
- `POST /api/v1/sp/daily-recovery` - 日次回復処理
- `GET /api/v1/sp/transactions` - 取引履歴取得（フィルタリング対応）
- `GET /api/v1/sp/transactions/{id}` - 取引詳細取得

#### サービスクラス（SPService）の主要機能
- **初期化処理**: 新規プレイヤーに50SPボーナス付与
- **SP消費**: サブスクリプション割引の自動適用
- **日次回復**: 基本10SP + サブスクボーナス + 連続ログインボーナス
- **取引記録**: 全ての増減を監査証跡として保存
- **エラーハンドリング**: InsufficientSPError、SPSystemError

#### テストカバレッジ
- 全エンドポイントの統合テスト作成
- エラーケース（残高不足、重複回復など）のテスト
- 権限チェックのテスト

### ✅ Phase 2: ビジネスロジック（2025/06/22完了）
- **日次回復ロジック**: UTC 4時に1日1回、自動回復
- **消費計算ロジック**: サブスクリプション割引（Basic 10%、Premium 20%）
- **連続ログインボーナス**: 7日（+5SP）、14日（+10SP）、30日（+20SP）
- **不正防止**: 残高チェック、重複回復防止、取引整合性チェック

### ✅ Phase 3: フロントエンド統合（2025/06/22完了）

#### React Queryフック実装
```typescript
// useSPBalance - SP残高取得
export const useSPBalance = (playerId?: string) => {
  return useQuery({
    queryKey: ['sp', 'balance', playerId],
    queryFn: () => apiClient.getSPBalance(),
    enabled: !!playerId,
    staleTime: 30000, // 30秒
  });
};

// useConsumeSP - SP消費
export const useConsumeSP = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SPConsumeRequest) => apiClient.consumeSP(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] });
      queryClient.invalidateQueries({ queryKey: ['sp', 'transactions'] });
    },
  });
};
```

#### UIコンポーネント実装
- **SPDisplay**: ヘッダーに統合されたSP残高表示
  - リアルタイム更新（React Query使用）
  - アニメーション付き残高変更（framer-motion）
  - エラー状態の表示
  - **2025/06/28追加機能**:
    - SP残高100未満での警告表示（視覚的フィードバック）
    - 増減時のスケール＆色変化アニメーション
    - 増減額の一時表示（フローティングインジケーター）
    - WebSocketイベント（sp_update）対応
    - 5秒staleTime、30秒自動再取得
- **SPTransactionHistory**: 取引履歴表示
  - ページネーション対応
  - フィルタリング（日付、タイプ）
  - 詳細表示モーダル
- **SPConsumptionDialog**: 消費確認ダイアログ
  - 消費量の明確な表示
  - 残高不足時の警告
  - サブスクリプション割引の表示

#### ゲームセッションとの統合
```typescript
// GameSession内でのSP消費実装
const handleActionExecution = async (action: GameAction) => {
  // SP消費量計算
  const spCost = action.type === 'choice' ? 2 : calculateFreeActionCost(action.text);
  
  // SP消費確認
  if (currentSP < spCost) {
    showError('SP不足です');
    return;
  }
  
  // SP消費実行
  await consumeSP({
    amount: spCost,
    type: 'CONSUMED',
    subtype: 'ACTION',
    description: `行動実行: ${action.text.slice(0, 50)}...`,
    characterId: character.id,
    sessionId: session.id,
  });
  
  // アクション実行
  await executeAction(action);
};
```

## セキュリティ設計（2025/06/28検証済み）

### API保護メカニズム
1. **認証・認可**
   - すべてのエンドポイントで`get_current_active_user`必須
   - ユーザーは自分のSPのみ操作可能

2. **SP増加の制限**
   - `add_sp`メソッドは内部APIのみ（公開エンドポイントなし）
   - 正当な増加方法のみ許可：
     - 日次回復（1日1回）
     - 実績報酬
     - ログ成果
     - 購入（実装予定）

3. **監査証跡**
   - すべての取引をSPTransactionテーブルに記録
   - 不正操作の追跡が可能

## 実装済み機能（2025/07/02更新）

### ✅ Celeryタスクによる自動化
1. **日次SP回復タスク** (`process_daily_sp_recovery`)
   - 毎日UTC 4時に自動実行
   - 基本回復: 10 SP/日
   - サブスクリプションボーナス: Basic +20 SP、Premium +50 SP
   - 連続ログインボーナス: 7日（+5）、14日（+10）、30日（+20）

2. **サブスクリプション期限チェック** (`check_subscription_expiry`)
   - 1時間ごとに自動実行
   - 期限切れサブスクリプションの自動無効化

3. **Celeryスケジュール設定**（backend/app/celery.py）
   ```python
   "daily-sp-recovery": {
       "task": "app.tasks.sp_tasks.process_daily_sp_recovery",
       "schedule": crontab(hour=4, minute=0),  # UTC 4時
   },
   "check-subscription-expiry": {
       "task": "app.tasks.sp_tasks.check_subscription_expiry",
       "schedule": 3600.0,  # 1時間ごと
   }
   ```

### ✅ SPサブスクリプション機能（2025/07/02実装）
1. **サブスクリプションモデル**
   - Basic（月額980円）: 20 SP/日の追加回復
   - Premium（月額2,980円）: 50 SP/日の追加回復
   - Stripe統合による安全な決済処理

2. **購入・管理API**
   - `POST /api/v1/sp/subscription/purchase` - サブスクリプション購入
   - `POST /api/v1/sp/subscription/cancel` - サブスクリプション解約
   - `GET /api/v1/sp/subscription/current` - 現在の契約状況

3. **Stripe Webhook統合**
   - 支払い完了、更新、失敗の自動処理
   - サブスクリプション状態の自動更新

### ✅ 管理画面SPシステム（2025/07/02実装）
1. **管理者用APIエンドポイント**
   - `GET /api/v1/admin/sp/players` - 全プレイヤーのSP情報一覧
   - `GET /api/v1/admin/sp/players/{user_id}` - 特定プレイヤーの詳細
   - `GET /api/v1/admin/sp/players/{user_id}/transactions` - 取引履歴
   - `POST /api/v1/admin/sp/adjust` - SP付与・調整
   - `POST /api/v1/admin/sp/batch-adjust` - 一括調整

2. **管理画面UI**
   - プレイヤーSP残高の一覧表示
   - ユーザー名・メールでの検索機能
   - SP調整ダイアログ（理由付き）
   - 取引履歴の確認

3. **新しいSP取引タイプ**
   - `ADMIN_GRANT` - 管理者による付与
   - `ADMIN_DEDUCT` - 管理者による減算

## 今後の実装予定

### Phase 4: 本番環境向け設定
- Stripe本番環境設定
- 本番用価格設定の確認
- Webhook URLの本番環境設定
- 返金処理の実装

### Phase 5: 機能拡張
- バッチ処理UI（CSV一括インポート）
- SP統計ダッシュボード
- 詳細な分析ツール
- サブスクリプション手動管理機能

## 関連ドキュメント

- [SPシステム仕様](../../03_worldbuilding/game_mechanics/spSystem.md)
- [プロジェクトブリーフv2](../../01_project/projectbrief_v2.md)
- [実装ロードマップ](../../01_project/implementationRoadmap.md)