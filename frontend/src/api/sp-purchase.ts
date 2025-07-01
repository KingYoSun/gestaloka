import { apiClient } from './client'

// SP購入関連の型定義
export interface SPPlan {
  id: string
  name: string
  sp_amount: number
  price_jpy: number
  bonus_percentage: number
  popular?: boolean
}

export interface SPPlanResponse {
  plans: SPPlan[]
  payment_mode: 'test' | 'production'
  currency: string
}

export interface PurchaseRequest {
  plan_id: string
  test_reason?: string
}

export enum PurchaseStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum PaymentMode {
  TEST = 'test',
  PRODUCTION = 'production',
}

export interface PurchaseResponse {
  purchase_id: string
  status: PurchaseStatus
  sp_amount: number
  price_jpy: number
  payment_mode: PaymentMode
  checkout_url?: string
  message?: string
}

export interface SPPurchaseDetail {
  id: string
  plan_id: string
  sp_amount: number
  price_jpy: number
  status: PurchaseStatus
  payment_mode: PaymentMode
  test_reason?: string
  created_at: string
  updated_at: string
  approved_at?: string
}

export interface SPPurchaseList {
  purchases: SPPurchaseDetail[]
  total: number
  limit: number
  offset: number
}

export interface SPPurchaseStats {
  total_purchases: number
  total_sp_purchased: number
  total_spent_jpy: number
}

export interface StripeCheckoutRequest {
  plan_id: string
}

export interface StripeCheckoutResponse {
  purchase_id: string
  checkout_url: string
  session_id: string
}

// API関数
export const spPurchaseApi = {
  // プラン一覧取得
  getPlans: async (): Promise<SPPlanResponse> => {
    return await apiClient.get<SPPlanResponse>('/api/v1/sp/plans')
  },

  // 購入申請作成
  createPurchase: async (
    request: PurchaseRequest
  ): Promise<PurchaseResponse> => {
    return await apiClient.post<PurchaseResponse>(
      '/api/v1/sp/purchase',
      request
    )
  },

  // 購入履歴取得
  getPurchases: async (params?: {
    status?: PurchaseStatus
    limit?: number
    offset?: number
  }): Promise<SPPurchaseList> => {
    return await apiClient.get<SPPurchaseList>('/api/v1/sp/purchases', {
      params,
    })
  },

  // 購入詳細取得
  getPurchaseDetail: async (purchaseId: string): Promise<SPPurchaseDetail> => {
    return await apiClient.get<SPPurchaseDetail>(
      `/api/v1/sp/purchases/${purchaseId}`
    )
  },

  // 購入キャンセル
  cancelPurchase: async (purchaseId: string): Promise<SPPurchaseDetail> => {
    return await apiClient.post<SPPurchaseDetail>(
      `/api/v1/sp/purchases/${purchaseId}/cancel`
    )
  },

  // 購入統計取得
  getPurchaseStats: async (): Promise<SPPurchaseStats> => {
    return await apiClient.get<SPPurchaseStats>('/api/v1/sp/purchase-stats')
  },

  // Stripeチェックアウトセッション作成
  createStripeCheckout: async (
    request: StripeCheckoutRequest
  ): Promise<StripeCheckoutResponse> => {
    return await apiClient.post<StripeCheckoutResponse>(
      '/api/v1/sp/stripe/checkout',
      request
    )
  },
}
