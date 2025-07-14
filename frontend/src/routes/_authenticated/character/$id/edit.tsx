import { createFileRoute } from '@tanstack/react-router'

import { CharacterEditPage } from '@/features/character/CharacterEditPage'

export const Route = createFileRoute('/_authenticated/character/$id/edit')({
  component: CharacterEditPage,
})
