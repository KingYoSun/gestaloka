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
  lastPlayedAt?: string
}

export interface CharacterStats {
  level: number
  experience: number
  health: number
  maxHealth: number
  mp: number
  maxMp: number
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
  mp?: number
  maxMp?: number
  experience?: number
  level?: number
  location?: string
  [key: string]: string | number | boolean | undefined
}

export interface GameActionResponse {
  sessionId: string
  actionResult: string
  newScene?: string
  choices?: ActionChoice[]
  characterStatus?: CharacterStatusUpdate
}

// セッション終了関連の型定義
export interface GameMessageMetadata {
  newScene?: string
  choices?: ActionChoice[]
  characterStatus?: CharacterStatusUpdate
  [key: string]:
    | string
    | number
    | boolean
    | undefined
    | string[]
    | ActionChoice[]
    | CharacterStatusUpdate
}

export interface GameMessage {
  id: string
  sessionId: string
  type: 'user' | 'gm' | 'system'
  content: string
  metadata?: GameMessageMetadata
  timestamp: string
}

export interface ActionChoice {
  id: string
  text: string
  description?: string
  difficulty?: string
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
  status: 'draft' | 'completed' | 'published'
  createdAt: string
  updatedAt: string
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


// UI関連の型定義
export interface ToastOptions {
  title?: string
  description?: string
  variant?: 'default' | 'destructive' | 'success'
  duration?: number
}

// フォーム関連の型定義
export interface CharacterCreationForm {
  name: string
  description?: string
  appearance?: string
  personality?: string
}

// エラー関連の型定義
// 設定関連の型定義
// ルート関連の型定義
