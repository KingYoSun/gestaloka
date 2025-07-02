import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { questsApi } from '@/api/quests'
import type { CreateQuestRequest, Quest } from '@/types/quest'
import { QuestStatus } from '@/types/quest'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useCallback, useEffect } from 'react'

export function useQuests(characterId?: string, status?: QuestStatus) {
  const queryClient = useQueryClient()
  const { on, off } = useWebSocket()

  // クエスト一覧取得
  const questsQuery = useQuery({
    queryKey: ['quests', characterId, status],
    queryFn: () => {
      if (!characterId) return { quests: [], total: 0, limit: 20, offset: 0 }
      return questsApi.getQuests(characterId, { status, limit: 20 })
    },
    enabled: !!characterId,
  })

  // WebSocketイベントリスナー
  useEffect(() => {
    if (!characterId) return

    const handleQuestUpdate = (data: any) => {
      if (data.character_id === characterId) {
        // クエストリストを再取得
        queryClient.invalidateQueries({ queryKey: ['quests', characterId] })
        // 特定のクエストも更新
        if (data.quest_id) {
          queryClient.setQueryData(
            ['quest', data.quest_id],
            (oldData: any) => ({ ...oldData, ...data.quest })
          )
        }
      }
    }

    const handleQuestCreated = (data: any) => handleQuestUpdate(data)
    const handleQuestUpdated = (data: any) => handleQuestUpdate(data)
    const handleQuestCompleted = (data: any) => handleQuestUpdate(data)

    on('quest_created', handleQuestCreated)
    on('quest_updated', handleQuestUpdated)
    on('quest_completed', handleQuestCompleted)

    return () => {
      off('quest_created', handleQuestCreated)
      off('quest_updated', handleQuestUpdated)
      off('quest_completed', handleQuestCompleted)
    }
  }, [characterId, queryClient, on, off])

  return {
    quests: questsQuery.data?.quests || [],
    total: questsQuery.data?.total || 0,
    isLoading: questsQuery.isLoading,
    error: questsQuery.error,
    refetch: questsQuery.refetch,
  }
}

export function useQuestProposals(characterId?: string) {
  const proposalsQuery = useQuery({
    queryKey: ['quest-proposals', characterId],
    queryFn: () => {
      if (!characterId) return []
      return questsApi.getProposals(characterId)
    },
    enabled: !!characterId,
    staleTime: 1000 * 60 * 5, // 5分間キャッシュ
  })

  return {
    proposals: proposalsQuery.data || [],
    isLoading: proposalsQuery.isLoading,
    error: proposalsQuery.error,
    refetch: proposalsQuery.refetch,
  }
}

export function useCreateQuest(characterId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: CreateQuestRequest) => {
      if (!characterId) throw new Error('Character ID is required')
      return questsApi.createQuest(characterId, request)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quests', characterId] })
    },
  })
}

export function useAcceptQuest(characterId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (questId: string) => {
      if (!characterId) throw new Error('Character ID is required')
      return questsApi.acceptQuest(characterId, questId)
    },
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['quests', characterId] })
      queryClient.invalidateQueries({
        queryKey: ['quest-proposals', characterId],
      })
      queryClient.setQueryData(['quest', data.id], data)
    },
  })
}

export function useUpdateQuestProgress(characterId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (questId: string) => {
      if (!characterId) throw new Error('Character ID is required')
      return questsApi.updateProgress(characterId, questId)
    },
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['quests', characterId] })
      queryClient.setQueryData(['quest', data.id], data)
    },
  })
}

export function useInferImplicitQuest(characterId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      if (!characterId) throw new Error('Character ID is required')
      return questsApi.inferImplicitQuest(characterId)
    },
    onSuccess: data => {
      if (data) {
        queryClient.invalidateQueries({ queryKey: ['quests', characterId] })
      }
    },
  })
}

// アクティブなクエストを取得するユーティリティフック
export function useActiveQuests(characterId?: string) {
  const { quests, ...rest } = useQuests(characterId)

  const activeQuests = useCallback(() => {
    return quests.filter(
      (quest: Quest) =>
        quest.status === QuestStatus.ACTIVE ||
        quest.status === QuestStatus.PROGRESSING ||
        quest.status === QuestStatus.NEAR_COMPLETION
    )
  }, [quests])

  return {
    activeQuests: activeQuests(),
    ...rest,
  }
}
