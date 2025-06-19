import { useState, useCallback } from 'react'

export const useFormError = () => {
  const [error, setError] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  const handleAsync = useCallback(async <T>(
    fn: () => Promise<T>,
    customErrorMessage?: string
  ): Promise<T | undefined> => {
    setIsLoading(true)
    setError('')
    try {
      return await fn()
    } catch (err) {
      const errorMessage = customErrorMessage || 
        (err instanceof Error ? err.message : 'エラーが発生しました')
      setError(errorMessage)
      return undefined
    } finally {
      setIsLoading(false)
    }
  }, [])

  const clearError = useCallback(() => setError(''), [])

  return { error, isLoading, handleAsync, setError, clearError }
}