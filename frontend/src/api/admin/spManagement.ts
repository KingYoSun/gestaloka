/**
 * Admin SP management API client
 */
import { apiClient } from '../client'

export interface PlayerSPDetail {
  user_id: number
  username: string
  email: string
  current_sp: number
  total_earned: number
  total_consumed: number
  last_daily_recovery: string | null
  consecutive_login_days: number
  created_at: string
  updated_at: string
}

export interface AdminSPAdjustment {
  user_id: number
  amount: number
  reason?: string
}

export interface AdminSPAdjustmentResponse {
  user_id: number
  username: string
  previous_sp: number
  current_sp: number
  adjustment_amount: number
  reason?: string
  adjusted_by: string
  adjusted_at: string
}

export interface SPTransaction {
  id: string
  user_id: number
  amount: number
  transaction_type: string
  description?: string
  balance_after: number
  created_at: string
}

export interface SPTransactionHistory {
  transactions: SPTransaction[]
  total: number
  skip: number
  limit: number
}

export const adminSPManagementApi = {
  /**
   * Get all players' SP information
   */
  getAllPlayersSP: async (params?: {
    skip?: number
    limit?: number
    search?: string
  }): Promise<PlayerSPDetail[]> => {
    return await apiClient.get<PlayerSPDetail[]>('/api/v1/admin/sp/players', { params })
  },

  /**
   * Get specific player's SP detail
   */
  getPlayerSPDetail: async (userId: string): Promise<PlayerSPDetail> => {
    return await apiClient.get<PlayerSPDetail>(`/api/v1/admin/sp/players/${userId}`)
  },

  /**
   * Get player's SP transaction history
   */
  getPlayerTransactions: async (
    userId: string,
    params?: {
      skip?: number
      limit?: number
      transaction_type?: string
    }
  ): Promise<SPTransactionHistory> => {
    return await apiClient.get<SPTransactionHistory>(
      `/api/v1/admin/sp/players/${userId}/transactions`,
      { params }
    )
  },

  /**
   * Adjust player's SP
   */
  adjustPlayerSP: async (
    adjustment: AdminSPAdjustment
  ): Promise<AdminSPAdjustmentResponse> => {
    return await apiClient.post<AdminSPAdjustmentResponse>('/api/v1/admin/sp/adjust', adjustment)
  },

  /**
   * Batch adjust multiple players' SP
   */
  batchAdjustSP: async (
    adjustments: AdminSPAdjustment[]
  ): Promise<AdminSPAdjustmentResponse[]> => {
    return await apiClient.post<AdminSPAdjustmentResponse[]>(
      '/api/v1/admin/sp/batch-adjust',
      adjustments
    )
  },
}
