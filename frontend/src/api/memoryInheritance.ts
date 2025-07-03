import { apiClient } from '@/lib/api-client'

// 記憶継承タイプ
export enum MemoryInheritanceType {
  SKILL = 'skill',
  TITLE = 'title',
  ITEM = 'item',
  LOG_ENHANCEMENT = 'log_enhancement',
}

// スキルプレビュー
export interface SkillPreview {
  name: string
  description: string
  rarity: string
  estimated_power: number
}

// 称号プレビュー
export interface TitlePreview {
  name: string
  description: string
  stat_bonuses: Record<string, number>
}

// アイテムプレビュー
export interface ItemPreview {
  name: string
  description: string
  item_type: string
  rarity: string
  estimated_value: number
}

// ログ強化プレビュー
export interface LogEnhancementPreview {
  enhancements: string[]
  bonus_multiplier: number
  estimated_impact: string
}

// 記憶組み合わせプレビュー
export interface MemoryCombinationPreview {
  possible_types: MemoryInheritanceType[]
  skill_preview?: SkillPreview
  title_preview?: TitlePreview
  item_preview?: ItemPreview
  log_enhancement_preview?: LogEnhancementPreview
  base_sp_cost: number
  combo_bonus: number
  total_sp_cost: number
  memory_themes: string[]
  rarity_distribution: Record<string, number>
}

// 記憶継承リクエスト
export interface MemoryInheritanceRequest {
  fragment_ids: string[]
  inheritance_type: MemoryInheritanceType
}

// 記憶継承結果
export interface MemoryInheritanceResult {
  success: boolean
  inheritance_type: MemoryInheritanceType
  result_details: {
    skill?: {
      id: string
      name: string
      description: string
      power: number
      rarity: string
    }
    title?: {
      id: string
      name: string
      description: string
      stat_bonuses: Record<string, number>
    }
    item?: {
      id: string
      name: string
      description: string
      item_type: string
      rarity: string
      value: number
    }
    log_enhancement?: {
      enhanced_traits: string[]
      power_multiplier: number
      new_abilities: string[]
    }
  }
  sp_consumed: number
  combo_bonus_applied: number
  fragments_used: string[]
  message: string
}

// 継承履歴エントリ
export interface InheritanceHistoryEntry {
  id: string
  character_id: string
  inheritance_type: MemoryInheritanceType
  fragments_used: string[]
  result_summary: string
  sp_consumed: number
  created_at: string
}

// ログ強化情報
export interface LogEnhancementInfo {
  enhancement_id: string
  enhanced_traits: string[]
  power_multiplier: number
  acquired_at: string
}

// API関数
export const memoryInheritanceApi = {
  // 記憶組み合わせのプレビューを取得
  getPreview: async (
    characterId: string,
    fragmentIds: string[]
  ): Promise<MemoryCombinationPreview> => {
    const params = new URLSearchParams()
    fragmentIds.forEach(id => params.append('fragment_ids', id))

    const response = await apiClient.get<MemoryCombinationPreview>(
      `/characters/${characterId}/memory-inheritance/preview?${params}`
    )
    return response.data
  },

  // 記憶継承を実行
  execute: async (
    characterId: string,
    request: MemoryInheritanceRequest
  ): Promise<MemoryInheritanceResult> => {
    const response = await apiClient.post<MemoryInheritanceResult>(
      `/characters/${characterId}/memory-inheritance/execute`,
      request
    )
    return response.data
  },

  // 継承履歴を取得
  getHistory: async (
    characterId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<InheritanceHistoryEntry[]> => {
    const response = await apiClient.get<InheritanceHistoryEntry[]>(
      `/characters/${characterId}/memory-inheritance/history`,
      { params: { limit, offset } }
    )
    return response.data
  },

  // ログ強化情報を取得
  getEnhancements: async (
    characterId: string
  ): Promise<LogEnhancementInfo[]> => {
    const response = await apiClient.get<LogEnhancementInfo[]>(
      `/characters/${characterId}/memory-inheritance/enhancements`
    )
    return response.data
  },
}
