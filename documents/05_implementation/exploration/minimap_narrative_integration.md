# ミニマップと物語主導型移動システムの統合方針

## 現状分析

### 現在のミニマップ実装
現在のミニマップは**ゲーム的な直接操作**を前提とした設計：
- クリックで場所を選択
- 移動確認ダイアログ表示
- 「移動する」ボタンで実行
- SPコストを事前に表示

### 物語主導型システムとの不整合点

1. **直接的な移動操作**
   - 現状：プレイヤーが移動先を直接選択
   - 理想：物語の流れで自然に移動

2. **機械的な確認ダイアログ**
   - 現状：「○○へ移動しますか？」「必要SP: X」
   - 理想：物語に組み込まれた選択

3. **インタラクティブな操作**
   - 現状：クリック、ドラッグ、ズーム可能
   - 理想：閲覧専用の参照ツール

## 統合方針

### 段階的な移行アプローチ

#### Phase 1: 最小限の修正で物語主導を実現
既存のミニマップを活かしつつ、操作方法を調整：

```typescript
// Minimap.tsxの修正案
interface MinimapProps {
  // 新規追加
  interactionMode?: 'interactive' | 'view-only';
  onLocationInfo?: (location: MapLocation) => void;
}

// クリックイベントの変更
const handleLocationClick = (location: MapLocation) => {
  if (interactionMode === 'view-only') {
    // 情報表示のみ（移動はしない）
    onLocationInfo?.(location);
  } else {
    // 従来の移動処理（後方互換性）
    handleMoveToLocation(location);
  }
};
```

#### Phase 2: 物語インターフェースとの連携

```typescript
// 新しいコンポーネント構成
const ExplorationView: React.FC = () => {
  return (
    <div className="grid grid-cols-[1fr_300px]">
      {/* メイン：物語表示 */}
      <NarrativeDisplay />
      
      {/* サイド：ミニマップ（参照用） */}
      <Minimap 
        interactionMode="view-only"
        showCurrentLocation={true}
        animateTransitions={true}
      />
    </div>
  );
};
```

### 具体的な実装変更

#### 1. 移動確認ダイアログの廃止
```typescript
// 削除対象
- const [showMoveDialog, setShowMoveDialog] = useState(false);
- const [targetLocation, setTargetLocation] = useState<MapLocation | null>(null);

// 代わりに情報表示
+ const [selectedLocation, setSelectedLocation] = useState<MapLocation | null>(null);
```

#### 2. 右クリックメニューの変更
```typescript
const contextMenuItems = [
  {
    label: '詳細を見る',  // 「移動」から変更
    icon: Info,
    onClick: () => showLocationDetails(location)
  },
  {
    label: '中央に表示',
    icon: Target,
    onClick: () => centerOnLocation(location)
  }
];
```

#### 3. WebSocket統合による自動更新
```typescript
// useWebSocket.tsへの追加
useEffect(() => {
  socket.on('narrative:location_changed', (data) => {
    // 物語による移動時、ミニマップを自動更新
    queryClient.invalidateQueries(['character-location']);
    
    // スムーズな移動アニメーション
    animateLocationTransition(data.from, data.to);
  });
}, []);
```

### 物語による移動の可視化

#### 移動軌跡アニメーション
```typescript
const animateLocationTransition = (
  from: Coordinates,
  to: Coordinates,
  duration: number = 2000
) => {
  const pathAnimation = {
    start: from,
    end: to,
    progress: 0,
    trail: [] as Coordinates[]
  };
  
  // 移動の軌跡を描画
  const animate = () => {
    pathAnimation.progress += 0.02;
    if (pathAnimation.progress <= 1) {
      drawMovementPath(pathAnimation);
      requestAnimationFrame(animate);
    }
  };
  
  animate();
};
```

## 実装優先順位

### 即座に実装可能な変更

1. **インタラクションモードの追加**
   - プロパティで制御可能に
   - 既存機能との後方互換性維持

2. **クリック動作の変更**
   - 移動から情報表示へ
   - 物語選択肢への連携

3. **視覚的フィードバックの調整**
   - ホバー効果を情報的に
   - 選択状態を参照的に

### 段階的な拡張

1. **物語イベントとの連携**
   - WebSocketイベントの追加
   - 自動的な位置更新

2. **アニメーション強化**
   - 物語的な移動演出
   - 発見時の演出強化

3. **UI/UXの最適化**
   - サイドパネル配置
   - レスポンシブ対応

## 移行時の考慮事項

### 既存機能の保持
- 探索進捗の可視化（霧効果）
- 階層切り替え機能
- ズーム・パン機能（参照用）

### 新規追加機能
- 物語による自動移動
- 場所情報の詳細表示
- 移動履歴の可視化

### パフォーマンス最適化
- 不要なインタラクションの削除
- アニメーションの軽量化
- レンダリング最適化

## まとめ

現在のミニマップ実装は高品質で機能豊富ですが、直接的な移動操作を前提としています。物語主導型システムへの移行は、最小限の変更で実現可能です：

1. **インタラクションモードの追加**で操作を制限
2. **クリック動作を情報表示**に変更
3. **WebSocketで物語イベントと連携**

これにより、既存の資産を活かしながら、物語中心の体験を実現できます。