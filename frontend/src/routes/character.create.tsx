import { createFileRoute } from '@tanstack/react-router'
import { CharacterCreatePage } from '@/features/character/CharacterCreatePage'
import { Layout } from '@/components/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'

export const Route = createFileRoute('/character/create')({
  component: () => (
    <ProtectedRoute>
      <Layout>
        <CharacterCreatePage />
      </Layout>
    </ProtectedRoute>
  ),
})
