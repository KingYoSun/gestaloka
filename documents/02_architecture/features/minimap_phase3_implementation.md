# ミニマップPhase 3 実装詳細

## 概要

2025年7月1日に実装されたミニマップ機能のPhase 3では、視覚効果の大幅な強化を行いました。
これにより、より没入感のある探索体験と直感的な情報表示を実現しました。

## 実装された機能

### 1. 霧効果（Fog of War）の改善

#### FogOfWarRendererクラス
```typescript
class FogOfWarRenderer {
  private fogCanvas: HTMLCanvasElement
  private animationStartTime: Map<string, number>
  private previousProgress: Map<string, number>
  
  render(
    explorationProgress: ExplorationProgress[],
    locations: MapLocation[],
    viewport: Viewport,
    config: FogConfig,
    currentTime: number
  ): HTMLCanvasElement
}
```

**特徴:**
- 独立したCanvasでの霧描画（パフォーマンス最適化）
- 多層グラデーション（5層）による自然な霧の表現
- アニメーション対応（ease-out-cubic）
- 設定可能なプリセット

**プリセット:**
- `light`: 薄い霧（基本透明度50%）
- `standard`: 標準的な霧（基本透明度85%）
- `heavy`: 濃い霧（基本透明度95%）
- `mystical`: 神秘的な霧（基本透明度80%、ソフトエッジ）

### 2. アニメーションシステム

#### AnimationManagerクラス
汎用的なアニメーション管理システムを実装しました。

**実装されたアニメーション:**
1. **場所発見アニメーション**
   - 2秒間のパルス効果
   - 複数リングの拡散
   - 色は場所タイプに依存

2. **接続線パルス**
   - 現在地に接続された経路
   - ダッシュラインのアニメーション
   - グロー効果付き

3. **ホバーグロー**
   - 2層のグラデーション
   - インタラクティブな強度調整

4. **移動履歴トレイル**
   - 段階的なフェードアウト
   - パーティクル付き先端

**イージング関数:**
- linear、quadratic、cubic
- elastic、bounce
- カスタマイズ可能

### 3. アイコンシステム

#### LocationIconコンポーネント
場所タイプ別のSVGアイコンを提供します。

```typescript
<LocationIcon 
  type="city"      // 都市（ビル群）
  type="town"      // 町（家）
  type="dungeon"   // ダンジョン（盾）
  type="wild"      // 荒野（山）
  type="special"   // 特殊（星）
/>
```

#### IconRendererクラス
CanvasへのSVGアイコン描画を実現します。

**機能:**
- SVGからImageElementへの変換
- 効率的なキャッシュシステム
- ズームレベル対応（0.7以上で表示）
- フォールバック機能

### 4. リッチツールチップ

#### MinimapTooltipコンポーネント
詳細な場所情報を表示する高機能ツールチップです。

**表示情報:**
- 場所名とアイコン
- 危険度バッジ（色分け）
- 場所タイプ
- 探索進捗（プログレスバー付き）
- 接続数
- 最終訪問日時（相対表示）
- 座標（開発モードのみ）

**特徴:**
- アニメーション付き表示
- 自動位置調整
- レスポンシブデザイン

## 技術的な実装詳細

### Canvas描画の最適化

1. **レイヤー分離**
   - 背景（グリッド）
   - 接続線
   - 場所
   - 霧効果
   - オーバーレイ（現在地、エフェクト）

2. **描画順序**
   - グリッド → 接続線 → 場所 → 現在地 → 霧効果

3. **パフォーマンス考慮**
   - アイコンキャッシュ
   - 条件付き描画（ズームレベル）
   - requestAnimationFrameの活用

### 型定義の拡張

```typescript
// 新規追加
export type Point = Coordinates
export type LocationType = 'city' | 'town' | 'dungeon' | 'wild' | 'special'

// ID型の統一（number → string）
interface MapLocation {
  id: string  // 変更
  // ...
}
```

### アニメーションパイプライン

1. **初期化**: AnimationManagerインスタンス作成
2. **トリガー**: 特定イベント（発見、ホバー等）でstart()
3. **更新**: getProgress()で進行度取得
4. **描画**: 進行度に基づいてエフェクト描画
5. **完了**: 自動的にクリーンアップ

## 今後の改善点

### Phase 4での実装予定
1. **パフォーマンス最適化**
   - OffscreenCanvasの活用
   - 部分再描画の実装
   - WebGLレンダラーの検討

2. **モバイル対応**
   - タッチジェスチャー
   - レスポンシブレイアウト
   - パフォーマンス調整

3. **アクセシビリティ**
   - キーボードナビゲーション
   - スクリーンリーダー対応
   - 高コントラストモード

## まとめ

Phase 3の実装により、ミニマップは単なる地図表示から、豊かな視覚体験を提供する
インタラクティブな探索ツールへと進化しました。特に霧効果とアニメーションシステムの
実装により、ゲームの世界観をより深く表現できるようになりました。