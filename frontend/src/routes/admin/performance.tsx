import { createFileRoute } from '@tanstack/react-router'
import { PerformanceDashboard } from '@/features/admin/components/PerformanceDashboard'

export const Route = createFileRoute('/admin/performance')({
  component: PerformanceDashboard,
})
