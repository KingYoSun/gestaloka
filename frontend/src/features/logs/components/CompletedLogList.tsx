import { useState } from 'react'
import { CompletedLogRead } from '@/api/logs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DispatchForm } from '@/features/dispatch/components/DispatchForm'
import { CompletedLogDetail } from './CompletedLogDetail'
import {
  BookOpen,
  Sparkles,
  Send,
  User,
  AlertTriangle,
  Eye,
  Shield,
} from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface CompletedLogListProps {
  completedLogs: CompletedLogRead[]
  isLoading: boolean
}

const statusLabels: Record<string, string> = {
  draft: '編纂中',
  completed: '完成',
  contracted: '契約済',
  active: '活動中',
  expired: '期限切れ',
  recalled: '召還済',
}

const statusColors: Record<string, string> = {
  draft: 'secondary',
  completed: 'default',
  contracted: 'outline',
  active: 'default',
  expired: 'secondary',
  recalled: 'destructive',
}

export function CompletedLogList({
  completedLogs,
  isLoading,
}: CompletedLogListProps) {
  const [selectedLog, setSelectedLog] = useState<CompletedLogRead | null>(null)
  const [showDispatchForm, setShowDispatchForm] = useState(false)
  const [showDetailView, setShowDetailView] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (completedLogs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground mb-2">完成ログがありません</p>
          <p className="text-sm text-muted-foreground">
            フラグメントを選択して編纂してください
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="space-y-4">
        {completedLogs.map(log => {
          const isDispatchable = log.status === 'completed'
          const contaminationPercent = (log.contamination_level * 100).toFixed(0)

          return (
            <Card
              key={log.id}
              className={cn(
                'transition-colors',
                isDispatchable && 'hover:border-primary/50 cursor-pointer'
              )}
              onClick={() => {
                if (isDispatchable) {
                  setSelectedLog(log)
                }
              }}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    {log.name}
                    {log.title && (
                      <Badge variant="outline" className="ml-2">
                        {log.title}
                      </Badge>
                    )}
                  </CardTitle>
                  <Badge variant={statusColors[log.status] as any}>
                    {statusLabels[log.status]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {log.description}
                </p>

                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    <span>スキル: {log.skills?.length || 0}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>性格特性: {log.personality_traits?.length || 0}</span>
                  </div>
                  <div
                    className={cn(
                      'flex items-center gap-1',
                      Number(contaminationPercent) > 50 && 'text-red-600'
                    )}
                  >
                    <AlertTriangle className="h-4 w-4" />
                    <span>汚染度: {contaminationPercent}%</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(log.created_at)}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={e => {
                        e.stopPropagation()
                        setSelectedLog(log)
                        setShowDetailView(true)
                      }}
                    >
                      <Eye className="h-4 w-4" />
                      詳細
                    </Button>
                    {log.contamination_level > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={e => {
                          e.stopPropagation()
                          setSelectedLog(log)
                          setShowDetailView(true)
                        }}
                      >
                        <Shield className="h-4 w-4" />
                        浄化
                      </Button>
                    )}
                    {isDispatchable && (
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={e => {
                          e.stopPropagation()
                          setSelectedLog(log)
                          setShowDispatchForm(true)
                        }}
                      >
                        <Send className="h-4 w-4" />
                        派遣
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {selectedLog && showDispatchForm && (
        <DispatchForm
          completedLog={selectedLog}
          open={showDispatchForm}
          onOpenChange={open => {
            setShowDispatchForm(open)
            if (!open) {
              setSelectedLog(null)
            }
          }}
        />
      )}

      {selectedLog && showDetailView && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
          <div className="fixed inset-4 flex items-center justify-center">
            <CompletedLogDetail
              log={selectedLog}
              onClose={() => {
                setShowDetailView(false)
                setSelectedLog(null)
              }}
              onPurify={() => {
                // 浄化後の処理（必要に応じて実装）
                setShowDetailView(false)
                setSelectedLog(null)
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}
