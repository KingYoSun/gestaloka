import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { spPurchaseApi, type PurchaseStatus } from '@/api/sp-purchase'

export const useSPPlans = () => {
  return useQuery({
    queryKey: ['sp-plans'],
    queryFn: spPurchaseApi.getPlans,
    staleTime: 5 * 60 * 1000, // 5分間キャッシュ
  })
}

export const useCreatePurchase = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: spPurchaseApi.createPurchase,
    onSuccess: data => {
      // 購入履歴とSP残高を更新
      queryClient.invalidateQueries({ queryKey: ['sp-purchases'] })
      queryClient.invalidateQueries({ queryKey: ['sp-balance'] })

      if (data.status === 'completed') {
        toast.success('SP購入が完了しました')
      } else {
        toast.success(data.message || '購入申請を受け付けました')
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'SP購入に失敗しました')
    },
  })
}

export const useSPPurchases = (params?: {
  status?: PurchaseStatus
  limit?: number
  offset?: number
}) => {
  return useQuery({
    queryKey: ['sp-purchases', params],
    queryFn: () => spPurchaseApi.getPurchases(params),
  })
}

export const useSPPurchaseDetail = (purchaseId: string, enabled = true) => {
  return useQuery({
    queryKey: ['sp-purchase', purchaseId],
    queryFn: () => spPurchaseApi.getPurchaseDetail(purchaseId),
    enabled,
  })
}

export const useCancelPurchase = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: spPurchaseApi.cancelPurchase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sp-purchases'] })
      queryClient.invalidateQueries({ queryKey: ['sp-purchase'] })
      toast.success('購入をキャンセルしました')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'キャンセルに失敗しました')
    },
  })
}

export const useSPPurchaseStats = () => {
  return useQuery({
    queryKey: ['sp-purchase-stats'],
    queryFn: spPurchaseApi.getPurchaseStats,
  })
}

export const useCreateStripeCheckout = () => {
  return useMutation({
    mutationFn: spPurchaseApi.createStripeCheckout,
    onError: (error: any) => {
      toast.error(
        error.response?.data?.detail ||
          'Stripeチェックアウトの作成に失敗しました'
      )
    },
  })
}
