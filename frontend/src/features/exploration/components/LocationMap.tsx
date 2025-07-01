/**
 * 場所マップコンポーネント
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useExploration } from '@/hooks/useExploration'
import { LoadingState } from '@/components/ui/LoadingState'
import type { LocationType, DangerLevel } from '@/api/generated'
import { cn } from '@/lib/utils'

const locationTypeColors: Record<LocationType, string> = {
  city: 'bg-blue-500',
  town: 'bg-green-500',
  dungeon: 'bg-red-500',
  wild: 'bg-yellow-500',
  special: 'bg-purple-500',
}

const dangerLevelOpacity: Record<DangerLevel, string> = {
  safe: 'opacity-100',
  low: 'opacity-90',
  medium: 'opacity-75',
  high: 'opacity-60',
  extreme: 'opacity-40',
}

export function LocationMap() {
  const { useAllLocations, useCurrentLocation } = useExploration()
  const { data: locations, isLoading } = useAllLocations()
  const { data: currentLocation } = useCurrentLocation()

  if (isLoading) return <LoadingState message="マップを読み込み中..." />
  if (!locations || locations.length === 0) return null

  // マップの範囲を計算
  const minX = Math.min(...locations.map(loc => loc.x_coordinate)) - 1
  const maxX = Math.max(...locations.map(loc => loc.x_coordinate)) + 1
  const minY = Math.min(...locations.map(loc => loc.y_coordinate)) - 1
  const maxY = Math.max(...locations.map(loc => loc.y_coordinate)) + 1

  const gridCols = maxX - minX + 1
  const gridRows = maxY - minY + 1

  return (
    <Card>
      <CardHeader>
        <CardTitle>エリアマップ</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="w-full overflow-auto">
          <div
            className="grid gap-1 min-w-[500px]"
            style={{
              gridTemplateColumns: `repeat(${gridCols}, minmax(60px, 1fr))`,
              gridTemplateRows: `repeat(${gridRows}, 60px)`,
            }}
          >
            {/* グリッドを生成 */}
            {Array.from({ length: gridRows }).map((_, row) =>
              Array.from({ length: gridCols }).map((_, col) => {
                const x = minX + col
                const y = minY + row
                const location = locations.find(
                  loc => loc.x_coordinate === x && loc.y_coordinate === y
                )

                if (!location) {
                  return (
                    <div
                      key={`${x}-${y}`}
                      className="border border-dashed border-muted rounded-md"
                    />
                  )
                }

                const isCurrentLocation = currentLocation?.id === location.id

                return (
                  <div
                    key={`${x}-${y}`}
                    className={cn(
                      'relative rounded-md border-2 cursor-pointer transition-all hover:scale-105',
                      locationTypeColors[location.location_type],
                      dangerLevelOpacity[location.danger_level],
                      isCurrentLocation
                        ? 'border-primary ring-2 ring-primary'
                        : 'border-transparent'
                    )}
                    title={`${location.name} (階層${location.hierarchy_level})`}
                  >
                    <div className="absolute inset-0 flex items-center justify-center p-1">
                      <span className="text-xs font-medium text-white text-center leading-tight">
                        {location.name}
                      </span>
                    </div>
                    {isCurrentLocation && (
                      <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full animate-pulse" />
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* 凡例 */}
        <div className="mt-4 pt-4 border-t">
          <div className="flex flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium">場所タイプ:</span>
              {Object.entries(locationTypeColors).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1">
                  <div className={cn('w-3 h-3 rounded', color)} />
                  <span className="capitalize">{type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
