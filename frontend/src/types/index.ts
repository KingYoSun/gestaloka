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
export interface GameSession {
  id: string
  characterId: string
  characterName: string
  isActive: boolean
  currentScene: string | null
  sessionData?: Record<string, any>
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

export interface GameActionResponse {
  sessionId: string
  actionResult: string
  newScene?: string
  choices?: string[]
  characterStatus?: Record<string, any>
}

export interface GameMessage {
  id: string
  sessionId: string
  type: 'user' | 'gm' | 'system'
  content: string
  metadata?: Record<string, any>
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
export interface WebSocketMessage {
  type: string
  data: any
  timestamp: string
}

export interface GameUpdate {
  sessionId: string
  type: 'scene_change' | 'character_update' | 'new_message' | 'action_required'
  data: any
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
export interface AppError {
  code: string
  message: string
  details?: Record<string, any>
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