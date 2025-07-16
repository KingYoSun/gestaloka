import { createContext, useContext, type ReactNode } from 'react'
import { useValidationRules } from '@/hooks/useValidationRules'
import { Loader2 } from 'lucide-react'

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

const ValidationRulesContext = createContext<ValidationRules | null>(null)

export function ValidationRulesProvider({ children }: { children: ReactNode }) {
  const { data: validationRules, isLoading, error } = useValidationRules()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error) {
    console.error('Failed to load validation rules:', error)
    // フォールバック値を使用
    return (
      <ValidationRulesContext.Provider value={getDefaultValidationRules()}>
        {children}
      </ValidationRulesContext.Provider>
    )
  }

  return (
    <ValidationRulesContext.Provider value={validationRules!}>
      {children}
    </ValidationRulesContext.Provider>
  )
}

export function useValidationRulesContext() {
  const context = useContext(ValidationRulesContext)
  if (!context) {
    throw new Error(
      'useValidationRulesContext must be used within a ValidationRulesProvider'
    )
  }
  return context
}

// フォールバック用のデフォルト値（現在のハードコーディング値と同じ）
function getDefaultValidationRules(): ValidationRules {
  return {
    user: {
      username: {
        min_length: 3,
        max_length: 50,
        pattern: '^[a-zA-Z0-9_-]+$',
        pattern_description: '英数字、アンダースコア、ハイフンのみ使用可能',
      },
      password: {
        min_length: 8,
        max_length: 100,
        requirements: [
          '大文字を1つ以上含む',
          '小文字を1つ以上含む',
          '数字を1つ以上含む',
        ],
      },
    },
    character: {
      name: {
        min_length: 1,
        max_length: 50,
      },
      description: {
        max_length: 1000,
      },
      appearance: {
        max_length: 1000,
      },
      personality: {
        max_length: 1000,
      },
    },
    game_action: {
      action_text: {
        max_length: 1000,
      },
    },
  }
}
