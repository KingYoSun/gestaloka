/**
 * SP購入関連のカスタムフック
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { spPurchaseApi } from '@/api/sp-purchase'
import { useToast } from '@/hooks/useToast'
import type {
  PurchaseRequest,
  PurchaseResponse,
  PurchaseStatus,
  StripeCheckoutRequest,
} from '@/api/sp-purchase'

/**
 * SPプラン一覧を取得するフック
 */
export function useSPPlans() {
  return useQuery({
    queryKey: ['sp', 'plans'],
    queryFn: () => spPurchaseApi.getPlans(),
    staleTime: 5 * 60 * 1000, // 5分
  })
}

/**
 * SP購入を作成するフック
 */
export function useCreatePurchase() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (request: PurchaseRequest) =>
      spPurchaseApi.createPurchase(request),
    onSuccess: (response: PurchaseResponse) => {
      // 購入履歴を更新
      queryClient.invalidateQueries({ queryKey: ['sp', 'purchases'] })
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })

      if (response.checkout_url) {
        // Stripeチェックアウトに遷移
        window.location.href = response.checkout_url
      } else if (response.status === 'completed') {
        // テストモードで即時完了の場合
        toast({
          title: 'SP購入完了',
          description:
            response.message || `${response.sp_amount} SPを購入しました`,
          variant: 'success',
        })
      }
    },
    onError: (error: any) => {
      const errorMessage =
        error?.response?.data?.detail || 'SP購入に失敗しました'
      toast({
        title: 'SP購入エラー',
        description: errorMessage,
        variant: 'destructive',
      })
    },
  })
}

/**
 * 購入履歴を取得するフック
 */
export function useSPPurchases(params?: {
  status?: PurchaseStatus
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: ['sp', 'purchases', params],
    queryFn: () => spPurchaseApi.getPurchases(params),
    staleTime: 60 * 1000, // 1分
  })
}

/**
 * 購入詳細を取得するフック
 */
export function useSPPurchaseDetail(purchaseId: string | null) {
  return useQuery({
    queryKey: ['sp', 'purchases', purchaseId],
    queryFn: () =>
      purchaseId ? spPurchaseApi.getPurchaseDetail(purchaseId) : null,
    enabled: !!purchaseId,
  })
}

/**
 * 購入をキャンセルするフック
 */
export function useCancelPurchase() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (purchaseId: string) =>
      spPurchaseApi.cancelPurchase(purchaseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sp', 'purchases'] })
      toast({
        title: '購入キャンセル完了',
        description: 'SP購入をキャンセルしました',
        variant: 'success',
      })
    },
    onError: (error: any) => {
      const errorMessage =
        error?.response?.data?.detail || '購入のキャンセルに失敗しました'
      toast({
        title: 'キャンセルエラー',
        description: errorMessage,
        variant: 'destructive',
      })
    },
  })
}

/**
 * 購入統計を取得するフック
 */
export function useSPPurchaseStats() {
  return useQuery({
    queryKey: ['sp', 'purchase-stats'],
    queryFn: () => spPurchaseApi.getPurchaseStats(),
    staleTime: 5 * 60 * 1000, // 5分
  })
}

/**
 * Stripeチェックアウトセッションを作成するフック
 */
export function useCreateStripeCheckout() {
  const { toast } = useToast()

  return useMutation({
    mutationFn: (request: StripeCheckoutRequest) =>
      spPurchaseApi.createStripeCheckout(request),
    onSuccess: response => {
      // Stripeチェックアウトに遷移
      window.location.href = response.checkout_url
    },
    onError: (error: any) => {
      const errorMessage =
        error?.response?.data?.detail || 'チェックアウトの作成に失敗しました'
      toast({
        title: 'チェックアウトエラー',
        description: errorMessage,
        variant: 'destructive',
      })
    },
  })
}
