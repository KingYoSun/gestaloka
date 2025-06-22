/**
 * SP消費確認ダイアログ
 */

import { useState, useEffect } from 'react'
import { Coins, AlertTriangle, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Alert,
  AlertDescription,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useSPBalanceSummary, useConsumeSP } from '@/hooks/useSP'
import { SPSubscriptionInfo, SPTransactionType } from '@/types/sp'
import type { SPConsumeRequest } from '@/types/sp'

interface SPConsumeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  amount: number
  transactionType: SPTransactionType
  description: string
  relatedEntityType?: string
  relatedEntityId?: string
  metadata?: Record<string, unknown>
  onSuccess?: () => void
  onCancel?: () => void
}

export function SPConsumeDialog({
  open,
  onOpenChange,
  amount,
  transactionType,
  description,
  relatedEntityType,
  relatedEntityId,
  metadata,
  onSuccess,
  onCancel,
}: SPConsumeDialogProps) {
  const { data: balance } = useSPBalanceSummary()
  const consumeSP = useConsumeSP()
  const [isConsuming, setIsConsuming] = useState(false)

  // サブスクリプション割引の計算
  const subscriptionInfo = balance?.activeSubscription
    ? SPSubscriptionInfo[balance.activeSubscription]
    : null
  const discountRate = subscriptionInfo?.discountRate || 0
  const finalAmount = Math.floor(amount * (1 - discountRate))
  const discountAmount = amount - finalAmount

  const currentBalance = balance?.currentSp || 0
  const balanceAfter = currentBalance - finalAmount
  const isInsufficient = balanceAfter < 0

  const handleConfirm = async () => {
    if (isInsufficient) return

    setIsConsuming(true)

    const request: SPConsumeRequest = {
      amount,
      transactionType,
      description,
      relatedEntityType,
      relatedEntityId,
      metadata,
    }

    try {
      await consumeSP.mutateAsync(request)
      onSuccess?.()
      onOpenChange(false)
    } catch {
      // エラーはuseMutationのonErrorで処理
    } finally {
      setIsConsuming(false)
    }
  }

  const handleCancel = () => {
    onCancel?.()
    onOpenChange(false)
  }

  // ダイアログが閉じられたときの処理
  useEffect(() => {
    if (!open) {
      setIsConsuming(false)
    }
  }, [open])

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ja-JP').format(num)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-yellow-500" />
            SP消費確認
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 消費詳細 */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">必要SP</span>
              <span className="font-medium">{formatNumber(amount)} SP</span>
            </div>

            {discountRate > 0 && (
              <>
                <div className="flex justify-between items-center text-green-600 dark:text-green-400">
                  <span className="text-sm flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    {subscriptionInfo?.label}割引
                  </span>
                  <span className="font-medium">
                    -{formatNumber(discountAmount)} SP
                  </span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">実際の消費SP</span>
                    <span className="font-bold text-lg">
                      {formatNumber(finalAmount)} SP
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 残高情報 */}
          <div className="space-y-2 p-4 rounded-lg bg-muted/50">
            <div className="flex justify-between items-center">
              <span className="text-sm">現在の残高</span>
              <span className="font-medium">{formatNumber(currentBalance)} SP</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">消費後の残高</span>
              <span
                className={cn(
                  'font-bold',
                  isInsufficient ? 'text-destructive' : ''
                )}
              >
                {formatNumber(balanceAfter)} SP
              </span>
            </div>

            {/* プログレスバー */}
            <div className="pt-2">
              <Progress
                value={isInsufficient ? 100 : (finalAmount / currentBalance) * 100}
                className={cn(
                  'h-2',
                  isInsufficient ? '[&>div]:bg-destructive' : ''
                )}
              />
            </div>
          </div>

          {/* エラーメッセージ */}
          {isInsufficient && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                SP残高が不足しています。
                あと {formatNumber(Math.abs(balanceAfter))} SP必要です。
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isConsuming}
          >
            キャンセル
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isInsufficient || isConsuming}
            className="gap-2"
          >
            {isConsuming ? (
              <>処理中...</>
            ) : (
              <>
                <Coins className="h-4 w-4" />
                {formatNumber(finalAmount)} SP 消費する
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ヘルパー関数
function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(' ')
}