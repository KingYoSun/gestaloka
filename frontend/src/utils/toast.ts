import { useToast } from '@/hooks/useToast'

// トースト表示のユーティリティ関数
// 注意: これらの関数は React コンポーネント内でのみ使用可能
export const useToastUtils = () => {
  const { toast } = useToast()

  const showSuccessToast = (title: string, description?: string) => {
    toast({
      title,
      description,
      variant: 'success',
    })
  }

  const showErrorToast = (
    error: unknown,
    defaultMessage = 'エラーが発生しました'
  ) => {
    const description = error instanceof Error ? error.message : defaultMessage

    toast({
      title: 'エラー',
      description,
      variant: 'destructive',
    })
  }

  const showInfoToast = (title: string, description?: string) => {
    toast({
      title,
      description,
    })
  }

  return {
    showSuccessToast,
    showErrorToast,
    showInfoToast,
  }
}
