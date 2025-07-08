import { createFileRoute } from '@tanstack/react-router'
import { CharacterDetailPage } from '@/features/character/CharacterDetailPage'

export const Route = createFileRoute('/_authenticated/character/$id/')({
  component: CharacterDetailPage,
})
