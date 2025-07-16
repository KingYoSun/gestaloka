import { spApi, stripeApi } from '@/lib/api'
import type {
  SPPlan,
  SPPlanResponse,
  PurchaseRequest,
  PurchaseResponse,
  SPPurchaseDetail,
  SPPurchaseList,
  SPPurchaseStats,
  StripeCheckoutRequest,
  StripeCheckoutResponse,
  PurchaseStatus,
  PaymentMode,
} from '@/api/generated/models'

// 型の再エクスポート
export type {
  SPPlan,
  SPPlanResponse,
  PurchaseRequest,
  PurchaseResponse,
  SPPurchaseDetail,
  SPPurchaseList,
  SPPurchaseStats,
  StripeCheckoutRequest,
  StripeCheckoutResponse,
}

export { PurchaseStatus, PaymentMode }

// API関数
export const spPurchaseApi = {
  // プラン一覧取得
  getPlans: async (): Promise<SPPlanResponse> => {
    const response = await spApi.getSpPlansApiV1SpPlansGet()
    return response.data
  },

  // 購入申請作成
  createPurchase: async (
    request: PurchaseRequest
  ): Promise<PurchaseResponse> => {
    const response = await spApi.createPurchaseApiV1SpPurchasePost({
      purchaseRequest: request
    })
    return response.data
  },

  // 購入履歴取得
  getPurchases: async (params?: {
    status?: PurchaseStatus
    limit?: number
    offset?: number
  }): Promise<SPPurchaseList> => {
    const response = await spApi.getUserPurchasesApiV1SpPurchasesGet({
      status: params?.status,
      limit: params?.limit,
      offset: params?.offset,
    })
    return response.data
  },

  // 購入詳細取得
  getPurchaseDetail: async (purchaseId: string): Promise<SPPurchaseDetail> => {
    const response = await spApi.getPurchaseDetailApiV1SpPurchasesPurchaseIdGet({
      purchaseId
    })
    return response.data
  },

  // 購入キャンセル
  cancelPurchase: async (purchaseId: string): Promise<SPPurchaseDetail> => {
    const response = await spApi.cancelPurchaseApiV1SpPurchasesPurchaseIdCancelPost({
      purchaseId
    })
    return response.data
  },

  // 購入統計取得
  getPurchaseStats: async (): Promise<SPPurchaseStats> => {
    const response = await spApi.getPurchaseStatsApiV1SpPurchaseStatsGet()
    return response.data
  },

  // Stripeチェックアウトセッション作成
  createStripeCheckout: async (
    request: StripeCheckoutRequest
  ): Promise<StripeCheckoutResponse> => {
    const response = await spApi.createStripeCheckoutApiV1SpStripeCheckoutPost({
      stripeCheckoutRequest: request
    })
    return response.data
  },
}