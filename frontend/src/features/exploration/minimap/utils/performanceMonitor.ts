/**
 * パフォーマンスモニタリングユーティリティ
 */

interface PerformanceMetrics {
  averageFrameTime: number
  fps: number
  droppedFrames: number
  renderTime: {
    min: number
    max: number
    average: number
  }
}

export class PerformanceMonitor {
  private frameTimings: number[] = []
  private readonly maxSamples = 60
  private enabled = false

  constructor(enabled: boolean = false) {
    this.enabled = enabled
  }

  startFrame(): () => void {
    if (!this.enabled) return () => {}

    const startTime = performance.now()

    return () => {
      const endTime = performance.now()
      const frameTime = endTime - startTime

      this.frameTimings.push(frameTime)
      if (this.frameTimings.length > this.maxSamples) {
        this.frameTimings.shift()
      }
    }
  }

  getMetrics(): PerformanceMetrics {
    if (this.frameTimings.length === 0) {
      return {
        averageFrameTime: 0,
        fps: 0,
        droppedFrames: 0,
        renderTime: { min: 0, max: 0, average: 0 },
      }
    }

    const sum = this.frameTimings.reduce((a, b) => a + b, 0)
    const avg = sum / this.frameTimings.length
    const fps = 1000 / avg
    const targetFrameTime = 16.67 // 60fps

    const droppedFrames = this.frameTimings.filter(
      t => t > targetFrameTime
    ).length
    const min = Math.min(...this.frameTimings)
    const max = Math.max(...this.frameTimings)

    return {
      averageFrameTime: avg,
      fps: Math.round(fps),
      droppedFrames,
      renderTime: {
        min: Math.round(min * 100) / 100,
        max: Math.round(max * 100) / 100,
        average: Math.round(avg * 100) / 100,
      },
    }
  }

  reset(): void {
    this.frameTimings = []
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.reset()
    }
  }

  logMetrics(): void {
    if (!this.enabled) return

    const metrics = this.getMetrics()
    console.log('Minimap Performance:', {
      fps: `${metrics.fps} FPS`,
      avgFrameTime: `${metrics.renderTime.average}ms`,
      droppedFrames: `${metrics.droppedFrames}/${this.frameTimings.length}`,
      renderTimeRange: `${metrics.renderTime.min}ms - ${metrics.renderTime.max}ms`,
    })
  }
}

// デバッグモード判定
const isDebugMode = () => {
  if (typeof window === 'undefined') return false
  return (
    window.location.search.includes('debug=true') ||
    process.env.NODE_ENV === 'development'
  )
}

// シングルトンインスタンス
export const performanceMonitor = new PerformanceMonitor(isDebugMode())
