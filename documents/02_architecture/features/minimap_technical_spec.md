# ミニマップ機能 技術仕様書

## API仕様

### 1. マップデータ取得エンドポイント

#### `GET /api/v1/exploration/{character_id}/map-data`

**レスポンス:**
```typescript
interface MapDataResponse {
  layers: LayerData[];
  characterTrail: LocationHistory[];
  currentLocation: {
    id: string;
    layer: number;
    coordinates: { x: number; y: number };
  };
}

interface LayerData {
  layer: number;
  name: string;
  locations: MapLocation[];
  connections: MapConnection[];
  explorationProgress: ExplorationProgress[];
}

interface MapLocation {
  id: string;
  name: string;
  coordinates: { x: number; y: number };
  type: LocationType;
  dangerLevel: number;
  isDiscovered: boolean;
  explorationPercentage: number;
  lastVisited?: string;
}

interface MapConnection {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  pathType: 'direct' | 'curved' | 'teleport' | 'stairs' | 'elevator';
  isOneWay: boolean;
  isDiscovered: boolean;
  spCost: number;
}

interface ExplorationProgress {
  locationId: string;
  percentage: number;
  fogRevealedAt?: string;
  fullyExploredAt?: string;
}

interface LocationHistory {
  locationId: string;
  timestamp: string;
  layer: number;
  coordinates: { x: number; y: number };
}
```

### 2. 探索進捗更新エンドポイント

#### `POST /api/v1/exploration/{character_id}/update-progress`

**リクエスト:**
```typescript
interface UpdateProgressRequest {
  locationId: string;
  explorationPercentage: number;
  areasExplored: string[];
}
```

## データベーススキーマ

### 新規テーブル

```sql
-- キャラクターの探索進捗
CREATE TABLE character_exploration_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    exploration_percentage INTEGER NOT NULL DEFAULT 0 CHECK (exploration_percentage >= 0 AND exploration_percentage <= 100),
    fog_revealed_at TIMESTAMP WITH TIME ZONE,
    fully_explored_at TIMESTAMP WITH TIME ZONE,
    areas_explored TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(character_id, location_id)
);

-- インデックス
CREATE INDEX idx_exploration_progress_character ON character_exploration_progress(character_id);
CREATE INDEX idx_exploration_progress_location ON character_exploration_progress(location_id);
```

### 既存テーブルの拡張

```sql
-- location_connectionsテーブルに視覚情報を追加
ALTER TABLE location_connections 
ADD COLUMN path_type VARCHAR(50) DEFAULT 'direct' CHECK (path_type IN ('direct', 'curved', 'teleport', 'stairs', 'elevator'));

ALTER TABLE location_connections
ADD COLUMN path_metadata JSONB DEFAULT '{}';
-- path_metadata例: {"curvePoints": [[x1,y1], [x2,y2]], "animationType": "pulse"}
```

## フロントエンド実装詳細

### Canvas描画アーキテクチャ

```typescript
// 多層Canvas構造
interface CanvasLayers {
  background: HTMLCanvasElement;  // 静的な背景（グリッド、地形）
  locations: HTMLCanvasElement;   // 場所アイコン
  connections: HTMLCanvasElement; // 接続線
  fog: HTMLCanvasElement;        // 霧効果
  overlay: HTMLCanvasElement;    // プレイヤー位置、エフェクト
}

// 描画最適化のためのバッファリング
class MinimapRenderer {
  private layers: CanvasLayers;
  private offscreenCanvas: OffscreenCanvas;
  private dirtyRegions: Set<DirtyRegion>;
  
  // 差分描画
  renderDirtyRegions(): void {
    for (const region of this.dirtyRegions) {
      this.renderRegion(region);
    }
    this.dirtyRegions.clear();
  }
}
```

### 座標変換システム

```typescript
class CoordinateSystem {
  // ワールド座標 → スクリーン座標
  worldToScreen(worldPos: Point, viewport: Viewport): Point {
    const x = (worldPos.x - viewport.x) * viewport.zoom + viewport.width / 2;
    const y = (worldPos.y - viewport.y) * viewport.zoom + viewport.height / 2;
    return { x, y };
  }
  
  // スクリーン座標 → ワールド座標
  screenToWorld(screenPos: Point, viewport: Viewport): Point {
    const x = (screenPos.x - viewport.width / 2) / viewport.zoom + viewport.x;
    const y = (screenPos.y - viewport.height / 2) / viewport.zoom + viewport.y;
    return { x, y };
  }
}
```

### 霧効果実装

```typescript
class FogOfWarRenderer {
  private fogTexture: ImageData;
  
  generateFogTexture(width: number, height: number, exploredAreas: ExploredArea[]): ImageData {
    const imageData = new ImageData(width, height);
    const data = imageData.data;
    
    // 基本的な霧（黒）で初期化
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;     // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      data[i + 3] = 200; // A (透明度)
    }
    
    // 探索済みエリアを明るくする
    for (const area of exploredAreas) {
      this.revealArea(data, width, area);
    }
    
    // ガウシアンブラーでエッジをソフトに
    this.applyGaussianBlur(data, width, height);
    
    return imageData;
  }
  
  private revealArea(data: Uint8ClampedArray, width: number, area: ExploredArea): void {
    const radius = area.explorationPercentage * 50; // 探索度に応じた半径
    
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        const distance = Math.sqrt(x * x + y * y);
        if (distance <= radius) {
          const px = Math.floor(area.center.x + x);
          const py = Math.floor(area.center.y + y);
          const index = (py * width + px) * 4;
          
          // 距離に応じて透明度を調整
          const opacity = Math.max(0, 200 - (200 * (1 - distance / radius)));
          data[index + 3] = Math.min(data[index + 3], opacity);
        }
      }
    }
  }
}
```

