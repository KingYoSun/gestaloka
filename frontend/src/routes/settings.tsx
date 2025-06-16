import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { Layout } from '@/components/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'

export const Route = createFileRoute('/settings')({
  component: () => (
    <ProtectedRoute>
      <Layout>
        <SettingsPage />
      </Layout>
    </ProtectedRoute>
  ),
})