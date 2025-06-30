import { PerformanceMetric } from '../api/performanceApi'

interface MetricsChartProps {
  data: PerformanceMetric[]
}

export function MetricsChart({ data }: MetricsChartProps) {
  const maxTime = Math.max(...data.map(d => d.max_execution_time))

  return (
    <div className="space-y-4">
      {data.map((metric) => {
        const avgPercent = (metric.avg_execution_time / maxTime) * 100
        const minPercent = (metric.min_execution_time / maxTime) * 100
        const maxPercent = 100

        return (
          <div key={metric.agent_name} className="space-y-2">
            <div className="flex justify-between items-baseline">
              <div>
                <span className="font-medium">{metric.agent_name}</span>
                {metric.model_type && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({metric.model_type})
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {metric.total_calls}回呼び出し
              </div>
            </div>
            
            <div className="relative h-8 bg-secondary rounded">
              {/* Min-Max range */}
              <div 
                className="absolute h-full bg-primary/20 rounded"
                style={{
                  left: `${minPercent}%`,
                  width: `${maxPercent - minPercent}%`
                }}
              />
              
              {/* Average line */}
              <div 
                className="absolute h-full w-1 bg-primary rounded"
                style={{
                  left: `${avgPercent}%`
                }}
              />
              
              {/* Values */}
              <div className="absolute inset-0 flex items-center justify-between px-2 text-xs">
                <span>{metric.min_execution_time.toFixed(2)}s</span>
                <span className="font-medium">{metric.avg_execution_time.toFixed(2)}s</span>
                <span>{metric.max_execution_time.toFixed(2)}s</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}