import type { User, Character, CharacterStats, NarrativeResponse } from '@/api/generated/models'

export const createUser = (overrides?: Partial<User>): User => ({
  id: 'test-user-id',
  email: 'test@example.com',
  is_active: true,
  is_admin: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
})

export const createCharacterStats = (overrides?: Partial<CharacterStats>): CharacterStats => ({
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
  health: 100,
  max_health: 100,
  ...overrides,
})

export const createCharacter = (overrides?: Partial<Character>): Character => ({
  id: 'test-character-id',
  user_id: 'test-user-id',
  name: 'Test Character',
  stats: createCharacterStats(),
  titles: [],
  active_title_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
})

export const createNarrativeResponse = (overrides?: Partial<NarrativeResponse>): NarrativeResponse => ({
  narrative: 'Test narrative text',
  actions: [
    {
      action_id: 'action-1',
      description: 'Test action',
      effects: 'Test effects',
    },
  ],
  session_id: 'test-session-id',
  is_session_complete: false,
  location: 'Test Location',
  timestamp: new Date().toISOString(),
  ...overrides,
})