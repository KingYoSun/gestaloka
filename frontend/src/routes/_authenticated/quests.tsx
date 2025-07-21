import { createFileRoute } from '@tanstack/react-router'
import { ActiveQuests, QuestProposals, QuestHistory } from '@/components/quests'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/_authenticated/quests')({
  component: () => (
    <div className="container mx-auto px-4 py-6">
      <h1 className="text-3xl font-bold mb-6">クエスト</h1>
      <Tabs defaultValue="active" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="active">進行中</TabsTrigger>
          <TabsTrigger value="proposals">提案</TabsTrigger>
          <TabsTrigger value="history">履歴</TabsTrigger>
        </TabsList>
        <TabsContent value="active">
          <ActiveQuests />
        </TabsContent>
        <TabsContent value="proposals">
          <QuestProposals />
        </TabsContent>
        <TabsContent value="history">
          <QuestHistory />
        </TabsContent>
      </Tabs>
    </div>
  ),
})
