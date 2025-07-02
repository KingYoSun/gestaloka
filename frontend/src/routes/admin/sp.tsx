import { createFileRoute } from '@tanstack/react-router'
import { SPManagement } from '@/features/admin/SPManagement'

export const Route = createFileRoute('/admin/sp')({
  component: SPManagement,
})
