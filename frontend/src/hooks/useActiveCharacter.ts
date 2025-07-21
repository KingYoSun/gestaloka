/**
 * アクティブなキャラクターを管理するフック
 */

import { useCharacterStore } from '@/store/characterStore'
import { useCharacters } from './useCharacters'

export function useActiveCharacter() {
  const selectedCharacterId = useCharacterStore(state => state.selectedCharacterId)
  const { characters, isLoading, error } = useCharacters()
  
  const activeCharacter = characters.find(char => char.id === selectedCharacterId) || characters[0]
  
  return {
    character: activeCharacter,
    activeCharacter,
    activeCharacterId: activeCharacter?.id,
    isLoading,
    error,
  }
}