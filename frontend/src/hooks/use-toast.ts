/**
 * トースト通知のカスタムフック
 * shadcn/uiのトーストコンポーネントを使用
 */
import { toast as showToast } from 'sonner'

interface ToastOptions {
  title?: string
  description?: string
  variant?: 'default' | 'destructive' | 'success'
  duration?: number
}

export function toast(options: ToastOptions) {
  const { title, description, variant = 'default', duration = 4000 } = options

  const message = title || ''
  const config = {
    description,
    duration,
  }

  switch (variant) {
    case 'destructive':
      showToast.error(message, config)
      break
    case 'success':
      showToast.success(message, config)
      break
    default:
      showToast(message, config)
  }
}

// デフォルトフック
export function useToast() {
  return {
    toast,
  }
}
