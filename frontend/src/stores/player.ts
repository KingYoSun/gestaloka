/**
 * プレイヤー状態管理ストア（characterStoreのエイリアス）
 */

export { 
  useCharacterStore as usePlayerStore,
  useActiveCharacter,
  useSelectedCharacter
} from './characterStore';

// 互換性のためのエイリアス
import { useCharacterStore } from './characterStore';

export const usePlayer = () => {
  const activeCharacter = useCharacterStore(state => state.getActiveCharacter());
  const setActiveCharacter = useCharacterStore(state => state.setActiveCharacter);
  return {
    activeCharacter,
    setActiveCharacter
  };
};