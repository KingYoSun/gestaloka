/**
 * 型定義ファイル
 * 
 * 注意：多くの型はOpenAPI Generatorで自動生成されています
 * - User, Character, CharacterStats, Skill: @/api/generated からインポート
 * - ActionChoice: @/api/generated からインポート
 * - CharacterCreate (旧CharacterCreationForm): @/api/generated からインポート
 * 
 * セッション関連の型は一時的に session-temp.ts に移動しています
 */

// 再エクスポート（セッション関連の一時的な型）
export * from './session-temp'

// API関連の型定義（自動生成されていないもののみ）
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