# 物語主導型移動システム設計書

## 概要
ゲスタロカの移動システムは、プレイヤーが直接的に移動先を選ぶのではなく、GM AIが紡ぐ物語の流れに従って自然に場所が変化していく、ナラティブ中心の設計とします。

## 設計理念

### 1. 物語が移動を導く
- プレイヤーの選択や行動が物語を生成
- 物語の展開に応じて自然に場所が変化
- ミニマップは現在地の確認と世界観の把握のためのツール

### 2. 没入感の最大化
- 「移動する」という機械的な行為を排除
- キャラクターの行動と環境の変化が有機的に連動
- テキストベースMMOとしての本質を重視

## システムアーキテクチャ

### 物語生成フロー

```
┌─────────────────────────────────────────┐
│      Player Action/Choice               │
│  （調べる、話す、進む、戻る等）           │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│         GM AI Council                   │
│  - 脚本家AI: 物語展開を決定             │
│  - 世界の意識AI: 場所遷移を判断         │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│      Narrative Processing               │
│  - 物語テキスト生成                     │
│  - 場所遷移の必要性判定                 │
│  - イベント発生判定                     │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│     Location Update (if needed)         │
│  - キャラクター位置更新                 │
│  - ミニマップ反映                       │
│  - 新環境の描写                         │
└─────────────────────────────────────────┘
```

## 移動トリガーパターン

### 1. 物語による自然な遷移
```python
class NarrativeTransition:
    """物語の流れによる場所遷移"""
    
    triggers = {
        "道を進む": "隣接する場所への移動",
        "扉を開ける": "建物内部への進入",
        "階段を上る": "上層階への移動",
        "転送装置を使う": "遠隔地への瞬間移動",
        "意識を失う": "未知の場所への強制移動"
    }
```

### 2. 行動の結果としての移動
```python
# 例: 調査行動が移動を引き起こす
player_action = "奥の部屋を調べる"

gm_response = """
あなたは薄暗い廊下を進み、奥の扉に手をかけた。
重い扉がゆっくりと開くと、そこには古い書庫が広がっていた。
埃っぽい空気の中、無数の本が天井まで積み上げられている。

[現在地: 忘れられた書庫]
"""
# → 自動的に場所が「廊下」から「忘れられた書庫」へ更新
```

### 3. イベントドリブンな遷移
```python
# 例: NPCとの会話が移動を引き起こす
npc_dialogue = """
「ついて来なさい。見せたいものがある」
老人はそう言うと、壁の一部に手をかざした。
石壁が音もなく横にスライドし、隠し通路が現れる。

[老人の後をついていく]
→ 隠し通路を通り、地下の秘密の部屋へ...
"""
```

## 実装詳細

### GM AIプロンプト設計

```python
async def generate_narrative_with_movement(
    character: Character,
    action: str,
    current_location: Location,
    game_state: GameState
) -> NarrativeResponse:
    """物語生成と場所遷移の判定"""
    
    prompt = f"""
    ## 現在の状況
    キャラクター: {character.name}
    現在地: {current_location.name}
    行動: {action}
    
    ## 指示
    1. キャラクターの行動に基づいて物語を展開してください
    2. 物語の流れで自然に場所が変わる場合は、新しい場所を設定してください
    3. 場所が変わる場合は、移動の過程も描写に含めてください
    
    ## 出力形式
    {{
        "narrative": "物語テキスト",
        "location_changed": true/false,
        "new_location_id": "場所ID（変更時のみ）",
        "movement_description": "移動描写（変更時のみ）",
        "sp_cost": 消費SP（移動距離に応じて）
    }}
    """
    
    return await gm_ai_service.generate_narrative(prompt, game_state)
```

### 場所遷移の判定ロジック

```python
class MovementAnalyzer:
    """テキストから移動の必要性を分析"""
    
    # 移動を示唆するキーワード
    MOVEMENT_INDICATORS = [
        "進む", "向かう", "移動", "到着", "辿り着く",
        "入る", "出る", "上る", "下る", "渡る"
    ]
    
    # 場所の変化を示すフレーズ
    LOCATION_CHANGE_PHRASES = [
        "そこには", "目の前に", "辿り着いた", 
        "到着した", "足を踏み入れた"
    ]
    
    @staticmethod
    def should_change_location(narrative: str, action: str) -> bool:
        """物語テキストと行動から場所変更の必要性を判定"""
        # キーワードマッチング + コンテキスト分析
        pass
```

### ミニマップの更新

```typescript
// フロントエンド: ミニマップの受動的更新
interface NarrativeUpdate {
  narrative: string;
  locationChanged: boolean;
  newLocation?: {
    id: string;
    name: string;
    coordinates: { x: number; y: number };
  };
  characterPath?: Array<{ x: number; y: number }>;  // 移動軌跡
}

// WebSocketで物語更新を受信
socket.on('narrative_update', (update: NarrativeUpdate) => {
  // 物語テキストを表示
  displayNarrative(update.narrative);
  
  // 場所が変わった場合、ミニマップをスムーズに更新
  if (update.locationChanged && update.newLocation) {
    animateLocationTransition(
      currentLocation,
      update.newLocation,
      update.characterPath
    );
  }
});
```

