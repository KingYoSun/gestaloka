# ミニマップ機能設計書

## 概要

探索システムに「ミニマップ」機能を追加し、プレイヤーが探索済みエリアを俯瞰的に把握できるようにする。これにより、ゲーム世界の空間的理解を深め、戦略的な移動計画を立てやすくする。

## 設計方針

### 基本コンセプト
- **段階的開示**: 未探索エリアは「霧」で覆われ、探索により徐々に明らかになる
- **階層別表示**: ゲスタロカの階層構造を反映した複数レイヤーのマップ
- **インタラクティブ性**: クリックによる場所の詳細表示と直接移動
- **パフォーマンス重視**: Canvas APIを使用した軽量な描画

### 視覚デザイン原則
- **ミニマル**: 必要最小限の情報表示
- **直感的**: アイコンと色による情報の即時理解
- **没入感**: ゲーム世界観を損なわないビジュアル

## 技術アーキテクチャ

### バックエンド拡張

#### 1. 新規APIエンドポイント

```python
# GET /api/v1/exploration/{character_id}/map-data
# レスポンス: 階層別のマップデータ
{
  "layers": [
    {
      "layer": 7,  # 天層
      "locations": [...],
      "connections": [...],
      "discovered_areas": [...]
    },
    # ... 他の階層
  ],
  "character_trail": [  # 最近の移動履歴
    {"location_id": "uuid", "timestamp": "...", "layer": 7}
  ]
}
```

#### 2. データベース拡張

```sql
-- 探索済みエリアの詳細記録
CREATE TABLE character_exploration_progress (
    id UUID PRIMARY KEY,
    character_id UUID REFERENCES characters(id),
    location_id UUID REFERENCES locations(id),
    exploration_percentage INTEGER DEFAULT 0,  -- 0-100
    fog_revealed_at TIMESTAMP,
    fully_explored_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 場所間の視覚的接続情報
ALTER TABLE location_connections ADD COLUMN path_type VARCHAR(50) DEFAULT 'direct';
-- path_type: 'direct', 'curved', 'teleport', 'stairs', 'elevator'
```

#### 3. サービス層の拡張

```python
class EnhancedExplorationService:
    async def get_map_data(self, character_id: UUID) -> MapData:
        """キャラクターの探索進捗を含むマップデータを取得"""
        
    async def calculate_fog_of_war(self, character_id: UUID, layer: int) -> FogData:
        """未探索エリアの霧データを計算"""
        
    async def get_character_trail(self, character_id: UUID, limit: int = 10) -> List[LocationHistory]:
        """キャラクターの移動履歴を取得"""
```

### フロントエンド実装

#### 1. コンポーネント構造

```
features/exploration/minimap/
├── Minimap.tsx              # メインコンポーネント
├── MinimapCanvas.tsx        # Canvas描画ロジック
├── MinimapControls.tsx      # ズーム・パン・レイヤー切替
├── MinimapLegend.tsx        # 凡例
├── MinimapOverlay.tsx       # ツールチップ・情報表示
├── hooks/
│   ├── useMinimapData.ts    # データ取得
│   ├── useMinimapRenderer.ts # 描画ロジック
│   └── useMinimapInteraction.ts # インタラクション
└── utils/
    ├── mapGeometry.ts       # 座標計算
    ├── fogOfWar.ts          # 霧効果
    └── pathfinding.ts       # 経路描画
```

#### 2. Canvas描画システム

```typescript
interface MinimapRenderer {
  // レイヤー描画
  drawLayer(ctx: CanvasRenderingContext2D, layer: LayerData): void;
  
  // 場所描画（アイコン・名前）
  drawLocation(ctx: CanvasRenderingContext2D, location: Location): void;
  
  // 接続描画（道・階段・ポータル）
  drawConnection(ctx: CanvasRenderingContext2D, connection: Connection): void;
  
  // 霧効果
  applyFogOfWar(ctx: CanvasRenderingContext2D, fogData: FogData): void;
  
  // プレイヤー位置
  drawPlayerMarker(ctx: CanvasRenderingContext2D, position: Position): void;
  
  // 移動履歴
  drawTrail(ctx: CanvasRenderingContext2D, trail: LocationHistory[]): void;
}
```

#### 3. インタラクション機能

