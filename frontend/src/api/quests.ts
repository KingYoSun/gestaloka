import { apiClient } from './client'
import type {
  Quest,
  QuestProposal,
  CreateQuestRequest,
  QuestListResponse,
  QuestStatus,
} from '@/types/quest'

export const questsApi = {
  // クエスト提案を取得
  getProposals: async (characterId: string): Promise<QuestProposal[]> => {
    const response = await apiClient.get<QuestProposal[]>(
      `/api/v1/quests/${characterId}/proposals`
    )
    return response
  },

  // 新規クエスト作成
  createQuest: async (
    characterId: string,
    request: CreateQuestRequest
  ): Promise<Quest> => {
    const response = await apiClient.post<Quest>(
      `/api/v1/quests/${characterId}/create`,
      request
    )
    return response
  },

  // クエスト受諾
  acceptQuest: async (characterId: string, questId: string): Promise<Quest> => {
    const response = await apiClient.post<Quest>(
      `/api/v1/quests/${characterId}/quests/${questId}/accept`
    )
    return response
  },

  // 進行状況更新
  updateProgress: async (
    characterId: string,
    questId: string
  ): Promise<Quest> => {
    const response = await apiClient.post<Quest>(
      `/api/v1/quests/${characterId}/quests/${questId}/update`
    )
    return response
  },

  // クエスト一覧取得
  getQuests: async (
    characterId: string,
    params?: {
      status?: QuestStatus
      limit?: number
      offset?: number
    }
  ): Promise<QuestListResponse> => {
    const response = await apiClient.get<QuestListResponse>(
      `/api/v1/quests/${characterId}/quests`,
      { params }
    )
    return response
  },

  // 暗黙的クエスト推測
  inferImplicitQuest: async (characterId: string): Promise<Quest | null> => {
    const response = await apiClient.post<Quest | null>(
      `/api/v1/quests/${characterId}/quests/infer`
    )
    return response || null
  },
}
