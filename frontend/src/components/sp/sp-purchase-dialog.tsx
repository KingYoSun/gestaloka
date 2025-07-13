import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  useCreatePurchase,
  useCreateStripeCheckout,
} from '@/hooks/use-sp-purchase'
import type { SPPlan } from '@/api/sp-purchase'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/useToast'

interface SPPurchaseDialogProps {
  plan: SPPlan | null
  isOpen: boolean
  onClose: () => void
  isTestMode?: boolean
}

export function SPPurchaseDialog({
  plan,
  isOpen,
  onClose,
  isTestMode = false,
}: SPPurchaseDialogProps) {
  const [testReason, setTestReason] = useState('')
  const { mutate: createPurchase, isPending: isTestPending } =
    useCreatePurchase()
  const { mutate: createStripeCheckout, isPending: isStripePending } =
    useCreateStripeCheckout()
  const { toast } = useToast()

  const isPending = isTestPending || isStripePending

  if (!plan) return null

  const totalSP =
    plan.sp_amount + Math.floor(plan.sp_amount * (plan.bonus_percentage / 100))

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
    }).format(price)
  }

  const handlePurchase = () => {
    if (isTestMode) {
      if (testReason.length < 10) {
        return
      }

      createPurchase(
        {
          plan_id: plan.id,
          test_reason: testReason,
        },
        {
          onSuccess: () => {
            onClose()
            setTestReason('')
            toast({
              title: '購入申請を受け付けました',
              description: 'SPが付与されました。',
            })
          },
        }
      )
    } else {
      // 本番モード: Stripeチェックアウトへリダイレクト
      createStripeCheckout(
        {
          plan_id: plan.id,
        },
        {
          onSuccess: response => {
            // Stripeチェックアウトページへリダイレクト
            window.location.href = response.checkout_url
          },
          onError: () => {
            toast({
              title: 'エラー',
              description: 'チェックアウトセッションの作成に失敗しました。',
              variant: 'destructive',
            })
          },
        }
      )
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>SP購入確認</DialogTitle>
          <DialogDescription>
            以下の内容でSPを購入します。よろしいですか？
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">プラン</span>
              <span className="font-medium">{plan.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">獲得SP</span>
              <span className="font-medium">{totalSP} SP</span>
            </div>
            {plan.bonus_percentage > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">内訳</span>
                <span className="text-muted-foreground">
                  {plan.sp_amount} SP +{' '}
                  {Math.floor(plan.sp_amount * (plan.bonus_percentage / 100))}{' '}
                  ボーナス
                </span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t">
              <span className="text-muted-foreground">金額</span>
              <span className="font-semibold text-lg">
                {formatPrice(plan.price_jpy)}
              </span>
            </div>
          </div>

          {isTestMode && (
            <div className="space-y-2">
              <Label htmlFor="test-reason">
                申請理由 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="test-reason"
                placeholder="テストプレイのためSPが必要です..."
                value={testReason}
                onChange={e => setTestReason(e.target.value)}
                rows={3}
                className={
                  testReason.length < 10 && testReason.length > 0
                    ? 'border-destructive'
                    : ''
                }
              />
              {testReason.length > 0 && testReason.length < 10 && (
                <p className="text-sm text-destructive">
                  申請理由は10文字以上入力してください
                </p>
              )}
            </div>
          )}

          {isTestMode && (
            <Alert>
              <AlertDescription>
                テストモードのため、実際の決済は行われません。
                申請理由を入力いただくことでSPが付与されます。
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            キャンセル
          </Button>
          <Button
            onClick={handlePurchase}
            disabled={isPending || (isTestMode && testReason.length < 10)}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isTestMode ? '申請する' : '購入する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
