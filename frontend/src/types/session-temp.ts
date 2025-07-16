/**
 * セッション機能再作成までの一時的な型定義
 * 
 * これらの型は後ほどセッション機能の再作成時に
 * OpenAPI Generatorで自動生成される型に置き換えられます
 */

import { ActionChoice } from '@/api/generated'

// ゲームセッション関連の型定義
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