/**
 * Custom hook for character titles management
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { equipTitle, getEquippedTitle, getTitles, unequipAllTitles } from '@/api/titles'
import { useToast } from '@/hooks/useToast'

export const useTitles = () => {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Get all titles
  const {
    data: titles = [],
    isLoading: isLoadingTitles,
    error: titlesError,
  } = useQuery({
    queryKey: ['titles'],
    queryFn: getTitles,
  })

  // Get equipped title
  const {
    data: equippedTitle,
    isLoading: isLoadingEquipped,
    error: equippedError,
  } = useQuery({
    queryKey: ['titles', 'equipped'],
    queryFn: getEquippedTitle,
  })

  // Equip title mutation
  const equipTitleMutation = useMutation({
    mutationFn: equipTitle,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['titles'] })
      queryClient.invalidateQueries({ queryKey: ['titles', 'equipped'] })
      toast({
        title: '称号を装備しました',
        description: `「${data.title}」を装備しました`,
      })
    },
    onError: () => {
      toast({
        title: 'エラー',
        description: '称号の装備に失敗しました',
        variant: 'destructive',
      })
    },
  })

  // Unequip all titles mutation
  const unequipAllTitlesMutation = useMutation({
    mutationFn: unequipAllTitles,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['titles'] })
      queryClient.invalidateQueries({ queryKey: ['titles', 'equipped'] })
      toast({
        title: '称号を外しました',
        description: 'すべての称号を外しました',
      })
    },
    onError: () => {
      toast({
        title: 'エラー',
        description: '称号の解除に失敗しました',
        variant: 'destructive',
      })
    },
  })

  return {
    titles,
    equippedTitle,
    isLoading: isLoadingTitles || isLoadingEquipped,
    error: titlesError || equippedError,
    equipTitle: equipTitleMutation.mutate,
    unequipAllTitles: unequipAllTitlesMutation.mutate,
    isEquipping: equipTitleMutation.isPending,
    isUnequipping: unequipAllTitlesMutation.isPending,
  }
}