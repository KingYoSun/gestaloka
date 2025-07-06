import { useState } from 'react'
import { CompletedLog } from '@/types/log'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Shield, Sparkles, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PurificationDialog } from './PurificationDialog'
import { usePurificationItems } from '../hooks/usePurificationItems'

interface CompletedLogDetailProps {
  log: CompletedLog
  onClose: () => void
  onPurify?: (logId: string) => void
}

export function CompletedLogDetail({
  log,
  onClose,
  onPurify,
}: CompletedLogDetailProps) {
  const [showPurificationDialog, setShowPurificationDialog] = useState(false)
  const { data: purificationItems = [] } = usePurificationItems(log.creatorId)

  const handlePurification = () => {
    if (onPurify) {
      onPurify(log.id)
    }
    setShowPurificationDialog(false)
  }

  // 汚染度による状態の判定
  const getContaminationStatus = (level: number) => {
    if (level > 0.7)
      return {
        label: '高度汚染',
        color: 'text-red-600',
        variant: 'destructive' as const,
      }
    if (level > 0.5)
      return {
        label: '中度汚染',
        color: 'text-yellow-600',
        variant: 'outline' as const,
      }
    if (level > 0.3)
      return {
        label: '軽度汚染',
        color: 'text-orange-600',
        variant: 'default' as const,
      }
    return {
      label: '清浄',
      color: 'text-green-600',
      variant: 'default' as const,
    }
  }

  const contaminationStatus = getContaminationStatus(log.contaminationLevel)

  return (
    <>
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{log.name}</CardTitle>
              {log.title && (
                <p className="text-lg text-muted-foreground mt-1">
                  {log.title}
                </p>
              )}
            </div>
            <Button variant="ghost" onClick={onClose}>
              ✕
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 説明 */}
          <div>
            <h3 className="font-semibold mb-2">説明</h3>
            <p className="text-muted-foreground">{log.description}</p>
          </div>

          <Separator />

          {/* 汚染度 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold flex items-center gap-2">
                汚染度
                {log.contaminationLevel > 0.5 && (
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                )}
              </h3>
              <Badge variant={contaminationStatus.variant}>
                {contaminationStatus.label}
              </Badge>
            </div>
            <Progress
              value={log.contaminationLevel * 100}
              className={cn(
                'h-3',
                log.contaminationLevel > 0.7 && '[&>div]:bg-red-500',
                log.contaminationLevel > 0.5 &&
                  log.contaminationLevel <= 0.7 &&
                  '[&>div]:bg-yellow-500',
                log.contaminationLevel <= 0.5 && '[&>div]:bg-green-500'
              )}
            />
            <p className="text-sm text-muted-foreground mt-1">
              {Math.round(log.contaminationLevel * 100)}%
            </p>
          </div>

          {/* 浄化ボタン */}
          {log.contaminationLevel > 0 && purificationItems.length > 0 && (
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertTitle>浄化可能</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  浄化アイテムを使用してこのログの汚染を取り除くことができます。
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowPurificationDialog(true)}
                  className="mt-2"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  浄化する
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          {/* スキル */}
          {log.skills && log.skills.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">スキル</h3>
              <div className="flex flex-wrap gap-2">
                {log.skills.map((skill, i) => (
                  <Badge key={i} variant="secondary">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* 性格特性 */}
          {log.personalityTraits && log.personalityTraits.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">性格特性</h3>
              <div className="flex flex-wrap gap-2">
                {log.personalityTraits.map((trait, i) => (
                  <Badge key={i} variant="outline">
                    {trait}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* ステータス */}
          <div>
            <h3 className="font-semibold mb-2">ステータス</h3>
            <Badge variant={log.status === 'active' ? 'default' : 'secondary'}>
              {log.status}
            </Badge>
          </div>

          {/* 作成日時 */}
          <div className="text-sm text-muted-foreground">
            作成日時: {new Date(log.createdAt).toLocaleString('ja-JP')}
          </div>
        </CardContent>
      </Card>

      {/* 浄化ダイアログ */}
      {showPurificationDialog && (
        <PurificationDialog
          log={log}
          purificationItems={purificationItems}
          onPurify={handlePurification}
          onClose={() => setShowPurificationDialog(false)}
        />
      )}
    </>
  )
}
