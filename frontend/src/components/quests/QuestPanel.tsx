import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, Target, History, Brain } from 'lucide-react';
import { QuestProposals } from './QuestProposals';
import { ActiveQuests } from './ActiveQuests';
import { QuestHistory } from './QuestHistory';
import { QuestDeclaration } from './QuestDeclaration';
import { useActiveCharacter } from '@/hooks/useActiveCharacter';
import { useActiveQuests, useInferImplicitQuest } from '@/hooks/useQuests';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const QuestPanel: React.FC = () => {
  const { character } = useActiveCharacter();
  const { activeQuests } = useActiveQuests(character?.id);
  const inferQuest = useInferImplicitQuest(character?.id);
  const [activeTab, setActiveTab] = useState('active');

  // 暗黙的クエストの推測を定期的に実行
  useEffect(() => {
    if (!character?.id) return;

    const inferImplicitQuestPeriodically = async () => {
      try {
        const quest = await inferQuest.mutateAsync();
        if (quest) {
          toast.success(`新しいクエストが推測されました - 「${quest.title}」`);
        }
      } catch (error) {
        // エラーは静かに処理
        console.error('Failed to infer implicit quest:', error);
      }
    };

    // 初回実行
    inferImplicitQuestPeriodically();

    // 5分ごとに実行
    const interval = setInterval(inferImplicitQuestPeriodically, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [character?.id]);

  if (!character) {
    return (
      <Alert>
        <AlertDescription>
          キャラクターを選択してクエストを管理してください
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4">
        <h2 className="text-2xl font-bold mb-2">クエスト管理</h2>
        <p className="text-muted-foreground">
          物語の目標を設定し、進行状況を確認できます
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="active" className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            <span>進行中</span>
            {activeQuests.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1">
                {activeQuests.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="proposals" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <span>提案</span>
          </TabsTrigger>
          <TabsTrigger value="declare" className="flex items-center gap-2">
            <Brain className="h-4 w-4" />
            <span>宣言</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            <span>履歴</span>
          </TabsTrigger>
        </TabsList>

        <div className="mt-4 flex-1 overflow-auto">
          <TabsContent value="active" className="mt-0">
            <ActiveQuests />
          </TabsContent>
          
          <TabsContent value="proposals" className="mt-0">
            <QuestProposals />
          </TabsContent>
          
          <TabsContent value="declare" className="mt-0">
            <QuestDeclaration />
          </TabsContent>
          
          <TabsContent value="history" className="mt-0">
            <QuestHistory />
          </TabsContent>
        </div>
      </Tabs>

      {/* 暗黙的クエスト推測ボタン */}
      <div className="mt-4 border-t pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              const quest = await inferQuest.mutateAsync();
              if (quest) {
                toast.success(`新しいクエストが推測されました - 「${quest.title}」`);
              } else {
                toast.info('現在の行動パターンからは新しいクエストを推測できませんでした');
              }
            } catch (error) {
              toast.error('クエストの推測に失敗しました');
            }
          }}
          disabled={inferQuest.isPending}
          className="w-full"
        >
          <Brain className="h-4 w-4 mr-2" />
          行動からクエストを推測
        </Button>
      </div>
    </div>
  );
};