// ログシステムの型定義（バックエンドのPydanticモデルと一致）

// 感情価
export type EmotionalValence = 'positive' | 'negative' | 'neutral' | 'mixed'

// 記憶タイプ
export type MemoryType =
  | 'COURAGE'
  | 'FRIENDSHIP'
  | 'WISDOM'
  | 'SACRIFICE'
  | 'VICTORY'
  | 'TRUTH'
  | 'BETRAYAL'
  | 'LOVE'
  | 'FEAR'
  | 'HOPE'
  | 'MYSTERY'

// ログフラグメントのレアリティ
export type LogFragmentRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'unique'
  | 'architect'

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
  memoryType?: MemoryType
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

// コンボボーナスタイプ
export type CompilationBonusType =
  | 'SP_COST_REDUCTION'
  | 'POWER_BOOST'
  | 'SPECIAL_TITLE'
  | 'PURIFICATION'
  | 'RARITY_UPGRADE'
  | 'MEMORY_RESONANCE'

// コンボボーナス
export interface CompilationBonus {
  type: CompilationBonusType
  description: string
  value?: number
  title?: string
}

// 編纂プレビューリクエスト
export interface CompilationPreviewRequest {
  core_fragment_id: string
  sub_fragment_ids: string[]
}

// 編纂プレビューレスポンス
export interface CompilationPreviewResponse {
  base_sp_cost: number
  final_sp_cost: number
  contamination_level: number
  memory_types: MemoryType[]
  keyword_combinations: string[]
  bonuses: CompilationBonus[]
  special_titles: string[]
  warnings: string[]
}

// 浄化アイテムタイプ
export type PurificationItemType =
  | 'HOLY_WATER'
  | 'LIGHT_CRYSTAL'
  | 'PURIFICATION_TOME'
  | 'ANGEL_TEARS'
  | 'WORLD_TREE_LEAF'

// 浄化アイテム
export interface PurificationItem {
  id: string
  character_id: string
  item_type: PurificationItemType
  purification_power: number
  created_at: string
  used_at?: string
}

// 浄化リクエスト
export interface PurifyLogRequest {
  purification_item_id: string
}

// 浄化レスポンス
export interface PurifyLogResponse {
  log: CompletedLog
  old_contamination: number
  new_contamination: number
  purification_amount: number
  new_traits: string[]
  special_effects: string[]
  special_title?: string
}

// 浄化アイテム作成リクエスト
export interface CreatePurificationItemRequest {
  fragment_id: string
}

// 浄化アイテム作成レスポンス
export interface CreatePurificationItemResponse {
  item: PurificationItem
  consumed_fragment_id: string
}
