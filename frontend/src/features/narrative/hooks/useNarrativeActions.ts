/**
 * 物語アクション用のカスタムフック
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import { narrativeApi } from '@/api/narrativeApi'
import { GameActionRequest } from '@/api/generated'
import { toast } from 'sonner'

export function useNarrativeActions(characterId: string) {
  // 行動実行
  const performActionMutation = useMutation({
    mutationFn: async (action: GameActionRequest) => {
      return await narrativeApi.performAction(characterId, action)
    },
    onSuccess: data => {
      // メタデータから追加情報を取得
      if (data.metadata) {
        // 場所が変わった場合の通知
        if (data.metadata.location_changed && data.metadata.new_location_name) {
          toast.success(`${data.metadata.new_location_name}へ移動しました`)
        }

        // SP消費の通知
        if (data.metadata.sp_consumed && data.metadata.sp_consumed > 0) {
          toast.info(`SP -${data.metadata.sp_consumed}`)
        }
      }
    },
    onError: (error: any) => {
      const message = error.response?.data?.detail || '行動の実行に失敗しました'
      toast.error(message)
    },
  })

  // 利用可能な行動を取得
  const availableActionsQuery = useQuery({
    queryKey: ['narrative', 'actions', characterId],
    queryFn: () => narrativeApi.getAvailableActions(characterId),
    enabled: !!characterId,
  })

  return {
    performAction: performActionMutation.mutateAsync,
    getAvailableActions: async () => {
      const result = await availableActionsQuery.refetch()
      return result.data || []
    },
    isLoading:
      performActionMutation.isPending || availableActionsQuery.isLoading,
    currentActions: availableActionsQuery.data || [],
  }
}
