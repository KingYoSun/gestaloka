/**
 * SPサブスクリプションAPI
 */

import { spSubscriptionsApi } from '@/lib/api'
import type {
  SPSubscriptionCancel,
  SPSubscriptionCreate,
  SPSubscriptionListResponse,
  SPSubscriptionPurchaseResponse,
  SPSubscriptionResponse,
  SPSubscriptionUpdate,
  SubscriptionPlansResponse,
} from '@/api/generated/models'

export const spSubscriptionApi = {
  /**
   * 利用可能なサブスクリプションプラン一覧を取得
   */
  getPlans: async (): Promise<SubscriptionPlansResponse> => {
    const response = await spSubscriptionsApi.getSubscriptionPlansApiV1SpSubscriptionsPlansGet({})
    return response.data
  },

  /**
   * 現在有効なサブスクリプションを取得
   */
  getCurrent: async (): Promise<SPSubscriptionResponse> => {
    const response = await spSubscriptionsApi.getCurrentSubscriptionApiV1SpSubscriptionsCurrentGet({})
    return response.data
  },

  /**
   * サブスクリプション履歴を取得
   */
  getHistory: async (): Promise<SPSubscriptionListResponse> => {
    const response = await spSubscriptionsApi.getSubscriptionHistoryApiV1SpSubscriptionsHistoryGet({})
    return response.data
  },

  /**
   * サブスクリプションを購入
   */
  purchase: async (
    data: SPSubscriptionCreate
  ): Promise<SPSubscriptionPurchaseResponse> => {
    const response = await spSubscriptionsApi.purchaseSubscriptionApiV1SpSubscriptionsPurchasePost({
      sPSubscriptionCreate: data,
    })
    return response.data
  },

  /**
   * サブスクリプションをキャンセル
   */
  cancel: async (
    data: SPSubscriptionCancel
  ): Promise<{ success: boolean; message: string }> => {
    const response = await spSubscriptionsApi.cancelSubscriptionApiV1SpSubscriptionsCancelPost({
      sPSubscriptionCancel: data,
    })
    return response.data
  },

  /**
   * サブスクリプションを更新
   */
  update: async (
    data: SPSubscriptionUpdate
  ): Promise<{ success: boolean; message: string }> => {
    const response = await spSubscriptionsApi.updateSubscriptionApiV1SpSubscriptionsUpdatePut({
      sPSubscriptionUpdate: data,
    })
    return response.data
  },
}
