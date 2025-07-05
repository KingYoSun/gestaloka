import { createFileRoute } from '@tanstack/react-router'
import { CharacterListPage } from '@/features/character/CharacterListPage'

export const Route = createFileRoute('/_authenticated/characters')({
  component: CharacterListPage,
})