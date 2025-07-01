/**
 * マップ座標計算ユーティリティ
 */

import type { Coordinates, Viewport } from '../types'

export class CoordinateSystem {
  /**
   * ワールド座標をスクリーン座標に変換
   */
  static worldToScreen(worldPos: Coordinates, viewport: Viewport): Coordinates {
    const x = (worldPos.x - viewport.x) * viewport.zoom + viewport.width / 2
    const y = (worldPos.y - viewport.y) * viewport.zoom + viewport.height / 2
    return { x, y }
  }

  /**
   * スクリーン座標をワールド座標に変換
   */
  static screenToWorld(
    screenPos: Coordinates,
    viewport: Viewport
  ): Coordinates {
    const x = (screenPos.x - viewport.width / 2) / viewport.zoom + viewport.x
    const y = (screenPos.y - viewport.height / 2) / viewport.zoom + viewport.y
    return { x, y }
  }

  /**
   * 2点間の距離を計算
   */
  static distance(a: Coordinates, b: Coordinates): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  /**
   * 2点間の角度を計算（ラジアン）
   */
  static angle(from: Coordinates, to: Coordinates): number {
    return Math.atan2(to.y - from.y, to.x - from.x)
  }

  /**
   * ビューポート内に点が含まれるかチェック
   */
  static isInViewport(point: Coordinates, viewport: Viewport): boolean {
    const screenPos = this.worldToScreen(point, viewport)
    return (
      screenPos.x >= 0 &&
      screenPos.x <= viewport.width &&
      screenPos.y >= 0 &&
      screenPos.y <= viewport.height
    )
  }

  /**
   * ビューポートの境界ボックスを取得（ワールド座標）
   */
  static getViewportBounds(viewport: Viewport) {
    const halfWidth = viewport.width / 2 / viewport.zoom
    const halfHeight = viewport.height / 2 / viewport.zoom

    return {
      minX: viewport.x - halfWidth,
      maxX: viewport.x + halfWidth,
      minY: viewport.y - halfHeight,
      maxY: viewport.y + halfHeight,
    }
  }

  /**
   * ズームレベルを制限
   */
  static clampZoom(zoom: number, min = 0.1, max = 5): number {
    return Math.max(min, Math.min(max, zoom))
  }

  /**
   * ビューポートを境界内に制限
   */
  static clampViewport(
    viewport: Viewport,
    worldBounds: { minX: number; maxX: number; minY: number; maxY: number }
  ): Viewport {
    const viewBounds = this.getViewportBounds(viewport)
    const viewWidth = viewBounds.maxX - viewBounds.minX
    const viewHeight = viewBounds.maxY - viewBounds.minY

    let x = viewport.x
    let y = viewport.y

    // ビューポートが世界の境界を超えないように制限
    if (viewWidth >= worldBounds.maxX - worldBounds.minX) {
      x = (worldBounds.minX + worldBounds.maxX) / 2
    } else {
      if (viewBounds.minX < worldBounds.minX) {
        x = worldBounds.minX + viewWidth / 2
      } else if (viewBounds.maxX > worldBounds.maxX) {
        x = worldBounds.maxX - viewWidth / 2
      }
    }

    if (viewHeight >= worldBounds.maxY - worldBounds.minY) {
      y = (worldBounds.minY + worldBounds.maxY) / 2
    } else {
      if (viewBounds.minY < worldBounds.minY) {
        y = worldBounds.minY + viewHeight / 2
      } else if (viewBounds.maxY > worldBounds.maxY) {
        y = worldBounds.maxY - viewHeight / 2
      }
    }

    return { ...viewport, x, y }
  }

  /**
   * グリッドにスナップ
   */
  static snapToGrid(coord: number, gridSize: number): number {
    return Math.round(coord / gridSize) * gridSize
  }
}
