import { createFileRoute } from '@tanstack/react-router'
import { TitleManagementScreen } from '@/components/titles/TitleManagementScreen'

export const Route = createFileRoute('/_authenticated/titles')({
  component: TitleManagementScreen,
})