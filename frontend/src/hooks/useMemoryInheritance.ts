/**
 * 記憶継承関連のカスタムフック
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { memoryInheritanceApi } from '@/api/memoryInheritance'
import { useToast } from '@/hooks/useToast'
import { useActiveCharacter } from '@/hooks/useActiveCharacter'
import type {
  MemoryInheritanceRequest,
  MemoryInheritanceResult,
} from '@/api/memoryInheritance'

/**
 * 記憶組み合わせのプレビューを取得するフック
 */
export function useMemoryPreview(fragmentIds: string[]) {
  const { character } = useActiveCharacter()

  return useQuery({
    queryKey: ['memory-inheritance', 'preview', character?.id, fragmentIds],
    queryFn: () =>
      character
        ? memoryInheritanceApi.getPreview(character.id, fragmentIds)
        : null,
    enabled: !!character && fragmentIds.length > 0,
    staleTime: 30 * 1000, // 30秒
  })
}

/**
 * 記憶継承を実行するフック
 */
export function useExecuteMemoryInheritance() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { character } = useActiveCharacter()

  return useMutation({
    mutationFn: (request: MemoryInheritanceRequest) =>
      character
        ? memoryInheritanceApi.execute(character.id, request)
        : Promise.reject('No active character'),
    onSuccess: (result: MemoryInheritanceResult) => {
      // 関連するクエリを無効化
      queryClient.invalidateQueries({ queryKey: ['memory-inheritance'] })
      queryClient.invalidateQueries({ queryKey: ['log-fragments'] })
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })

      // 継承タイプに応じて追加のクエリを無効化
      if (result.inheritance_type === 'skill') {
        queryClient.invalidateQueries({ queryKey: ['skills'] })
      } else if (result.inheritance_type === 'title') {
        queryClient.invalidateQueries({ queryKey: ['titles'] })
      }

      toast({
        title: '記憶継承成功',
        description: result.message,
        variant: 'success',
      })
    },
    onError: (error: any) => {
      const errorMessage =
        error?.response?.data?.detail || '記憶継承に失敗しました'
      toast({
        title: '記憶継承エラー',
        description: errorMessage,
        variant: 'destructive',
      })
    },
  })
}

/**
 * 継承履歴を取得するフック
 */
export function useInheritanceHistory(params?: {
  limit?: number
  offset?: number
}) {
  const { character } = useActiveCharacter()

  return useQuery({
    queryKey: ['memory-inheritance', 'history', character?.id, params],
    queryFn: () =>
      character
        ? memoryInheritanceApi.getHistory(
            character.id,
            params?.limit,
            params?.offset
          )
        : [],
    enabled: !!character,
    staleTime: 60 * 1000, // 1分
  })
}

/**
 * ログ強化情報を取得するフック
 */
export function useLogEnhancements() {
  const { character } = useActiveCharacter()

  return useQuery({
    queryKey: ['memory-inheritance', 'enhancements', character?.id],
    queryFn: () =>
      character ? memoryInheritanceApi.getEnhancements(character.id) : [],
    enabled: !!character,
    staleTime: 5 * 60 * 1000, // 5分
  })
}

/**
 * 記憶継承管理用のまとめフック
 */
export function useMemoryInheritance() {
  const execute = useExecuteMemoryInheritance()
  const history = useInheritanceHistory()
  const enhancements = useLogEnhancements()

  return {
    execute: execute.mutate,
    isExecuting: execute.isPending,
    history: history.data || [],
    isLoadingHistory: history.isLoading,
    enhancements: enhancements.data || [],
    isLoadingEnhancements: enhancements.isLoading,
    refetch: () => {
      history.refetch()
      enhancements.refetch()
    },
  }
}
