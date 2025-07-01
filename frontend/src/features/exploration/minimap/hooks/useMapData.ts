/**
 * ミニマップデータ取得用フック
 */

import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { MapDataResponse } from '../types'

export function useMapData(characterId: string) {
  return useQuery({
    queryKey: ['exploration', 'map-data', characterId],
    queryFn: async () => {
      const response = await axios.get(`/api/v1/exploration/${characterId}/map-data`)
      return response.data as MapDataResponse
    },
    refetchInterval: 30000, // 30秒ごとに自動更新
  })
}