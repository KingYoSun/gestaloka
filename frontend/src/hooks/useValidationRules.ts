import { useQuery } from '@tanstack/react-query'
import { configApi } from '@/lib/api'

interface ValidationRules {
  user: {
    username: {
      min_length: number
      max_length: number
      pattern: string
      pattern_description: string
    }
    password: {
      min_length: number
      max_length: number
      requirements: string[]
    }
  }
  character: {
    name: {
      min_length: number
      max_length: number
    }
    description: {
      max_length: number
    }
    appearance: {
      max_length: number
    }
    personality: {
      max_length: number
    }
  }
  game_action: {
    action_text: {
      max_length: number
    }
  }
}

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