```typescript
interface MinimapInteraction {
  // ズーム（マウスホイール・ピンチ）
  zoom: (delta: number, center: Point) => void;
  
  // パン（ドラッグ）
  pan: (dx: number, dy: number) => void;
  
  // クリック
  onClick: (point: Point) => {
    location?: Location;
    action?: 'showDetails' | 'moveToLocation';
  };
  
  // ホバー
  onHover: (point: Point) => {
    tooltip?: string;
    highlight?: boolean;
  };
}
```

## UI/UXデザイン

### 表示モード

1. **ミニマップモード（デフォルト）**
   - 画面右下に固定表示（200x200px）
   - 半透明背景
   - 現在地を中心に自動フォーカス

2. **拡張マップモード**
   - Mキーまたはボタンクリックで展開
   - 画面中央に大きく表示（600x600px）
   - 詳細情報表示

### 視覚要素

#### 場所アイコン
- 🏛️ 都市・集落
- ⛰️ 自然地形
- 🏚️ ダンジョン・遺跡
- 🌀 ポータル・転移点
- ⚔️ 戦闘発生地点
- 💎 重要アイテム発見地点

#### 接続タイプ
- 実線: 通常の道
- 点線: 隠し通路
- 波線: 不安定な接続
- 矢印: 一方通行
- 階段アイコン: 階層間移動

#### 色彩設計
- **探索済み**: 明るい色調
- **部分探索**: 中間色
- **未探索**: 暗い色調・霧効果
- **現在地**: パルスアニメーション
- **危険度**: 赤系グラデーション

### アニメーション

1. **霧の晴れ**: 新エリア発見時のフェードイン（1.5秒）
2. **移動軌跡**: 点線のフェードアウト（3秒）
3. **現在地パルス**: 0.5秒周期の拡大縮小
4. **ズーム遷移**: イージング付きスムーズズーム

## パフォーマンス最適化

### レンダリング最適化
1. **レイヤーキャッシング**: 各階層を別Canvasに描画しキャッシュ
2. **視錐台カリング**: 表示範囲外の要素を描画スキップ
3. **LOD（Level of Detail）**: ズームレベルに応じた詳細度調整
4. **ダーティーフラグ**: 変更があった部分のみ再描画

### データ最適化
1. **差分更新**: 新規探索エリアのみ送信
2. **圧縮**: マップデータのgzip圧縮
3. **キャッシュ**: IndexedDBによるローカルキャッシュ

## セキュリティ考慮事項

1. **情報制限**: 他プレイヤーの位置情報は表示しない
2. **探索済み検証**: サーバー側で探索状態を厳密に管理
3. **アンチチート**: クライアント側の座標改ざんを防ぐ

## 実装フェーズ

### Phase 1: 基礎実装（完了）
- [x] バックエンドAPI実装
- [x] 基本的なCanvas描画
- [x] 現在地表示とズーム機能

### Phase 2: インタラクション（完了）
- [x] クリックによる詳細表示
- [x] ドラッグによるパン機能
- [x] キーボードショートカット
- [x] 右クリックコンテキストメニュー
- [x] 移動確認ダイアログ

### Phase 3: 視覚効果（完了 - 2025/07/01）
- [x] 霧効果の実装（多層グラデーション、アニメーション対応）
- [x] アニメーション追加（発見、パルス、グロー、トレイル）
- [x] アイコンとツールチップ（SVGアイコン、リッチツールチップ）

### Phase 4: 最適化
- [x] パフォーマンスチューニング（完了 - 2025/07/01）
  - 非同期描画の同期化
  - アニメーションループの統合
  - メモリ最適化（LRUキャッシュ）
  - パフォーマンスモニタリング
  - Canvasレイヤー分離の準備
- [ ] モバイル対応（未実装）
- [ ] アクセシビリティ改善（未実装）

## テスト計画

### ユニットテスト
- 座標計算ロジック
- 霧効果アルゴリズム
- 経路描画関数

### 統合テスト
- API通信とデータ同期
- Canvas描画の正確性
- インタラクション応答

### E2Eテスト
- 探索→マップ更新フロー
- ズーム・パン操作
- マップからの移動実行

## 今後の拡張可能性

1. **マップマーキング**: プレイヤーによるメモ機能
2. **経路探索**: 最短経路の自動計算と表示
3. **共有マップ**: パーティーメンバー間での情報共有
4. **天候効果**: 霧・雨などの環境要因の可視化
5. **時間軸スライダー**: 過去の探索履歴の再生