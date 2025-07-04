import { createFileRoute } from '@tanstack/react-router'
import { LogFragments } from '@/pages/LogFragments'

export const Route = createFileRoute('/log-fragments' as any)({
  component: LogFragments,
})
