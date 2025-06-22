/**
 * SP残高表示コンポーネント
 */

import { memo } from 'react'
import { Coins, TrendingUp, Calendar, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSPBalanceSummary } from '@/hooks/useSP'
import { SPSubscriptionInfo } from '@/types/sp'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface SPDisplayProps {
  className?: string
  showSubscription?: boolean
  variant?: 'default' | 'compact'
}

export const SPDisplay = memo(function SPDisplay({
  className,
  showSubscription = true,
  variant = 'default',
}: SPDisplayProps) {
  const { data: balance, isLoading, error } = useSPBalanceSummary()

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Skeleton className="h-6 w-20" />
      </div>
    )
  }

  if (error || !balance) {
    return (
      <div className={cn('flex items-center gap-2 text-destructive', className)}>
        <AlertCircle className="h-4 w-4" />
        <span className="text-sm">エラー</span>
      </div>
    )
  }

  const subscriptionInfo = balance.activeSubscription
    ? SPSubscriptionInfo[balance.activeSubscription]
    : null

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('ja-JP').format(num)
  }

  if (variant === 'compact') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'flex items-center gap-1.5 cursor-default',
                className
              )}
            >
              <Coins className="h-4 w-4 text-yellow-500" />
              <span className="font-semibold">{formatNumber(balance.currentSp)}</span>
              <span className="text-xs text-muted-foreground">SP</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              <p className="text-sm font-medium">現在のSP: {formatNumber(balance.currentSp)}</p>
              {subscriptionInfo && (
                <p className="text-xs text-muted-foreground">
                  {subscriptionInfo.label} 加入中
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 p-4 rounded-lg bg-card border',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-yellow-500" />
          <span className="text-lg font-bold">{formatNumber(balance.currentSp)}</span>
          <span className="text-sm text-muted-foreground">SP</span>
        </div>
        {showSubscription && subscriptionInfo && (
          <div className="flex items-center gap-1.5 text-sm">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-green-600 dark:text-green-400">
              {subscriptionInfo.label}
            </span>
          </div>
        )}
      </div>

      {showSubscription && balance.subscriptionExpiresAt && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>
            有効期限:{' '}
            {new Date(balance.subscriptionExpiresAt).toLocaleDateString('ja-JP')}
          </span>
        </div>
      )}

      {subscriptionInfo && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>• 毎日 +{subscriptionInfo.dailyBonus} SP</p>
          <p>• SP消費 {Math.round(subscriptionInfo.discountRate * 100)}% OFF</p>
        </div>
      )}
    </div>
  )
})