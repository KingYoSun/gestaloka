import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { LogFragmentCreate } from '@/types/log'
import { useToast } from '@/hooks/useToast'

// ログフラグメント一覧を取得
export function useLogFragments(characterId: string) {
  return useQuery({
    queryKey: ['logFragments', characterId],
    queryFn: () => apiClient.getLogFragments(characterId),
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
      apiClient.createLogFragment(fragment),
    onSuccess: data => {
      // キャッシュを更新
      queryClient.invalidateQueries({
        queryKey: ['logFragments', data.characterId],
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
