/**
 * 探索システム用カスタムフック
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { explorationApi } from '@/api/explorationApi'
import { useCharacterStore as usePlayerStore } from '@/stores/characterStore'
import { handleError } from '@/lib/error-handler'

export const useExploration = () => {
  const queryClient = useQueryClient()
  const activeCharacter = usePlayerStore(state => state.getActiveCharacter())
  const characterId = activeCharacter?.id

  // 全ての発見済み場所を取得
  const useAllLocations = () =>
    useQuery({
      queryKey: ['exploration', 'locations'],
      queryFn: () => explorationApi.getAllLocations(),
      enabled: !!characterId,
    })

  // 現在地の情報を取得
  const useCurrentLocation = () =>
    useQuery({
      queryKey: ['exploration', 'current-location', characterId],
      queryFn: () => explorationApi.getCurrentLocation(characterId!),
      enabled: !!characterId,
      staleTime: 5 * 60 * 1000, // 5分間キャッシュ
    })

  // 現在地から移動可能な場所を取得
  const useAvailableLocations = () =>
    useQuery({
      queryKey: ['exploration', 'available-locations', characterId],
      queryFn: () => explorationApi.getAvailableLocations(characterId!),
      enabled: !!characterId,
    })

  // 現在地の探索可能エリアを取得
  const useExplorationAreas = () =>
    useQuery({
      queryKey: ['exploration', 'areas', characterId],
      queryFn: () => explorationApi.getExplorationAreas(characterId!),
      enabled: !!characterId,
    })

  // 別の場所へ移動
  const useMoveToLocation = () =>
    useMutation({
      mutationFn: ({ connectionId }: { connectionId: number }) =>
        explorationApi.moveToLocation(characterId!, {
          connection_id: connectionId,
        }),
      onSuccess: data => {
        toast.success(`${data.new_location.name}に移動しました`)

        // 関連するクエリを無効化
        queryClient.invalidateQueries({
          queryKey: ['exploration', 'current-location', characterId],
        })
        queryClient.invalidateQueries({
          queryKey: ['exploration', 'available-locations', characterId],
        })
        queryClient.invalidateQueries({
          queryKey: ['exploration', 'areas', characterId],
        })
        queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })
      },
      onError: error => {
        handleError(error, 'Failed to move to location')
      },
    })

  // エリアを探索
  const useExploreArea = () =>
    useMutation({
      mutationFn: ({ areaId }: { areaId: number }) =>
        explorationApi.exploreArea(characterId!, { area_id: areaId }),
      onSuccess: data => {
        if (data.fragments_found.length > 0) {
          toast.success(
            `${data.fragments_found.length}個のログフラグメントを発見しました！`
          )
        } else {
          toast.info('今回の探索では何も見つかりませんでした')
        }

        // 関連するクエリを無効化
        queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })
        queryClient.invalidateQueries({ queryKey: ['logs', 'fragments'] })
      },
      onError: error => {
        handleError(error, 'Failed to explore area')
      },
    })

  return {
    // Queries
    useAllLocations,
    useCurrentLocation,
    useAvailableLocations,
    useExplorationAreas,

    // Mutations
    useMoveToLocation,
    useExploreArea,
  }
}
