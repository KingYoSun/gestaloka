import { useQuery } from '@tanstack/react-query'
import { configApi } from '@/lib/api'
import type { ValidationRules } from '@/types/validation'

async function fetchValidationRules(): Promise<ValidationRules> {
  const response = await configApi.getValidationRulesApiV1ConfigGameValidationRulesGet()
  return response.data as ValidationRules
}

export function useValidationRules() {
  return useQuery({
    queryKey: ['validationRules'],
    queryFn: fetchValidationRules,
    staleTime: 1000 * 60 * 60 * 24, // 24時間キャッシュ
    gcTime: 1000 * 60 * 60 * 24, // 24時間保持
  })
}
