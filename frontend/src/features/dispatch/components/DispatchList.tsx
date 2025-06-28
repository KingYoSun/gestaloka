import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'
import { dispatchApi, DispatchStatus } from '@/api/dispatch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  MapPin,
  Calendar,
  Target,
  Coins,
  Activity,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DispatchDetail } from './DispatchDetail'

const statusConfig: Record<
  keyof DispatchStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  PREPARING: { label: '準備中', variant: 'secondary' },
  DISPATCHED: { label: '派遣中', variant: 'default' },
  RETURNING: { label: '帰還中', variant: 'outline' },
  COMPLETED: { label: '完了', variant: 'secondary' },
  RECALLED: { label: '召還済', variant: 'destructive' },
}

const objectiveTypeLabels: Record<string, string> = {
  explore: '探索',
  interact: '交流',
  collect: '収集',
  guard: '護衛',
  free: '自由',
}

export function DispatchList() {
  const [statusFilter, setStatusFilter] = useState<keyof DispatchStatus | 'all'>(
    'all'
  )
  const [selectedDispatchId, setSelectedDispatchId] = useState<string | null>(null)

  const { data: dispatches, isLoading } = useQuery({
    queryKey: ['dispatches', statusFilter],
    queryFn: () =>
      dispatchApi.getMyDispatches({
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!dispatches || dispatches.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">派遣中のログはありません</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="mb-4">
        <Select
          value={statusFilter}
          onValueChange={(value) =>
            setStatusFilter(value as keyof DispatchStatus | 'all')
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="ステータスでフィルタ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">すべて</SelectItem>
            <SelectItem value="DISPATCHED">派遣中</SelectItem>
            <SelectItem value="COMPLETED">完了</SelectItem>
            <SelectItem value="RECALLED">召還済</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {dispatches.map((dispatch: any) => {
          const isActive = dispatch.status === 'DISPATCHED'
          const achievementPercent = (dispatch.achievement_score * 100).toFixed(0)

          return (
            <Card
              key={dispatch.id}
              className={cn(
                'transition-colors',
                isActive && 'border-primary/50'
              )}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    ログID: {dispatch.completed_log_id.slice(0, 8)}...
                  </CardTitle>
                  <Badge variant={statusConfig[dispatch.status as keyof DispatchStatus].variant}>
                    {statusConfig[dispatch.status as keyof DispatchStatus].label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {objectiveTypeLabels[dispatch.objective_type]}型
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>{dispatch.initial_location}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>{dispatch.dispatch_duration_days}日間</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-muted-foreground" />
                    <span>{dispatch.sp_cost} SP</span>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground line-clamp-2">
                  {dispatch.objective_detail}
                </p>

                {dispatch.status === 'COMPLETED' && (
                  <div className="flex items-center gap-4 pt-2 border-t">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        達成度: {achievementPercent}%
                      </span>
                    </div>
                    {dispatch.sp_refund_amount > 0 && (
                      <Badge variant="outline" className="text-green-600">
                        +{dispatch.sp_refund_amount} SP還元
                      </Badge>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-muted-foreground">
                    {dispatch.dispatched_at
                      ? formatDistanceToNow(new Date(dispatch.dispatched_at), {
                          addSuffix: true,
                          locale: ja,
                        })
                      : '未派遣'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedDispatchId(dispatch.id)}
                  >
                    詳細を見る
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {selectedDispatchId && (
        <DispatchDetail
          dispatchId={selectedDispatchId}
          open={!!selectedDispatchId}
          onOpenChange={(open) => {
            if (!open) setSelectedDispatchId(null)
          }}
        />
      )}
    </>
  )
}