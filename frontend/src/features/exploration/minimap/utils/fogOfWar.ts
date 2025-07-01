/**
 * 霧効果（Fog of War）のレンダリングユーティリティ
 */

import type { ExplorationProgress, MapLocation, Viewport } from '../types'
import { CoordinateSystem } from './mapGeometry'

export interface FogConfig {
  baseOpacity: number // 基本の霧の濃度 (0-1)
  revealRadius: number // 探索により霧が晴れる基本半径
  edgeSoftness: number // エッジのソフトさ (0-1)
  animationDuration: number // アニメーション時間（ミリ秒）
}

export const defaultFogConfig: FogConfig = {
  baseOpacity: 0.85,
  revealRadius: 100,
  edgeSoftness: 0.5,
  animationDuration: 1500,
}

export class FogOfWarRenderer {
  private fogCanvas: HTMLCanvasElement
  private fogCtx: CanvasRenderingContext2D
  private animationStartTime: Map<string, number> = new Map()
  private previousProgress: Map<string, number> = new Map()

  constructor(width: number, height: number) {
    this.fogCanvas = document.createElement('canvas')
    this.fogCanvas.width = width
    this.fogCanvas.height = height
    const ctx = this.fogCanvas.getContext('2d')
    if (!ctx) throw new Error('Failed to create fog canvas context')
    this.fogCtx = ctx
  }

  resize(width: number, height: number): void {
    this.fogCanvas.width = width
    this.fogCanvas.height = height
  }

  /**
   * 霧効果をレンダリング
   */
  render(
    explorationProgress: ExplorationProgress[],
    locations: MapLocation[],
    viewport: Viewport,
    config: FogConfig = defaultFogConfig,
    currentTime: number = Date.now()
  ): HTMLCanvasElement {
    const { width, height } = this.fogCanvas

    // 霧で塗りつぶし
    this.fogCtx.fillStyle = `rgba(0, 0, 0, ${config.baseOpacity})`
    this.fogCtx.fillRect(0, 0, width, height)

    // 各探索済みエリアの霧を晴らす
    explorationProgress.forEach((progress) => {
      const location = locations.find((loc) => loc.id === progress.location_id)
      if (!location) return

      // アニメーション進行度を計算
      const animationProgress = this.calculateAnimationProgress(
        progress.location_id,
        progress.exploration_percentage,
        currentTime,
        config.animationDuration
      )

      this.revealArea(
        location,
        progress.exploration_percentage,
        animationProgress,
        viewport,
        config
      )
    })

    return this.fogCanvas
  }

  /**
   * 特定エリアの霧を晴らす
   */
  private revealArea(
    location: MapLocation,
    explorationPercentage: number,
    animationProgress: number,
    viewport: Viewport,
    config: FogConfig
  ): void {
    const screenPos = CoordinateSystem.worldToScreen(
      location.coordinates,
      viewport
    )

    // 探索度とアニメーションに基づく実効半径
    const baseRadius = config.revealRadius * viewport.zoom
    const maxRadius = baseRadius * (explorationPercentage / 100)
    const currentRadius = maxRadius * animationProgress

    // 多層グラデーションで自然な霧の晴れ方を表現
    const layers = [
      { radius: currentRadius * 1.2, opacity: 0.1 },
      { radius: currentRadius * 1.0, opacity: 0.3 },
      { radius: currentRadius * 0.8, opacity: 0.5 },
      { radius: currentRadius * 0.6, opacity: 0.7 },
      { radius: currentRadius * 0.4, opacity: 0.9 },
    ]

    this.fogCtx.globalCompositeOperation = 'destination-out'

    layers.forEach((layer) => {
      const gradient = this.fogCtx.createRadialGradient(
        screenPos.x,
        screenPos.y,
        0,
        screenPos.x,
        screenPos.y,
        layer.radius
      )

      // 中心は完全に透明
      gradient.addColorStop(0, `rgba(0, 0, 0, 1)`)
      
      // エッジのソフトさを調整
      const edgeStart = 1 - config.edgeSoftness * 0.5
      gradient.addColorStop(edgeStart, `rgba(0, 0, 0, ${1 - layer.opacity})`)
      gradient.addColorStop(1, `rgba(0, 0, 0, 0)`)

      this.fogCtx.fillStyle = gradient
      this.fogCtx.beginPath()
      this.fogCtx.arc(screenPos.x, screenPos.y, layer.radius, 0, Math.PI * 2)
      this.fogCtx.fill()
    })

    this.fogCtx.globalCompositeOperation = 'source-over'
  }

  /**
   * アニメーション進行度を計算
   */
  private calculateAnimationProgress(
    locationId: string,
    currentPercentage: number,
    currentTime: number,
    duration: number
  ): number {
    const previousPercentage = this.previousProgress.get(locationId) || 0

    // 探索度が増加した場合、アニメーションを開始
    if (currentPercentage > previousPercentage) {
      this.animationStartTime.set(locationId, currentTime)
      this.previousProgress.set(locationId, currentPercentage)
    }

    const startTime = this.animationStartTime.get(locationId)
    if (!startTime) {
      // アニメーションが開始されていない場合は完了状態
      return 1
    }

    const elapsed = currentTime - startTime
    const progress = Math.min(elapsed / duration, 1)

    // イージング関数（ease-out-cubic）
    return 1 - Math.pow(1 - progress, 3)
  }

  /**
   * 霧のテクスチャ効果を追加（オプション）
   */
  applyNoiseTexture(opacity: number = 0.1): void {
    const { width, height } = this.fogCanvas
    const imageData = this.fogCtx.getImageData(0, 0, width, height)
    const data = imageData.data

    // シンプルなノイズテクスチャを追加
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * opacity * 255
      data[i] += noise // R
      data[i + 1] += noise // G
      data[i + 2] += noise // B
      // Alpha channel is not modified
    }

    this.fogCtx.putImageData(imageData, 0, 0)
  }
}

/**
 * 霧効果のプリセット設定
 */
export const fogPresets = {
  light: {
    baseOpacity: 0.5,
    revealRadius: 120,
    edgeSoftness: 0.7,
    animationDuration: 1000,
  },
  standard: defaultFogConfig,
  heavy: {
    baseOpacity: 0.95,
    revealRadius: 80,
    edgeSoftness: 0.3,
    animationDuration: 2000,
  },
  mystical: {
    baseOpacity: 0.8,
    revealRadius: 100,
    edgeSoftness: 0.9,
    animationDuration: 2500,
  },
} as const