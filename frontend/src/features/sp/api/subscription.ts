/**
 * SPサブスクリプションAPI
 */

import { apiClient } from '@/lib/api/client';
import type {
  SPSubscriptionCancel,
  SPSubscriptionCreate,
  SPSubscriptionListResponse,
  SPSubscriptionPurchaseResponse,
  SPSubscriptionResponse,
  SPSubscriptionUpdate,
  SubscriptionPlansResponse,
} from '../types/subscription';

const BASE_PATH = '/api/v1/sp/subscriptions';

export const spSubscriptionApi = {
  /**
   * 利用可能なサブスクリプションプラン一覧を取得
   */
  getPlans: async (): Promise<SubscriptionPlansResponse> => {
    const response = await apiClient.get(`${BASE_PATH}/plans`);
    return response.data;
  },

  /**
   * 現在有効なサブスクリプションを取得
   */
  getCurrent: async (): Promise<SPSubscriptionResponse> => {
    const response = await apiClient.get(`${BASE_PATH}/current`);
    return response.data;
  },

  /**
   * サブスクリプション履歴を取得
   */
  getHistory: async (): Promise<SPSubscriptionListResponse> => {
    const response = await apiClient.get(`${BASE_PATH}/history`);
    return response.data;
  },

  /**
   * サブスクリプションを購入
   */
  purchase: async (data: SPSubscriptionCreate): Promise<SPSubscriptionPurchaseResponse> => {
    const response = await apiClient.post(`${BASE_PATH}/purchase`, data);
    return response.data;
  },

  /**
   * サブスクリプションをキャンセル
   */
  cancel: async (data: SPSubscriptionCancel): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.post(`${BASE_PATH}/cancel`, data);
    return response.data;
  },

  /**
   * サブスクリプションを更新
   */
  update: async (data: SPSubscriptionUpdate): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.put(`${BASE_PATH}/update`, data);
    return response.data;
  },
};