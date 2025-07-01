/**
 * ミニマップメインコンポーネント
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Maximize2, Minimize2, Layers, Navigation } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MinimapCanvas } from './MinimapCanvas'
import { MinimapTooltip } from './components/MinimapTooltip'
import { useMapData } from './hooks'
import type { Viewport, LayerData, MapLocation } from './types'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useExploration } from '@/hooks/useExploration'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { explorationApi } from '@/api/explorationApi'

interface MinimapProps {
  characterId: string
  className?: string
}

export const Minimap: React.FC<MinimapProps> = ({ characterId, className }) => {
  const { data: mapData, isLoading } = useMapData(characterId)
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedLayer, setSelectedLayer] = useState<number>(1)
  const [viewport, setViewport] = useState<Viewport>({
    x: 0,
    y: 0,
    zoom: 1,
    width: 200,
    height: 200,
  })
  const [selectedLocation, setSelectedLocation] = useState<MapLocation | null>(null)
  const [hoveredLocation, setHoveredLocation] = useState<MapLocation | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const canvasContainerRef = useRef<HTMLDivElement>(null)

  // 現在のレイヤーデータ
  const currentLayerData: LayerData | null = mapData
    ? mapData.layers.find((layer: LayerData) => layer.layer === selectedLayer) || null
    : null

  // 現在地に中心を合わせる
  const centerOnCurrentLocation = useCallback(() => {
    if (!mapData?.current_location) return

    const location = mapData.current_location
    setViewport(prev => ({
      ...prev,
      x: location.coordinates.x,
      y: location.coordinates.y,
    }))

    // レイヤーも現在地に合わせる
    setSelectedLayer(location.layer)
  }, [mapData])

  // 初回ロード時に現在地を中心に
  useEffect(() => {
    if (mapData?.current_location && viewport.x === 0 && viewport.y === 0) {
      centerOnCurrentLocation()
    }
  }, [mapData, centerOnCurrentLocation, viewport.x, viewport.y])

  // キーボードショートカット
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') {
        setIsExpanded(prev => !prev)
      }
    }

    window.addEventListener('keypress', handleKeyPress)
    return () => window.removeEventListener('keypress', handleKeyPress)
  }, [])

  const { useMoveToLocation } = useExploration()
  const { mutate: moveToLocation } = useMoveToLocation()
  const [showMoveDialog, setShowMoveDialog] = useState(false)
  const [targetLocation, setTargetLocation] = useState<MapLocation | null>(null)
  const [targetConnection, setTargetConnection] = useState<number | null>(null)

  // 場所を選択したときのハンドラ
  const handleLocationSelect = useCallback((location: MapLocation) => {
    setSelectedLocation(location)
  }, [])

  // 場所にホバーしたときのハンドラ
  const handleLocationHover = useCallback((location: MapLocation | null) => {
    setHoveredLocation(location)
  }, [])
  
  // マウス位置の追跡
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (canvasContainerRef.current) {
      const rect = canvasContainerRef.current.getBoundingClientRect()
      setMousePosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    }
  }, [])

  // 利用可能な接続を取得
  const { data: availableLocations } = useQuery({
    queryKey: ['exploration', 'available-locations', characterId],
    queryFn: () => explorationApi.getAvailableLocations(characterId),
    enabled: !!characterId,
  })

  // 移動ダイアログを表示
  const showMoveConfirmation = useCallback((location: MapLocation) => {
    // この場所への接続を検索
    const connection = availableLocations?.available_locations.find(
      conn => conn.to_location.id === location.id
    )
    
    if (connection) {
      setTargetLocation(location)
      setTargetConnection(connection.connection_id)
      setShowMoveDialog(true)
    } else {
      toast.error('この場所には直接移動できません')
    }
  }, [availableLocations])

  // 移動実行
  const handleMove = useCallback(() => {
    if (!targetLocation || !targetConnection) return

    moveToLocation(
      {
        connectionId: targetConnection,
      },
      {
        onSuccess: () => {
          toast.success(`${targetLocation.name}へ移動しました`)
          setShowMoveDialog(false)
          setTargetLocation(null)
          setTargetConnection(null)
          setSelectedLocation(null)
        },
        onError: (error) => {
          toast.error('移動に失敗しました')
          console.error(error)
        },
      }
    )
  }, [moveToLocation, targetLocation, targetConnection])

  if (isLoading) {
    return (
      <Card
        className={cn(
          'fixed bottom-4 right-4 p-4 bg-black/80 backdrop-blur',
          isExpanded ? 'w-[600px] h-[600px]' : 'w-[200px] h-[200px]',
          className
        )}
      >
        <div className="flex items-center justify-center h-full">
          <div className="text-white/60">マップデータを読み込み中...</div>
        </div>
      </Card>
    )
  }

  return (
    <Card
      className={cn(
        'fixed bottom-4 right-4 bg-black/80 backdrop-blur transition-all duration-300',
        isExpanded ? 'w-[600px] h-[600px]' : 'w-[200px] h-[200px]',
        className
      )}
    >
      {/* コントロールパネル */}
      <div className="absolute top-2 left-2 right-2 flex justify-between items-center z-10">
        <div className="flex gap-1">
          {/* レイヤー切り替え */}
          {mapData && mapData.layers.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-white/80 hover:text-white"
              title="レイヤー切り替え"
            >
              <Layers className="h-4 w-4 mr-1" />
              {currentLayerData?.name || `第${selectedLayer}層`}
            </Button>
          )}

          {/* 現在地ボタン */}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-white/80 hover:text-white"
            onClick={centerOnCurrentLocation}
            title="現在地に移動"
          >
            <Navigation className="h-4 w-4" />
          </Button>
        </div>

        {/* 拡大/縮小ボタン */}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-white/80 hover:text-white"
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? '縮小 (M)' : '拡大 (M)'}
        >
          {isExpanded ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* ミニマップ本体 */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div 
            ref={canvasContainerRef}
            className="w-full h-full relative"
            onMouseMove={handleMouseMove}
          >
            <MinimapCanvas
              layerData={currentLayerData}
              currentLocation={mapData?.current_location}
              characterTrail={mapData?.character_trail || []}
              viewport={viewport}
              onViewportChange={setViewport}
              showLabels={isExpanded}
              onLocationSelect={handleLocationSelect}
              onLocationHover={handleLocationHover}
            />
            
            {/* リッチなツールチップ */}
            <MinimapTooltip
              location={hoveredLocation!}
              connections={currentLayerData?.connections || []}
              x={mousePosition.x}
              y={mousePosition.y}
              visible={!!hoveredLocation}
            />
          </div>
        </ContextMenuTrigger>
          
          {/* 右クリックコンテキストメニュー */}
          <ContextMenuContent className="bg-black/90 text-white border-white/20">
            {selectedLocation && (
              <>
                <ContextMenuItem
                  onClick={() => showMoveConfirmation(selectedLocation)}
                  className="text-white hover:bg-white/10"
                >
                  <Navigation className="mr-2 h-4 w-4" />
                  {selectedLocation.name}へ移動
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => {
                    setViewport(prev => ({
                      ...prev,
                      x: selectedLocation.coordinates.x,
                      y: selectedLocation.coordinates.y,
                    }))
                  }}
                  className="text-white hover:bg-white/10"
                >
                  <Maximize2 className="mr-2 h-4 w-4" />
                  中央に表示
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>

      {/* 凡例（拡張モードのみ） */}
      {isExpanded && (
        <div className="absolute bottom-2 left-2 bg-black/60 rounded p-2 text-xs text-white/80">
          <div className="font-semibold mb-1">凡例</div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-[#4a90e2] rounded-full" />
              <span>都市</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-[#7cb342] rounded-full" />
              <span>町</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-[#8b4513] rounded-full" />
              <span>ダンジョン</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-[#228b22] rounded-full" />
              <span>野外</span>
            </div>
          </div>
        </div>
      )}

      {/* 移動確認ダイアログ */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent className="bg-gray-900 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>場所への移動</DialogTitle>
            <DialogDescription className="text-gray-300">
              {targetLocation?.name}へ移動しますか？
            </DialogDescription>
          </DialogHeader>
          {targetLocation && (
            <div className="space-y-2 py-4">
              <div className="flex justify-between">
                <span className="text-gray-400">危険度:</span>
                <span>{targetLocation.danger_level}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">必要SP:</span>
                <span>
                  {availableLocations?.available_locations.find(
                    conn => conn.connection_id === targetConnection
                  )?.sp_cost || '計算中...'}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowMoveDialog(false)}
              className="border-gray-600 text-gray-300 hover:bg-gray-800"
            >
              キャンセル
            </Button>
            <Button
              onClick={handleMove}
              className="bg-primary hover:bg-primary/90"
            >
              移動する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
