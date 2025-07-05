import { createFileRoute } from '@tanstack/react-router'
import { SPManagement } from '@/features/admin/SPManagement'

export const Route = createFileRoute('/_admin/admin/sp')({
  component: SPManagement,
})