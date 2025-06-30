import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Activity, 
  Clock, 
  Zap, 
  TrendingUp,
  Loader2,
  Play,
  RefreshCw
} from 'lucide-react'
import { performanceApi } from '../api/performanceApi'
import { MetricsChart } from './MetricsChart'
import { RealtimeMonitor } from './RealtimeMonitor'

export function PerformanceDashboard() {
  const [timeRange, setTimeRange] = useState('24')
  const [testConfig, setTestConfig] = useState({
    action_type: 'explore',
    test_content: '周囲を探索する',
    iterations: 3
  })

  // Fetch performance stats
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['performance-stats', timeRange],
    queryFn: () => performanceApi.getStats(parseInt(timeRange)),
    refetchInterval: 30000 // Refresh every 30 seconds
  })

  // Run performance test mutation
  const testMutation = useMutation({
    mutationFn: performanceApi.runTest,
    onSuccess: () => {
      refetchStats()
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">AIパフォーマンス監視</h1>
          <p className="text-muted-foreground mt-1">
            AI エージェントの応答時間とパフォーマンスメトリクスを監視
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1時間</SelectItem>
              <SelectItem value="6">6時間</SelectItem>
              <SelectItem value="24">24時間</SelectItem>
              <SelectItem value="168">1週間</SelectItem>
            </SelectContent>
          </Select>
          
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetchStats()}
            disabled={statsLoading}
          >
            <RefreshCw className={`w-4 h-4 ${statsLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              総アクション数
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.total_actions.toLocaleString() || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              過去{timeRange}時間
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              平均応答時間
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.avg_response_time.toFixed(2) || 0}s
            </div>
            <p className="text-xs text-muted-foreground">
              全エージェント合計
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              アクティブエージェント
            </CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.metrics_by_agent.length || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              稼働中のAIエージェント
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              最速エージェント
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.metrics_by_agent.sort((a, b) => 
                a.avg_execution_time - b.avg_execution_time
              )[0]?.agent_name || '-'}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.metrics_by_agent.sort((a, b) => 
                a.avg_execution_time - b.avg_execution_time
              )[0]?.avg_execution_time.toFixed(2) || 0}s 平均
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">概要</TabsTrigger>
          <TabsTrigger value="realtime">リアルタイム</TabsTrigger>
          <TabsTrigger value="test">パフォーマンステスト</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Agent Performance Chart */}
          <Card>
            <CardHeader>
              <CardTitle>エージェント別パフォーマンス</CardTitle>
              <CardDescription>
                各AIエージェントの実行時間統計
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stats && <MetricsChart data={stats.metrics_by_agent} />}
            </CardContent>
          </Card>

          {/* Action Type Performance */}
          <Card>
            <CardHeader>
              <CardTitle>アクションタイプ別パフォーマンス</CardTitle>
              <CardDescription>
                アクションの種類ごとの応答時間
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stats && Object.entries(stats.metrics_by_action_type).map(([action, metrics]) => (
                  <div key={action} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="font-medium">{action}</p>
                      <p className="text-sm text-muted-foreground">
                        {metrics.count}回実行
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{metrics.avg_time.toFixed(2)}s</p>
                      <p className="text-xs text-muted-foreground">
                        {metrics.min_time.toFixed(2)}s - {metrics.max_time.toFixed(2)}s
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="realtime">
          <RealtimeMonitor />
        </TabsContent>

        <TabsContent value="test" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>パフォーマンステスト</CardTitle>
              <CardDescription>
                指定したアクションで負荷テストを実行
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>アクションタイプ</Label>
                  <Select 
                    value={testConfig.action_type} 
                    onValueChange={(value) => setTestConfig({...testConfig, action_type: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="explore">探索</SelectItem>
                      <SelectItem value="move">移動</SelectItem>
                      <SelectItem value="battle">戦闘</SelectItem>
                      <SelectItem value="talk">会話</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label>テスト内容</Label>
                  <Input
                    value={testConfig.test_content}
                    onChange={(e) => setTestConfig({...testConfig, test_content: e.target.value})}
                    placeholder="アクションの内容"
                  />
                </div>
                
                <div>
                  <Label>反復回数</Label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={testConfig.iterations}
                    onChange={(e) => setTestConfig({...testConfig, iterations: parseInt(e.target.value) || 1})}
                  />
                </div>
              </div>

              <Button 
                onClick={() => testMutation.mutate(testConfig)}
                disabled={testMutation.isPending}
              >
                {testMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    テスト実行中...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    テスト実行
                  </>
                )}
              </Button>

              {testMutation.data && (
                <Alert>
                  <AlertDescription>
                    <div className="space-y-2">
                      <p className="font-medium">テスト完了: {testMutation.data.test_id}</p>
                      <p>総実行時間: {testMutation.data.total_duration.toFixed(2)}秒</p>
                      <div className="mt-4">
                        <p className="text-sm font-medium mb-2">エージェント別結果:</p>
                        {Object.entries(testMutation.data.summary).map(([agent, metric]) => (
                          <div key={agent} className="flex justify-between text-sm">
                            <span>{agent}:</span>
                            <span>{metric.avg_execution_time.toFixed(2)}s (平均)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}