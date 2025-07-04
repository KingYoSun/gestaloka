/**
 * ミニマップのCanvas描画コンポーネント
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { CoordinateSystem } from './utils/mapGeometry'
import { FogOfWarRenderer, fogPresets } from './utils/fogOfWar'
import {
  AnimationManager,
  drawConnectionPulse,
  drawTrailAnimation,
} from './utils/animations'
import { iconRenderer } from './components/LocationIcons'
import { performanceMonitor } from './utils/performanceMonitor'
import type {
  MapLocation,
  MapConnection,
  Viewport,
  LayerData,
  CurrentLocation,
  LocationHistory,
  MinimapTheme,
  LocationType,
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
  const [hoveredLocation, setHoveredLocation] = useState<MapLocation | null>(
    null
  )
  const [selectedLocation, setSelectedLocation] = useState<MapLocation | null>(
    null
  )
  const [discoveredLocations, setDiscoveredLocations] = useState<Set<string>>(
    new Set()
  )
  const [iconCache, setIconCache] = useState<Map<string, HTMLImageElement>>(
    new Map()
  )

  // 霧効果レンダラー
  const fogRenderer = useMemo(
    () => new FogOfWarRenderer(viewport.width, viewport.height),
    [viewport.width, viewport.height]
  )

  // アニメーションマネージャー
  const animationManager = useMemo(() => new AnimationManager(), [])

  // アイコンのプリロード
  useEffect(() => {
    if (!layerData) return

    const preloadIcons = async () => {
      const uniqueTypes = new Set<LocationType>()
      layerData.locations.forEach(loc => {
        if (loc.is_discovered) {
          uniqueTypes.add(loc.type)
        }
      })

      const newCache = new Map<string, HTMLImageElement>()

      await Promise.all(
        Array.from(uniqueTypes).map(async type => {
          try {
            const img = await iconRenderer.getIconImage(
              type,
              24, // デフォルトサイズ
              theme.location[type]
            )
            newCache.set(type, img)
          } catch (error) {
            console.warn(`Failed to preload icon for type ${type}:`, error)
          }
        })
      )

      setIconCache(newCache)
    }

    preloadIcons()
  }, [layerData, theme])

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
    const endFrame = performanceMonitor.startFrame()

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

    // 接続を描画（重要な経路にパルス効果）
    for (const connection of layerData.connections) {
      // 現在地に接続されている経路はパルス
      const isConnectedToCurrent =
        currentLocation &&
        (connection.from_location_id === currentLocation.id ||
          connection.to_location_id === currentLocation.id)

      if (
        isConnectedToCurrent &&
        animationManager.isAnimating('connection-pulse')
      ) {
        const fromLocation = layerData.locations.find(
          loc => loc.id === connection.from_location_id
        )
        const toLocation = layerData.locations.find(
          loc => loc.id === connection.to_location_id
        )
        if (fromLocation && toLocation) {
          const from = CoordinateSystem.worldToScreen(
            fromLocation.coordinates,
            viewport
          )
          const to = CoordinateSystem.worldToScreen(
            toLocation.coordinates,
            viewport
          )
          const pulseProgress = animationManager.getProgress('connection-pulse')
          drawConnectionPulse(
            ctx,
            from,
            to,
            pulseProgress,
            theme.connection[connection.path_type]
          )
        }
      } else {
        drawConnection(ctx, connection, layerData.locations, viewport, theme)
      }
    }

    // 移動履歴をアニメーションで描画
    if (characterTrail.length > 1) {
      const trailPoints = characterTrail.map(h =>
        CoordinateSystem.worldToScreen(h.coordinates, viewport)
      )
      const trailProgress = animationManager.getProgress('trail-animation')
      drawTrailAnimation(ctx, trailPoints, trailProgress || 1, theme.trail)
    }

    // 場所を描画
    for (const location of layerData.locations) {
      drawLocation(
        ctx,
        location,
        viewport,
        theme,
        currentLocation?.id === location.id,
        hoveredLocation?.id === location.id,
        selectedLocation?.id === location.id
      )
    }

    // 現在地を描画
    if (currentLocation) {
      drawCurrentLocation(ctx, currentLocation, viewport, theme.currentLocation)
    }

    // 改善された霧効果を適用
    const fogCanvas = fogRenderer.render(
      layerData.exploration_progress,
      layerData.locations,
      viewport,
      fogPresets.mystical,
      Date.now()
    )
    ctx.drawImage(fogCanvas, 0, 0)

    // パフォーマンス計測終了
    endFrame()
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
    fogRenderer,
    animationManager,
    discoveredLocations,
    iconCache,
    setDiscoveredLocations,
  ])

  // 描画関数群
  const drawLocation = React.useCallback(
    (
      ctx: CanvasRenderingContext2D,
      location: MapLocation,
      viewport: Viewport,
      theme: MinimapTheme,
      isCurrent: boolean,
      isHovered: boolean,
      isSelected: boolean
    ) => {
      const pos = CoordinateSystem.worldToScreen(location.coordinates, viewport)
      const radius = Math.max(10, 15 * viewport.zoom)

      // アイコンキャッシュの取得（非同期だが描画はキャッシュされた結果を使用）
      const cachedIcon = iconCache.get(location.type)

      // 未発見の場所は半透明
      if (!location.is_discovered) {
        ctx.globalAlpha = 0.3
      }

      // 発見アニメーション
      if (!discoveredLocations.has(location.id) && location.is_discovered) {
        setDiscoveredLocations(prev => new Set([...prev, location.id]))
        animationManager.start(`discovery-${location.id}`, 2000)
      }

      // 発見アニメーションの描画
      const discoveryProgress = animationManager.getProgress(
        `discovery-${location.id}`
      )
      if (discoveryProgress < 1) {
        // 発見時のパルスエフェクト
        ctx.save()
        ctx.globalAlpha = 1 - discoveryProgress
        ctx.strokeStyle = theme.location[location.type]
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, radius + discoveryProgress * 30, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // ホバー/選択時のグロー効果
      if (isHovered || isSelected) {
        const glowIntensity = isSelected ? 1 : 0.7
        const glowColor = isSelected ? '#ffeb3b' : '#ffffff'
        ctx.save()
        ctx.shadowColor = glowColor
        ctx.shadowBlur = 20 * glowIntensity
        ctx.globalAlpha = 0.5 * glowIntensity
        ctx.fillStyle = glowColor
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // 危険度による外枠（グラデーション）
      const gradient = ctx.createRadialGradient(
        pos.x,
        pos.y,
        radius,
        pos.x,
        pos.y,
        radius + 5
      )
      gradient.addColorStop(0, theme.danger[location.danger_level])
      gradient.addColorStop(1, `${theme.danger[location.danger_level]}00`)
      ctx.strokeStyle = gradient
      ctx.lineWidth = isHovered || isSelected ? 4 : 3
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
        // ズームが十分な場合はキャッシュされたアイコンを表示
        const iconSize = radius * 1.5
        ctx.drawImage(
          cachedIcon,
          pos.x - iconSize / 2,
          pos.y - iconSize / 2,
          iconSize,
          iconSize
        )
      } else {
        // ズームが小さい場合またはアイコンがない場合は色で塗りつぶし
        ctx.fillStyle = theme.location[location.type]
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, radius * 0.8, 0, Math.PI * 2)
        ctx.fill()
      }

      // 現在地の強調表示（パルスアニメーション）
      if (isCurrent) {
        const pulseProgress = animationManager.getProgress(
          'current-location-pulse'
        )
        // 現在地のパルスエフェクト
        const pulseScale = 1 + Math.sin(pulseProgress * Math.PI * 2) * 0.2
        ctx.save()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 3
        ctx.globalAlpha = 0.8
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, radius * pulseScale, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // ラベルの表示
      if (showLabels && viewport.zoom > 0.5) {
        ctx.fillStyle = '#ffffff'
        ctx.font = `${Math.max(12, 14 * viewport.zoom)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(location.name, pos.x, pos.y + radius + 15)
      }

      // 透明度をリセット
      ctx.globalAlpha = 1
    },
    [
      discoveredLocations,
      setDiscoveredLocations,
      animationManager,
      iconCache,
      showLabels,
    ]
  )

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
    const toLocation = locations.find(
      loc => loc.id === connection.to_location_id
    )

    if (!fromLocation || !toLocation) return

    const from = CoordinateSystem.worldToScreen(
      fromLocation.coordinates,
      viewport
    )
    const to = CoordinateSystem.worldToScreen(toLocation.coordinates, viewport)

    // 未発見の接続は半透明に
    const opacity = connection.is_discovered ? 1 : 0.3
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.strokeStyle = theme.connection[connection.path_type]
    ctx.lineWidth = connection.is_discovered ? 2 : 1

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

    ctx.restore() // opacityのリストア
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

  // 移動履歴が変更されたときにアニメーションを開始
  useEffect(() => {
    if (characterTrail.length > 1) {
      animationManager.start('trail-animation', 3000)
    }
  }, [characterTrail, animationManager])

  // 現在地に接続された経路のパルスアニメーション
  useEffect(() => {
    if (currentLocation) {
      animationManager.start('connection-pulse', 2000)
    }
  }, [currentLocation, animationManager])

  // 霧レンダラーのサイズ更新
  useEffect(() => {
    fogRenderer.resize(viewport.width, viewport.height)
  }, [viewport.width, viewport.height, fogRenderer])

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

  // 統合されたアニメーションループ
  useEffect(() => {
    let animationFrameId: number
    let lastFrameTime = 0
    let frameCount = 0
    const targetFPS = 60
    const frameInterval = 1000 / targetFPS

    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastFrameTime

      // フレームレート制限
      if (deltaTime >= frameInterval) {
        lastFrameTime = currentTime - (deltaTime % frameInterval)
        draw()

        // 定期的にパフォーマンスメトリクスをログ出力（開発時のみ）
        frameCount++
        if (frameCount % 300 === 0) {
          // 5秒ごと
          performanceMonitor.logMetrics()
        }
      }

      animationFrameId = requestAnimationFrame(animate)
    }

    animationFrameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrameId)
  }, [draw])

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
