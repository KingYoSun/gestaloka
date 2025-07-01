/**
 * ミニマップのCanvas描画コンポーネント
 */

import React, { useRef, useEffect, useCallback, useState } from 'react'
import { CoordinateSystem } from './utils/mapGeometry'
import type {
  MapLocation,
  MapConnection,
  Viewport,
  LayerData,
  CurrentLocation,
  LocationHistory,
  MinimapTheme,
} from './types'

interface MinimapCanvasProps {
  layerData: LayerData | null
  currentLocation?: CurrentLocation
  characterTrail: LocationHistory[]
  viewport: Viewport
  onViewportChange: (viewport: Viewport) => void
  theme?: MinimapTheme
  showGrid?: boolean
  showLabels?: boolean
  onLocationSelect?: (location: MapLocation) => void
  onLocationHover?: (location: MapLocation | null) => void
}

const defaultTheme: MinimapTheme = {
  background: '#1a1a1a',
  grid: '#333333',
  location: {
    city: '#4a90e2',
    town: '#7cb342',
    dungeon: '#8b4513',
    wild: '#228b22',
    special: '#9c27b0',
  },
  danger: {
    safe: '#4caf50',
    low: '#8bc34a',
    medium: '#ffeb3b',
    high: '#ff9800',
    extreme: '#f44336',
  },
  fog: 'rgba(0, 0, 0, 0.7)',
  trail: '#00bcd4',
  currentLocation: '#ff5722',
  connection: {
    direct: '#666666',
    curved: '#888888',
    teleport: '#e91e63',
    stairs: '#795548',
    elevator: '#607d8b',
  },
}

