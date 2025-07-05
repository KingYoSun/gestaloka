import { createFileRoute } from '@tanstack/react-router'
import { LogsPage } from '@/features/logs/LogsPage'

export const Route = createFileRoute('/_authenticated/logs')({
  component: LogsPage,
})