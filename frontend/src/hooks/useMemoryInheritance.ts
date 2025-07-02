import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  memoryInheritanceApi,
  MemoryInheritanceType,
  MemoryInheritanceRequest,
} from '@/api/memoryInheritance'
import { useLogFragments } from './useLogFragments'
import { toast } from 'sonner'
import { LogFragment } from '@/api/generated'

export function useMemoryInheritance(characterId: string) {
  const queryClient = useQueryClient()
  const [selectedFragmentIds, setSelectedFragmentIds] = useState<string[]>([])
  const [selectedType, setSelectedType] =
    useState<MemoryInheritanceType | null>(null)

  // 選択されたフラグメントのプレビューを取得
  const previewQuery = useQuery({
    queryKey: ['memory-inheritance-preview', characterId, selectedFragmentIds],
    queryFn: () =>
      memoryInheritanceApi.getPreview(characterId, selectedFragmentIds),
    enabled: selectedFragmentIds.length >= 2, // 最低2つのフラグメントが必要
  })

  // 継承履歴を取得
  const historyQuery = useQuery({
    queryKey: ['memory-inheritance-history', characterId],
    queryFn: () => memoryInheritanceApi.getHistory(characterId),
  })

  // ログ強化情報を取得
  const enhancementsQuery = useQuery({
    queryKey: ['memory-inheritance-enhancements', characterId],
    queryFn: () => memoryInheritanceApi.getEnhancements(characterId),
  })

  // 記憶継承を実行
  const executeMutation = useMutation({
    mutationFn: (request: MemoryInheritanceRequest) =>
      memoryInheritanceApi.execute(characterId, request),
    onSuccess: result => {
      toast.success(`記憶継承が完了しました！`)

      // 関連するクエリを無効化して再取得
      queryClient.invalidateQueries({
        queryKey: ['memory-inheritance-history', characterId],
      })
      queryClient.invalidateQueries({
        queryKey: ['log-fragments', characterId],
      })
      queryClient.invalidateQueries({ queryKey: ['character', characterId] })

      // 成功した継承タイプに応じて追加の無効化
      if (result.inheritance_type === MemoryInheritanceType.SKILL) {
        queryClient.invalidateQueries({
          queryKey: ['character-skills', characterId],
        })
      } else if (result.inheritance_type === MemoryInheritanceType.ITEM) {
        queryClient.invalidateQueries({
          queryKey: ['character-items', characterId],
        })
      } else if (
        result.inheritance_type === MemoryInheritanceType.LOG_ENHANCEMENT
      ) {
        queryClient.invalidateQueries({
          queryKey: ['memory-inheritance-enhancements', characterId],
        })
      }

      // 選択をリセット
      setSelectedFragmentIds([])
      setSelectedType(null)
    },
    onError: (error: any) => {
      const message = error.response?.data?.detail || '記憶継承に失敗しました'
      toast.error(message)
    },
  })

  // フラグメント選択のトグル
  const toggleFragmentSelection = (fragmentId: string) => {
    setSelectedFragmentIds(prev => {
      if (prev.includes(fragmentId)) {
        return prev.filter(id => id !== fragmentId)
      }
      return [...prev, fragmentId]
    })
  }

  // 全選択解除
  const clearSelection = () => {
    setSelectedFragmentIds([])
    setSelectedType(null)
  }

  // 継承実行
  const executeInheritance = () => {
    if (!selectedType || selectedFragmentIds.length < 2) {
      toast.error('継承タイプを選択し、最低2つのフラグメントを選択してください')
      return
    }

    executeMutation.mutate({
      fragment_ids: selectedFragmentIds,
      inheritance_type: selectedType,
    })
  }

  return {
    // 状態
    selectedFragmentIds,
    selectedType,
    setSelectedType,

    // クエリ結果
    preview: previewQuery.data,
    isLoadingPreview: previewQuery.isLoading,
    history: historyQuery.data,
    isLoadingHistory: historyQuery.isLoading,
    enhancements: enhancementsQuery.data,
    isLoadingEnhancements: enhancementsQuery.isLoading,

    // ミューテーション
    isExecuting: executeMutation.isPending,
    executionResult: executeMutation.data,

    // アクション
    toggleFragmentSelection,
    clearSelection,
    executeInheritance,
  }
}

// 記憶継承画面用の拡張フック
export function useMemoryInheritanceScreen(characterId: string) {
  const memoryInheritance = useMemoryInheritance(characterId)
  const { fragments, isLoading: isLoadingFragments } =
    useLogFragments(characterId)

  // 継承可能なフラグメントのみをフィルタ（ARCHITECTレアリティのフラグメントなど）
  const inheritableFragments =
    fragments?.filter(
      (f: LogFragment) => f.metadata?.is_memory_fragment === true
    ) || []

  return {
    ...memoryInheritance,
    fragments: inheritableFragments,
    isLoadingFragments,
    canExecute:
      memoryInheritance.selectedFragmentIds.length >= 2 &&
      memoryInheritance.selectedType !== null &&
      !memoryInheritance.isExecuting,
  }
}
