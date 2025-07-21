import type { User, Character, CharacterStats, NarrativeResponse } from '@/api/generated/models'

export const createUser = (overrides?: Partial<User>): User => ({
  id: 'test-user-id',
  username: 'testuser',
  email: 'test@example.com',
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
})

export const createCharacterStats = (overrides?: Partial<CharacterStats>): CharacterStats => ({
  id: 'test-stats-id',
  character_id: 'test-character-id',
  level: 1,
  experience: 0,
  health: 100,
  max_health: 100,
  mp: 50,
  max_mp: 50,
  ...overrides,
})

export const createCharacter = (overrides?: Partial<Character>): Character => ({
  id: 'test-character-id',
  user_id: 'test-user-id',
  name: 'Test Character',
  stats: createCharacterStats(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
})

export const createNarrativeResponse = (overrides?: Partial<NarrativeResponse>): NarrativeResponse => ({
  narrative: 'Test narrative text',
  action_choices: [
    {
      text: 'Test action',
      action_type: 'test',
      description: 'Test action description',
    },
  ],
  location_changed: false,
  ...overrides,
})