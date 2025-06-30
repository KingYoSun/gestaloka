import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { performanceApi } from '../api/performanceApi'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

export function RealtimeMonitor() {
  const { data, isLoading } = useQuery({
    queryKey: ['realtime-metrics'],
    queryFn: performanceApi.getRealtimeMetrics,
    refetchInterval: 5000 // Refresh every 5 seconds
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>リアルタイムモニター</CardTitle>
          <CardDescription>
            直近5分間のAI実行状況
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            読み込み中...
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!data || data.metrics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>リアルタイムモニター</CardTitle>
          <CardDescription>
            直近5分間のAI実行状況
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            データがありません
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>リアルタイムモニター</CardTitle>
        <CardDescription>
          直近5分間のAI実行状況 ({data.count}件)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 max-h-[600px] overflow-y-auto">
          {data.metrics.map((metric, index) => (
            <div key={`${metric.session_id}-${index}`} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="outline">{metric.action_type}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(metric.timestamp), { 
                      addSuffix: true, 
                      locale: ja 
                    })}
                  </span>
                </div>
                <div className="text-lg font-medium">
                  {metric.total_time.toFixed(2)}s
                </div>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(metric.agents).map(([agent, data]) => (
                  <div key={agent} className="bg-secondary/50 rounded px-3 py-2">
                    <div className="text-xs text-muted-foreground">{agent}</div>
                    <div className="font-medium">
                      {data.execution_time.toFixed(2)}s
                    </div>
                    {data.model_type && (
                      <div className="text-xs text-muted-foreground">
                        {data.model_type}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}