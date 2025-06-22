# ログ派遣システム実装ガイド

## 概要

ログ派遣システムは、プレイヤーが編纂した完成ログを他のプレイヤーの世界に独立NPCとして派遣する機能です。契約ベースではなく、ログが独立した存在として世界を旅する仕組みを実装しています。

## システムアーキテクチャ

### データフロー

```
プレイヤー
    ↓ [派遣作成]
DispatchForm (UI)
    ↓ [SP消費確認]
dispatch API
    ↓ [派遣記録作成]
LogDispatch (DB)
    ↓ [Celeryタスク起動]
process_dispatch_activities
    ↓ [定期的な活動]
活動シミュレーション
    ↓ [成果蓄積]
DispatchReport (DB)
    ↓ [SP還元]
プレイヤー
```

## バックエンド実装

### 1. データモデル

#### LogDispatch
```python
class LogDispatch(SQLModel, table=True):
    """ログ派遣記録"""
    id: str
    completed_log_id: str  # 派遣するログ
    dispatcher_id: str     # 派遣したキャラクター
    
    # 派遣設定
    objective_type: DispatchObjectiveType
    objective_detail: str
    initial_location: str
    dispatch_duration_days: int
    
    # SP関連
    sp_cost: int
    sp_refund_amount: int
    achievement_score: float
    
    # 活動記録
    travel_log: list[dict]
    collected_items: list[dict]
    discovered_locations: list[str]
    
    # ステータスとタイムスタンプ
    status: DispatchStatus
    created_at: datetime
    dispatched_at: Optional[datetime]
    expected_return_at: Optional[datetime]
    actual_return_at: Optional[datetime]
```

#### DispatchObjectiveType
- `EXPLORE`: 探索型 - 新しい場所や情報を発見
- `INTERACT`: 交流型 - 他のキャラクターとの出会いを求める
- `COLLECT`: 収集型 - 特定のアイテムや情報を収集
- `GUARD`: 護衛型 - 特定の場所や人物を守る
- `FREE`: 自由型 - ログの性格に任せて行動

### 2. APIエンドポイント

#### POST /api/v1/dispatch/dispatch
派遣を作成し、SPを消費します。

```python
async def create_dispatch(dispatch_in: DispatchCreate) -> DispatchRead:
    # 1. キャラクター所有権確認
    # 2. 完成ログの状態確認
    # 3. SP消費量計算（10 + 日数 * 5、上限300）
    # 4. SP残高確認・消費
    # 5. 派遣記録作成
    # 6. Celeryタスク起動
```

#### GET /api/v1/dispatch/dispatches
自分の派遣一覧を取得します。

#### GET /api/v1/dispatch/dispatches/{id}
派遣の詳細情報（遭遇記録含む）を取得します。

#### POST /api/v1/dispatch/dispatches/{id}/recall
派遣を緊急召還します（追加SP消費）。

### 3. Celeryタスク

#### process_dispatch_activities
派遣中の活動を定期的にシミュレートします。

```python
@current_app.task
def process_dispatch_activities(dispatch_id: str):
    # 1. 派遣記録を取得
    # 2. 活動をシミュレート（目的に応じた処理）
    # 3. 成果を記録
    # 4. 期限確認
    # 5. 次の活動をスケジュール or 報告書生成
```

#### 活動シミュレーションのパターン
- **探索型**: 30%の確率で新しい場所を発見
- **交流型**: 40%の確率で他のキャラクターと遭遇
- **収集型**: 25%の確率でアイテムを発見
- **護衛型**: 10%の確率で脅威に対処
- **自由型**: ランダムな行動パターン

## フロントエンド実装

### 1. コンポーネント構成

#### DispatchForm
派遣作成フォームコンポーネント。

主な機能:
- 派遣目的の選択（ラジオボタン）
- 目的詳細の入力（テキストエリア）
- 派遣期間の設定（スライダー、1-30日）
- SP消費量の自動計算・表示
- 初期地点の指定

#### DispatchList
派遣一覧を表示するコンポーネント。

主な機能:
- ステータスでのフィルタリング
- 派遣中/完了/召還済みの視覚的区別
- 達成度とSP還元量の表示
- 詳細表示へのナビゲーション

#### DispatchDetail
派遣の詳細情報を表示するモーダル。

タブ構成:
1. **概要**: 基本情報、派遣期間、SP消費量
2. **活動記録**: 時系列の活動ログ
3. **遭遇**: 他のキャラクターとの交流記録
4. **成果**: 達成度、収集物、発見場所、報告書

### 2. 状態管理

#### React Query使用
```typescript
// 派遣一覧の取得
const { data: dispatches } = useQuery({
  queryKey: ['dispatches', statusFilter],
  queryFn: () => dispatchApi.getMyDispatches({ status })
})

// 派遣作成
const createDispatchMutation = useMutation({
  mutationFn: (data) => dispatchApi.createDispatch(data),
  onSuccess: () => {
    queryClient.invalidateQueries(['dispatches'])
    queryClient.invalidateQueries(['player-sp'])
  }
})
```

## SP消費と還元の仕組み

### 消費計算
```typescript
const calculateSpCost = (days: number) => {
  const cost = 10 + days * 5
  return Math.min(cost, 300) // 上限300SP
}
```

### 還元計算
```python
def calculate_sp_refund(dispatch: LogDispatch) -> int:
    # 達成度に基づいて最大20%を還元
    return int(dispatch.sp_cost * dispatch.achievement_score * 0.2)
```

## セキュリティ考慮事項

1. **所有権確認**: 派遣前にキャラクターとログの所有権を確認
2. **SP残高確認**: 消費前に十分な残高があることを確認
3. **レート制限**: 短時間での大量派遣を防ぐ（将来実装）
4. **データ検証**: 派遣期間や目的の妥当性を検証

## パフォーマンス最適化

1. **非同期処理**: Celeryによるバックグラウンド処理
2. **バッチ処理**: 複数の活動を一度にシミュレート
3. **キャッシュ**: React Queryによるクライアントサイドキャッシュ
4. **インデックス**: dispatcher_id、statusでのクエリ最適化

## 今後の拡張ポイント

1. **GM AI統合**: より高度な活動シミュレーション
2. **相互作用**: 派遣ログ同士の出会いと影響
3. **成果の反映**: 収集アイテムのゲーム内利用
4. **評価システム**: 他プレイヤーによる派遣ログの評価
5. **特殊イベント**: レアな遭遇や発見の実装