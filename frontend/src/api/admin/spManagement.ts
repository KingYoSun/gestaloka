/**
 * Admin SP management API client
 */
import { adminApi } from '@/lib/api'
import type {
  PlayerSPDetail,
  AdminSPAdjustment,
  AdminSPAdjustmentResponse,
  SPTransactionHistory,
  SPTransactionType,
} from '@/api/generated/models'

// Re-export types that are used in components
export type { PlayerSPDetail, AdminSPAdjustment }

export const adminSPManagementApi = {
  /**
   * Get all players' SP information
   */
  getAllPlayersSP: async (params?: {
    skip?: number
    limit?: number
    search?: string
  }): Promise<PlayerSPDetail[]> => {
    const response = await adminApi.getAllPlayersSpApiV1AdminAdminSpPlayersGet({
      skip: params?.skip,
      limit: params?.limit,
      search: params?.search,
    })
    return response.data
  },

  /**
   * Get specific player's SP detail
   */
  getPlayerSPDetail: async (userId: string): Promise<PlayerSPDetail> => {
    const response = await adminApi.getPlayerSpDetailApiV1AdminAdminSpPlayersUserIdGet({
      userId,
    })
    return response.data
  },

  /**
   * Get player's SP transaction history
   */
  getPlayerTransactions: async (
    userId: string,
    params?: {
      skip?: number
      limit?: number
      transaction_type?: SPTransactionType
    }
  ): Promise<SPTransactionHistory> => {
    const response = await adminApi.getPlayerSpTransactionsApiV1AdminAdminSpPlayersUserIdTransactionsGet({
      userId,
      skip: params?.skip,
      limit: params?.limit,
      transactionType: params?.transaction_type,
    })
    return response.data
  },

  /**
   * Adjust player's SP
   */
  adjustPlayerSP: async (
    adjustment: AdminSPAdjustment
  ): Promise<AdminSPAdjustmentResponse> => {
    const response = await adminApi.adjustPlayerSpApiV1AdminAdminSpAdjustPost({
      adminSPAdjustment: adjustment,
    })
    return response.data
  },

  /**
   * Batch adjust multiple players' SP
   */
  batchAdjustSP: async (
    adjustments: AdminSPAdjustment[]
  ): Promise<AdminSPAdjustmentResponse[]> => {
    const response = await adminApi.batchAdjustSpApiV1AdminAdminSpBatchAdjustPost({
      adminSPAdjustment: adjustments,
    })
    return response.data
  },
}
