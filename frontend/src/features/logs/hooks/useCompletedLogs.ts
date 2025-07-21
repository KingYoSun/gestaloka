import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { logsApiWrapper } from '@/api/logs'
import type { CompletedLogCreate } from '@/api/logs'
import { useToast } from '@/hooks/useToast'

// 完成ログ一覧を取得
export function useCompletedLogs(characterId: string) {
  return useQuery({
    queryKey: ['completedLogs', characterId],
    queryFn: () => logsApiWrapper.getCompletedLogs(characterId),
    enabled: !!characterId,
    staleTime: 1000 * 60 * 5, // 5分間キャッシュ
  })
}

// 完成ログを作成
export function useCreateCompletedLog() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (log: CompletedLogCreate) => logsApiWrapper.createCompletedLog(log),
    onSuccess: data => {
      // キャッシュを更新
      queryClient.invalidateQueries({
        queryKey: ['completedLogs', data.creator_id],
      })
      toast({
        title: 'ログを編纂しました',
        description: `「${data.name}」が完成しました`,
        variant: 'success',
      })
    },
    onError: error => {
      toast({
        title: 'エラー',
        description: 'ログの編纂に失敗しました',
        variant: 'destructive',
      })
      console.error('Failed to create completed log:', error)
    },
  })
}

// 完成ログを更新
export function useUpdateCompletedLog() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({
      logId,
      updates,
    }: {
      logId: string
      updates: Partial<CompletedLogCreate>
    }) => logsApiWrapper.updateCompletedLog(logId, updates),
    onSuccess: data => {
      // キャッシュを更新
      queryClient.invalidateQueries({
        queryKey: ['completedLogs', data.creator_id],
      })
      toast({
        title: 'ログを更新しました',
        variant: 'success',
      })
    },
    onError: error => {
      toast({
        title: 'エラー',
        description: 'ログの更新に失敗しました',
        variant: 'destructive',
      })
      console.error('Failed to update completed log:', error)
    },
  })
}
