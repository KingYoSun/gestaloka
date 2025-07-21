import React from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  CheckCircle2,
  XCircle,
  Calendar,
  Clock,
  Award,
  Heart,
  BookOpen,
} from 'lucide-react'
import { useQuests } from '@/hooks/useQuests'
import { useActiveCharacter } from '@/hooks/useActiveCharacter'
import type { Quest } from '@/types/quest'
import { QuestStatus, QuestOriginDisplay } from '@/types/quest'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { formatRelativeTime } from '@/lib/utils'

interface QuestHistoryItemProps {
  quest: Quest
}

const QuestHistoryItem: React.FC<QuestHistoryItemProps> = ({ quest }) => {
  const isCompleted = quest.status === QuestStatus.COMPLETED
  const StatusIcon = isCompleted ? CheckCircle2 : XCircle

  const getDuration = () => {
    if (!quest.started_at || !quest.completed_at) return null
    const start = new Date(quest.started_at)
    return formatRelativeTime(start).replace(/前$/, '')
  }

  return (
    <div className="space-y-3 pb-4">
      <div className="flex items-start gap-3">
        <StatusIcon
          className={`h-5 w-5 mt-0.5 ${
            isCompleted ? 'text-green-500' : 'text-red-500'
          }`}
        />
        <div className="flex-1 space-y-2">
          <div>
            <h4 className="font-medium">{quest.title}</h4>
            <p className="text-sm text-muted-foreground mt-1">
              {quest.description}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Badge variant="outline" className="text-xs">
              {QuestOriginDisplay[quest.origin]}
            </Badge>

            {quest.completed_at && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Calendar className="h-3 w-3" />
                {format(quest.completed_at, 'yyyy/MM/dd', {
                  locale: ja,
                })}
              </span>
            )}

            {getDuration() && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />
                {getDuration()}で完了
              </span>
            )}
          </div>

          {/* 完了時の評価 */}
          {isCompleted && (
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1">
                <Award className="h-3.5 w-3.5 text-yellow-500" />
                <span>達成度: {quest.progress_percentage}%</span>
              </div>
              {quest.narrative_completeness > 0 && (
                <div className="flex items-center gap-1">
                  <BookOpen className="h-3.5 w-3.5 text-blue-500" />
                  <span>
                    物語: {Math.round(quest.narrative_completeness * 100)}%
                  </span>
                </div>
              )}
              {quest.emotional_satisfaction > 0 && (
                <div className="flex items-center gap-1">
                  <Heart className="h-3.5 w-3.5 text-red-500" />
                  <span>
                    満足度: {Math.round(quest.emotional_satisfaction * 100)}%
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 感情的な流れ */}
          {quest.emotional_arc && (
            <div className="bg-muted/50 rounded p-2 text-xs">
              <span className="font-medium">感情の流れ: </span>
              <span className="text-muted-foreground">
                {quest.emotional_arc}
              </span>
            </div>
          )}
        </div>
      </div>
      <Separator />
    </div>
  )
}

export const QuestHistory: React.FC = () => {
  const { character } = useActiveCharacter()
  const { quests, isLoading, error } = useQuests(character?.id)

  const completedQuests = quests
    .filter(
      (quest: Quest) =>
        quest.status === QuestStatus.COMPLETED ||
        quest.status === QuestStatus.FAILED ||
        quest.status === QuestStatus.ABANDONED
    )
    .sort((a: Quest, b: Quest) => {
      const dateA = new Date(a.completed_at || a.updated_at || a.created_at)
      const dateB = new Date(b.completed_at || b.updated_at || b.created_at)
      return dateB.getTime() - dateA.getTime()
    })

  if (!character) {
    return (
      <Alert>
        <AlertDescription>キャラクターを選択してください</AlertDescription>
      </Alert>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>クエスト履歴の取得に失敗しました</AlertDescription>
      </Alert>
    )
  }

  if (completedQuests.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            まだ完了したクエストはありません
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5" />
          クエスト履歴
        </CardTitle>
        <CardDescription>完了・失敗・放棄したクエストの記録</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-1">
            {completedQuests.map((quest: Quest) => (
              <QuestHistoryItem key={quest.id} quest={quest} />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
