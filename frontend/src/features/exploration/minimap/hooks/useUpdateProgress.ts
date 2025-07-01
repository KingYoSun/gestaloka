/**
 * 探索進捗更新用フック
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import type { UpdateProgressRequest, ExplorationProgress } from '../types'

export function useUpdateProgress(characterId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (request: UpdateProgressRequest) => {
      const response = await axios.post(
        `/api/v1/exploration/${characterId}/update-progress`,
        request
      )
      return response.data as ExplorationProgress
    },
    onSuccess: () => {
      // マップデータを再取得
      queryClient.invalidateQueries({
        queryKey: ['exploration', 'map-data', characterId],
      })
    },
  })
}