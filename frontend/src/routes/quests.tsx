import { createFileRoute } from '@tanstack/react-router'
import { Layout } from '@/components/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { QuestPanel } from '@/components/quests'

export const Route = createFileRoute('/quests')({
  component: () => (
    <ProtectedRoute>
      <Layout>
        <div className="container mx-auto px-4 py-6">
          <QuestPanel />
        </div>
      </Layout>
    </ProtectedRoute>
  ),
})