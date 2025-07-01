/**
 * 場所タイプ別のSVGアイコンコンポーネント
 */

import React from 'react'
import type { LocationType } from '../types'

interface LocationIconProps {
  type: LocationType
  size?: number
  color?: string
  className?: string
}

export const LocationIcon: React.FC<LocationIconProps> = ({
  type,
  size = 24,
  color = 'currentColor',
  className = '',
}) => {
  const props = {
    width: size,
    height: size,
    fill: color,
    className,
    viewBox: '0 0 24 24',
  }

  switch (type) {
    case 'city':
      return (
        <svg {...props}>
          <path d="M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z" />
        </svg>
      )

    case 'town':
      return (
        <svg {...props}>
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
        </svg>
      )

    case 'dungeon':
      return (
        <svg {...props}>
          <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V8.93l7-3.11v7.17z" />
        </svg>
      )

    case 'wild':
      return (
        <svg {...props}>
          <path d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z" />
        </svg>
      )

    case 'special':
      return (
        <svg {...props}>
          <path d="M12 2l2.4 7.4H22l-6.2 4.5L18.2 22 12 17.5 5.8 22l2.4-8.1L2 9.4h7.6L12 2z" />
        </svg>
      )

    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      )
  }
}

/**
 * Canvas上にアイコンを描画するためのユーティリティ
 */
export class IconRenderer {
  private iconCache: Map<string, HTMLImageElement> = new Map()
  private loadingPromises: Map<string, Promise<HTMLImageElement>> = new Map()

  /**
   * SVGアイコンをCanvasに描画可能な画像として取得
   */
  async getIconImage(
    type: LocationType,
    size: number,
    color: string
  ): Promise<HTMLImageElement> {
    const cacheKey = `${type}-${size}-${color}`
    
    // キャッシュチェック
    if (this.iconCache.has(cacheKey)) {
      return this.iconCache.get(cacheKey)!
    }

    // 読み込み中チェック
    if (this.loadingPromises.has(cacheKey)) {
      return this.loadingPromises.get(cacheKey)!
    }

    // 新規作成
    const loadPromise = this.createIconImage(type, size, color)
    this.loadingPromises.set(cacheKey, loadPromise)

    try {
      const img = await loadPromise
      this.iconCache.set(cacheKey, img)
      this.loadingPromises.delete(cacheKey)
      return img
    } catch (error) {
      this.loadingPromises.delete(cacheKey)
      throw error
    }
  }

  /**
   * SVGからImageElementを作成
   */
  private createIconImage(
    type: LocationType,
    size: number,
    color: string
  ): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const svgString = this.getSvgString(type, size, color)
      const blob = new Blob([svgString], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)

      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve(img)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error(`Failed to load icon for type: ${type}`))
      }
      img.src = url
    })
  }

  /**
   * SVG文字列を生成
   */
  private getSvgString(type: LocationType, size: number, color: string): string {
    const paths: Record<LocationType, string> = {
      city: 'M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z',
      town: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
      dungeon: 'M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V8.93l7-3.11v7.17z',
      wild: 'M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z',
      special: 'M12 2l2.4 7.4H22l-6.2 4.5L18.2 22 12 17.5 5.8 22l2.4-8.1L2 9.4h7.6L12 2z',
    }

    const path = paths[type] || 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z'

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
        <path fill="${color}" d="${path}"/>
      </svg>
    `
  }

  /**
   * Canvas上にアイコンを描画
   */
  async drawIcon(
    ctx: CanvasRenderingContext2D,
    type: LocationType,
    x: number,
    y: number,
    size: number,
    color: string
  ): Promise<void> {
    try {
      const img = await this.getIconImage(type, size, color)
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size)
    } catch (error) {
      // フォールバック: シンプルな図形を描画
      this.drawFallbackIcon(ctx, x, y, size, color)
    }
  }

  /**
   * フォールバックアイコン
   */
  private drawFallbackIcon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string
  ): void {
    ctx.save()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, size / 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /**
   * キャッシュをクリア
   */
  clearCache(): void {
    this.iconCache.clear()
    this.loadingPromises.clear()
  }
}

// シングルトンインスタンス
export const iconRenderer = new IconRenderer()