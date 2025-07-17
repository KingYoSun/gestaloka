import type { Character, CharacterStats } from '@/api/generated/models'

export const mockCharacterStats: CharacterStats = {
  id: 'test-stats-id',
  character_id: 'test-character-id',
  level: 1,
  experience: 0,
  health: 100,
  max_health: 100,
  mp: 50,
  max_mp: 50,
}

export const mockCharacter: Character = {
  id: 'test-character-id',
  user_id: 'test-user-id',
  name: 'テストキャラクター',
  stats: mockCharacterStats,
  skills: [],
  is_active: false,
  created_at: new Date('2025-07-17T00:00:00Z'),
  updated_at: new Date('2025-07-17T00:00:00Z'),
  last_played_at: null,
  location: '開始の村',
  description: 'テスト用のキャラクターです',
  appearance: null,
  personality: null,
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