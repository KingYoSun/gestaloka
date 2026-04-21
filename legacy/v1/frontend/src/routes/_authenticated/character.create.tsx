import { createFileRoute } from '@tanstack/react-router'
import { CharacterCreatePage } from '@/features/character/CharacterCreatePage'

export const Route = createFileRoute('/_authenticated/character/create')({
  component: CharacterCreatePage,
})
