// ログシステムの型定義（バックエンドのPydanticモデルと一致）

// 感情価
export type EmotionalValence = 'positive' | 'negative' | 'neutral'

// ログフラグメントのレアリティ
export type LogFragmentRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'

// 完成ログのステータス
export type CompletedLogStatus =
  | 'draft'
  | 'completed'
  | 'contracted'
  | 'active'
  | 'expired'
  | 'recalled'

// ログフラグメント（ログの欠片）
export interface LogFragment {
  id: string
  characterId: string
  sessionId: string
  actionDescription: string
  keywords: string[]
  emotionalValence: EmotionalValence
  rarity: LogFragmentRarity
  importanceScore: number
  contextData: Record<string, unknown>
  createdAt: string
}

// 完成ログ
export interface CompletedLog {
  id: string
  creatorId: string
  coreFragmentId: string
  fragmentIds: string[]
  name: string
  title: string
  description: string
  skills: string[]
  personalityTraits: string[]
  behaviorPatterns: Record<string, unknown>
  contaminationLevel: number
  status: CompletedLogStatus
  createdAt: string
  completedAt?: string
}

// 完成ログの読み取り用型
export interface CompletedLogRead extends CompletedLog {
  created_at: string
}

// ログフラグメントの読み取り用型
export type LogFragmentRead = LogFragment

// API リクエスト/レスポンス用の型

// ログフラグメント作成リクエスト
export interface LogFragmentCreate {
  characterId: string
  sessionId: string
  actionDescription: string
  keywords: string[]
  emotionalValence: EmotionalValence
  contextData?: Record<string, unknown>
}

// 完成ログ作成リクエスト
export interface CompletedLogCreate {
  creatorId: string
  coreFragmentId: string
  subFragmentIds: string[]
  name: string
  title?: string
  description: string
  skills?: string[]
  personalityTraits?: string[]
  behaviorPatterns?: Record<string, unknown>
}

// ログ編纂時の計算結果
export interface LogCompilationPreview {
  contaminationLevel: number
  suggestedName: string
  suggestedTitle: string
  suggestedDescription: string
  extractedSkills: string[]
  extractedPersonalityTraits: string[]
  warningMessages?: string[]
}
