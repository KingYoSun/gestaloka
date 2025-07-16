/**
 * ローディングスピナーコンポーネント
 */
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  message?: string
  containerClassName?: string
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
}

export function LoadingSpinner({
  size = 'md',
  className,
  message,
  containerClassName,
}: LoadingSpinnerProps) {
  const spinner = (
    <Loader2 className={cn('animate-spin', sizeClasses[size], className)} />
  )

  if (message) {
    return (
      <div
        className={cn(
          'flex items-center justify-center h-64',
          containerClassName
        )}
      >
        {spinner}
        <span className="ml-2 text-lg text-slate-600">{message}</span>
      </div>
    )
  }

  return spinner
}

// LoadingStateとの互換性のためのエイリアス
export const LoadingState = LoadingSpinner
