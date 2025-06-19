import { toast } from '@/hooks/use-toast'

export const showSuccessToast = (title: string, description?: string) => {
  toast({
    title,
    description,
    variant: 'success',
  })
}

export const showErrorToast = (error: unknown, defaultMessage = 'エラーが発生しました') => {
  const description = error instanceof Error ? error.message : defaultMessage
  
  toast({
    title: 'エラー',
    description,
    variant: 'destructive',
  })
}

export const showInfoToast = (title: string, description?: string) => {
  toast({
    title,
    description,
  })
}