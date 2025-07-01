/**
 * 物語システムAPI
 */

import { apiClient } from './client'
import { ActionRequest, ActionChoice, NarrativeResponse } from './generated'

export const narrativeApi = {
  /**
   * 物語アクションを実行
   */
  async performAction(
    characterId: string,
    action: ActionRequest
  ): Promise<NarrativeResponse> {
    const response = await apiClient.post(
      `/narrative/${characterId}/action`,
      action
    )
    return response.data
  },

  /**
   * 利用可能な行動選択肢を取得
   */
  async getAvailableActions(characterId: string): Promise<ActionChoice[]> {
    const response = await apiClient.get(`/narrative/${characterId}/actions`)
    return response.data
  },
}
