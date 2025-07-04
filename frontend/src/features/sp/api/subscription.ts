/**
 * SPサブスクリプションAPI
 */

import { apiClient } from '@/api/client'
import type {
  SPSubscriptionCancel,
  SPSubscriptionCreate,
  SPSubscriptionListResponse,
  SPSubscriptionPurchaseResponse,
  SPSubscriptionResponse,
  SPSubscriptionUpdate,
  SubscriptionPlansResponse,
} from '../types/subscription'

const BASE_PATH = '/api/v1/sp/subscriptions'

export const spSubscriptionApi = {
  /**
   * 利用可能なサブスクリプションプラン一覧を取得
   */
  getPlans: async (): Promise<SubscriptionPlansResponse> => {
    return await apiClient.get<SubscriptionPlansResponse>(`${BASE_PATH}/plans`)
  },

  /**
   * 現在有効なサブスクリプションを取得
   */
  getCurrent: async (): Promise<SPSubscriptionResponse> => {
    return await apiClient.get<SPSubscriptionResponse>(`${BASE_PATH}/current`)
  },

  /**
   * サブスクリプション履歴を取得
   */
  getHistory: async (): Promise<SPSubscriptionListResponse> => {
    return await apiClient.get<SPSubscriptionListResponse>(
      `${BASE_PATH}/history`
    )
  },

  /**
   * サブスクリプションを購入
   */
  purchase: async (
    data: SPSubscriptionCreate
  ): Promise<SPSubscriptionPurchaseResponse> => {
    return await apiClient.post<SPSubscriptionPurchaseResponse>(
      `${BASE_PATH}/purchase`,
      data
    )
  },

  /**
   * サブスクリプションをキャンセル
   */
  cancel: async (
    data: SPSubscriptionCancel
  ): Promise<{ success: boolean; message: string }> => {
    return await apiClient.post<{ success: boolean; message: string }>(
      `${BASE_PATH}/cancel`,
      data
    )
  },

  /**
   * サブスクリプションを更新
   */
  update: async (
    data: SPSubscriptionUpdate
  ): Promise<{ success: boolean; message: string }> => {
    return await apiClient.patch<{ success: boolean; message: string }>(
      `${BASE_PATH}/update`,
      data
    )
  },
}
