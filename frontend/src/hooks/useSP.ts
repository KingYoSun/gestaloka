/**
 * SPシステム関連のカスタムフック
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { useToast } from '@/hooks/use-toast'
import type {
  PlayerSP,
  SPConsumeRequest,
} from '@/types/sp'

/**
 * SP残高を取得するフック
 */
export function useSPBalance() {
  return useQuery({
    queryKey: ['sp', 'balance'],
    queryFn: () => apiClient.getSPBalance(),
    staleTime: 30 * 1000, // 30秒
  })
}

/**
 * SP残高の概要を取得するフック（軽量版）
 */
export function useSPBalanceSummary() {
  return useQuery({
    queryKey: ['sp', 'balance', 'summary'],
    queryFn: () => apiClient.getSPBalanceSummary(),
    staleTime: 10 * 1000, // 10秒
  })
}

/**
 * SPを消費するフック
 */
export function useConsumeSP() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: SPConsumeRequest) => apiClient.consumeSP(request),
    onSuccess: (response) => {
      // 残高情報を更新
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })
      queryClient.invalidateQueries({ queryKey: ['sp', 'transactions'] })
      
      toast({
        title: 'SP消費完了',
        description: response.message,
      })
    },
    onError: (error: unknown) => {
      toast({
        title: 'SP消費エラー',
        description: (error as any)?.response?.data?.detail || 'SPの消費に失敗しました',
        variant: 'destructive',
      })
    },
  })
}

/**
 * 日次SP回復を処理するフック
 */
export function useDailyRecovery() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => apiClient.processDailyRecovery(),
    onSuccess: (response) => {
      // 残高情報を更新
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })
      queryClient.invalidateQueries({ queryKey: ['sp', 'transactions'] })
      
      toast({
        title: '日次回復完了',
        description: response.message,
        variant: 'default',
      })
    },
    onError: (error: unknown) => {
      const errorMessage = (error as any)?.response?.data?.detail || '日次回復の処理に失敗しました'
      
      // 既に回復済みの場合は警告として表示
      if (errorMessage.includes('既に完了')) {
        toast({
          title: '日次回復済み',
          description: errorMessage,
          variant: 'default',
        })
      } else {
        toast({
          title: '日次回復エラー',
          description: errorMessage,
          variant: 'destructive',
        })
      }
    },
  })
}

/**
 * SP取引履歴を取得するフック
 */
export function useSPTransactions(params?: {
  transactionType?: string
  startDate?: string
  endDate?: string
  relatedEntityType?: string
  relatedEntityId?: string
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: ['sp', 'transactions', params],
    queryFn: () => apiClient.getSPTransactions(params),
    staleTime: 60 * 1000, // 1分
  })
}

/**
 * SP取引詳細を取得するフック
 */
export function useSPTransaction(transactionId: string | null) {
  return useQuery({
    queryKey: ['sp', 'transactions', transactionId],
    queryFn: () => transactionId ? apiClient.getSPTransaction(transactionId) : null,
    enabled: !!transactionId,
  })
}

/**
 * SP残高の変更を監視するフック
 */
export function useSPBalanceSubscription(callback?: (balance: PlayerSP) => void) {

  // 定期的に残高を更新（本来はWebSocketで実装）
  // 現在は30秒ごとにポーリング
  useQuery({
    queryKey: ['sp', 'balance', 'subscription'],
    queryFn: async () => {
      const balance = await apiClient.getSPBalance()
      if (callback) {
        callback(balance)
      }
      return balance
    },
    refetchInterval: 30 * 1000, // 30秒ごと
    enabled: true,
  })
}