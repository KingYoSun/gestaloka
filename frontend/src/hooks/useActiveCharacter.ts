/**
 * アクティブなキャラクターを管理するフック
 */

import { useCharacterStore } from '@/stores/characterStore'
import { useCharacters } from './useCharacters'
import type { Character } from '@/api/generated/models'

export function useActiveCharacter() {
  const selectedCharacterId = useCharacterStore((state: any) => state.selectedCharacterId)
  const { data: characters = [], isLoading, error } = useCharacters()
  
  const activeCharacter = characters.find((char: Character) => char.id === selectedCharacterId) || characters[0]
  
  return {
    character: activeCharacter,
    activeCharacter,
    activeCharacterId: activeCharacter?.id,
    isLoading,
    error,
  }
}