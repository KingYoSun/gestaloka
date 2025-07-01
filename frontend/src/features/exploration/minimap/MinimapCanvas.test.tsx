/**
 * ミニマップCanvasコンポーネントのテスト
 */

import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MinimapCanvas } from './MinimapCanvas'
import type { LayerData, Viewport } from './types'

// URL.createObjectURLのモック
global.URL.createObjectURL = vi.fn(() => 'mock-url')
global.URL.revokeObjectURL = vi.fn()

// Canvas 2Dコンテキストのモック
const mockContext = {
  fillRect: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  arc: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  closePath: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  setLineDash: vi.fn(),
  createRadialGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  fillText: vi.fn(),
  font: '',
  textAlign: 'left' as CanvasTextAlign,
  shadowBlur: 0,
  shadowColor: '',
  getImageData: vi.fn(() => ({
    data: new Uint8ClampedArray(100),
    width: 10,
    height: 10,
  })),
  measureText: vi.fn(() => ({
    width: 50,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 2,
    fontBoundingBoxAscent: 12,
    fontBoundingBoxDescent: 3,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: 50,
  })),
  drawImage: vi.fn(),
}

// HTMLCanvasElementのモック
HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext as any)
HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
  left: 0,
  top: 0,
  right: 200,
  bottom: 200,
  width: 200,
  height: 200,
  x: 0,
  y: 0,
  toJSON: () => {},
}))

const mockLayerData: LayerData = {
  layer: 1,
  name: '第1層',
  locations: [
    {
      id: '1',
      name: 'テスト都市',
      coordinates: { x: 0, y: 0 },
      type: 'city',
      danger_level: 'safe',
      is_discovered: true,
      exploration_percentage: 100,
    },
    {
      id: '2',
      name: 'テストダンジョン',
      coordinates: { x: 100, y: 100 },
      type: 'dungeon',
      danger_level: 'high',
      is_discovered: true,
      exploration_percentage: 30,
    },
  ],
  connections: [
    {
      id: 1,
      from_location_id: '1',
      to_location_id: '2',
      path_type: 'direct',
      is_one_way: false,
      is_discovered: true,
      sp_cost: 20,
    },
  ],
  exploration_progress: [
    {
      id: '1',
      character_id: 'test',
      location_id: '1',
      exploration_percentage: 100,
      areas_explored: [],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    },
  ],
}

