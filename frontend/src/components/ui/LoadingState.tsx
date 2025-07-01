import { Loader2 } from 'lucide-react'

interface LoadingStateProps {
  message?: string
  className?: string
}

export const LoadingState = ({
  message = '読み込み中...',
  className = '',
}: LoadingStateProps) => (
  <div className={`flex items-center justify-center h-64 ${className}`}>
    <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
    <span className="ml-2 text-lg text-slate-600">{message}</span>
  </div>
)
