# NPC遭遇UIシステム実装ガイド

**最終更新**: 2025-07-02

## 概要

NPC遭遇UIシステムは、プレイヤーが派遣ログNPCと遭遇した際の対話インターフェースを提供します。2025-07-02の実装により、複数NPC同時遭遇とアイテム交換機能が追加されました。

## コンポーネント構成

### 1. NPCEncounterManager（新規実装）

複数NPCとの同時遭遇を管理するメインコンポーネント。

```typescript
interface NPCEncounterManagerProps {
  encounters: NPCEncounterData[]
  onAction: (npcId: string, action: string) => void
  isLoading?: boolean
}
```

**機能**:
- 単一NPC時は既存のNPCEncounterDialogを使用
- 複数NPC時はタブ形式で切り替え表示
- 全NPCへの一括アクション（全員と話す、協力申し出、無視）
- 最大3体まで同時表示（バックエンド仕様に準拠）

### 2. NPCEncounterDialog（既存）

単一NPCとの遭遇ダイアログ。

**主な機能**:
- NPCプロフィール表示（名前、称号、タイプ、性格特性）
- 動的な選択肢生成
- 汚染度・永続性レベルの視覚的表示
- デフォルトアクション（話す、観察、立ち去る）

### 3. ItemExchangeDialog（新規実装）

NPCとのアイテム交換インターフェース。

```typescript
interface ItemExchangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  npc: NPCProfile
  playerItems: Item[]
  npcItems: Item[]
  onExchange: (offeredItems: string[], requestedItems: string[]) => Promise<void>
}
```

**機能**:
- 左右分割レイアウト（プレイヤー/NPCアイテム）
- チェックボックスによる複数選択
- レアリティ別の色分け表示
- 価値バランス自動計算（20%差まで許容）
- 交換プレビュー機能

## WebSocket統合

### useWebSocket.tsの更新

```typescript
// 単一遭遇から配列管理へ変更
const [currentNPCEncounters, setCurrentNPCEncounters] = 
  useState<NPCEncounterData[]>([])

// 複数NPC遭遇の処理
const handleNPCEncounter = (data: NPCEncounterData | NPCEncounterData[]) => {
  const encounters = Array.isArray(data) ? data : [data]
  setCurrentNPCEncounters(encounters)
  // 通知処理...
}
```

### イベントフロー

1. **遭遇発生**
   - サーバー: `game:npc_encounter`イベント送信
   - クライアント: 遭遇データを配列で管理
   - UI: NPCEncounterManagerが表示

2. **アクション実行**
   - ユーザー: 選択肢をクリック
   - クライアント: `sendNPCAction(npcId, action)`
   - サーバー: アクション処理と結果返送

3. **遭遇終了**
   - サーバー: 終了判定（立ち去る等）
   - クライアント: 該当NPCを配列から削除
   - UI: 残りNPCがなければダイアログ非表示

## NPCタイプと表示

### タイプ別バッジ色

```typescript
const getTypeColor = (type: string) => {
  switch (type) {
    case 'LOG_NPC': return 'bg-blue-500'        // 派遣ログ
    case 'PERMANENT_NPC': return 'bg-purple-500' // 永続NPC
    case 'TEMPORARY_NPC': return 'bg-gray-500'   // 一時NPC
    default: return 'bg-gray-400'
  }
}
```

### 遭遇タイプ

- `friendly`: 友好的（デフォルトバッジ）
- `hostile`: 敵対的（destructiveバッジ）
- `mysterious`: 神秘的（secondaryバッジ）
- その他（outlineバッジ）

## 実装の技術的詳細

### 状態管理

```typescript
// NPCEncounterManager内部
const [activeNpcId, setActiveNpcId] = useState<string | null>(null)
const [isVisible, setIsVisible] = useState(false)

// 遭遇データ変更時の処理
useEffect(() => {
  if (encounters.length > 0) {
    setIsVisible(true)
    // アクティブNPCの自動設定
    if (!activeNpcId || !encounters.find(e => e.npc.npc_id === activeNpcId)) {
      setActiveNpcId(encounters[0].npc.npc_id)
    }
  } else {
    setIsVisible(false)
    setActiveNpcId(null)
  }
}, [encounters, activeNpcId])
```

### アニメーション

- ダイアログ表示: `animate-in slide-in-from-bottom-5 duration-300`
- タブ切り替え: Radix UIのTabsコンポーネントによる滑らかな遷移

### レスポンシブデザイン

- 単一NPC: 幅384px（w-96）
- 複数NPC: 幅480px（w-[480px]）
- 最大高さ制限とスクロール対応

## ベストプラクティス

### 1. パフォーマンス

- 選択肢リストは`ScrollArea`でレンダリング最適化
- 不要な再レンダリング防止のための`useCallback`使用
- WebSocketイベントのクリーンアップ処理

### 2. UX設計

- 遭遇時の視覚的フィードバック（トースト通知）
- ローディング状態の明示
- 難易度・レアリティの色分け表示

### 3. アクセシビリティ

- キーボードナビゲーション対応
- ARIAラベルの適切な設定
- フォーカス管理

## 今後の拡張候補

1. **ドラッグ&ドロップ**
   - アイテム交換UIの直感的操作
   - react-beautiful-dndの統合

2. **音声・効果音**
   - 遭遇時の効果音
   - NPCタイプ別の音声

3. **アニメーション強化**
   - NPCの登場演出
   - アイテム交換のトランジション

4. **AI対話強化**
   - 自然言語での対話オプション
   - 感情分析による選択肢生成

## トラブルシューティング

### 複数NPCが表示されない

1. WebSocketイベントが配列形式で送信されているか確認
2. `currentNPCEncounters`が配列として管理されているか確認
3. NPCEncounterManagerが正しくインポートされているか確認

### アイテム交換が機能しない

1. アイテムデータの型定義確認
2. 価値計算ロジックの確認
3. APIエンドポイントの実装確認

### パフォーマンス問題

1. 選択肢が多い場合は仮想スクロールを検討
2. 不要なレンダリングをReact DevToolsで確認
3. WebSocketイベントの頻度を確認