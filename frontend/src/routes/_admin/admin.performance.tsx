import { createFileRoute } from '@tanstack/react-router'
import { PerformanceDashboard } from '@/features/admin/components/PerformanceDashboard'

export const Route = createFileRoute('/_admin/admin/performance')({
  component: PerformanceDashboard,
})