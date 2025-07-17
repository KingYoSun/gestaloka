import type { Character, CharacterStats } from '@/api/generated/models'

export const mockCharacterStats: CharacterStats = {
  strength: 10,
  dexterity: 12,
  constitution: 8,
  intelligence: 15,
  wisdom: 13,
  charisma: 11,
  health: 100,
  max_health: 100,
}

export const mockCharacter: Character = {
  id: 'test-character-id',
  user_id: 'test-user-id',
  name: 'テストキャラクター',
  stats: mockCharacterStats,
  titles: [],
  active_title_id: null,
  created_at: '2025-07-17T00:00:00Z',
  updated_at: '2025-07-17T00:00:00Z',
}

export const mockCharacters: Character[] = [
  mockCharacter,
  {
    ...mockCharacter,
    id: 'test-character-id-2',
    name: 'セカンドキャラクター',
  },
  {
    ...mockCharacter,
    id: 'test-character-id-3',
    name: 'サードキャラクター',
  },
]