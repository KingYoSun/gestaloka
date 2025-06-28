/**
 * WebSocket関連の型定義
 */

export interface GameMessage {
  id?: string
  type: 'narrative' | 'action_result' | 'system'
  content?: string
  action?: string
  result?: unknown
  timestamp: string
}

export interface GameState {
  currentScene?: string
  playerStatus?: Record<string, unknown>
  worldState?: Record<string, unknown>
  [key: string]: unknown
}

export interface GameJoinedData {
  message: string
  game_session_id: string
  timestamp: string
}

export interface GameStartedData {
  type: string
  game_session_id: string
  initial_state: GameState
  timestamp: string
}

export interface NarrativeUpdateData {
  type: string
  narrative_type: string
  narrative: string
  timestamp: string
}

export interface ActionResultData {
  type: string
  user_id: string
  action: string
  result: unknown
  timestamp: string
}

export interface StateUpdateData {
  type: string
  update: Partial<GameState>
  timestamp: string
}

export interface GameErrorData {
  type: string
  error_type: string
  message: string
  timestamp: string
}

export interface ChatMessage {
  id?: string
  user_id: string
  message: string
  timestamp: string
}

export interface NotificationData {
  type: string
  notification_type?: 'info' | 'success' | 'warning' | 'error'
  title?: string
  message?: string
  achievement?: {
    name: string
    description: string
  }
  from_user?: {
    name: string
  }
  timestamp: string
}

export interface NPCProfile {
  npc_id: string
  name: string
  title?: string | null
  npc_type: 'LOG_NPC' | 'PERMANENT_NPC' | 'TEMPORARY_NPC'
  personality_traits: string[]
  behavior_patterns: string[]
  skills: string[]
  appearance?: string | null
  backstory?: string | null
  original_player?: string | null
  log_source?: string | null
  contamination_level: number
  persistence_level: number
  current_location?: string | null
  is_active: boolean
}

export interface NPCEncounterData {
  type: 'npc_encounter'
  encounter_type: string
  npc: NPCProfile
  choices?: Array<{
    id: string
    text: string
    difficulty?: 'easy' | 'medium' | 'hard' | null
    requirements?: Record<string, unknown> | null
  }>
  timestamp: string
}

export interface NPCActionResultData {
  type: 'npc_action_result'
  npc_id: string
  action: string
  result: string
  state_changes?: Record<string, unknown>
  rewards?: Array<{
    type: string
    amount: number
    item?: unknown
  }>
  timestamp: string
}
