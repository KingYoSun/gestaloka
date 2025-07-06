import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { dispatchApi } from '@/api/dispatch'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  MapPin,
  Calendar,
  Target,
  Coins,
  Activity,
  Users,
  Package,
  Map,
  AlertTriangle,
  Clock,
  Award,
} from 'lucide-react'

interface DispatchDetailProps {
  dispatchId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DispatchDetail({
  dispatchId,
  open,
  onOpenChange,
}: DispatchDetailProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: dispatch, isLoading } = useQuery({
    queryKey: ['dispatch', dispatchId],
    queryFn: () => dispatchApi.getDispatchDetail(dispatchId),
    enabled: open,
  })

  const { data: report } = useQuery({
    queryKey: ['dispatch-report', dispatchId],
    queryFn: () => dispatchApi.getDispatchReport(dispatchId),
    enabled: open && dispatch?.status === 'COMPLETED',
  })

  const recallMutation = useMutation({
    mutationFn: () => dispatchApi.recallDispatch(dispatchId),
    onSuccess: data => {
      toast({
        title: '緊急召還完了',
        description: `${data.recall_cost} SPを消費して召還しました`,
      })
      queryClient.invalidateQueries({ queryKey: ['dispatches'] })
      queryClient.invalidateQueries({ queryKey: ['dispatch', dispatchId] })
      queryClient.invalidateQueries({ queryKey: ['player-sp'] })
    },
    onError: (error: any) => {
      toast({
        title: '召還失敗',
        description: error.response?.data?.detail || 'エラーが発生しました',
        variant: 'destructive',
      })
    },
  })

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </DialogHeader>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  if (!dispatch) return null

  const isActive = dispatch.status === 'DISPATCHED'
  const recallCost = Math.floor(dispatch.sp_cost / 2)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>派遣詳細</DialogTitle>
          <DialogDescription>
            ログID: {dispatch.completed_log_id}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">概要</TabsTrigger>
            <TabsTrigger value="activity">活動記録</TabsTrigger>
            <TabsTrigger value="encounters">遭遇</TabsTrigger>
            <TabsTrigger value="results">成果</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[500px] mt-4">
            <TabsContent value="overview" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">基本情報</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        目的: {dispatch.objective_type}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        初期地点: {dispatch.initial_location}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        期間: {dispatch.dispatch_duration_days}日間
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        消費SP: {dispatch.sp_cost}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t">
                    <p className="text-sm text-muted-foreground">
                      {dispatch.objective_detail}
                    </p>
                  </div>

                  {dispatch.dispatched_at && (
                    <div className="pt-3 border-t space-y-1 text-sm">
                      <p>
                        派遣開始:{' '}
                        {format(dispatch.dispatched_at, 'yyyy/MM/dd HH:mm', {
                          locale: ja,
                        })}
                      </p>
                      {dispatch.expected_return_at && (
                        <p>
                          帰還予定:{' '}
                          {format(
                            dispatch.expected_return_at,
                            'yyyy/MM/dd HH:mm',
                            { locale: ja }
                          )}
                        </p>
                      )}
                      {dispatch.actual_return_at && (
                        <p>
                          実際の帰還:{' '}
                          {format(
                            dispatch.actual_return_at,
                            'yyyy/MM/dd HH:mm',
                            { locale: ja }
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {isActive && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    このログは現在派遣中です。緊急召還には{recallCost}{' '}
                    SPが必要です。
                    <Button
                      variant="destructive"
                      size="sm"
                      className="ml-4"
                      onClick={() => recallMutation.mutate()}
                      disabled={recallMutation.isPending}
                    >
                      緊急召還 ({recallCost} SP)
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            <TabsContent value="activity" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">活動ログ</CardTitle>
                </CardHeader>
                <CardContent>
                  {dispatch.travel_log.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">
                      まだ活動記録がありません
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {dispatch.travel_log.map((log: any, index: number) => (
                        <div
                          key={index}
                          className="flex gap-3 pb-3 border-b last:border-0"
                        >
                          <div className="flex-shrink-0">
                            <Clock className="h-4 w-4 text-muted-foreground mt-1" />
                          </div>
                          <div className="flex-1 space-y-1">
                            <p className="text-sm font-medium">{log.action}</p>
                            <p className="text-sm text-muted-foreground">
                              {log.result}
                            </p>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>{log.location}</span>
                              <span>
                                {format(log.timestamp, 'MM/dd HH:mm', {
                                  locale: ja,
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="encounters" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    遭遇記録
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dispatch.encounters.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">
                      遭遇記録はありません
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {dispatch.encounters.map((encounter: any) => (
                        <div
                          key={encounter.id}
                          className="p-3 rounded-lg border space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <p className="font-medium">
                              {encounter.encountered_npc_name ||
                                encounter.encountered_character_id}
                            </p>
                            <Badge
                              variant={
                                encounter.outcome === 'friendly'
                                  ? 'default'
                                  : encounter.outcome === 'hostile'
                                    ? 'destructive'
                                    : 'secondary'
                              }
                            >
                              {encounter.outcome}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {encounter.interaction_summary}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>{encounter.location}</span>
                            <span>
                              関係性変化:{' '}
                              {encounter.relationship_change > 0 ? '+' : ''}
                              {encounter.relationship_change.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="results" className="space-y-4">
              {dispatch.status !== 'COMPLETED' ? (
                <Alert>
                  <AlertDescription>
                    派遣が完了すると成果が表示されます
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Award className="h-5 w-5" />
                        派遣成果
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center p-3 rounded-lg bg-muted">
                          <Activity className="h-8 w-8 mx-auto mb-2 text-primary" />
                          <p className="text-2xl font-bold">
                            {(dispatch.achievement_score * 100).toFixed(0)}%
                          </p>
                          <p className="text-sm text-muted-foreground">
                            達成度
                          </p>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-muted">
                          <Coins className="h-8 w-8 mx-auto mb-2 text-green-600" />
                          <p className="text-2xl font-bold">
                            +{dispatch.sp_refund_amount}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            SP還元
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div className="flex items-center gap-2">
                          <Map className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            発見場所: {dispatch.discovered_locations.length}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            収集アイテム: {dispatch.collected_items.length}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {report && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">詳細報告書</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div>
                          <h4 className="font-medium mb-2">物語の要約</h4>
                          <p className="text-sm text-muted-foreground">
                            {report.narrative_summary}
                          </p>
                        </div>

                        {report.epilogue && (
                          <div>
                            <h4 className="font-medium mb-2">エピローグ</h4>
                            <p className="text-sm text-muted-foreground">
                              {report.epilogue}
                            </p>
                          </div>
                        )}

                        {report.personality_changes.length > 0 && (
                          <div>
                            <h4 className="font-medium mb-2">性格の変化</h4>
                            <ul className="list-disc list-inside text-sm text-muted-foreground">
                              {report.personality_changes.map(
                                (change: any, i: number) => (
                                  <li key={i}>{change}</li>
                                )
                              )}
                            </ul>
                          </div>
                        )}

                        {report.new_skills_learned.length > 0 && (
                          <div>
                            <h4 className="font-medium mb-2">習得スキル</h4>
                            <div className="flex flex-wrap gap-2">
                              {report.new_skills_learned.map(
                                (skill: any, i: number) => (
                                  <Badge key={i} variant="secondary">
                                    {skill}
                                  </Badge>
                                )
                              )}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
