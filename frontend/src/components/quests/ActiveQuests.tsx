import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Target,
  TrendingUp,
  Clock,
  AlertCircle,
  CheckCircle2,
  Activity
} from 'lucide-react';
import { useActiveQuests, useUpdateQuestProgress } from '@/hooks/useQuests';
import { useActiveCharacter } from '@/hooks/useActiveCharacter';
import type { Quest } from '@/types/quest';
import { QuestStatus, QuestStatusDisplay, QuestOriginDisplay } from '@/types/quest';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { ja } from 'date-fns/locale';

interface QuestCardProps {
  quest: Quest;
  onUpdateProgress: (questId: string) => void;
  isUpdating: boolean;
}

const QuestCard: React.FC<QuestCardProps> = ({
  quest,
  onUpdateProgress,
  isUpdating
}) => {
  const getStatusIcon = (status: QuestStatus) => {
    switch (status) {
      case QuestStatus.ACTIVE:
        return <Target className="h-4 w-4" />;
      case QuestStatus.PROGRESSING:
        return <TrendingUp className="h-4 w-4" />;
      case QuestStatus.NEAR_COMPLETION:
        return <AlertCircle className="h-4 w-4" />;
      case QuestStatus.COMPLETED:
        return <CheckCircle2 className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const getStatusVariant = (status: QuestStatus): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case QuestStatus.ACTIVE:
        return "default";
      case QuestStatus.PROGRESSING:
        return "secondary";
      case QuestStatus.NEAR_COMPLETION:
        return "destructive";
      default:
        return "outline";
    }
  };

  // const getProgressColor = (percentage: number) => {
  //   if (percentage >= 80) return "bg-green-500";
  //   if (percentage >= 50) return "bg-yellow-500";
  //   return "bg-blue-500";
  // };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <CardTitle className="text-lg">{quest.title}</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={getStatusVariant(quest.status)} className="flex items-center gap-1">
                {getStatusIcon(quest.status)}
                <span>{QuestStatusDisplay[quest.status]}</span>
              </Badge>
              <Badge variant="outline" className="text-xs">
                {QuestOriginDisplay[quest.origin]}
              </Badge>
              {quest.last_progress_at && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(quest.last_progress_at), {
                    addSuffix: true,
                    locale: ja
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CardDescription className="whitespace-pre-wrap">
          {quest.description}
        </CardDescription>

        {/* 進行状況 */}
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>進行度</span>
              <span className="font-medium">{quest.progress_percentage}%</span>
            </div>
            <Progress 
              value={quest.progress_percentage} 
              className="h-2"
            />
          </div>

          {quest.narrative_completeness > 0 && (
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>物語的完結度</span>
                <span className="font-medium">
                  {Math.round(quest.narrative_completeness * 100)}%
                </span>
              </div>
              <Progress 
                value={quest.narrative_completeness * 100} 
                className="h-1.5"
              />
            </div>
          )}

          {quest.emotional_satisfaction > 0 && (
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>感情的満足度</span>
                <span className="font-medium">
                  {Math.round(quest.emotional_satisfaction * 100)}%
                </span>
              </div>
              <Progress 
                value={quest.emotional_satisfaction * 100} 
                className="h-1.5"
              />
            </div>
          )}
        </div>

        {/* キーイベント */}
        {quest.key_events && quest.key_events.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">重要イベント</p>
            <ScrollArea className="h-20">
              <ul className="text-sm text-muted-foreground space-y-1">
                {quest.key_events.map((event, index) => (
                  <li key={index} className="flex items-start gap-1">
                    <span className="text-primary">•</span>
                    <span>{event}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        )}

        {/* 進行状況の更新ボタン */}
        {quest.status !== QuestStatus.COMPLETED && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onUpdateProgress(quest.id)}
            disabled={isUpdating}
            className="w-full"
          >
            進行状況を評価
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export const ActiveQuests: React.FC = () => {
  const { character } = useActiveCharacter();
  const { activeQuests, isLoading, error, refetch } = useActiveQuests(character?.id);
  const updateProgress = useUpdateQuestProgress(character?.id);

  const handleUpdateProgress = async (questId: string) => {
    try {
      const updatedQuest = await updateProgress.mutateAsync(questId);
      toast.success(`進行状況を更新しました - 進行度: ${updatedQuest.progress_percentage}%`);
    } catch (error) {
      toast.error('進行状況の更新に失敗しました');
    }
  };

  if (!character) {
    return (
      <Alert>
        <AlertDescription>
          キャラクターを選択してください
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          クエスト一覧の取得に失敗しました
        </AlertDescription>
      </Alert>
    );
  }

  if (activeQuests.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">
            現在進行中のクエストはありません
          </p>
          <p className="text-sm text-muted-foreground">
            クエスト提案から新しいクエストを受諾してください
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Target className="h-5 w-5" />
          進行中のクエスト ({activeQuests.length})
        </h3>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          更新
        </Button>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2">
        {activeQuests.map((quest) => (
          <QuestCard
            key={quest.id}
            quest={quest}
            onUpdateProgress={handleUpdateProgress}
            isUpdating={updateProgress.isPending}
          />
        ))}
      </div>
    </div>
  );
};