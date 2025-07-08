/**
 * ローディング画面コンポーネント
 */
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface LoadingScreenProps {
  message?: string
}

export function LoadingScreen({
  message = '読み込み中...',
}: LoadingScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <LoadingSpinner size="lg" />
      <p className="mt-4 text-muted-foreground">{message}</p>
    </div>
  )
}
