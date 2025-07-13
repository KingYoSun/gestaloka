/**
 * タイトル（称号）管理関連のカスタムフック
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getTitles,
  getEquippedTitle,
  equipTitle,
  unequipAllTitles,
} from '@/api/titles'
import { useToast } from '@/hooks/useToast'

/**
 * すべてのタイトルを取得するフック
 */
export function useTitles() {
  return useQuery({
    queryKey: ['titles'],
    queryFn: getTitles,
    staleTime: 5 * 60 * 1000, // 5分
  })
}

/**
 * 装備中のタイトルを取得するフック
 */
export function useEquippedTitle() {
  return useQuery({
    queryKey: ['titles', 'equipped'],
    queryFn: getEquippedTitle,
    staleTime: 60 * 1000, // 1分
  })
}

/**
 * タイトルを装備するフック
 */
export function useEquipTitle() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (titleId: string) => equipTitle(titleId),
    onSuccess: (data) => {
      // タイトル一覧と装備中タイトルのキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['titles'] })
      queryClient.invalidateQueries({ queryKey: ['titles', 'equipped'] })

      toast({
        title: 'タイトル装備完了',
        description: `「${data.title}」を装備しました`,
        variant: 'success',
      })
    },
    onError: (error: any) => {
      const errorMessage =
        error?.response?.data?.detail || 'タイトルの装備に失敗しました'
      toast({
        title: 'エラー',
        description: errorMessage,
        variant: 'destructive',
      })
    },
  })
}

/**
 * すべてのタイトルを外すフック
 */
export function useUnequipAllTitles() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: unequipAllTitles,
    onSuccess: () => {
      // タイトル一覧と装備中タイトルのキャッシュを更新
      queryClient.invalidateQueries({ queryKey: ['titles'] })
      queryClient.invalidateQueries({ queryKey: ['titles', 'equipped'] })

      toast({
        title: 'タイトル解除完了',
        description: 'すべてのタイトルを外しました',
        variant: 'success',
      })
    },
    onError: (error: any) => {
      const errorMessage =
        error?.response?.data?.detail || 'タイトルの解除に失敗しました'
      toast({
        title: 'エラー',
        description: errorMessage,
        variant: 'destructive',
      })
    },
  })
}

/**
 * タイトル管理用のまとめフック
 */
export function useTitleManagement() {
  const titles = useTitles()
  const equippedTitle = useEquippedTitle()
  const equipTitle = useEquipTitle()
  const unequipAllTitles = useUnequipAllTitles()

  return {
    titles: titles.data || [],
    equippedTitle: equippedTitle.data,
    isLoading: titles.isLoading || equippedTitle.isLoading,
    isError: titles.isError || equippedTitle.isError,
    error: titles.error || equippedTitle.error,
    refetch: () => {
      titles.refetch()
      equippedTitle.refetch()
    },
    equipTitle: equipTitle.mutate,
    unequipAllTitles: unequipAllTitles.mutate,
    isEquipping: equipTitle.isPending,
    isUnequipping: unequipAllTitles.isPending,
  }
}