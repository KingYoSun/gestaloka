/**
 * Auto-generated API types
 * This is a temporary placeholder for API types
 */

// Location types
export enum LocationType {
  CITY = 'city',
  TOWN = 'town',
  DUNGEON = 'dungeon',
  WILD = 'wild',
  SPECIAL = 'special',
}

export enum DangerLevel {
  SAFE = 'safe',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  EXTREME = 'extreme',
}

export interface LocationResponse {
  id: number
  name: string
  description: string
  location_type: LocationType
  hierarchy_level: number
  danger_level: DangerLevel
  x_coordinate: number
  y_coordinate: number
  has_inn: boolean
  has_shop: boolean
  has_guild: boolean
  fragment_discovery_rate: number
  is_discovered: boolean
}

export interface LocationConnectionResponse {
  connection_id: number
  to_location: LocationResponse
  sp_cost: number
  distance: number
  min_level_required: number
  travel_description?: string
}

export interface AvailableLocationsResponse {
  current_location: LocationResponse
  available_locations: LocationConnectionResponse[]
}

export interface MoveRequest {
  connection_id: number
}

export interface MoveResponse {
  success: boolean
  new_location: LocationResponse
  sp_consumed: number
  remaining_sp: number
  travel_narrative: string
}

export interface ExplorationAreaResponse {
  id: number
  name: string
  description: string
  difficulty: number
  exploration_sp_cost: number
  max_fragments_per_exploration: number
  rare_fragment_chance: number
  encounter_rate: number
}

export interface ExploreRequest {
  area_id: number
}

export interface ExploreResponse {
  success: boolean
  fragments_found: Array<{
    keyword: string
    rarity: string
    description: string
  }>
  encounters: number
  sp_consumed: number
  remaining_sp: number
  narrative: string
}

// SP types are imported from types/sp.ts to avoid duplication
export type { PlayerSP, PlayerSPSummary, SPTransaction } from '@/types/sp'

// Log Fragment enums
export enum LogFragmentRarity {
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
  EPIC = 'epic',
  LEGENDARY = 'legendary',
}

export enum EmotionalValence {
  POSITIVE = 'positive',
  NEGATIVE = 'negative',
  NEUTRAL = 'neutral',
  MIXED = 'mixed',
}

// LogFragment type for memory inheritance
export interface LogFragment {
  id: string
  character_id: string
  title: string
  content: string
  rarity: LogFragmentRarity
  emotional_valence?: EmotionalValence
  keywords: string[]
  metadata?: Record<string, any>
  created_at: string
}

// Action types
export interface ActionChoice {
  id: string
  text: string
  difficulty?: string
  requirements?: Record<string, any>
}

export interface ActionExecuteRequest {
  action_text: string
  action_type?: string
  choice_id?: string
}

export interface ActionExecuteResponse {
  success: boolean
  turn_number: number
  narrative: string
  choices?: ActionChoice[]
  character_state: Record<string, any>
  metadata?: Record<string, any>
}

// Re-export from other modules if needed
// Note: CompletedLog and LogFragment are already exported from @/types
export type {
  User,
  Character,
  CharacterCreationForm,
  GameSession,
  GameSessionCreate,
  GameSessionListResponse,
  GameActionRequest,
  GameActionResponse,
  // Exclude CompletedLog and LogFragment to avoid duplicate exports
} from '@/types'

// Re-export everything except duplicates
export type {
  LogFragmentCreate,
  CompletedLogCreate,
  CompletedLogRead,
  LogFragmentRead,
} from '@/types/log'

export * from '@/types/sp'
