import { questsApi } from '@/lib/api'
import type {
  Quest,
  QuestProposal,
  CreateQuestRequest,
  QuestListResponse,
  QuestStatus,
} from '@/api/generated/models'

export const questsApiWrapper = {
  // クエスト提案を取得
  getProposals: async (characterId: string): Promise<QuestProposal[]> => {
    const response = await questsApi.getQuestProposalsApiV1QuestsCharacterIdProposalsGet({ characterId })
    return response.data
  },

  // 新規クエスト作成
  createQuest: async (
    characterId: string,
    request: CreateQuestRequest
  ): Promise<Quest> => {
    const response = await questsApi.createQuestApiV1QuestsCharacterIdCreatePost({ 
      characterId, 
      createQuestRequest: request 
    })
    return response.data
  },

  // クエスト受諾
  acceptQuest: async (characterId: string, questId: string): Promise<Quest> => {
    const response = await questsApi.acceptQuestApiV1QuestsCharacterIdQuestsQuestIdAcceptPost({ 
      characterId, 
      questId 
    })
    return response.data
  },

  // 進行状況更新
  updateProgress: async (
    characterId: string,
    questId: string
  ): Promise<Quest> => {
    const response = await questsApi.updateQuestProgressApiV1QuestsCharacterIdQuestsQuestIdUpdatePost({ 
      characterId, 
      questId 
    })
    return response.data
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
    const response = await questsApi.getCharacterQuestsApiV1QuestsCharacterIdQuestsGet({
      characterId,
      status: params?.status,
      limit: params?.limit,
      offset: params?.offset
    })
    return response.data
  },

  // 暗黙的クエスト推測
  inferImplicitQuest: async (characterId: string): Promise<Quest | null> => {
    const response = await questsApi.inferImplicitQuestApiV1QuestsCharacterIdQuestsInferPost({ 
      characterId 
    })
    return response.data || null
  },
}