describe('MinimapCanvas', () => {
  const defaultViewport: Viewport = {
    x: 0,
    y: 0,
    zoom: 1,
    width: 200,
    height: 200,
  }

  const mockOnViewportChange = vi.fn()
  const mockOnLocationSelect = vi.fn()
  const mockOnLocationHover = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderCanvas = (props = {}) => {
    return render(
      <MinimapCanvas
        layerData={mockLayerData}
        viewport={defaultViewport}
        onViewportChange={mockOnViewportChange}
        onLocationSelect={mockOnLocationSelect}
        onLocationHover={mockOnLocationHover}
        characterTrail={[]}
        {...props}
      />
    )
  }

  it('キャンバスを正しくレンダリングする', () => {
    const { container } = renderCanvas()
    const canvas = container.querySelector('canvas')
    
    expect(canvas).toBeInTheDocument()
    expect(canvas).toHaveClass('w-full h-full cursor-move')
  })

  it('グリッドを描画する', async () => {
    renderCanvas({ showGrid: true })
    
    // 描画が完了するまで待機
    await waitFor(() => {
      // グリッド描画の呼び出しを確認
      expect(mockContext.stroke).toHaveBeenCalled()
    })
  })

  it('場所を正しく描画する', async () => {
    renderCanvas()
    
    // 描画が完了するまで待機
    await waitFor(() => {
      // 場所の描画（円）
      expect(mockContext.arc).toHaveBeenCalled()
      expect(mockContext.fill).toHaveBeenCalled()
    })
    
    // ラベルの描画
    expect(mockContext.fillText).toHaveBeenCalledWith(
      'テスト都市',
      expect.any(Number),
      expect.any(Number)
    )
  })

  it('接続線を描画する', async () => {
    renderCanvas()
    
    // 描画が完了するまで待機
    await waitFor(() => {
      // 接続線の描画
      expect(mockContext.moveTo).toHaveBeenCalled()
      expect(mockContext.lineTo).toHaveBeenCalled()
      expect(mockContext.stroke).toHaveBeenCalled()
    })
  })

  it('ドラッグでビューポートを移動する', () => {
    const { container } = renderCanvas()
    const canvas = container.querySelector('canvas')!
    
    // 空白部分でドラッグ開始（場所をクリックしないように）
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 })
    
    // ドラッグ中
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 60 })
    
    expect(mockOnViewportChange).toHaveBeenCalledWith({
      ...defaultViewport,
      x: -50,
      y: -50,
    })
    
    // ドラッグ終了
    fireEvent.mouseUp(canvas)
  })

  it('ホイールでズームを変更する', () => {
    const { container } = renderCanvas()
    const canvas = container.querySelector('canvas')!
    
    // ズームイン
    fireEvent.wheel(canvas, { deltaY: -100 })
    
    expect(mockOnViewportChange).toHaveBeenCalledWith(
      expect.objectContaining({
        zoom: expect.closeTo(1.1, 0.01),
      })
    )
    
    // ズームアウト
    fireEvent.wheel(canvas, { deltaY: 100 })
    
    expect(mockOnViewportChange).toHaveBeenCalledWith(
      expect.objectContaining({
        zoom: expect.closeTo(0.9, 0.01),
      })
    )
  })

  it('場所をクリックすると選択される', () => {
    const { container } = renderCanvas()
    const canvas = container.querySelector('canvas')!
    
    // 場所の座標をクリック（テスト都市の位置）
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 })
    
    expect(mockOnLocationSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        name: 'テスト都市',
      })
    )
  })

  it('場所にホバーするとホバー状態になる', () => {
    const { container } = renderCanvas()
    const canvas = container.querySelector('canvas')!
    
    // 場所の上でマウスを動かす
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 })
    
    expect(mockOnLocationHover).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        name: 'テスト都市',
      })
    )
    
    // カーソルスタイルが変更される
    expect(canvas.style.cursor).toBe('pointer')
  })

  it('空白部分にホバーするとホバー状態が解除される', () => {
    const { container } = renderCanvas()
    const canvas = container.querySelector('canvas')!
    
    // まず場所にホバー
    fireEvent.mouseMove(canvas, { clientX: 100, clientY: 100 })
    expect(mockOnLocationHover).toHaveBeenCalled()
    
    // 空白部分でマウスを動かす
    fireEvent.mouseMove(canvas, { clientX: 10, clientY: 10 })
    
    // ホバー状態が解除されるか、または別の場所が検出されない
    // この座標は場所から十分離れているのでnullが期待される
    const lastCall = mockOnLocationHover.mock.calls[mockOnLocationHover.mock.calls.length - 1]
    expect(lastCall[0]).toBeNull()
    expect(canvas.style.cursor).toBe('move')
  })

  it('現在地をパルスアニメーションで表示する', async () => {
    let animationFrameCount = 0
    const mockRequestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        // 無限ループを防ぐため、数回だけ実行
        if (animationFrameCount < 3) {
          animationFrameCount++
          setTimeout(() => callback(0), 16) // 16ms後に実行
        }
        return animationFrameCount
      })

    renderCanvas({
      currentLocation: {
        id: '1',
        layer: 1,
        coordinates: { x: 0, y: 0 },
      },
    })

    await waitFor(() => {
      // アニメーションフレームが呼ばれることを確認
      expect(mockRequestAnimationFrame).toHaveBeenCalled()
    })

    mockRequestAnimationFrame.mockRestore()
  })

  it('霧効果を適用する', async () => {
    renderCanvas()
    
    // 描画が完了するまで待機
    await waitFor(() => {
      // 霧効果の描画
      expect(mockContext.fillRect).toHaveBeenCalled()
      expect(mockContext.createRadialGradient).toHaveBeenCalled()
    })
  })

  it('移動履歴の軌跡を描画する', async () => {
    renderCanvas({
      characterTrail: [
        {
          location_id: '1',
          timestamp: '2025-01-01T00:00:00Z',
          layer: 1,
          coordinates: { x: 0, y: 0 },
        },
        {
          location_id: '2',
          timestamp: '2025-01-01T01:00:00Z',
          layer: 1,
          coordinates: { x: 100, y: 100 },
        },
      ],
    })
    
    // 描画が完了するまで待機
    await waitFor(() => {
      // 軌跡の描画（線の描画）
      expect(mockContext.moveTo).toHaveBeenCalled()
      expect(mockContext.lineTo).toHaveBeenCalled()
      expect(mockContext.stroke).toHaveBeenCalled()
      // パーティクルの描画
      expect(mockContext.arc).toHaveBeenCalled()
      expect(mockContext.fill).toHaveBeenCalled()
    })
  })
})