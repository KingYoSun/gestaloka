/**
 * SPサブスクリプション関連のカスタムフック
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/hooks/useToast'
import { spSubscriptionApi } from '../api/subscription'
import type {
  SPSubscriptionCancel,
  SPSubscriptionCreate,
  SPSubscriptionUpdate,
} from '@/api/generated/models'

export const useSubscriptionPlans = () => {
  return useQuery({
    queryKey: ['subscription', 'plans'],
    queryFn: spSubscriptionApi.getPlans,
  })
}

export const useCurrentSubscription = () => {
  return useQuery({
    queryKey: ['subscription', 'current'],
    queryFn: spSubscriptionApi.getCurrent,
    retry: (failureCount, error: any) => {
      // 404エラーの場合はリトライしない
      if (error?.response?.status === 404) {
        return false
      }
      return failureCount < 3
    },
  })
}

export const useSubscriptionHistory = () => {
  return useQuery({
    queryKey: ['subscription', 'history'],
    queryFn: spSubscriptionApi.getHistory,
  })
}

export const usePurchaseSubscription = () => {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (data: SPSubscriptionCreate) =>
      spSubscriptionApi.purchase(data),
    onSuccess: response => {
      if (response.success) {
        // キャッシュを無効化
        queryClient.invalidateQueries({ queryKey: ['subscription'] })
        queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })

        if (response.test_mode) {
          toast({
            title: 'サブスクリプション購入完了',
            description: response.message,
          })
        } else if (response.checkout_url) {
          // 本番モードの場合はStripeチェックアウトへリダイレクト
          window.location.href = response.checkout_url
        }
      } else {
        toast({
          title: 'エラー',
          description: response.message,
          variant: 'destructive',
        })
      }
    },
    onError: (error: any) => {
      toast({
        title: 'エラー',
        description:
          error.response?.data?.detail ||
          'サブスクリプションの購入に失敗しました',
        variant: 'destructive',
      })
    },
  })
}

export const useCancelSubscription = () => {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (data: SPSubscriptionCancel) => spSubscriptionApi.cancel(data),
    onSuccess: response => {
      if (response.success) {
        queryClient.invalidateQueries({ queryKey: ['subscription'] })
        toast({
          title: 'キャンセル完了',
          description: response.message,
        })
      } else {
        toast({
          title: 'エラー',
          description: response.message,
          variant: 'destructive',
        })
      }
    },
    onError: (error: any) => {
      toast({
        title: 'エラー',
        description: error.response?.data?.detail || 'キャンセルに失敗しました',
        variant: 'destructive',
      })
    },
  })
}

export const useUpdateSubscription = () => {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (data: SPSubscriptionUpdate) => spSubscriptionApi.update(data),
    onSuccess: response => {
      if (response.success) {
        queryClient.invalidateQueries({ queryKey: ['subscription'] })
        toast({
          title: '更新完了',
          description: response.message,
        })
      } else {
        toast({
          title: 'エラー',
          description: response.message,
          variant: 'destructive',
        })
      }
    },
    onError: (error: any) => {
      toast({
        title: 'エラー',
        description: error.response?.data?.detail || '更新に失敗しました',
        variant: 'destructive',
      })
    },
  })
}
