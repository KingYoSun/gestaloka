/**
 * SPシステム関連のカスタムフック
 */

import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { showSuccessToast, showErrorToast, showInfoToast } from '@/utils/toast'
import { websocketManager } from '@/lib/websocket/socket'
import type { PlayerSP, SPConsumeRequest } from '@/types/sp'

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
  const queryClient = useQueryClient()

  // WebSocketでSP更新イベントを受信したら自動的に再取得
  useEffect(() => {
    const handleSPUpdate = (data: {
      current_sp: number
      amount_changed: number
      transaction_type: string
      description: string
    }) => {
      // クエリを無効化して最新データを取得
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })

      // キャッシュを直接更新（楽観的更新）
      queryClient.setQueryData(['sp', 'balance', 'summary'], (oldData: any) => {
        if (!oldData) return oldData
        return {
          ...oldData,
          current_sp: data.current_sp,
        }
      })

      // ユーザーへの通知（重要な変更のみ）
      const isIncrease = data.amount_changed > 0
      const isSignificant = Math.abs(data.amount_changed) >= 10

      if (isSignificant) {
        if (isIncrease) {
          showSuccessToast(
            'SPを獲得しました',
            `${data.description} (+${data.amount_changed} SP)`
          )
        } else {
          showInfoToast(
            'SPを消費しました',
            `${data.description} (${data.amount_changed} SP)`
          )
        }
      }
    }

    const handleSPInsufficient = (data: {
      required_amount: number
      current_sp: number
      action: string
      message: string
    }) => {
      showErrorToast(new Error(data.message), 'SP不足')
    }

    const handleDailyRecovery = (data: {
      success: boolean
      total_amount: number
      message: string
    }) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })
        showSuccessToast('日次回復完了', data.message)
      }
    }

    websocketManager.on('sp:update', handleSPUpdate)
    websocketManager.on('sp:insufficient', handleSPInsufficient)
    websocketManager.on('sp:daily_recovery', handleDailyRecovery)

    return () => {
      websocketManager.off('sp:update', handleSPUpdate)
      websocketManager.off('sp:insufficient', handleSPInsufficient)
      websocketManager.off('sp:daily_recovery', handleDailyRecovery)
    }
  }, [queryClient])

  return useQuery({
    queryKey: ['sp', 'balance', 'summary'],
    queryFn: () => apiClient.getSPBalanceSummary(),
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

  return useMutation({
    mutationFn: (request: SPConsumeRequest) => apiClient.consumeSP(request),
    onSuccess: response => {
      // 残高情報を更新
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })
      queryClient.invalidateQueries({ queryKey: ['sp', 'transactions'] })

      showSuccessToast('SP消費完了', response.message)
    },
    onError: (error: unknown) => {
      const errorResponse = (error as any)?.response
      const errorMessage =
        errorResponse?.data?.detail || 'SPの消費に失敗しました'
      
      // SP不足エラーの特別処理
      if (errorResponse?.status === 400 && errorMessage.includes('SP不足')) {
        // SP不足の場合は特別なメッセージ
        showErrorToast(
          new Error(errorMessage + '\nSPを回復するか、より簡単な行動を選択してください。'),
          'SP不足'
        )
      } else {
        showErrorToast(new Error(errorMessage), 'SP消費エラー')
      }
    },
  })
}

/**
 * 日次SP回復を処理するフック
 */
export function useDailyRecovery() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => apiClient.processDailyRecovery(),
    onSuccess: response => {
      // 残高情報を更新
      queryClient.invalidateQueries({ queryKey: ['sp', 'balance'] })
      queryClient.invalidateQueries({ queryKey: ['sp', 'transactions'] })

      showSuccessToast('日次回復完了', response.message)
    },
    onError: (error: unknown) => {
      const errorMessage =
        (error as any)?.response?.data?.detail || '日次回復の処理に失敗しました'

      // 既に回復済みの場合は警告として表示
      if (errorMessage.includes('既に完了')) {
        showInfoToast('日次回復済み', errorMessage)
      } else {
        showErrorToast(new Error(errorMessage), '日次回復エラー')
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
    queryFn: () =>
      transactionId ? apiClient.getSPTransaction(transactionId) : null,
    enabled: !!transactionId,
  })
}

/**
 * SP残高の変更を監視するフック
 */
export function useSPBalanceSubscription(
  callback?: (balance: PlayerSP) => void
) {
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
