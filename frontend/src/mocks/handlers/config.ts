import { http, HttpResponse } from 'msw'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const validationRules = {
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

export const configHandlers = [
  // バリデーションルールの取得
  http.get(`${API_BASE_URL}/api/v1/config/game/validation-rules`, () => {
    return HttpResponse.json(validationRules)
  }),
]