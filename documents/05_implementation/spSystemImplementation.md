# SPシステム実装詳細

## 概要

SPシステムは「世界への干渉力」として、プレイヤーがゲーム内で行動するためのリソース管理システムです。2025年6月22日に基本的なデータモデルの実装が完了しました。

## データモデル設計

### PlayerSPモデル

プレイヤーのSP残高と統計情報を管理するモデルです。

```python
class PlayerSP(SQLModel, table=True):
    """プレイヤーのSP（Story Points）残高と統計情報"""
    __tablename__ = "player_sp"
    
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    player_id: UUID = Field(foreign_key="players.id", unique=True, index=True)
    
    # SP残高
    current_sp: int = Field(default=100, ge=0)  # 現在のSP残高（0以上）
    max_sp: int = Field(default=100, ge=0)  # SP上限値
    
    # 時間管理
    last_refill_at: datetime | None = Field(default=None)  # 最終回復時刻
    
    # 統計情報
    total_earned: int = Field(default=0, ge=0)  # 累積獲得SP
    total_spent: int = Field(default=0, ge=0)  # 累積消費SP
    
    # タイムスタンプ
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

#### 主要フィールド

- **current_sp**: 現在のSP残高（0以上の整数）
- **max_sp**: SP上限値（デフォルト100、課金により拡張可能）
- **last_refill_at**: 最終回復時刻（定期回復の計算に使用）
- **total_earned/spent**: 累積統計（プレイヤーの活動履歴）

### SPTransactionモデル

SP変動の詳細な履歴を記録するモデルです。

```python
class SPTransaction(SQLModel, table=True):
    """SP取引履歴"""
    __tablename__ = "sp_transactions"
    
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    player_id: UUID = Field(foreign_key="players.id", index=True)
    
    # 取引情報
    transaction_type: SPTransactionType = Field(sa_column=Column(Enum(SPTransactionType)))
    subtype: SPEventSubtype | None = Field(
        default=None, 
        sa_column=Column(Enum(SPEventSubtype))
    )
    amount: int = Field()  # 正の値は獲得、負の値は消費
    
    # 残高追跡
    balance_before: int = Field(ge=0)  # 変動前のSP残高
    balance_after: int = Field(ge=0)  # 変動後のSP残高
    
    # 説明
    description: str | None = Field(default=None, max_length=500)
    
    # 関連エンティティ（オプション）
    character_id: UUID | None = Field(default=None, foreign_key="characters.id")
    session_id: UUID | None = Field(default=None, foreign_key="game_sessions.id")
    completed_log_id: UUID | None = Field(default=None, foreign_key="completed_logs.id")
    
    # タイムスタンプ
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

#### 主要フィールド

- **transaction_type**: 取引種別（EARNED/CONSUMED/REFILL/ADMIN）
- **subtype**: 詳細イベントタイプ（ACTION/EXPLORATION等）
- **amount**: 変動量（正の値は獲得、負の値は消費）
- **balance_before/after**: 変動前後のSP残高（監査証跡）
- **関連ID**: キャラクター、セッション、ログへの参照

### 列挙型定義

```python
class SPTransactionType(str, Enum):
    """SP取引タイプ"""
    EARNED = "earned"      # 獲得（活動報酬）
    CONSUMED = "consumed"  # 消費（行動実行）
    REFILL = "refill"      # 回復（時間経過/課金）
    ADMIN = "admin"        # 管理者操作

class SPEventSubtype(str, Enum):
    """SP変動の詳細イベントタイプ"""
    # 消費イベント
    ACTION = "action"                    # 自由行動
    EXPLORATION = "exploration"          # 探索
    LOG_COMPILE = "log_compile"          # ログ編纂
    LOG_DISPATCH = "log_dispatch"        # ログ派遣
    
    # 獲得イベント  
    DAILY_LOGIN = "daily_login"          # デイリーログイン
    ACHIEVEMENT = "achievement"          # 実績達成
    QUEST_COMPLETE = "quest_complete"    # クエスト完了
    LOG_CONTRACT = "log_contract"        # ログ契約報酬
    
    # 回復イベント
    TIME_REFILL = "time_refill"          # 時間回復
    ITEM_REFILL = "item_refill"          # アイテム使用
    PURCHASE_REFILL = "purchase_refill"  # 課金回復
    
    # 管理イベント
    ADMIN_GRANT = "admin_grant"          # 管理者付与
    ADMIN_DEDUCT = "admin_deduct"        # 管理者減算
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

### マイグレーション

```sql
-- player_spテーブル
CREATE TABLE player_sp (
    id UUID PRIMARY KEY,
    player_id UUID NOT NULL UNIQUE REFERENCES players(id),
    current_sp INTEGER NOT NULL CHECK (current_sp >= 0),
    max_sp INTEGER NOT NULL CHECK (max_sp >= 0),
    last_refill_at TIMESTAMP WITH TIME ZONE,
    total_earned INTEGER NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
    total_spent INTEGER NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- sp_transactionsテーブル
CREATE TABLE sp_transactions (
    id UUID PRIMARY KEY,
    player_id UUID NOT NULL REFERENCES players(id),
    transaction_type sp_transaction_type NOT NULL,
    subtype sp_event_subtype,
    amount INTEGER NOT NULL,
    balance_before INTEGER NOT NULL CHECK (balance_before >= 0),
    balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
    description VARCHAR(500),
    character_id UUID REFERENCES characters(id),
    session_id UUID REFERENCES game_sessions(id),
    completed_log_id UUID REFERENCES completed_logs(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- インデックス
CREATE INDEX idx_player_sp_player_id ON player_sp(player_id);
CREATE INDEX idx_sp_transactions_player_id ON sp_transactions(player_id);
CREATE INDEX idx_sp_transactions_created_at ON sp_transactions(created_at);
CREATE INDEX idx_sp_transactions_player_created ON sp_transactions(player_id, created_at);
```

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
   - 毎日UTC 4時（JST 13時）に自動実行
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
       "schedule": crontab(hour=4, minute=0),  # UTC 4時 = JST 13時
   },
   "check-subscription-expiry": {
       "task": "app.tasks.sp_tasks.check_subscription_expiry",
       "schedule": 3600.0,  # 1時間ごと
   }
   ```

## 今後の実装予定

### Phase 4: 購入システム統合
- 決済プロバイダー統合（Stripe連携は一部実装済み）
- サブスクリプション購入・更新API
- レシート管理
- 返金処理

### Phase 5: 管理機能の強化
- 管理画面でのSP付与・調整機能
- サブスクリプション手動管理
- SP取引履歴の詳細分析ツール

## 関連ドキュメント

- [SPシステム仕様](../../03_worldbuilding/game_mechanics/spSystem.md)
- [プロジェクトブリーフv2](../../01_project/projectbrief_v2.md)
- [実装ロードマップ](../../01_project/implementationRoadmap.md)