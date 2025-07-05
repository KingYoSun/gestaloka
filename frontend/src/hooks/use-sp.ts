import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import type { PlayerSPSummary } from '@/types/sp'

// APIレスポンス用の型（スネークケース）
interface PlayerSPResponse {
  user_id: string
  current_sp: number
  max_sp: number
  daily_recovery_available: boolean
  recovery_amount: number
  last_recovery_at: string | null
  consecutive_days: number
  subscription_active: boolean
  created_at: string
  updated_at: string
}

export const usePlayerSP = () => {
  return useQuery<PlayerSPResponse>({
    queryKey: ['sp-balance'],
    queryFn: async () => {
      return await apiClient.get<PlayerSPResponse>('/api/v1/sp/balance')
    },
    refetchInterval: 30000, // 30秒ごとに更新
  })
}

export const usePlayerSPSummary = () => {
  return useQuery<PlayerSPSummary>({
    queryKey: ['sp-balance-summary'],
    queryFn: async () => {
      return await apiClient.get<PlayerSPSummary>('/api/v1/sp/balance/summary')
    },
    refetchInterval: 30000, // 30秒ごとに更新
  })
}
