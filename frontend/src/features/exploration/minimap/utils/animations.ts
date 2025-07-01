/**
 * ミニマップのアニメーション効果ユーティリティ
 */

import type { Point } from '../types'

export interface AnimationState {
  startTime: number
  duration: number
  from?: any
  to?: any
  easing?: EasingFunction
}

export type EasingFunction = (t: number) => number

/**
 * イージング関数
 */
export const easings = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeInElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3
    return t === 0
      ? 0
      : t === 1
      ? 1
      : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)
  },
  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3
    return t === 0
      ? 0
      : t === 1
      ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
  },
  easeOutBounce: (t: number) => {
    const n1 = 7.5625
    const d1 = 2.75
    if (t < 1 / d1) {
      return n1 * t * t
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375
    }
  },
}

/**
 * アニメーション管理クラス
 */
export class AnimationManager {
  private animations: Map<string, AnimationState> = new Map()

  /**
   * アニメーションを開始
   */
  start(
    id: string,
    duration: number,
    from?: any,
    to?: any,
    easing: EasingFunction = easings.easeOutCubic
  ): void {
    this.animations.set(id, {
      startTime: Date.now(),
      duration,
      from,
      to,
      easing,
    })
  }

  /**
   * アニメーションの進行度を取得
   */
  getProgress(id: string): number {
    const animation = this.animations.get(id)
    if (!animation) return 1

    const elapsed = Date.now() - animation.startTime
    const progress = Math.min(elapsed / animation.duration, 1)

    if (progress >= 1) {
      this.animations.delete(id)
      return 1
    }

    return animation.easing ? animation.easing(progress) : progress
  }

  /**
   * 補間された値を取得
   */
  getValue(id: string): any {
    const animation = this.animations.get(id)
    if (!animation || animation.from === undefined || animation.to === undefined) {
      return animation?.to
    }

    const progress = this.getProgress(id)
    
    // 数値の補間
    if (typeof animation.from === 'number' && typeof animation.to === 'number') {
      return animation.from + (animation.to - animation.from) * progress
    }

    // Point の補間
    if (animation.from.x !== undefined && animation.from.y !== undefined) {
      return {
        x: animation.from.x + (animation.to.x - animation.from.x) * progress,
        y: animation.from.y + (animation.to.y - animation.from.y) * progress,
      }
    }

    // 色の補間
    if (typeof animation.from === 'string' && typeof animation.to === 'string') {
      return this.interpolateColor(animation.from, animation.to, progress)
    }

    return animation.to
  }

  /**
   * アニメーション中かどうか
   */
  isAnimating(id: string): boolean {
    return this.animations.has(id)
  }

  /**
   * 全てのアニメーションをクリア
   */
  clear(): void {
    this.animations.clear()
  }

  /**
   * 色の補間
   */
  private interpolateColor(from: string, to: string, progress: number): string {
    const fromRgb = this.hexToRgb(from)
    const toRgb = this.hexToRgb(to)

    if (!fromRgb || !toRgb) return to

    const r = Math.round(fromRgb.r + (toRgb.r - fromRgb.r) * progress)
    const g = Math.round(fromRgb.g + (toRgb.g - fromRgb.g) * progress)
    const b = Math.round(fromRgb.b + (toRgb.b - fromRgb.b) * progress)

    return `rgb(${r}, ${g}, ${b})`
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null
  }
}

/**
 * 場所発見時のパルスアニメーション
 */
export function drawLocationDiscoveryPulse(
  ctx: CanvasRenderingContext2D,
  position: Point,
  progress: number,
  color: string = '#ffeb3b'
): void {
  const maxRadius = 50
  const opacity = 1 - progress

  ctx.save()
  ctx.globalAlpha = opacity * 0.5
  ctx.strokeStyle = color
  ctx.lineWidth = 3

  // 複数のリングでパルス効果
  for (let i = 0; i < 3; i++) {
    const ringProgress = Math.max(0, progress - i * 0.2)
    const ringRadius = maxRadius * ringProgress
    const ringOpacity = (1 - ringProgress) * opacity

    ctx.globalAlpha = ringOpacity * 0.3
    ctx.beginPath()
    ctx.arc(position.x, position.y, ringRadius, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * 接続線のパルスアニメーション
 */
export function drawConnectionPulse(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  progress: number,
  color: string = '#00bcd4'
): void {
  const dashOffset = progress * 20

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.setLineDash([10, 10])
  ctx.lineDashOffset = -dashOffset
  ctx.globalAlpha = 0.7

  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()

  // グロー効果
  ctx.shadowBlur = 10
  ctx.shadowColor = color
  ctx.globalAlpha = 0.3
  ctx.stroke()

  ctx.restore()
}

/**
 * ホバー効果のグロー
 */
export function drawHoverGlow(
  ctx: CanvasRenderingContext2D,
  position: Point,
  hoverRadius: number,
  intensity: number = 1,
  color: string = '#ffffff'
): void {
  ctx.save()

  // 外側のグロー
  const gradient = ctx.createRadialGradient(
    position.x,
    position.y,
    hoverRadius,
    position.x,
    position.y,
    hoverRadius * 2
  )
  gradient.addColorStop(0, `${color}66`)
  gradient.addColorStop(1, `${color}00`)

  ctx.fillStyle = gradient
  ctx.globalAlpha = intensity
  ctx.beginPath()
  ctx.arc(position.x, position.y, hoverRadius * 2, 0, Math.PI * 2)
  ctx.fill()

  // 内側の明るい部分
  ctx.shadowBlur = 20 * intensity
  ctx.shadowColor = color
  ctx.fillStyle = color
  ctx.globalAlpha = intensity * 0.3
  ctx.beginPath()
  ctx.arc(position.x, position.y, hoverRadius * 0.8, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

/**
 * 移動軌跡のアニメーション
 */
export function drawTrailAnimation(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  progress: number,
  color: string = '#00bcd4'
): void {
  if (points.length < 2) return

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2

  // 進行に応じて描画する部分を制限
  const totalLength = points.length - 1
  const drawLength = Math.floor(totalLength * progress)

  for (let i = 0; i < drawLength; i++) {
    const segmentProgress = i / totalLength
    const opacity = 1 - segmentProgress * 0.7 // 後ろに行くほど薄くなる

    ctx.globalAlpha = opacity
    ctx.beginPath()
    ctx.moveTo(points[i].x, points[i].y)
    ctx.lineTo(points[i + 1].x, points[i + 1].y)
    ctx.stroke()
  }

  // 最後の部分的なセグメント
  if (drawLength < totalLength) {
    const lastSegmentProgress = (totalLength * progress) - drawLength
    const from = points[drawLength]
    const to = points[drawLength + 1]
    const partial = {
      x: from.x + (to.x - from.x) * lastSegmentProgress,
      y: from.y + (to.y - from.y) * lastSegmentProgress,
    }

    ctx.globalAlpha = 1 - (drawLength / totalLength) * 0.7
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(partial.x, partial.y)
    ctx.stroke()

    // 先端のパーティクル
    drawParticle(ctx, partial, 5, color)
  }

  ctx.restore()
}

/**
 * パーティクル描画
 */
function drawParticle(
  ctx: CanvasRenderingContext2D,
  position: Point,
  size: number,
  color: string
): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowBlur = 10
  ctx.shadowColor = color
  ctx.beginPath()
  ctx.arc(position.x, position.y, size, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}