/**
 * バリデーションルールの型定義
 * 
 * TODO: この型定義はバックエンドのOpenAPIスキーマから自動生成されるべきです。
 * 現在は一時的な定義として使用しています。
 */

export interface ValidationRules {
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