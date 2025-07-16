/**
 * キャラクター状態管理ストア
 */
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { Character } from '@/api/generated'

interface CharacterState {
  // 状態
  characters: Character[]
  activeCharacterId: string | null
  selectedCharacterId: string | null
  isLoading: boolean
  error: string | null

  // アクション
  setCharacters: (characters: Character[]) => void
  addCharacter: (character: Character) => void
  updateCharacter: (id: string, updates: Partial<Character>) => void
  removeCharacter: (id: string) => void
  setActiveCharacter: (id: string | null) => void
  setSelectedCharacter: (id: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void

  // セレクター（計算済み値）
  getActiveCharacter: () => Character | null
  getSelectedCharacter: () => Character | null
  getCharacterById: (id: string) => Character | null
  getCharacterCount: () => number
  canCreateNewCharacter: () => boolean
}

export const useCharacterStore = create<CharacterState>()(
  devtools(
    persist(
      (set, get) => ({
        // 初期状態
        characters: [],
        activeCharacterId: null,
        selectedCharacterId: null,
        isLoading: false,
        error: null,

        // アクション
        setCharacters: characters =>
          set({ characters }, false, 'setCharacters'),

        addCharacter: character =>
          set(
            state => ({
              characters: [...state.characters, character],
            }),
            false,
            'addCharacter'
          ),

        updateCharacter: (id, updates) =>
          set(
            state => ({
              characters: state.characters.map(char =>
                char.id === id ? { ...char, ...updates } : char
              ),
            }),
            false,
            'updateCharacter'
          ),

        removeCharacter: id =>
          set(
            state => ({
              characters: state.characters.filter(char => char.id !== id),
              // 削除されたキャラクターがアクティブまたは選択されていた場合はクリア
              activeCharacterId:
                state.activeCharacterId === id ? null : state.activeCharacterId,
              selectedCharacterId:
                state.selectedCharacterId === id
                  ? null
                  : state.selectedCharacterId,
            }),
            false,
            'removeCharacter'
          ),

        setActiveCharacter: id =>
          set({ activeCharacterId: id }, false, 'setActiveCharacter'),

        setSelectedCharacter: id =>
          set({ selectedCharacterId: id }, false, 'setSelectedCharacter'),

        setLoading: loading => set({ isLoading: loading }, false, 'setLoading'),

        setError: error => set({ error }, false, 'setError'),

        clearError: () => set({ error: null }, false, 'clearError'),

        // セレクター
        getActiveCharacter: () => {
          const { characters, activeCharacterId } = get()
          return activeCharacterId
            ? characters.find(char => char.id === activeCharacterId) || null
            : null
        },

        getSelectedCharacter: () => {
          const { characters, selectedCharacterId } = get()
          return selectedCharacterId
            ? characters.find(char => char.id === selectedCharacterId) || null
            : null
        },

        getCharacterById: id => {
          const { characters } = get()
          return characters.find(char => char.id === id) || null
        },

        getCharacterCount: () => {
          const { characters } = get()
          return characters.length
        },

        canCreateNewCharacter: () => {
          const { characters } = get()
          return characters.length < 5 // 最大5体まで
        },
      }),
      {
        name: 'character-store',
        // 永続化から除外する項目（一時的な状態）
        partialize: state => ({
          activeCharacterId: state.activeCharacterId,
          selectedCharacterId: state.selectedCharacterId,
          // charactersは除外（APIから取得するため）
        }),
      }
    ),
    {
      name: 'character-store',
    }
  )
)

// カスタムフック - アクティブキャラクター
export const useActiveCharacter = () => {
  const activeCharacter = useCharacterStore(state => state.getActiveCharacter())
  const setActiveCharacter = useCharacterStore(
    state => state.setActiveCharacter
  )
  return { activeCharacter, setActiveCharacter }
}

// カスタムフック - 選択されたキャラクター
export const useSelectedCharacter = () => {
  const selectedCharacter = useCharacterStore(state =>
    state.getSelectedCharacter()
  )
  const setSelectedCharacter = useCharacterStore(
    state => state.setSelectedCharacter
  )
  return { selectedCharacter, setSelectedCharacter }
}

// カスタムフック - キャラクター作成可能性
export const useCanCreateCharacter = () => {
  return useCharacterStore(state => state.canCreateNewCharacter())
}

// カスタムフック - キャラクター統計
export const useCharacterStats = () => {
  const count = useCharacterStore(state => state.getCharacterCount())
  const canCreate = useCharacterStore(state => state.canCreateNewCharacter())
  return { count, canCreate }
}
