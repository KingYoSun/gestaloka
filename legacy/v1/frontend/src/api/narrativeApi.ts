/**
 * 物語システムAPI
 */

import { narrativeApi } from '@/lib/api'
import type {
  ActionRequest,
  ActionChoice,
  NarrativeResponse,
} from '@/api/generated/models'

export const narrativeApiWrapper = {
  /**
   * 物語アクションを実行
   */
  async performAction(
    characterId: string,
    action: ActionRequest
  ): Promise<NarrativeResponse> {
    const response = await narrativeApi.performNarrativeActionApiV1NarrativeCharacterIdActionPost({
      characterId,
      actionRequest: action,
    })
    return response.data
  },

  /**
   * 利用可能な行動選択肢を取得
   */
  async getAvailableActions(characterId: string): Promise<ActionChoice[]> {
    const response = await narrativeApi.getAvailableActionsApiV1NarrativeCharacterIdActionsGet({
      characterId,
    })
    return response.data
  },
}

// 既存のコードとの互換性のため元の名前でエクスポート
export { narrativeApiWrapper as narrativeApi }
