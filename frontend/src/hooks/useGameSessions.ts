/**
 * ゲームセッション関連のカスタムフック
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { GameSessionCreate } from '@/types'
import { useToast } from '@/hooks/useToast'

/**
 * ゲームセッション一覧を取得するフック
 */
export function useGameSessions() {
  return useQuery({
    queryKey: ['gameSessions'],
    queryFn: () => apiClient.getGameSessions(),
    staleTime: 30 * 1000, // 30秒
  })
}

/**
 * ゲームセッションを作成するフック
 */
export function useCreateGameSession() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (data: GameSessionCreate) => apiClient.createGameSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gameSessions'] })
      toast({
        title: 'ゲームセッション作成',
        description: '新しいゲームセッションが開始されました',
        variant: 'success',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'エラー',
        description: error.message || 'ゲームセッションの作成に失敗しました',
        variant: 'destructive',
      })
    },
  })
}

/**
 * 特定のゲームセッションを取得するフック
 */
export function useGameSession(sessionId: string | null) {
  return useQuery({
    queryKey: ['gameSessions', sessionId],
    queryFn: () => sessionId ? apiClient.getGameSession(sessionId) : null,
    enabled: !!sessionId,
  })
}