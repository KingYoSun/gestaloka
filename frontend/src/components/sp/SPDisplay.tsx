/**
 * SP残高表示コンポーネント
 */

import { memo, useState, useEffect } from 'react'
import {
  Coins,
  TrendingUp,
  Calendar,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { useSPBalanceSummary } from '@/hooks/useSP'
import { SPSubscriptionInfo, SPSubscriptionType } from '@/types/sp'
import { Skeleton } from '@/components/ui/skeleton'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from '@tanstack/react-router'

interface SPDisplayProps {
  className?: string
  showSubscription?: boolean
  variant?: 'default' | 'compact'
  lowBalanceThreshold?: number
}

export const SPDisplay = memo(function SPDisplay({
  className,
  showSubscription = true,
  variant = 'default',
  lowBalanceThreshold = 100,
}: SPDisplayProps) {
  const { data: balance, isLoading, error } = useSPBalanceSummary()
  const [previousBalance, setPreviousBalance] = useState<number | null>(null)
  const [isAnimating, setIsAnimating] = useState(false)

  // SP変更を検知してアニメーション
  useEffect(() => {
    if (
      balance?.current_sp !== undefined &&
      previousBalance !== null &&
      balance.current_sp !== previousBalance
    ) {
      setIsAnimating(true)
      const timer = setTimeout(() => setIsAnimating(false), 1000)
      return () => clearTimeout(timer)
    }
    if (balance?.current_sp !== undefined) {
      setPreviousBalance(balance.current_sp)
    }
  }, [balance?.current_sp, previousBalance])

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Skeleton className="h-6 w-20" />
      </div>
    )
  }

  if (error || !balance) {
    return (
      <div
        className={cn('flex items-center gap-2 text-destructive', className)}
      >
        <AlertCircle className="h-4 w-4" />
        <span className="text-sm">エラー</span>
      </div>
    )
  }

  const subscriptionInfo = balance.active_subscription
    ? SPSubscriptionInfo[balance.active_subscription as SPSubscriptionType]
    : null

  const isLowBalance = balance.current_sp < lowBalanceThreshold
  const balanceChange =
    previousBalance !== null ? balance.current_sp - previousBalance : 0

  if (variant === 'compact') {
    return (
      <Link to="/sp" className="no-underline">
        <motion.div
          className={cn(
            'flex items-center gap-1.5 cursor-pointer relative hover:opacity-80 transition-opacity',
            isLowBalance && 'text-orange-500',
            className
          )}
          animate={
            isAnimating
              ? {
                  scale: [1, 1.1, 1],
                }
              : {}
          }
          transition={{ duration: 0.3 }}
          title={`現在のSP: ${formatNumber(balance.current_sp)}${
            isLowBalance ? ' - SP残高が少なくなっています' : ''
          }${
            subscriptionInfo ? ` - ${subscriptionInfo.label} 加入中` : ''
          } - クリックして詳細を見る`}
        >
          {isLowBalance ? (
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          ) : (
            <Coins className="h-4 w-4 text-yellow-500" />
          )}
          <span
            className={cn(
              'font-semibold',
              isAnimating && balanceChange > 0 && 'text-green-500',
              isAnimating && balanceChange < 0 && 'text-red-500'
            )}
          >
            {formatNumber(balance.current_sp)}
          </span>
          <span className="text-xs text-muted-foreground">SP</span>

          {/* 変更インジケーター */}
          <AnimatePresence>
            {isAnimating && balanceChange !== 0 && (
              <motion.span
                initial={{ opacity: 0, y: 0 }}
                animate={{ opacity: 1, y: -20 }}
                exit={{ opacity: 0 }}
                className={cn(
                  'absolute -top-4 right-0 text-xs font-bold',
                  balanceChange > 0 ? 'text-green-500' : 'text-red-500'
                )}
              >
                {balanceChange > 0 ? '+' : ''}
                {formatNumber(balanceChange)}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </Link>
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
          <span className="text-lg font-bold">
            {formatNumber(balance.current_sp)}
          </span>
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

      {showSubscription && balance.subscription_expires_at && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>
            有効期限:{' '}
            {new Date(balance.subscription_expires_at).toLocaleDateString(
              'ja-JP'
            )}
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
