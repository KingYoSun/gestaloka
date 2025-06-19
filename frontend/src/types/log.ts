// ログシステムの型定義（バックエンドのPydanticモデルと一致）

// 感情価
export type EmotionalValence = 'positive' | 'negative' | 'neutral'

// ログフラグメントのレアリティ
export type LogFragmentRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

// 完成ログのステータス
export type CompletedLogStatus = 'draft' | 'completed' | 'contracted' | 'active' | 'expired' | 'recalled'

// ログ契約のステータス
export type LogContractStatus = 'pending' | 'accepted' | 'active' | 'deployed' | 'completed' | 'expired' | 'cancelled'

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

// ログ契約
export interface LogContract {
  id: string
  completedLogId: string
  creatorId: string
  hostCharacterId?: string
  activityDurationHours: number
  behaviorGuidelines: string
  rewardConditions: Record<string, unknown>
  rewards: Record<string, unknown>
  isPublic: boolean
  price: number
  status: LogContractStatus
  createdAt: string
  acceptedAt?: string
  deployedAt?: string
  completedAt?: string
}

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
  coreFragmentId: string
  fragmentIds: string[]
  name: string
  title: string
  description: string
  behaviorGuidelines?: string
}

// ログ契約作成リクエスト
export interface LogContractCreate {
  completedLogId: string
  activityDurationHours: number
  behaviorGuidelines: string
  rewardConditions: Record<string, unknown>
  rewards: Record<string, unknown>
  isPublic: boolean
  price?: number
}

// ログ契約受け入れリクエスト
export interface LogContractAccept {
  characterId: string
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