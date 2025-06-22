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

## 今後の実装予定

### Phase 1: API実装（次のステップ）
- SP残高取得API
- SP消費API（トランザクション処理）
- SP履歴取得API
- エラーハンドリング

### Phase 2: ビジネスロジック
- 時間回復ロジック
- 消費計算ロジック
- 上限値管理
- 不正防止チェック

### Phase 3: フロントエンド統合
- SP表示コンポーネント
- 消費確認ダイアログ
- リアルタイム更新
- エラー表示

## 関連ドキュメント

- [SPシステム仕様](../../03_worldbuilding/game_mechanics/spSystem.md)
- [プロジェクトブリーフv2](../../01_project/projectbrief_v2.md)
- [実装ロードマップ](../../01_project/implementationRoadmap.md)