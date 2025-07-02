import { useCharacterStore } from '@/stores/characterStore';

export function useActiveCharacter() {
  const activeCharacterId = useCharacterStore(state => state.activeCharacterId);
  const getActiveCharacter = useCharacterStore(state => state.getActiveCharacter);
  const setActiveCharacter = useCharacterStore(state => state.setActiveCharacter);
  
  const character = getActiveCharacter();
  
  return {
    character,
    characterId: activeCharacterId,
    setActiveCharacter,
    isActive: !!activeCharacterId,
  };
}