## 移動コスト（SP）の扱い

### 物語に組み込まれたSP消費

```python
def calculate_narrative_sp_cost(
    action_type: str,
    distance_moved: float,
    difficulty: DangerLevel
) -> tuple[int, str]:
    """SP消費と、それを物語に組み込む説明文を生成"""
    
    base_costs = {
        "walk": 1,      # 通常移動
        "run": 2,       # 急いで移動
        "climb": 3,     # 登攀
        "swim": 4,      # 水泳
        "teleport": 5   # 転送
    }
    
    cost = base_costs.get(action_type, 1) * (1 + distance_moved)
    
    # SP消費の物語的説明
    descriptions = {
        "walk": "道のりは長く、少し疲れを感じる。",
        "run": "息を切らしながら走り抜けた。",
        "climb": "険しい道のりに、体力を大きく消耗した。",
        "swim": "冷たい水の中を進み、体力を奪われた。",
        "teleport": "転送の衝撃で、精神力を消耗した。"
    }
    
    return cost, descriptions.get(action_type, "")
```

## 行動選択肢の提示

### コンテキストに応じた選択肢

```python
async def generate_action_choices(
    current_location: Location,
    narrative_context: str,
    character_state: CharacterState
) -> List[ActionChoice]:
    """現在の物語と場所に基づいて行動選択肢を生成"""
    
    choices = []
    
    # 基本行動
    choices.append(ActionChoice("周囲を詳しく調べる", "investigate"))
    
    # 場所の特性に応じた選択肢
    if current_location.has_connections():
        # 接続を直接的に示さず、物語的な選択肢として提示
        for connection in current_location.connections:
            narrative_choice = await generate_narrative_choice(connection)
            choices.append(narrative_choice)
    
    # 文脈依存の選択肢
    if "扉" in narrative_context:
        choices.append(ActionChoice("扉を開ける", "open_door"))
    
    if "人影" in narrative_context:
        choices.append(ActionChoice("人影に近づく", "approach_figure"))
    
    return choices
```

## 実装例

### バックエンド: 物語生成エンドポイント

```python
@router.post("/{character_id}/action")
async def perform_action(
    character_id: str,
    action: ActionRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(deps.get_current_user)
) -> NarrativeResponse:
    """プレイヤーの行動を処理し、物語を生成"""
    
    character = await get_character(session, character_id, current_user.id)
    current_location = await get_location(session, character.location_id)
    
    # GM AIによる物語生成
    narrative_result = await gm_ai_service.process_action(
        character=character,
        action=action.text,
        location=current_location,
        game_context=await get_game_context(session, character)
    )
    
    # 場所が変わった場合の処理
    if narrative_result.location_changed:
        # SP消費
        character.current_sp -= narrative_result.sp_cost
        
        # 新しい場所への移動
        character.location_id = narrative_result.new_location_id
        
        # 移動履歴の記録
        await record_movement(
            session,
            character,
            current_location.id,
            narrative_result.new_location_id,
            narrative_result.movement_type
        )
        
        # 探索進捗の更新
        await update_exploration_progress(
            session,
            character,
            narrative_result.new_location_id
        )
    
    await session.commit()
    
    # WebSocketで更新を配信
    await broadcast_narrative_update(
        character_id,
        narrative_result
    )
    
    return narrative_result
```

### フロントエンド: 物語インターフェース

```typescript
const NarrativeInterface: React.FC = () => {
  const { characterId } = useCharacter();
  const { performAction } = useNarrativeActions();
  
  return (
    <div className="narrative-container">
      {/* 物語表示エリア */}
      <NarrativeDisplay />
      
      {/* 行動選択肢 */}
      <ActionChoices onSelect={performAction} />
      
      {/* ミニマップ（補助的な位置確認用） */}
      <MinimapOverlay 
        isInteractive={false}  // 直接操作は無効
        showCurrentLocation={true}
        animateTransitions={true}
      />
    </div>
  );
};
```

## テスト戦略

### 物語の一貫性テスト
- 場所遷移が物語と矛盾しないか
- SP消費が適切か
- 移動可能な接続のみを使用しているか

### ユーザー体験テスト
- 選択肢が文脈に適しているか
- 移動がスムーズに感じられるか
- 物語の没入感が維持されているか

## まとめ

この設計により、ゲスタロカは従来のゲーム的な移動システムではなく、物語体験を中心とした自然な場所の遷移を実現します。プレイヤーは「移動する」ことを意識せず、物語に没入しながら世界を探索できます。