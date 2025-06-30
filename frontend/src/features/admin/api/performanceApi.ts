import { apiClient } from '@/api/client'

export interface PerformanceMetric {
  agent_name: string
  avg_execution_time: number
  min_execution_time: number
  max_execution_time: number
  total_calls: number
  model_type?: string | null
}

export interface PerformanceStats {
  period_start: string
  period_end: string
  total_actions: number
  avg_response_time: number
  metrics_by_agent: PerformanceMetric[]
  metrics_by_action_type: Record<string, {
    avg_time: number
    min_time: number
    max_time: number
    count: number
  }>
}

export interface PerformanceTestRequest {
  action_type: string
  test_content: string
  iterations: number
}

export interface PerformanceTestResult {
  test_id: string
  started_at: string
  completed_at: string
  total_duration: number
  iterations: number
  results: Array<{
    iteration: number
    duration: number
    performance_data?: any
    success: boolean
    error?: string
  }>
  summary: Record<string, PerformanceMetric>
}

export interface RealtimeMetric {
  timestamp: string
  session_id: string
  action_type: string
  total_time: number
  agents: Record<string, {
    execution_time: number
    model_type?: string
  }>
}

export const performanceApi = {
  async getStats(hours: number = 24): Promise<PerformanceStats> {
    return await apiClient.get<PerformanceStats>(`/admin/performance/stats?hours=${hours}`)
  },

  async runTest(request: PerformanceTestRequest): Promise<PerformanceTestResult> {
    return await apiClient.post<PerformanceTestResult>('/admin/performance/test', request)
  },

  async getRealtimeMetrics(): Promise<{
    metrics: RealtimeMetric[]
    count: number
    period_start: string
    period_end: string
  }> {
    return await apiClient.get<{
      metrics: RealtimeMetric[]
      count: number
      period_start: string
      period_end: string
    }>('/admin/performance/realtime')
  }
}