export const MinimapCanvas: React.FC<MinimapCanvasProps> = ({
  layerData,
  currentLocation,
  characterTrail,
  viewport,
  onViewportChange,
  theme = defaultTheme,
  showGrid = true,
  showLabels = true,
  onLocationSelect,
  onLocationHover,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [viewportStart, setViewportStart] = useState({ x: 0, y: 0 })
  const [hoveredLocation, setHoveredLocation] = useState<MapLocation | null>(null)
  const [selectedLocation, setSelectedLocation] = useState<MapLocation | null>(null)

  // マウス位置から場所を検出
  const getLocationAtPoint = useCallback(
    (screenX: number, screenY: number): MapLocation | null => {
      if (!layerData) return null

      const worldPos = CoordinateSystem.screenToWorld(
        { x: screenX, y: screenY },
        viewport
      )

      // 各場所との距離をチェック
      for (const location of layerData.locations) {
        const distance = CoordinateSystem.distance(
          worldPos,
          location.coordinates
        )
        // クリック判定の半径（ズームレベルに応じて調整）
        const hitRadius = 15 / viewport.zoom
        if (distance <= hitRadius) {
          return location
        }
      }

      return null
    },
    [layerData, viewport]
  )

  // 描画メインループ
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // キャンバスをクリア
    ctx.fillStyle = theme.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (!layerData) return

    // グリッドを描画
    if (showGrid) {
      drawGrid(ctx, viewport, theme.grid)
    }

    // 接続を描画
    layerData.connections.forEach(connection => {
      drawConnection(ctx, connection, layerData.locations, viewport, theme)
    })

    // 移動履歴を描画
    drawTrail(ctx, characterTrail, viewport, theme.trail)

    // 場所を描画
    layerData.locations.forEach(location => {
      const isHovered = hoveredLocation?.id === location.id
      const isSelected = selectedLocation?.id === location.id
      drawLocation(ctx, location, viewport, theme, showLabels, isHovered, isSelected)
    })

    // 現在地を描画
    if (currentLocation) {
      drawCurrentLocation(ctx, currentLocation, viewport, theme.currentLocation)
    }

    // 霧効果を適用
    applyFogOfWar(ctx, layerData, viewport)
  }, [
    layerData,
    currentLocation,
    characterTrail,
    viewport,
    theme,
    showGrid,
    showLabels,
    hoveredLocation,
    selectedLocation,
    applyFogOfWar,
  ])

  // 描画関数群
  const drawGrid = (
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    color: string
  ) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.3

    const gridSize = 50 // ワールド座標でのグリッドサイズ
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

  const drawConnection = (
    ctx: CanvasRenderingContext2D,
    connection: MapConnection,
    locations: MapLocation[],
    viewport: Viewport,
    theme: MinimapTheme
  ) => {
    const fromLocation = locations.find(
      loc => loc.id === connection.from_location_id
    )
    const toLocation = locations.find(loc => loc.id === connection.to_location_id)

    if (!fromLocation || !toLocation) return

    const from = CoordinateSystem.worldToScreen(
      fromLocation.coordinates,
      viewport
    )
    const to = CoordinateSystem.worldToScreen(toLocation.coordinates, viewport)

    ctx.strokeStyle = theme.connection[connection.path_type]
    ctx.lineWidth = 2

    if (connection.path_type === 'curved') {
      // ベジェ曲線で描画
      const controlPoint = {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2 - 30,
      }
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, to.x, to.y)
      ctx.stroke()
    } else if (connection.path_type === 'teleport') {
      // 点線で描画
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      // 直線で描画
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
  }

  const drawLocation = (
    ctx: CanvasRenderingContext2D,
    location: MapLocation,
    viewport: Viewport,
    theme: MinimapTheme,
    showLabel: boolean,
    isHovered: boolean = false,
    isSelected: boolean = false
  ) => {
    const pos = CoordinateSystem.worldToScreen(location.coordinates, viewport)
    const radius = (isHovered || isSelected ? 10 : 8) * viewport.zoom

    // ホバー/選択時のハイライト
    if (isHovered || isSelected) {
      ctx.save()
      ctx.shadowBlur = 20
      ctx.shadowColor = isSelected ? '#ffeb3b' : '#ffffff'
      ctx.fillStyle = isSelected ? '#ffeb3b' : '#ffffff'
      ctx.globalAlpha = 0.3
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, radius + 10, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // 危険度による外枠
    ctx.strokeStyle = theme.danger[location.danger_level]
    ctx.lineWidth = isHovered || isSelected ? 4 : 3
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, radius + 3, 0, Math.PI * 2)
    ctx.stroke()

    // 場所タイプによる塗りつぶし
    ctx.fillStyle = theme.location[location.type]
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
    ctx.fill()

    // 探索進捗を表示
    if (
      location.exploration_percentage > 0 &&
      location.exploration_percentage < 100
    ) {
      ctx.globalAlpha = 0.5
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(
        pos.x,
        pos.y,
        radius,
        -Math.PI / 2,
        -Math.PI / 2 + (Math.PI * 2 * location.exploration_percentage) / 100
      )
      ctx.lineTo(pos.x, pos.y)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 1
    }

    // ラベル表示
    if (showLabel && viewport.zoom > 0.5) {
      ctx.fillStyle = '#ffffff'
      ctx.font = `${12 * viewport.zoom}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(location.name, pos.x, pos.y + radius + 15 * viewport.zoom)
    }
  }

  const drawTrail = (
    ctx: CanvasRenderingContext2D,
    trail: LocationHistory[],
    viewport: Viewport,
    color: string
  ) => {
    if (trail.length < 2) return

    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.setLineDash([3, 3])

    for (let i = 0; i < trail.length - 1; i++) {
      const from = CoordinateSystem.worldToScreen(
        trail[i].coordinates,
        viewport
      )
      const to = CoordinateSystem.worldToScreen(
        trail[i + 1].coordinates,
        viewport
      )

      ctx.globalAlpha = 1 - i / trail.length // フェードアウト効果
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
    }

    ctx.globalAlpha = 1
    ctx.setLineDash([])
  }

  const drawCurrentLocation = (
    ctx: CanvasRenderingContext2D,
    current: CurrentLocation,
    viewport: Viewport,
    color: string
  ) => {
    const pos = CoordinateSystem.worldToScreen(current.coordinates, viewport)
    const time = Date.now() / 1000
    const pulse = Math.sin(time * 3) * 0.3 + 0.7

    ctx.fillStyle = color
    ctx.globalAlpha = pulse
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, 15 * viewport.zoom, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1

    // 中心点
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, 3 * viewport.zoom, 0, Math.PI * 2)
    ctx.fill()
  }

  const applyFogOfWar = (
    ctx: CanvasRenderingContext2D,
    layerData: LayerData,
    viewport: Viewport
  ) => {
    // 霧効果の実装（簡略版）
    ctx.fillStyle = theme.fog
    ctx.fillRect(0, 0, viewport.width, viewport.height)

    // 探索済みエリアを明るくする
    layerData.exploration_progress.forEach((progress) => {
      const location = layerData.locations.find(
        loc => loc.id === progress.location_id
      )
      if (!location) return

      const pos = CoordinateSystem.worldToScreen(location.coordinates, viewport)
      const radius =
        100 * viewport.zoom * (progress.exploration_percentage / 100)

      // グラデーションで霧を晴らす
      const gradient = ctx.createRadialGradient(
        pos.x,
        pos.y,
        0,
        pos.x,
        pos.y,
        radius
      )
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.7)')

      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    })
  }

  // マウス/タッチイベントハンドラ
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const clickedLocation = getLocationAtPoint(x, y)

    if (clickedLocation) {
      // 場所をクリックした場合
      setSelectedLocation(clickedLocation)
      if (onLocationSelect) {
        onLocationSelect(clickedLocation)
      }
    } else {
      // 空白部分をクリックした場合はドラッグ開始
      setIsDragging(true)
      setDragStart({ x: e.clientX, y: e.clientY })
      setViewportStart({ x: viewport.x, y: viewport.y })
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    if (isDragging) {
      // ドラッグ中の処理
      const dx = (e.clientX - dragStart.x) / viewport.zoom
      const dy = (e.clientY - dragStart.y) / viewport.zoom

      onViewportChange({
        ...viewport,
        x: viewportStart.x - dx,
        y: viewportStart.y - dy,
      })
    } else {
      // ホバー検出
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const location = getLocationAtPoint(x, y)

      if (location !== hoveredLocation) {
        setHoveredLocation(location)
        if (onLocationHover) {
          onLocationHover(location)
        }
        // カーソルスタイルの変更
        if (canvasRef.current) {
          canvasRef.current.style.cursor = location ? 'pointer' : 'move'
        }
      }
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const worldPos = CoordinateSystem.screenToWorld(
      { x: mouseX, y: mouseY },
      viewport
    )

    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = CoordinateSystem.clampZoom(viewport.zoom * zoomDelta)

    // マウス位置を中心にズーム
    const newViewport = {
      ...viewport,
      zoom: newZoom,
      x: worldPos.x - (mouseX - viewport.width / 2) / newZoom,
      y: worldPos.y - (mouseY - viewport.height / 2) / newZoom,
    }

    onViewportChange(newViewport)
  }

  // キャンバスのリサイズ
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [])

  // 描画の実行
  useEffect(() => {
    draw()
  }, [draw])

  // アニメーションループ（現在地のパルス効果用）
  useEffect(() => {
    if (!currentLocation) return

    let animationFrameId: number
    const animate = () => {
      draw()
      animationFrameId = requestAnimationFrame(animate)
    }
    animate()

    return () => cancelAnimationFrame(animationFrameId)
  }, [currentLocation, draw])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-move"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        handleMouseUp()
        setHoveredLocation(null)
        if (onLocationHover) {
          onLocationHover(null)
        }
        if (canvasRef.current) {
          canvasRef.current.style.cursor = 'move'
        }
      }}
      onWheel={handleWheel}
    />
  )
}
