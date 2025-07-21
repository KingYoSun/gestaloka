import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
// import { logsApiWrapper } from '@/api/logs' // TODO: API実装後に有効化
import type {
  PurificationItem,
  // CreatePurificationItemRequest, // TODO: API実装後に有効化
} from '@/types/log'

export function usePurificationItems(characterId: string) {
  return useQuery<PurificationItem[]>({
    queryKey: ['purificationItems', characterId],
    queryFn: async () => {
      // getPurificationItems APIは現在未実装
      return []
    },
    enabled: !!characterId,
  })
}

export function useCreatePurificationItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      // createPurificationItem APIは現在未実装
      throw new Error('浄化アイテム作成機能は現在利用できません')
    },
    onSuccess: () => {
      // 浄化アイテムリストを更新
      queryClient.invalidateQueries({ queryKey: ['purificationItems'] })
      // フラグメントリストを更新（消費されたため）
      queryClient.invalidateQueries({ queryKey: ['logFragments'] })
    },
  })
}
