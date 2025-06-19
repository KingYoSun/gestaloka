import { Button, ButtonProps } from '@/components/ui/button'
import { Loader2, LucideIcon } from 'lucide-react'
import { forwardRef } from 'react'

interface LoadingButtonProps extends ButtonProps {
  isLoading?: boolean
  loadingText?: string
  icon?: LucideIcon
}

export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ isLoading, loadingText = '処理中...', icon: Icon, children, disabled, ...props }, ref) => (
    <Button ref={ref} disabled={disabled || isLoading} {...props}>
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {loadingText}
        </>
      ) : (
        <>
          {Icon && <Icon className="mr-2 h-4 w-4" />}
          {children}
        </>
      )}
    </Button>
  )
)

LoadingButton.displayName = 'LoadingButton'