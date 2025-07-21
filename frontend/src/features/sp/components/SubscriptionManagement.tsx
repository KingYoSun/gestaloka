/**
 * サブスクリプション管理画面
 */

import { useState } from 'react'
import { Calendar, CreditCard, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useCancelSubscription,
  useCurrentSubscription,
  useUpdateSubscription,
} from '../hooks/useSubscription'
import { SPSubscriptionType } from '@/api/generated/models'
import { formatDate } from '@/lib/utils'

export const SubscriptionManagement = () => {
  const { data: subscription, isLoading, error } = useCurrentSubscription()
  const updateMutation = useUpdateSubscription()
  const cancelMutation = useCancelSubscription()
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [cancelImmediate, setCancelImmediate] = useState(false)

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    )
  }

  if (error || !subscription) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          有効なサブスクリプションがありません
        </AlertDescription>
      </Alert>
    )
  }

  const handleAutoRenewToggle = (checked: boolean) => {
    updateMutation.mutate({ auto_renew: checked })
  }

  const handleCancel = () => {
    cancelMutation.mutate({
      immediate: cancelImmediate,
      reason: '手動キャンセル',
    })
    setShowCancelDialog(false)
  }

  const getStatusBadge = () => {
    switch (subscription.status) {
      case 'active':
        return <Badge className="bg-green-500">有効</Badge>
      case 'cancelled':
        return <Badge variant="secondary">キャンセル済み</Badge>
      case 'expired':
        return <Badge variant="destructive">期限切れ</Badge>
      case 'pending':
        return <Badge variant="outline">処理中</Badge>
      default:
        return <Badge variant="secondary">{subscription.status}</Badge>
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>サブスクリプション管理</CardTitle>
            {getStatusBadge()}
          </div>
          <CardDescription>
            {subscription.subscription_type === SPSubscriptionType.Basic
              ? 'ベーシックパス'
              : 'プレミアムパス'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* 基本情報 */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                開始日:{' '}
                {subscription.started_at
                  ? formatDate(subscription.started_at)
                  : '-'}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                有効期限:{' '}
                {subscription.expires_at
                  ? formatDate(subscription.expires_at)
                  : '-'}
              </span>
            </div>

            {subscription.days_remaining !== undefined && subscription.days_remaining !== null && (
              <Alert
                className={
                  subscription.days_remaining <= 7 ? 'border-yellow-500' : ''
                }
              >
                <AlertDescription>
                  残り {subscription.days_remaining} 日で更新されます
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* 自動更新設定 */}
          {subscription.status === 'active' && (
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto-renew">自動更新</Label>
                <p className="text-sm text-muted-foreground">
                  期限が来たら自動的に更新されます
                </p>
              </div>
              <Switch
                id="auto-renew"
                checked={subscription.auto_renew}
                onCheckedChange={handleAutoRenewToggle}
                disabled={updateMutation.isPending}
              />
            </div>
          )}

          {/* 次回請求日 */}
          {subscription.auto_renew && subscription.next_billing_date && (
            <div className="flex items-center space-x-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                次回請求日: {formatDate(subscription.next_billing_date)}
              </span>
            </div>
          )}

          {/* 試用期間 */}
          {subscription.is_trial && subscription.trial_end && (
            <Alert>
              <AlertDescription>
                試用期間中です（{formatDate(subscription.trial_end)} まで）
              </AlertDescription>
            </Alert>
          )}

          {/* キャンセルボタン */}
          {subscription.status === 'active' && (
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => setShowCancelDialog(true)}
              disabled={cancelMutation.isPending}
            >
              サブスクリプションをキャンセル
            </Button>
          )}

          {/* キャンセル済みの場合 */}
          {subscription.status === 'cancelled' &&
            subscription.cancelled_at && (
              <Alert>
                <AlertDescription>
                  {formatDate(subscription.cancelled_at)} にキャンセルされました
                  {subscription.expires_at && (
                    <>
                      <br />
                      {formatDate(subscription.expires_at)} まで利用可能です
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}
        </CardContent>
      </Card>

      {/* キャンセル確認ダイアログ */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>サブスクリプションをキャンセルしますか？</DialogTitle>
            <DialogDescription>
              キャンセルすると、サブスクリプション特典が利用できなくなります。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="cancel-immediate"
                checked={cancelImmediate}
                onCheckedChange={setCancelImmediate}
              />
              <Label htmlFor="cancel-immediate">
                即座にキャンセル（残り期間も無効にする）
              </Label>
            </div>

            {!cancelImmediate && (
              <Alert>
                <AlertDescription>
                  期限まで利用可能です。自動更新のみ停止されます。
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(false)}
            >
              戻る
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
            >
              キャンセルする
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