### パフォーマンスモニタリング

```typescript
class PerformanceMonitor {
  private frameTimings: number[] = [];
  private readonly maxSamples = 60;
  
  measureFrame(callback: () => void): void {
    const start = performance.now();
    callback();
    const end = performance.now();
    
    this.frameTimings.push(end - start);
    if (this.frameTimings.length > this.maxSamples) {
      this.frameTimings.shift();
    }
  }
  
  getMetrics(): PerformanceMetrics {
    const avg = this.frameTimings.reduce((a, b) => a + b, 0) / this.frameTimings.length;
    const fps = 1000 / avg;
    
    return {
      averageFrameTime: avg,
      fps: fps,
      droppedFrames: this.frameTimings.filter(t => t > 16.67).length
    };
  }
}
```

## 状態管理

### Zustandストア定義

```typescript
interface MinimapStore {
  // 状態
  mapData: MapDataResponse | null;
  viewport: Viewport;
  selectedLocation: string | null;
  isExpanded: boolean;
  
  // ビューポート操作
  setViewport: (viewport: Partial<Viewport>) => void;
  centerOnLocation: (locationId: string) => void;
  
  // データ操作
  updateMapData: (data: MapDataResponse) => void;
  updateExplorationProgress: (locationId: string, progress: number) => void;
  
  // UI状態
  toggleExpanded: () => void;
  selectLocation: (locationId: string | null) => void;
}

const useMinimapStore = create<MinimapStore>((set, get) => ({
  mapData: null,
  viewport: { x: 0, y: 0, zoom: 1, width: 200, height: 200 },
  selectedLocation: null,
  isExpanded: false,
  
  setViewport: (viewport) => set((state) => ({
    viewport: { ...state.viewport, ...viewport }
  })),
  
  centerOnLocation: (locationId) => {
    const { mapData } = get();
    if (!mapData) return;
    
    const location = mapData.layers
      .flatMap(l => l.locations)
      .find(loc => loc.id === locationId);
      
    if (location) {
      set({
        viewport: {
          ...get().viewport,
          x: location.coordinates.x,
          y: location.coordinates.y
        }
      });
    }
  },
  
  // ... 他のメソッド
}));
```

## エラーハンドリング

### バックエンドエラー

```python
class MapDataNotFoundError(Exception):
    """マップデータが見つからない場合"""
    pass

class InvalidExplorationProgressError(Exception):
    """無効な探索進捗データ"""
    pass

# エラーレスポンス
{
  "error": "MAP_DATA_NOT_FOUND",
  "message": "Character has not explored any locations yet",
  "details": {
    "character_id": "...",
    "suggestion": "Start exploring to reveal the map"
  }
}
```

### フロントエンドエラー

```typescript
// Canvas描画エラーのフォールバック
class CanvasErrorBoundary extends React.Component {
  componentDidCatch(error: Error) {
    // WebGLコンテキストロスト等のエラー処理
    console.error('Minimap rendering error:', error);
    
    // フォールバックUIを表示
    this.setState({ hasError: true });
  }
  
  render() {
    if (this.state.hasError) {
      return <MinimapFallback />;
    }
    return this.props.children;
  }
}
```

## テスト仕様

### バックエンドテスト

```python
# tests/test_minimap_api.py
async def test_get_map_data_with_exploration_progress():
    """探索進捗を含むマップデータ取得のテスト"""
    # キャラクターと探索データのセットアップ
    character = await create_test_character()
    await explore_locations(character.id, ["location1", "location2"])
    
    # APIコール
    response = await client.get(f"/api/v1/exploration/{character.id}/map-data")
    
    # アサーション
    assert response.status_code == 200
    data = response.json()
    assert len(data["layers"]) > 0
    assert data["layers"][0]["explorationProgress"][0]["percentage"] > 0
```

### フロントエンドテスト

```typescript
// Minimap.test.tsx
describe('Minimap Component', () => {
  it('renders fog of war correctly', async () => {
    const mockMapData = createMockMapData();
    render(<Minimap characterId="test-id" />);
    
    // Canvas要素の取得
    const canvas = screen.getByTestId('minimap-fog-layer');
    const ctx = canvas.getContext('2d');
    
    // 霧効果が適用されているか確認
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    expect(imageData.data.some(pixel => pixel > 0)).toBe(true);
  });
  
  it('handles zoom and pan interactions', async () => {
    const { container } = render(<Minimap characterId="test-id" />);
    
    // ズーム操作
    fireEvent.wheel(container, { deltaY: -100 });
    expect(useMinimapStore.getState().viewport.zoom).toBeGreaterThan(1);
    
    // パン操作
    fireEvent.mouseDown(container, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(container, { clientX: 150, clientY: 150 });
    fireEvent.mouseUp(container);
    
    const viewport = useMinimapStore.getState().viewport;
    expect(viewport.x).not.toBe(0);
    expect(viewport.y).not.toBe(0);
  });
});
```

## 移行計画

### データベースマイグレーション

```bash
# 1. 新しいテーブルの作成
alembic revision --autogenerate -m "Add minimap exploration progress tables"

# 2. 既存データの移行（必要に応じて）
# character_location_historyから初期探索データを生成

# 3. マイグレーション実行
alembic upgrade head
```

### 段階的ロールアウト

1. **Feature Flag導入**
```typescript
const FEATURES = {
  MINIMAP_ENABLED: process.env.REACT_APP_MINIMAP_ENABLED === 'true'
};

// 条件付きレンダリング
{FEATURES.MINIMAP_ENABLED && <Minimap />}
```

2. **A/Bテスト**
- 10%のユーザーに先行公開
- パフォーマンスメトリクスの収集
- フィードバックの収集

3. **全体公開**
- 問題がなければ100%展開