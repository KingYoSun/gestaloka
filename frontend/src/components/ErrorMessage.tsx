/**
 * エラーメッセージコンポーネント
 */
import { AlertCircle, Home, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

interface ErrorMessageProps {
  title?: string
  message?: string
  showRetry?: boolean
  showHome?: boolean
  onRetry?: () => void
}

export function ErrorMessage({
  title = 'エラーが発生しました',
  message = '予期しないエラーが発生しました。',
  showRetry = false,
  showHome = false,
  onRetry,
}: ErrorMessageProps) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="mt-2">
        <p>{message}</p>
        <div className="flex gap-2 mt-4">
          {showRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry || (() => window.location.reload())}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              再試行
            </Button>
          )}
          {showHome && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => (window.location.href = '/dashboard')}
            >
              <Home className="h-4 w-4 mr-2" />
              ホームへ
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}