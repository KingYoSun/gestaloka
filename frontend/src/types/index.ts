// ユーザー関連の型定義
export interface User {
  id: string
  username: string
  email: string
  is_active: boolean
  is_verified: boolean
  created_at: string
  updated_at: string
}

// キャラクター関連の型定義
export interface Character {
  id: string
  userId: string
  name: string
  description?: string
  appearance?: string
  personality?: string
  skills: Skill[]
  stats?: CharacterStats
  location: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CharacterStats {
  level: number
  experience: number
  health: number
  maxHealth: number
  energy: number
  maxEnergy: number
}

export interface Skill {
  id: string
  name: string
  level: number
  experience: number
  description: string
}

// ゲームプレイ関連の型定義
export interface SessionData {
  [key: string]: string | number | boolean | null | SessionData | SessionData[]
}

export interface GameSession {
  id: string
  characterId: string
  characterName: string
  isActive: boolean
  currentScene: string | null
  sessionData?: SessionData
  createdAt: string
  updatedAt: string
}

export interface GameSessionCreate {
  characterId: string
}

export interface GameSessionListResponse {
  sessions: GameSession[]
  total: number
}

export interface GameActionRequest {
  actionText: string
  actionType?: 'choice' | 'custom'
  choiceIndex?: number
}

export interface CharacterStatusUpdate {
  health?: number
  maxHealth?: number
  energy?: number
  maxEnergy?: number
  experience?: number
  level?: number
  location?: string
  [key: string]: string | number | boolean | undefined
}

export interface GameActionResponse {
  sessionId: string
  actionResult: string
  newScene?: string
  choices?: string[]
  characterStatus?: CharacterStatusUpdate
}

export interface GameMessageMetadata {
  newScene?: string
  choices?: string[]
  characterStatus?: CharacterStatusUpdate
  [key: string]: string | number | boolean | undefined | string[] | CharacterStatusUpdate
}

export interface GameMessage {
  id: string
  sessionId: string
  type: 'user' | 'gm' | 'system'
  content: string
  metadata?: GameMessageMetadata
  timestamp: string
}

export interface GameAction {
  id: string
  type: 'text' | 'choice'
  content: string
  choices?: ActionChoice[]
}

export interface ActionChoice {
  id: string
  text: string
  description?: string
}

// ログ関連の型定義
export interface LogFragment {
  id: string
  characterId: string
  content: string
  type: 'action' | 'dialogue' | 'emotion' | 'thought'
  tags: string[]
  quality: number
  createdAt: string
}

export interface CompletedLog {
  id: string
  characterId: string
  title: string
  summary: string
  fragments: LogFragment[]
  npcData?: NPCData
  status: 'draft' | 'completed' | 'published'
  createdAt: string
  updatedAt: string
}

export interface NPCData {
  name: string
  personality: string
  appearance: string
  backstory: string
  motivations: string[]
  relationships: Record<string, string>
}

// API関連の型定義
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasNext: boolean
  hasPrev: boolean
}

// WebSocket関連の型定義
export type WebSocketData = string | number | boolean | null | Record<string, unknown> | unknown[]

export interface WebSocketMessage {
  type: string
  data: WebSocketData
  timestamp: string
}

export type GameUpdateData = {
  scene?: string
  character?: Character
  message?: GameMessage
  actionRequired?: boolean
  [key: string]: unknown
}

export interface GameUpdate {
  sessionId: string
  type: 'scene_change' | 'character_update' | 'new_message' | 'action_required'
  data: GameUpdateData
}

// UI関連の型定義
export interface ToastOptions {
  title?: string
  description?: string
  variant?: 'default' | 'destructive' | 'success'
  duration?: number
}

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

// フォーム関連の型定義
export interface CharacterCreationForm {
  name: string
  description?: string
  appearance?: string
  personality?: string
}

export interface LoginForm {
  username: string
  password: string
}

export interface RegisterForm {
  username: string
  email: string
  password: string
  confirmPassword: string
}

// エラー関連の型定義
export interface ErrorDetails {
  [key: string]: string | number | boolean | null | ErrorDetails | ErrorDetails[]
}

export interface AppError {
  code: string
  message: string
  details?: ErrorDetails
}

export interface ValidationError {
  field: string
  message: string
}

// 設定関連の型定義
export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  fontSize: 'small' | 'medium' | 'large'
  autoSave: boolean
  notifications: boolean
  soundEffects: boolean
}

// ルート関連の型定義
export type AppRoute =
  | '/login'
  | '/register'
  | '/dashboard'
  | '/character/create'
  | '/character/:id'
  | '/game/:sessionId'
  | '/logs'
  | '/settings'
