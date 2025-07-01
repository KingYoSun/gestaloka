/**
 * 移動可能な場所一覧コンポーネント
 */

import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ArrowRight, MapPin, Shield, Zap } from 'lucide-react'
import { useExploration } from '@/hooks/useExploration'
import { LoadingState } from '@/components/ui/LoadingState'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { useSPBalance } from '@/hooks/useSP'
import type { LocationConnectionResponse, DangerLevel } from '@/api/generated'

const dangerLevelConfig: Record<DangerLevel, { label: string; color: string }> =
  {
    safe: { label: '安全', color: 'text-green-600' },
    low: { label: '低危険度', color: 'text-yellow-600' },
    medium: { label: '中危険度', color: 'text-orange-600' },
    high: { label: '高危険度', color: 'text-red-600' },
    extreme: { label: '極度の危険', color: 'text-red-800' },
  }

export function AvailableLocations() {
  const { useAvailableLocations, useMoveToLocation } = useExploration()
  const { data: availableData, isLoading, error } = useAvailableLocations()
  const moveToLocation = useMoveToLocation()
  const { data: spBalance } = useSPBalance()

  const [selectedConnection, setSelectedConnection] =
    useState<LocationConnectionResponse | null>(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)

  if (isLoading) return <LoadingState message="移動可能な場所を読み込み中..." />
  if (error)
    return (
      <div className="text-destructive">移動可能な場所の取得に失敗しました</div>
    )
  if (!availableData) return null

  const { available_locations } = availableData

  const handleMoveClick = (connection: LocationConnectionResponse) => {
    setSelectedConnection(connection)
    setConfirmDialogOpen(true)
  }

  const handleConfirmMove = async () => {
    if (!selectedConnection) return

    await moveToLocation.mutateAsync({
      connectionId: selectedConnection.connection_id,
    })
    setConfirmDialogOpen(false)
    setSelectedConnection(null)
  }

  const currentSP = spBalance?.currentSp ?? 0

  if (available_locations.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">
            現在の場所から移動できる場所はありません
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="grid gap-4">
        {available_locations.map((connection: LocationConnectionResponse) => {
          const location = connection.to_location
          const dangerConfig = dangerLevelConfig[location.danger_level]
          const canAfford = currentSP >= connection.sp_cost

          return (
            <Card key={connection.connection_id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {location.name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {location.description}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">
                    階層 {location.hierarchy_level}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Shield className={`h-4 w-4 ${dangerConfig.color}`} />
                    <span className={dangerConfig.color}>
                      {dangerConfig.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">距離:</span>
                    <span>{connection.distance}</span>
                  </div>
                  {connection.min_level_required > 1 && (
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">必要Lv:</span>
                      <span>{connection.min_level_required}</span>
                    </div>
                  )}
                </div>

                {connection.travel_description && (
                  <p className="text-sm text-muted-foreground italic">
                    "{connection.travel_description}"
                  </p>
                )}
              </CardContent>

              <CardFooter className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Zap className="h-4 w-4 text-yellow-600" />
                  <span className="font-medium">{connection.sp_cost} SP</span>
                  {!canAfford && (
                    <span className="text-xs text-destructive ml-1">
                      (SP不足)
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => handleMoveClick(connection)}
                  disabled={!canAfford}
                >
                  移動する
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      {/* 移動確認ダイアログ */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移動の確認</DialogTitle>
            <DialogDescription>
              {selectedConnection && (
                <>
                  <strong>{selectedConnection.to_location.name}</strong>
                  へ移動しますか？
                  <br />
                  <span className="flex items-center gap-1 mt-2">
                    <Zap className="h-4 w-4 text-yellow-600" />
                    {selectedConnection.sp_cost} SPを消費します
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialogOpen(false)}
            >
              キャンセル
            </Button>
            <LoadingButton
              onClick={handleConfirmMove}
              isLoading={moveToLocation.isPending}
            >
              移動する
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
