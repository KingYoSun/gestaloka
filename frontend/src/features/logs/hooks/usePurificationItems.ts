import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { logsApiWrapper } from '@/api/logs'
import type {
  PurificationItem,
  CreatePurificationItemRequest,
} from '@/types/log'

export function usePurificationItems(characterId: string) {
  return useQuery<PurificationItem[]>({
    queryKey: ['purificationItems', characterId],
    queryFn: () => logsApiWrapper.getPurificationItems(characterId),
    enabled: !!characterId,
  })
}

export function useCreatePurificationItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreatePurificationItemRequest) =>
      logsApiWrapper.createPurificationItem(data),
    onSuccess: () => {
      // 浄化アイテムリストを更新
      queryClient.invalidateQueries({ queryKey: ['purificationItems'] })
      // フラグメントリストを更新（消費されたため）
      queryClient.invalidateQueries({ queryKey: ['logFragments'] })
    },
  })
}
