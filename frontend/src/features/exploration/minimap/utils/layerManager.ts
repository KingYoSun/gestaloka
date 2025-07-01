/**
 * Canvas レイヤー管理ユーティリティ
 * 静的要素と動的要素を分離して効率的な描画を実現
 */

import type {
  MapLocation,
  MapConnection,
  Viewport,
  MinimapTheme,
  LayerData,
} from '../types'
import { CoordinateSystem } from './mapGeometry'

export interface CanvasLayers {
  static: OffscreenCanvas // 背景、グリッド、接続線
  locations: OffscreenCanvas // 場所アイコン（変更頻度低）
  dynamic: OffscreenCanvas // 現在地、アニメーション（変更頻度高）
  fog: OffscreenCanvas // 霧効果
}

export class LayerManager {
  private layers: CanvasLayers
  private dirtyFlags = {
    static: true,
    locations: true,
    dynamic: true,
    fog: true,
  }

  constructor(width: number, height: number) {
    this.layers = {
      static: new OffscreenCanvas(width, height),
      locations: new OffscreenCanvas(width, height),
      dynamic: new OffscreenCanvas(width, height),
      fog: new OffscreenCanvas(width, height),
    }
  }

  resize(width: number, height: number): void {
    Object.values(this.layers).forEach(canvas => {
      canvas.width = width
      canvas.height = height
    })
    this.markAllDirty()
  }

  markDirty(layer: keyof CanvasLayers): void {
    this.dirtyFlags[layer] = true
  }

  markAllDirty(): void {
    Object.keys(this.dirtyFlags).forEach(key => {
      this.dirtyFlags[key as keyof CanvasLayers] = true
    })
  }

  isDirty(layer: keyof CanvasLayers): boolean {
    return this.dirtyFlags[layer]
  }

  clearDirty(layer: keyof CanvasLayers): void {
    this.dirtyFlags[layer] = false
  }

  getContext(
    layer: keyof CanvasLayers
  ): OffscreenCanvasRenderingContext2D | null {
    return this.layers[layer].getContext('2d')
  }

  /**
   * 静的レイヤーを描画（グリッド、接続線）
   */
  renderStaticLayer(
    layerData: LayerData,
    viewport: Viewport,
    theme: MinimapTheme,
    showGrid: boolean
  ): void {
    const ctx = this.getContext('static')
    if (!ctx || !this.isDirty('static')) return

    // クリア
    ctx.clearRect(0, 0, this.layers.static.width, this.layers.static.height)

    // グリッド描画
    if (showGrid) {
      this.drawGrid(ctx, viewport, theme.grid)
    }

    // 接続線描画
    layerData.connections.forEach(connection => {
      this.drawConnection(ctx, connection, layerData.locations, viewport, theme)
    })

    this.clearDirty('static')
  }

  /**
   * 場所レイヤーを描画
   */
  renderLocationsLayer(
    locations: MapLocation[],
    viewport: Viewport,
    theme: MinimapTheme,
    showLabels: boolean,
    iconCache: Map<string, HTMLImageElement>
  ): void {
    const ctx = this.getContext('locations')
    if (!ctx || !this.isDirty('locations')) return

    // クリア
    ctx.clearRect(
      0,
      0,
      this.layers.locations.width,
      this.layers.locations.height
    )

    // 場所を描画
    locations.forEach(location => {
      const cachedIcon = iconCache.get(location.type)
      this.drawLocation(ctx, location, viewport, theme, showLabels, cachedIcon)
    })

    this.clearDirty('locations')
  }

  /**
   * 全レイヤーを合成
   */
  composite(targetCanvas: HTMLCanvasElement): void {
    const ctx = targetCanvas.getContext('2d')
    if (!ctx) return

    // 背景色
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)

