# ログ派遣システム仕様

## 概要
ゲスタロカにおける「ログ」は、プレイヤーが編纂した記憶の集合体から生まれる独立したNPCエンティティです。プレイヤーは自身が創造したログに目的と初期地点を設定し、世界へと送り出します。ログは独自の意思で世界を旅し、他のプレイヤーと出会い、一定期間後に創造主の元へ帰還して成果を報告します。

## コアコンセプト

### 1. ログの独立性
- ログは契約や取引の対象ではなく、創造主から独立した存在として世界を旅する
- 各ログは独自の性格、目的、行動パターンを持つ
- 他のプレイヤーにとっては、通常のNPCと同様に出会い、交流できる存在

### 2. SP（Story Points）システム
**SP（ストーリーポイント）**は表向き「行動力」として表現されますが、実際は「世界への干渉力」を表す重要なリソースです。

#### SPの用途
- **プレイヤーの行動宣言**: 自由入力での行動には1-5 SP消費
- **ログの派遣**: 派遣期間に応じて10-100 SP消費
- **ログの能力強化**: 特殊スキルや装備の付与に追加SP消費
- **緊急召還**: 派遣中のログを即座に呼び戻す際にSP消費

#### SPの回復と購入
- **自然回復**: 1日あたり10 SP回復（無料プレイヤー）
- **購入オプション**:
  - 100 SP: ¥500
  - 500 SP: ¥2,000（20%ボーナス）
  - 1,000 SP: ¥3,500（42%ボーナス）
- **特別報酬**: イベントやログの成果により追加SP獲得

## ログ派遣システム

### 1. 派遣準備フェーズ

#### 1.1 ログの選択
- 編纂済みの完成ログから派遣対象を選択
- 各ログの現在状態（待機中/派遣中/休養中）を確認

#### 1.2 行動目的の設定
プレイヤーは以下のカテゴリーから主目的を選択し、詳細を記述：

- **探索型**: 特定の場所や情報を探す
  - 例：「第三階層の忘れられた図書館を探す」
  - SP消費: 基本20 SP + 階層深度×5 SP

- **交流型**: 特定の条件を持つ人物との出会いを求める
  - 例：「錬金術師のギルドメンバーと知り合う」
  - SP消費: 基本15 SP + 条件複雑度×3 SP

- **収集型**: アイテムや情報の収集
  - 例：「希少な薬草を集める」
  - SP消費: 基本10 SP + レアリティ×10 SP

- **護衛型**: 特定の場所や人物を守る
  - 例：「初心者エリアで新規プレイヤーを助ける」
  - SP消費: 基本25 SP + 危険度×5 SP

- **自由型**: ログの性格に任せた自由行動
  - 例：「お前の思うままに旅をしてこい」
  - SP消費: 基本30 SP（予測不能な分高コスト）

#### 1.3 初期スポーン地点の設定
- プレイヤーが訪れたことのある場所から選択
- 階層が深いほど追加SP消費（階層×2 SP）
- 特殊地点（ダンジョン内部など）は追加料金

#### 1.4 派遣期間の設定
- **短期派遣**: 1-3日（10-30 SP）
- **中期派遣**: 4-7日（40-70 SP）
- **長期派遣**: 8-14日（80-140 SP）
- **特別長期**: 15-30日（150-300 SP、特別許可必要）

### 2. 派遣中フェーズ

#### 2.1 ログの行動
- 設定された目的に基づいてAIが自律的に行動を決定
- 1日あたり3-5回の主要な行動を実行
- 他のプレイヤーやNPCとの交流機会

#### 2.2 活動記録
すべての行動は「旅の記録」として保存：
- 訪れた場所
- 出会った人物（プレイヤー/NPC）
- 重要な会話や出来事
- 獲得したアイテムや情報

#### 2.3 他プレイヤーとの遭遇
- ログは他のプレイヤーのゲームセッションに通常のNPCとして登場
- プレイヤーは特別なマーカーでログNPCを識別可能
- 交流内容は両方のプレイヤーの記録に残る

### 3. 帰還フェーズ

#### 3.1 帰還通知
- 派遣期間終了の24時間前に通知
- 延長オプション（追加SP消費で可能）

#### 3.2 成果報告
ログは以下の形式で報告を行う：

