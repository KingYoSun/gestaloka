import { memoryInheritanceApi } from '@/lib/api'
import type {
  MemoryCombinationPreview,
  MemoryInheritanceRequest,
  MemoryInheritanceResult,
  InheritanceHistoryEntry,
  MemoryInheritanceType,
} from '@/api/generated/models'

// 型をエクスポート
export type {
  MemoryCombinationPreview,
  MemoryInheritanceRequest,
  MemoryInheritanceResult,
  InheritanceHistoryEntry,
  MemoryInheritanceType,
}

// ログ強化情報（自動生成されていない場合は残す）
export interface LogEnhancementInfo {
  enhancement_id: string
  enhanced_traits: string[]
  power_multiplier: number
  acquired_at: string
}

// API関数（新しいAPIクライアントを使用）
export const memoryInheritanceApiWrapper = {
  // 記憶組み合わせのプレビューを取得
  getPreview: async (
    characterId: string,
    fragmentIds: string[]
  ): Promise<MemoryCombinationPreview> => {
    const response = await memoryInheritanceApi.getCombinationPreviewApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritancePreviewGet({
      characterId,
      requestBody: fragmentIds,
    })
    return response.data
  },

  // 記憶継承を実行
  execute: async (
    characterId: string,
    request: MemoryInheritanceRequest
  ): Promise<MemoryInheritanceResult> => {
    const response = await memoryInheritanceApi.executeInheritanceApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceExecutePost({
      characterId,
      memoryInheritanceRequest: request,
    })
    return response.data
  },

  // 継承履歴を取得
  getHistory: async (
    characterId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<InheritanceHistoryEntry[]> => {
    const response = await memoryInheritanceApi.getInheritanceHistoryApiV1MemoryInheritanceCharactersCharacterIdMemoryInheritanceHistoryGet({
      characterId,
      limit,
      offset,
    })
    return response.data
  },

  // ログ強化情報を取得（エンドポイントが存在しない可能性あり）
  getEnhancements: async (
    _characterId: string
  ): Promise<LogEnhancementInfo[]> => {
    // TODO: 自動生成されたAPIに該当メソッドがあるか確認が必要
    throw new Error('Not implemented yet')
  },
}

// 既存のコードとの互換性のためエクスポート名を維持
export { memoryInheritanceApiWrapper as memoryInheritanceApi }
