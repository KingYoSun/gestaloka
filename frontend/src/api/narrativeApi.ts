/**
 * 物語システムAPI
 */

import { apiClient } from './client'
import { GameActionRequest, ActionChoice, ActionExecuteResponse } from './generated'

export const narrativeApi = {
  /**
   * 物語アクションを実行
   */
  async performAction(
    characterId: string,
    action: GameActionRequest
  ): Promise<ActionExecuteResponse> {
    return await apiClient.post<ActionExecuteResponse>(
      `/narrative/${characterId}/action`,
      action
    )
  },

  /**
   * 利用可能な行動選択肢を取得
   */
  async getAvailableActions(characterId: string): Promise<ActionChoice[]> {
    return await apiClient.get<ActionChoice[]>(`/narrative/${characterId}/actions`)
  },
}