    // レイヤーを順番に合成
    ctx.drawImage(this.layers.static, 0, 0)
    ctx.drawImage(this.layers.locations, 0, 0)
    ctx.drawImage(this.layers.dynamic, 0, 0)
    ctx.drawImage(this.layers.fog, 0, 0)
  }

  // 以下、描画メソッド（MinimapCanvasから移植）
  private drawGrid(
    ctx: OffscreenCanvasRenderingContext2D,
    viewport: Viewport,
    color: string
  ): void {
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.3

    const gridSize = 50
    const bounds = CoordinateSystem.getViewportBounds(viewport)

    // 垂直線
    for (
      let x = Math.floor(bounds.minX / gridSize) * gridSize;
      x <= bounds.maxX;
      x += gridSize
    ) {
      const screenX = CoordinateSystem.worldToScreen({ x, y: 0 }, viewport).x
      ctx.beginPath()
      ctx.moveTo(screenX, 0)
      ctx.lineTo(screenX, viewport.height)
      ctx.stroke()
    }

    // 水平線
    for (
      let y = Math.floor(bounds.minY / gridSize) * gridSize;
      y <= bounds.maxY;
      y += gridSize
    ) {
      const screenY = CoordinateSystem.worldToScreen({ x: 0, y }, viewport).y
      ctx.beginPath()
      ctx.moveTo(0, screenY)
      ctx.lineTo(viewport.width, screenY)
      ctx.stroke()
    }

    ctx.globalAlpha = 1
  }

  private drawConnection(
    ctx: OffscreenCanvasRenderingContext2D,
    connection: MapConnection,
    locations: MapLocation[],
    viewport: Viewport,
    theme: MinimapTheme
  ): void {
    const fromLocation = locations.find(
      loc => loc.id === connection.from_location_id
    )
    const toLocation = locations.find(
      loc => loc.id === connection.to_location_id
    )

    if (!fromLocation || !toLocation) return

    const from = CoordinateSystem.worldToScreen(
      fromLocation.coordinates,
      viewport
    )
    const to = CoordinateSystem.worldToScreen(toLocation.coordinates, viewport)

    const opacity = connection.is_discovered ? 1 : 0.3
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.strokeStyle = theme.connection[connection.path_type]
    ctx.lineWidth = connection.is_discovered ? 2 : 1

    if (connection.path_type === 'curved') {
      const controlPoint = {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2 - 30,
      }
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, to.x, to.y)
      ctx.stroke()
    } else if (connection.path_type === 'teleport') {
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
    }

    // 一方通行の矢印
    if (connection.is_one_way) {
      const angle = CoordinateSystem.angle(
        fromLocation.coordinates,
        toLocation.coordinates
      )
      const arrowSize = 10
      const midPoint = {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
      }

      ctx.save()
      ctx.translate(midPoint.x, midPoint.y)
      ctx.rotate(angle)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(-arrowSize, -arrowSize / 2)
      ctx.lineTo(-arrowSize, arrowSize / 2)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    ctx.restore()
  }

  private drawLocation(
    ctx: OffscreenCanvasRenderingContext2D,
    location: MapLocation,
    viewport: Viewport,
    theme: MinimapTheme,
    showLabel: boolean,
    cachedIcon?: HTMLImageElement
  ): void {
    const pos = CoordinateSystem.worldToScreen(location.coordinates, viewport)
    const baseRadius = 8 * viewport.zoom
    const radius = baseRadius

    // 危険度による外枠
    ctx.strokeStyle = theme.danger[location.danger_level]
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, radius + 3, 0, Math.PI * 2)
    ctx.stroke()

    // 背景円
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
    ctx.fill()

    // アイコンまたは色で塗りつぶし
    if (viewport.zoom > 0.7 && location.is_discovered && cachedIcon) {
      const iconSize = radius * 1.5
      ctx.drawImage(
        cachedIcon,
        pos.x - iconSize / 2,
        pos.y - iconSize / 2,
        iconSize,
        iconSize
      )
    } else {
      ctx.fillStyle = theme.location[location.type]
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, radius * 0.8, 0, Math.PI * 2)
      ctx.fill()
    }

    // 探索進捗リング
    if (
      location.exploration_percentage > 0 &&
      location.exploration_percentage < 100
    ) {
      ctx.save()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.arc(
        pos.x,
        pos.y,
        radius - 2,
        -Math.PI / 2,
        -Math.PI / 2 + (Math.PI * 2 * location.exploration_percentage) / 100
      )
      ctx.stroke()
      ctx.restore()
    }

    // ラベル表示
    if (showLabel && viewport.zoom > 0.5) {
      ctx.save()

      const textMetrics = ctx.measureText(location.name)
      const textWidth = textMetrics.width
      const textHeight = 12 * viewport.zoom
      const padding = 4 * viewport.zoom
      const labelY = pos.y + radius + 15 * viewport.zoom

      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
      ctx.fillRect(
        pos.x - textWidth / 2 - padding,
        labelY - textHeight / 2 - padding,
        textWidth + padding * 2,
        textHeight + padding * 2
      )

      ctx.fillStyle = '#ffffff'
      ctx.font = `${12 * viewport.zoom}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(location.name, pos.x, labelY)

      ctx.restore()
    }
  }
}
