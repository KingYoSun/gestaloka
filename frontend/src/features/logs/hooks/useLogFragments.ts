import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { logsApiWrapper } from '@/api/logs'
import type { LogFragmentCreate } from '@/api/logs'
import { useToast } from '@/hooks/useToast'

// ログフラグメント一覧を取得
export function useLogFragments(characterId: string) {
  return useQuery({
    queryKey: ['logFragments', characterId],
    queryFn: () => logsApiWrapper.getFragments(characterId),
    enabled: !!characterId,
    staleTime: 1000 * 60 * 5, // 5分間キャッシュ
  })
}

// ログフラグメントを作成
export function useCreateLogFragment() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (fragment: LogFragmentCreate) =>
      logsApiWrapper.createFragment(fragment),
    onSuccess: data => {
      // キャッシュを更新
      queryClient.invalidateQueries({
        queryKey: ['logFragments', data.character_id],
      })
      toast({
        title: 'ログフラグメントを作成しました',
        variant: 'success',
      })
    },
    onError: error => {
      toast({
        title: 'エラー',
        description: 'ログフラグメントの作成に失敗しました',
        variant: 'destructive',
      })
      console.error('Failed to create log fragment:', error)
    },
  })
}