```
【旅の総括】
訪問地点: 12箇所
出会った人物: 8名（プレイヤー3名、NPC5名）
主目的達成度: 75%

【特筆すべき出来事】
- 第二階層の隠し通路を発見
- 冒険者ギルドのクエストを3つ完了
- 迷子の商人を助けて報酬を獲得

【獲得物】
- 銀貨 x 150
- 薬草 x 8
- 古い地図の断片 x 1
- 新しい「ログの欠片」x 2

【創造主への個人的メッセージ】
「マスター、楽しい旅でした。特に若い冒険者を助けた時の彼らの笑顔が印象的でした。また旅に出たいです。」
```

#### 3.3 報酬と経験
- **直接報酬**: 獲得したアイテムや通貨
- **情報報酬**: 新しい場所や人物の情報
- **ログ成長**: 経験によるスキルアップや性格の変化
- **SP還元**: 目的達成度に応じて5-20%のSP還元

## ログの成長と変化

### 1. 経験による成長
- 派遣回数に応じてレベルアップ
- 特定の行動を繰り返すことでスキル習得
- 印象的な出来事による性格の変化

### 2. 関係性の構築
- 頻繁に出会うプレイヤーやNPCとの親密度
- 特定の場所への愛着度
- 他のログとの友情や対立

### 3. 独自ストーリーの発展
- 複数回の派遣で連続したストーリーが展開
- 過去の出会いや約束が将来の行動に影響
- プレイヤー間で共有される「有名なログ」の誕生

## 技術仕様

### データモデル

```python
class LogDispatch(SQLModel, table=True):
    __tablename__ = "log_dispatches"
    
    id: str = Field(primary_key=True)
    completed_log_id: str = Field(foreign_key="completed_logs.id")
    dispatcher_id: str = Field(foreign_key="characters.id")
    
    # 派遣設定
    objective_type: ObjectiveType  # EXPLORE, INTERACT, COLLECT, GUARD, FREE
    objective_details: dict[str, Any]
    initial_location_id: str
    dispatch_duration_days: int
    sp_cost: int
    
    # 状態
    status: DispatchStatus  # PREPARING, ACTIVE, RETURNING, COMPLETED
    dispatched_at: datetime
    expected_return_at: datetime
    actual_return_at: Optional[datetime]
    
    # 活動記録
    travel_log: list[dict[str, Any]]  # 時系列の活動記録
    encounters: list[dict[str, Any]]  # 他プレイヤーとの出会い
    
    # 成果
    achievements: dict[str, Any]
    rewards: dict[str, Any]
    objective_completion_rate: float

class PlayerSP(SQLModel, table=True):
    __tablename__ = "player_sp"
    
    character_id: str = Field(primary_key=True, foreign_key="characters.id")
    current_sp: int = Field(default=10)
    total_purchased_sp: int = Field(default=0)
    total_spent_sp: int = Field(default=0)
    last_natural_recovery: datetime
    
    # 購入履歴
    purchase_history: list[dict[str, Any]]
```

### API エンドポイント

```python
# ログ派遣関連
POST /api/v1/logs/dispatch
GET /api/v1/logs/dispatches/{character_id}
GET /api/v1/logs/dispatch/{dispatch_id}
POST /api/v1/logs/dispatch/{dispatch_id}/recall

# SP管理
GET /api/v1/sp/{character_id}
POST /api/v1/sp/purchase
GET /api/v1/sp/history/{character_id}

# ログ遭遇
GET /api/v1/logs/encounters/{session_id}
POST /api/v1/logs/encounter/{log_id}/interact
```

## ゲームバランスとマネタイズ

### 無料プレイの範囲
- 1日10 SPの自然回復で基本的なプレイは可能
- 3-4日に1回の短期ログ派遣
- 慎重な行動選択でSPを節約

### 課金プレイの利点
- 複数のログを同時派遣
- 長期派遣による深い物語体験
- 自由な行動宣言による創造的プレイ
- 特別なログ能力の開放

### 継続的な収益モデル
- 月額パス（毎日追加20 SP）: ¥1,000/月
- シーズンパス（3ヶ月）: ¥2,500
- 特別イベント時のSPセール
- ログ装飾アイテムの販売

## 実装優先順位

### Phase 1: 基本システム
1. SPシステムの実装
2. ログ派遣UIの基本機能
3. 簡易的な活動シミュレーション
4. 帰還と報告機能

### Phase 2: 遭遇システム
1. 他プレイヤーのセッションへのログ出現
2. 交流記録システム
3. ログ識別マーカー

### Phase 3: 成長と物語
1. ログの経験値システム
2. 関係性の追跡
3. 連続ストーリーの生成

### Phase 4: マネタイズ強化
1. SP購入システム
2. 月額パスの実装
3. 特別イベントの開催