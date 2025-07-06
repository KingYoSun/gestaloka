import { createFileRoute } from '@tanstack/react-router'
import { QuestPanel } from '@/components/quests'

export const Route = createFileRoute('/_authenticated/quests')({
  component: () => (
    <div className="container mx-auto px-4 py-6">
      <QuestPanel />
    </div>
  ),
})
