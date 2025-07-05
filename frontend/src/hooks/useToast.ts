import { toast } from 'sonner'

interface ToastOptions {
  title: string
  description?: string
  variant?: 'default' | 'destructive' | 'success'
}

export const useToast = () => {
  const showToast = ({ title, description, variant = 'default' }: ToastOptions) => {
    const message = description ? `${title}: ${description}` : title
    
    switch (variant) {
      case 'destructive':
        toast.error(message)
        break
      case 'success':
        toast.success(message)
        break
      default:
        toast(message)
    }
  }

  return { toast: showToast }
}