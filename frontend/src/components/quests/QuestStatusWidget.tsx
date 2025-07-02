import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Target, ChevronRight } from 'lucide-react';
import { useActiveQuests } from '@/hooks/useQuests';
import { useActiveCharacter } from '@/hooks/useActiveCharacter';
import { Link } from '@tanstack/react-router';
import type { Quest } from '@/types/quest';
import { Skeleton } from '@/components/ui/skeleton';

interface QuestStatusWidgetProps {
  compact?: boolean;
}

export const QuestStatusWidget: React.FC<QuestStatusWidgetProps> = ({ compact = false }) => {
  const { character } = useActiveCharacter();
  const { activeQuests, isLoading } = useActiveQuests(character?.id);

  if (!character || isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16" />
        </CardContent>
      </Card>
    );
  }

  const primaryQuest = activeQuests[0]; // 最も進行中のクエストを表示

  if (!primaryQuest) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4" />
            クエスト
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">
            進行中のクエストはありません
          </p>
          <Link to="/quests">
            <Button size="sm" variant="outline" className="w-full">
              クエストを確認
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4" />
              クエスト
            </CardTitle>
            <Badge variant="secondary" className="text-xs">
              {activeQuests.length}件
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-sm font-medium line-clamp-1">{primaryQuest.title}</p>
            <Progress value={primaryQuest.progress_percentage} className="h-1.5" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                進行度: {primaryQuest.progress_percentage}%
              </span>
              <Link to="/quests">
                <Button size="sm" variant="ghost" className="h-6 px-2">
                  詳細
                  <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            進行中のクエスト
          </CardTitle>
          <Badge>{activeQuests.length}件</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeQuests.slice(0, 2).map((quest: Quest) => (
          <div key={quest.id} className="space-y-2 pb-3 border-b last:border-0 last:pb-0">
            <h4 className="font-medium text-sm">{quest.title}</h4>
            <Progress value={quest.progress_percentage} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>進行度: {quest.progress_percentage}%</span>
              {quest.narrative_completeness > 0 && (
                <span>物語: {Math.round(quest.narrative_completeness * 100)}%</span>
              )}
            </div>
          </div>
        ))}
        
        <Link to="/quests" className="block">
          <Button variant="outline" size="sm" className="w-full">
            すべてのクエストを見る
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
};