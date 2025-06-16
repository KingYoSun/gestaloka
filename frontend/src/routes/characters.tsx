import { createFileRoute } from '@tanstack/react-router'
import { CharacterListPage } from '@/features/character/CharacterListPage'

export const Route = createFileRoute('/characters')({
  component: CharacterListPage,
})