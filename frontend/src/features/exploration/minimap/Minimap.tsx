/**
 * ミニマップメインコンポーネント
 */

import React, { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Maximize2, Minimize2, Layers, Navigation } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MinimapCanvas } from './MinimapCanvas'
import { useMapData } from './hooks'
import type { Viewport, LayerData } from './types'

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
      <div className="w-full h-full">
        <MinimapCanvas
          layerData={currentLayerData}
          currentLocation={mapData?.current_location}
          characterTrail={mapData?.character_trail || []}
          viewport={viewport}
          onViewportChange={setViewport}
          showLabels={isExpanded}
        />
      </div>

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
    </Card>
  )
}
