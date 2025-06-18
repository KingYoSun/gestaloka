import { createFileRoute } from '@tanstack/react-router'
import { LogsPage } from '@/features/logs/LogsPage'
import { Layout } from '@/components/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'

export const Route = createFileRoute('/logs')({
  component: () => (
    <ProtectedRoute>
      <Layout>
        <LogsPage />
      </Layout>
    </ProtectedRoute>
  ),
})
