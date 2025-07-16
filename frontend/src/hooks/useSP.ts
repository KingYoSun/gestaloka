/**
 * SPシステム関連のカスタムフック
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { spApi } from '@/lib/api'
import { useToast } from '@/hooks/useToast'
import type { PlayerSPRead, PlayerSPSummary, SPConsumeRequest } from '@/api/generated/models'

/**
 * SP残高を取得するフック
 */
export function useSPBalance() {
  return useQuery({
    queryKey: ['sp', 'balance'],
    queryFn: () => spApi.getSpBalanceApiV1SpBalanceGet(),
    staleTime: 30 * 1000, // 30秒
  })
}

/**
 * SP残高の概要を取得するフック（軽量版）
 */
export function useSPBalanceSummary() {
  return useQuery({
    queryKey: ['sp', 'balance', 'summary'],
    queryFn: () => spApi.getSpBalanceSummaryApiV1SpBalanceSummaryGet(),
    staleTime: 5 * 1000, // 5秒
    refetchInterval: 30 * 1000, // 30秒ごとに自動更新
    refetchIntervalInBackground: true, // バックグラウンドでも更新
  })
}

/**
 * SPを消費するフック
 */
export function useConsumeSP() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (request: SPConsumeRequest) => spApi.consumeSpApiV1SpConsumePost({ sPConsumeRequest: request }),
    onSuccess: response => {
      // 残高情報を更新
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })
      queryClient.invalidateQueries({ queryKey: ['sp', 'transactions'] })

      toast({
        title: 'SP消費完了',
        description: response.data.message,
        variant: 'success',
      })
    },
    onError: (error: unknown) => {
      const errorResponse = (error as any)?.response
      const errorMessage =
        errorResponse?.data?.detail || 'SPの消費に失敗しました'

      // SP不足エラーの特別処理
      if (errorResponse?.status === 400 && errorMessage.includes('SP不足')) {
        // SP不足の場合は特別なメッセージ
        toast({
          title: 'SP不足',
          description:
            errorMessage +
            '\nSPを回復するか、より簡単な行動を選択してください。',
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'SP消費エラー',
          description: errorMessage,
          variant: 'destructive',
        })
      }
    },
  })
}

/**
 * 日次SP回復を処理するフック
 */
export function useDailyRecovery() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: () => spApi.processDailyRecoveryApiV1SpDailyRecoveryPost(),
    onSuccess: response => {
      // 残高情報を更新
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })
      queryClient.invalidateQueries({ queryKey: ['sp', 'transactions'] })

      toast({
        title: '日次回復完了',
        description: response.data.message,
        variant: 'success',
      })
    },
    onError: (error: unknown) => {
      const errorMessage =
        (error as any)?.response?.data?.detail || '日次回復の処理に失敗しました'

      // 既に回復済みの場合は警告として表示
      if (errorMessage.includes('既に完了')) {
        toast({
          title: '日次回復済み',
          description: errorMessage,
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
    queryFn: () => spApi.getTransactionHistoryApiV1SpTransactionsGet(params),
    staleTime: 60 * 1000, // 1分
  })
}

/**
 * SP取引詳細を取得するフック
 */
export function useSPTransaction(transactionId: string | null) {
  return useQuery({
    queryKey: ['sp', 'transactions', transactionId],
    queryFn: () =>
      transactionId ? spApi.getTransactionDetailApiV1SpTransactionsTransactionIdGet({ transactionId }) : null,
    enabled: !!transactionId,
  })
}

/**
 * SP残高の変更を監視するフック
 */
export function useSPBalanceSubscription(
  callback?: (balance: PlayerSPRead) => void
) {
  // 定期的に残高を更新（本来はWebSocketで実装）
  // 現在は30秒ごとにポーリング
  useQuery({
    queryKey: ['sp', 'balance', 'subscription'],
    queryFn: async () => {
      const response = await spApi.getSpBalanceApiV1SpBalanceGet()
      if (callback) {
        callback(response.data)
      }
      return response
    },
    refetchInterval: 30 * 1000, // 30秒ごと
    enabled: true,
  })
}
